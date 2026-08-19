// The two selector equalities this package hands to Angular's `computed`,
// mirroring `@dhaam-ccrm/react`'s `defaultIsEqual`/`shallowEqual` name for
// name so the two bindings' docs read identically (PRD §15).
//
// Why a binding owns these at all: §6.4 is explicit that core does no
// field-level diffing ("core only guarantees the full, consistent snapshot is
// available on every notification; it does not do field-level diffing
// itself") and hands that job to bindings. In Angular the plumbing is
// `computed(fn, { equal })` — when `equal` says the recomputed value matches,
// Angular keeps the PREVIOUS value (same reference) and does not bump the
// signal's version, so no consumer re-renders. That is the same trick
// `@dhaam-ccrm/react`'s `useChatSelector` implements by hand with its
// `{ raw, selected }` cache; here it is the framework primitive's own
// behaviour, so this file only has to supply the predicates.

/** Reference equality. The right default for a selector returning a field straight off `ChatState`. */
export function defaultIsEqual<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Shallow-compares two plain objects one level deep.
 *
 * For a selector that *combines* several `ChatState` fields into one object —
 * which necessarily builds a new object literal on every call — this is what
 * lets `ChatStore.select` recognize "same values, new wrapper" as unchanged
 * instead of notifying on every store notification regardless of what
 * actually changed.
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
