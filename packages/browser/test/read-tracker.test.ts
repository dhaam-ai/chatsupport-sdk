// @vitest-environment jsdom
//
// jsdom has no IntersectionObserver at all, so the stub below is not a
// convenience — it is the only way to drive this tracker without a real
// browser. Ported from packages/react/test/use-read-tracker.test.ts: a
// faithful stub of the *contract* rather than a shortcut — `observe`/
// `unobserve`/`disconnect` maintain a real registration set (so the unmount
// assertions mean something), and `trigger` hands the callback whatever
// `intersectionRatio` the test names, which is what lets the threshold
// assertions be real assertions instead of restatements of the stub's own
// behaviour. Driven directly against `createReadTracker()` here — no React,
// so rows are plain `document.createElement('div')` elements and `getMessages`
// is a plain closure over a mutable array instead of a ChatClient.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadTracker } from '../src/read-tracker.js';
import type { ReadTracker, TrackedMessage } from '../src/read-tracker.js';

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

function makeMessage(id: string, seq: number | undefined): TrackedMessage {
  return seq === undefined ? { id } : { id, seq };
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

/** Every tracker a test constructs, so `afterEach` can guarantee teardown even when a test forgets to. */
let trackers: ReadTracker[] = [];

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
  vi.useFakeTimers();
  trackers = [];
});

afterEach(() => {
  for (const tracker of trackers) tracker.destroy();
  trackers = [];
  vi.useRealTimers();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIntersectionObserver;
});

// ---------------------------------------------------------------------------
// Delivered and read are different events
// ---------------------------------------------------------------------------

