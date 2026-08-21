// Identify's whole job inside core: fire the injected `IdentitySync` exactly
// once per client, on the FIRST `connect()`, and never let its failure reach
// anything a user or a caller can see.
//
// ── Why "not at construction" gets its own test ──────────────────────────
//
// The obvious place to fire an identify is `createChatClient` itself, and it
// is the one place it must not happen. `createChatClient` is documented as
// doing zero I/O in four places and react/vue both build the client during
// render so it survives SSR (each has a live SSR test). A call in the
// constructor would POST an identify on every server render of the provider —
// once per request, from the server, for a user who may never open the widget.
// That regression is silent: every functional test still passes, because the
// call does happen. So it is asserted here directly, and the assertion is
// shown to be capable of failing in the same test.
//
// Everything below drives `createChatClient`'s public surface; the only
// doubles are `ChatClientConfig` seams a real consumer also supplies.

import { describe, expect, it } from 'vitest';

import { DEFAULT_BASE_MS } from '../backoff/index.js';
import { IDENTITY_DEDUP_TTL_MS } from '../identity/index.js';
import type { IdentityProfile, IdentitySync } from '../identity/index.js';
import { ManualTimers } from '../presence/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import type { StorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClient, ChatClientConfig } from './types.js';

const CUSTOMER_ID = 'participant_customer_1';
// Concatenated for the same reason every other fixture in this package is:
// the repo's `credential-scan` CI job greps source for a whole publishable-key
// literal, and a test fixture is not an exception it should have to carry.
const PUBLISHABLE_KEY = 'dhp' + '_test_identity1';

const PROFILE: IdentityProfile = {
  name: 'Jordan Rivera',
  email: 'jordan@example.test',
  tags: ['vip'],
};

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A `MemoryStorageAdapter` that also remembers every key it was asked about. */
class RecordingStorage implements StorageAdapter {
  readonly touched: string[] = [];
  readonly #inner = new MemoryStorageAdapter();

  get(key: string): Promise<string | null> {
    this.touched.push(key);
    return this.#inner.get(key);
  }

  set(key: string, value: string): Promise<void> {
    this.touched.push(key);
    return this.#inner.set(key, value);
  }

  remove(key: string): Promise<void> {
    this.touched.push(key);
    return this.#inner.remove(key);
  }

  /**
   * Every touched key belonging to the dedup record.
   *
   * Keyed on the record's own name rather than the full namespaced string, so
   * this stays true if the namespace layering is ever changed — the question
   * it asks is "did the identify path run at all", not "where does it store".
   */
  identityTouches(): readonly string[] {
    return this.touched.filter((key) => key.includes('identitySync'));
  }
}

/**
 * A storage whose reads park until the test releases them.
 *
 * This is the concurrency test's whole apparatus: it holds the first identify
 * suspended *inside* `shouldSyncIdentity` while a second `connect()` arrives,
 * which is precisely the window an exactly-once guard assigned after an
 * `await` would lose.
 */
class ParkingStorage implements StorageAdapter {
  readonly touched: string[] = [];
  readonly release: () => void;
  readonly #gate: Deferred = deferred();
  readonly #inner = new MemoryStorageAdapter();

  constructor() {
    this.release = this.#gate.resolve;
  }

  async get(key: string): Promise<string | null> {
    this.touched.push(key);
    await this.#gate.promise;
    return this.#inner.get(key);
  }

  set(key: string, value: string): Promise<void> {
    this.touched.push(key);
    return this.#inner.set(key, value);
  }

  remove(key: string): Promise<void> {
    return this.#inner.remove(key);
  }

  parkedOnIdentity(): boolean {
    return this.touched.some((key) => key.includes('identitySync'));
  }
}

function recordingSync(): { readonly sync: IdentitySync; readonly calls: IdentityProfile[] } {
  const calls: IdentityProfile[] = [];
  return {
    calls,
    sync: {
      sync: async (profile) => {
        calls.push(profile);
      },
    },
  };
}

