// useReadTracker — React's view of `@dhaam-ccrm/browser`'s read tracker.
//
// The two-watermark logic — why registering a row is "delivered" while only
// crossing 60% visibility is "read", why the read watermark walks forward by
// position in core's ordered list rather than by intersection-callback arrival
// order, and why `isIntersecting` alone is not the 60% test v1 believed it was
// — lives in `@dhaam-ccrm/browser`'s `createReadTracker`. Read that module
// first; this file is wiring.
//
// React adds two things: the `RefObject` scroll-container convention (a ref
// is empty during render and filled by commit, so the root can only be read in
// an effect), and callbacks held in refs so that a message list re-rendering
// on every incoming message does not tear down and rebuild the
// IntersectionObserver.

import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createReadTracker, DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD } from '@dhaam-ccrm/browser';
import type { ReadTracker } from '@dhaam-ccrm/browser';

import { useChatClient } from './context.js';

export { DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD } from '@dhaam-ccrm/browser';

export interface UseReadTrackerOptions {
  /**
   * A registered row has rendered — report delivery up to `upToSeq`.
   *
   * Monotonic and debounced: a list of 200 messages mounting at once produces
   * one call, not 200.
   */
  onDelivered: (upToSeq: number) => void;

  /** A registered row is actually visible — mark read up to `upToMessageId`. Only ever advances. */
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
   * Registering is itself the "delivered" signal. Which rows you register is
   * your policy: registering only inbound rows (v1 registered only agent/bot
   * bubbles) tracks "what the customer has read"; registering all of them also
   * reports delivery for your own outgoing messages, which is harmless but
   * redundant.
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
 * crash.
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

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const trackerRef = useRef<ReadTracker | null>(null);
  /**
   * Rows registered before the effect built a tracker — the ordering React
   * guarantees for a child row's effect running before its parent's. Replayed
   * on build so those rows are not silently unobserved (and their delivery
   * never reported).
   */
  const pending = useRef(new Map<Element, string>());

  // The tracker is built regardless of `enabled`, and told about it — a
  // disabled tracker builds no IntersectionObserver but still reports
  // delivery, because a row that rendered IS on the device whether or not
  // anyone is watching for visibility. Toggling `enabled` therefore goes
  // through `setEnabled` in the second effect rather than rebuilding here,
  // which would reset the emitted watermarks and re-report them on resume.
  useEffect(() => {
    const tracker = createReadTracker({
      getMessages: () => client.getState().messages,
      onDelivered: (upToSeq) => onDeliveredRef.current(upToSeq),
      onRead: (upToMessageId) => onReadRef.current(upToMessageId),
      root: rootRef?.current ?? null,
      threshold,
      debounceMs,
      enabled: enabledRef.current,
    });
    trackerRef.current = tracker;

    for (const [element, messageId] of pending.current) tracker.observeMessage(element, messageId);

    return () => {
      tracker.destroy();
      trackerRef.current = null;
    };
    // `enabled` is deliberately absent: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, threshold, debounceMs, rootRef]);

  useEffect(() => {
    trackerRef.current?.setEnabled(enabled);
  }, [enabled]);

  const observeMessage = useCallback((element: Element, messageId: string) => {
    // Recorded either way: the map is both the replay buffer for rows that
    // register before the tracker exists and the registration set a rebuild
    // (threshold change, enable/disable) restores from.
    pending.current.set(element, messageId);
    trackerRef.current?.observeMessage(element, messageId);
  }, []);

  const unobserveMessage = useCallback((element: Element) => {
    pending.current.delete(element);
    trackerRef.current?.unobserveMessage(element);
  }, []);

  const reset = useCallback(() => {
    trackerRef.current?.reset();
  }, []);

  return useMemo(
    () => ({ observeMessage, unobserveMessage, reset }),
    [observeMessage, unobserveMessage, reset],
  );
}
