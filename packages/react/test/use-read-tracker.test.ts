// @vitest-environment jsdom
//
// jsdom has no IntersectionObserver at all, so the stub below is not a
// convenience — it is the only way to drive this hook without a real browser.
// It is deliberately a faithful stub of the *contract* rather than a
// convenience shim: `observe`/`unobserve`/`disconnect` maintain a real
// registration set (so the unmount assertions mean something), and `trigger`
// hands the callback whatever `intersectionRatio` the test names, which is
// what lets the 60%-threshold assertions be real assertions instead of
// restatements of the stub's behaviour.

import type { ChatMessage } from '@dhaam-ccrm/core';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider } from '../src/context.js';
import { useReadTracker } from '../src/use-read-tracker.js';
import type { UseReadTrackerOptions, UseReadTrackerResult } from '../src/use-read-tracker.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

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

/**
 * `Array.prototype.at` is ES2022 and this repo's tsconfig.base.json targets
 * ES2020 — vitest's esbuild transform accepts it, `tsc --noEmit -p
 * tsconfig.test.json` does not. Same semantics, no lib bump.
 */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function latestObserver(): FakeIntersectionObserver {
  const observer = last(FakeIntersectionObserver.instances);
  if (observer === undefined) throw new Error('no IntersectionObserver was constructed');
  return observer;
}

function makeMessage(id: string, seq: number | undefined): ChatMessage {
  return {
    id,
    sessionId: 'sess_1',
    senderId: 'agent_1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-08-19T10:00:00.000Z',
    ...(seq === undefined ? {} : { seq }),
  };
}

/**
 * Renders one row per message and registers each with the tracker, which is
 * how a real message list uses this hook. Exposes the row elements and the
 * tracker API to the test through a mutable handle rather than through
 * `renderHook`, because the assertions are about real DOM elements passing
 * through `observeMessage`.
 */
interface Harness {
  rows: Map<string, HTMLElement>;
  api: UseReadTrackerResult | null;
}

function renderList(
  messageIds: readonly string[],
  options: UseReadTrackerOptions,
  client: ReturnType<typeof createFakeChatClient>,
  handle: Harness,
) {
  function Row({ messageId, observe, unobserve }: { messageId: string; observe: UseReadTrackerResult['observeMessage']; unobserve: UseReadTrackerResult['unobserveMessage'] }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = ref.current;
      if (el === null) return;
      handle.rows.set(messageId, el);
      observe(el, messageId);
      return () => unobserve(el);
    }, [messageId, observe, unobserve]);
    return h('div', { ref, 'data-testid': messageId });
  }

  function List() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useReadTracker(scrollRef, options);
    handle.api = api;
    return h(
      'div',
      { ref: scrollRef },
      messageIds.map((id) => h(Row, { key: id, messageId: id, observe: api.observeMessage, unobserve: api.unobserveMessage })),
    );
  }

  return render(h(ChatProvider, { client }, h(List)));
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIntersectionObserver;
});

