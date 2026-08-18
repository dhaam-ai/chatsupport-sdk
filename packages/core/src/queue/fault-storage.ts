// Test support: a `StorageAdapter` you can make fail on purpose.
//
// Exported for the same reason transport/ ships `StubWebSocket` and presence/
// ships `ManualTimers` — the interesting behaviour of the send queue is what
// it does when storage *misbehaves*, and that is unreachable through
// `MemoryStorageAdapter`, whose operations cannot fail. A binding integrating
// its own adapter should be able to prove the queue survives a full disk
// without waiting for a user to fill one.
//
// Deliberately a separate module from memory.ts's adapter rather than an
// option on it: fault injection has no business being reachable in production
// code, and keeping it here means it is never one typo away from being
// switched on by a config object.

import { type StorageAdapter, StorageError, type StorageErrorCode } from '../storage/index.js';

/** A storage-backed byte budget, so `quota_exceeded` can be provoked honestly. */
export interface FaultStorageOptions {
  /**
   * Maximum total stored characters. Exceeding it rejects with
   * `quota_exceeded`, the way a real store behaves — as opposed to failing a
   * fixed number of calls, which would let a test pass against a queue that
   * shed nothing.
   */
  readonly maxChars?: number;
}

export class FaultStorageAdapter implements StorageAdapter {
  readonly #entries = new Map<string, string>();
  readonly #maxChars: number;

  /** Set to fail the next `set` with this code, once. */
  failNextSet: StorageErrorCode | null = null;

  /** Set to fail every `set` with this code until cleared. */
  failEverySet: StorageErrorCode | null = null;

  /** Set to fail the next `get` with this code, once. */
  failNextGet: StorageErrorCode | null = null;

  /** Every `set` that was attempted, in order, for asserting on write count. */
  readonly setCalls: string[] = [];

  constructor(options: FaultStorageOptions = {}) {
    this.#maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
  }

  get(key: string): Promise<string | null> {
    const code = this.failNextGet;
    if (code !== null) {
      this.failNextGet = null;
      return Promise.reject(new StorageError(code, 'injected read fault'));
    }

    return Promise.resolve(this.#entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.setCalls.push(key);

    const forced = this.failEverySet ?? this.failNextSet;
    if (forced !== null) {
      this.failNextSet = null;
      return Promise.reject(new StorageError(forced, 'injected write fault'));
    }

    if (this.#totalCharsWith(key, value) > this.#maxChars) {
      return Promise.reject(new StorageError('quota_exceeded', 'injected quota exhaustion'));
    }

    this.#entries.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  /** Reads a key without going through the failure paths, for assertions. */
  peek(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  #totalCharsWith(key: string, value: string): number {
    let total = value.length;
    for (const [existingKey, existingValue] of this.#entries) {
      if (existingKey !== key) total += existingValue.length;
    }
    return total;
  }
}
