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
