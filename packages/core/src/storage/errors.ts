// Storage failure taxonomy. See ./types.ts for the contract these express.

/**
 * Why a storage operation failed.
 *
 * - `unavailable`    — the backing store cannot be used at all (site data
 *                      blocked, opaque origin). Raised at construction, not
 *                      per-operation.
 * - `quota_exceeded` — the store is full. Distinguished from `write_failed`
 *                      because it is *recoverable*: the caller can prune old
 *                      entries per the retention policy (§9.6) and retry.
 * - `write_failed`   — a `set`/`remove` did not land, for any other reason.
 * - `read_failed`    — a `get` could not be completed. Means "unknown", not
 *                      "absent".
 */
export type StorageErrorCode =
  | 'unavailable'
  | 'quota_exceeded'
  | 'write_failed'
  | 'read_failed';

/**
 * Error raised by {@link StorageAdapter} implementations.
 *
 * Carries a machine-readable {@link StorageErrorCode} so callers can branch on
 * the failure without string-matching messages — the offline send queue needs
 * to treat `quota_exceeded` (prune and retry) differently from `write_failed`
 * (surface as permanently failed).
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;

  /**
   * The underlying platform error, when there was one.
   *
   * Held as an explicit field rather than via the ES2022 `Error` `cause`
   * option, because this package targets ES2020 where that option is not in
   * the standard library types.
   */
  readonly cause: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Narrows an unknown thrown value to a {@link StorageError}.
 *
 * Prefer this over `instanceof` at package boundaries, where duplicated copies
 * of the module could otherwise defeat the prototype check.
 */
export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}
