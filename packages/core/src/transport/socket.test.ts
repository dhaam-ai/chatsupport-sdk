import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_CODE, createPlatformWebSocketFactory } from './socket.js';
import { StubSocketFactory, StubWebSocket } from './stub-socket.js';

/** Removes `globalThis.WebSocket`, returning a restore function. */
function withoutWebSocketGlobal(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Reflect.deleteProperty(globalThis, 'WebSocket');

  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'WebSocket', descriptor);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  };
}

describe('CLOSE_CODE', () => {
  it('matches the IANA registry values the server actually emits', () => {
    expect(CLOSE_CODE.NORMAL).toBe(1000);
    expect(CLOSE_CODE.GOING_AWAY).toBe(1001);
    expect(CLOSE_CODE.ABNORMAL).toBe(1006);
    expect(CLOSE_CODE.POLICY_VIOLATION).toBe(1008);
    expect(CLOSE_CODE.MESSAGE_TOO_BIG).toBe(1009);
    // The backpressure code. `chat-service-node` closes with this when a
    // connection's outbound buffer passes 1 MiB.
    expect(CLOSE_CODE.TRY_AGAIN_LATER).toBe(1013);
  });
});

describe('createPlatformWebSocketFactory', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
  });

  // The SSR / import-safety guarantee: building the factory must not read
  // the global, so a transport can be constructed anywhere.
  it('does not read the WebSocket global until a socket is opened', () => {
    restores.push(withoutWebSocketGlobal());

    expect(() => createPlatformWebSocketFactory()).not.toThrow();
  });

  it('throws a directive error when no WebSocket global exists at connect time', () => {
    restores.push(withoutWebSocketGlobal());
    const factory = createPlatformWebSocketFactory();

    expect(() => factory('wss://example.test/chat-services/v2/ws')).toThrow(
      /No global WebSocket is available/,
    );
    // The message must point at the fix, not just state the problem.
    expect(() => factory('wss://example.test/chat-services/v2/ws')).toThrow(/`webSocket` factory/);
  });

  it('constructs from the global when one is present', () => {
    restores.push(withoutWebSocketGlobal());
    const Ctor = vi.fn(function FakeWebSocket(this: Record<string, unknown>, url: string) {
      this['url'] = url;
    });
    Object.defineProperty(globalThis, 'WebSocket', { value: Ctor, configurable: true, writable: true });

    const socket = createPlatformWebSocketFactory()('wss://example.test/chat-services/v2/ws');

    expect(Ctor).toHaveBeenCalledOnce();
    expect(Ctor).toHaveBeenCalledWith('wss://example.test/chat-services/v2/ws');
    expect((socket as unknown as { url: string }).url).toBe(
      'wss://example.test/chat-services/v2/ws',
    );
  });

  it('re-reads the global on every call rather than caching it', () => {
    restores.push(withoutWebSocketGlobal());
    const factory = createPlatformWebSocketFactory();

    expect(() => factory('wss://a.test')).toThrow();

    const Ctor = vi.fn(function FakeWebSocket(this: Record<string, unknown>) {});
    Object.defineProperty(globalThis, 'WebSocket', { value: Ctor, configurable: true, writable: true });

    expect(() => factory('wss://a.test')).not.toThrow();
  });
});

describe('StubWebSocket', () => {
  it('records sends and exposes them parsed', () => {
    const socket = new StubWebSocket('wss://example.test');

    socket.send(JSON.stringify({ t: 'system.heartbeat' }));

    expect(socket.sent).toHaveLength(1);
    expect(socket.sentFrames()).toEqual([{ t: 'system.heartbeat' }]);
    expect(socket.lastSentFrame()).toEqual({ t: 'system.heartbeat' });
  });

  it('throws from lastSentFrame when nothing was sent', () => {
    expect(() => new StubWebSocket('wss://example.test').lastSentFrame()).toThrow(
      /nothing has been sent/,
    );
  });

  it('throws the configured send error instead of recording', () => {
    const socket = new StubWebSocket('wss://example.test');
    socket.sendError = new Error('socket is closing');

    expect(() => socket.send('{}')).toThrow('socket is closing');
    expect(socket.sent).toEqual([]);
  });

  // The deliberate gap: a real socket may take a long time to confirm a
  // close, and the transport must behave correctly in the meantime.
  it('records close() without firing onclose', () => {
    const socket = new StubWebSocket('wss://example.test');
    const onclose = vi.fn();
    socket.onclose = onclose;

    socket.close(CLOSE_CODE.NORMAL, 'client disconnect');

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'client disconnect' }]);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('emits close events with clean 1000 defaults', () => {
    const socket = new StubWebSocket('wss://example.test');
    const onclose = vi.fn();
    socket.onclose = onclose;

    socket.emitClose();
    socket.emitClose({ code: CLOSE_CODE.TRY_AGAIN_LATER, reason: 'slow consumer', wasClean: false });

    expect(onclose).toHaveBeenNthCalledWith(1, { code: 1000, reason: '', wasClean: true });
    expect(onclose).toHaveBeenNthCalledWith(2, {
      code: 1013,
      reason: 'slow consumer',
      wasClean: false,
    });
  });

  it('emits raw and JSON messages', () => {
    const socket = new StubWebSocket('wss://example.test');
    const onmessage = vi.fn();
    socket.onmessage = onmessage;

    socket.emitMessage(new ArrayBuffer(4));
    socket.emitJson({ t: 'system.pong' });

    expect(onmessage).toHaveBeenNthCalledWith(1, { data: expect.any(ArrayBuffer) });
    expect(onmessage).toHaveBeenNthCalledWith(2, { data: '{"t":"system.pong"}' });
  });

  it('tolerates events with no handler attached', () => {
    const socket = new StubWebSocket('wss://example.test');

    expect(() => {
      socket.open();
      socket.emitError();
      socket.emitJson({});
      socket.emitClose();
    }).not.toThrow();
  });
});

describe('StubSocketFactory', () => {
  it('records every socket it creates', () => {
    const factory = new StubSocketFactory();

    factory.create('wss://a.test');
    factory.create('wss://b.test');

    expect(factory.sockets).toHaveLength(2);
    expect(factory.last.url).toBe('wss://b.test');
  });

  it('throws when asked for a socket before any was created', () => {
    expect(() => new StubSocketFactory().last).toThrow(/no socket has been created/);
  });
});