describe('useReadTracker — delivered and read are different events', () => {
  it('reports delivered for rows that merely rendered, and reports nothing as read', () => {
    const client = createFakeChatClient({
      messages: [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)],
    });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2', 'm3'], { onDelivered, onRead }, client, handle);

    // Nothing has been reported yet — the debounce window has not elapsed.
    expect(onDelivered).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Three rows mounted, one report, at the highest seq they cover.
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(3);

    // Not one pixel of any row was ever declared visible.
    expect(onRead).not.toHaveBeenCalled();
  });

  it('reports read only once a row crosses the visibility threshold', () => {
    const client = createFakeChatClient({
      messages: [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)],
    });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2', 'm3'], { onDelivered, onRead }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    onDelivered.mockClear();

    const m1 = handle.rows.get('m1');
    const m2 = handle.rows.get('m2');
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();

    // 30% on screen: intersecting, but below the 60% bar. This is the case
    // `isIntersecting` alone would have wrongly accepted.
    act(() => {
      latestObserver().trigger([{ target: m1 as Element, ratio: 0.3 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onRead).not.toHaveBeenCalled();

    // 70%: over the bar.
    act(() => {
      latestObserver().trigger([{ target: m1 as Element, ratio: 0.7 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m1');

    // Reading a row does not re-report delivery.
    expect(onDelivered).not.toHaveBeenCalled();
  });
});

describe('useReadTracker — debounce and monotonicity', () => {
  it('collapses a fast scroll past many rows into one read report at the furthest row', () => {
    const client = createFakeChatClient({
      messages: [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3), makeMessage('m4', 4)],
    });
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2', 'm3', 'm4'], { onDelivered: vi.fn(), onRead }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const target = (id: string) => handle.rows.get(id) as Element;

    act(() => {
      const observer = latestObserver();
      // Four separate callback batches, 100ms apart — a fast scroll.
      observer.trigger([{ target: target('m1'), ratio: 1 }]);
      vi.advanceTimersByTime(100);
      observer.trigger([{ target: target('m2'), ratio: 1 }]);
      vi.advanceTimersByTime(100);
      observer.trigger([{ target: target('m3'), ratio: 1 }]);
      vi.advanceTimersByTime(100);
      observer.trigger([{ target: target('m4'), ratio: 1 }]);
    });

    // Still nothing: every batch reset the 600ms window.
    expect(onRead).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m4');
  });

  it('never walks the read watermark backwards when the user scrolls back up', () => {
    const client = createFakeChatClient({
      messages: [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)],
    });
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2', 'm3'], { onDelivered: vi.fn(), onRead }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const target = (id: string) => handle.rows.get(id) as Element;

    act(() => {
      latestObserver().trigger([{ target: target('m3'), ratio: 1 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenLastCalledWith('m3');

    // Scroll back up to an older row. It becomes visible for the first time,
    // so the hook definitely sees a "new visible id" — the guard has to be
    // the position comparison, not the seen-set.
    act(() => {
      latestObserver().trigger([{ target: target('m1'), ratio: 1 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('does not re-report a delivery watermark it has already reported', () => {
    const client = createFakeChatClient({ messages: [makeMessage('m1', 1), makeMessage('m2', 2)] });
    const onDelivered = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2'], { onDelivered, onRead: vi.fn() }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(2);

    // Re-registering the same rows must not produce a second identical frame.
    act(() => {
      const api = handle.api;
      if (api === null) throw new Error('tracker not mounted');
      api.observeMessage(handle.rows.get('m1') as Element, 'm1');
      api.observeMessage(handle.rows.get('m2') as Element, 'm2');
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('picks up a seq assigned after the row registered', () => {
    // The row mounts optimistically with no seq (queued send), then the ack
    // lands. A tracker that snapshotted seq at registration time would report
    // nothing forever.
    const client = createFakeChatClient({ messages: [makeMessage('m1', undefined)] });
    const onDelivered = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1'], { onDelivered, onRead: vi.fn() }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).not.toHaveBeenCalled();

    act(() => {
      client.emitState({ messages: [makeMessage('m1', 9)] });
      const api = handle.api;
      if (api === null) throw new Error('tracker not mounted');
      api.observeMessage(handle.rows.get('m1') as Element, 'm1');
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledWith(9);
  });
});

describe('useReadTracker — lifecycle', () => {
  it('disconnects the observer and cancels pending flushes on unmount', () => {
    const client = createFakeChatClient({ messages: [makeMessage('m1', 1)] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    const { unmount } = renderList(['m1'], { onDelivered, onRead }, client, handle);
    const observer = latestObserver();
    expect(observer.observed.size).toBe(1);

    // Unmount inside the debounce window: the pending delivered flush must
    // not fire against a component that is gone.
    unmount();

    expect(observer.disconnected).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('reset() clears both watermarks so a new session reports from scratch', () => {
    const client = createFakeChatClient({ messages: [makeMessage('m1', 1), makeMessage('m2', 2)] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1', 'm2'], { onDelivered, onRead }, client, handle);
    act(() => {
      latestObserver().trigger([{ target: handle.rows.get('m2') as Element, ratio: 1 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledTimes(1);

    act(() => {
      const api = handle.api;
      if (api === null) throw new Error('tracker not mounted');
      api.reset();
      api.observeMessage(handle.rows.get('m2') as Element, 'm2');
      latestObserver().trigger([{ target: handle.rows.get('m2') as Element, ratio: 1 }]);
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenCalledTimes(2);
  });

  it('builds no observer at all when disabled, but still reports delivery', () => {
    const client = createFakeChatClient({ messages: [makeMessage('m1', 1)] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    renderList(['m1'], { onDelivered, onRead, enabled: false }, client, handle);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    // A rendered row is delivered whether or not anyone is watching for
    // visibility — that is the whole point of the split.
    expect(onDelivered).toHaveBeenCalledWith(1);
    expect(onRead).not.toHaveBeenCalled();
  });

  it('does not crash on a JS engine with no IntersectionObserver', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;

    const client = createFakeChatClient({ messages: [makeMessage('m1', 1)] });
    const onDelivered = vi.fn();
    const handle: Harness = { rows: new Map(), api: null };

    expect(() => renderList(['m1'], { onDelivered, onRead: vi.fn() }, client, handle)).not.toThrow();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDelivered).toHaveBeenCalledWith(1);
  });
});
