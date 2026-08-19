// Typed discrete-event emitter — PRD §6.4, second of core's "exactly two
// subscription primitives". Backs `ChatClient.on()` over the `ChatEventMap`
// catalog (§6.5).
//
// Distinct from `ChatStateStore`: events here are one-shot occurrences (a
// reconnect attempt was scheduled, a ticket got linked) that are "not
// naturally 'current state'" per §6.4 — there is no meaningful "current
// value" of a `ticketLinked` event the way there is for `ChatState.session`.
// Emission is synchronous and unbatched; only the state store defers and
// coalesces notifications.

import type { Unsubscribe } from './types.js';

type Listener<T> = (payload: T) => void;

// Constrained to `object`, not `Record<string, unknown>` — a concrete
// interface without an explicit index signature (like `ChatEventMap`) does
// not structurally satisfy a `Record<string, unknown>` constraint even
// though every property IS one, which is a known TS inference gap around
// generic constraint checking specifically (ordinary assignability doesn't
// hit this; only generic instantiation does). `object` sidesteps it without
// weakening what this class actually needs from `EventMap`.
export class ChatEventEmitter<EventMap extends object> {
  #listeners = new Map<keyof EventMap, Set<Listener<unknown>>>();

  /** Registers `handler` for `event`. Returns an unsubscribe function. */
  on<E extends keyof EventMap>(event: E, handler: (payload: EventMap[E]) => void): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(handler as Listener<unknown>);

    return () => {
      set.delete(handler as Listener<unknown>);
    };
  }

  /**
   * Synchronously calls every handler currently registered for `event` with
   * `payload`. A no-op if nothing is listening.
   */
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;

    // Snapshot before iterating: a handler that subscribes or unsubscribes
    // (itself or another handler for the same event) during emission must
    // not change who gets called during *this* emit call.
    for (const listener of [...set]) {
      listener(payload);
    }
  }
}
