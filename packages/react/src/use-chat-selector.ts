// The selector primitive every domain hook (useChannel, useMessages,
// useTypingIndicator, ...) is built on. This file is the one place this
// package touches `useSyncExternalStore` directly.
//
// Why this exists at all: §6.4 is explicit that core does no field-level
// diffing ("core only guarantees the full, consistent snapshot is available
// on every notification; it does not do field-level diffing itself") and
// hands that job to bindings ("Bindings are responsible for their
// framework's fine-grained-vs-coarse re-render tradeoff"). A component that
// only cares about `state.typing` re-rendering on every unrelated message is
// exactly the failure this hook prevents.

import type { ChatState } from '@dhaam-ccrm/core';
import { useCallback, useRef, useSyncExternalStore } from 'react';

import { useChatClient } from './context.js';

/** Reference equality. The right default for a selector that returns a field straight off `ChatState` (see the module doc on why that is safe with no extra work). */
export function defaultIsEqual<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Shallow-compares two plain objects one level deep. For a selector that
 * *combines* several `ChatState` fields into one object (`useChannel`,
 * `useMessages`) — which necessarily builds a new object literal on every
 * call — this is what lets `useChatSelector` recognize "same values, new
 * wrapper" as unchanged instead of re-rendering on every store notification
 * regardless of what actually changed.
 */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Subscribes to `ChatClient`'s observable store (§6.4) and returns
 * `selector(state)`, re-rendering only when the *selected* value changes —
 * not on every store notification.
 *
 * This is the one place a naive implementation breaks React's
 * `useSyncExternalStore` contract: "returning a fresh object per
 * `getSnapshot()` call" is the documented cause of an infinite render loop
 * (react.dev, `useSyncExternalStore` Caveats — quoted in
 * `@dhaam-ccrm/core`'s `state/store.ts`). A selector like
 * `state => ({ isTyping: state.typing.isTyping })` *does* return a fresh
 * object on every call by construction, so this hook cannot simply call
 * `selector(client.getState())` inside `getSnapshot` and hand the result
 * straight to `useSyncExternalStore` — it has to cache.
 *
 * The cache has two levels:
 *  1. If the raw `ChatState` reference hasn't changed since last time
 *     (core's own identity contract — `getState()` is stable until
 *     something actually changes), return the previously-selected value
 *     without calling `selector` again.
 *  2. If the raw state *did* change, recompute, but compare the new result
 *     against the previous one with `isEqual` (defaults to `Object.is`,
 *     appropriate for a selector that returns a field straight off
 *     `ChatState`; pass {@link shallowEqual} for a selector that builds an
 *     object). If they're equal, keep returning the *old* reference — that
 *     is what makes `useSyncExternalStore`'s own `Object.is` check see "no
 *     change" and skip the re-render.
 *
 * `selector`/`isEqual` are read from a ref on every render rather than
 * closed over directly, so passing a new inline arrow function each render
 * (the common case: `useChatSelector(s => s.unreadCount)`) does not
 * invalidate the cache or force `useSyncExternalStore` to resubscribe.
 */
export function useChatSelector<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = defaultIsEqual): T {
  const client = useChatClient();

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const cacheRef = useRef<{ raw: ChatState; selected: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const raw = client.getState();
    const cached = cacheRef.current;

    if (cached !== null && cached.raw === raw) {
      return cached.selected;
    }

    const next = selectorRef.current(raw);

    if (cached !== null && isEqualRef.current(cached.selected, next)) {
      // Same value, new wrapper (or genuinely the same reference) — keep the
      // old reference so useSyncExternalStore's Object.is check treats this
      // as "unchanged" and skips the re-render.
      cacheRef.current = { raw, selected: cached.selected };
      return cached.selected;
    }

    cacheRef.current = { raw, selected: next };
    return next;
  }, [client]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.subscribe(() => onStoreChange()),
    [client],
  );

  // Core's state has no window/document dependency (packages/core/src/index.ts's
  // header: the only DOM-ish global core ever touches is `WebSocket`, and only
  // inside `connect()`), so the client and server snapshot logic are identical.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
