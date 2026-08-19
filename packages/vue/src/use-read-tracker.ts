// useReadTracker — Vue's view of `@dhaam-ccrm/browser`'s read tracker.
//
// The two-watermark logic — why registering a row is "delivered" while only
// crossing 60% visibility is "read", why the read watermark advances by
// position in core's ordered list rather than by intersection-callback arrival
// order, and why `isIntersecting` alone is not the 60% test v1 believed it was
// — lives in `@dhaam-ccrm/browser`'s `createReadTracker`. This file is wiring.
//
// Like every other subscription in this package, teardown is
// `onChatScopeDispose` (see scope.ts): an IntersectionObserver left connected
// to a torn-down list keeps its target elements alive with it.

import { createReadTracker } from '@dhaam-ccrm/browser';
import type { ReadTracker } from '@dhaam-ccrm/browser';
import { toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

import { useChatClient } from './context.js';
import { onChatScopeDispose } from './scope.js';

export { DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD } from '@dhaam-ccrm/browser';

export interface UseReadTrackerOptions {
  /**
   * A registered row has rendered — report delivery up to `upToSeq`.
   * Monotonic and debounced: 200 rows mounting at once produce one call.
   */
  onDelivered: (upToSeq: number) => void;

  /** A registered row is actually visible — mark read up to `upToMessageId`. Only ever advances. */
  onRead: (upToMessageId: string) => void;

  /**
   * Pause tracking without unmounting — the widget is collapsed, the tab is
   * hidden. Reactive: pass a ref and the observer is torn down and rebuilt as
   * it flips, without losing the watermarks already reported.
   */
  enabled?: MaybeRefOrGetter<boolean>;

  /** Fraction of a row that must be on screen to count as read. Defaults to `DEFAULT_READ_THRESHOLD` (0.6). */
  threshold?: number;

  /** Coalescing window for both reports, in ms. Defaults to `DEFAULT_READ_DEBOUNCE_MS` (600). */
  debounceMs?: number;
}

export interface UseReadTrackerResult {
  /**
   * Register one rendered row — typically from the row component's own
   * `onMounted`, with the element from a template ref.
   *
   * Registering is itself the "delivered" signal. Which rows you register is
   * your policy: registering only inbound rows tracks "what the customer has
   * read"; registering all of them also reports delivery for your own
   * outgoing messages, which is harmless but redundant.
   */
  observeMessage: (element: Element, messageId: string) => void;

  /** Unregister a row. Safe for an element that was never registered. */
  unobserveMessage: (element: Element) => void;

  /**
   * Forget every watermark emitted so far, keeping the registrations. For a
   * session switch: the next session's ids and `seq`s are a different
   * sequence, and carrying "already read up to m_42" across that boundary
   * would suppress the first genuine report.
   */
  reset: () => void;
}

/**
 * Tracks which message rows are rendered and which are actually on screen.
 *
 * ```vue
 * <script setup lang="ts">
 * const list = ref<HTMLElement | null>(null);
 * const { observeMessage, unobserveMessage } = useReadTracker(list, {
 *   onDelivered: (seq) => console.log('delivered up to', seq),
 *   onRead: (id) => console.log('read up to', id),
 * });
 * </script>
 * ```
 *
 * SSR-safe: `IntersectionObserver` is only ever touched behind a `typeof`
 * guard inside the tracker, so a server render registers rows into a map and
 * observes nothing.
 *
 * @param root The scroll container, reactive. `null` observes against the
 *   viewport — valid semantics for a full-page list that does not scroll
 *   inside its own box.
 */
export function useReadTracker(
  root: MaybeRefOrGetter<Element | null | undefined>,
  options: UseReadTrackerOptions,
): UseReadTrackerResult {
  const client = useChatClient();

  const tracker: ReadTracker = createReadTracker({
    getMessages: () => client.getState().messages,
    onDelivered: (upToSeq) => options.onDelivered(upToSeq),
    onRead: (upToMessageId) => options.onRead(upToMessageId),
    root: toValue(root) ?? null,
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    enabled: toValue(options.enabled ?? true),
  });

  // A template ref is `null` during setup and filled on mount, so the root is
  // almost always adopted through this watcher rather than the initial value
  // above.
  watch(
    () => toValue(root) ?? null,
    (next) => tracker.setRoot(next),
  );

  watch(
    () => toValue(options.enabled ?? true),
    (next) => tracker.setEnabled(next),
  );

  onChatScopeDispose(() => tracker.destroy(), 'useReadTracker');

  return {
    observeMessage: (element, messageId) => tracker.observeMessage(element, messageId),
    unobserveMessage: (element) => tracker.unobserveMessage(element),
    reset: () => tracker.reset(),
  };
}
