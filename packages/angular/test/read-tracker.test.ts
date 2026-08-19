// @vitest-environment jsdom
//
// `createReadTracker` on its own. What this file does NOT re-litigate: the
// two-watermark logic — why registering is "delivered", why only 60%
// visibility is "read", the debounce/monotonicity rules — all live in
// `@dhaam-ccrm/browser`'s `createReadTracker` and would be that package's
// tests' job (currently untested there; flagged in this task's report, not
// fixed here — out of scope for an Angular-binding test file). This file's
// job is the two things `read-tracker.ts` adds: reading the message list off
// a `ChatStore` OR a bare `ChatClient` instead of a hand-written callback,
// and `DestroyRef`-driven teardown.
//
// jsdom has no `IntersectionObserver`, so it is stubbed below — the same
// faithful-to-the-contract shape `packages/react/test/use-read-tracker.test.ts`
// uses, so the 60%-threshold assertions are real assertions and not
// restatements of the stub's own behaviour.

import { runInInjectionContext } from '@angular/core';
import { createConformanceChatClient, buildMessage } from '@dhaam-ccrm/binding-conformance';
import type { ConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatStore, createReadTracker } from '../src/index.js';
import { createAngularTestHost } from './angular-test-host.js';

// ---------------------------------------------------------------------------
// IntersectionObserver stub — faithful to the real contract (a real
// registration set), not a convenience shim, so unmount/disconnect
// assertions mean something.
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

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function latestObserver(): FakeIntersectionObserver {
  const observer = last(FakeIntersectionObserver.instances);
  if (observer === undefined) throw new Error('no IntersectionObserver was constructed');
  return observer;
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIntersectionObserver;
});

/** A row element plus its registration, mirroring what a real message-list component would hand `observeMessage`. */
function row(): HTMLElement {
  return document.createElement('div');
}

// ---------------------------------------------------------------------------
// Source: a bare ChatClient
// ---------------------------------------------------------------------------

