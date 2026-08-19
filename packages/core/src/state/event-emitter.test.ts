import { describe, expect, it, vi } from 'vitest';

import { ChatEventEmitter } from './event-emitter.js';

interface TestEventMap {
  ping: { n: number };
  pong: Record<string, never>;
  [key: string]: unknown;
}

describe('ChatEventEmitter', () => {
  it('calls a registered handler with the emitted payload', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const handler = vi.fn();
    emitter.on('ping', handler);

    emitter.emit('ping', { n: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('emits synchronously — no microtask deferral', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const handler = vi.fn();
    emitter.on('ping', handler);

    emitter.emit('ping', { n: 1 });

    // Called immediately, unlike ChatStateStore's batched notifications.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not throw when emitting an event with no listeners', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();

    expect(() => emitter.emit('ping', { n: 1 })).not.toThrow();
  });

  it('calls every listener registered for the same event', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('ping', a);
    emitter.on('ping', b);

    emitter.emit('ping', { n: 1 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not call a listener registered for a different event', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const pingHandler = vi.fn();
    const pongHandler = vi.fn();
    emitter.on('ping', pingHandler);
    emitter.on('pong', pongHandler);

    emitter.emit('ping', { n: 1 });

    expect(pingHandler).toHaveBeenCalledTimes(1);
    expect(pongHandler).not.toHaveBeenCalled();
  });

  it('stops calling a handler after its unsubscribe function runs', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const handler = vi.fn();
    const unsubscribe = emitter.on('ping', handler);

    unsubscribe();
    emitter.emit('ping', { n: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribing one handler does not affect another handler for the same event', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = emitter.on('ping', a);
    emitter.on('ping', b);

    unsubscribeA();
    emitter.emit('ping', { n: 1 });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not call a listener that unsubscribes itself during the same emit pass a second time', () => {
    const emitter = new ChatEventEmitter<TestEventMap>();
    let calls = 0;
    let unsubscribe: () => void = () => {};
    unsubscribe = emitter.on('ping', () => {
      calls += 1;
      unsubscribe();
    });

    emitter.emit('ping', { n: 1 });
    emitter.emit('ping', { n: 2 });

    expect(calls).toBe(1);
  });
});
