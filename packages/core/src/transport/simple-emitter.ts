// A tiny typed pub/sub, local to `transport/`.
//
// `packages/core/src/state` (task T3) already has an equivalent
// `ChatEventEmitter`, but plan.md's dependency table lists T7 as needing
// only T1 and T6 — not T3. Reusing state's emitter here would add an
// undeclared dependency across that boundary for the sake of ~15 lines of
// code, so this module re-declares the same small pattern instead. If a
// third module ends up needing this shape, that's the signal to promote it
// to somewhere both can depend on without crossing a task boundary.

export type Unsubscribe = () => void;

// Constrained to `object`, not `Record<string, unknown>` — see
// state/event-emitter.ts's identical note: a concrete interface without an
// index signature doesn't structurally satisfy a `Record` constraint at
// generic-instantiation time, even though ordinary assignability allows it.
export class SimpleEmitter<EventMap extends object> {
  #listeners = new Map<keyof EventMap, Set<(payload: unknown) => void>>();

  on<E extends keyof EventMap>(event: E, handler: (payload: EventMap[E]) => void): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => {
      set.delete(handler as (payload: unknown) => void);
    };
  }

  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      listener(payload);
    }
  }
}
