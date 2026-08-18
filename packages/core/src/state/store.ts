// The observable store — PRD §6.4.
//
// Decision #2: core state is observable rather than callback-per-operation,
// and every binding (React, Vue, Angular, vanilla) is built on exactly this
// surface. Three public primitives:
//
//   getState()            synchronous snapshot
//   subscribe(listener)   full new state, microtask-batched
//   on(event, handler)    discrete events (§6.5, delegated to the emitter)
//
// plus an internal mutation half — `setState` / `emit` — that transport,
// connection, queue, messages, and presence (T7–T12) drive. T13 assembles
// `ChatClient` and re-exports only the read half.
//
// Two invariants make this work with framework reactivity, and both are
// requirements of React's `useSyncExternalStore` rather than preferences:
//
//   "The store snapshot returned by getSnapshot must be immutable. If the
//    underlying store has mutable data, return a new immutable snapshot if
//    the data has changed. Otherwise, return a cached last snapshot."
//   — https://react.dev/reference/react/useSyncExternalStore (Caveats)
//
// So: state is never mutated in place (a change builds a new top-level
// object, which `Object.is` sees as different and Vue's reactivity tracks
// the same way), and an *unchanged* store must keep returning the identical
// reference — returning a fresh object per `getState()` call is the
// documented cause of React's "getSnapshot should be cached" infinite loop.

import { ChatEventEmitter } from './emitter.js';
import type { ChatEventHandler, ChatEventMap, ChatEventName } from './events.js';
import { deepFreeze } from './freeze.js';
import { rethrowListenerError } from './listener-error.js';
import type { ListenerErrorReporter } from './listener-error.js';
import { createInitialChatState } from './types.js';
import type { ChatState, Unsubscribe } from './types.js';

/** Receives the full new state on every change (§6.4 — never a diff or patch). */
export type ChatStateListener = (state: ChatState) => void;

export interface ChatStoreOptions {
  /** Defaults to `createInitialChatState()`. Frozen on adoption. */
  initialState?: ChatState;

  /**
   * Where a throwing `subscribe` listener or `on` handler's error goes.
   * Defaults to re-throwing on a fresh macrotask (listener-error.ts).
   */
  reportListenerError?: ListenerErrorReporter;
}

/**
 * One `subscribe` registration. A wrapper object for the same reason the
 * emitter uses one: two registrations of the same function must be
 * independently cancellable.
 */
interface Registration {
  readonly listener: ChatStateListener;
}

export class ChatStore {
  #state: ChatState;

  /**
   * The snapshot currently being delivered, or `null` outside a flush.
   *
   * This is what prevents a torn read. A listener that calls `getState()`
   * must see the state it was notified about — including after an *earlier*
   * listener in the same pass mutated the store. Without this, listener B
   * would observe state that listener A already saw a different version of,
   * and the pass would no longer be the "full, consistent snapshot" §6.4
   * promises.
   */
  #notifying: ChatState | null = null;

  #flushScheduled = false;

  readonly #listeners = new Set<Registration>();
  readonly #emitter: ChatEventEmitter;
  readonly #reportError: ListenerErrorReporter;

  constructor(options: ChatStoreOptions = {}) {
    this.#reportError = options.reportListenerError ?? rethrowListenerError;
    this.#state = deepFreeze(options.initialState ?? createInitialChatState());
    this.#emitter = new ChatEventEmitter(this.#reportError);
  }

  // ---------------------------------------------------------------------
  // Public read surface (§6.4)
  // ---------------------------------------------------------------------

  /**
   * The current snapshot. Stable by reference until something actually
   * changes, so it is safe to use directly as `useSyncExternalStore`'s
   * `getSnapshot`.
   *
   * During a notification pass this returns the snapshot being delivered,
   * not a newer one a listener may have just produced.
   */
  getState(): ChatState {
    return this.#notifying ?? this.#state;
  }

  /**
   * Registers `listener`, called with the full new state on every change.
   *
   * Not called on registration — read the current value with `getState()`.
   * Delivery is microtask-batched: any number of `setState` calls in one
   * synchronous run produce exactly one notification, carrying the final
   * state.
   */
  subscribe(listener: ChatStateListener): Unsubscribe {
    const registration: Registration = { listener };
    this.#listeners.add(registration);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(registration);
    };
  }

  /** Registers a handler for a discrete §6.5 event. See emitter.ts. */
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe {
    return this.#emitter.on(event, handler);
  }

  // ---------------------------------------------------------------------
  // Internal mutation surface — T7–T12, not bindings
  // ---------------------------------------------------------------------

  /**
   * Applies a shallow patch, replacing whole fields.
   *
   * The new state is a new top-level object; the old one is never touched.
   * A patch whose every field is already reference-identical is a no-op — no
   * new identity, no notification — so a redundant frame does not wake every
   * binding for nothing.
   *
   * Comparison is by reference, not deep equality: `setState` with a
   * structurally-equal-but-new array counts as a change. §6.4 puts
   * field-level diffing in the bindings' hands ("core only guarantees the
   * full, consistent snapshot"), and a deep compare here would be exactly
   * the diffing work that section assigns elsewhere.
   *
   * Objects passed in are adopted and frozen — build fresh arrays rather
   * than mutating (see freeze.ts).
   */
  setState(patch: Partial<ChatState>): void {
    const current = this.#state;

    let changed = false;
    for (const key of Object.keys(patch) as (keyof ChatState)[]) {
      if (!Object.is(current[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.#state = deepFreeze({ ...current, ...patch });
    this.#scheduleFlush();
  }

  /**
   * Emits a discrete §6.5 event. Delivered synchronously, and since
   * `setState` applies its change synchronously too (only *notification* is
   * deferred), a handler calling `getState()` already sees the state that
   * accompanied this event.
   */
  emit<E extends ChatEventName>(event: E, payload: ChatEventMap[E]): void {
    this.#emitter.emit(event, payload);
  }

  // ---------------------------------------------------------------------
  // Batching
  // ---------------------------------------------------------------------

  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => this.#flush());
  }

  /**
   * Delivers one notification carrying the current state.
   *
   * The scheduled flag is cleared *first*, deliberately: a listener that
   * calls `setState` during this pass then schedules a fresh flush rather
   * than being swallowed by the one already in progress. That next flush
   * carries genuinely newer state, so the mutation is neither lost nor
   * delivered twice.
   */
  #flush(): void {
    this.#flushScheduled = false;

    const snapshot = this.#state;
    this.#notifying = snapshot;

    try {
      // Iterate a copy so registering during the pass does not extend it,
      // and re-check liveness so a listener unsubscribed earlier in this
      // same pass is skipped — without either, unsubscribing mid-flush would
      // shift the remaining listeners out of the pass entirely.
      for (const registration of [...this.#listeners]) {
        if (!this.#listeners.has(registration)) continue;

        try {
          registration.listener(snapshot);
        } catch (error) {
          this.#reportError(error);
        }
      }
    } finally {
      // `finally` so a throw from anywhere above cannot strand the store in
      // a permanently-notifying state, which would freeze `getState()` on a
      // stale snapshot forever.
      this.#notifying = null;
    }
  }

  /** Number of live state listeners. Test/diagnostic use. */
  get listenerCount(): number {
    return this.#listeners.size;
  }
}
