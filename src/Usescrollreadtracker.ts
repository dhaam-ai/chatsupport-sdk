import { useEffect, useRef, useCallback } from 'react';

/**
 * useScrollReadTracker
 *
 * Tracks which agent/bot messages have been scrolled into the customer's
 * viewport and fires `onRead(messageId)` for the furthest-seen one.
 *
 * Strategy:
 *  - Attach an IntersectionObserver to the scroll container
 *  - Each agent/bot MessageBubble registers itself via `observeMessage(el, msgId)`
 *  - When a bubble becomes ≥50% visible, record it as "seen"
 *  - Keep a running `maxSeenMsgId` (the latest message seen by createdAt order)
 *  - Debounce calls to `onRead(messageId)` by 600ms to avoid spamming the API
 *  - Skip if already marked the same message (idempotent)
 *
 * Usage (inside ChatContentInner or equivalent):
 *
 *   const { observeMessage, unobserveMessage } = useScrollReadTracker({
 *     scrollContainerRef,   // ref to the scrollable messages div
 *     messages,             // full messages array (for ordering)
 *     isOpen,               // only track when widget is open
 *     onRead,               // (messageId: string) => void
 *   });
 *
 *   // In each agent/bot MessageBubble:
 *   const bubbleRef = useRef<HTMLDivElement>(null);
 *   useEffect(() => {
 *     const el = bubbleRef.current;
 *     if (!el) return;
 *     observeMessage(el, message.id);
 *     return () => unobserveMessage(el);
 *   }, [message.id, observeMessage, unobserveMessage]);
 */

interface Message {
  id: string;
  senderType: string;
  createdAt: string;
}

interface UseScrollReadTrackerOptions {
  scrollContainerRef: React.RefObject<HTMLElement>;
  messages: Message[];
  isOpen: boolean;
  onRead: (messageId: string) => void;
}

export function useScrollReadTracker({
  scrollContainerRef,
  messages,
  isOpen,
  onRead,
}: UseScrollReadTrackerOptions) {
  // Map from element → messageId
  const elToMsgId  = useRef<Map<Element, string>>(new Map());
  // Set of message IDs that have entered the viewport at least once
  const seenIds    = useRef<Set<string>>(new Set());
  // The message ID we last called onRead() with
  const lastReadId = useRef<string | null>(null);
  // Debounce timer
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The observer instance
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Build a stable lookup: messageId → index in the messages array
  // so we can compare "which is further" efficiently.
  const msgIndexMap = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const m = new Map<string, number>();
    messages.forEach((msg, i) => m.set(msg.id, i));
    msgIndexMap.current = m;
  }, [messages]);

  // Compute the "furthest seen agent/bot message" from seenIds
  const computeMaxSeenMsgId = useCallback((): string | null => {
    let maxIdx = -1;
    let maxId: string | null = null;
    for (const id of seenIds.current) {
      const idx = msgIndexMap.current.get(id) ?? -1;
      if (idx > maxIdx) { maxIdx = idx; maxId = id; }
    }
    return maxId;
  }, []);

  // Flush: find furthest seen, call onRead if it's new
  const flush = useCallback(() => {
    const maxId = computeMaxSeenMsgId();
    if (!maxId) return;
    if (maxId === lastReadId.current) return;

    // Only advance — never go backwards (e.g. if messages array reorders)
    const lastIdx = lastReadId.current
      ? (msgIndexMap.current.get(lastReadId.current) ?? -1)
      : -1;
    const newIdx  = msgIndexMap.current.get(maxId) ?? -1;
    if (newIdx <= lastIdx) return;

    lastReadId.current = maxId;
    console.log(`[ScrollReadTracker] ✅ Marking read up to msgId=${maxId}`);
    onRead(maxId);
  }, [computeMaxSeenMsgId, onRead]);

  const debouncedFlush = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(flush, 600);
  }, [flush]);

  // Create / recreate the observer whenever the scroll container changes or isOpen toggles
  useEffect(() => {
    if (!isOpen) return;
    const root = scrollContainerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let didSeeNew = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const msgId = elToMsgId.current.get(entry.target);
          if (!msgId) continue;
          if (!seenIds.current.has(msgId)) {
            seenIds.current.add(msgId);
            didSeeNew = true;
          }
        }
        if (didSeeNew) debouncedFlush();
      },
      {
        root,
        // Fire when at least 60% of the bubble is visible
        threshold: 0.6,
      },
    );

    observerRef.current = observer;

    // Re-observe all currently registered elements
    for (const [el] of elToMsgId.current) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scrollContainerRef.current]);

  // Called by each agent/bot MessageBubble to register itself
  const observeMessage = useCallback((el: Element, msgId: string) => {
    elToMsgId.current.set(el, msgId);
    observerRef.current?.observe(el);
  }, []);

  // Called on MessageBubble unmount / cleanup
  const unobserveMessage = useCallback((el: Element) => {
    observerRef.current?.unobserve(el);
    elToMsgId.current.delete(el);
  }, []);

  // When widget opens, immediately flush anything already visible
  // (handles case where chat was opened and messages were already loaded)
  useEffect(() => {
    if (!isOpen) return;
    // Small delay so the DOM has settled
    const t = setTimeout(debouncedFlush, 300);
    return () => clearTimeout(t);
  }, [isOpen, debouncedFlush]);

  // Reset tracking when session changes (so we don't carry over state)
  const resetTracker = useCallback(() => {
    seenIds.current.clear();
    lastReadId.current = null;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  return { observeMessage, unobserveMessage, resetTracker };
}