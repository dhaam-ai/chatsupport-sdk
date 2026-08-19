import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ChatStore } from './store.js';
import type { ChatMessage, ChatState } from './types.js';

/** Resolves after the microtask queue drains, so a scheduled flush has run. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/** A store whose listener errors are captured instead of re-thrown. */
function makeStore(): { store: ChatStore; reportError: ReturnType<typeof vi.fn> } {
  const reportError = vi.fn();
  return { store: new ChatStore({ reportListenerError: reportError }), reportError };
}

describe('ChatStore.getState', () => {
  it('starts from the §6.4 initial state', () => {
    expect(new ChatStore().getState()).toEqual({
      connectionState: 'idle',
      session: null,
      messages: [],
      typing: { isTyping: false },
      unreadCount: 0,
      pagination: { hasMore: false, loadingMore: false },
      uploading: false,
      pastSessions: [],
      readWatermarks: {},
      deliveredWatermarks: {},
      presence: {},
      lastError: null,
    });
  });

  it('accepts an injected initial state', () => {
    const store = new ChatStore({
      initialState: { ...new ChatStore().getState(), connectionState: 'connected', unreadCount: 4 },
    });

    expect(store.getState().connectionState).toBe('connected');
    expect(store.getState().unreadCount).toBe(4);
  });

  it('returns a cached reference while nothing changes', () => {
    // React's documented requirement: an unchanged store must return the
    // identical reference, or useSyncExternalStore loops forever.
    const store = new ChatStore();

    expect(store.getState()).toBe(store.getState());
  });

  it('reflects a mutation synchronously, before the notification fires', () => {
    // Only *notification* is deferred — the state itself is current at once,
    // which is what lets an event handler read fresh state.
    const store = new ChatStore();

    store.setState({ unreadCount: 3 });

    expect(store.getState().unreadCount).toBe(3);
  });
});

