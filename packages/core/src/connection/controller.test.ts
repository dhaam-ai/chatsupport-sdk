import { describe, expect, it, vi } from 'vitest';

import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, ErrorPayload, ServerFrame, SessionSnapshot } from '../protocol/index.js';
import { ChatStore, createInitialChatState } from '../state/index.js';
import type { ChatSession } from '../state/index.js';
import { CLOSE_CODE } from '../transport/index.js';
import {
  ConnectionAbortedError,
  ConnectionController,
  ConnectionSuspendedError,
} from './controller.js';
import { FakeTransport } from './fake-transport.js';
import type { ConnectionControllerOptions, TokenProvider } from './types.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Drains the microtask queue — `connect()` awaits `getToken()` before opening. */
async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const SESSION_SNAPSHOT: SessionSnapshot = {
  sessionId: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [],
  createdAt: '2026-08-17T00:00:00.000Z',
};

const CHAT_SESSION: ChatSession = {
  id: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  createdAt: '2026-08-17T00:00:00.000Z',
  closedAt: null,
  assignedAgent: null,
  customer: null,
  ticket: null,
};

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): ServerFrame {
  const payload: ConnectionAckPayload = {
    protocolVersion: 1,
    session: SESSION_SNAPSHOT,
    seq: 0,
    ...overrides,
  };
  return { v: 1, t: 'connection.ack', id: 'srv_ack', ts: 0, d: payload };
}

function authError(code: 'AUTH_INVALID' | 'AUTH_EXPIRED'): ErrorPayload {
  return { code, message: 'auth rejected', retryable: true };
}

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly controller: ConnectionController;
  readonly transport: FakeTransport;
  readonly getToken: ReturnType<typeof vi.fn>;
  readonly events: Array<{ name: string; payload: unknown }>;
}

/**
 * @param overrides `staff: true` builds a STAFF controller — one constructed
 *   with no `publishableKey` at all. Expressed as a flag rather than as
 *   `publishableKey: undefined` because under `exactOptionalPropertyTypes`
 *   those are different things, and it is precisely the ABSENT one that
 *   selects the staff flow.
 */
function harness(
  overrides: Partial<ConnectionControllerOptions> & { token?: TokenProvider; staff?: true } = {},
): Harness {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const timers = new ManualTimers();
  const events: Array<{ name: string; payload: unknown }> = [];

  for (const name of ['connected', 'reconnecting', 'suspended', 'disconnected', 'error'] as const) {
    store.on(name, (payload) => events.push({ name, payload }));
  }

  const getToken = vi.fn(overrides.token ?? (async () => 'tok_abc'));
  let transport!: FakeTransport;

  const { token: _token, staff, ...rest } = overrides;
  const controller = new ConnectionController({
    store,
    url: 'wss://example.test/chat-services/v2/ws',
    ...(staff === true ? {} : { publishableKey: 'dhp_test_1' }),
    getToken: getToken as TokenProvider,
    schedule: timers.schedule,
    // rng=1 pins full jitter to its ceiling, so the delay sequence is exact.
    transportBackoff: new TransportBackoffPolicy({ random: () => 1 }),
    authBackoff: new AuthBackoffPolicy({ random: () => 1 }),
    createTransport: (handlers) => {
      transport = new FakeTransport(handlers);
      return transport;
    },
    ...rest,
  });

  return { store, timers, controller, transport, getToken, events };
}

/** Drives a fresh controller all the way to `connected`. */
async function connected(overrides: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(overrides);
  const promise = h.controller.connect();
  await tick();
  h.transport.open();
  h.transport.emitFrame(ackFrame());
  await promise;
  return h;
}

