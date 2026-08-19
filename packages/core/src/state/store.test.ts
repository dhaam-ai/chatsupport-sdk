import { describe, expect, it, vi } from 'vitest';

import { createInitialChatState } from './initial-state.js';
import { ChatStateStore } from './store.js';

describe('ChatStateStore', () => {
  it('getState returns the initial idle state', () => {
    const store = new ChatStateStore(createInitialChatState());

    expect(store.getState()).toMatchObject({
      connectionState: 'idle',
      session: null,
      messages: [],
      unreadCount: 0,
    });
  });

  it('setState updates the snapshot returned by getState immediately (synchronous mutation)', () => {
    const store = new ChatStateStore(createInitialChatState());

    store.setState({ connectionState: 'connecting' });

    expect(store.getState().connectionState).toBe('connecting');
  });

  it('notifies a subscriber with the full new state, deferred to a microtask', async () => {
    const store = new ChatStateStore(createInitialChatState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ connectionState: 'connecting' });

    // Not called yet — notification is microtask-deferred, not synchronous
    // with `setState` itself.
    expect(listener).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ connectionState: 'connecting' }));
  });

  it('batches several setState calls in the same tick into exactly one notification', async () => {
    const store = new ChatStateStore(createInitialChatState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ connectionState: 'connecting' });
    store.setState({ connectionState: 'authenticating' });
    store.setState({ unreadCount: 3 });

    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ connectionState: 'authenticating', unreadCount: 3 }),
    );
  });

  it('setState accepts an updater function that receives the previous state', () => {
    const store = new ChatStateStore(createInitialChatState());

    store.setState((prev) => ({ unreadCount: prev.unreadCount + 1 }));
    store.setState((prev) => ({ unreadCount: prev.unreadCount + 1 }));

    expect(store.getState().unreadCount).toBe(2);
  });

  it('stops notifying after unsubscribe', async () => {
    const store = new ChatStateStore(createInitialChatState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ unreadCount: 1 });

    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not affect other subscribers when one unsubscribes mid-batch', async () => {
    const store = new ChatStateStore(createInitialChatState());
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.setState({ unreadCount: 1 });
    await Promise.resolve();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('schedules a fresh notification when a listener re-entrantly calls setState', async () => {
    const store = new ChatStateStore(createInitialChatState());
    const seen: number[] = [];

    store.subscribe((state) => {
      seen.push(state.unreadCount);
      // Only re-enter once, on the first notification, to avoid an infinite loop.
      if (state.unreadCount === 1) {
        store.setState({ unreadCount: 2 });
      }
    });

    store.setState({ unreadCount: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([1, 2]);
  });

  it('gives every instance its own state — no shared references across stores', () => {
    const a = new ChatStateStore(createInitialChatState());
    const b = new ChatStateStore(createInitialChatState());

    a.setState({ messages: [...a.getState().messages, { id: 'm1' } as never] });

    expect(a.getState().messages).toHaveLength(1);
    expect(b.getState().messages).toHaveLength(0);
  });
});
