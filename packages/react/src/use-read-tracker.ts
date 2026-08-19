// useReadTracker — the viewport half of §9.5's two watermarks.
//
// ---------------------------------------------------------------------------
// Delivered and read are two different events, and conflating them is the bug
// ---------------------------------------------------------------------------
//
// `WatermarkTracker` (packages/core/src/presence/watermarks.ts) is explicit
// that "core decides WHAT to report; the caller decides WHEN", because
// whether a row is on screen "is a DOM question core cannot answer from a
// state snapshot". This hook is that DOM answer, and it answers two separate
// questions:
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
// socket as a fact about a human. Reporting `read` on mount would be the
// same mistake again, and it is the one that makes ticks lie: every message
// in a long backlog would come back blue the instant the list mounted, and
// the sender would believe their message had been seen when nobody had
// scrolled to it.
//
// ---------------------------------------------------------------------------
// Why both outcomes are callbacks rather than direct `ChatClient` calls
// ---------------------------------------------------------------------------
//
// `ChatClient` (packages/core/src/client/types.ts) currently exposes
// `markRead(): void` with no `upToMessageId` parameter, and exposes no
// `markDelivered` at all — both capabilities exist on `WatermarkTracker`
// (`markRead(upToMessageId?)`, `markDelivered(upToSeq?)`) but are not wired
// through the public client. Until they are, "mark read up to the highest
// visible id" is unreachable from a binding, so this hook reports its two
// findings through caller-supplied callbacks instead of guessing. That also
// keeps the hook honest to §4: it observes the DOM and reports, it does not
// decide what a watermark means.

import type { ChatMessage } from '@dhaam-ccrm/core';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useChatClient } from './context.js';

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

export interface UseReadTrackerOptions {
  /**
   * A registered row has rendered — report delivery up to `upToSeq`.
   *
   * Wire to `WatermarkTracker#markDelivered(upToSeq)` once `ChatClient`
   * exposes it (see this module's header). Monotonic and debounced: a list of
   * 200 messages mounting at once produces one call, not 200, which is the
   * same coalescing §9.5 requires of the read watermark on reconnect.
   */
  onDelivered: (upToSeq: number) => void;

  /**
   * A registered row is actually visible — mark read up to `upToMessageId`.
   *
   * Wire to `WatermarkTracker#markRead(upToMessageId)` once `ChatClient`
   * exposes the parameter (see this module's header). Only ever advances.
   */
  onRead: (upToMessageId: string) => void;

  /**
   * Pause tracking without unmounting — the widget is collapsed, the tab is
   * hidden, the session is closed. Defaults to `true`. While `false` the
   * observer is torn down entirely, so a background tab reports nothing.
   */
  enabled?: boolean;

  /** Fraction of a row that must be on screen to count as read. Defaults to {@link DEFAULT_READ_THRESHOLD}. */
  threshold?: number;

  /** Coalescing window for both reports, in ms. Defaults to {@link DEFAULT_READ_DEBOUNCE_MS}. */
  debounceMs?: number;
}

export interface UseReadTrackerResult {
  /**
   * Register one rendered row. Call from the row's own effect:
   *
   * ```ts
   * useEffect(() => {
   *   const el = rowRef.current;
   *   if (el === null) return;
   *   observeMessage(el, message.id);
   *   return () => unobserveMessage(el);
   * }, [message.id, observeMessage, unobserveMessage]);
   * ```
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
   * Forget every watermark this hook has emitted, without touching the
   * registrations. For a session switch: the next session's message ids and
   * `seq`s are a different sequence, and carrying "already read up to m_42"
   * across that boundary would suppress the first genuine report.
   */
  reset: () => void;
}

/**
 * Tracks which message rows are rendered and which are actually on screen,
 * and reports each through its own callback.
 *
 * SSR-safe: `IntersectionObserver` is touched only inside an effect and only
 * after a `typeof` guard, so a server render (and a JS engine without the
 * API, e.g. an old React Native runtime) is a silent no-op rather than a
 * crash. Nothing in this module reads `window`/`navigator` at module scope.
 *
 * Renders nothing and subscribes to nothing: the message list is read from
 * `client.getState()` at flush time rather than through `useChatSelector`, so
 * mounting this hook never adds a re-render of its own to a component that is
 * already re-rendering for the message list.
 *
 * @param rootRef The scroll container. Read when the observer is created
 *   (effects run after commit, so a container rendered in the same tree is
 *   already attached). Pass `null`, or leave the ref empty, to observe
 *   against the viewport — valid `IntersectionObserver` semantics for a
 *   full-page message list that does not scroll inside its own box.
 */
