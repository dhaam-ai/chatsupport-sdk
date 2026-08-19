import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame, ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { MockWebSocket } from '../../test/mock-websocket.js';
import { Transport } from '../transport/index.js';
import { ConnectionMachine } from '../connection/index.js';
import { AuthCoordinator } from './auth-coordinator.js';

function base64UrlEncode(json: unknown): string {
  const base64 = btoa(JSON.stringify(json));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtExpiringInSeconds(secondsFromNow: number, extraClaims: Record<string, unknown> = {}): string {
  const header = base64UrlEncode({ alg: 'none' });
  const body = base64UrlEncode({ exp: Math.floor(Date.now() / 1000) + secondsFromNow, ...extraClaims });
  return `${header}.${body}.sig`;
}

function sessionSnapshot(): SessionSnapshot {
  return { sessionId: 's1', status: 'OPEN', mode: 'BOT', participants: [], createdAt: '2026-01-01T00:00:00.000Z' };
}

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): AnyFrame {
  return {
    v: 1,
    t: 'connection.ack',
    id: generateUlid(),
    ts: Date.now(),
    d: { protocolVersion: 1, session: sessionSnapshot(), seq: 1, ...overrides },
  };
}

function genericAck(ref: string, ok: boolean): AnyFrame {
  // Cast: the ok:true branch's extra data (AckExtraData) is a union of
  // several possible shapes depending which frame is being acked — this
  // fixture builds a bare `connection.reauth` ack, which per envelope.ts's
  // documented judgment call just needs `{ok:true}`, but TS can't infer
  // that against the full union from an untyped object literal alone.
  return (
    ok
      ? { v: 1, t: 'ack', id: generateUlid(), ref, ts: Date.now(), d: { ok: true } }
      : { v: 1, t: 'ack', id: generateUlid(), ref, ts: Date.now(), d: { ok: false, error: { code: 'AUTH_INVALID', message: 'x', retryable: false } } }
  ) as AnyFrame;
}

function authExpiredFrame(): AnyFrame {
  return { v: 1, t: 'error', id: generateUlid(), ts: Date.now(), d: { code: 'AUTH_EXPIRED', message: 'expired', retryable: true } };
}

