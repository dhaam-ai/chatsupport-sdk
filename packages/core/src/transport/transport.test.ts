import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualTimers } from '../presence/manual-timers.js';
import { isValidUlid } from '../protocol/validate.js';
import type { ServerFrame } from '../protocol/frames.js';
import type { TransportCloseInfo } from './close.js';
import type { AckOutcome } from './pending-acks.js';
import { CLOSE_CODE } from './socket.js';
import { StubSocketFactory } from './stub-socket.js';
import type { TransportLogger } from './logger.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, WebSocketTransport } from './transport.js';
import type { WebSocketTransportOptions } from './transport.js';

const URL = 'wss://example.test/chat-services/v2/ws';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SUPER_SECRET_TOKEN_BODY.sig';
const HELLO = { token: TOKEN, publishableKey: 'dhp_live_abc123' };
const SERVER_ID = '01J0000000000000000000000Z';

interface LoggedWarning {
  readonly message: string;
  readonly context: Record<string, unknown> | undefined;
}

interface Harness {
  readonly transport: WebSocketTransport;
  readonly factory: StubSocketFactory;
  readonly timers: ManualTimers;
  readonly warnings: LoggedWarning[];
  readonly frames: ServerFrame[];
  readonly closes: TransportCloseInfo[];
  readonly opens: number[];
  /** Opens the socket and lets the hello go out. */
  connect(): void;
  /** Completes the handshake, which is what starts the heartbeat. */
  handshake(): void;
}

function harness(overrides: WebSocketTransportOptions = {}): Harness {
  const factory = new StubSocketFactory();
  const timers = new ManualTimers();
  const warnings: LoggedWarning[] = [];
  const frames: ServerFrame[] = [];
  const closes: TransportCloseInfo[] = [];
  const opens: number[] = [];

  const logger: TransportLogger = {
    warn: (message, context) => warnings.push({ message, context }),
  };

  const transport = new WebSocketTransport({
    webSocket: factory.create,
    schedule: timers.schedule,
    now: timers.clock,
    logger,
    onOpen: () => opens.push(opens.length),
    onFrame: (frame) => frames.push(frame),
    onClose: (info) => closes.push(info),
    ...overrides,
  });

  const api: Harness = {
    transport,
    factory,
    timers,
    warnings,
    frames,
    closes,
    opens,
    connect(): void {
      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
    },
    handshake(): void {
      api.connect();
      factory.last.emitJson(connectionAck());
    },
  };

  return api;
}

function connectionAck(protocolVersion = 1): unknown {
  return {
    v: 1,
    t: 'connection.ack',
    id: SERVER_ID,
    ts: 1,
    d: {
      protocolVersion,
      seq: 0,
      session: {
        sessionId: 's1',
        status: 'OPEN',
        mode: 'BOT',
        participants: [],
        createdAt: '2026-08-18T00:00:00Z',
      },
    },
  };
}

function ack(ref: string, d: Record<string, unknown> = { ok: true }): unknown {
  return { v: 1, t: 'ack', id: SERVER_ID, ref, ts: 1, d };
}

function errorFrame(
  code: string,
  options: { ref?: string; retryable?: boolean } = {},
): unknown {
  return {
    v: 1,
    t: 'error',
    id: SERVER_ID,
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ts: 1,
    d: { code, message: 'server said so', retryable: options.retryable ?? false },
  };
}