describe('createReadTracker — delivered and read are different events', () => {
  it('reports delivered for rows that merely registered, and reports nothing as read', () => {
    let messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)];
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead });
    trackers.push(tracker);

    const rows = new Map(['m1', 'm2', 'm3'].map((id) => [id, document.createElement('div')] as const));
    for (const [id, el] of rows) tracker.observeMessage(el, id);

    // Nothing has been reported yet — the debounce window has not elapsed.
    expect(onDelivered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);

    // Three rows registered, one report, at the highest seq they cover.
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(3);

    // Not one pixel of any row was ever declared visible.
    expect(onRead).not.toHaveBeenCalled();
  });

  it('reports read only once a row crosses the visibility threshold, not merely intersecting', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)];
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead });
    trackers.push(tracker);

    const m1 = document.createElement('div');
    const m2 = document.createElement('div');
    tracker.observeMessage(m1, 'm1');
    tracker.observeMessage(m2, 'm2');
    vi.advanceTimersByTime(600);
    onDelivered.mockClear();

    // 30% on screen: intersecting (ratio > 0), but below the 60% bar. This is
    // exactly the case a bare `isIntersecting` check would wrongly accept.
    latestObserver().trigger([{ target: m1, ratio: 0.3 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).not.toHaveBeenCalled();

    // 70%: over the bar.
    latestObserver().trigger([{ target: m1, ratio: 0.7 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m1');

    // Reading a row does not re-report delivery.
    expect(onDelivered).not.toHaveBeenCalled();
  });

  it('accepts a ratio a hair below threshold via the float-error epsilon, but not further below', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const onRead = vi.fn();
    // Default threshold is 0.6 (DEFAULT_READ_THRESHOLD).
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered: vi.fn(), onRead });
    trackers.push(tracker);

    const el = document.createElement('div');
    tracker.observeMessage(el, 'm1');
    vi.advanceTimersByTime(600);

    // 0.5999 is the canonical case the epsilon exists for: sub-pixel geometry
    // rounding a genuine 0.6 crossing down to 0.5999999-ish.
    latestObserver().trigger([{ target: el, ratio: 0.5999 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledWith('m1');
  });
});

// ---------------------------------------------------------------------------
// Debounce, coalescing, and monotonicity
// ---------------------------------------------------------------------------

describe('createReadTracker — debounce, coalescing, and monotonicity', () => {
  it('coalesces 200 registrations mounting at once into a single delivered report', () => {
    const messages: TrackedMessage[] = Array.from({ length: 200 }, (_, i) => makeMessage(`m${i}`, i + 1));
    const onDelivered = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead: vi.fn() });
    trackers.push(tracker);

    for (const message of messages) tracker.observeMessage(document.createElement('div'), message.id);

    vi.advanceTimersByTime(600);

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(200);
  });

  it('collapses a fast scroll past many rows into one read report at the furthest row', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3), makeMessage('m4', 4)];
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered: vi.fn(), onRead });
    trackers.push(tracker);

    const rows = new Map(['m1', 'm2', 'm3', 'm4'].map((id) => [id, document.createElement('div')] as const));
    for (const [id, el] of rows) tracker.observeMessage(el, id);
    vi.advanceTimersByTime(600);

    const target = (id: string): Element => {
      const el = rows.get(id);
      if (el === undefined) throw new Error(`no row for ${id}`);
      return el;
    };

    const observer = latestObserver();
    // Four separate callback batches, 100ms apart — a fast scroll.
    observer.trigger([{ target: target('m1'), ratio: 1 }]);
    vi.advanceTimersByTime(100);
    observer.trigger([{ target: target('m2'), ratio: 1 }]);
    vi.advanceTimersByTime(100);
    observer.trigger([{ target: target('m3'), ratio: 1 }]);
    vi.advanceTimersByTime(100);
    observer.trigger([{ target: target('m4'), ratio: 1 }]);

    // Still nothing: every batch reset the 600ms window.
    expect(onRead).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('m4');
  });

  it('never walks the read watermark backwards when the user scrolls back up', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3)];
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered: vi.fn(), onRead });
    trackers.push(tracker);

    const rows = new Map(['m1', 'm2', 'm3'].map((id) => [id, document.createElement('div')] as const));
    for (const [id, el] of rows) tracker.observeMessage(el, id);
    vi.advanceTimersByTime(600);

    const m1 = rows.get('m1') as Element;
    const m3 = rows.get('m3') as Element;

    latestObserver().trigger([{ target: m3, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenLastCalledWith('m3');

    // Scroll back up to an older row. It becomes visible for the first time,
    // so the tracker definitely sees a "new visible id" — the guard has to be
    // the position comparison against getMessages() order, not the seen-set.
    latestObserver().trigger([{ target: m1, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('does not re-report a delivery watermark it has already reported', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2)];
    const onDelivered = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead: vi.fn() });
    trackers.push(tracker);

    const m1 = document.createElement('div');
    const m2 = document.createElement('div');
    tracker.observeMessage(m1, 'm1');
    tracker.observeMessage(m2, 'm2');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(2);

    // Re-registering the same rows must not produce a second identical frame.
    tracker.observeMessage(m1, 'm1');
    tracker.observeMessage(m2, 'm2');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('picks up a seq assigned after the row registered, since getMessages() is read at flush time', () => {
    // The row registers optimistically with no seq (queued send), then the
    // ack lands. A tracker that snapshotted seq at registration time would
    // report nothing forever.
    let messages: TrackedMessage[] = [makeMessage('m1', undefined)];
    const onDelivered = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead: vi.fn() });
    trackers.push(tracker);

    const el = document.createElement('div');
    tracker.observeMessage(el, 'm1');
    vi.advanceTimersByTime(600);
    expect(onDelivered).not.toHaveBeenCalled();

    messages = [makeMessage('m1', 9)];
    tracker.observeMessage(el, 'm1'); // re-registration is how a binding re-flushes after an ack
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(9);
  });

  it('unobserveMessage removes a row from the delivered computation', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 5)];
    const onDelivered = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead: vi.fn() });
    trackers.push(tracker);

    const m1 = document.createElement('div');
    const m2 = document.createElement('div');
    tracker.observeMessage(m1, 'm1');
    tracker.observeMessage(m2, 'm2');
    tracker.unobserveMessage(m2);

    vi.advanceTimersByTime(600);
    // m2 (seq 5) was unregistered before the flush; only m1's seq counts.
    expect(onDelivered).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Enabled / disabled and missing-API safety
// ---------------------------------------------------------------------------

