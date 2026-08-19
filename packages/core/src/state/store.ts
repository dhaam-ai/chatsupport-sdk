// The observable state store — PRD §6.4, first of core's "exactly two
// subscription primitives". Task T3: getState/subscribe/setState, microtask
// batching.
//
// Judgment call on batching semantics: §6.4 says subscribe "fires
// synchronously (microtask-batched, not per-internal-mutation)", which reads
// as internally tensioned taken alone — "synchronously" and "microtask"
// describe two different timings. Read together with this task's own
// description in docs/spec/chat-sdk-v2-plan.md ("microtask batching"), the
// intended contract is: `setState` mutates the held state synchronously, so
// `getState()` reflects it immediately: but the *notification* to
// subscribers is deferred to the next microtask and coalesced — several
// `setState` calls in the same synchronous stretch of code produce exactly
// one notification, carrying the final state, not one per call. That is
// what "not per-internal-mutation" is ruling out.

import type { ChatState } from './types.js';
import type { Unsubscribe } from './types.js';

type Listener = (state: ChatState) => void;
type Patch = Partial<ChatState> | ((prev: ChatState) => Partial<ChatState>);

export class ChatStateStore {
  #state: ChatState;
  #listeners = new Set<Listener>();
  #notifyScheduled = false;

  constructor(initialState: ChatState) {
    this.#state = initialState;
  }

  /** Synchronous snapshot — PRD §6.4's `ChatClient.getState()`. */
  getState(): ChatState {
    return this.#state;
  }

  /**
   * Registers `listener` to be called with the full new `ChatState` after a
   * batch of mutations settles. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Applies `patch` — a partial state object, or a function of the previous
   * state returning one — and schedules a batched notification.
   *
   * Not part of PRD §6.4's public `ChatClient` surface. This is the internal
   * mutation primitive later tasks (T7 transport, T8 connection, T9 auth,
   * T11 messages, T12 presence) call as they translate wire frames into
   * state; none of those reducers live in this module.
   */
  setState(patch: Patch): void {
    const resolved = typeof patch === 'function' ? patch(this.#state) : patch;
    this.#state = { ...this.#state, ...resolved };
    this.#scheduleNotify();
  }

  #scheduleNotify(): void {
    if (this.#notifyScheduled) return;
    this.#notifyScheduled = true;

    queueMicrotask(() => {
      // Reset before iterating: a listener that itself calls `setState`
      // (re-entrant mutation from within a notification) must be able to
      // schedule a fresh follow-up batch, not have it silently swallowed
      // because this flag was still `true`.
      this.#notifyScheduled = false;

      const snapshot = this.#state;
      // Snapshot the listener set before iterating: a listener unsubscribing
      // itself or another listener mid-notification must not change who
      // gets called during *this* notification pass.
      for (const listener of [...this.#listeners]) {
        listener(snapshot);
      }
    });
  }
}
