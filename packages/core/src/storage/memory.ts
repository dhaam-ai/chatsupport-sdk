// In-memory StorageAdapter — the default (PRD §9.1).
//
// Imports nothing at runtime: the only import is type-only and is erased at
// compile time, so a consumer using just this adapter bundles a single small
// class and no other part of the storage module.

import type { StorageAdapter } from './types.js';

/**
 * The default {@link StorageAdapter}: durable for the lifetime of the process,
 * and no longer.
 *
 * Per §9.1 this "survives a network blip, not a reload" — it keeps the send
 * queue intact across a disconnect/reconnect cycle, which is the common case,
 * but a page reload starts empty. Platform bindings are expected to supply a
 * genuinely persistent adapter where one exists.
 *
 * Operations cannot fail, so they always resolve. Nothing here touches a
 * platform global, which makes this adapter safe in a browser, in a Node test
 * process, and on a server during SSR alike.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly #entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    // `Map.get` yields `undefined` when absent; the interface contract is
    // `null`, so normalise rather than leak a second "absent" value.
    return Promise.resolve(this.#entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.#entries.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }
}