describe('ChatStore snapshot identity', () => {
  it('produces a new top-level identity on every change', () => {
    const store = new ChatStore();
    const before = store.getState();

    store.setState({ unreadCount: 1 });

    expect(store.getState()).not.toBe(before);
    // Object.is is exactly what React compares with.
    expect(Object.is(store.getState(), before)).toBe(false);
  });

  it('never mutates a previously handed-out snapshot', () => {
    // The failure mode this guards: a store that mutates in place keeps one
    // stable identity, so React never re-renders and Vue never reacts.
    const store = new ChatStore();
    const before = store.getState();

    store.setState({ unreadCount: 9, connectionState: 'connected' });

    expect(before.unreadCount).toBe(0);
    expect(before.connectionState).toBe('idle');
  });

  it('keeps identity stable when a patch changes nothing', async () => {
    const store = new ChatStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();

    store.setState({ unreadCount: 0, uploading: false });
    await nextTick();

    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('treats a structurally-equal but new reference as a change', async () => {
    // Documented behaviour: comparison is by reference. Deep-diffing here
    // would be the field-level diffing §6.4 assigns to bindings.
    const store = new ChatStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();

    store.setState({ typing: { isTyping: false } });
    await nextTick();

    expect(store.getState()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('carries unchanged fields over by reference', async () => {
    // Structural sharing is what keeps deepFreeze O(new nodes) and lets
    // binding selectors short-circuit on untouched slices.
    const store = new ChatStore();
    store.setState({ messages: [makeMessage()] });
    await nextTick();
    const messages = store.getState().messages;

    store.setState({ unreadCount: 1 });

    expect(store.getState().messages).toBe(messages);
  });
});

describe('ChatStore microtask batching', () => {
  it('does not notify synchronously', () => {
    const store = new ChatStore();
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState({ unreadCount: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('collapses many mutations in one tick into a single notification', async () => {
    const store = new ChatStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ connectionState: 'connecting' });
    store.setState({ connectionState: 'authenticating' });
    store.setState({ unreadCount: 2 });
    store.setState({ uploading: true });
    await nextTick();

    // §6.4: applying a frame that changes several fields notifies once.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('delivers the final state, not the intermediate ones', async () => {
    const store = new ChatStore();
    const seen: ChatState[] = [];
    store.subscribe((state) => seen.push(state));

    store.setState({ connectionState: 'connecting' });
    store.setState({ connectionState: 'authenticating' });
    store.setState({ connectionState: 'connected' });
    await nextTick();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.connectionState).toBe('connected');
  });

  it('batches on the microtask queue, ahead of the next macrotask', async () => {
    // Proves this is microtask-batched per §6.4, not merely "deferred" — a
    // setTimeout-based implementation would invert this order.
    const store = new ChatStore();
    const order: string[] = [];

    store.subscribe(() => order.push('notified'));
    setTimeout(() => order.push('macrotask'), 0);
    store.setState({ unreadCount: 1 });

    await nextTick();

    expect(order).toEqual(['notified', 'macrotask']);
  });

  it('notifies again for a change made in a later tick', async () => {
    const store = new ChatStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ unreadCount: 1 });
    await nextTick();
    store.setState({ unreadCount: 2 });
    await nextTick();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies every listener with the same snapshot', async () => {
    const store = new ChatStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(first.mock.calls[0]?.[0]).toBe(second.mock.calls[0]?.[0]);
  });

  it('delivers the full state, never a patch or diff', async () => {
    const store = new ChatStore();
    let delivered: ChatState | undefined;
    store.subscribe((state) => {
      delivered = state;
    });

    store.setState({ unreadCount: 7 });
    await nextTick();

    expect(delivered).toBe(store.getState());
    expect(Object.keys(delivered ?? {})).toHaveLength(12);
    expect(delivered?.connectionState).toBe('idle');
  });
});

describe('ChatStore mutation during a flush', () => {
  it('does not lose a mutation made by a listener', async () => {
    const store = new ChatStore();
    let mutated = false;
    const seen: number[] = [];

    store.subscribe((state) => {
      seen.push(state.unreadCount);
      if (!mutated) {
        mutated = true;
        store.setState({ unreadCount: 100 });
      }
    });

    store.setState({ unreadCount: 1 });
    await nextTick();

    // The second value must arrive in its own pass — never swallowed by the
    // flush already in progress.
    expect(seen).toEqual([1, 100]);
    expect(store.getState().unreadCount).toBe(100);
  });

  it('does not deliver the same state twice', async () => {
    const store = new ChatStore();
    const seen: number[] = [];
    let mutated = false;

    store.subscribe((state) => {
      seen.push(state.unreadCount);
      if (!mutated) {
        mutated = true;
        store.setState({ unreadCount: 2 });
      }
    });

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(seen).toEqual([1, 2]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('settles when a listener mutates only once, without looping forever', async () => {
    const store = new ChatStore();
    const listener = vi.fn((state: ChatState) => {
      if (state.unreadCount < 3) store.setState({ unreadCount: state.unreadCount + 1 });
    });
    store.subscribe(listener);

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(store.getState().unreadCount).toBe(3);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not schedule a flush when a listener writes a no-op patch', async () => {
    const store = new ChatStore();
    const listener = vi.fn((state: ChatState) => {
      store.setState({ unreadCount: state.unreadCount });
    });
    store.subscribe(listener);

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ChatStore torn reads', () => {
  it('gives a listener the state it was notified about', async () => {
    const store = new ChatStore();
    let observed: ChatState | undefined;
    let delivered: ChatState | undefined;

    store.subscribe((state) => {
      delivered = state;
      observed = store.getState();
    });

    store.setState({ unreadCount: 5 });
    await nextTick();

    expect(observed).toBe(delivered);
  });

  it('keeps getState() consistent for later listeners after an earlier one mutates', async () => {
    // The core tearing scenario: without a pinned notifying snapshot, the
    // second listener would read state the first listener never saw.
    const store = new ChatStore();
    const observed: Array<{ delivered: number; read: number }> = [];
    let mutated = false;

    store.subscribe(() => {
      if (!mutated) {
        mutated = true;
        store.setState({ unreadCount: 999 });
      }
    });
    store.subscribe((state) => {
      observed.push({ delivered: state.unreadCount, read: store.getState().unreadCount });
    });

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(observed[0]).toEqual({ delivered: 1, read: 1 });
  });

  it('returns the newest state again once the pass ends', async () => {
    const store = new ChatStore();
    let mutated = false;
    store.subscribe(() => {
      if (!mutated) {
        mutated = true;
        store.setState({ unreadCount: 42 });
      }
    });

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(store.getState().unreadCount).toBe(42);
  });

  it('does not strand the store in a notifying state when a listener throws', async () => {
    // If #notifying leaked, getState() would return a stale snapshot forever.
    const { store } = makeStore();
    store.subscribe(() => {
      throw new Error('boom');
    });

    store.setState({ unreadCount: 1 });
    await nextTick();
    store.setState({ unreadCount: 2 });
    await nextTick();

    expect(store.getState().unreadCount).toBe(2);
  });
});

describe('ChatStore external mutation', () => {
  it('rejects mutation of the messages array', async () => {
    const store = new ChatStore();
    store.setState({ messages: [makeMessage()] });
    await nextTick();
    const state = store.getState();

    expect(() => state.messages.push(makeMessage({ id: 'injected' }))).toThrow(TypeError);
    expect(store.getState().messages).toHaveLength(1);
  });

  it('rejects mutation of a message inside the array', () => {
    const store = new ChatStore();
    store.setState({ messages: [makeMessage()] });
    const message = store.getState().messages[0];

    expect(() => {
      (message as { content: string }).content = 'tampered';
    }).toThrow(TypeError);
    expect(store.getState().messages[0]?.content).toBe('hello');
  });

  it('rejects top-level field assignment', () => {
    const state = new ChatStore().getState();

    expect(() => {
      (state as { unreadCount: number }).unreadCount = 999;
    }).toThrow(TypeError);
  });

  it('rejects mutation of nested records and objects', () => {
    const store = new ChatStore();
    store.setState({ readWatermarks: { 'agent-1': '2026-01-01T00:00:00.000Z' } });
    const state = store.getState();

    expect(() => {
      state.readWatermarks['agent-1'] = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      (state.pagination as { hasMore: boolean }).hasMore = true;
    }).toThrow(TypeError);
  });

  it('freezes state handed in through the constructor', () => {
    const initialState = { ...new ChatStore().getState(), messages: [makeMessage()] };
    const store = new ChatStore({ initialState });

    expect(() => store.getState().messages.push(makeMessage())).toThrow(TypeError);
  });

  it('survives a consumer attempting to corrupt it', async () => {
    const store = new ChatStore();
    store.setState({ messages: [makeMessage()] });
    await nextTick();

    const state = store.getState();
    try {
      state.messages.push(makeMessage({ id: 'evil' }));
    } catch {
      // Expected — the point is the store below, not the throw.
    }

    store.setState({ unreadCount: 1 });
    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]?.id).toBe('msg-1');
  });
});

describe('ChatStore subscription management', () => {
  it('does not notify on registration', () => {
    const store = new ChatStore();
    const listener = vi.fn();

    store.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const store = new ChatStore();
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(listener).not.toHaveBeenCalled();
    expect(store.listenerCount).toBe(0);
  });

  it('treats a second unsubscribe as a safe no-op', async () => {
    const store = new ChatStore();
    const other = vi.fn();
    const unsubscribe = store.subscribe(vi.fn());
    store.subscribe(other);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    store.setState({ unreadCount: 1 });
    await nextTick();

    // A naive double-unsubscribe could evict an unrelated registration.
    expect(store.listenerCount).toBe(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale unsubscribe cancel a later registration of the same function', async () => {
    const store = new ChatStore();
    const listener = vi.fn();

    const first = store.subscribe(listener);
    store.subscribe(listener);
    first();
    first();

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies independent listeners independently', async () => {
    const store = new ChatStore();
    const first = vi.fn();
    const second = vi.fn();
    const unsubFirst = store.subscribe(first);
    store.subscribe(second);

    store.setState({ unreadCount: 1 });
    await nextTick();
    unsubFirst();
    store.setState({ unreadCount: 2 });
    await nextTick();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe('ChatStore re-entrancy during notification', () => {
  it('does not skip siblings when a listener unsubscribes itself', async () => {
    const store = new ChatStore();
    const calls: string[] = [];

    const unsubFirst = store.subscribe(() => {
      calls.push('first');
      unsubFirst();
    });
    store.subscribe(() => calls.push('second'));
    store.subscribe(() => calls.push('third'));

    store.setState({ unreadCount: 1 });
    await nextTick();

    // Mutating the set mid-iteration must not shift later listeners out.
    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('does not notify a listener unsubscribed earlier in the same pass', async () => {
    const store = new ChatStore();
    const later = vi.fn();

    let unsubLater = (): void => {};
    store.subscribe(() => unsubLater());
    unsubLater = store.subscribe(later);

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(later).not.toHaveBeenCalled();
  });

  it('does not deliver the current pass to a listener registered during it', async () => {
    const store = new ChatStore();
    const lateListener = vi.fn();

    store.subscribe(() => {
      store.subscribe(lateListener);
    });

    store.setState({ unreadCount: 1 });
    await nextTick();
    expect(lateListener).not.toHaveBeenCalled();

    store.setState({ unreadCount: 2 });
    await nextTick();
    expect(lateListener).toHaveBeenCalledTimes(1);
  });
});

describe('ChatStore listener error isolation', () => {
  it('still notifies siblings when a listener throws', async () => {
    const { store, reportError } = makeStore();
    const after = vi.fn();

    store.subscribe(() => {
      throw new Error('listener blew up');
    });
    store.subscribe(after);

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(after).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('reports every throwing listener, not just the first', async () => {
    const { store, reportError } = makeStore();

    store.subscribe(() => {
      throw new Error('one');
    });
    store.subscribe(() => {
      throw new Error('two');
    });

    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('keeps the store working for later changes', async () => {
    const { store } = makeStore();
    const healthy = vi.fn();

    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(healthy);

    store.setState({ unreadCount: 1 });
    await nextTick();
    store.setState({ unreadCount: 2 });
    await nextTick();

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(store.getState().unreadCount).toBe(2);
  });

  it('does not swallow the error by default', async () => {
    // No reporter injected: the error must still surface, on a fresh
    // macrotask, rather than vanishing inside the notify loop.
    const store = new ChatStore();
    const thrown = new Error('surfaced');
    const scheduled: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;

    store.subscribe(() => {
      throw thrown;
    });
    store.setState({ unreadCount: 1 });

    globalThis.setTimeout = ((callback: () => void) => {
      scheduled.push(callback);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
    try {
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow(thrown);
  });

  it('routes event-handler errors through the same reporter', async () => {
    const { store, reportError } = makeStore();

    store.on('message', () => {
      throw new Error('handler blew up');
    });
    store.emit('message', makeMessage());

    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe('ChatStore event surface', () => {
  it('delivers events through on/emit', () => {
    const store = new ChatStore();
    const handler = vi.fn();

    store.on('ticketLinked', handler);
    store.emit('ticketLinked', { ticketId: 'T-1', ticketUrl: 'https://x/T-1' });

    expect(handler).toHaveBeenCalledWith({ ticketId: 'T-1', ticketUrl: 'https://x/T-1' });
  });

  it('lets an event handler read state that already includes the change', () => {
    // State applies synchronously; only notification is batched. So a
    // transport applying a frame then emitting sees a consistent pair.
    const store = new ChatStore();
    let seen = -1;

    store.on('message', () => {
      seen = store.getState().messages.length;
    });

    store.setState({ messages: [makeMessage()] });
    store.emit('message', makeMessage());

    expect(seen).toBe(1);
  });

  it('unsubscribes an event handler independently of state listeners', async () => {
    const store = new ChatStore();
    const stateListener = vi.fn();
    const eventHandler = vi.fn();

    store.subscribe(stateListener);
    const off = store.on('tokenRefreshed', eventHandler);
    off();

    store.emit('tokenRefreshed', {});
    store.setState({ unreadCount: 1 });
    await nextTick();

    expect(eventHandler).not.toHaveBeenCalled();
    expect(stateListener).toHaveBeenCalledTimes(1);
  });
});

describe('ChatStore typing', () => {
  it('infers an on() handler payload with no annotation', () => {
    const store = new ChatStore();

    store.on('message', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<ChatMessage>();
    });
    store.on('suspended', (payload) => {
      expectTypeOf(payload.reason).toEqualTypeOf<'auth' | 'maxAttempts' | 'protocol'>();
    });
    store.on('presenceUpdate', (payload) => {
      expectTypeOf(payload).toHaveProperty('participantId');
    });

    expect(store.getState()).toBeDefined();
  });

  it('types subscribe listeners with the full ChatState', () => {
    const store = new ChatStore();

    store.subscribe((state) => {
      expectTypeOf(state).toEqualTypeOf<ChatState>();
      expectTypeOf(state.connectionState).toEqualTypeOf<ChatState['connectionState']>();
    });

    expect(store.listenerCount).toBe(1);
  });

  it('rejects an unknown field and a mistyped value in setState', () => {
    const store = new ChatStore();

    // @ts-expect-error — not a field of ChatState.
    store.setState({ notAField: true });

    // @ts-expect-error — unreadCount is a number.
    store.setState({ unreadCount: 'three' });

    // @ts-expect-error — 'reconnected' is not a §8.1 connection state.
    store.setState({ connectionState: 'reconnected' });

    expect(store.getState()).toBeDefined();
  });
});