/** Lets queued microtasks run so ack promises settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebSocketTransport', () => {
  describe('construction', () => {
    // SSR / import safety: nothing may touch the WebSocket global until connect.
    it('does not touch the WebSocket global when no factory is injected', () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
      Reflect.deleteProperty(globalThis, 'WebSocket');

      try {
        expect(() => new WebSocketTransport()).not.toThrow();
      } finally {
        if (descriptor) Object.defineProperty(globalThis, 'WebSocket', descriptor);
      }
    });

    it('starts closed with nothing pending and no negotiated version', () => {
      const { transport } = harness();

      expect(transport.isOpen).toBe(false);
      expect(transport.pendingAckCount).toBe(0);
      expect(transport.negotiatedProtocolVersion).toBeNull();
    });
  });

  describe('opening', () => {
    it('opens the socket at the given url', () => {
      const { transport, factory } = harness();

      transport.connect({ url: URL, hello: HELLO });

      expect(factory.sockets).toHaveLength(1);
      expect(factory.last.url).toBe(URL);
    });

    it('does not report open until the socket opens', () => {
      const { transport, opens } = harness();

      transport.connect({ url: URL, hello: HELLO });

      expect(opens).toHaveLength(0);
      expect(transport.isOpen).toBe(false);
    });

    it('writes connection.hello as the very first frame', () => {
      const { connect, factory } = harness();

      connect();

      expect(factory.last.sent).toHaveLength(1);
      expect(factory.last.lastSentFrame()).toMatchObject({
        v: 1,
        t: 'connection.hello',
        d: { token: TOKEN, publishableKey: 'dhp_live_abc123', protocolVersion: 1 },
      });
    });

    // One signal means "socket open AND hello written" — T8's single
    // connecting → authenticating edge.
    it('reports open only after hello has been written', () => {
      const order: string[] = [];
      const factory = new StubSocketFactory();
      const transport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: new ManualTimers().schedule,
        onOpen: () => order.push(`open:${String(factory.last.sent.length)}`),
      });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();

      expect(order).toEqual(['open:1']);
      expect(transport.isOpen).toBe(true);
    });

    it('stamps a valid ULID, the protocol version and a clock reading', () => {
      const { connect, factory } = harness();

      connect();
      const frame = factory.last.lastSentFrame() as Record<string, unknown>;

      expect(isValidUlid(frame['id'])).toBe(true);
      expect(frame['v']).toBe(1);
      expect(typeof frame['ts']).toBe('number');
    });

    it('honours a configured protocol version', () => {
      const { connect, factory } = harness({ protocolVersion: 3 });

      connect();

      expect(factory.last.lastSentFrame()).toMatchObject({ v: 3, d: { protocolVersion: 3 } });
    });

    it('forwards an optional resumeFrom cursor', () => {
      const { transport, factory } = harness();

      transport.connect({ url: URL, hello: { ...HELLO, resumeFrom: 42 } });
      factory.last.open();

      expect(factory.last.lastSentFrame()).toMatchObject({ d: { resumeFrom: 42 } });
    });

    it('closes rather than reporting open when hello cannot be written', () => {
      const { transport, factory, opens, closes } = harness();

      transport.connect({ url: URL, hello: HELLO });
      factory.last.sendError = new Error('socket already closing');
      factory.last.open();

      expect(opens).toHaveLength(0);
      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
    });
  });

  describe('reconnecting over an existing connection', () => {
    it('opens a second socket', () => {
      const { transport, connect, factory } = harness();

      connect();
      transport.connect({ url: URL, hello: HELLO });

      expect(factory.sockets).toHaveLength(2);
    });

    it('reports the previous connection closed rather than abandoning it', () => {
      const { transport, connect, closes, factory } = harness();

      connect();
      const superseded = factory.sockets[0];
      transport.connect({ url: URL, hello: HELLO });

      expect(closes).toHaveLength(1);
      expect(closes[0]?.cause).toBe('local');

      // The close *event* firing is only our own bookkeeping. Without this
      // assertion the test passed while the socket was never told to close --
      // it stayed open and authenticated server-side until the peer's liveness
      // reaper collected it, and T8 reconnects through this path every time.
      expect(superseded?.closeCalls.length).toBeGreaterThan(0);
    });

    it('settles the previous connection pending acks', async () => {
      const { transport, connect, factory } = harness();
      connect();
      const pending = transport.send('typing.start', {});

      transport.connect({ url: URL, hello: HELLO });

      await expect(pending.ack).resolves.toMatchObject({ status: 'disconnected' });
      expect(transport.pendingAckCount).toBe(0);
      expect(factory.sockets).toHaveLength(2);
    });

    // Reconnect-on-close is exactly what T8 does. Backoff makes it async in
    // practice, but a zero delay or a test driving it directly re-enters
    // `connect` from inside `onClose` — at which point the outer call installs
    // a second socket over the inner one. A late event from the socket left
    // behind must not be able to tear down the live connection.
    it('survives a synchronous reconnect from inside onClose', () => {
      const factory = new StubSocketFactory();
      const timers = new ManualTimers();
      let reconnected = false;

      const transport: WebSocketTransport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: timers.schedule,
        onClose: () => {
          if (reconnected) return;
          reconnected = true;
          transport.connect({ url: URL, hello: HELLO });
        },
      });

      transport.connect({ url: URL, hello: HELLO });
      const first = factory.last;
      first.open();

      transport.connect({ url: URL, hello: HELLO });
      const live = factory.last;
      live.open();
      expect(transport.isOpen).toBe(true);

      for (const orphan of factory.sockets) {
        if (orphan === live) continue;
        orphan.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
      }

      expect(transport.isOpen).toBe(true);
    });

    it('closes a socket displaced by a re-entrant connect rather than leaking it', () => {
      const factory = new StubSocketFactory();
      const timers = new ManualTimers();
      let reconnected = false;

      const transport: WebSocketTransport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: timers.schedule,
        onClose: () => {
          if (reconnected) return;
          reconnected = true;
          transport.connect({ url: URL, hello: HELLO });
        },
      });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
      transport.connect({ url: URL, hello: HELLO });

      const live = factory.last;
      const orphans = factory.sockets.slice(1, -1);

      expect(orphans.length).toBeGreaterThan(0);
      expect(orphans.every((s) => s.closeCalls.length > 0)).toBe(true);
      expect(live.closeCalls).toHaveLength(0);
    });

    it('is left socket-less when the factory throws', () => {
      const factory = new StubSocketFactory();
      const closes: TransportCloseInfo[] = [];
      let fail = false;

      const transport = new WebSocketTransport({
        webSocket: (url) => {
          if (fail) throw new Error('no WebSocket here');
          return factory.create(url);
        },
        schedule: new ManualTimers().schedule,
        onClose: (info) => closes.push(info),
      });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();

      fail = true;
      expect(() => transport.connect({ url: URL, hello: HELLO })).toThrow(/no WebSocket here/);

      // One close for the connection that was superseded, and no second one
      // from a handle the failed attempt might otherwise have left behind.
      expect(closes).toHaveLength(1);
      transport.close();
      expect(closes).toHaveLength(1);
      expect(transport.isOpen).toBe(false);
    });

    it('clears the negotiated version', () => {
      const { transport, handshake } = harness();
      handshake();
      expect(transport.negotiatedProtocolVersion).toBe(1);

      transport.connect({ url: URL, hello: HELLO });

      expect(transport.negotiatedProtocolVersion).toBeNull();
    });
  });

  describe('sending', () => {
    it('returns the envelope ULID synchronously, before any ack', () => {
      const { transport, handshake } = harness();
      handshake();

      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      expect(isValidUlid(sent.id)).toBe(true);
    });

    // D1: the envelope id IS the permanent message id, and the server dedupes
    // replays on it.
    it('uses the returned id as the frame envelope id', () => {
      const { transport, handshake, factory } = harness();
      handshake();

      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      expect(factory.last.lastSentFrame()).toMatchObject({ t: 'message.send', id: sent.id });
    });

    it('round-trips the payload verbatim', () => {
      const { transport, handshake, factory } = harness();
      handshake();

      transport.send('message.send', {
        content: 'hello world',
        type: 'TEXT',
        replyToMessageId: 'm1',
        metadata: { source: 'web' },
      });

      expect(factory.last.lastSentFrame()).toMatchObject({
        v: 1,
        t: 'message.send',
        d: { content: 'hello world', type: 'TEXT', replyToMessageId: 'm1', metadata: { source: 'web' } },
      });
    });

    it('sends an empty payload object for payload-less frames', () => {
      const { transport, handshake, factory } = harness();
      handshake();

      transport.send('session.leave', {});

      // The server requires `d` to be an object even here — omitting it is a
      // validation failure, not a shorthand.
      expect(factory.last.lastSentFrame()).toMatchObject({ t: 'session.leave', d: {} });
    });

    it('mints strictly increasing ids for a burst in one tick', () => {
      const { transport, handshake } = harness();
      handshake();

      const ids = Array.from({ length: 20 }, () =>
        transport.send('message.send', { content: 'x', type: 'TEXT' }).id,
      );

      expect(new Set(ids).size).toBe(20);
      expect([...ids].sort()).toEqual(ids);
    });

    it('tracks the frame as pending', () => {
      const { transport, handshake } = harness();
      handshake();

      transport.send('presence.query', {});

      expect(transport.pendingAckCount).toBe(1);
    });

    it('resolves disconnected without writing when there is no socket', async () => {
      const { transport, factory } = harness();

      const sent = transport.send('typing.start', {});

      expect(factory.sockets).toHaveLength(0);
      await expect(sent.ack).resolves.toEqual({ status: 'disconnected', close: null });
      expect(transport.pendingAckCount).toBe(0);
    });

    it('resolves disconnected when the socket is open but the write throws', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      factory.last.sendError = new Error('socket is closing');

      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      // Unsent, not rejected — §8.4 routes it to the offline queue for replay.
      await expect(sent.ack).resolves.toEqual({ status: 'disconnected', close: null });
    });

    it('rejects a payload that cannot be serialized', async () => {
      const { transport, handshake, warnings } = harness();
      handshake();

      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      const sent = transport.send('message.send', {
        content: 'hi',
        type: 'TEXT',
        metadata: circular as never,
      });

      await expect(sent.ack).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'VALIDATION_FAILED', retryable: false },
      });
      expect(warnings.some((w) => w.message.includes('could not be serialized'))).toBe(true);
    });
  });

  describe('ack correlation', () => {
    it('resolves acked and carries the extra data through', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      factory.last.emitJson(ack(sent.id, { ok: true, seq: 13 }));

      const outcome = (await sent.ack) as Extract<AckOutcome, { status: 'acked' }>;
      expect(outcome.status).toBe('acked');
      expect(outcome.frame.d).toEqual({ ok: true, seq: 13 });
      expect(transport.pendingAckCount).toBe(0);
    });

    it('resolves rejected on an ack with ok false', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      const sent = transport.send('session.join', { sessionId: 's1' });

      factory.last.emitJson(
        ack(sent.id, {
          ok: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'gone', retryable: false },
        }),
      );

      await expect(sent.ack).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'SESSION_NOT_FOUND' },
      });
    });

    // The server answers business failures with a rejecting ack but protocol
    // failures with an `error` frame. Missing this path hangs the send.
    it('resolves rejected on an error frame bearing the frame ref', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      factory.last.emitJson(errorFrame('VALIDATION_FAILED', { ref: sent.id }));

      await expect(sent.ack).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it('correlates each ack to its own frame', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      const first = transport.send('message.send', { content: 'one', type: 'TEXT' });
      const second = transport.send('message.send', { content: 'two', type: 'TEXT' });

      factory.last.emitJson(ack(second.id, { ok: true, seq: 2 }));

      await expect(second.ack).resolves.toMatchObject({ status: 'acked' });
      expect(transport.pendingAckCount).toBe(1);

      factory.last.emitJson(ack(first.id, { ok: true, seq: 1 }));
      await expect(first.ack).resolves.toMatchObject({ status: 'acked' });
    });

    // Correlation is this layer's job; the outcome carries the whole frame.
    it('does not forward ack frames to onFrame', async () => {
      const { transport, handshake, factory, frames } = harness();
      handshake();
      const sent = transport.send('presence.set', { status: 'ONLINE' });

      factory.last.emitJson(ack(sent.id));
      await flush();

      expect(frames.map((f) => f.t)).not.toContain('ack');
    });

    it('warns about an ack that correlates to nothing', () => {
      const { handshake, factory, warnings } = harness();
      handshake();

      factory.last.emitJson(ack('01J000000000000000000000AA'));

      expect(warnings.some((w) => w.message.includes('ack for an unknown frame'))).toBe(true);
    });

    it('times out a frame nothing answers', async () => {
      const { transport, handshake, timers } = harness({ ackTimeoutMs: 10_000 });
      handshake();
      const sent = transport.send('message.markRead', {});

      timers.advance(9_999);
      expect(transport.pendingAckCount).toBe(1);

      timers.advance(1);

      await expect(sent.ack).resolves.toEqual({ status: 'timeout' });
      expect(transport.pendingAckCount).toBe(0);
    });
  });

  describe('malformed inbound frames', () => {
    it('drops them with a logged warning and keeps the connection alive', () => {
      const { transport, handshake, factory, warnings, frames, closes } = harness();
      handshake();
      const before = frames.length;

      factory.last.emitMessage('not json at all');
      factory.last.emitJson({ v: 1, t: 'message.telepathy', id: SERVER_ID, ts: 1, d: {} });
      factory.last.emitJson({ v: 1, t: 'system.pong', id: 'not-a-ulid', ts: 1, d: {} });
      factory.last.emitMessage(new ArrayBuffer(8));

      expect(warnings.filter((w) => w.message.includes('malformed inbound frame'))).toHaveLength(4);
      expect(frames).toHaveLength(before);
      expect(closes).toHaveLength(0);
      expect(transport.isOpen).toBe(true);
      expect(factory.last.closeCalls).toHaveLength(0);
    });

    it('keeps working after a malformed frame', async () => {
      const { transport, handshake, factory } = harness();
      handshake();

      factory.last.emitMessage('{{{');
      const sent = transport.send('message.send', { content: 'still here', type: 'TEXT' });
      factory.last.emitJson(ack(sent.id, { ok: true, seq: 1 }));

      await expect(sent.ack).resolves.toMatchObject({ status: 'acked' });
    });

    it('rejects a client-only frame type arriving from the server', () => {
      const { handshake, factory, warnings, frames } = harness();
      handshake();
      const before = frames.length;

      factory.last.emitJson({
        v: 1,
        t: 'connection.hello',
        id: SERVER_ID,
        ts: 1,
        d: { token: 'x', publishableKey: 'y', protocolVersion: 1 },
      });

      expect(frames).toHaveLength(before);
      expect(warnings.some((w) => w.context?.['reason'] === '"connection.hello" is a client→server frame type')).toBe(true);
    });

    it('logs the failing path and reason but never the payload', () => {
      const { handshake, factory, warnings } = harness();
      handshake();

      factory.last.emitJson({
        v: 1,
        t: 'message.new',
        id: SERVER_ID,
        ts: 1,
        d: {
          id: '01J000000000000000000000AA',
          sessionId: 's1',
          senderId: 'u1',
          senderType: 'AGENT',
          type: 'TEXT',
          content: 'a secret message',
          createdAt: '2026-08-18T00:00:00Z',
          seq: 'nope',
        },
      });

      const warning = warnings.find((w) => w.message.includes('malformed inbound frame'));
      expect(warning?.context).toMatchObject({ t: 'message.new', path: 'd.seq' });
      expect(JSON.stringify(warning)).not.toContain('a secret message');
    });
  });

  describe('never logging credentials', () => {
    // PRD §14. v1 logged token prefixes and lengths; neither appears here.
    it('keeps the token out of every log line, even when everything fails', () => {
      const { transport, factory, warnings, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
      factory.last.emitMessage('garbage');
      factory.last.emitError();
      factory.last.sendError = new Error('dead');
      transport.send('message.send', { content: 'hi', type: 'TEXT' });
      timers.advance(60_000);
      factory.last.emitClose({ code: CLOSE_CODE.POLICY_VIOLATION, reason: 'authentication failed' });

      const serialized = JSON.stringify(warnings);
      expect(warnings.length).toBeGreaterThan(0);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain('SUPER_SECRET');
      expect(serialized).not.toContain('dhp_live_abc123');
      expect(serialized).not.toContain(TOKEN.slice(0, 8));
      expect(serialized).not.toContain(String(TOKEN.length));
    });
  });

  describe('inbound frame delivery', () => {
    it('forwards every valid push frame', () => {
      const { handshake, factory, frames } = harness();
      handshake();

      factory.last.emitJson({
        v: 1,
        t: 'message.new',
        id: SERVER_ID,
        ts: 1,
        d: {
          id: '01J000000000000000000000AA',
          sessionId: 's1',
          senderId: 'u1',
          senderType: 'AGENT',
          type: 'TEXT',
          content: 'hello',
          seq: 7,
          createdAt: '2026-08-18T00:00:00Z',
        },
      });

      expect(frames.map((f) => f.t)).toEqual(['connection.ack', 'message.new']);
    });

    it('forwards error frames so T8 can act on them', () => {
      const { handshake, factory, frames } = harness();
      handshake();

      factory.last.emitJson(errorFrame('RATE_LIMITED', { retryable: true }));

      expect(frames.map((f) => f.t)).toContain('error');
    });

    it('forwards system.pong as well as feeding the heartbeat', () => {
      const { handshake, factory, frames } = harness();
      handshake();

      factory.last.emitJson({ v: 1, t: 'system.pong', id: SERVER_ID, ts: 1, d: {} });

      expect(frames.map((f) => f.t)).toContain('system.pong');
    });
  });

  describe('protocol version negotiation', () => {
    it('records the negotiated version from connection.ack', () => {
      const { transport, connect, factory } = harness({ protocolVersion: 4 });
      connect();

      factory.last.emitJson(connectionAck(2));

      // min(client max, server max) — computed server-side, reported here.
      expect(transport.negotiatedProtocolVersion).toBe(2);
    });

    // §7.5: T8 must go to `suspended`, not retry-loop against a version it
    // cannot speak.
    it('marks the close non-retryable on PROTOCOL_VERSION_UNSUPPORTED', () => {
      const { connect, factory, closes } = harness();
      connect();
      const helloId = (factory.last.lastSentFrame() as { id: string }).id;

      // The real server sends the error with ref = the hello frame id, then
      // closes with 1008.
      factory.last.emitJson(errorFrame('PROTOCOL_VERSION_UNSUPPORTED', { ref: helloId }));
      factory.last.emitClose({
        code: CLOSE_CODE.POLICY_VIOLATION,
        reason: 'protocol version unsupported',
      });

      expect(closes[0]).toMatchObject({
        cause: 'versionUnsupported',
        retryable: false,
        code: CLOSE_CODE.POLICY_VIOLATION,
        protocolError: { code: 'PROTOCOL_VERSION_UNSUPPORTED' },
      });
    });

    it('handles the same error arriving with no ref', () => {
      const { connect, factory, closes } = harness();
      connect();

      factory.last.emitJson(errorFrame('PROTOCOL_VERSION_UNSUPPORTED'));
      factory.last.emitClose({ code: CLOSE_CODE.POLICY_VIOLATION });

      expect(closes[0]).toMatchObject({ cause: 'versionUnsupported', retryable: false });
    });

    // A rejected frame is not a dead session — only a version mismatch is.
    it('does not suspend on a non-retryable error about one frame', async () => {
      const { transport, handshake, factory, closes } = harness();
      handshake();
      const sent = transport.send('session.join', { sessionId: 'nope' });

      factory.last.emitJson(errorFrame('SESSION_NOT_FOUND', { ref: sent.id }));
      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });

      await expect(sent.ack).resolves.toMatchObject({ status: 'rejected' });
      expect(closes[0]).toMatchObject({ cause: 'peer', retryable: true, protocolError: null });
    });

    // 1008 covers five distinct server conditions with one reason string.
    it('carries an auth error forward so 1008 can be disambiguated', () => {
      const { connect, factory, closes } = harness();
      connect();

      factory.last.emitJson(errorFrame('AUTH_EXPIRED', { retryable: true }));
      factory.last.emitClose({
        code: CLOSE_CODE.POLICY_VIOLATION,
        reason: 'authentication failed',
      });

      expect(closes[0]).toMatchObject({
        code: 1008,
        retryable: true,
        protocolError: { code: 'AUTH_EXPIRED' },
      });
    });
  });

  describe('heartbeat', () => {
    // The server rejects `system.heartbeat` from an unauthenticated
    // connection, so beating before the ack would manufacture AUTH_INVALID.
    it('does not beat before the handshake completes', () => {
      const { connect, factory, timers } = harness({ heartbeatIntervalMs: 25_000 });
      connect();

      timers.advance(120_000);

      expect(factory.last.sentFrames().filter((f) => (f as { t: string }).t === 'system.heartbeat')).toHaveLength(0);
    });

    it('beats once the handshake completes', () => {
      const { handshake, factory, timers } = harness({ heartbeatIntervalMs: 25_000 });
      handshake();

      timers.advance(25_000);

      expect(factory.last.lastSentFrame()).toMatchObject({ t: 'system.heartbeat', d: {} });
    });

    it('keeps beating while pongs arrive', () => {
      const { handshake, factory, timers } = harness({
        heartbeatIntervalMs: 25_000,
        heartbeatTimeoutMs: 10_000,
      });
      handshake();

      for (let i = 0; i < 3; i += 1) {
        timers.advance(25_000);
        factory.last.emitJson({ v: 1, t: 'system.pong', id: SERVER_ID, ts: 1, d: {} });
      }

      const beats = factory.last.sentFrames().filter((f) => (f as { t: string }).t === 'system.heartbeat');
      expect(beats).toHaveLength(3);
    });

    it('detects a silent peer and closes with 1006', () => {
      const { transport, handshake, factory, closes, timers } = harness({
        heartbeatIntervalMs: 25_000,
        heartbeatTimeoutMs: 10_000,
      });
      handshake();

      timers.advance(35_000);

      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({
        cause: 'heartbeatTimeout',
        code: CLOSE_CODE.ABNORMAL,
        wasClean: false,
        retryable: true,
      });
      expect(transport.isOpen).toBe(false);
      expect(factory.last.closeCalls).toHaveLength(1);
    });

    // A dead peer very likely never sends a close frame; waiting for one would
    // leave T8 believing it is connected.
    it('does not wait for the peer to confirm the close', () => {
      const { handshake, closes, timers } = harness({
        heartbeatIntervalMs: 25_000,
        heartbeatTimeoutMs: 10_000,
      });
      handshake();

      timers.advance(35_000);

      expect(closes).toHaveLength(1);
    });

    // The ack deadline is deliberately longer than the detection window here,
    // so the heartbeat is what settles the send. With the default 10s ack
    // timeout the send would legitimately time out first — whichever deadline
    // expires first wins, and both are real.
    it('settles in-flight sends when the peer goes silent', async () => {
      const { transport, handshake, timers } = harness({
        heartbeatIntervalMs: 25_000,
        heartbeatTimeoutMs: 10_000,
        ackTimeoutMs: 60_000,
      });
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      timers.advance(35_000);

      const outcome = (await sent.ack) as Extract<AckOutcome, { status: 'disconnected' }>;
      expect(outcome.status).toBe('disconnected');
      expect(outcome.close?.cause).toBe('heartbeatTimeout');
    });

    it('stops beating after the connection ends', () => {
      const { handshake, factory, timers } = harness({ heartbeatIntervalMs: 25_000 });
      handshake();
      const socket = factory.last;

      socket.emitClose({ code: CLOSE_CODE.NORMAL });
      const before = socket.sent.length;
      timers.advance(300_000);

      expect(socket.sent).toHaveLength(before);
    });
  });

  describe('closing', () => {
    it('surfaces the close code and reason intact', () => {
      const { handshake, factory, closes } = harness();
      handshake();

      factory.last.emitClose({ code: CLOSE_CODE.GOING_AWAY, reason: 'server shutting down' });

      expect(closes[0]).toMatchObject({
        code: 1001,
        reason: 'server shutting down',
        cause: 'peer',
        retryable: true,
      });
    });

    // The backpressure signal: back off, do not retry immediately.
    it('surfaces 1013 as backpressure', () => {
      const { handshake, factory, closes } = harness();
      handshake();

      factory.last.emitClose({
        code: CLOSE_CODE.TRY_AGAIN_LATER,
        reason: 'slow consumer',
        wasClean: true,
      });

      expect(closes[0]).toMatchObject({ code: 1013, backpressure: true, retryable: true });
    });

    it('surfaces an abnormal close honestly', () => {
      const { handshake, factory, closes } = harness();
      handshake();

      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });

      expect(closes[0]).toMatchObject({ code: 1006, wasClean: false, backpressure: false });
    });

    it('reports a local close with cause local', () => {
      const { transport, handshake, factory, closes } = harness();
      handshake();

      transport.close();

      expect(closes[0]).toMatchObject({ cause: 'local', code: CLOSE_CODE.NORMAL });
      expect(factory.last.closeCalls).toEqual([{ code: 1000, reason: 'client disconnect' }]);
    });

    it('reports close exactly once even if the socket confirms afterwards', () => {
      const { transport, handshake, factory, closes } = harness();
      handshake();

      transport.close();
      factory.last.emitClose({ code: CLOSE_CODE.NORMAL });
      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL });

      expect(closes).toHaveLength(1);
    });

    it('is a no-op when never connected', () => {
      const { transport, closes } = harness();

      transport.close();
      transport.close();

      expect(closes).toHaveLength(0);
    });

    it('ignores frames arriving after the close was reported', () => {
      const { transport, handshake, factory, frames } = harness();
      handshake();
      const socket = factory.last;
      transport.close();
      const before = frames.length;

      socket.emitJson({ v: 1, t: 'system.pong', id: SERVER_ID, ts: 1, d: {} });

      expect(frames).toHaveLength(before);
    });

    it('survives a socket whose close throws', () => {
      const { transport, handshake, factory, closes } = harness();
      handshake();
      factory.last.close = () => {
        throw new Error('already gone');
      };

      expect(() => transport.close()).not.toThrow();
      expect(closes).toHaveLength(1);
    });

    // The bug this test used to enshrine: an `onerror` with no close to
    // follow left T8 with no way back to `#handleClose` -> retry, so
    // `connecting` never healed. `onerror` must finish the attempt itself.
    it('finishes the connection as a retryable failure on a socket error, with no close needed', () => {
      const { transport, handshake, factory, warnings, closes } = harness();
      handshake();

      factory.last.emitError();

      expect(warnings.some((w) => w.message.includes('socket error'))).toBe(true);
      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ cause: 'peer', retryable: true, wasClean: false });
      expect(transport.isOpen).toBe(false);
    });

    it('does not double-finish when a genuine close follows the error', () => {
      const { transport, handshake, factory, closes } = harness();
      handshake();

      factory.last.emitError();
      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: 'peer gone', wasClean: false });

      // The error already finished the attempt; the close that follows it —
      // exactly what a real browser does — lands on a detached socket.
      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ reason: 'socket error' });
      expect(transport.pendingAckCount).toBe(0);
    });
  });

  describe('connect deadline', () => {
    it('does not fire before the deadline elapses', () => {
      const { transport, closes, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS - 1);

      expect(closes).toHaveLength(0);
    });

    // The actual user-visible bug: server down / no route to host. Real
    // sockets deliver *nothing* — no open, no error, no close — until the
    // OS's own TCP timeout gives up, which can be tens of seconds to minutes.
    it('synthesizes a retryable close when the socket never calls back at all', () => {
      const { transport, closes, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS);

      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ cause: 'peer', retryable: true, wasClean: false });
      expect(transport.isOpen).toBe(false);
    });

    it('is cancelled by a successful open and never fires afterwards', () => {
      const { transport, factory, closes, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();

      // Nothing else is pending yet: hello is not ack-tracked and the
      // heartbeat has not started (it starts on connection.ack).
      expect(timers.pendingCount).toBe(0);

      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS * 10);
      expect(closes).toHaveLength(0);
    });

    it('is cancelled by any close and leaves no timer to fire later', () => {
      const { transport, factory, closes, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });

      expect(closes).toHaveLength(1);
      expect(timers.pendingCount).toBe(0);

      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS * 10);
      expect(closes).toHaveLength(1);
    });

    it('leaves no timer armed after it fires itself — no leak', () => {
      const { transport, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS);

      expect(timers.pendingCount).toBe(0);
    });

    it('honours a configured connectTimeoutMs instead of the default', () => {
      const factory = new StubSocketFactory();
      const timers = new ManualTimers();
      const closes: TransportCloseInfo[] = [];
      const transport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: timers.schedule,
        connectTimeoutMs: 3_000,
        onClose: (info) => closes.push(info),
      });

      transport.connect({ url: URL, hello: HELLO });
      timers.advance(2_999);
      expect(closes).toHaveLength(0);

      timers.advance(1);
      expect(closes).toHaveLength(1);
    });

    // Idempotency: a socket this transport has already abandoned to the
    // deadline must not be able to resurrect the connection or double-fire
    // `onClose`, no matter what it does afterwards.
    it('ignores open, error, and close from the socket it abandoned to the deadline', () => {
      const { transport, factory, closes, opens, timers } = harness();

      transport.connect({ url: URL, hello: HELLO });
      const hung = factory.last;
      timers.advance(DEFAULT_CONNECT_TIMEOUT_MS);
      expect(closes).toHaveLength(1);

      hung.open();
      hung.emitError();
      hung.emitClose({ code: CLOSE_CODE.NORMAL });

      expect(opens).toHaveLength(0);
      expect(closes).toHaveLength(1);
      expect(transport.isOpen).toBe(false);
    });
  });

  describe('settling pending acks on close', () => {
    // The bug this whole layer is shaped to prevent: a promise that never
    // settles because the socket died.
    it('settles every in-flight send, with no hangs', async () => {
      const { transport, handshake, factory } = harness();
      handshake();

      const sends = [
        transport.send('message.send', { content: 'one', type: 'TEXT' }),
        transport.send('message.send', { content: 'two', type: 'TEXT' }),
        transport.send('typing.start', {}),
        transport.send('presence.query', {}),
      ];
      expect(transport.pendingAckCount).toBe(4);

      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });

      const outcomes = await Promise.all(sends.map((s) => s.ack));
      expect(outcomes.every((o) => o.status === 'disconnected')).toBe(true);
      expect(transport.pendingAckCount).toBe(0);
    });

    it('hands each settled send the close info that ended it', async () => {
      const { transport, handshake, factory } = harness();
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      factory.last.emitClose({ code: CLOSE_CODE.TRY_AGAIN_LATER, reason: 'slow consumer' });

      const outcome = (await sent.ack) as Extract<AckOutcome, { status: 'disconnected' }>;
      expect(outcome.close).toMatchObject({ code: 1013, backpressure: true });
    });

    it('settles them on a local close too', async () => {
      const { transport, handshake } = harness();
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      transport.close();

      const outcome = (await sent.ack) as Extract<AckOutcome, { status: 'disconnected' }>;
      expect(outcome.close?.cause).toBe('local');
    });

    it('drains the registry before onClose runs', () => {
      let pendingInsideHandler: number | null = null;
      const factory = new StubSocketFactory();
      const timers = new ManualTimers();
      const transport: WebSocketTransport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: timers.schedule,
        onClose: () => {
          pendingInsideHandler = transport.pendingAckCount;
        },
      });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
      void transport.send('message.send', { content: 'hi', type: 'TEXT' });
      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });

      expect(pendingInsideHandler).toBe(0);
    });

    it('leaves no ack timeout to fire after the close', async () => {
      const { transport, handshake, factory, timers } = harness({ ackTimeoutMs: 10_000 });
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });

      factory.last.emitClose({ code: CLOSE_CODE.ABNORMAL, wasClean: false });
      timers.advance(120_000);

      await expect(sent.ack).resolves.toMatchObject({ status: 'disconnected' });
      expect(timers.pendingCount).toBe(0);
    });
  });

  describe('the injected seam', () => {
    let restore: (() => void) | null = null;

    beforeEach(() => {
      restore?.();
      restore = null;
    });

    it('runs a full session without any WebSocket global present', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
      Reflect.deleteProperty(globalThis, 'WebSocket');
      restore = () => {
        if (descriptor) Object.defineProperty(globalThis, 'WebSocket', descriptor);
      };

      const { transport, handshake, factory, closes } = harness();
      handshake();
      const sent = transport.send('message.send', { content: 'hi', type: 'TEXT' });
      factory.last.emitJson(ack(sent.id, { ok: true, seq: 1 }));
      await expect(sent.ack).resolves.toMatchObject({ status: 'acked' });

      transport.close();
      expect(closes).toHaveLength(1);

      restore();
      restore = null;
    });

    it('uses only injected timers', () => {
      const schedule = vi.fn((_callback: () => void, _delayMs: number): (() => void) => () => {});
      const factory = new StubSocketFactory();
      const transport = new WebSocketTransport({ webSocket: factory.create, schedule });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
      void transport.send('message.send', { content: 'hi', type: 'TEXT' });
      factory.last.emitJson(connectionAck());

      // One connect deadline (armed by `connect()`, cancelled on open), one
      // ack deadline, one heartbeat interval — nothing reached for a global
      // timer.
      expect(schedule).toHaveBeenCalledTimes(3);
    });

    it('defaults the logger without one being supplied', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const factory = new StubSocketFactory();
      const transport = new WebSocketTransport({
        webSocket: factory.create,
        schedule: new ManualTimers().schedule,
      });

      transport.connect({ url: URL, hello: HELLO });
      factory.last.open();
      factory.last.emitMessage('garbage');

      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});

// D1/§9.3: a replayed frame must go back out under its original ULID. The
// server dedupes on that id, so minting a fresh one on replay turns a message
// that was already persisted into a second, distinct message — the exact
// double-send the offline queue exists to prevent.
describe('replaying a frame under its original id', () => {
  // Crockford base32 omits I/L/O/U. A fixture containing one is not a valid
  // ULID, and the frame is dropped by the validator before it can correlate.
  const ORIGINAL = '01J0000000000000000000REPM';

  it('reuses the supplied id instead of minting a new one', () => {
    const h = harness();
    h.connect();

    const sent = h.transport.send('message.send', { content: 'hi', type: 'TEXT' }, ORIGINAL);

    expect(sent.id).toBe(ORIGINAL);
    const ids = h.factory.last.sent.map((raw) => (JSON.parse(raw) as { id: string }).id);
    expect(ids).toContain(ORIGINAL);
  });

  it('still mints an id when none is supplied', () => {
    const h = harness();
    h.connect();

    const sent = h.transport.send('message.send', { content: 'hi', type: 'TEXT' });

    expect(sent.id).not.toBe(ORIGINAL);
    expect(sent.id).toHaveLength(26);
  });

  it('correlates the ack by the supplied id', async () => {
    const h = harness();
    h.connect();

    const sent = h.transport.send('message.send', { content: 'hi', type: 'TEXT' }, ORIGINAL);
    h.factory.last.emitJson(ack(ORIGINAL, { ok: true, seq: 7 }));

    await expect(sent.ack).resolves.toMatchObject({ status: 'acked' });
  });
});
