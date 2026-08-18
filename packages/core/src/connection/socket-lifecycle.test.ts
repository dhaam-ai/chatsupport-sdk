// The controller driven against the *real* `WebSocketTransport`, over stub
// sockets.
//
// The other test files use `FakeTransport` to interrogate policy. This one
// exists for the questions a fake cannot answer honestly, because they are
// questions about the seam itself: does reconnecting from inside `onClose`
// leave an orphaned socket open, and can a socket the transport has abandoned
// still reach the connection that replaced it. Transport fixed a synchronous
// reconnect bug there twice; this is the layer that would reintroduce it.

import { describe, expect, it } from 'vitest';

import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { ChatStore, createInitialChatState } from '../state/index.js';
import { CLOSE_CODE, StubSocketFactory, silentLogger } from '../transport/index.js';
import type { StubWebSocket } from '../transport/index.js';
import { ConnectionController } from './controller.js';
import { createWebSocketTransportFactory } from './types.js';
import type { AuthToken, ConnectionControllerOptions, TokenProvider } from './types.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A distinct, valid ULID per call.
 *
 * The envelope `id` is ULID-validated (protocol/validate.ts), and a frame that
 * fails validation is dropped by the transport before it ever reaches this
 * layer — so a fixture with a placeholder id silently tests nothing.
 */
function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

const SESSION_SNAPSHOT: SessionSnapshot = {
  sessionId: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [],
  createdAt: '2026-08-17T00:00:00.000Z',
};

function ackPayload(overrides: Partial<ConnectionAckPayload> = {}): ConnectionAckPayload {
  return { protocolVersion: 1, session: SESSION_SNAPSHOT, seq: 0, ...overrides };
}

function ackJson(overrides: Partial<ConnectionAckPayload> = {}): unknown {
  return { v: 1, t: 'connection.ack', id: ulid(1), ts: 0, d: ackPayload(overrides) };
}

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly controller: ConnectionController;
  readonly sockets: StubSocketFactory;
}

function harness(
  overrides: Partial<ConnectionControllerOptions> & { token?: TokenProvider } = {},
): Harness {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const timers = new ManualTimers();
  const sockets = new StubSocketFactory();

  const { token, ...rest } = overrides;
  const controller = new ConnectionController({
    store,
    url: 'wss://example.test/chat-services/v2/ws',
    publishableKey: 'dhpk_test_1',
    getToken: token ?? ((async () => 'tok_abc') as TokenProvider),
    schedule: timers.schedule,
    transportBackoff: new TransportBackoffPolicy({ random: () => 1 }),
    authBackoff: new AuthBackoffPolicy({ random: () => 1 }),
    createTransport: createWebSocketTransportFactory({
      webSocket: sockets.create,
      schedule: timers.schedule,
      now: timers.clock,
      logger: silentLogger,
      // Liveness is transport's own concern and has its own tests; pushed out
      // of the way so advancing the clock for a backoff delay does not trip a
      // heartbeat timeout mid-assertion.
      heartbeatIntervalMs: 10 * 60_000,
      heartbeatTimeoutMs: 10 * 60_000,
    }),
    ...rest,
  });

  return { store, timers, controller, sockets };
}

/** The `t` of every frame a socket has written. */
function sentTypes(socket: StubWebSocket): string[] {
  return socket.sentFrames().map((frame) => (frame as { t: string }).t);
}

function helloOf(socket: StubWebSocket): Record<string, unknown> {
  const hello = socket.sentFrames().find((frame) => (frame as { t: string }).t === 'connection.hello');
  if (hello === undefined) throw new Error('no connection.hello was written');
  return (hello as { d: Record<string, unknown> }).d;
}

/** Opens the newest socket and acks it. */
function goLive(h: Harness, ack: Partial<ConnectionAckPayload> = {}): void {
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson(ack));
}

async function connected(overrides: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(overrides);
  const promise = h.controller.connect();
  await tick();
  goLive(h);
  await promise;
  return h;
}

// ---------------------------------------------------------------------------