export function useReadTracker(
  rootRef: RefObject<Element | null> | null,
  options: UseReadTrackerOptions,
): UseReadTrackerResult {
  const client = useChatClient();

  const {
    enabled = true,
    threshold = DEFAULT_READ_THRESHOLD,
    debounceMs = DEFAULT_READ_DEBOUNCE_MS,
  } = options;

  // Callbacks are read from a ref rather than closed over, for the same
  // reason use-chat-selector.ts keeps `selector` in one: the common call site
  // passes inline arrows, and closing over them would tear down and rebuild
  // the IntersectionObserver on every render of the message list.
  const onDeliveredRef = useRef(options.onDelivered);
  onDeliveredRef.current = options.onDelivered;
  const onReadRef = useRef(options.onRead);
  onReadRef.current = options.onRead;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  /** element → message id, for resolving an `IntersectionObserverEntry.target`. */
  const registrations = useRef(new Map<Element, string>());
  /** Ids that have crossed `threshold` at least once. Sticky: scrolling a read row back off screen does not unread it. */
  const visibleIds = useRef(new Set<string>());

  /** Highest `seq` already handed to `onDelivered`. Monotonic. */
  const reportedSeq = useRef<number | null>(null);
  /** Id already handed to `onRead`. Monotonic by position in `ChatState.messages`. */
  const reportedReadId = useRef<string | null>(null);

  const deliveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const observerRef = useRef<IntersectionObserver | null>(null);

  // -------------------------------------------------------------------------
  // Flushes. Both read `client.getState()` at flush time rather than closing
  // over a snapshot: the debounce window is 600ms, during which an ack can
  // assign a `seq` to a row that had none when it registered.
  // -------------------------------------------------------------------------

  const flushDelivered = useCallback(() => {
    deliveredTimer.current = null;

    const messages = client.getState().messages;
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
    for (const messageId of registrations.current.values()) {
      const seq = bySeq.get(messageId);
      if (seq === undefined) continue;
      if (highest === null || seq > highest) highest = seq;
    }

    if (highest === null) return;
    if (reportedSeq.current !== null && highest <= reportedSeq.current) return;

    reportedSeq.current = highest;
    onDeliveredRef.current(highest);
  }, [client]);

  const flushRead = useCallback(() => {
    readTimer.current = null;

    if (visibleIds.current.size === 0) return;

    const messages = client.getState().messages;
    const indexById = new Map<string, number>();
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i] as ChatMessage;
      indexById.set(message.id, i);
    }

    // "Furthest" is position in core's own ordered list (D2's `seq`, applied
    // by core — never re-sorted here, per use-messages.ts), not arrival order
    // of intersection callbacks: scrolling up past an older row must not walk
    // the watermark backwards.
    let furthestIndex = -1;
    let furthestId: string | null = null;
    for (const messageId of visibleIds.current) {
      const index = indexById.get(messageId);
      if (index === undefined) continue;
      if (index > furthestIndex) {
        furthestIndex = index;
        furthestId = messageId;
      }
    }

    if (furthestId === null) return;

    const alreadyReported = reportedReadId.current;
    if (alreadyReported !== null) {
      const reportedIndex = indexById.get(alreadyReported);
      if (reportedIndex !== undefined && furthestIndex <= reportedIndex) return;
      if (reportedIndex === undefined && furthestId === alreadyReported) return;
    }

    reportedReadId.current = furthestId;
    onReadRef.current(furthestId);
  }, [client]);

  const scheduleDelivered = useCallback(() => {
    if (deliveredTimer.current !== null) clearTimeout(deliveredTimer.current);
    deliveredTimer.current = setTimeout(flushDelivered, debounceMs);
  }, [debounceMs, flushDelivered]);

  const scheduleRead = useCallback(() => {
    if (readTimer.current !== null) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(flushRead, debounceMs);
  }, [debounceMs, flushRead]);

  // -------------------------------------------------------------------------
  // The observer. Rebuilt only when something structural changes (enabled,
  // threshold, root, debounce) — never on a plain re-render of the list.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const root = rootRef?.current ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        let sawNew = false;
        for (const entry of entries) {
          const messageId = registrations.current.get(entry.target);
          if (messageId === undefined) continue;

          // `isIntersecting` alone is true at ANY non-zero ratio regardless of
          // the configured threshold — it is true for a row 5% on screen just
          // as it is for one fully visible. v1 tested only `isIntersecting`,
          // which means its "60% visible" comment described the callback's
          // firing schedule, not the condition it acted on: a row leaving the
          // viewport fires the same callback and would have been marked read
          // on the way out. The ratio check is what actually enforces 60%.
          if (!entry.isIntersecting) continue;
          if (entry.intersectionRatio + RATIO_EPSILON < thresholdRef.current) continue;

          if (visibleIds.current.has(messageId)) continue;
          visibleIds.current.add(messageId);
          sawNew = true;
        }
        if (sawNew) scheduleRead();
      },
      {
        ...(root === null ? {} : { root }),
        threshold,
      },
    );

    observerRef.current = observer;
    for (const element of registrations.current.keys()) observer.observe(element);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (readTimer.current !== null) {
        clearTimeout(readTimer.current);
        readTimer.current = null;
      }
      if (deliveredTimer.current !== null) {
        clearTimeout(deliveredTimer.current);
        deliveredTimer.current = null;
      }
    };
  }, [enabled, threshold, rootRef, scheduleRead]);

  // -------------------------------------------------------------------------
  // Registration API.
  // -------------------------------------------------------------------------

  const observeMessage = useCallback(
    (element: Element, messageId: string) => {
      registrations.current.set(element, messageId);
      observerRef.current?.observe(element);
      // Registration IS the delivered signal — deliberately not gated on the
      // observer existing. A row still counts as delivered on a JS engine
      // with no IntersectionObserver, or with the tracker disabled; it just
      // can never count as read there.
      scheduleDelivered();
    },
    [scheduleDelivered],
  );

  const unobserveMessage = useCallback((element: Element) => {
    observerRef.current?.unobserve(element);
    registrations.current.delete(element);
  }, []);

  const reset = useCallback(() => {
    visibleIds.current.clear();
    reportedSeq.current = null;
    reportedReadId.current = null;
    if (deliveredTimer.current !== null) {
      clearTimeout(deliveredTimer.current);
      deliveredTimer.current = null;
    }
    if (readTimer.current !== null) {
      clearTimeout(readTimer.current);
      readTimer.current = null;
    }
  }, []);

  return useMemo(
    () => ({ observeMessage, unobserveMessage, reset }),
    [observeMessage, unobserveMessage, reset],
  );
}
