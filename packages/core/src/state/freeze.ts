// Snapshot immutability — the runtime half of §6.4's "full, consistent
// snapshot" guarantee.
//
// The store never mutates state in place; every change builds a new
// top-level object (store.ts). That alone gives React's
// `useSyncExternalStore` the identity change it needs, but it does NOT stop
// a consumer from reaching into a handed-out snapshot and doing
// `state.messages.push(...)`, which would corrupt every other subscriber's
// view of the same object. Freezing closes that hole in the runtime rather
// than only in the type system.

/**
 * Recursively freezes `value` and everything reachable from it, returning
 * the same reference.
 *
 * **Cost is amortized, not per-call.** Already-frozen objects short-circuit,
 * so freezing a snapshot whose 500-message array gained one message walks
 * the array but does O(1) work per already-frozen message. This rests on one
 * invariant: *anything frozen was deep-frozen by this function*. The store
 * is the only writer of state and never calls `Object.freeze` directly, so
 * that invariant holds for every object it creates. A caller that hands the
 * store a pre-frozen object with unfrozen children would defeat the
 * short-circuit — which is part of why the contract below exists.
 *
 * **Contract for core's internal mutators (T7/T8/T10/T11/T12):** an object
 * passed into `ChatStore.setState` is *adopted* — it becomes part of an
 * immutable snapshot and is frozen in place. Build a fresh object or array
 * for every change (`[...messages, next]`, never `messages.push(next)`) and
 * do not retain a reference you intend to mutate afterwards.
 *
 * Cycles terminate naturally: the second visit finds the object already
 * frozen and returns.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);

  // `Object.keys` covers array indices as well as plain-object keys, and
  // deliberately skips the prototype chain — we freeze the graph the store
  // owns, not the prototypes it borrows.
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return value;
}
