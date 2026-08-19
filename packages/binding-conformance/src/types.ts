// The adapter contract — the one thing T20 (Vue), T21 (Angular), and T22
// (vanilla) each have to write to get the whole suite (T17's brief:
// "Shape it so T20/T21/T22 each write a small adapter and get the whole
// suite"). Everything in `checks/` is written against these three
// interfaces and nothing more binding-specific than this.
//
// Design principle: `mount(client)` receives exactly a `ChatClient`
// (`@dhaam-ccrm/core`'s public type) — nothing richer, nothing
// framework-flavored — because that is the one surface PRD §6.4 says a
// binding may consume ("Bindings must use these two primitives [subscribe,
// on] and nothing else... they may not reach into WS/REST/storage
// directly"). A `mount` implementation that needs anything more than a
// `ChatClient` is already out of contract, and this type signature is what
// makes that a compile error rather than a code-review nit.
//
// A `BindingHandle` is deliberately NOT "the binding's exposed hooks" —
// it is a probe surface the suite uses to mount independent CONSUMERS of
// the binding (`observeState`, `observeEvent`), each one standing in for a
// real component/composable/directive a real app would write. This is what
// lets the suite test sibling isolation (two consumers, one throws) and
// leak-freedom (create and dispose consumers repeatedly) without needing to
// know anything about how a given framework structures a "component".

import type { ChatClient, ChatEventMap, ChatEventName, ChatState } from '@dhaam-ccrm/core';

/**
 * `core`'s own `MessageTickState` (`packages/core/src/messages/ticks.ts`)
 * is NOT part of `@dhaam-ccrm/core`'s public barrel (`packages/core/src/index.ts`)
 * — see `src/ticks-oracle.ts`'s header for the full account, and this
 * package's final report for the finding. This is a type-only mirror of
 * that four-value union, kept here only so `BindingAdapter.computeTick`
 * below can be typed without a deep import. It duplicates nothing but a
 * literal union of four strings — there is no algorithm here to drift.
 */
export type MirroredMessageTickState = 'pending' | 'sent' | 'delivered' | 'read';

/**
 * One mounted consumer of `selector(state)`, exactly as a real
 * component/composable in the binding's framework would subscribe through
 * the binding's own primitive (a hook, a composable, a directive — never
 * the raw `ChatClient` directly).
 */
export interface StateView<T> {
  /**
   * The value this view currently exposes. Must reflect the binding's own
   * re-render/update cycle, not a value the suite computed itself — i.e.
   * this should be "what a real component's render function would see
   * right now", not `selector(client.getState())` recomputed fresh.
   *
   * Throws if {@link crashed} is `true` — a view that crashed has nothing
   * honest to report.
   */
  value(): T;

  /**
   * How many times this view's exposed value has changed since the view
   * was created — NOT counting the initial mount value. A binding that
   * never notifies its consumers reports 0 forever regardless of how many
   * times the underlying store changes; a binding whose selector caching
   * is broken over-reports every store notification even when the
   * *selected* slice was untouched. Both are check failures this field
   * exists to catch.
   */
  updateCount(): number;

  /**
   * `true` once this view's own consumption of `selector` has thrown and
   * the view could not recover. A selector CAN legitimately throw (the
   * suite deliberately exercises this — see the lifecycle checks); what a
   * conformant binding must not do is let that crash propagate to and
   * disable a *sibling* view mounted from the same handle.
   */
  crashed(): boolean;

  /**
   * Tears down just this view (unsubscribes, unmounts its own
   * component/composable) without affecting sibling views created from the
   * same handle. Safe to call more than once.
   */
  dispose(): void;
}

/** One mounted handler for a single §6.5 event, through the binding's own event-subscription primitive. */
export interface EventView<E extends ChatEventName> {
  /** Every payload this view's handler has received, oldest first, exactly as the binding delivered it. */
  received(): ReadonlyArray<ChatEventMap[E]>;

  /** Tears down just this view. Safe to call more than once. */
  dispose(): void;
}

export interface BindingHandle {
  /**
   * Mounts one new consumer of `selector(state)`. `isEqual` defaults to
   * `Object.is` and, when supplied, is the equality the binding's own
   * caching should use to decide "same value, skip the notify" — mirroring
   * `@dhaam-ccrm/react`'s `useChatSelector(selector, isEqual)` shape
   * exactly, since every binding needs the same two-argument shape to let
   * an app pass e.g. a shallow-equal for a composite selector.
   */
  observeState<T>(selector: (state: ChatState) => T, isEqual?: (a: T, b: T) => boolean): StateView<T>;

  /** Mounts one new handler for a §6.5 event, through the binding's own event-subscription primitive. */
  observeEvent<E extends ChatEventName>(event: E): EventView<E>;

  /**
   * Lets a framework-specific adapter flush its own pending async work
   * (React's `act`, Vue's `nextTick`, a debounced Angular change-detection
   * pass, ...) after the suite mutates the underlying client, before the
   * suite reads back through any view. A synchronously-reactive binding
   * (the minimal reference adapter, vanilla JS) can make this a no-op.
   *
   * Every check calls this after every state/event mutation and before
   * every read — a binding that needs a real flush and omits one here will
   * fail checks with a stale-value symptom, not a suite bug.
   */
  settle(): Promise<void>;

  /**
   * Tears down every view created through this handle that has not already
   * been individually disposed, and the handle itself — exactly as the
   * framework's real unmount path would (e.g. `ReactDOM.unmount`, a Vue
   * component's `onUnmounted`). Safe to call more than once.
   */
  unmount(): void;
}

export interface BindingAdapter {
  /** Short, human-readable — used in test/report titles ('react', 'vue', 'never-notifies', ...). */
  readonly name: string;

  /** Mounts the binding against `client`, returning a handle the suite drives and inspects. Called fresh for every check — a `BindingAdapter` is a factory, not a singleton. */
  mount(client: ChatClient): BindingHandle;

  /**
   * Optional. Most bindings (including the reference `@dhaam-ccrm/react`
   * binding) do not own any tick computation at all — an app calls
   * `deriveTickState`/`deriveTickStateFromState` itself, using whatever
   * `messages`/watermark data the binding already exposes through
   * `observeState`. If a binding instead offers its OWN convenience for
   * this (e.g. a `useMessageTick(id)`-style hook), wire it up here so the
   * tick-derivation checks can catch it disagreeing with core's canonical
   * derivation. `handle` is a handle already returned by {@link mount} for
   * the same client, so an implementation can read whatever local
   * participant id / watermark state it needs off it.
   */
  computeTick?(handle: BindingHandle, messageId: string, localParticipantId: string | null): MirroredMessageTickState | null;
}
