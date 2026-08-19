// createReadTracker — the viewport half of §9.5's two watermarks.
//
// ---------------------------------------------------------------------------
// Delivered and read are two different events, and conflating them is the bug
// ---------------------------------------------------------------------------
//
// `WatermarkTracker` (packages/core/src/presence/watermarks.ts) is explicit
// that "core decides WHAT to report; the caller decides WHEN", because
// whether a row is on screen "is a DOM question core cannot answer from a
// state snapshot". This tracker is that DOM answer, and it answers two
// separate questions:
//
//   delivered — "this client has the message and has rendered it." Fires the
//               moment a row registers itself, whether or not any pixel of it
//               is on screen. A message sitting 4000px below the fold in a
//               mounted list IS delivered; the recipient's device holds it.
//               Keyed on `seq` (D2), because that is what
//               `message.markDelivered` carries.
//
//   read      — "a human has actually looked at this." Fires only once the
//               row crosses `threshold` (default 60%, v1's proven value) of
//               visibility inside the scroll container. Keyed on message id,
//               because `message.markRead` carries `upToMessageId` and the
//               read watermark is an instant (§9.5), not a `seq`.
//
// v1 derived the second tick from presence — "the other party is connected" —
// which is the same class of mistake one level up: it reported a fact about a
// socket as a fact about a human. Reporting `read` on mount would be the same
// mistake again, and it is the one that makes ticks lie: every message in a
// long backlog would come back blue the instant the list mounted, and the
// sender would believe their message had been seen when nobody had scrolled
// to it.
//
// ---------------------------------------------------------------------------
// Why this takes `getMessages` rather than a ChatClient
// ---------------------------------------------------------------------------
//
// This package has no dependency on `@dhaam-ccrm/core` — not even a type-only
// one — so that a binding can pull in voice recording without pulling in a
// second copy of anything. `getMessages` is the whole surface the tracker
// needs: the ordered list, read at FLUSH time (never closed over), because the
// debounce window is 600ms and an ack can assign a `seq` inside it. Any
// `ChatMessage[]` satisfies {@link TrackedMessage} structurally.
//
// Both outcomes are callbacks rather than direct client calls: `ChatClient`
// exposes `markRead(): void` with no `upToMessageId` parameter and no
// `markDelivered` at all — both exist on `WatermarkTracker` but are not wired
// through the public client. Until they are, "mark read up to the highest
// visible id" is unreachable from a binding, so this reports its two findings
// and lets the caller decide what they mean.

/** The shape this tracker reads. `ChatMessage` satisfies it structurally. */
export interface TrackedMessage {
  readonly id: string;
  readonly seq?: number | undefined;
}

/** v1's proven visibility bar (`src/Usescrollreadtracker.ts`): 60% of the bubble on screen. */
export const DEFAULT_READ_THRESHOLD = 0.6;

/** v1's proven debounce (`src/Usescrollreadtracker.ts`): one flush per 600ms of scrolling, not one per row. */
export const DEFAULT_READ_DEBOUNCE_MS = 600;

/**
 * `IntersectionObserverEntry.intersectionRatio` is a float the browser
 * computes from sub-pixel geometry, so a row that has genuinely crossed a
 * 0.6 threshold can be reported as 0.5999999. Comparing with a bare `>=`
 * makes that row silently unread. The tolerance is far below any threshold a
 * caller would plausibly distinguish and far above float error.
 */
const RATIO_EPSILON = 1e-3;

export interface ReadTrackerOptions {
  /**
   * The ordered message list, read at flush time. Wire to
   * `client.getState().messages` — never to a snapshot captured earlier.
   */
  getMessages: () => readonly TrackedMessage[];

  /**
   * A registered row has rendered — report delivery up to `upToSeq`.
   *
   * Monotonic and debounced: a list of 200 messages mounting at once produces
   * one call, not 200, which is the same coalescing §9.5 requires of the read
   * watermark on reconnect.
   */
  onDelivered: (upToSeq: number) => void;

  /** A registered row is actually visible — mark read up to `upToMessageId`. Only ever advances. */
  onRead: (upToMessageId: string) => void;

  /**
   * The scroll container, or `null`/omitted to observe against the viewport —
   * valid `IntersectionObserver` semantics for a full-page message list that
   * does not scroll inside its own box.
   */
  root?: Element | null;

