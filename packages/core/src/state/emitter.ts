// The `on(event, handler)` half of §6.4's two subscription primitives.
//
// Kept separate from the state store because the two have genuinely
// different delivery semantics: state notifications are microtask-batched
// (many mutations collapse into one notification), while events are discrete
// occurrences that are delivered as they happen and must not be collapsed —
// two `message` events are two messages, never one.

import type { ChatEventHandler, ChatEventMap, ChatEventName } from './events.js';
import { rethrowListenerError } from './listener-error.js';
import type { ListenerErrorReporter } from './listener-error.js';
import type { Unsubscribe } from './types.js';

/**
 * One registration. A wrapper object rather than the bare function so that
 * registering the *same* function twice yields two independent
 * registrations: unsubscribing one must not silently deafen the other. (A
 * `Set` of bare functions would collapse them, which is a real hazard when
 * two components share a module-level callback.)
 *
 * The handler is stored as `(payload: never) => void` — every concrete
 * handler is assignable to it by contravariance, so registration needs no
 * cast. `emit` re-narrows it once, where the event name proves the payload
 * type.
 */
interface Registration {
  readonly handler: (payload: never) => void;
}

/**
 * Typed event emitter over the §6.5 catalog.
 *
 * Delivery is synchronous. Combined with the store applying mutations
 * synchronously (only *notification* is batched), a handler that calls
 * `getState()` always observes state that already includes whatever
 * triggered the event.
 */
export class ChatEventEmitter {
  readonly #registrations = new Map<ChatEventName, Set<Registration>>();
  readonly #reportError: ListenerErrorReporter;

  constructor(reportError: ListenerErrorReporter = rethrowListenerError) {
    this.#reportError = reportError;
  }

  /**
   * Registers `handler` for `event`. The handler's payload is inferred from
   * the event name — `on('message', (m) => m.content)` needs no annotation.
   */
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe {
    const registration: Registration = { handler };

    let forEvent = this.#registrations.get(event);
    if (forEvent === undefined) {
      forEvent = new Set();
      this.#registrations.set(event, forEvent);
    }
    forEvent.add(registration);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      forEvent.delete(registration);
    };
  }

  /**
   * Delivers `payload` to every handler registered for `event`.
   *
   * Re-entrancy is safe in both directions: handlers are iterated over a
   * snapshot, so registering during delivery does not extend the current
   * pass, and each handler is re-checked against the live set, so a handler
   * unsubscribed earlier in the same pass is not called. A throwing handler
   * is reported and delivery continues to its siblings (listener-error.ts).
   */
  emit<E extends ChatEventName>(event: E, payload: ChatEventMap[E]): void {
    const forEvent = this.#registrations.get(event);
    if (forEvent === undefined || forEvent.size === 0) return;

    for (const registration of [...forEvent]) {
      if (!forEvent.has(registration)) continue;

      try {
        // The one narrowing cast in this module: `E` proves the payload type
        // that `Registration` deliberately erased.
        (registration.handler as (value: ChatEventMap[E]) => void)(payload);
      } catch (error) {
        this.#reportError(error);
      }
    }
  }

  /** Number of live registrations for `event`. Test/diagnostic use. */
  listenerCount(event: ChatEventName): number {
    return this.#registrations.get(event)?.size ?? 0;
  }

  /** Drops every registration — used when a client is torn down (T13). */
  clear(): void {
    this.#registrations.clear();
  }
}