describe('ConnectionController over the real transport', () => {
  it('writes connection.hello on open and reaches connected on the ack', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();

    expect(h.sockets.sockets).toHaveLength(1);
    expect(h.sockets.last.url).toBe('wss://example.test/chat-services/v2/ws');
    expect(h.controller.state).toBe('connecting');

    h.sockets.last.open();
    expect(sentTypes(h.sockets.last)).toEqual(['connection.hello']);
    expect(helloOf(h.sockets.last)).toMatchObject({
      token: 'tok_abc',
      publishableKey: 'dhpk_test_1',
      protocolVersion: 1,
    });
    expect(h.controller.state).toBe('authenticating');

    h.sockets.last.emitJson(ackJson());
    await expect(promise).resolves.toBeUndefined();
    expect(h.controller.state).toBe('connected');
  });

  it('omits resumeFrom on the first hello and includes it on the next', async () => {
    const h = await connected({ token: (async () => 'tok_abc') as TokenProvider });
    expect(helloOf(h.sockets.sockets[0] as StubWebSocket)).not.toHaveProperty('resumeFrom');

    h.sockets.last.emitJson({
      v: 1,
      t: 'message.new',
      id: ulid(3),
      ts: 0,
      d: {
        id: ulid(11),
        sessionId: 'sess_1',
        senderId: 'a',
        senderType: 'AGENT',
        type: 'TEXT',
        content: 'hi',
        seq: 7,
        createdAt: '2026-08-17T00:00:00.000Z',
      },
    });

    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
    h.timers.advance(500);
    await tick();

    h.sockets.last.open();
    expect(helloOf(h.sockets.last)).toMatchObject({ resumeFrom: 7 });
  });
});

// ---------------------------------------------------------------------------
// Reconnecting from inside onClose
// ---------------------------------------------------------------------------

