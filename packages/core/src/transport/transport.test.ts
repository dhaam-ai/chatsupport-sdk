import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame } from '../protocol/index.js';
import { MockWebSocket } from '../../test/mock-websocket.js';
import { Transport } from './transport.js';
import { WS_READY_STATE } from './websocket-like.js';

function pongFrame(): AnyFrame {
  return { v: 1, t: 'system.pong', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ts: 1_700_000_000_000, d: {} };
}

function messageNewFrame(): AnyFrame {
  return {
    v: 1,
    t: 'message.new',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ts: 1_700_000_000_000,
    d: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      sessionId: 's1',
      senderId: 'agent-1',
      senderType: 'AGENT',
      type: 'TEXT',
      content: 'hi',
      seq: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('Transport', () => {
  let socket: MockWebSocket;
  let transport: Transport;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new MockWebSocket();
    transport = new Transport({ webSocketFactory: () => socket });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not open before connect()', () => {
    expect(transport.isOpen).toBe(false);
  });

  it('is not open immediately after connect() — only once the socket actually opens', () => {
    transport.connect('ws://example.invalid');

    expect(transport.isOpen).toBe(false);
  });

  it('becomes open and emits "open" once the underlying socket opens', () => {
    const onOpen = vi.fn();
    transport.on('open', onOpen);
    transport.connect('ws://example.invalid');

    socket.simulateOpen();

    expect(transport.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('throws if connect() is called while a connection is already active', () => {
    transport.connect('ws://example.invalid');

    expect(() => transport.connect('ws://example.invalid')).toThrow(/already active/);
  });

  it('throws on send() while not open', () => {
    expect(() => transport.send(pongFrame())).toThrow(/not open/);
  });

  it('encodes and sends a frame once open', () => {
    transport.connect('ws://example.invalid');
    socket.simulateOpen();

    transport.send(messageNewFrame());

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] ?? '')).toEqual(messageNewFrame());
  });

  it('parses a valid inbound frame and emits "frame"', () => {
    const onFrame = vi.fn();
    transport.on('frame', onFrame);
    transport.connect('ws://example.invalid');
    socket.simulateOpen();

    socket.simulateMessage(JSON.stringify(messageNewFrame()));

    expect(onFrame).toHaveBeenCalledWith(messageNewFrame());
  });

  it('emits "invalidFrame", not "frame", for malformed inbound JSON', () => {
    const onFrame = vi.fn();
    const onInvalid = vi.fn();
    transport.on('frame', onFrame);
    transport.on('invalidFrame', onInvalid);
    transport.connect('ws://example.invalid');
    socket.simulateOpen();

    socket.simulateMessage('not json {{{');

    expect(onFrame).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it('emits "invalidFrame" for non-string (binary) inbound data', () => {
    const onInvalid = vi.fn();
    transport.on('invalidFrame', onInvalid);
    transport.connect('ws://example.invalid');
    socket.simulateOpen();

    socket.simulateMessage(new ArrayBuffer(4));

    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid.mock.calls[0]?.[0]).toMatchObject({ failure: { reason: expect.stringContaining('binary') } });
  });

  it('emits "error" when the underlying socket errors', () => {
    const onError = vi.fn();
    transport.on('error', onError);
    transport.connect('ws://example.invalid');

    socket.simulateError();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('emits "close" with the underlying socket\'s code and reason', () => {
    const onClose = vi.fn();
    transport.on('close', onClose);
    transport.connect('ws://example.invalid');
    socket.simulateOpen();

    socket.close(1000, 'normal closure');

    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: 'normal closure' });
  });

  it('nulls out the connection on close, so send() throws again afterward', () => {
    transport.connect('ws://example.invalid');
    socket.simulateOpen();
    socket.close(1000, 'bye');

    expect(() => transport.send(pongFrame())).toThrow(/not open/);
  });

  it('allows connect() again, on the same instance, after a prior connection closed', () => {
    const sockets = [new MockWebSocket(), new MockWebSocket()];
    let factoryCalls = 0;
    transport = new Transport({ webSocketFactory: () => sockets[factoryCalls++] as MockWebSocket });

    transport.connect('ws://example.invalid');
    sockets[0]?.simulateOpen();
    sockets[0]?.close();

    expect(() => transport.connect('ws://example.invalid')).not.toThrow();
    expect(factoryCalls).toBe(2);
  });

  describe('heartbeat integration', () => {
    it('starts sending heartbeats once open, using the negotiated protocol version and a real ULID', () => {
      transport.connect('ws://example.invalid');
      socket.simulateOpen();

      vi.advanceTimersByTime(25_000);

      expect(socket.sent).toHaveLength(1);
      const frame = JSON.parse(socket.sent[0] ?? '');
      expect(frame).toMatchObject({ t: 'system.heartbeat', v: 1, d: {} });
      expect(frame.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('does not send heartbeats before the socket opens', () => {
      transport.connect('ws://example.invalid');

      vi.advanceTimersByTime(60_000);

      expect(socket.sent).toHaveLength(0);
    });

    it('closes the connection with code 4000 if no pong arrives within the timeout window', () => {
      transport.connect('ws://example.invalid');
      socket.simulateOpen();

      vi.advanceTimersByTime(25_000); // heartbeat sent
      vi.advanceTimersByTime(10_000); // timeout window elapses, no pong

      expect(socket.readyState).toBe(WS_READY_STATE.CLOSED);
    });

    it('a "close" event follows a heartbeat timeout, same as any other disconnect', () => {
      const onClose = vi.fn();
      transport.on('close', onClose);
      transport.connect('ws://example.invalid');
      socket.simulateOpen();

      vi.advanceTimersByTime(35_000);

      expect(onClose).toHaveBeenCalledWith({ code: 4000, reason: 'heartbeat timeout' });
    });

    it('does not time out if a system.pong frame arrives before the deadline', () => {
      const onClose = vi.fn();
      transport.on('close', onClose);
      transport.connect('ws://example.invalid');
      socket.simulateOpen();

      vi.advanceTimersByTime(25_000); // heartbeat sent
      socket.simulateMessage(JSON.stringify(pongFrame()));
      vi.advanceTimersByTime(10_000); // would have timed out without the pong

      expect(onClose).not.toHaveBeenCalled();
    });

    it('stops the heartbeat cycle when close() is called', () => {
      transport.connect('ws://example.invalid');
      socket.simulateOpen();
      transport.close();

      vi.advanceTimersByTime(60_000);

      expect(socket.sent).toHaveLength(0);
    });
  });
});
