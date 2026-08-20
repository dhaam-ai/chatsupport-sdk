// Unit tests for the behaviour @dhaam-ccrm/binding-conformance does NOT cover
// — the surface that is this package's own rather than the shared cross-binding
// contract: `immediate`, `previous`, error routing, destroy semantics, the
// equality helpers' edge cases, and re-entrancy during a notification.
//
// The client double is `createConformanceChatClient` from the conformance
// package, exported for exactly this ("so a binding's own test file can build
// additional, binding-specific scenarios on top of the same faithful-to-core
// double this package's checks use, instead of hand-rolling a second one").
// Deep-frozen snapshots, reference-stable no-op patches, microtask-batched
// notification — a second, laxer double would let this package pass against a
// contract core does not actually offer.

import { createConformanceChatClient, buildMessage } from '@dhaam-ccrm/binding-conformance';
import type { ConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import { deriveTickStateFromState } from '@dhaam-ccrm/core';
import type { ChatState } from '@dhaam-ccrm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChatStore, shallowEqual, strictEqual } from '../src/index.js';

async function commit(client: ConformanceChatClient, patch: Partial<ChatState>): Promise<void> {
  client.__harness.setState(patch);
  await client.__harness.flushMicrotasks();
}

const teardown: (() => void)[] = [];
afterEach(() => {
  for (const dispose of teardown.splice(0)) dispose();
  vi.restoreAllMocks();
});

function harness(initial?: Partial<ChatState>) {
  const client = createConformanceChatClient(initial);
  const errors: unknown[] = [];
  const store = createChatStore(client, { onError: (error) => errors.push(error) });
  teardown.push(() => store.destroy());
  return { client, store, errors };
}

describe('select', () => {
  it('does not call the listener at subscribe time by default', () => {
    const { store } = harness({ unreadCount: 4 });
    const calls: number[] = [];

    store.select((state) => state.unreadCount, (value) => calls.push(value));

    expect(calls, 'the default is change-only, matching ChatClient.subscribe').toEqual([]);
  });

  it('with immediate:true delivers the current value synchronously, with previous === value', () => {
    const { store } = harness({ unreadCount: 4 });
    const calls: [number, number][] = [];

    store.select((state) => state.unreadCount, (value, previous) => calls.push([value, previous]), { immediate: true });

    expect(calls).toEqual([[4, 4]]);
  });

  it('passes the previously delivered value as `previous`', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const calls: [number, number][] = [];

    store.select((state) => state.unreadCount, (value, previous) => calls.push([value, previous]));

    await commit(client, { unreadCount: 1 });
    await commit(client, { unreadCount: 5 });

    expect(calls).toEqual([
      [1, 0],
      [5, 1],
    ]);
  });

  it('keeps the OLD selected reference when isEqual reports no change', async () => {
    const { client, store } = harness({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
    const delivered: { hasMore: boolean }[] = [];

    store.select(
      (state) => ({ hasMore: state.pagination.hasMore }),
      (value) => delivered.push(value),
      { isEqual: shallowEqual, immediate: true },
    );

    const first = delivered[0];
    await commit(client, { unreadCount: 9 });

    expect(delivered, 'an unrelated change must not deliver a new wrapper object').toHaveLength(1);

    await commit(client, { pagination: { hasMore: false, loadingMore: false, initialLoaded: true } });
    expect(delivered).toHaveLength(2);
    expect(delivered[1], 'a real change delivers a genuinely new value').not.toBe(first);
  });

  it("lets an initial selector throw escape to the caller rather than handing back a subscription with no cached value", () => {
    const { store, errors } = harness();

    expect(() =>
      store.select(() => {
        throw new Error('initial boom');
      }, () => {}),
    ).toThrow('initial boom');
    expect(errors, 'this is a caller-visible programming error, not an onError report').toEqual([]);
  });

  it('reports a throwing listener and does not starve a sibling subscription', async () => {
    const { client, store, errors } = harness({ unreadCount: 0 });
    const boom = new Error('listener boom');
    const sibling: number[] = [];

    store.select((state) => state.unreadCount, () => {
      throw boom;
    });
    store.select((state) => state.unreadCount, (value) => sibling.push(value));

    await commit(client, { unreadCount: 1 });

    expect(errors).toEqual([boom]);
    expect(sibling).toEqual([1]);
  });

  it('is idempotent on unsubscribe', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const calls: number[] = [];
    const stop = store.select((state) => state.unreadCount, (value) => calls.push(value));

    stop();
    stop();
    await commit(client, { unreadCount: 1 });

    expect(calls).toEqual([]);
  });
});

describe('re-entrancy', () => {
  it('a listener may unsubscribe a sibling mid-notification and that sibling is not called', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const cancelled: number[] = [];
    let stopCancelled: (() => void) | null = null;

    // Registered first, so it runs first in the fan-out's insertion order and
    // cancels the sibling before that sibling's own turn comes up. The
    // fan-out iterates a copy of the set, so without a liveness re-check the
    // cancelled subscription would still be called.
    store.select((state) => state.unreadCount, () => {
      stopCancelled?.();
    });
    stopCancelled = store.select((state) => state.unreadCount, (value) => cancelled.push(value));

    await commit(client, { unreadCount: 1 });

    expect(cancelled, 'unsubscribed from inside the same notification, before its turn').toEqual([]);
  });

  it('a subscription created after a change but before core flushes is not notified for a value it already holds', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const calls: unknown[] = [];

    // `setState` advances the snapshot synchronously and schedules the flush
    // for a microtask later — this is the window a widget subscribing from an
    // event handler genuinely lands in.
    client.__harness.setState({ unreadCount: 1 });

    // A composite selector on the DEFAULT reference equality: it builds a new
    // object every call, so the raw-snapshot gate is the only thing that can
    // recognise "this subscription already read exactly this snapshot".
    store.select((state) => ({ unreadCount: state.unreadCount }), (value) => calls.push(value));

    await client.__harness.flushMicrotasks();
    expect(calls, 'it read the post-change snapshot at subscribe time; the pending flush carries nothing new for it').toEqual([]);

    await commit(client, { unreadCount: 2 });
    expect(calls, 'and it participates normally from the next snapshot on').toHaveLength(1);
  });

  it('a subscription created mid-notification is not called for the snapshot that created it', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const late: number[] = [];

    store.select((state) => state.unreadCount, () => {
      store.select((s) => s.unreadCount, (value) => late.push(value));
    });

    await commit(client, { unreadCount: 1 });
    expect(late, 'it already holds the current value; re-delivering it would be a duplicate').toEqual([]);

    await commit(client, { unreadCount: 2 });
    expect(late, 'and it participates normally from the next snapshot on').toEqual([2]);
  });
});

