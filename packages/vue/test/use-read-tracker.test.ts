// @vitest-environment jsdom
//
// jsdom has no IntersectionObserver at all, so the stub below is not a
// convenience — it is the only way to drive this composable without a real
// browser. It is a faithful stub of the *contract* rather than a shortcut:
// `observe`/`unobserve`/`disconnect` maintain a real registration set (so the
// lifecycle assertions mean something) and `trigger` hands the callback
// whatever `intersectionRatio` the test names — copied down from
// packages/react/test/use-read-tracker.test.ts, which already proved this
// shape against @dhaam-ccrm/browser's `createReadTracker`.
//
// Unlike that file, this one is not re-testing the two-watermark logic itself
// (delivered-vs-read, debounce, monotonicity) — that is @dhaam-ccrm/browser's
// contract and the React suite already exercises it in depth. What is
// specific to THIS binding: `root` and `enabled` are reactive (`watch`
// wiring this file owns), a template ref starts `null` during `setup()`, and
// teardown goes through `onChatScopeDispose` (scope.ts) rather than
// `onUnmounted`.

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatMessage } from '@dhaam-ccrm/core';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { createChatPlugin, useReadTracker } from '../src/index.js';
import { runInChatScope, runWithNoScope } from './harness.js';

enableAutoUnmount(afterEach);

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number>;
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) {
    this.root = (init?.root as Element | null) ?? null;
    const threshold = init?.threshold;
    this.thresholds = typeof threshold === 'number' ? [threshold] : (threshold ?? [0]);
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Drives the callback with a hand-built entry per (element, ratio) pair. */
  trigger(pairs: ReadonlyArray<{ target: Element; ratio: number }>): void {
    const entries = pairs.map(({ target, ratio }) => ({
      target,
      intersectionRatio: ratio,
      isIntersecting: ratio > 0,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    })) as unknown as IntersectionObserverEntry[];
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

function latestObserver(): FakeIntersectionObserver {
  const observer = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  if (observer === undefined) throw new Error('no IntersectionObserver was constructed');
  return observer;
}

function makeMessage(id: string, seq: number | undefined): ChatMessage {
  return {
    id,
    sessionId: 'session_1',
    senderId: 'participant_other',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-08-19T10:00:00.000Z',
    ...(seq === undefined ? {} : { seq }),
  };
}

function mountWith(client: ReturnType<typeof createConformanceChatClient>, setup: () => () => unknown) {
  return mount(defineComponent({ setup }), { global: { plugins: [createChatPlugin(client)] } });
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIntersectionObserver;
});

// ---------------------------------------------------------------------------
// Property: the root is reactive — null during setup(), adopted once a
// template ref fills in.
// ---------------------------------------------------------------------------

describe('useReadTracker — reactive root', () => {
  it('constructs with a null root (the template ref is still empty during setup), then rebuilds once it adopts the mounted element', async () => {
    const client = createConformanceChatClient({ messages: [] });

    const wrapper = mountWith(client, () => {
      const rootRef = ref<HTMLDivElement | null>(null);
      useReadTracker(rootRef, { onDelivered: vi.fn(), onRead: vi.fn() });
      return () => h('div', { ref: rootRef });
    });

    // The very first observer this composable built saw `root: null` — proof
    // it was constructed before the template ref had anything to give it,
    // exactly as `useReadTracker`'s own doc comment describes.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(FakeIntersectionObserver.instances[0]?.root).toBeNull();

    // The `watch(() => toValue(root) ?? null, ...)` wiring picks up the
    // now-mounted element on the next flush and rebuilds against it.
    await nextTick();

    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    const rebuilt = latestObserver();
    expect(rebuilt.root).toBe(wrapper.element);
    expect(FakeIntersectionObserver.instances[0]?.disconnected, 'the null-root observer is torn down, not left running').toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Property: enabled is reactive, and toggling it must not forget what was
// already reported.
// ---------------------------------------------------------------------------

describe('useReadTracker — reactive enabled', () => {
  it('reports delivered as soon as a row registers, before anything is visible', () => {
    vi.useFakeTimers();
    const client = createConformanceChatClient({ messages: [makeMessage('m1', 5)] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const row = document.createElement('div');

    const { value: api, stop } = runInChatScope(client, () => useReadTracker(ref(null), { onDelivered, onRead }));
    api.observeMessage(row, 'm1');

    expect(onDelivered, 'debounced — not synchronous with registration').not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(5);
    expect(onRead).not.toHaveBeenCalled();

    stop();
  });

  it('tears the observer down and rebuilds it on toggle, without forgetting watermarks already reported', async () => {
    vi.useFakeTimers();
    const client = createConformanceChatClient({ messages: [makeMessage('m1', 1), makeMessage('m2', 2)] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const enabled = ref(true);
    const row1 = document.createElement('div');
    const row2 = document.createElement('div');

    const { value: api } = runInChatScope(client, () => useReadTracker(ref(null), { onDelivered, onRead, enabled }));
    api.observeMessage(row1, 'm1');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(1);

    latestObserver().trigger([{ target: row1, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m1');

    // Pause — the widget collapsed, or the tab went hidden. The observer
    // must be gone, but nothing reported so far is forgotten.
    enabled.value = false;
    await nextTick();
    expect(latestObserver().disconnected).toBe(true);

    // Resume — a fresh observer, re-observing the still-registered row.
    enabled.value = true;
    await nextTick();
    const rebuilt = latestObserver();
    expect(rebuilt.disconnected).toBe(false);
    expect(rebuilt.observed.has(row1)).toBe(true);

    // The freshly (re)built observer sees row1 as visible again — real
    // IntersectionObservers commonly fire on a fresh observe() — and the read
    // watermark must not re-report a row already reported before the pause.
    rebuilt.trigger([{ target: row1, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead, 'losing the watermark on toggle would have re-reported m1 as newly read').toHaveBeenCalledTimes(1);

    // A genuinely new row still reports normally — the pause did not wedge
    // delivery for anything registered afterwards.
    api.observeMessage(row2, 'm2');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(2);
    expect(onDelivered).toHaveBeenLastCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// Property: teardown goes through the effect scope, not through unmount.
// ---------------------------------------------------------------------------

describe('useReadTracker — teardown', () => {
  it('disconnects the observer when the owning effect scope stops', () => {
    const client = createConformanceChatClient({ messages: [] });
    const row = document.createElement('div');

    const { value: api, stop } = runInChatScope(client, () =>
      useReadTracker(ref(null), { onDelivered: vi.fn(), onRead: vi.fn() }),
    );
    api.observeMessage(row, 'm1');
    const observer = latestObserver();
    expect(observer.disconnected).toBe(false);

    stop();

    expect(observer.disconnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property: no active scope warns rather than silently leaking, and the
// tracker handed back is still fully functional.
// ---------------------------------------------------------------------------

describe('useReadTracker — no active effect scope', () => {
  it('warns instead of leaking, and the tracker it hands back still works', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createConformanceChatClient({ messages: [makeMessage('m1', 1)] });
    const onDelivered = vi.fn();

    const api = runWithNoScope(client, () => useReadTracker(ref(null), { onDelivered, onRead: vi.fn() }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('useReadTracker');
    expect(warn.mock.calls[0]?.[0]).toContain('no active effect scope');

    const row = document.createElement('div');
    api.observeMessage(row, 'm1');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(1);

    warn.mockRestore();
  });
});
