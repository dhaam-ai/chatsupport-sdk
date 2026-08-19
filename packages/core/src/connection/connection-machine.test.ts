import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame, ConnectionAckPayload, ErrorCode, ServerPushFrame, SessionSnapshot } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
import { MockWebSocket } from '../../test/mock-websocket.js';
import { Transport } from '../transport/index.js';
import { ConnectionMachine } from './connection-machine.js';
import type { HelloCredentials } from './connection-machine.js';

function sessionSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { sessionId: 's1', status: 'OPEN', mode: 'BOT', participants: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
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

function errorFrame(code: ErrorCode, retryable: boolean): AnyFrame {
  return { v: 1, t: 'error', id: generateUlid(), ts: Date.now(), d: { code, message: 'x', retryable } };
}

function messageNewFrame(seq: number): ServerPushFrame {
  return {
    v: 1,
    t: 'message.new',
    id: generateUlid(),
    ts: Date.now(),
    d: {
      id: generateUlid(),
      sessionId: 's1',
      senderId: 'agent-1',
      senderType: 'AGENT',
      type: 'TEXT',
      content: 'hi',
      seq,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('ConnectionMachine', () => {
  let sockets: MockWebSocket[];
  let transport: Transport;
  let buildHello: ReturnType<typeof vi.fn>;
  let machine: ConnectionMachine;

  function currentSocket(): MockWebSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket created yet');
    return socket;
  }

  function makeMachine(): ConnectionMachine {
    return new ConnectionMachine({ url: 'ws://example.invalid', transport, buildHello });
  }

  /** Drives the handshake all the way to `connected`, from a cold `idle` start. */
  async function connectToReady(): Promise<void> {
    machine.connect();
    currentSocket().simulateOpen();
    await vi.waitFor(() => expect(machine.state).toBe('authenticating'));
    currentSocket().simulateMessage(JSON.stringify(ackFrame()));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    transport = new Transport({
      webSocketFactory: () => {
        const socket = new MockWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    buildHello = vi.fn<() => Promise<HelloCredentials>>(async () => ({ token: 't1', publishableKey: 'pk1' }));
    machine = makeMachine();
  });

  afterEach(() => {
    machine.destroy();
    vi.useRealTimers();
  });

  it('starts idle', () => {
    expect(machine.state).toBe('idle');
  });

  it('moves to connecting synchronously on connect()', () => {
    machine.connect();
    expect(machine.state).toBe('connecting');
  });

  it('moves to authenticating once the transport opens, and sends connection.hello', async () => {
    machine.connect();
    currentSocket().simulateOpen();

    await vi.waitFor(() => expect(machine.state).toBe('authenticating'));

    expect(currentSocket().sent).toHaveLength(1);
    const sent = JSON.parse(currentSocket().sent[0] ?? '');
    expect(sent).toMatchObject({ t: 'connection.hello', d: { token: 't1', publishableKey: 'pk1', protocolVersion: 1 } });
    expect(sent.d.resumeFrom).toBeUndefined();
  });

  it('moves to connected on a valid connection.ack and emits "connected"', async () => {
    const onConnected = vi.fn();
    machine.on('connected', onConnected);

    await connectToReady();

    expect(machine.state).toBe('connected');
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('emits stateChange for every transition with the correct previous/next pair', async () => {
    const transitions: Array<{ state: string; previous: string }> = [];
    machine.on('stateChange', (e) => transitions.push(e));

    await connectToReady();

    expect(transitions).toEqual([
      { previous: 'idle', state: 'connecting' },
      { previous: 'connecting', state: 'authenticating' },
      { previous: 'authenticating', state: 'connected' },
    ]);
  });

  it('forwards an error frame received while connected via "frame", instead of dropping it', async () => {
    const onFrame = vi.fn();
    machine.on('frame', onFrame);
    await connectToReady();

    const frame = errorFrame('AUTH_EXPIRED', true);
    currentSocket().simulateMessage(JSON.stringify(frame));

    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(machine.state).toBe('connected'); // does not itself trigger reconnect/suspend logic post-connect
  });

  it('forwards a server push frame received while connected via "frame"', async () => {
    const onFrame = vi.fn();
    machine.on('frame', onFrame);
    await connectToReady();

    const frame = messageNewFrame(2);
    currentSocket().simulateMessage(JSON.stringify(frame));

    expect(onFrame).toHaveBeenCalledWith(frame);
  });

  it('forwards replayed frames from connection.ack, in order, without treating them as a sequence gap', async () => {
    const onFrame = vi.fn();
    const onGap = vi.fn();
    machine.on('frame', onFrame);
    machine.on('sequenceGap', onGap);

    machine.connect();
    currentSocket().simulateOpen();
    await vi.waitFor(() => expect(machine.state).toBe('authenticating'));
    const replay = [messageNewFrame(5), messageNewFrame(6)];
    currentSocket().simulateMessage(JSON.stringify(ackFrame({ seq: 6, replay })));

    expect(onFrame.mock.calls.map((c) => c[0])).toEqual(replay);
    expect(onGap).not.toHaveBeenCalled();
  });

  it('reports a sequence gap when a live frame does not immediately follow the last known seq', async () => {
    const onGap = vi.fn();
    machine.on('sequenceGap', onGap);
    await connectToReady(); // ack seq defaults to 1

    currentSocket().simulateMessage(JSON.stringify(messageNewFrame(5)));

    expect(onGap).toHaveBeenCalledWith({ expected: 2, received: 5 });
  });

  it('does not report a gap for the immediately-next seq', async () => {
    const onGap = vi.fn();
    machine.on('sequenceGap', onGap);
    await connectToReady(); // ack seq = 1

    currentSocket().simulateMessage(JSON.stringify(messageNewFrame(2)));

    expect(onGap).not.toHaveBeenCalled();
  });

  it('sends resumeFrom on a reconnect, using the last known seq', async () => {
    await connectToReady(); // seq now 1
    currentSocket().simulateMessage(JSON.stringify(messageNewFrame(2))); // seq now 2

    currentSocket().close(1006, 'dropped'); // unexpected transport-level drop
    expect(machine.state).toBe('reconnecting'); // synchronous — see the disconnect() test's note on why not vi.waitFor here
    await vi.advanceTimersByTimeAsync(30_000); // clears any full-jitter delay
    await vi.waitFor(() => expect(machine.state).toBe('connecting'));
    currentSocket().simulateOpen();
    await vi.waitFor(() => expect(machine.state).toBe('authenticating'));

    const sent = JSON.parse(currentSocket().sent[0] ?? '');
    expect(sent.d.resumeFrom).toBe(2);
  });

  describe('transport-level disconnects', () => {
    it('moves to reconnecting on an unexpected close and emits attempt 0 with a delay', async () => {
      const onReconnecting = vi.fn();
      machine.on('reconnecting', onReconnecting);
      await connectToReady();

      currentSocket().close(1006, 'dropped');

      expect(machine.state).toBe('reconnecting');
      expect(onReconnecting).toHaveBeenCalledWith({ attempt: 0, delayMs: expect.any(Number) });
    });

    it('opens a new transport connection once the backoff delay elapses', async () => {
      await connectToReady();
      currentSocket().close(1006, 'dropped');
      const socketsBefore = sockets.length;

      await vi.advanceTimersByTimeAsync(30_000);

      expect(sockets.length).toBeGreaterThan(socketsBefore);
      expect(machine.state).toBe('connecting');
    });

    it('increments the attempt count across consecutive transport failures, and resets it after a successful connect', async () => {
      const attempts: number[] = [];
      machine.on('reconnecting', (e) => attempts.push(e.attempt));
      await connectToReady();

      currentSocket().close(1006, 'first drop');
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(machine.state).toBe('connecting'));
      currentSocket().close(1006, 'second drop before even opening'); // still counts as a transport failure

      expect(attempts).toEqual([0, 1]);

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(machine.state).toBe('connecting'));
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(machine.state).toBe('authenticating'));
      currentSocket().simulateMessage(JSON.stringify(ackFrame()));
      await vi.waitFor(() => expect(machine.state).toBe('connected'));

      currentSocket().close(1006, 'third drop, after a fresh success');
      expect(attempts).toEqual([0, 1, 0]);
    });
  });

  describe('auth failures', () => {
    it('retries with the auth backoff delay when buildHello() rejects', async () => {
      buildHello.mockRejectedValueOnce(new Error('no token'));
      const onReconnecting = vi.fn();
      machine.on('reconnecting', onReconnecting);

      machine.connect();
      currentSocket().simulateOpen();

      // Flush the microtask queue (the rejected buildHello() promise) without
      // advancing fake timers past 0ms — `vi.waitFor` would auto-advance
      // fake timers while polling and could race past the reconnect's own
      // scheduled timeout before this assertion runs.
      await vi.advanceTimersByTimeAsync(0);

      expect(onReconnecting).toHaveBeenCalledTimes(1);
      expect(onReconnecting).toHaveBeenCalledWith({ attempt: 0, delayMs: expect.any(Number) });
      expect(machine.state).toBe('reconnecting');
    });

    it('retries on an AUTH_INVALID error frame during the handshake', async () => {
      const onReconnecting = vi.fn();
      machine.on('reconnecting', onReconnecting);
      machine.connect();
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(machine.state).toBe('authenticating'));

      currentSocket().simulateMessage(JSON.stringify(errorFrame('AUTH_INVALID', false)));

      // Synchronous — see the disconnect() test's note on why not
      // vi.waitFor here: the whole auth-failure→reconnecting path runs
      // synchronously within simulateMessage() itself.
      expect(onReconnecting).toHaveBeenCalledTimes(1);
      expect(machine.state).toBe('reconnecting');
    });

    it('suspends with reason "auth" after the configured number of consecutive auth failures', async () => {
      buildHello.mockRejectedValue(new Error('no token'));
      const onSuspended = vi.fn();
      machine.on('suspended', onSuspended);

      machine.connect();
      for (let i = 0; i < 3; i++) {
        currentSocket().simulateOpen();
        await vi.waitFor(() => expect(buildHello).toHaveBeenCalledTimes(i + 1));
        if (i < 2) await vi.advanceTimersByTimeAsync(30_000);
      }

      await vi.waitFor(() => expect(machine.state).toBe('suspended'));
      expect(onSuspended).toHaveBeenCalledWith({ reason: 'auth' });
    });

    it('resets the auth-failure budget on an explicit connect() after suspension', async () => {
      buildHello.mockRejectedValue(new Error('no token'));
      machine.connect();
      for (let i = 0; i < 3; i++) {
        currentSocket().simulateOpen();
        await vi.waitFor(() => expect(buildHello).toHaveBeenCalledTimes(i + 1));
        if (i < 2) await vi.advanceTimersByTimeAsync(30_000);
      }
      await vi.waitFor(() => expect(machine.state).toBe('suspended'));

      buildHello.mockResolvedValue({ token: 't2', publishableKey: 'pk1' });
      machine.connect();
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(machine.state).toBe('authenticating'));
      currentSocket().simulateMessage(JSON.stringify(ackFrame()));

      await vi.waitFor(() => expect(machine.state).toBe('connected'));
    });
  });

  describe('non-auth error frames', () => {
    it('suspends with reason "maxAttempts" on a non-retryable, non-auth error', async () => {
      const onSuspended = vi.fn();
      machine.on('suspended', onSuspended);
      machine.connect();
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(machine.state).toBe('authenticating'));

      currentSocket().simulateMessage(JSON.stringify(errorFrame('SESSION_CLOSED', false)));

      expect(machine.state).toBe('suspended');
      expect(onSuspended).toHaveBeenCalledWith({ reason: 'maxAttempts' });
    });

    it('retries via transport backoff on a retryable, non-auth error (e.g. RATE_LIMITED)', async () => {
      const onReconnecting = vi.fn();
      machine.on('reconnecting', onReconnecting);
      machine.connect();
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(machine.state).toBe('authenticating'));

      currentSocket().simulateMessage(JSON.stringify(errorFrame('RATE_LIMITED', true)));

      expect(machine.state).toBe('reconnecting');
      expect(onReconnecting).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect()', () => {
    it('moves straight to closed and closes the open transport', async () => {
      await connectToReady();

      machine.disconnect();

      expect(machine.state).toBe('closed');
      expect(currentSocket().readyState).toBe(3); // WS_READY_STATE.CLOSED
    });

    it('does not trigger a reconnect after disconnect(), even once time passes', async () => {
      const onReconnecting = vi.fn();
      machine.on('reconnecting', onReconnecting);
      await connectToReady();

      machine.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(onReconnecting).not.toHaveBeenCalled();
      expect(machine.state).toBe('closed');
    });

    it('cancels a pending reconnect timer when called mid-backoff-wait', async () => {
      await connectToReady();
      currentSocket().close(1006, 'dropped');
      // Synchronous, not `vi.waitFor` — the close→reconnecting transition
      // happens synchronously (see the "transport-level disconnects"
      // describe block above), and `vi.waitFor` auto-advances fake timers
      // while polling. With a full-jitter delay that can land near 0ms,
      // that auto-advance can race past the scheduled reconnect (flipping
      // state to 'connecting' again) before this assertion ever runs.
      expect(machine.state).toBe('reconnecting');
      const socketsBeforeDisconnect = sockets.length;

      machine.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(machine.state).toBe('closed');
      expect(sockets.length).toBe(socketsBeforeDisconnect); // no new connect() attempt was made
    });

    it('allows connect() again after disconnect()', async () => {
      await connectToReady();
      machine.disconnect();

      expect(() => machine.connect()).not.toThrow();
      expect(machine.state).toBe('connecting');
    });
  });

  describe('invalid inbound frames', () => {
    it('forwards transport-level "invalidFrame" instead of dropping it silently', async () => {
      const onInvalid = vi.fn();
      machine.on('invalidFrame', onInvalid);
      await connectToReady();

      currentSocket().simulateMessage('{not valid json');

      expect(onInvalid).toHaveBeenCalledTimes(1);
      expect(onInvalid.mock.calls[0]?.[0]).toMatchObject({ failure: { ok: false, reason: expect.any(String) } });
    });

    it('does not change connection state or trigger a reconnect on an invalid frame while connected', async () => {
      await connectToReady();

      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'not.a.real.frame.type', id: 'not-a-ulid', ts: Date.now(), d: {} }));

      expect(machine.state).toBe('connected');
    });
  });

  describe('guards', () => {
    it('throws if connect() is called while already connecting/authenticating/connected/reconnecting', async () => {
      machine.connect();
      expect(() => machine.connect()).toThrow(/already connecting/);
    });

    it('throws on send() while not connected', () => {
      expect(() => machine.send(ackFrame())).toThrow(/cannot send/);
    });

    it('does not throw on send() once connected, and forwards to the transport', async () => {
      await connectToReady();
      const frame = messageNewFrame(2);

      expect(() => machine.send(frame)).not.toThrow();
      expect(JSON.parse(currentSocket().sent[currentSocket().sent.length - 1] ?? '')).toEqual(frame);
    });
  });
});
