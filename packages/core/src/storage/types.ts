// Durable storage seam for @dhaam-ccrm/core.
//
// Specified by docs/spec/chat-sdk-v2-prd.md §9.1. This module is types only —
// it emits no runtime code, so importing the interface costs a consumer
// nothing at all in their bundle.

import type { StorageError } from './errors.js';

/**
 * Abstract durable key/value storage.
 *
 * Deliberately minimal — `get`/`set`/`remove`, string-keyed, string-valued,
 * async — so that any platform can implement it: browser `localStorage`,
 * React Native `AsyncStorage`, Kotlin, Swift. Every method added here becomes
 * a porting burden on every future platform binding, so this interface is
 * intentionally NOT widened with convenience helpers (`has`, `keys`, `clear`,
 * `getMany`, ...). Compose behaviour around it instead — `namespaced()` is the
 * worked example: it adds key isolation without adding a single method.
 *
 * ## Failure contract
 *
 * This is the part that matters, and it is load-bearing for the offline send
 * queue (§9.1). Storage genuinely fails in production: `localStorage` throws
 * `QuotaExceededError` when full, and throws on *every* access when the user
 * has blocked site data.
 *
 * The rule:
 *
 * > **A rejected promise means the operation did not happen. A resolved
 * > promise means it did.**
 *
 * Concretely, `set` MUST reject if the write did not land. It must never
 * resolve on a failed write, and must never swallow the error. A queue that
 * believes a durable write succeeded when it did not is the actual production
 * bug: the user is shown a message as sent, and it is gone after a reload.
 *
 * Callers must treat a rejection as "not persisted" and act on it — surface,
 * retry, or prune per the retention policy in §9.6 — rather than assume
 * durability.
 *
 * Implementations reject with {@link StorageError}, whose `code` lets callers
 * separate a recoverable `quota_exceeded` from a hard failure.
 *
 * *Availability* is a deliberately separate concern from *operation failure*:
 * an adapter that cannot work at all fails up front at construction rather
 * than on first use, so that a caller can fall back to another adapter before
 * any message depends on it. See `createBrowserStorageAdapter()`.
 */
export interface StorageAdapter {
  /**
   * Reads the value stored at `key`.
   *
   * Resolves `null` — never `undefined` — when the key is absent. This mirrors
   * the Web Storage specification, where a missing key yields `null`
   * ("If this's map[key] does not exist, then return null" —
   * https://html.spec.whatwg.org/multipage/webstorage.html), so the browser
   * adapter needs no translation layer and every platform agrees on a single
   * "absent" value.
   *
   * Rejects with {@link StorageError} (`read_failed`) if the read itself
   * failed. A rejection means "unknown", NOT "absent" — conflating the two
   * would let a queue restoring after a reload read a transient storage fault
   * as an empty queue and silently drop every pending message.
   */
  get(key: string): Promise<string | null>;

  /**
   * Writes `value` at `key`, replacing any existing value.
   *
   * Resolves only once the value is durably written. Rejects with
   * {@link StorageError} (`quota_exceeded` or `write_failed`) if it was not.
   * Per the failure contract above, this method must never resolve on a failed
   * write.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Removes `key`. Resolves successfully when the key was already absent —
   * removal is idempotent.
   *
   * Rejects with {@link StorageError} (`write_failed`) if the removal failed
   * and the key may therefore still be present.
   */
  remove(key: string): Promise<void>;
}
