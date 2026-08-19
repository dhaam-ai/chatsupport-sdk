// Sanity tests for the suite's own harness (src/harness/conformance-client.ts)
// — NOT part of `runBindingConformance`. These prove the double this
// package hands to every binding under test is itself faithful to core's
// real `ChatStore` contract (packages/core/src/state/store.ts): if any of
// these ever fails, the fault is in the suite, not in whatever binding is
// being tested.

import { describe, expect, it } from 'vitest';

import { createConformanceChatClient } from '../src/harness/conformance-client.js';

describe('createConformanceChatClient', () => {
  it('starts from createInitialChatState()', () => {
    const client = createConformanceChatClient();
    expect(client.getState().connectionState).toBe('idle');
    expect(client.getState().messages).toEqual([]);
  });

  it('deep-freezes every snapshot it hands out', () => {
    const client = createConformanceChatClient({ messages: [{ id: 'm1', sessionId: 's', senderId: 'p', senderType: 'CUSTOMER', type: 'TEXT', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }] });
    const state = client.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.messages)).toBe(true);
    expect(Object.isFrozen(state.messages[0])).toBe(true);
    expect(() => {
      state.unreadCount = 1;
    }).toThrow();
  });

  it('returns the identical reference from getState() until something changes', async () => {
    const client = createConformanceChatClient();
    const a = client.getState();
    expect(client.getState()).toBe(a);

    client.__harness.setState({ unreadCount: 1 });
    await client.__harness.flushMicrotasks();
    const b = client.getState();
    expect(b).not.toBe(a);
    expect(client.getState()).toBe(b);
  });

  it('treats a reference-identical patch as a no-op: no new snapshot, no notification', async () => {
    const client = createConformanceChatClient();
    const a = client.getState();
    let notifications = 0;
    client.subscribe(() => {
      notifications += 1;
    });

    client.__harness.setState({ unreadCount: client.getState().unreadCount });
    await client.__harness.flushMicrotasks();

    expect(client.getState()).toBe(a);
    expect(notifications).toBe(0);
  });

  it('batches multiple synchronous setState calls into exactly one notification carrying the final state', async () => {
    const client = createConformanceChatClient({ connectionState: 'idle', unreadCount: 0 });
    const seen: number[] = [];
    client.subscribe((state) => {
      seen.push(state.unreadCount);
    });

    client.__harness.setState({ connectionState: 'connecting' });
    client.__harness.setState({ unreadCount: 5 });
    client.__harness.setState({ unreadCount: 9 });
    await client.__harness.flushMicrotasks();

    expect(seen).toEqual([9]);
    expect(client.getState().connectionState).toBe('connecting');
  });

  it('isolates a throwing subscriber: it does not break the store or stop sibling subscribers', async () => {
    const client = createConformanceChatClient();
    const calls: string[] = [];
    client.subscribe(() => {
      calls.push('a');
      throw new Error('synthetic subscriber failure');
    });
    client.subscribe(() => {
      calls.push('b');
    });

    client.__harness.setState({ unreadCount: 1 });
    await expect(client.__harness.flushMicrotasks()).resolves.toBeUndefined();

    expect(calls).toEqual(['a', 'b']);

    // The store must still work normally afterwards.
    client.__harness.setState({ unreadCount: 2 });
    await client.__harness.flushMicrotasks();
    expect(calls).toEqual(['a', 'b', 'a', 'b']);
  });

  it('isolates a throwing event handler the same way', () => {
    const client = createConformanceChatClient();
    const calls: string[] = [];
    client.on('typing', () => {
      calls.push('a');
      throw new Error('synthetic handler failure');
    });
    client.on('typing', () => {
      calls.push('b');
    });

    expect(() => client.__harness.emit('typing', { isTyping: true, participantId: 'p1' })).not.toThrow();
    expect(calls).toEqual(['a', 'b']);
  });

  it('subscribe/on unsubscribe functions are idempotent and independently cancellable', async () => {
    const client = createConformanceChatClient();
    let aCalls = 0;
    let bCalls = 0;
    const unsubA = client.subscribe(() => {
      aCalls += 1;
    });
    client.subscribe(() => {
      bCalls += 1;
    });

    unsubA();
    expect(() => unsubA()).not.toThrow();

    client.__harness.setState({ unreadCount: 1 });
    await client.__harness.flushMicrotasks();

    expect(aCalls).toBe(0);
    expect(bCalls).toBe(1);
  });

  it('reports live subscriber/event-listener counts for lifecycle checks', () => {
    const client = createConformanceChatClient();
    expect(client.__harness.subscriberCount()).toBe(0);
    const unsub = client.subscribe(() => {});
    expect(client.__harness.subscriberCount()).toBe(1);
    unsub();
    expect(client.__harness.subscriberCount()).toBe(0);

    expect(client.__harness.eventListenerCount('message')).toBe(0);
    const unsubEvent = client.on('message', () => {});
    expect(client.__harness.eventListenerCount('message')).toBe(1);
    unsubEvent();
    expect(client.__harness.eventListenerCount('message')).toBe(0);
  });
});