describe('AuthCoordinator', () => {
  let sockets: MockWebSocket[];
  let transport: Transport;
  // Undefined until a test actually builds one via `createConnection` — no
  // throwaway instance is pre-seeded here. An unused `ConnectionMachine`
  // sharing the same `transport` would still react to its 'close' events
  // (state 'idle' is neither 'closed' nor 'suspended', so its own
  // `#handleTransportClose` guard doesn't skip it) and schedule its own
  // reconnect on the shared transport — exactly the bug this restructure
  // fixes.
  let connection: ConnectionMachine | undefined;

  function currentSocket(): MockWebSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket yet');
    return socket;
  }

  function sentFrames(): Array<{ t: string; id: string; d: Record<string, unknown> }> {
    return currentSocket().sent.map((s) => JSON.parse(s));
  }

  function lastSentHello(): { d: Record<string, unknown> } {
    const hello = [...sentFrames()].reverse().find((f) => f.t === 'connection.hello');
    if (!hello) throw new Error('no connection.hello sent yet');
    return hello;
  }

  function lastSentReauth(): { id: string; d: Record<string, unknown> } | undefined {
    return [...sentFrames()].reverse().find((f) => f.t === 'connection.reauth');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    connection = undefined;
    transport = new Transport({
      webSocketFactory: () => {
        const socket = new MockWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
  });

  afterEach(() => {
    connection?.destroy();
    vi.useRealTimers();
  });

  /** Builds a ConnectionMachine wired to `auth`, assigns it to the shared `connection`, and attaches `auth` to it. */
  function createConnection(auth: AuthCoordinator): ConnectionMachine {
    connection = new ConnectionMachine({ url: 'ws://example.invalid', transport, buildHello: auth.buildHello });
    auth.attach(connection);
    return connection;
  }

  async function connectAndAck(): Promise<void> {
    if (!connection) throw new Error('call createConnection() first');
    connection.connect();
    currentSocket().simulateOpen();
    // Wait for the hello to actually be SENT, not just for the state to say
    // 'authenticating' — buildHello() is async, and state flips to
    // 'authenticating' synchronously before it's even called, so racing an
    // ack in right after the state check would let this helper simulate an
    // ack for a hello that hasn't been transmitted yet.
    await vi.waitFor(() => expect(sentFrames().some((f) => f.t === 'connection.hello')).toBe(true));
    currentSocket().simulateMessage(JSON.stringify(ackFrame()));
    await vi.waitFor(() => expect(connection?.state).toBe('connected'));
  }

  describe('buildHello', () => {
    it('builds a token hello when getToken is configured', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => 'tok-1' });

      const hello = await auth.buildHello();

      expect(hello).toEqual({ token: 'tok-1', publishableKey: 'pk1' });
    });

    it('builds a guest hello, with a persisted guestId, when getToken is absent', async () => {
      const storage = new MemoryStorageAdapter();
      const auth = new AuthCoordinator({ publishableKey: 'pk1', storage });

      const hello = await auth.buildHello();

      expect(hello.publishableKey).toBe('pk1');
      expect('guestId' in hello && hello.guestId).toMatch(/^guest_/);
    });

    it('throws if getToken() resolves an empty string', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => '' });

      await expect(auth.buildHello()).rejects.toThrow(/empty/);
    });
  });

  describe('isGuest', () => {
    it('is true when constructed without getToken', () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      expect(auth.isGuest).toBe(true);
    });

    it('is false when constructed with getToken', () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => 'tok' });
      expect(auth.isGuest).toBe(false);
    });

    it('becomes false after identify()', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      await auth.identify(async () => 'tok');
      expect(auth.isGuest).toBe(false);
    });
  });

  describe('end-to-end via ConnectionMachine', () => {
    it('connects in guest mode using a persisted guestId', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      createConnection(auth);

      await connectAndAck();

      expect(lastSentHello().d['guestId']).toMatch(/^guest_/);
      expect(lastSentHello().d['token']).toBeUndefined();
    });

    it('connects in token mode', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => jwtExpiringInSeconds(3600) });
      createConnection(auth);

      await connectAndAck();

      expect(lastSentHello().d['token']).toEqual(expect.any(String));
      expect(lastSentHello().d['guestId']).toBeUndefined();
    });
  });

  describe('proactive refresh', () => {
    it('schedules the next getToken() call at 80% of the token remaining lifetime', async () => {
      // Short-lived on purpose: T7's heartbeat runs underneath every
      // connection (25s interval, 10s pong-timeout) and nothing in this
      // test answers it, so a token long-lived enough to need advancing
      // fake time past ~35s would let the connection drop from a heartbeat
      // timeout before the refresh timer ever got a chance to fire.
      //
      // The check windows below carry ~2s of margin on both sides of the
      // ideal 80%-of-20s = 16s mark: `jwtExpiringInSeconds` floors to whole
      // seconds (a real JWT's `exp` is second-precision too), which can
      // make the actual scheduled delay up to ~1s shorter than the ideal
      // figure — a tight ±1ms assertion here would be testing fixture
      // rounding, not this class's behavior.
      const getToken = vi.fn(async () => jwtExpiringInSeconds(20));
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken });
      createConnection(auth);
      await connectAndAck();
      expect(getToken).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(14_000); // comfortably before 80% of 20s (16s)
      expect(getToken).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3_000); // comfortably past it (17s total)
      expect(getToken).toHaveBeenCalledTimes(2);
    });

    it('sends connection.reauth (not a fresh connect) when the proactive refresh fires', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => jwtExpiringInSeconds(20) });
      createConnection(auth);
      await connectAndAck();
      const socketsBefore = sockets.length;

      await vi.advanceTimersByTimeAsync(17_000);
      const reauth = lastSentReauth();

      expect(reauth).toBeDefined();
      expect(sockets.length).toBe(socketsBefore); // same connection, no reconnect
    });

    it('does not schedule any refresh for a guest connection', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      createConnection(auth);
      await connectAndAck();

      await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

      expect(lastSentReauth()).toBeUndefined();
    });
  });

  describe('reactive refresh', () => {
    it('triggers an immediate reauth on an AUTH_EXPIRED error frame while connected', async () => {
      const getToken = vi.fn(async () => jwtExpiringInSeconds(3600));
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken });
      createConnection(auth);
      await connectAndAck();
      expect(getToken).toHaveBeenCalledTimes(1);

      currentSocket().simulateMessage(JSON.stringify(authExpiredFrame()));
      await vi.waitFor(() => expect(getToken).toHaveBeenCalledTimes(2));

      expect(lastSentReauth()).toBeDefined();
    });
  });

  describe('identify() — guest to authenticated upgrade', () => {
    it('sends connection.reauth immediately when already connected as a guest', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      createConnection(auth);
      await connectAndAck();
      expect(lastSentReauth()).toBeUndefined();

      const identifyPromise = auth.identify(async () => jwtExpiringInSeconds(3600));
      await vi.waitFor(() => expect(lastSentReauth()).toBeDefined());
      currentSocket().simulateMessage(JSON.stringify(genericAck(lastSentReauth()!.id, true)));
      await identifyPromise;

      expect(auth.isGuest).toBe(false);
    });

    it('the same session stays connected across the upgrade — no reconnect', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      createConnection(auth);
      await connectAndAck();
      const socketsBefore = sockets.length;

      const identifyPromise = auth.identify(async () => jwtExpiringInSeconds(3600));
      await vi.waitFor(() => expect(lastSentReauth()).toBeDefined());
      currentSocket().simulateMessage(JSON.stringify(genericAck(lastSentReauth()!.id, true)));
      await identifyPromise;

      expect(sockets.length).toBe(socketsBefore);
      expect(connection?.state).toBe('connected');
    });
  });

  describe('reauth failure fallback', () => {
    it('falls back to a fresh reconnect when the server rejects the reauth', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => jwtExpiringInSeconds(3600) });
      createConnection(auth);
      await connectAndAck();
      const socketsBefore = sockets.length;

      currentSocket().simulateMessage(JSON.stringify(authExpiredFrame()));
      await vi.waitFor(() => expect(lastSentReauth()).toBeDefined());
      currentSocket().simulateMessage(JSON.stringify(genericAck(lastSentReauth()!.id, false)));

      await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(socketsBefore));
    });

    it('falls back to a fresh reconnect if no reauth response arrives within the timeout', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => jwtExpiringInSeconds(3600) });
      createConnection(auth);
      await connectAndAck();
      const socketsBefore = sockets.length;

      currentSocket().simulateMessage(JSON.stringify(authExpiredFrame()));
      await vi.waitFor(() => expect(lastSentReauth()).toBeDefined());

      await vi.advanceTimersByTimeAsync(10_000); // REAUTH_RESPONSE_TIMEOUT_MS, no response simulated

      expect(sockets.length).toBeGreaterThan(socketsBefore);
    });
  });

  describe('currentAuth / senderId', () => {
    it('is empty before the first buildHello() call resolves', () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });

      expect(auth.currentAuth).toEqual({});
      expect(auth.senderId).toBeUndefined();
    });

    it('reflects the guest id after connecting in guest mode', async () => {
      const auth = new AuthCoordinator({ publishableKey: 'pk1' });
      createConnection(auth);
      await connectAndAck();

      expect(auth.currentAuth).toEqual({ guestId: expect.stringMatching(/^guest_/) });
      expect(auth.senderId).toMatch(/^guest_/);
    });

    it('reflects the token, and decodes senderId from its sub claim, after connecting in token mode', async () => {
      const token = jwtExpiringInSeconds(3600, { sub: 'user-42' });
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken: async () => token });
      createConnection(auth);
      await connectAndAck();

      expect(auth.currentAuth).toEqual({ token });
      expect(auth.senderId).toBe('user-42');
    });
  });

  describe('destroy()', () => {
    it('cancels a pending proactive refresh', async () => {
      const getToken = vi.fn(async () => jwtExpiringInSeconds(1000));
      const auth = new AuthCoordinator({ publishableKey: 'pk1', getToken });
      createConnection(auth);
      await connectAndAck();
      expect(getToken).toHaveBeenCalledTimes(1);

      auth.destroy();
      await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

      expect(getToken).toHaveBeenCalledTimes(1);
    });
  });
});
