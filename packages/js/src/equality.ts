// The two equality functions a selector subscription can be given.
//
// This file exists because §6.4 hands field-level diffing to bindings ("core
// only guarantees the full, consistent snapshot is available on every
// notification; it does not do field-level diffing itself... Bindings are
// responsible for their framework's fine-grained-vs-coarse re-render
// tradeoff"). React gets to lean on `useSyncExternalStore`'s own `Object.is`
// check; there is no framework here to lean on, so equality is entirely this
// package's job — and without it every subscriber fires on every state change.

/**
 * Reference equality. The default for every subscription, and the right
 * answer whenever a selector returns a field straight off `ChatState`
 * (`s => s.messages`, `s => s.typing`, `s => s.unreadCount`): core rebuilds
 * the snapshot object on change but keeps untouched fields
 * reference-identical, so `Object.is` alone already suppresses every
 * unrelated notification.
 */
export function strictEqual<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Compares two values one level deep. Pass this for a selector that
 * *combines* fields into a new object or array — `s => ({ hasMore:
 * s.pagination.hasMore, count: s.messages.length })` builds a fresh object on
 * every call by construction, so {@link strictEqual} would report "changed"
 * on every single store notification and defeat selector caching entirely.
 *
 * Deliberately null-safe rather than `Object.keys`-first: a selector like
 * `s => s.session` legitimately returns `null` before a session exists and an
 * object after, and `Object.keys(null)` throws. Making the common case safe
 * here is cheaper and clearer than making every call site defend against it.
 *
 * Arrays are compared element-wise (same length, `Object.is` per slot) rather
 * than by their string keys, so a selector returning a derived array is
 * usable without a custom comparator.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const arrayA = a as readonly unknown[];
    const arrayB = b as readonly unknown[];
    if (arrayA.length !== arrayB.length) return false;
    for (let index = 0; index < arrayA.length; index += 1) {
      if (!Object.is(arrayA[index], arrayB[index])) return false;
    }
    return true;
  }

  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA);
  if (keysA.length !== Object.keys(recordB).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recordB, key)) return false;
    if (!Object.is(recordA[key], recordB[key])) return false;
  }
  return true;
}