  /** Fraction of a row that must be on screen to count as read. Defaults to {@link DEFAULT_READ_THRESHOLD}. */
  threshold?: number;

  /** Coalescing window for both reports, in ms. Defaults to {@link DEFAULT_READ_DEBOUNCE_MS}. */
  debounceMs?: number;

  /**
   * Start tracking immediately. Defaults to `true`. Pass `false` and call
   * `setEnabled(true)` later for a widget that mounts collapsed.
   */
  enabled?: boolean;
}

export interface ReadTracker {
  /**
   * Register one rendered row.
   *
   * Registering is itself the "delivered" signal — see this module's header.
   * Which rows you register is your policy: registering only inbound rows
   * (v1 registered only agent/bot bubbles) tracks "what the customer has
   * read"; registering all of them also reports delivery for your own
   * outgoing messages, which is harmless but redundant.
   */
  observeMessage: (element: Element, messageId: string) => void;

  /** Unregister a row. Safe to call for an element that was never registered. */
  unobserveMessage: (element: Element) => void;

  /**
   * Pause or resume without discarding registrations — the widget collapsed,
   * the tab went hidden, the session closed. While disabled the observer is
   * torn down entirely, so a background tab reports nothing.
   */
  setEnabled: (enabled: boolean) => void;

  /** Swap the scroll container. Rebuilds the observer and re-observes every registered row. */
  setRoot: (root: Element | null) => void;

  /**
   * Forget every watermark emitted so far, without touching the
   * registrations. For a session switch: the next session's message ids and
   * `seq`s are a different sequence, and carrying "already read up to m_42"
   * across that boundary would suppress the first genuine report.
   */
  reset: () => void;

  /** Disconnect the observer, clear the timers, and drop every registration. Idempotent. */
  destroy: () => void;
}

/**
 * Tracks which message rows are rendered and which are actually on screen,
 * and reports each through its own callback.
 *
 * SSR-safe: `IntersectionObserver` is touched only inside `observe()` and only
 * after a `typeof` guard, so constructing a tracker on a server (or in a JS
 * engine without the API) is a silent no-op rather than a crash. Nothing in
 * this module reads a browser global at module scope.
 */