describe('reconnect from onClose', () => {
  it('creates exactly one replacement socket, and not from inside the close', async () => {
    const h = await connected();
    const first = h.sockets.last;

    first.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: 'gone', wasClean: false });

    // The close returned before any replacement exists — the reconnect is on a
    // timer, never inline.
    expect(h.sockets.sockets).toHaveLength(1);
    expect(h.controller.state).toBe('reconnecting');

    h.timers.advance(500);
    await tick();

    expect(h.sockets.sockets).toHaveLength(2);
    expect(h.sockets.last).not.toBe(first);
  });

  it('detaches the closed socket so it cannot reach the replacement', async () => {
    const h = await connected();
    const first = h.sockets.last;

    first.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
    h.timers.advance(500);
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson({ seq: 3 }));
    expect(h.controller.state).toBe('connected');

    // Every handler on the abandoned socket is gone.
    expect(first.onopen).toBeNull();
    expect(first.onmessage).toBeNull();
    expect(first.onclose).toBeNull();
    expect(first.onerror).toBeNull();

    // And driving it anyway changes nothing.
    first.open();
    first.emitJson(ackJson({ seq: 99 }));
    first.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });

    expect(h.controller.state).toBe('connected');
    expect(h.controller.lastAppliedSeq).toBe(3);
    expect(h.sockets.sockets).toHaveLength(2);
  });

  it('does not orphan the superseded socket on a transparent reconnect', async () => {
    const h = await connected({
      token: (async (): Promise<AuthToken> => ({ token: 'tok_abc', expiresInMs: 10_000 })) as TokenProvider,
    });
    const first = h.sockets.last;

    // Proactive refresh at 80% -> connection.reauth on the live socket.
    h.timers.advance(8_000);
    await tick();
    expect(sentTypes(first)).toContain('connection.reauth');

    // Reject it, forcing §10.5's reconnect fallback while the socket is open.
    const reauth = first.sentFrames().find((f) => (f as { t: string }).t === 'connection.reauth');
    first.emitJson({
      v: 1,
      t: 'ack',
      id: ulid(6),
      ref: (reauth as { id: string }).id,
      ts: 0,
      d: { ok: false, error: { code: 'VALIDATION_FAILED', message: 'no', retryable: false } },
    });
    await tick();

    // The superseded socket was actually asked to close — left open it would
    // stay authenticated server-side until the liveness reaper collected it.
    expect(first.closeCalls).toHaveLength(1);
    expect(h.sockets.sockets).toHaveLength(2);
    expect(h.controller.state).toBe('connecting');

    // The supersede's own `local` close did not schedule a retry or count an
    // attempt: the reconnect this call is performing is the only one in flight.
    expect(h.timers.pendingCount).toBe(0);
    expect(h.controller.attempt).toBe(0);

    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson());
    expect(h.controller.state).toBe('connected');
  });

  it('survives a hundred drop/retry cycles without accumulating sockets', async () => {
    const h = await connected();

    for (let i = 0; i < 100; i += 1) {
      h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
      h.timers.advance(60_000);
      await tick();
      h.sockets.last.open();
    }

    // Exactly one socket per attempt — never two, never a leftover.
    expect(h.sockets.sockets).toHaveLength(101);

    // And every socket but the live one is fully detached.
    for (const socket of h.sockets.sockets.slice(0, -1)) {
      expect(socket.onmessage).toBeNull();
      expect(socket.onclose).toBeNull();
    }
  });

  it('closes the live socket exactly once on disconnect()', async () => {
    const h = await connected();
    const socket = h.sockets.last;

    h.controller.disconnect();
    expect(socket.closeCalls).toHaveLength(1);
    expect(h.controller.state).toBe('closed');

    // The peer's eventual close frame arrives at a detached socket.
    socket.emitClose({ code: CLOSE_CODE.NORMAL });
    h.timers.advance(60_000);
    await tick();

    expect(h.controller.state).toBe('closed');
    expect(h.sockets.sockets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Close codes, end to end
// ---------------------------------------------------------------------------

describe('close-code handling over the real transport', () => {
  it('suspends on an error frame + close that the transport marks versionUnsupported (§7.5)', async () => {
    const h = harness();
    const promise = h.controller.connect();
    await tick();
    h.sockets.last.open();

    // Exactly what the real server does: a ref-less `error`, then 1008.
    h.sockets.last.emitJson({
      v: 1,
      t: 'error',
      id: ulid(2),
      ts: 0,
      d: {
        code: 'PROTOCOL_VERSION_UNSUPPORTED',
        message: 'server requires protocol v2',
        retryable: false,
      },
    });
    h.sockets.last.emitClose({ code: CLOSE_CODE.POLICY_VIOLATION, reason: 'policy', wasClean: true });

    expect(h.controller.state).toBe('suspended');
    expect(h.store.getState().lastError?.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
    await expect(promise).rejects.toThrow(/suspended/i);

    h.timers.advance(10 * 60_000);
    await tick();
    expect(h.sockets.sockets).toHaveLength(1);
  });

  it('backs off rather than retrying hot on 1013', async () => {
    const h = await connected();
    const delays: number[] = [];
    h.store.on('reconnecting', (payload) => delays.push(payload.delayMs));

    h.sockets.last.emitClose({
      code: CLOSE_CODE.TRY_AGAIN_LATER,
      reason: 'backpressure',
      wasClean: true,
    });

    expect(delays).toEqual([1000]);
    expect(h.sockets.sockets).toHaveLength(1);

    h.timers.advance(999);
    await tick();
    expect(h.sockets.sockets).toHaveLength(1);

    h.timers.advance(1);
    await tick();
    expect(h.sockets.sockets).toHaveLength(2);
  });

  it('escalates a 1008 whose preceding error frame was AUTH_INVALID', async () => {
    const h = await connected();

    h.sockets.last.emitJson({
      v: 1,
      t: 'error',
      id: ulid(2),
      ts: 0,
      d: { code: 'AUTH_INVALID', message: 'bad token', retryable: false },
    });
    h.sockets.last.emitClose({ code: CLOSE_CODE.POLICY_VIOLATION, reason: 'policy', wasClean: true });

    // Retryable close, but the credential is the problem: the auth policy owns
    // it, not the transport one.
    expect(h.controller.state).toBe('reconnecting');
    expect(h.store.getState().lastError?.code).toBe('AUTH_INVALID');
  });

  it('retries a ref-less VALIDATION_FAILED rather than treating it as fatal', async () => {
    const h = await connected();

    h.sockets.last.emitJson({
      v: 1,
      t: 'error',
      id: ulid(2),
      ts: 0,
      d: { code: 'VALIDATION_FAILED', message: 'bad frame', retryable: false },
    });
    h.sockets.last.emitClose({ code: CLOSE_CODE.POLICY_VIOLATION, wasClean: true });

    expect(h.controller.state).toBe('reconnecting');

    h.timers.advance(500);
    await tick();
    expect(h.sockets.sockets).toHaveLength(2);
  });

  it('applies replay delivered over the wire, in order', async () => {
    const h = await connected();
    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
    h.timers.advance(500);
    await tick();
    h.sockets.last.open();

    h.sockets.last.emitJson(
      ackJson({
        seq: 3,
        replay: [
          {
            v: 1,
            t: 'message.new',
            id: ulid(4),
            ts: 0,
            d: {
              id: ulid(12),
              sessionId: 'sess_1',
              senderId: 'a',
              senderType: 'AGENT',
              type: 'TEXT',
              content: 'two',
              seq: 2,
              createdAt: '2026-08-17T00:00:00.000Z',
            },
          },
          {
            v: 1,
            t: 'message.new',
            id: ulid(5),
            ts: 0,
            d: {
              id: ulid(13),
              sessionId: 'sess_1',
              senderId: 'a',
              senderType: 'AGENT',
              type: 'TEXT',
              content: 'three',
              seq: 3,
              createdAt: '2026-08-17T00:00:00.000Z',
            },
          },
        ],
      }),
    );

    expect(h.controller.state).toBe('connected');
    expect(h.controller.lastAppliedSeq).toBe(3);
  });
});
