// The public shapes of this package's one primitive. Kept separate from
// store.ts so the docs a consumer reads (and the .d.ts a bundler ships) are
// not interleaved with the fan-out machinery that implements them.

import type {
  ChatClient,
  ChatEventHandler,
  ChatEventName,
  ChatState,
  MessageTickState,
  Unsubscribe,
} from '@dhaam-ccrm/core';

/**
 * What replaces a framework's re-render here: a plain function call.
 *
 * `previous` is the value this same subscription last delivered — free to
 * carry (the store already holds it to do equality against) and exactly what
 * an imperative consumer needs to avoid re-deriving it: "scroll to the bottom
 * only if `value.length > previous.length`", "animate only the connection
 * states we actually transitioned between". On the very first call of an
 * `immediate` subscription there is no earlier value, so `previous` is the
 * initial value itself — never `undefined`, which would widen `T` for every
 * consumer to pay for one edge case.
 */
export type StateListener<T> = (value: T, previous: T) => void;

export interface SelectOptions<T> {
  /**
   * Decides whether a recomputed slice counts as changed. Defaults to
   * `strictEqual` (`Object.is`), which is correct for any selector returning
   * a field straight off `ChatState`. Pass `shallowEqual` for a selector that
   * builds a new object or array every call — see equality.ts.
   */
  readonly isEqual?: (a: T, b: T) => boolean;

  /**
   * Call `listener` once, synchronously, with the current value before
   * returning. Defaults to `false`, matching `ChatClient.subscribe`'s own
   * change-only contract (§6.4) — a binding whose primitive disagreed with
   * the primitive it wraps would be a trap.
   *
   * Turn it on for the common UI case: it removes the "render once, then
   * subscribe" double code path, and with it the window between those two
   * statements in which a change can be missed.
   */
  readonly immediate?: boolean;
}

export type SubscribeOptions = Pick<SelectOptions<ChatState>, 'immediate'>;

export interface ChatStoreOptions {
  /**
   * Where a throw from *your* selector, equality function, state listener, or
   * event handler goes.
   *
   * It has to go somewhere. Core isolates a throwing listener so it cannot
   * break the store or starve siblings (`ChatStore#flush`) — but isolation
   * without reporting means a widget author's broken selector simply stops
   * updating, silently, forever. This package therefore catches at the
   * boundary and routes here; the subscription stays alive and recovers on
   * the next snapshot that does not make it throw.
   *
   * Defaults to a single `console.error`. Replace it to route into your own
   * error reporting.
   */
  readonly onError?: (error: unknown) => void;
}

export interface DestroyOptions {
  /**
   * Also call `client.disconnect()`. Defaults to `false`: a store handed an
   * existing `ChatClient` does not own that client's connection, and closing
   * a socket that another part of the page is still using would be a
   * surprising side effect of tearing down one view.
   *
   * Pass `true` when this store is the only consumer — the usual case for a
   * widget being removed from the page.
   */
  readonly disconnect?: boolean;
}

/**
 * The reactivity primitive `@dhaam-ccrm/js` exists to provide: selector
 * subscriptions with pluggable equality, event subscriptions, core's tick
 * derivation, and one call that tears all of it down.
 *
 * Deliberately NOT a proxy for `ChatClient`'s ~18 operations. `sendMessage`,
 * `connect`, `markRead` and friends are reached through {@link client}
 * directly — re-declaring each of them here would add bytes to every widget
 * bundle to save one property access, and would create a second surface to
 * keep in step with §6.2/§6.3. This package maps state to notifications; it
 * does not restate core's API.
 */
export interface ChatStore {
  /**
   * The client this store wraps — the escape hatch for every §6.2/§6.3
   * operation (`connect`, `sendMessage`, `markRead`, `startTyping`, ...).
   * Stable for the store's lifetime.
   */
  readonly client: ChatClient;

  /**
   * The current snapshot. A straight pass-through to `ChatClient.getState()`,
   * including its reference-stability guarantee: two calls with no change
   * between them return the identical object, and this package never wraps,
   * clones, or re-freezes it.
   */
  getState(): ChatState;

  /** Every change to the whole snapshot. Equivalent to `select(state => state, listener)`. */
  subscribe(listener: StateListener<ChatState>, options?: SubscribeOptions): Unsubscribe;

  /**
   * Calls `listener` whenever `selector(state)` changes — and not when it
   * doesn't. This is the whole point of the package: core notifies on every
   * state change, and without per-subscription selector caching every
   * subscriber would fire on every message for a slice it does not read.
   *
   * Returns an idempotent unsubscribe.
   */
  select<T>(selector: (state: ChatState) => T, listener: StateListener<T>, options?: SelectOptions<T>): Unsubscribe;

  /**
   * Subscribes to one §6.5 event. A thin wrapper over `ChatClient.on` that
   * adds exactly two things: the handler's throws are routed to
   * {@link ChatStoreOptions.onError} instead of being swallowed, and the
   * registration is torn down by {@link destroy}.
   */
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe;

  /**
   * The tick to render for one message, by id — `deriveTickStateFromState`
   * from `@dhaam-ccrm/core`, applied to the current snapshot, with the
   * `messages` lookup done for you. Never a derivation of this package's own:
   * v1's presence-based tick bug is exactly what one canonical
   * implementation exists to prevent.
   *
   * `localParticipantId` is required and never guessed. `null` yields `null`
   * for every message (core's documented conservative no-tick), which is what
   * you want before identity is known.
   *
   * O(n) in `messages` because of the id lookup. Rendering a whole list is
   * better served by calling the re-exported `deriveTickState` once per
   * message you are already iterating.
   */
  tick(messageId: string, localParticipantId: string | null): MessageTickState | null;

  /**
   * Drops every subscription this store created — state selections and event
   * handlers alike — and makes further `subscribe`/`select`/`on` calls throw.
   * Idempotent.
   */
  destroy(options?: DestroyOptions): void;
}
