import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ChatEventEmitter } from './emitter.js';
import type { ChatMessage } from './types.js';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    senderId: 'user-1',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ChatEventEmitter delivery', () => {
  it('delivers a payload to a registered handler', () => {
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    emitter.on('typing', handler);
    emitter.emit('typing', { isTyping: true, participantId: 'agent-7' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ isTyping: true, participantId: 'agent-7' });
  });

  it('delivers synchronously, not on a later tick', () => {
    // Events are discrete occurrences, unlike batched state notifications.
    const emitter = new ChatEventEmitter();
    let seen = false;

    emitter.on('tokenRefreshed', () => {
      seen = true;
    });
    emitter.emit('tokenRefreshed', {});

    expect(seen).toBe(true);
  });

  it('does not collapse repeated events the way state notifications collapse', () => {
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.emit('message', makeMessage({ id: 'a' }));
    emitter.emit('message', makeMessage({ id: 'b' }));

    // Two messages are two events — batching them would lose one.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ id: 'a' });
    expect(handler.mock.calls[1]?.[0]).toMatchObject({ id: 'b' });
  });

  it('only notifies handlers of the emitted event', () => {
    const emitter = new ChatEventEmitter();
    const onMessage = vi.fn();
    const onError = vi.fn();

    emitter.on('message', onMessage);
    emitter.on('error', onError);
    emitter.emit('message', makeMessage());

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is registered', () => {
    const emitter = new ChatEventEmitter();

    expect(() => emitter.emit('disconnected', { reason: 'network' })).not.toThrow();
  });
});

describe('ChatEventEmitter subscription management', () => {
  it('stops delivering after unsubscribe', () => {
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    const unsubscribe = emitter.on('message', handler);
    unsubscribe();
    emitter.emit('message', makeMessage());

    expect(handler).not.toHaveBeenCalled();
    expect(emitter.listenerCount('message')).toBe(0);
  });

  it('treats a second unsubscribe as a safe no-op', () => {
    const emitter = new ChatEventEmitter();
    const unsubscribe = emitter.on('message', vi.fn());

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(emitter.listenerCount('message')).toBe(0);
  });

  it('does not let a stale unsubscribe cancel a later registration of the same function', () => {
    // The hazard a Set of bare functions would create: same identity, two
    // independent registrations.
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    const first = emitter.on('message', handler);
    const second = emitter.on('message', handler);
    expect(emitter.listenerCount('message')).toBe(2);

    first();
    first(); // repeated, must not touch `second`

    emitter.emit('message', makeMessage());
    expect(handler).toHaveBeenCalledTimes(1);

    second();
    expect(emitter.listenerCount('message')).toBe(0);
  });

  it('registers the same function twice as two independent handlers', () => {
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    emitter.on('tokenRefreshed', handler);
    emitter.on('tokenRefreshed', handler);
    emitter.emit('tokenRefreshed', {});

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('drops every registration on clear()', () => {
    const emitter = new ChatEventEmitter();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.on('error', handler);
    emitter.clear();
    emitter.emit('message', makeMessage());

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ChatEventEmitter re-entrancy', () => {
  it('does not skip siblings when a handler unsubscribes during delivery', () => {
    const emitter = new ChatEventEmitter();
    const calls: string[] = [];

    const unsubFirst = emitter.on('message', () => {
      calls.push('first');
      unsubFirst();
    });
    emitter.on('message', () => calls.push('second'));
    emitter.on('message', () => calls.push('third'));

    emitter.emit('message', makeMessage());

    // Removing an earlier element mid-iteration must not shift the rest out
    // of the pass.
    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('does not call a handler unsubscribed earlier in the same pass', () => {
    const emitter = new ChatEventEmitter();
    const later = vi.fn();

    let unsubLater = (): void => {};
    emitter.on('message', () => unsubLater());
    unsubLater = emitter.on('message', later);

    emitter.emit('message', makeMessage());

    // Iterating a snapshot alone would still call `later`; the live-set
    // re-check is what prevents it.
    expect(later).not.toHaveBeenCalled();
  });

  it('does not deliver the current event to a handler registered during delivery', () => {
    const emitter = new ChatEventEmitter();
    const lateHandler = vi.fn();

    emitter.on('message', () => {
      emitter.on('message', lateHandler);
    });
    emitter.emit('message', makeMessage());

    expect(lateHandler).not.toHaveBeenCalled();

    emitter.emit('message', makeMessage());
    expect(lateHandler).toHaveBeenCalledTimes(1);
  });
});

describe('ChatEventEmitter error isolation', () => {
  it('still notifies siblings when a handler throws', () => {
    const reportError = vi.fn();
    const emitter = new ChatEventEmitter(reportError);
    const after = vi.fn();

    emitter.on('message', () => {
      throw new Error('handler blew up');
    });
    emitter.on('message', after);

    emitter.emit('message', makeMessage());

    expect(after).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('does not let a throwing handler escape emit()', () => {
    const emitter = new ChatEventEmitter(vi.fn());

    emitter.on('error', () => {
      throw new Error('nope');
    });

    expect(() =>
      emitter.emit('error', {
        source: 'transport',
        code: null,
        message: 'socket closed',
        retryable: true,
      }),
    ).not.toThrow();
  });

  it('reports every throwing handler, not just the first', () => {
    const reportError = vi.fn();
    const emitter = new ChatEventEmitter(reportError);

    emitter.on('tokenRefreshed', () => {
      throw new Error('one');
    });
    emitter.on('tokenRefreshed', () => {
      throw new Error('two');
    });

    emitter.emit('tokenRefreshed', {});

    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('keeps working for later events after a handler throws', () => {
    const emitter = new ChatEventEmitter(vi.fn());
    const healthy = vi.fn();

    emitter.on('message', () => {
      throw new Error('boom');
    });
    emitter.on('message', healthy);

    emitter.emit('message', makeMessage());
    emitter.emit('message', makeMessage());

    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('rethrows asynchronously by default rather than swallowing', async () => {
    // The default reporter must not be a silent catch. It defers to a fresh
    // macrotask so the error reaches the platform's unhandled-error path.
    const emitter = new ChatEventEmitter();
    const thrown = new Error('surfaced');
    const scheduled: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;

    globalThis.setTimeout = ((callback: () => void) => {
      scheduled.push(callback);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;

    try {
      emitter.on('tokenRefreshed', () => {
        throw thrown;
      });
      emitter.emit('tokenRefreshed', {});
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow(thrown);
  });
});

describe('ChatEventEmitter typing', () => {
  it('infers the handler payload from the event name with no annotation', () => {
    const emitter = new ChatEventEmitter();

    emitter.on('message', (payload) => {
      expectTypeOf(payload).toHaveProperty('content');
      expectTypeOf(payload.senderType).toEqualTypeOf<ChatMessage['senderType']>();
    });
    emitter.on('reconnecting', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ attempt: number; delayMs: number }>();
    });

    expect(emitter.listenerCount('message')).toBe(1);
  });

  it('rejects a mistyped handler and a mistyped payload', () => {
    const emitter = new ChatEventEmitter();

    // @ts-expect-error — `message` delivers a ChatMessage, not a string.
    emitter.on('message', (payload: string) => payload.length);

    // @ts-expect-error — `reconnecting` requires attempt and delayMs.
    emitter.emit('reconnecting', { attempt: 1 });

    // @ts-expect-error — not an event in the §6.5 catalog.
    emitter.on('messageDelivered', () => {});

    expect(emitter.listenerCount('message')).toBe(1);
  });
});
