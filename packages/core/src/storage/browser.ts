// localStorage-backed StorageAdapter.
//
// This is the "clearly isolated, optional platform-adapter file" that PRD §15
// carves out. Two rules hold it to that:
//
//  1. Nothing here touches a platform global at MODULE scope. Every access
//     happens lazily inside a function body. Reading `localStorage` while the
//     module is being evaluated would break SSR (Next.js) the instant core is
//     imported on a server — importing this file must stay inert.
//  2. It never references `window` or `document` at all. `globalThis` is
//     enough, and it degrades to `undefined` in Node rather than throwing a
//     ReferenceError.
//
// Availability is settled up front with a real capability probe rather than a
// `typeof window` guess, because — per MDN — "various browsers offer settings
// that disable the storage API, without hiding the global object":
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API#testing_for_availability

import { StorageError } from './errors.js';
import type { StorageAdapter } from './types.js';

/**
 * The slice of the Web Storage API this adapter needs.
 *
 * Declared structurally instead of using the DOM `Storage` type so the module
 * carries no DOM-lib dependency, and so tests (and `sessionStorage`, and any
 * synchronous key/value store) can satisfy it directly.
 */
export interface WebStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = '__dhaam_ccrm_storage_probe__';

/**
 * Reads the ambient `localStorage`, lazily and defensively.
 *
 * The property access itself can throw `SecurityError` — on an opaque origin,
 * or when the user has blocked site data — so even reaching for it needs a
 * guard, not just calling methods on it.
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage#exceptions
 */
function resolveAmbientLocalStorage(): WebStorageLike | null {
  try {
    const { localStorage } = globalThis as {
      localStorage?: WebStorageLike | null;
    };
    return localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * True when `error` reports the store being full.
 *
 * Matched structurally on both the modern name and the legacy numeric code
 * (22 = `QUOTA_EXCEEDED_ERR`), which `DOMException.code` still exposes.
 * Undocumented vendor-specific codes are deliberately not matched.
 * https://developer.mozilla.org/en-US/docs/Web/API/DOMException#error_names
 */
function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || code === 22;
}

/** `store.length`, or 0 if even reading it throws. */
function storedItemCount(store: WebStorageLike): number {
  try {
    return store.length;
  } catch {
    return 0;
  }
}

/**
 * Capability probe: actually writes and removes a key.
 *
 * A `typeof window !== 'undefined'` check would pass in exactly the cases that
 * break — Safari private mode and sandboxed iframes expose the object and then
 * throw on use. Only a real write settles it.
 */
function isUsable(store: WebStorageLike): boolean {
  try {
    store.setItem(PROBE_KEY, PROBE_KEY);
    store.removeItem(PROBE_KEY);
    return true;
  } catch (error) {
    // A quota error with data already stored means storage works and is merely
    // full — still usable, and callers can prune per §9.6. A quota error with
    // an empty store is how a disabled store presents itself, so treat that as
    // unavailable. This mirrors MDN's `storageAvailable()`.
    return isQuotaExceeded(error) && storedItemCount(store) > 0;
  }
}

/**
 * A {@link StorageAdapter} backed by `localStorage`.
 *
 * Unlike {@link MemoryStorageAdapter}, this survives a page reload — which is
 * the property the offline send queue needs so a message the user believes
 * they sent is not lost by refreshing the tab (§9.1).
 *
 * @throws {StorageError} with code `unavailable` if the backing store is
 * missing or unusable. That check runs here, at construction, so the failure
 * lands at one controlled point rather than on some later write, and callers
 * can fall back before any message depends on it. Prefer
 * {@link createBrowserStorageAdapter} to get that fallback without a try/catch.
 */
export class BrowserStorageAdapter implements StorageAdapter {
  readonly #store: WebStorageLike;

  /**
   * @param backingStore Store to use instead of the ambient `localStorage` —
   * `sessionStorage`, or a fake in tests. Injected rather than constructed
   * internally so the failure modes stay testable without a browser.
   */
  constructor(backingStore?: WebStorageLike) {
    const store = backingStore ?? resolveAmbientLocalStorage();

    if (store === null) {
      throw new StorageError(
        'unavailable',
        'localStorage is not available in this environment.',
      );
    }

    if (!isUsable(store)) {
      throw new StorageError(
        'unavailable',
        'localStorage is present but unusable — site data is likely blocked.',
      );
    }

    this.#store = store;
  }

  get(key: string): Promise<string | null> {
    try {
      // Normalised with `?? null` so a non-conforming store cannot leak
      // `undefined` past the boundary as a second "absent" value.
      return Promise.resolve(this.#store.getItem(key) ?? null);
    } catch (error) {
      return Promise.reject(
        new StorageError(
          'read_failed',
          `Failed to read key "${key}" from localStorage.`,
          error,
        ),
      );
    }
  }

  set(key: string, value: string): Promise<void> {
    try {
      this.#store.setItem(key, value);
      return Promise.resolve();
    } catch (error) {
      // The load-bearing line of this file: a failed write REJECTS. Resolving
      // here — or catching and ignoring — would tell the send queue a message
      // was durably persisted when it was not, and the user would lose it on
      // reload having been shown it as sent.
      return Promise.reject(
        new StorageError(
          isQuotaExceeded(error) ? 'quota_exceeded' : 'write_failed',
          `Failed to write key "${key}" to localStorage.`,
          error,
        ),
      );
    }
  }

  remove(key: string): Promise<void> {
    try {
      this.#store.removeItem(key);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        new StorageError(
          'write_failed',
          `Failed to remove key "${key}" from localStorage.`,
          error,
        ),
      );
    }
  }
}

/**
 * Builds a {@link BrowserStorageAdapter}, or returns `null` when localStorage
 * cannot be used.
 *
 * The documented graceful-degradation path — storage failure must never crash
 * the SDK, so callers pick a fallback explicitly:
 *
 * ```ts
 * const storage = createBrowserStorageAdapter() ?? new MemoryStorageAdapter();
 * ```
 *
 * Note the asymmetry with the per-operation contract, which is deliberate:
 * *availability* degrades quietly to `null` here because there is a real
 * fallback, whereas a failed `set` on a live adapter always rejects because
 * there is nothing safe to fall back to.
 */
export function createBrowserStorageAdapter(
  backingStore?: WebStorageLike,
): BrowserStorageAdapter | null {
  try {
    return new BrowserStorageAdapter(backingStore);
  } catch {
    return null;
  }
}
