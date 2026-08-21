// Key namespacing for StorageAdapter.
//
// Type-only import, so this module adds nothing to a consumer's runtime graph
// beyond the small function below.

import type { StorageAdapter } from './types.js';

/**
 * Separator between the namespace and the caller's key.
 *
 * Not configurable: a second delimiter would be one more thing every platform
 * binding has to agree on for stored data to remain readable across them.
 */
const NAMESPACE_DELIMITER = ':';

/**
 * Wraps an adapter so every key is prefixed with `namespace`.
 *
 * Two clients — or two tenants — sharing one backing store would otherwise
 * collide on identical keys, with one silently overwriting the other's send
 * queue. Prefixing partitions the keyspace so they cannot.
 *
 * ```ts
 * const shared = new MemoryStorageAdapter();
 * const acme = namespaced(shared, 'tenant-acme');
 * const globex = namespaced(shared, 'tenant-globex');
 * // acme.set('queue', ...) and globex.set('queue', ...) never touch the same key
 * ```
 *
 * The result is itself a {@link StorageAdapter}, which is the point: isolation
 * is added by composition rather than by adding methods to the interface every
 * platform must implement. Wrappers nest, so a client namespace can sit inside
 * a tenant namespace.
 *
 * The failure contract passes through untouched — a rejected `set` from the
 * underlying adapter still rejects here, with the original error.
 *
 * @param namespace Non-empty, and may not contain `:`. Both are rejected
 * eagerly because a namespace containing the delimiter would reintroduce the
 * very collision this exists to prevent: namespace `a:b` with key `c`, and
 * namespace `a` with key `b:c`, would both produce the key `a:b:c`.
 * @throws {TypeError} if `namespace` is empty or contains `:`.
 */
/**
 * Makes an arbitrary string safe to pass to {@link namespaced}.
 *
 * `namespaced` rejects a namespace containing `:` — correctly, since that is
 * what stops two different namespace/key pairs colliding. But some namespace
 * segments are not ours to choose: a participant id comes from the host
 * application's own user table and may legitimately contain anything,
 * including a colon (`auth0:1234` and `urn:user:9` are both real formats).
 * Passing one straight in throws at construction, taking the whole widget down
 * over the shape of somebody's user id.
 *
 * Percent-encoding rather than replacement, and `%` first so the encoding is
 * INJECTIVE: mapping `:` to `_` would let `a:b` and `a_b` — two different
 * identities — resolve to the same namespace and share a send queue, which is
 * the collision this whole mechanism exists to prevent.
 *
 * Empty in, `'_'` out: an empty namespace is also rejected, and there is no
 * encoding of "nothing" that is not a substitution.
 */
export function encodeNamespaceSegment(value: string): string {
  if (value === '') return '_';
  // `split`/`join` rather than `replaceAll`: this package targets a lib older
  // than ES2021 (see tsconfig), and `replaceAll` does not exist there — a
  // detail worth one line of awkwardness to keep core's browser floor low.
  return value.split('%').join('%25').split(NAMESPACE_DELIMITER).join('%3A');
}

export function namespaced(
  adapter: StorageAdapter,
  namespace: string,
): StorageAdapter {
  if (namespace.length === 0) {
    throw new TypeError('Storage namespace must not be empty.');
  }

  if (namespace.includes(NAMESPACE_DELIMITER)) {
    throw new TypeError(
      `Storage namespace must not contain "${NAMESPACE_DELIMITER}" (received "${namespace}"), ` +
        'because that would let two different namespace/key pairs resolve to the same key.',
    );
  }

  const prefix = `${namespace}${NAMESPACE_DELIMITER}`;

  return {
    get: (key) => adapter.get(prefix + key),
    set: (key, value) => adapter.set(prefix + key, value),
    remove: (key) => adapter.remove(prefix + key),
  };
}
