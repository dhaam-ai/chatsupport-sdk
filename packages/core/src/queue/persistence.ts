// The queue's one point of contact with `StorageAdapter` (§9.1, §9.6).
//
// Everything about storage failing lives here, so that the queue proper never
// branches on a `StorageErrorCode` and never has to remember which codes are
// recoverable. Two rules, and the whole module is built to make them
// structural rather than remembered:
//
//   `quota_exceeded` is recoverable. The store is full, so shed the oldest
//   entries and try again — that is exactly what §9.6's retention bound is
//   for, applied under pressure instead of on a schedule.
//
//   `write_failed` is not. It gets no retry and no salvage: it propagates,
//   and the caller surfaces the send as permanently failed. Retrying a write
//   that failed for an unknown reason just delays telling the user.
//
// The contract this rests on is `StorageAdapter`'s: a rejected promise means
// the write did NOT happen, a resolved one means it did. `save` resolving is
// therefore the only proof the queue accepts that a send is durably queued —
// which is what keeps "never report a send as queued when the write did not
// land" from being a rule someone has to follow.
//
// No message content is read, formatted, or logged here (§14).

import { type StorageAdapter, isStorageError } from '../storage/index.js';
import { type QueueDecodeResult, decodeQueue, encodeQueue } from './codec.js';
import type { QueuedSend } from './types.js';

/** What a successful save actually managed to keep. */
export interface SaveOutcome {
  /** The entries now durably stored, in order. */
  readonly persisted: QueuedSend[];

  /**
   * Entries shed to fit under quota, oldest first.
   *
   * These are gone from storage and must be surfaced as permanently failed
   * (`'evicted'`) — dropping them silently is the data loss this module is
   * written to avoid.
   */
  readonly evicted: QueuedSend[];
}

export class QueuePersistence {
  readonly #storage: StorageAdapter;
  readonly #key: string;

  constructor(storage: StorageAdapter, key: string) {
    this.#storage = storage;
    this.#key = key;
  }

  /**
   * Reads the persisted queue back.
   *
   * A read *fault* propagates rather than being converted to an empty queue.
   * `null` means absent; a rejection means unknown, and treating unknown as
   * "no pending messages" would silently discard every send the user believes
   * they made — the precise failure `StorageAdapter`'s contract calls out.
   */
  async load(): Promise<QueueDecodeResult> {
    return decodeQueue(await this.#storage.get(this.#key));
  }

  /**
   * Persists `entries`, shedding the oldest only if the store is full.
   *
   * Resolves only once the write has landed. Rejects with the underlying
   * `StorageError` when it has not — including a `quota_exceeded` that
   * survives shedding everything, which is no longer a space problem.
   */
  async save(entries: readonly QueuedSend[]): Promise<SaveOutcome> {
    let remaining = [...entries];
    const evicted: QueuedSend[] = [];

    // Bounded by construction: each pass either returns or removes one entry,
    // and the empty queue is still attempted before giving up.
    for (;;) {
      try {
        await this.#write(remaining);
        return { persisted: remaining, evicted };
      } catch (error) {
        if (!isStorageError(error) || error.code !== 'quota_exceeded') throw error;

        // Out of room and nothing left to give back — this is not a size
        // problem any more, so stop calling it one.
        if (remaining.length === 0) throw error;

        // Oldest first: the entry closest to aging out under §9.6 anyway is
        // the one whose loss costs the user least.
        evicted.push(remaining[0] as QueuedSend);
        remaining = remaining.slice(1);
      }
    }
  }

  /**
   * An empty queue is removed rather than written as an empty blob: it frees
   * the space instead of occupying it, which matters most in exactly the
   * quota-pressure case that brought us here.
   */
  async #write(entries: readonly QueuedSend[]): Promise<void> {
    if (entries.length === 0) {
      await this.#storage.remove(this.#key);
      return;
    }

    await this.#storage.set(this.#key, encodeQueue(entries));
  }
}
