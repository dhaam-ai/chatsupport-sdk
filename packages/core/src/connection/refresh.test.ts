import { describe, expect, it, vi } from 'vitest';

import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import { ManualTimers } from '../presence/index.js';
import type {
  AckExtraData,
  AckFrame,
  ConnectionAckPayload,
  ServerFrame,
  SessionSnapshot,
} from '../protocol/index.js';
import { ChatStore, createInitialChatState } from '../state/index.js';
import { CLOSE_CODE } from '../transport/index.js';
import { ConnectionController, DEFAULT_REFRESH_AT_FRACTION } from './controller.js';
import { FakeTransport } from './fake-transport.js';
import { MissingTokenError, resolveToken } from './token.js';
import type {
  AckOutcome,
  AuthToken,
  ConnectionControllerOptions,
  TokenProvider,
} from './types.js';

// ---------------------------------------------------------------------------
// resolveToken
// ---------------------------------------------------------------------------

describe('resolveToken', () => {
  it('accepts §6.1’s bare-string provider', async () => {
    await expect(resolveToken(async () => 'tok')).resolves.toEqual({ token: 'tok' });
  });

  it('accepts a synchronous provider', async () => {
    await expect(resolveToken(() => 'tok')).resolves.toEqual({ token: 'tok' });
  });

  it('carries a known lifetime through', async () => {
    await expect(resolveToken(async () => ({ token: 'tok', expiresInMs: 60_000 }))).resolves.toEqual({
      token: 'tok',
      expiresInMs: 60_000,
    });
  });

  it('treats every falsy result as a failure (§10.6)', async () => {
    for (const bad of ['', null, undefined]) {
      await expect(resolveToken((() => bad) as unknown as TokenProvider)).rejects.toBeInstanceOf(
        MissingTokenError,
      );
    }
  });

  it('rejects an object with no usable token field', async () => {
    await expect(
      resolveToken((() => ({ token: '' })) as unknown as TokenProvider),
    ).rejects.toBeInstanceOf(MissingTokenError);
    await expect(
      resolveToken((() => ({ token: 42 })) as unknown as TokenProvider),
    ).rejects.toBeInstanceOf(MissingTokenError);
    await expect(resolveToken((() => 7) as unknown as TokenProvider)).rejects.toBeInstanceOf(
      MissingTokenError,
    );
  });

  it('propagates what the provider threw', async () => {
    const boom = new Error('backend down');
    await expect(
      resolveToken(() => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('drops a malformed lifetime rather than failing the connection over a hint', async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'soon']) {
      const result = await resolveToken(
        (() => ({ token: 'tok', expiresInMs: bad })) as unknown as TokenProvider,
      );
      expect(result, String(bad)).toEqual({ token: 'tok' });
    }
  });

  it('never puts token material in its own error message (§14)', async () => {
    const secret = 'eyJhbGciOi.SUPER_SECRET_VALUE.sig';

    // Every rejecting shape, each carrying a value that must not be echoed:
    // the message describes what came back, never what it contained.
    const shapes: unknown[] = [
      { token: { nested: secret } },
      { token: 42, leftover: secret },
      { notAToken: secret },
    ];

    for (const shape of shapes) {
      try {
        await resolveToken((() => shape) as unknown as TokenProvider);
        expect.unreachable(`${JSON.stringify(shape)} should not resolve`);
      } catch (error) {
        expect(error).toBeInstanceOf(MissingTokenError);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain('SUPER_SECRET_VALUE');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SESSION_SNAPSHOT: SessionSnapshot = {
  sessionId: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [],
  createdAt: '2026-08-17T00:00:00.000Z',
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

function authExpiredFrame(): ServerFrame {
  return {
    v: 1,
    t: 'error',
    id: 'err_1',
    ts: 0,
    d: { code: 'AUTH_EXPIRED', message: 'token expired', retryable: true },
  };
}

/**
 * A successful, data-free `ack` — what `connection.reauth` gets back.
 *
 * The cast is unavoidable and worth naming: `AckExtraData` includes
 * `EmptyPayload = Record<string, never>`, so `{ ok: true } & EmptyPayload`
 * demands that `ok` be `never` and a plain `{ ok: true }` satisfies no branch
 * of the union. That is a wart in the protocol types, not in this test — see
 * the T8 report.
 */
function okAck(ref: string): AckOutcome {
  return {
    status: 'acked',
    frame: { v: 1, t: 'ack', id: 'a', ref, ts: 0, d: { ok: true } as AckFrame<AckExtraData>['d'] },
  };
}

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const LIFETIME_MS = 60_000;

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly controller: ConnectionController;
  readonly transport: FakeTransport;
  readonly getToken: ReturnType<typeof vi.fn>;
  readonly events: string[];
}

function harness(
  overrides: Partial<ConnectionControllerOptions> & { token?: TokenProvider } = {},
): Harness {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const timers = new ManualTimers();
  const events: string[] = [];

  for (const name of ['reconnecting', 'suspended', 'disconnected', 'tokenRefreshed'] as const) {
    store.on(name, () => events.push(name));
  }

  const getToken = vi.fn(
    overrides.token ?? (async (): Promise<AuthToken> => ({ token: 'tok_1', expiresInMs: LIFETIME_MS })),
  );
  let transport!: FakeTransport;

  const { token: _token, ...rest } = overrides;
  const controller = new ConnectionController({
    store,
    url: 'wss://example.test/ws',
    publishableKey: 'dhp_test_1',
    getToken: getToken as TokenProvider,
    schedule: timers.schedule,
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

async function connected(overrides: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(overrides);
  const promise = h.controller.connect();
  await tick();
  h.transport.open();
  h.transport.emitFrame(ackFrame());
  await promise;
  return h;
}

// ---------------------------------------------------------------------------
// Proactive refresh
// ---------------------------------------------------------------------------

describe('ConnectionController — proactive refresh (§10.4)', () => {
  it('fires at 80% of the token lifetime, not at expiry', async () => {
    const h = await connected();
    expect(h.getToken).toHaveBeenCalledTimes(1);

    h.timers.advance(LIFETIME_MS * DEFAULT_REFRESH_AT_FRACTION - 1);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(1);

    h.timers.advance(1);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(2);
  });

  it('honours a configured fraction', async () => {
    const h = await connected({ refreshAtFraction: 0.5 });
    h.timers.advance(LIFETIME_MS * 0.5);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a fraction that would refresh at or after expiry', () => {
    for (const bad of [0, 1, 1.5, -0.5, Number.NaN]) {
      expect(() => harness({ refreshAtFraction: bad }), String(bad)).toThrow(RangeError);
    }
  });

  it('schedules nothing when the host did not supply a lifetime', async () => {
    const h = await connected({ token: async () => 'tok_no_expiry' });
    expect(h.timers.pendingCount).toBe(0);

    h.timers.advance(10 * 60_000);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(1);
  });

  it('sends connection.reauth on the live socket rather than reconnecting (D3)', async () => {
    const h = await connected();
    h.timers.advance(LIFETIME_MS);
    await tick();

    expect(h.transport.lastSend.t).toBe('connection.reauth');
    expect(h.transport.lastSend.d).toEqual({ token: 'tok_1' });
    // The socket was never torn down.
    expect(h.transport.connects).toHaveLength(1);
    expect(h.transport.closeCalls).toBe(0);
    expect(h.controller.state).toBe('connected');
  });

  it('emits tokenRefreshed as soon as getToken() succeeds', async () => {
    const h = await connected();
    h.timers.advance(LIFETIME_MS);
    await tick();
    expect(h.events).toContain('tokenRefreshed');
  });

  it('re-arms the timer after a successful reauth', async () => {
    const h = await connected();

    for (let round = 2; round <= 4; round += 1) {
      h.timers.advance(LIFETIME_MS);
      await tick();
      h.transport.lastSend.settle(okAck(h.transport.lastSend.id));
      await tick();
      expect(h.getToken, `round ${round}`).toHaveBeenCalledTimes(round);
    }

    expect(h.controller.state).toBe('connected');
    expect(h.transport.connects).toHaveLength(1);
  });

  it('adopts the new token’s lifetime for the next refresh', async () => {
    const getToken = vi
      .fn(async (): Promise<AuthToken> => ({ token: 'tok_2', expiresInMs: 10_000 }))
      .mockResolvedValueOnce({ token: 'tok_1', expiresInMs: LIFETIME_MS });

    const h = await connected({ token: getToken as unknown as TokenProvider });
    h.timers.advance(LIFETIME_MS);
    await tick();
    h.transport.lastSend.settle(okAck(h.transport.lastSend.id));
    await tick();

    // The second token lives 10s, so the next refresh is due at 8s.
    h.timers.advance(8_000);
    await tick();
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('does not refresh once disconnected', async () => {
    const h = await connected();
    h.controller.disconnect();

    h.timers.advance(10 * 60_000);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(1);
  });

  it('cancels the refresh timer when the socket drops', async () => {
    const h = await connected();
    expect(h.timers.pendingCount).toBe(1);

    h.transport.drop();
    // Only the reconnect timer remains — the refresh belonged to a dead socket.
    expect(h.timers.pendingCount).toBe(1);
    h.timers.advance(500);
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(2); // the reconnect's own fetch
  });
});

// ---------------------------------------------------------------------------
// Reactive refresh
// ---------------------------------------------------------------------------

describe('ConnectionController — reactive refresh (§10.4)', () => {
  it('refreshes on an AUTH_EXPIRED error frame', async () => {
    const h = await connected();
    h.transport.emitFrame(authExpiredFrame());
    await tick();

    expect(h.getToken).toHaveBeenCalledTimes(2);
    expect(h.transport.lastSend.t).toBe('connection.reauth');
    expect(h.controller.state).toBe('connected');
  });

  it('forwards the AUTH_EXPIRED frame down the chain as well', async () => {
    const seen: ServerFrame[] = [];
    const h = await connected({ onFrame: (frame) => seen.push(frame) });
    h.transport.emitFrame(authExpiredFrame());
    await tick();

    expect(seen.filter((f) => f.t === 'error')).toHaveLength(1);
  });

  it('does not refresh on AUTH_INVALID — a rejected credential is not a stale one', async () => {
    const h = await connected();
    h.transport.emitFrame({
      v: 1,
      t: 'error',
      id: 'e',
      ts: 0,
      d: { code: 'AUTH_INVALID', message: 'nope', retryable: false },
    });
    await tick();

    expect(h.getToken).toHaveBeenCalledTimes(1);
  });

  it('runs one refresh at a time when proactive and reactive collide', async () => {
    let release!: (token: AuthToken) => void;
    const getToken = vi
      .fn((): Promise<AuthToken> => new Promise<AuthToken>((resolve) => (release = resolve)))
      .mockResolvedValueOnce({ token: 'tok_1', expiresInMs: LIFETIME_MS });

    const h = await connected({ token: getToken as unknown as TokenProvider });

    h.timers.advance(LIFETIME_MS); // proactive fires, getToken pending
    await tick();
    expect(getToken).toHaveBeenCalledTimes(2);

    h.transport.emitFrame(authExpiredFrame()); // reactive arrives mid-flight
    await tick();
    expect(getToken).toHaveBeenCalledTimes(2);

    release({ token: 'tok_2', expiresInMs: LIFETIME_MS });
    await tick();
    expect(h.transport.sends.filter((s) => s.t === 'connection.reauth')).toHaveLength(1);
  });

  it('ignores an AUTH_EXPIRED frame that arrives when not connected', async () => {
    const h = harness();
    void h.controller.connect();
    await tick();
    h.transport.open(); // authenticating, not connected

    h.transport.emitFrame(authExpiredFrame());
    await tick();
    expect(h.getToken).toHaveBeenCalledTimes(1);
  });

  it('escalates a getToken() failure during refresh through the auth policy', async () => {
    const getToken = vi
      .fn(async (): Promise<AuthToken> => {
        throw new Error('backend down');
      })
      .mockResolvedValueOnce({ token: 'tok_1', expiresInMs: LIFETIME_MS });

    const h = await connected({ token: getToken as unknown as TokenProvider });

    h.transport.emitFrame(authExpiredFrame());
    await tick();
    expect(h.controller.state).toBe('reconnecting');
    expect(h.events).toContain('reconnecting');
  });
});

// ---------------------------------------------------------------------------
// Reconnect fallback (§10.5)
// ---------------------------------------------------------------------------

describe('ConnectionController — reauth fallback (§10.5)', () => {
  it('falls back to a fresh socket when reauth is rejected, transparently', async () => {
    const h = await connected();
    h.timers.advance(LIFETIME_MS);
    await tick();

    h.transport.lastSend.settle({
      status: 'rejected',
      error: { code: 'VALIDATION_FAILED', message: 'reauth unsupported', retryable: false },
    });
    await tick();

    // A new socket, carrying the refreshed token.
    expect(h.transport.connects).toHaveLength(2);
    expect(h.transport.lastConnect.hello.token).toBe('tok_1');
    expect(h.controller.state).toBe('connecting');

    // Transparent: no reconnecting/disconnected event, no attempt counted.
    expect(h.events.filter((e) => e === 'reconnecting')).toHaveLength(0);
    expect(h.events.filter((e) => e === 'disconnected')).toHaveLength(0);
    expect(h.controller.attempt).toBe(0);
  });

  it('falls back the same way on a reauth timeout', async () => {
    const h = await connected();
    h.timers.advance(LIFETIME_MS);
    await tick();

    h.transport.lastSend.settle({ status: 'timeout' });
    await tick();

    expect(h.transport.connects).toHaveLength(2);
    expect(h.events).not.toContain('reconnecting');
  });

  it('drives the fallback socket back to connected, resuming from the same seq', async () => {
    const h = await connected();
    h.transport.emitFrame(ackFrame({ seq: 12 }));
    expect(h.controller.lastAppliedSeq).toBe(12);

    h.timers.advance(LIFETIME_MS);
    await tick();
    h.transport.lastSend.settle({ status: 'timeout' });
    await tick();

    expect(h.transport.lastConnect.hello.resumeFrom).toBe(12);

    h.transport.open();
    expect(h.controller.state).toBe('authenticating');
    h.transport.emitFrame(ackFrame({ seq: 12 }));
    expect(h.controller.state).toBe('connected');
  });

  it('looks identical to the app whichever path was taken (§10.5)', async () => {
    const inPlace = await connected();
    inPlace.timers.advance(LIFETIME_MS);
    await tick();
    inPlace.transport.lastSend.settle(okAck(inPlace.transport.lastSend.id));
    await tick();

    const fallback = await connected();
    fallback.timers.advance(LIFETIME_MS);
    await tick();
    fallback.transport.lastSend.settle({ status: 'timeout' });
    await tick();

    // The whole observable difference: `getToken()` was called again. Same
    // events, in the same order, either way.
    expect(inPlace.events).toEqual(['tokenRefreshed']);
    expect(fallback.events).toEqual(['tokenRefreshed']);
  });

  it('leaves a reauth that raced a real close to the close handler', async () => {
    const h = await connected();
    h.timers.advance(LIFETIME_MS);
    await tick();

    const send = h.transport.lastSend;
    h.transport.drop({ code: CLOSE_CODE.ABNORMAL, reason: 'network gone' });
    send.settle({ status: 'disconnected', close: null });
    await tick();

    // The drop owns the outcome: one reconnect scheduled, not two sockets.
    expect(h.controller.state).toBe('reconnecting');
    expect(h.events).toContain('disconnected');
    expect(h.transport.connects).toHaveLength(1);
  });

  it('reconnects rather than reauthing when the socket is no longer open', async () => {
    const h = await connected();
    h.transport.isOpen = false; // open lost without a close event reaching us yet

    h.timers.advance(LIFETIME_MS);
    await tick();

    expect(h.transport.sends.filter((s) => s.t === 'connection.reauth')).toHaveLength(0);
    expect(h.transport.connects).toHaveLength(2);
  });
});
