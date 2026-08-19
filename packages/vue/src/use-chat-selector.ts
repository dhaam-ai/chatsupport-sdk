// The selector primitive every domain composable (useChannel, useMessages,
// useTypingIndicator, ...) is built on. This file is the one place this package
// subscribes to a `ChatClient`'s store.
//
// Why it exists at all: §6.4 is explicit that core does no field-level diffing
// ("core only guarantees the full, consistent snapshot is available on every
// notification; it does not do field-level diffing itself") and hands that job
// to bindings ("Bindings are responsible for their framework's
// fine-grained-vs-coarse re-render tradeoff"). A component that only renders
// the typing dots re-rendering on every incoming message is exactly the failure
// this composable prevents.
//
// ---------------------------------------------------------------------------
// shallowRef, not ref, not computed. All three were considered; here is why.
// ---------------------------------------------------------------------------
//
// `ref()` — wrong. `ref` runs `toReactive()` on every object it is handed, i.e.
//   `reactive(value)`, i.e. a deep `Proxy` created lazily over every nested
//   object it is walked into. Core's snapshots are already immutable and
//   replaced wholesale (`ChatStore` deep-freezes and never mutates), so there
//   is nothing for deep reactivity to observe and the proxying is pure cost —
//   on `state.messages` that is one proxy per message, per read path, forever.
//   It is also actively WRONG here: a composite selector like
//   `s => ({ hasMore: s.pagination.hasMore })` returns a fresh, *unfrozen*
//   object literal, which `ref` really would wrap; the value a consumer then
//   reads is a proxy, not the object the selector returned, and every
//   `Object.is` comparison against a raw slice — including the one in
//   `isEqual` below — silently stops matching.
//
// `computed()` — wrong for the source of truth, right for derivations (see
//   use-message-ticks.ts, which is a `computed` over this). A computed cannot
//   express "same value, new wrapper ⇒ do not notify" with a *custom* equality:
//   its own change detection is `Object.is` on the returned value and is not
//   configurable, so the composite-selector case above notifies on every single
//   store change. Caching the previous result inside the getter and returning
//   the OLD reference does work around that — but only on Vue ≥3.4, where a
//   computed whose value did not change stops propagating; on 3.3 the render
//   effect re-runs anyway because it transitively depends on the raw state ref.
//   Making a core correctness invariant depend on a scheduler optimization
//   landing in a particular minor is not a trade worth making.
//
// `shallowRef()` — what this uses. One reactive cell holding one immutable
//   snapshot slice, triggering exactly when we assign to it, which we do only
//   when `isEqual` says the selected value actually changed. Version-independent,
//   no proxies, and the identity a consumer reads is the identity core produced.
//
// The React binding solves the same problem the other way round — it recomputes
// in `getSnapshot` and returns the *previous* selected reference on an `isEqual`
// miss so `useSyncExternalStore`'s own `Object.is` sees "unchanged". Same
// invariant, opposite direction: React must produce a stable value to suppress
// a render; Vue must withhold a write to suppress one.

import type { ChatState } from '@dhaam-ccrm/core';
import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

import { useChatClient } from './context.js';
import { onChatScopeDispose } from './scope.js';

/** Reference equality. The right default for a selector that returns a field straight off `ChatState`. */
export function defaultIsEqual<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Shallow-compares two plain objects one level deep. For a selector that
 * *combines* several `ChatState` fields into one object — which necessarily
 * builds a new object literal on every call — this is what lets
 * {@link useChatSelector} recognize "same values, new wrapper" as unchanged.
 *
 * Rarely needed in this binding: because every composable here returns one ref
 * per field rather than one ref per bag of fields (see use-channel.ts), the
 * composite-selector case barely arises. It is exported anyway because an app
 * writing its own selector will hit it, and because
 * {@link useMessageTicks}'s input selector genuinely is a composite.
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
 * Subscribes to `ChatClient`'s observable store (§6.4) and exposes
 * `selector(state)` as a `shallowRef`, updating only when the *selected* value
 * changes — not on every store notification.
 *
 * Two levels of change detection, in the order that makes the cheap one
 * dominate:
 *
 *  1. The snapshot reference itself. `getState()` returns the identical object
 *     while nothing has changed (core's `ChatStore` contract), so a
 *     notification carrying the same snapshot we already selected from cannot
 *     have changed anything and the selector is not run at all. Core's store
 *     does not currently emit such a notification — but `ChatClient.subscribe`
 *     does not promise it will not, and this is the cheaper of the two checks,
 *     so it goes first rather than being left out.
 *  2. `isEqual` on the selected value (defaults to `Object.is`; pass
 *     {@link shallowEqual} for a selector that builds an object). On a match we
 *     simply do not assign — a `shallowRef` that is not written to does not
 *     trigger, which is the whole mechanism.
 *
 * A selector that throws is not caught here. It propagates into
 * `ChatStore.#flush`, which isolates it from every other subscriber (so a
 * sibling composable keeps updating) and re-throws it on a fresh macrotask, per
 * core's `listener-error.ts` policy. Swallowing it in the binding would hide a
 * real application bug behind a permanently stale value; a selector should be a
 * pure projection of `ChatState` and nothing else.
 *
 * The subscription is released via `onScopeDispose` — see scope.ts for why not
 * `onUnmounted`.
 */
export function useChatSelector<T>(
  selector: (state: ChatState) => T,
  isEqual: (a: T, b: T) => boolean = defaultIsEqual,
): Readonly<ShallowRef<T>> {
  const client = useChatClient();

  let raw = client.getState();
  let selected = selector(raw);

  // `as ShallowRef<T>`: `shallowRef`'s declared return type is conditional on
  // `T` itself being a `Ref` (in which case it hands the ref straight back).
  // `T` here is a projection of `ChatState`, which is never a ref, but the
  // compiler cannot know that from the signature.
  const current = shallowRef(selected) as ShallowRef<T>;

  const unsubscribe = client.subscribe((next: ChatState) => {
    // Level 1 — the snapshot did not change identity, so nothing did, and the
    // selector does not run. See the doc comment above on why this guard is
    // here even though core's store does not currently need it.
    if (next === raw) return;

    const nextSelected = selector(next);
    // Assigned only after the selector ran without throwing, so a throwing
    // selector retries against the following snapshot instead of latching.
    raw = next;

    // Level 2 — the selected slice did not change; withhold the write.
    if (isEqual(selected, nextSelected)) return;

    selected = nextSelected;
    current.value = nextSelected;
  });

  onChatScopeDispose(unsubscribe, 'useChatSelector');

  return current;
}