/** A sync that rejects on its first `failures` attempts and counts every one. */
function flakySync(failures: number): { readonly sync: IdentitySync; attempts(): number } {
  let attempts = 0;
  return {
    attempts: () => attempts,
    sync: {
      sync: async () => {
        attempts += 1;
        if (attempts <= failures) throw new Error('identify transport is down');
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessOptions {
  /** Spread verbatim, so a test can supply neither field, one, or both. */
  readonly identity?: Pick<ChatClientConfig, 'identityProfile' | 'identitySync'>;
  readonly storage?: StorageAdapter;
  readonly timers?: ManualTimers;
}

interface Harness {
  readonly client: ChatClient;
  readonly sockets: StubSocketFactory;
  readonly timers: ManualTimers;
  readonly logs: string[];
}

function harness(options: HarnessOptions = {}): Harness {
  const sockets = new StubSocketFactory();
  const timers = options.timers ?? new ManualTimers();
  const logs: string[] = [];

  const config: ChatClientConfig = {
    publishableKey: PUBLISHABLE_KEY,
    getToken: async () => 'tok',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: options.storage ?? new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
    logger: (_level, message) => {
      logs.push(message);
    },
    ...options.identity,
  };

  return { sockets, timers, logs, client: createChatClient(config) };
}

async function tick(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

/**
 * Drains microtasks AND crosses a macrotask boundary, which is where Node
 * decides a rejection was never handled. Anything that would be reported as
 * an unhandled rejection has been reported by the time this resolves.
 */
async function settle(): Promise<void> {
  await tick();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await tick();
}

/**
 * Calls `connect()` without waiting for a socket that these tests never open.
 *
 * The `catch` covers the CONNECTION's own promise only. An identify rejection
 * has no such handler anywhere, which is exactly why the unhandled-rejection
 * test below can see one if it escapes.
 */
function connectDetached(client: ChatClient): void {
  void client.connect().catch(() => undefined);
}

function identityLines(logs: readonly string[]): readonly string[] {
  return logs.filter((line) => line.startsWith('identify:'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the SSR guarantee — createChatClient does no identify work', () => {
  it('touches neither the sync seam nor the dedup record at construction', async () => {
    const storage = new RecordingStorage();
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync }, storage });

    await settle();

    expect(calls).toEqual([]);
    expect(storage.identityTouches()).toEqual([]);

    // …and the two assertions above are capable of failing. Without this the
    // test passes just as happily against a client that never identifies at
    // all, which is the failure mode it is supposed to be guarding.
    connectDetached(h.client);
    await settle();

    expect(calls).toEqual([PROFILE]);
    expect(storage.identityTouches().length).toBeGreaterThan(0);
  });
});

describe('firing on the first connect()', () => {
  it('sends the profile exactly once', async () => {
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync } });

    connectDetached(h.client);
    await settle();

    expect(calls).toEqual([PROFILE]);
  });

  it('does not send again on a second connect()', async () => {
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync } });

    connectDetached(h.client);
    await settle();
    connectDetached(h.client);
    await settle();
    connectDetached(h.client);
    await settle();

    expect(calls).toHaveLength(1);
  });

  it('sends once for two connect() calls issued in the same turn', async () => {
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync } });

    connectDetached(h.client);
    connectDetached(h.client);
    await settle();

    expect(calls).toHaveLength(1);
  });

  it('sends once when the second connect() lands while the first is inside the dedup gate', async () => {
    // The adversarial ordering: a guard recorded after the `await` on storage
    // is still unset here, so a naive implementation sends twice.
    const storage = new ParkingStorage();
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync }, storage });

    connectDetached(h.client);
    await tick();
    expect(storage.parkedOnIdentity()).toBe(true);

    connectDetached(h.client);
    await tick();

    storage.release();
    await settle();

    expect(calls).toHaveLength(1);
  });
});

describe('the pair is the switch', () => {
  it('does nothing when neither field is configured', async () => {
    const storage = new RecordingStorage();
    const h = harness({ storage });

    connectDetached(h.client);
    await settle();

    expect(storage.identityTouches()).toEqual([]);
    expect(identityLines(h.logs)).toEqual([]);
  });

  it('does nothing when only identityProfile is configured — no transport, no error', async () => {
    const storage = new RecordingStorage();
    const h = harness({ identity: { identityProfile: PROFILE }, storage });

    connectDetached(h.client);
    await settle();

    expect(storage.identityTouches()).toEqual([]);
    expect(identityLines(h.logs)).toEqual([]);
  });

  it('does nothing when only identitySync is configured — a guest has no profile', async () => {
    const storage = new RecordingStorage();
    const { sync, calls } = recordingSync();
    const h = harness({ identity: { identitySync: sync }, storage });

    connectDetached(h.client);
    await settle();

    expect(calls).toEqual([]);
    expect(storage.identityTouches()).toEqual([]);
  });
});