describe('with a bare ChatClient source', () => {
  it('reports delivered the moment a row registers, and reads the list from client.getState() at flush time', () => {
    const client = createConformanceChatClient({
      messages: [
        buildMessage({ id: 'm1', seq: 1 }),
        buildMessage({ id: 'm2', seq: 2 }),
      ],
    });
    const onDelivered = vi.fn();
    const onRead = vi.fn();

    const tracker = createReadTracker(client, { onDelivered, onRead, destroyRef: null });
    const m1 = row();
    const m2 = row();
    tracker.observeMessage(m1, 'm1');
    tracker.observeMessage(m2, 'm2');

    expect(onDelivered, 'nothing yet — the debounce window has not elapsed').not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(2);
    expect(onRead, 'registering is not the same as being seen').not.toHaveBeenCalled();

    tracker.destroy();
  });

  it('reports read only once a row crosses the visibility threshold — not merely intersecting at all', () => {
    const client = createConformanceChatClient({
      messages: [buildMessage({ id: 'm1', seq: 1 })],
    });
    const onDelivered = vi.fn();
    const onRead = vi.fn();

    const tracker = createReadTracker(client, { onDelivered, onRead, destroyRef: null });
    const m1 = row();
    tracker.observeMessage(m1, 'm1');
    vi.advanceTimersByTime(600);
    onDelivered.mockClear();

    // 30%: below the 60% bar — this is the case a bare `isIntersecting`
    // check would wrongly accept.
    latestObserver().trigger([{ target: m1, ratio: 0.3 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).not.toHaveBeenCalled();

    // 70%: over the bar.
    latestObserver().trigger([{ target: m1, ratio: 0.7 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m1');
    expect(onDelivered, 'reading a row does not re-report delivery').not.toHaveBeenCalled();

    tracker.destroy();
  });
});

// ---------------------------------------------------------------------------
// Source: a ChatStore
// ---------------------------------------------------------------------------

describe('with a ChatStore source', () => {
  function storeAndClient(initial?: Parameters<typeof createConformanceChatClient>[0]) {
    const client = createConformanceChatClient(initial);
    return { client, store: createChatStore(client, { ngZone: null }) };
  }

  async function settle(client: ConformanceChatClient): Promise<void> {
    // The tracker itself reads `client.getState()` directly (never the
    // store's Angular signal), so a settle here is only needed for the
    // assertions in this describe block that also read `store.messages()`.
    await client.__harness.flushMicrotasks();
  }

  it('extracts the ChatClient off `.client` and reports delivery from it', () => {
    const { client, store } = storeAndClient({ messages: [buildMessage({ id: 'm1', seq: 5 })] });
    const onDelivered = vi.fn();

    const tracker = createReadTracker(store, { onDelivered, onRead: vi.fn(), destroyRef: null });
    tracker.observeMessage(row(), 'm1');
    vi.advanceTimersByTime(600);

    expect(onDelivered).toHaveBeenCalledWith(5);

    tracker.destroy();
    store.destroy();
  });

  it('picks up a seq assigned after the row registered — reads getMessages() at FLUSH time, never a captured snapshot', async () => {
    const { client, store } = storeAndClient({ messages: [buildMessage({ id: 'm1' })] });
    const onDelivered = vi.fn();

    const tracker = createReadTracker(store, { onDelivered, onRead: vi.fn(), destroyRef: null });
    const m1 = row();
    tracker.observeMessage(m1, 'm1');
    vi.advanceTimersByTime(600);
    expect(onDelivered, 'no seq yet — an optimistic send still queued').not.toHaveBeenCalled();

    client.__harness.setState({ messages: [buildMessage({ id: 'm1', seq: 9 })] });
    await settle(client);
    tracker.observeMessage(m1, 'm1');
    vi.advanceTimersByTime(600);

    expect(onDelivered, 'the ack landed inside the debounce window and was still picked up').toHaveBeenCalledWith(9);

    tracker.destroy();
    store.destroy();
  });
});

// ---------------------------------------------------------------------------
// Usable outside an injection context
// ---------------------------------------------------------------------------

describe('usable outside an injection context', () => {
  it('createReadTracker() with no ambient injector just does not find a DestroyRef — it does not throw, and the caller owns destroy()', () => {
    const client = createConformanceChatClient({ messages: [buildMessage({ id: 'm1', seq: 1 })] });
    const onDelivered = vi.fn();

    let tracker: ReturnType<typeof createReadTracker> | undefined;
    expect(() => {
      tracker = createReadTracker(client, { onDelivered, onRead: vi.fn() });
    }).not.toThrow();
    if (tracker === undefined) throw new Error('tracker not constructed');

    tracker.observeMessage(row(), 'm1');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(1);

    expect(() => tracker?.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Teardown — DestroyRef
// ---------------------------------------------------------------------------

describe('teardown', () => {
  it('destroying the injector disconnects the observer and cancels pending flushes', () => {
    const client = createConformanceChatClient({ messages: [buildMessage({ id: 'm1', seq: 1 })] });
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const host = createAngularTestHost();

    const tracker = runInInjectionContext(host.injector, () => createReadTracker(client, { onDelivered, onRead }));
    tracker.observeMessage(row(), 'm1');

    const observer = latestObserver();
    expect(observer.observed.size).toBe(1);

    // Destroy inside the debounce window: the pending delivered flush must
    // not fire against a tracker that is gone.
    host.destroy();

    expect(observer.disconnected).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('destroy() is idempotent', () => {
    const client = createConformanceChatClient({ messages: [buildMessage({ id: 'm1', seq: 1 })] });
    const tracker = createReadTracker(client, { onDelivered: vi.fn(), onRead: vi.fn(), destroyRef: null });

    tracker.destroy();
    expect(() => tracker.destroy()).not.toThrow();
  });

  it('passing destroyRef: null means the caller owns teardown — destroying the ambient injector leaves the observer connected', () => {
    const client = createConformanceChatClient({ messages: [buildMessage({ id: 'm1', seq: 1 })] });
    const host = createAngularTestHost();

    const tracker = runInInjectionContext(host.injector, () =>
      createReadTracker(client, { onDelivered: vi.fn(), onRead: vi.fn(), destroyRef: null }),
    );
    tracker.observeMessage(row(), 'm1');
    const observer = latestObserver();

    host.destroy();
    expect(observer.disconnected, 'opted out — the ambient DestroyRef must never have been registered').toBe(false);

    tracker.destroy();
    expect(observer.disconnected).toBe(true);
  });
});