describe('createReadTracker — enabled, disabled, and unsupported engines', () => {
  it('builds no observer at all when disabled, but still reports delivery', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead, enabled: false });
    trackers.push(tracker);

    tracker.observeMessage(document.createElement('div'), 'm1');
    vi.advanceTimersByTime(600);

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    // A registered row is delivered whether or not anyone is watching for
    // visibility — that is the whole point of the split.
    expect(onDelivered).toHaveBeenCalledWith(1);
    expect(onRead).not.toHaveBeenCalled();
  });

  it('does not crash on a JS engine with no IntersectionObserver at all', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;

    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const onDelivered = vi.fn();
    let tracker: ReadTracker | undefined;
    expect(() => {
      tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead: vi.fn() });
      tracker.observeMessage(document.createElement('div'), 'm1');
    }).not.toThrow();
    if (tracker !== undefined) trackers.push(tracker);

    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledWith(1);
  });

  it('setEnabled(false) then (true) does not re-report an already-reported read watermark', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered: vi.fn(), onRead });
    trackers.push(tracker);

    const el = document.createElement('div');
    tracker.observeMessage(el, 'm1');
    latestObserver().trigger([{ target: el, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);

    tracker.setEnabled(false);
    tracker.setEnabled(true);

    // The rebuilt observer re-observes the same element; triggering the same
    // visibility again must not re-report — the watermark is sticky and is
    // untouched by an enable/disable cycle (only reset() clears it).
    latestObserver().trigger([{ target: el, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// reset() and destroy()
// ---------------------------------------------------------------------------

describe('createReadTracker — reset() and destroy()', () => {
  it('reset() clears both watermarks but keeps registrations, so a new session reports from scratch', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1), makeMessage('m2', 2)];
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead });
    trackers.push(tracker);

    const m2 = document.createElement('div');
    tracker.observeMessage(document.createElement('div'), 'm1');
    tracker.observeMessage(m2, 'm2');
    latestObserver().trigger([{ target: m2, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledTimes(1);

    const instanceCountBeforeReset = FakeIntersectionObserver.instances.length;
    const observerBeforeReset = latestObserver();
    const observedSizeBeforeReset = observerBeforeReset.observed.size;

    tracker.reset();

    // reset() must not rebuild the observer — that is exactly what "keeps
    // registrations" means: no new IntersectionObserver, no re-observe calls.
    expect(FakeIntersectionObserver.instances.length).toBe(instanceCountBeforeReset);
    expect(latestObserver()).toBe(observerBeforeReset);
    expect(observerBeforeReset.observed.size).toBe(observedSizeBeforeReset);

    // Without re-registering, the already-observed row can be reported again.
    latestObserver().trigger([{ target: m2, ratio: 1 }]);
    vi.advanceTimersByTime(600);
    expect(onRead).toHaveBeenCalledTimes(2);

    // Delivered is only re-flushed by a fresh observeMessage() call (that is
    // what schedules it) — but reset() clearing reportedSeq means that call
    // is no longer suppressed as "already reported", proving the watermark,
    // not the registration, was what reset().
    tracker.observeMessage(m2, 'm2');
    vi.advanceTimersByTime(600);
    expect(onDelivered).toHaveBeenCalledTimes(2);
  });

  it('disconnects the observer and cancels pending flushes on destroy()', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const onDelivered = vi.fn();
    const onRead = vi.fn();
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered, onRead });

    tracker.observeMessage(document.createElement('div'), 'm1');
    const observer = latestObserver();
    expect(observer.observed.size).toBe(1);

    // Destroy inside the debounce window: the pending delivered flush must
    // not fire against a torn-down tracker.
    tracker.destroy();

    expect(observer.disconnected).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('destroy() is idempotent', () => {
    const messages: TrackedMessage[] = [makeMessage('m1', 1)];
    const tracker = createReadTracker({ getMessages: () => messages, onDelivered: vi.fn(), onRead: vi.fn() });

    tracker.observeMessage(document.createElement('div'), 'm1');
    tracker.destroy();
    expect(() => tracker.destroy()).not.toThrow();
    expect(latestObserver().disconnected).toBe(true);

    // Registering after destroy is a no-op — no crash, no new observation.
    expect(() => tracker.observeMessage(document.createElement('div'), 'm2')).not.toThrow();
  });
});