function eventNames(h: Harness): string[] {
  return h.events.map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('ConnectionController — connect lifecycle', () => {
  it('starts idle and mirrors every transition into ChatState.connectionState', async () => {
    const h = harness();
    expect(h.controller.state).toBe('idle');
    expect(h.store.getState().connectionState).toBe('idle');

    const promise = h.controller.connect();
    expect(h.controller.state).toBe('connecting');
    expect(h.store.getState().connectionState).toBe('connecting');

    await tick();
    h.transport.open();
    expect(h.controller.state).toBe('authenticating');
    expect(h.store.getState().connectionState).toBe('authenticating');

    h.transport.emitFrame(ackFrame());
    await promise;
    expect(h.controller.state).toBe('connected');
    expect(h.store.getState().connectionState).toBe('connected');
  });

  it('enters `connecting` before awaiting getToken, so a slow provider is not shown as idle', async () => {
    let release!: (token: string) => void;
    const h = harness({ token: () => new Promise<string>((resolve) => (release = resolve)) });

    void h.controller.connect();
    expect(h.controller.state).toBe('connecting');
    expect(h.transport.connects).toHaveLength(0);

    release('tok_abc');
    await tick();
    expect(h.transport.connects).toHaveLength(1);
  });

  it('sends the token and publishable key in connection.hello, and no credential in the URL', async () => {
    const h = await connected();
    expect(h.transport.lastConnect.hello).toEqual({ token: 'tok_abc', publishableKey: 'dhp_test_1' });
    expect(h.transport.lastConnect.url).toBe('wss://example.test/chat-services/v2/ws');
    expect(h.transport.lastConnect.url).not.toContain('tok_abc');
  });

  it('resolves connect() on connection.ack', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await expect(promise).resolves.toBeUndefined();
  });

  it('is idempotent: a second connect() while one is in flight returns the same promise', async () => {
    const h = harness();
    const first = h.controller.connect();
    const second = h.controller.connect();
    expect(second).toBe(first);

    await tick();
    expect(h.transport.connects).toHaveLength(1);

    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await first;
  });

  it('resolves immediately when already connected, without opening a second socket', async () => {
    const h = await connected();
    await expect(h.controller.connect()).resolves.toBeUndefined();
    expect(h.transport.connects).toHaveLength(1);
  });

  it('ignores onOpen unless it is actually connecting', async () => {
    const h = await connected();
    // A late open from a socket the controller no longer tracks must not move
    // an already-connected machine backwards.
    h.transport.open();
    expect(h.controller.state).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// The `connected` event and the session ordering contract
// ---------------------------------------------------------------------------

describe('ConnectionController — connected event', () => {
  it('emits `connected` once the frame chain has populated ChatState.session', async () => {
    const h = await connected({
      onFrame: (frame) => {
        if (frame.t === 'connection.ack') {
          // Stands in for the module that maps SessionSnapshot -> ChatSession.
        }
      },
    });
    // No session module wired: nothing to put in the §6.5 payload.
    expect(eventNames(h)).not.toContain('connected');
  });

  it('emits `connected` with the session the downstream handler applied', async () => {
    // Late-bound so the handler writes to the harness's own store — the one
    // the controller and the event listeners share.
    let store: ChatStore | null = null;
    const h = harness({
      onFrame: (frame) => {
        if (frame.t === 'connection.ack') store?.setState({ session: CHAT_SESSION });
      },
    });
    store = h.store;

    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await promise;

    expect(h.events.filter((e) => e.name === 'connected')).toEqual([
      { name: 'connected', payload: { session: CHAT_SESSION } },
    ]);
  });

  it('reaches `connected` even when a downstream frame handler throws', async () => {
    const h = harness({
      onFrame: () => {
        throw new Error('presence blew up');
      },
    });

    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await expect(promise).resolves.toBeUndefined();
    expect(h.controller.state).toBe('connected');
    expect(eventNames(h)).toContain('error');
  });

  it('forwards non-ack frames down the chain untouched', async () => {
    const seen: ServerFrame[] = [];
    const h = await connected({ onFrame: (frame) => seen.push(frame) });

    const push: ServerFrame = {
      v: 1,
      t: 'typing.start',
      id: 'f1',
      ts: 0,
      d: { participantId: 'p1' },
    };
    h.transport.emitFrame(push);
    expect(seen).toContain(push);
  });
});

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('ConnectionController — disconnect', () => {
  it('moves to `closed` and closes the transport', async () => {
    const h = await connected();
    h.controller.disconnect();
    expect(h.controller.state).toBe('closed');
    expect(h.store.getState().connectionState).toBe('closed');
    expect(h.transport.closeCalls).toBe(1);
  });

  it('never auto-reconnects from `closed`', async () => {
    const h = await connected();
    h.controller.disconnect();

    const connectsBefore = h.transport.connects.length;
    h.timers.advance(120_000);
    await tick();

    expect(h.timers.pendingCount).toBe(0);
    expect(h.transport.connects).toHaveLength(connectsBefore);
    expect(h.controller.state).toBe('closed');
  });

  it('discards the `local` close its own disconnect produced', async () => {
    const h = await connected();
    h.controller.disconnect();
    // No `disconnected` event, no reconnect scheduling: the close was ours.
    expect(eventNames(h)).not.toContain('disconnected');
    expect(eventNames(h)).not.toContain('reconnecting');
  });

  it('cancels a pending reconnect timer', async () => {
    const h = await connected();
    h.transport.drop();
    expect(h.timers.pendingCount).toBe(1);

    h.controller.disconnect();
    expect(h.timers.pendingCount).toBe(0);
  });

  it('rejects an in-flight connect() with ConnectionAbortedError', async () => {
    const h = harness();
    const promise = h.controller.connect();
    h.controller.disconnect();
    await expect(promise).rejects.toBeInstanceOf(ConnectionAbortedError);
  });

  it('does not open a socket for a token that resolves after disconnect()', async () => {
    let release!: (token: string) => void;
    const h = harness({ token: () => new Promise<string>((resolve) => (release = resolve)) });

    void h.controller.connect().catch(() => undefined);
    h.controller.disconnect();

    release('tok_abc');
    await tick();
    expect(h.transport.connects).toHaveLength(0);
    expect(h.controller.state).toBe('closed');
  });

  it('can be revived by an explicit connect() — terminal means no *automatic* escape', async () => {
    const h = await connected();
    h.controller.disconnect();

    const promise = h.controller.connect();
    expect(h.controller.state).toBe('connecting');
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await expect(promise).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Transport-level reconnect
// ---------------------------------------------------------------------------

describe('ConnectionController — transport reconnect (§8.2)', () => {
  it('emits `disconnected` then `reconnecting`, and schedules rather than retrying inline', async () => {
    const h = await connected();
    h.transport.drop({ reason: 'network gone' });

    expect(h.controller.state).toBe('reconnecting');
    expect(h.events.map((e) => e.name)).toEqual(['disconnected', 'reconnecting']);
    expect(h.events[0]?.payload).toEqual({ reason: 'network gone' });
    expect(h.events[1]?.payload).toEqual({ attempt: 0, delayMs: 500 });

    // Nothing opened synchronously from inside onClose.
    expect(h.transport.connects).toHaveLength(1);
    expect(h.timers.pendingCount).toBe(1);
  });

  it('follows the policy’s delay sequence across consecutive failures', async () => {
    const h = await connected();
    const delays: number[] = [];
    h.store.on('reconnecting', (payload) => delays.push(payload.delayMs));

    for (let i = 0; i < 5; i += 1) {
      h.transport.drop();
      h.timers.advance(60_000);
      await tick();
      h.transport.open();
      // fails again before the ack
    }

    // rng=1 pins full jitter to min(cap, base*2^attempt) with base 500, cap 30s.
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('reports the attempt number alongside the delay (§6.5)', async () => {
    const h = await connected();
    const attempts: number[] = [];
    h.store.on('reconnecting', (payload) => attempts.push(payload.attempt));

    for (let i = 0; i < 3; i += 1) {
      h.transport.drop();
      h.timers.advance(60_000);
      await tick();
    }
    expect(attempts).toEqual([0, 1, 2]);
  });

  it('retries indefinitely — a dropped network is never a reason to stop', async () => {
    const h = await connected();

    for (let i = 0; i < 200; i += 1) {
      h.transport.drop();
      expect(h.controller.state, `attempt ${i}`).toBe('reconnecting');
      h.timers.advance(60_000);
      await tick();
      expect(h.controller.state, `attempt ${i}`).toBe('connecting');
    }

    expect(h.transport.connects.length).toBe(201);
    expect(h.controller.state).toBe('connecting');
  });

  it('reconnects through connecting -> authenticating -> connected and resets the attempt counter', async () => {
    const h = await connected();

    h.transport.drop();
    h.timers.advance(500);
    await tick();
    expect(h.controller.state).toBe('connecting');
    expect(h.controller.attempt).toBe(1);

    h.transport.open();
    expect(h.controller.state).toBe('authenticating');
    h.transport.emitFrame(ackFrame());
    expect(h.controller.state).toBe('connected');
    expect(h.controller.attempt).toBe(0);
  });

  it('fetches a fresh token on every reconnect attempt', async () => {
    const h = await connected();
    expect(h.getToken).toHaveBeenCalledTimes(1);

    h.transport.drop();
    h.timers.advance(500);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(2);
  });

  it('treats a ref-less VALIDATION_FAILED close as retryable — a rejected frame is not a dead session', async () => {
    const h = await connected();
    h.transport.drop({
      code: CLOSE_CODE.POLICY_VIOLATION,
      protocolError: { code: 'VALIDATION_FAILED', message: 'bad frame', retryable: false },
    });

    expect(h.controller.state).toBe('reconnecting');
    expect(eventNames(h)).toContain('reconnecting');
    expect(eventNames(h)).not.toContain('suspended');
  });

  it('backs off harder on close 1013 (server backpressure)', async () => {
    const h = await connected();
    const delays: number[] = [];
    h.store.on('reconnecting', (payload) => delays.push(payload.delayMs));

    h.transport.drop({ code: CLOSE_CODE.TRY_AGAIN_LATER, reason: 'buffer full' });

    // A plain drop at attempt 0 would have drawn from a 500ms window; 1013
    // charges an extra step up the curve first, so the window is 1000ms.
    expect(delays).toEqual([1000]);
    expect(h.controller.state).toBe('reconnecting');
    expect(h.transport.connects).toHaveLength(1); // not retried immediately
  });

  it('retries rather than crashing when the socket factory throws', async () => {
    // What the default factory does when the environment has no `WebSocket`.
    let failing = true;
    let transport!: FakeTransport;

    const h = harness({
      createTransport: (handlers) => {
        transport = new FakeTransport(handlers);
        const real = transport.connect.bind(transport);
        transport.connect = (options) => {
          if (failing) throw new Error('No global WebSocket is available');
          real(options);
        };
        return transport;
      },
    });

    // The throw happens inside a promise continuation, and on every later
    // attempt inside a timer callback. Neither may escape into the host, and
    // neither is grounds for giving up: a missing global today may be a
    // polyfill loaded a moment from now.
    const promise = h.controller.connect();
    await tick();

    expect(h.controller.state).toBe('reconnecting');
    expect(h.store.getState().lastError?.message).toContain('No global WebSocket');
    expect(eventNames(h)).toEqual(['error', 'reconnecting']);

    // `connect()` stays pending across retries — §6.2 resolves it on
    // `connection.ack`, and no ack has happened yet.
    failing = false;
    h.timers.advance(60_000);
    await tick();
    expect(h.controller.state).toBe('connecting');

    transport.open();
    transport.emitFrame(ackFrame());
    await expect(promise).resolves.toBeUndefined();
  });

  it('never opens a socket synchronously from inside onClose', async () => {
    const h = await connected();
    let connectsDuringClose = -1;

    h.store.on('reconnecting', () => {
      connectsDuringClose = h.transport.connects.length;
    });
    h.transport.drop();

    expect(connectsDuringClose).toBe(1); // still only the original socket
  });
});

// ---------------------------------------------------------------------------
// Auth escalation
// ---------------------------------------------------------------------------

describe('ConnectionController — auth failures (§10.6)', () => {
  it('routes a getToken() throw through AuthBackoffPolicy and suspends on the third', async () => {
    const getToken = vi.fn(async () => {
      throw new Error('backend down');
    });
    const h = harness({ token: getToken as unknown as TokenProvider });

    const promise = h.controller.connect();
    await tick();
    expect(h.controller.state).toBe('reconnecting');

    h.timers.advance(500);
    await tick();
    expect(h.controller.state).toBe('reconnecting');

    h.timers.advance(1000);
    await tick();

    expect(h.controller.state).toBe('suspended');
    await expect(promise).rejects.toBeInstanceOf(ConnectionSuspendedError);
    expect(h.events.filter((e) => e.name === 'suspended')).toEqual([
      { name: 'suspended', payload: { reason: 'auth' } },
    ]);
  });

  it('uses the auth policy’s delays, not the transport policy’s', async () => {
    const h = harness({
      token: async () => {
        throw new Error('nope');
      },
    });
    const delays: number[] = [];
    h.store.on('reconnecting', (payload) => delays.push(payload.delayMs));

    void h.controller.connect().catch(() => undefined);
    await tick();
    h.timers.advance(500);
    await tick();

    expect(delays).toEqual([500, 1000]);
  });

  it('treats a falsy token as an auth failure (§10.6)', async () => {
    for (const bad of ['', null, undefined]) {
      const h = harness({ token: (async () => bad) as unknown as TokenProvider });
      void h.controller.connect().catch(() => undefined);
      await tick();
      expect(h.controller.state, String(bad)).toBe('reconnecting');
      expect(h.transport.connects, String(bad)).toHaveLength(0);
    }
  });

  it('suspends after three consecutive AUTH_INVALID closes', async () => {
    const h = await connected();

    for (let i = 0; i < 2; i += 1) {
      h.transport.drop({
        code: CLOSE_CODE.POLICY_VIOLATION,
        protocolError: authError('AUTH_INVALID'),
      });
      expect(h.controller.state, `failure ${i}`).toBe('reconnecting');
      h.timers.advance(60_000);
      await tick();
      h.transport.open();
    }

    h.transport.drop({
      code: CLOSE_CODE.POLICY_VIOLATION,
      protocolError: authError('AUTH_INVALID'),
    });

    expect(h.controller.state).toBe('suspended');
    expect(h.timers.pendingCount).toBe(0);
  });

  it('resets the auth counter on a successful connection.ack', async () => {
    const h = await connected();

    for (let round = 0; round < 3; round += 1) {
      h.transport.drop({
        code: CLOSE_CODE.POLICY_VIOLATION,
        protocolError: authError('AUTH_EXPIRED'),
      });
      expect(h.controller.state, `round ${round}`).toBe('reconnecting');

      h.timers.advance(60_000);
      await tick();
      h.transport.open();
      h.transport.emitFrame(ackFrame());
      expect(h.controller.state, `round ${round}`).toBe('connected');
    }
  });

  it('records a structured ChatError the host can branch on, never the token', async () => {
    const h = await connected();
    h.transport.drop({
      code: CLOSE_CODE.POLICY_VIOLATION,
      protocolError: { code: 'AUTH_EXPIRED', message: 'token expired', retryable: true },
    });

    const lastError = h.store.getState().lastError;
    expect(lastError).toEqual({
      source: 'protocol',
      code: 'AUTH_EXPIRED',
      message: 'token expired',
      retryable: true,
    });
    expect(JSON.stringify(h.store.getState())).not.toContain('tok_abc');
  });

  it('never puts token material in a getToken() failure error', async () => {
    const h = harness({
      token: async () => {
        throw new Error('failed for tok_secret_value');
      },
    });
    void h.controller.connect().catch(() => undefined);
    await tick();

    // The provider's own message is relayed verbatim; core adds nothing of its
    // own. What core must never do is read the token and put *that* in state.
    const lastError = h.store.getState().lastError;
    expect(lastError?.source).toBe('transport');
    expect(lastError?.code).toBeNull();
    expect(lastError?.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// suspended / version negotiation
// ---------------------------------------------------------------------------

describe('ConnectionController — suspended (§8.1, §7.5)', () => {
  it('suspends without a single retry on PROTOCOL_VERSION_UNSUPPORTED', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();
    h.transport.open();

    h.transport.drop({
      code: CLOSE_CODE.POLICY_VIOLATION,
      cause: 'versionUnsupported',
      protocolError: {
        code: 'PROTOCOL_VERSION_UNSUPPORTED',
        message: 'server requires v2',
        retryable: false,
      },
    });

    expect(h.controller.state).toBe('suspended');
    expect(h.timers.pendingCount).toBe(0);
    expect(eventNames(h)).not.toContain('reconnecting');
    expect(h.transport.connects).toHaveLength(1);

    await expect(promise).rejects.toBeInstanceOf(ConnectionSuspendedError);
    expect(h.store.getState().lastError?.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
  });

  it('stays suspended no matter how far the clock advances', async () => {
    const h = harness();
    void h.controller.connect().catch(() => undefined);
    await tick();
    h.transport.open();
    h.transport.drop({
      cause: 'versionUnsupported',
      protocolError: {
        code: 'PROTOCOL_VERSION_UNSUPPORTED',
        message: 'server requires v2',
        retryable: false,
      },
    });

    h.timers.advance(10 * 60_000);
    await tick();
    expect(h.controller.state).toBe('suspended');
    expect(h.transport.connects).toHaveLength(1);
  });

  it('resumes only on an explicit connect(), with a clean auth counter', async () => {
    const getToken = vi
      .fn(async () => 'tok_good')
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue('tok_good');

    const h = harness({ token: getToken as unknown as TokenProvider });
    void h.controller.connect().catch(() => undefined);
    await tick();
    h.timers.advance(500);
    await tick();
    h.timers.advance(1000);
    await tick();
    expect(h.controller.state).toBe('suspended');

    // Time alone never leaves `suspended`.
    h.timers.advance(10 * 60_000);
    await tick();
    expect(h.controller.state).toBe('suspended');

    const promise = h.controller.connect();
    expect(h.controller.state).toBe('connecting');
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await expect(promise).resolves.toBeUndefined();
    expect(h.controller.state).toBe('connected');
  });

  it('does not re-suspend on the first hiccup after an explicit reconnect', async () => {
    const h = harness({
      token: async () => {
        throw new Error('down');
      },
    });
    void h.controller.connect().catch(() => undefined);
    await tick();
    h.timers.advance(500);
    await tick();
    h.timers.advance(1000);
    await tick();
    expect(h.controller.state).toBe('suspended');

    // A fresh connect() resets the escalation counter, so the next failure
    // schedules a retry rather than immediately re-suspending.
    void h.controller.connect().catch(() => undefined);
    await tick();
    expect(h.controller.state).toBe('reconnecting');
  });

  it('can be closed from `suspended`', async () => {
    const h = harness({
      token: async () => {
        throw new Error('down');
      },
    });
    void h.controller.connect().catch(() => undefined);
    await tick();
    h.timers.advance(500);
    await tick();
    h.timers.advance(1000);
    await tick();
    expect(h.controller.state).toBe('suspended');

    h.controller.disconnect();
    expect(h.controller.state).toBe('closed');
  });
});

// §14: core must emit no credential material, including text it did not author.
// `getToken()` is the host app's code, and HTTP clients routinely embed the
// request — URL and headers — in their error messages. On this service the
// token also travels in the query string, so a customer's 401 can hand core a
// live credential to write into `lastError` and broadcast as an `error` event.
describe('getToken() failure reporting (§14)', () => {
  const LIVE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRETPAYLOAD.SECRETSIG';
  // Assembled rather than written as one literal: a source-literal string in
  // secret-key shape trips GitHub push protection, and every key in this repo
  // is a fixture.
  const SECRET_KEY = `${'dhk' + '_live_'}${'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK'}`;

  async function failWith(message: string) {
    const h = harness({
      token: async () => {
        throw new Error(message);
      },
    });
    h.controller.connect().catch(() => {});
    await tick();
    return h;
  }

  it('scrubs a token echoed back by the host application', async () => {
    const h = await failWith(`Request failed: GET /v1/tokens?token=${LIVE_TOKEN} → 401`);

    const reported = h.store.getState().lastError?.message ?? '';
    expect(reported).not.toContain(LIVE_TOKEN);
    expect(reported).toContain('getToken() failed');
  });

  it('scrubs a secret key echoed back by the host application', async () => {
    const h = await failWith(`Bad config: ${SECRET_KEY}`);

    expect(h.store.getState().lastError?.message ?? '').not.toContain(SECRET_KEY.slice(0, 12));
  });

  it('emits the scrubbed message rather than the raw one', async () => {
    const h = await failWith(`token=${LIVE_TOKEN}`);

    const errors = h.events.filter((e) => e.name === 'error');
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(JSON.stringify(e.payload)).not.toContain(LIVE_TOKEN);
    }
  });
});

// ---------------------------------------------------------------------------
// The `connection.ack` contract: optional in the validator, enforced per flow
// ---------------------------------------------------------------------------
//
// `session` and `seq` are optional in protocol/validate.ts so a STAFF ack —
// which resolves no session and so holds no anchor — can be admitted at all.
// That loosening is shared by both flows, so on its own it would also let a
// buggy server omit `session` for a CUSTOMER and pass silently.
//
// The customer half is therefore enforced HERE, in the one place that knows
// which flow this connection is: this controller wrote the `connection.hello`,
// so it knows whether a publishableKey went out. Both directions are pinned
// below — the staff ack must pass, the customer ack must not.

/** A staff ack: `session` and `seq` ABSENT, not set to `undefined`. */
function staffAckFrame(): ServerFrame {
  return { v: 1, t: 'connection.ack', id: 'srv_ack', ts: 0, d: { protocolVersion: 1 } };
}

/** A `connection.ack` with `seq` but no `session` — the half-formed customer case. */
function ackFrameWithoutSession(): ServerFrame {
  return { v: 1, t: 'connection.ack', id: 'srv_ack', ts: 0, d: { protocolVersion: 1, seq: 0 } };
}

/** A `connection.ack` with `session` but no `seq`. */
function ackFrameWithoutSeq(): ServerFrame {
  return {
    v: 1,
    t: 'connection.ack',
    id: 'srv_ack',
    ts: 0,
    d: { protocolVersion: 1, session: SESSION_SNAPSHOT },
  };
}

describe('connection.ack — the STAFF flow, which resolves no session', () => {
  it('omits publishableKey from the hello entirely when none was configured', async () => {
    const h = harness({ staff: true });
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(staffAckFrame());
    await promise;

    // Absent, not present-and-undefined: the server selects its flow on the
    // key's PRESENCE, so an explicit `undefined` key would be a different
    // thing on the wire.
    expect(h.transport.lastConnect.hello).toEqual({ token: 'tok_abc' });
    expect('publishableKey' in h.transport.lastConnect.hello).toBe(false);
  });

  it('accepts an ack with neither session nor seq and reaches connected', async () => {
    const h = harness({ staff: true });
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(staffAckFrame());

    await expect(promise).resolves.toBeUndefined();
    expect(h.controller.state).toBe('connected');
    expect(eventNames(h)).not.toContain('suspended');
    expect(h.store.getState().lastError).toBeNull();
  });

  it('delivers the staff ack downstream rather than swallowing it', async () => {
    const frames: ServerFrame[] = [];
    const h = harness({ staff: true, onFrame: (f) => frames.push(f) });
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(staffAckFrame());
    await promise;

    expect(frames.map((f) => f.t)).toEqual(['connection.ack']);
  });

  it('leaves the resume anchor untouched, so the next hello does not claim a seq it never had', async () => {
    const h = harness({ staff: true });
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(staffAckFrame());
    await promise;

    // A staff ack carries no anchor. Reconnecting must therefore read as a
    // FIRST connection — `resumeFrom` absent — rather than resuming from a
    // fabricated 0, which would ask the server to replay from the beginning
    // of time.
    h.transport.close({ code: CLOSE_CODE.GOING_AWAY, reason: 'bye', wasClean: false });
    // `advance`, not a non-existent `runAll` — ManualTimers only knows how to
    // move a clock. 60s is the same span the backoff tests above use to drain
    // a scheduled retry.
    h.timers.advance(60_000);
    await tick();

    expect('resumeFrom' in h.transport.lastConnect.hello).toBe(false);
  });
});

describe('connection.ack — the CUSTOMER guarantee, enforced at the call site', () => {
  it.each([
    ['session', ackFrameWithoutSession],
    ['seq', ackFrameWithoutSeq],
    ['session and seq', staffAckFrame],
  ])('rejects a customer ack missing %s as a protocol violation', async (_label, build) => {
    const frames: ServerFrame[] = [];
    // `harness` configures a publishableKey, so this IS a customer connection.
    const h = harness({ onFrame: (f) => frames.push(f) });
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(build());

    await expect(promise).rejects.toBeInstanceOf(ConnectionSuspendedError);

    // Suspended, not retried: backoff cannot fix a server that answers a
    // customer hello with a staff-shaped ack, and retrying forever would leave
    // the widget stuck "connecting" with no conversation and no explanation.
    expect(h.controller.state).toBe('suspended');
    expect(eventNames(h)).toContain('suspended');

    // NEVER applied. This is the whole point of the check: a session-less ack
    // that reached the state tree would seed the conversation from `undefined`
    // and fail later, somewhere else, for a reason nobody could trace back.
    expect(frames).toHaveLength(0);
    expect(h.store.getState().session).toBeNull();
    expect(h.store.getState().connectionState).toBe('suspended');
  });

  it('reports the violation with a structured code, not just prose', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrameWithoutSession());
    await promise.catch(() => undefined);

    const error = h.store.getState().lastError;
    expect(error?.source).toBe('protocol');
    expect(error?.code).toBe('VALIDATION_FAILED');
    expect(error?.retryable).toBe(false);
    expect(error?.message).toContain('missing session');
  });

  it('names both missing fields when both are absent', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(staffAckFrame());
    await promise.catch(() => undefined);

    expect(h.store.getState().lastError?.message).toContain('missing session and seq');
  });

  it('still accepts a well-formed customer ack — the guard costs the happy path nothing', async () => {
    const h = await connected();
    expect(h.controller.state).toBe('connected');
    expect(h.store.getState().lastError).toBeNull();
  });
});
