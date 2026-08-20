// @vitest-environment node
//
// The selector primitive, tested with no DOM at all — `useChatSelector` is pure
// reactivity plus one `subscribe`, and running these in vitest's `node`
// environment is what proves it (a jsdom-backed run could pass for the wrong
// reason if something reached for `window`).
//
// Uses `createConformanceChatClient` rather than a second hand-rolled fake:
// @dhaam-ccrm/binding-conformance exports it precisely so a binding's own tests
// can build on the same faithful-to-core double the shared suite uses —
// deep-frozen snapshots, reference-stable no-op patches, microtask-batched
// notification.

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatState } from '@dhaam-ccrm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProxy, watch } from 'vue';

import { shallowEqual, useChatSelector } from '../src/index.js';
import { runInChatScope, runWithNoScope } from './harness.js';

/** Mounts one selector plus a synchronous update counter, exactly as a component's render effect would depend on it. */
function observe<T>(
  client: ReturnType<typeof createConformanceChatClient>,
  selector: (state: ChatState) => T,
  isEqual?: (a: T, b: T) => boolean,
) {
  return runInChatScope(client, () => {
    const selected = isEqual === undefined ? useChatSelector(selector) : useChatSelector(selector, isEqual);
    let updates = 0;
    // `flush: 'sync'` so the count reflects the ref's own change propagation
    // rather than Vue's component-update scheduling, which is not what this
    // file is about.
    watch(selected, () => {
      updates += 1;
    }, { flush: 'sync' });
    return { selected, updates: () => updates };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChatSelector', () => {
  it('exposes selector(getState()) before anything has changed', () => {
    const client = createConformanceChatClient({ unreadCount: 4 });
    const { value, stop } = observe(client, (s) => s.unreadCount);

    expect(value.selected.value).toBe(4);
    expect(value.updates()).toBe(0);
    stop();
  });

  it('exposes the frozen snapshot itself, never a reactive proxy of it', () => {
    // The whole `shallowRef`-not-`ref` decision, made checkable. `ref()` would
    // hand back `reactive(value)` for any extensible object, and every
    // `Object.is` comparison against a raw slice — including the ones inside
    // this module — would silently stop matching.
    const client = createConformanceChatClient({ unreadCount: 1 });
    const whole = observe(client, (s) => s);
    const composite = observe(client, (s) => ({ unreadCount: s.unreadCount }));

    expect(whole.value.selected.value).toBe(client.getState());
    expect(isProxy(whole.value.selected.value)).toBe(false);
    expect(isProxy(composite.value.selected.value)).toBe(false);

    whole.stop();
    composite.stop();
  });

  it('does not update when an unrelated field changes', async () => {
    const client = createConformanceChatClient({ typing: { isTyping: true, participantId: 'agent_1' } });
    const { value, stop } = observe(client, (s) => s.typing);
    const before = value.selected.value;

    client.__harness.setState({ unreadCount: 1 });
    await client.__harness.flushMicrotasks();
    expect(value.updates()).toBe(0);
    expect(value.selected.value).toBe(before);

    client.__harness.setState({ messages: [] , unreadCount: 2 });
    await client.__harness.flushMicrotasks();
    expect(value.updates()).toBe(0);
    expect(value.selected.value).toBe(before);

    stop();
  });

  it('updates exactly once when the selected field itself changes', async () => {
    const client = createConformanceChatClient({ typing: { isTyping: true } });
    const { value, stop } = observe(client, (s) => s.typing);

    client.__harness.setState({ typing: { isTyping: false } });
    await client.__harness.flushMicrotasks();

    expect(value.updates()).toBe(1);
    expect(value.selected.value).toEqual({ isTyping: false });
    stop();
  });

  it('delivers one update carrying every field of a synchronous batch', async () => {
    const client = createConformanceChatClient({ connectionState: 'idle', unreadCount: 0 });
    const { value, stop } = observe(
      client,
      (s) => ({ connectionState: s.connectionState, unreadCount: s.unreadCount }),
      shallowEqual,
    );

    client.__harness.setState({ connectionState: 'connected' });
    client.__harness.setState({ unreadCount: 4 });
    await client.__harness.flushMicrotasks();

    expect(value.selected.value).toEqual({ connectionState: 'connected', unreadCount: 4 });
    expect(value.updates()).toBe(1);
    stop();
  });

  it('suppresses the update when a composite selector rebuilds a shallow-equal object', async () => {
    const client = createConformanceChatClient({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
    const { value, stop } = observe(client, (s) => ({ hasMore: s.pagination.hasMore }), shallowEqual);

    client.__harness.setState({ unreadCount: 7 });
    await client.__harness.flushMicrotasks();
    expect(value.updates()).toBe(0);

    client.__harness.setState({ pagination: { hasMore: false, loadingMore: false, initialLoaded: true } });
    await client.__harness.flushMicrotasks();
    expect(value.updates()).toBe(1);
    expect(value.selected.value).toEqual({ hasMore: false });
    stop();
  });

  it('without a custom isEqual, the same composite selector updates on every notification (the negative control)', async () => {
    // Proves the previous test is testing `isEqual` and not something that
    // would have held anyway: identical selector, default `Object.is`, and a
    // fresh object literal per call is never `Object.is`-equal.
    const client = createConformanceChatClient({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
    const { value, stop } = observe(client, (s) => ({ hasMore: s.pagination.hasMore }));

    client.__harness.setState({ unreadCount: 7 });
    await client.__harness.flushMicrotasks();

    expect(value.updates()).toBe(1);
    stop();
  });

  it('keeps working after a selector throws, and does not latch on the snapshot it failed for', async () => {
    const client = createConformanceChatClient({ unreadCount: 0 });
    const { value, stop } = observe(client, (s) => {
      if (s.unreadCount === 13) throw new Error('synthetic selector failure');
      return s.unreadCount;
    });

    client.__harness.setState({ unreadCount: 13 });
    await client.__harness.flushMicrotasks();
    // The throw propagated into ChatStore's per-listener isolation; the last
    // good value stands rather than a half-applied one.
    expect(value.selected.value).toBe(0);
    expect(value.updates()).toBe(0);

    client.__harness.setState({ unreadCount: 14 });
    await client.__harness.flushMicrotasks();
    expect(value.selected.value).toBe(14);
    expect(value.updates()).toBe(1);

    stop();
  });

  it('does not re-run the selector for a notification carrying the snapshot it already selected from', () => {
    // Core's store never emits a redundant notification, but `ChatClient.subscribe`
    // does not promise that — this is the guard that makes a client which does
    // free rather than quadratic in selector cost.
    const client = createConformanceChatClient({ unreadCount: 1 });
    let captured: ((state: ChatState) => void) | null = null;
    const realSubscribe = client.subscribe.bind(client);
    vi.spyOn(client, 'subscribe').mockImplementation((listener) => {
      captured = listener;
      return realSubscribe(listener);
    });

    let selectorRuns = 0;
    const { value, stop } = observe(client, (s) => {
      selectorRuns += 1;
      return s.unreadCount;
    });

    expect(selectorRuns, 'once, for the initial value').toBe(1);

    const notify = captured as unknown as (state: ChatState) => void;
    notify(client.getState());
    notify(client.getState());

    expect(selectorRuns, 'two redundant notifications, no re-selection').toBe(1);
    expect(value.updates()).toBe(0);
    stop();
  });

  it('releases its subscription when the effect scope stops', () => {
    const client = createConformanceChatClient();
    expect(client.__harness.subscriberCount()).toBe(0);

    const { stop } = observe(client, (s) => s.unreadCount);
    expect(client.__harness.subscriberCount()).toBe(1);

    stop();
    expect(client.__harness.subscriberCount()).toBe(0);
  });

  it('leaks nothing across ten create/stop cycles outside a component', () => {
    const client = createConformanceChatClient();

    for (let cycle = 0; cycle < 10; cycle += 1) {
      const { stop } = observe(client, (s) => s.unreadCount);
      stop();
      expect(client.__harness.subscriberCount(), `cycle ${cycle}`).toBe(0);
    }
  });

  it('warns, rather than silently leaking, when called with no active effect scope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createConformanceChatClient({ unreadCount: 1 });

    const selected = runWithNoScope(client, () => useChatSelector((s) => s.unreadCount));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('no active effect scope');

    // Still correct, just untearable-down — that is exactly what the warning says.
    client.__harness.setState({ unreadCount: 2 });
    await client.__harness.flushMicrotasks();
    expect(selected.value).toBe(2);
    expect(client.__harness.subscriberCount()).toBe(1);
  });
});