describe('subscribe', () => {
  it('delivers the whole snapshot on every change', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const seen: ChatState[] = [];

    store.subscribe((state) => seen.push(state));
    await commit(client, { unreadCount: 1 });

    expect(seen).toHaveLength(1);
    expect(seen[0], 'the identical frozen snapshot core produced — never a clone').toBe(client.getState());
  });
});

describe('on', () => {
  it('routes a throwing handler to onError and leaves a sibling handler receiving', () => {
    const { client, store, errors } = harness();
    const boom = new Error('handler boom');
    const sibling: unknown[] = [];

    store.on('typing', () => {
      throw boom;
    });
    store.on('typing', (payload) => sibling.push(payload));

    const payload = { isTyping: true, participantId: 'p1' } as const;
    client.__harness.emit('typing', payload);

    expect(errors).toEqual([boom]);
    expect(sibling).toEqual([payload]);
  });

  it('drops the client-level registration when unsubscribed', () => {
    const { client, store } = harness();
    const stop = store.on('typing', () => {});

    expect(client.__harness.eventListenerCount('typing')).toBe(1);
    stop();
    stop();
    expect(client.__harness.eventListenerCount('typing')).toBe(0);
  });
});

describe('tick', () => {
  it('returns null for a message id that is not in state', () => {
    const { store } = harness({ messages: [] });
    expect(store.tick('nope', 'participant_local')).toBeNull();
  });

  it("agrees with core's deriveTickStateFromState rather than deriving anything locally", () => {
    const message = buildMessage({ id: 'm1', senderId: 'participant_local', seq: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    const { client, store } = harness({
      messages: [message],
      deliveredWatermarks: { participant_other: 12 },
      readWatermarks: {},
    });

    expect(store.tick('m1', 'participant_local')).toBe('delivered');
    expect(store.tick('m1', 'participant_local')).toBe(
      deriveTickStateFromState(client.getState(), message, 'participant_local'),
    );
    expect(store.tick('m1', null), 'unknown identity is a conservative no-tick, never a guess').toBeNull();
  });
});

describe('destroy', () => {
  it('drops every subscription and makes further registration throw', async () => {
    const { client, store } = harness({ unreadCount: 0 });
    const calls: number[] = [];
    store.select((state) => state.unreadCount, (value) => calls.push(value));
    store.on('typing', () => calls.push(-1));

    store.destroy();
    store.destroy();

    await commit(client, { unreadCount: 1 });
    client.__harness.emit('typing', { isTyping: true, participantId: 'p1' });

    expect(calls).toEqual([]);
    expect(client.__harness.subscriberCount()).toBe(0);
    expect(client.__harness.eventListenerCount('typing')).toBe(0);
    expect(() => store.select((s) => s.unreadCount, () => {})).toThrow(/destroyed store/);
    expect(() => store.subscribe(() => {})).toThrow(/destroyed store/);
    expect(() => store.on('typing', () => {})).toThrow(/destroyed store/);
  });

  it('leaves the connection alone by default and closes it exactly once when asked', () => {
    const clientA = createConformanceChatClient();
    const disconnectA = vi.spyOn(clientA, 'disconnect');
    createChatStore(clientA).destroy();
    expect(disconnectA, 'a store handed an existing client does not own its connection').not.toHaveBeenCalled();

    const clientB = createConformanceChatClient();
    const disconnectB = vi.spyOn(clientB, 'disconnect');
    const storeB = createChatStore(clientB);
    storeB.destroy({ disconnect: true });
    storeB.destroy({ disconnect: true });
    expect(disconnectB).toHaveBeenCalledTimes(1);
  });
});

describe('onError', () => {
  it('defaults to a single console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createConformanceChatClient({ unreadCount: 0 });
    const store = createChatStore(client);
    teardown.push(() => store.destroy());

    store.select((state) => state.unreadCount, () => {
      throw new Error('default-path boom');
    });
    await commit(client, { unreadCount: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('@dhaam-ccrm/js');
  });

  it('a throwing onError does not break the fan-out', async () => {
    const client = createConformanceChatClient({ unreadCount: 0 });
    const store = createChatStore(client, {
      onError: () => {
        throw new Error('the error handler is itself broken');
      },
    });
    teardown.push(() => store.destroy());

    const sibling: number[] = [];
    store.select((state) => state.unreadCount, () => {
      throw new Error('first');
    });
    store.select((state) => state.unreadCount, (value) => sibling.push(value));

    await commit(client, { unreadCount: 1 });
    expect(sibling).toEqual([1]);
  });
});

describe('equality helpers', () => {
  it('strictEqual is Object.is, not ===', () => {
    expect(strictEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(strictEqual(0, -0)).toBe(false);
    expect(strictEqual('a', 'a')).toBe(true);
    expect(strictEqual({}, {})).toBe(false);
  });

  it('shallowEqual compares objects one level deep', () => {
    const nested = { deep: 1 };
    expect(shallowEqual({ a: 1, b: nested }, { a: 1, b: nested })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1, b: undefined }, { a: 1, c: undefined }), 'same key count, different keys').toBe(false);
  });

  it('shallowEqual compares arrays element-wise', () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual([1, 2], [2, 1])).toBe(false);
    expect(shallowEqual([1], { 0: 1 }), 'an array and a same-keyed object are not interchangeable').toBe(false);
    expect(shallowEqual({ 0: 1 }, [1])).toBe(false);
  });

  it('shallowEqual survives the null a selector like `s => s.session` actually produces', () => {
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(null, { id: 's1' })).toBe(false);
    expect(shallowEqual({ id: 's1' }, null)).toBe(false);
    expect(shallowEqual(undefined, null)).toBe(false);
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', { 0: 'a' })).toBe(false);
  });
});