export function createReadTracker(options: ReadTrackerOptions): ReadTracker {
  const { getMessages, onDelivered, onRead } = options;

  const threshold = options.threshold ?? DEFAULT_READ_THRESHOLD;
  const debounceMs = options.debounceMs ?? DEFAULT_READ_DEBOUNCE_MS;
  let root = options.root ?? null;
  let enabled = options.enabled ?? true;
  let destroyed = false;

  /** element → message id, for resolving an `IntersectionObserverEntry.target`. */
  const registrations = new Map<Element, string>();
  /** Ids that have crossed `threshold` at least once. Sticky: scrolling a read row back off screen does not unread it. */
  const visibleIds = new Set<string>();

  /** Highest `seq` already handed to `onDelivered`. Monotonic. */
  let reportedSeq: number | null = null;
  /** Id already handed to `onRead`. Monotonic by position in the message list. */
  let reportedReadId: string | null = null;

  let deliveredTimer: ReturnType<typeof setTimeout> | null = null;
  let readTimer: ReturnType<typeof setTimeout> | null = null;

  let observer: IntersectionObserver | null = null;

  // ---------------------------------------------------------------------------
  // Flushes. Both read `getMessages()` at flush time rather than closing over a
  // snapshot: the debounce window is 600ms, during which an ack can assign a
  // `seq` to a row that had none when it registered.
  // ---------------------------------------------------------------------------

  function flushDelivered(): void {
    deliveredTimer = null;

    const messages = getMessages();
    if (messages.length === 0) return;

    // Recomputed over the live registration set rather than accumulated as
    // rows arrive, so a row that registered before its ack (no `seq` yet) is
    // still counted once the ack lands — the next registration re-flushes and
    // picks it up.
    const bySeq = new Map<string, number>();
    for (const message of messages) {
      if (message.seq !== undefined) bySeq.set(message.id, message.seq);
    }

    let highest: number | null = null;
    for (const messageId of registrations.values()) {
      const seq = bySeq.get(messageId);
      if (seq === undefined) continue;
      if (highest === null || seq > highest) highest = seq;
    }

    if (highest === null) return;
    if (reportedSeq !== null && highest <= reportedSeq) return;

    reportedSeq = highest;
    onDelivered(highest);
  }

  function flushRead(): void {
    readTimer = null;

    if (visibleIds.size === 0) return;

    const messages = getMessages();
    const indexById = new Map<string, number>();
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message !== undefined) indexById.set(message.id, i);
    }

    // "Furthest" is position in core's own ordered list (D2's `seq`, applied
    // by core — never re-sorted here), not arrival order of intersection
    // callbacks: scrolling up past an older row must not walk the watermark
    // backwards.
    let furthestIndex = -1;
    let furthestId: string | null = null;
    for (const messageId of visibleIds) {
      const index = indexById.get(messageId);
      if (index === undefined) continue;
      if (index > furthestIndex) {
        furthestIndex = index;
        furthestId = messageId;
      }
    }

    if (furthestId === null) return;

    if (reportedReadId !== null) {
      const reportedIndex = indexById.get(reportedReadId);
      if (reportedIndex !== undefined && furthestIndex <= reportedIndex) return;
      if (reportedIndex === undefined && furthestId === reportedReadId) return;
    }

    reportedReadId = furthestId;
    onRead(furthestId);
  }

  function scheduleDelivered(): void {
    if (destroyed) return;
    if (deliveredTimer !== null) clearTimeout(deliveredTimer);
    deliveredTimer = setTimeout(flushDelivered, debounceMs);
  }

  function scheduleRead(): void {
    if (destroyed) return;
    if (readTimer !== null) clearTimeout(readTimer);
    readTimer = setTimeout(flushRead, debounceMs);
  }

  function clearTimers(): void {
    if (deliveredTimer !== null) {
      clearTimeout(deliveredTimer);
      deliveredTimer = null;
    }
    if (readTimer !== null) {
      clearTimeout(readTimer);
      readTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // The observer. Rebuilt only when something structural changes (enabled,
  // threshold, root) — never on a plain re-render of the list.
  // ---------------------------------------------------------------------------

  function teardownObserver(): void {
    observer?.disconnect();
    observer = null;
    clearTimers();
  }

  function buildObserver(): void {
    if (destroyed) return;
    if (!enabled) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const built = new IntersectionObserver(
      (entries) => {
        let sawNew = false;
        for (const entry of entries) {
          const messageId = registrations.get(entry.target);
          if (messageId === undefined) continue;

          // `isIntersecting` alone is true at ANY non-zero ratio regardless of
          // the configured threshold — it is true for a row 5% on screen just
          // as it is for one fully visible. v1 tested only `isIntersecting`,
          // which means its "60% visible" comment described the callback's
          // firing schedule, not the condition it acted on: a row leaving the
          // viewport fires the same callback and would have been marked read
          // on the way out. The ratio check is what actually enforces 60%.
          if (!entry.isIntersecting) continue;
          if (entry.intersectionRatio + RATIO_EPSILON < threshold) continue;

          if (visibleIds.has(messageId)) continue;
          visibleIds.add(messageId);
          sawNew = true;
        }
        if (sawNew) scheduleRead();
      },
      {
        ...(root === null ? {} : { root }),
        threshold,
      },
    );

    observer = built;
    for (const element of registrations.keys()) built.observe(element);
  }

  function rebuild(): void {
    teardownObserver();
    buildObserver();
  }

  buildObserver();

  return {
    observeMessage(element: Element, messageId: string): void {
      if (destroyed) return;
      registrations.set(element, messageId);
      observer?.observe(element);
      // Registration IS the delivered signal — deliberately not gated on the
      // observer existing. A row still counts as delivered on a JS engine
      // with no IntersectionObserver, or with the tracker disabled; it just
      // can never count as read there.
      scheduleDelivered();
    },

    unobserveMessage(element: Element): void {
      observer?.unobserve(element);
      registrations.delete(element);
    },

    setEnabled(next: boolean): void {
      if (destroyed || next === enabled) return;
      enabled = next;
      rebuild();
    },

    setRoot(next: Element | null): void {
      if (destroyed || next === root) return;
      root = next;
      rebuild();
    },

    reset(): void {
      visibleIds.clear();
      reportedSeq = null;
      reportedReadId = null;
      clearTimers();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      teardownObserver();
      registrations.clear();
      visibleIds.clear();
    },
  };
}