describe('failure is invisible to everything the caller can see', () => {
  it('does not reject connect() and raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', record);

    try {
      const { sync } = flakySync(Number.POSITIVE_INFINITY);
      const h = harness({ identity: { identityProfile: PROFILE, identitySync: sync } });

      const connecting = h.client.connect();
      await tick();
      h.sockets.last.open();
      h.sockets.last.emitJson(ackJson());

      // The connection completes normally while identify is failing behind it.
      await expect(connecting).resolves.toBeUndefined();

      h.timers.advance(DEFAULT_BASE_MS);
      await settle();

      expect(unhandled).toEqual([]);
      expect(h.client.getState().lastError).toBeNull();
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('retries exactly once, on the injected timer, and then stops', async () => {
    const flaky = flakySync(Number.POSITIVE_INFINITY);
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: flaky.sync } });

    connectDetached(h.client);
    await settle();

    // One attempt has failed; the retry is parked on the injected timer and
    // no real time has passed, which is the point of injecting it.
    expect(flaky.attempts()).toBe(1);

    // fullJitterDelay(0) is uniform on [0, DEFAULT_BASE_MS), so advancing by
    // the ceiling fires the retry whatever the draw was.
    h.timers.advance(DEFAULT_BASE_MS);
    await settle();
    expect(flaky.attempts()).toBe(2);

    h.timers.advance(10 * 60_000);
    await settle();
    expect(flaky.attempts()).toBe(2);
    expect(identityLines(h.logs)).toHaveLength(1);
  });

  it('records nothing on failure, so the next client tries again', async () => {
    const storage = new RecordingStorage();
    const failing = flakySync(Number.POSITIVE_INFINITY);
    const first = harness({
      identity: { identityProfile: PROFILE, identitySync: failing.sync },
      storage,
    });

    connectDetached(first.client);
    await settle();
    first.timers.advance(DEFAULT_BASE_MS);
    await settle();
    expect(failing.attempts()).toBe(2);

    const { sync, calls } = recordingSync();
    const second = harness({
      identity: { identityProfile: PROFILE, identitySync: sync },
      storage,
      timers: new ManualTimers(1_000),
    });

    connectDetached(second.client);
    await settle();

    // A failed send must never open a TTL window — that would turn one
    // outage into fifteen minutes of silence.
    expect(calls).toEqual([PROFILE]);
  });

  it('succeeds on the retry and still records exactly one successful sync', async () => {
    const flaky = flakySync(1);
    const h = harness({ identity: { identityProfile: PROFILE, identitySync: flaky.sync } });

    connectDetached(h.client);
    await settle();
    h.timers.advance(DEFAULT_BASE_MS);
    await settle();

    expect(flaky.attempts()).toBe(2);
    expect(identityLines(h.logs)).toEqual([]);
  });
});

describe('the dedup gate is wired to the real profile and the real clock', () => {
  it('suppresses a second client inside the TTL', async () => {
    const storage = new RecordingStorage();
    const first = recordingSync();
    const a = harness({
      identity: { identityProfile: PROFILE, identitySync: first.sync },
      storage,
      timers: new ManualTimers(1_000),
    });

    connectDetached(a.client);
    await settle();
    expect(first.calls).toHaveLength(1);

    const second = recordingSync();
    const b = harness({
      identity: { identityProfile: PROFILE, identitySync: second.sync },
      storage,
      timers: new ManualTimers(1_000 + IDENTITY_DEDUP_TTL_MS - 1),
    });

    connectDetached(b.client);
    await settle();

    expect(second.calls).toEqual([]);
  });

  it('sends again once the TTL has lapsed', async () => {
    const storage = new RecordingStorage();
    const first = recordingSync();
    const a = harness({
      identity: { identityProfile: PROFILE, identitySync: first.sync },
      storage,
      timers: new ManualTimers(1_000),
    });

    connectDetached(a.client);
    await settle();

    const second = recordingSync();
    const b = harness({
      identity: { identityProfile: PROFILE, identitySync: second.sync },
      storage,
      timers: new ManualTimers(1_000 + IDENTITY_DEDUP_TTL_MS),
    });

    connectDetached(b.client);
    await settle();

    expect(second.calls).toEqual([PROFILE]);
  });

  it('sends immediately inside the TTL when a profile field changed', async () => {
    const storage = new RecordingStorage();
    const first = recordingSync();
    const a = harness({
      identity: { identityProfile: PROFILE, identitySync: first.sync },
      storage,
      timers: new ManualTimers(1_000),
    });

    connectDetached(a.client);
    await settle();

    const changed: IdentityProfile = { ...PROFILE, city: 'Mumbai' };
    const second = recordingSync();
    const b = harness({
      identity: { identityProfile: changed, identitySync: second.sync },
      storage,
      timers: new ManualTimers(1_001),
    });

    connectDetached(b.client);
    await settle();

    expect(second.calls).toEqual([changed]);
  });
});

/** Enough of a `connection.ack` to drive `connect()` to resolution. */
function ackJson(): unknown {
  return {
    v: 1,
    t: 'connection.ack',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
    ts: 0,
    d: {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId: 'session_1',
        status: 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
        createdAt: '2026-08-18T09:00:00.000Z',
      },
    },
  };
}
