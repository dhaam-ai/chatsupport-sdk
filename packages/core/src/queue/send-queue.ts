// Offline send queue — task T10. PRD §9.1 (durability), §9.2 (FIFO),
// §9.3 (ULID dedup), §9.6 (retention).
//
// Deliberately narrow scope: this class persists and replays queued
// client-originated frames — nothing more. It does NOT track which items
// are "in flight" vs "acked", and `flush()` does not remove anything from
// the queue itself. The caller (T11 messages, later T13) is responsible for
// calling `dequeueAcked(id)` once a real ack for that id arrives; if the
// connection drops again mid-flush, whatever wasn't acked simply stays
// queued for the next flush. This is deliberately safe rather than clever:
// §9.3 already guarantees replaying an un-acked (or even already-persisted)
// frame is harmless, because the server dedupes by the same ULID that IS
// the frame's permanent id (D1) — so there is no need for this class to
// track a separate "in-flight" substate just to avoid a double-send that
// the protocol already makes safe by construction.
//
// FIFO is satisfied trivially: one array, in enqueue order, never reordered.
// "Per session" (§9.2) falls out for free — a session's items are simply
// the subsequence of this global FIFO order belonging to that session;
// nothing about them is ever reordered relative to each other.

import type { ClientFrame } from '../protocol/index.js';
import type { StorageAdapter } from '../storage/index.js';

export interface QueuedSend {
  /** The frame's own envelope `id` — the ULID dedup/idempotency key (D1, §9.3). */
  id: string;
  frame: ClientFrame;
  /** Epoch-ms when this item was enqueued — the retention clock (§9.6). */
  enqueuedAt: number;
}

export interface SendQueueOptions {
  storage: StorageAdapter;
  /** Distinguishes this queue's persisted data from anything else sharing `storage`. */
  namespace: string;
  /** Items older than this are dropped on the next prune. Default 24h (§9.6 — a tuning default, not an architectural line). */
  maxAgeMs?: number;
  /** Queue drops its OLDEST item(s) once over this size, making room for new sends rather than refusing them. Default 200. */
  maxSize?: number;
  /** Called once per item actually dropped by retention (age or size) — the caller's hook for surfacing "this send permanently failed" to the app. */
  onExpired?: (item: QueuedSend) => void;
}

const STORAGE_KEY = 'sendQueue';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SIZE = 200;

export class SendQueue {
  readonly #storage: StorageAdapter;
  readonly #key: string;
  readonly #maxAgeMs: number;
  readonly #maxSize: number;
  readonly #onExpired: ((item: QueuedSend) => void) | undefined;

  constructor(options: SendQueueOptions) {
    this.#storage = options.storage;
    this.#key = `${options.namespace}:${STORAGE_KEY}`;
    this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.#maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.#onExpired = options.onExpired;
  }

  /** Appends `frame` to the end of the queue and persists it, then applies retention. */
  async enqueue(frame: ClientFrame): Promise<void> {
    const items = await this.#read();
    items.push({ id: frame.id, frame, enqueuedAt: Date.now() });
    await this.#write(this.#applyRetention(items));
  }

  /** Removes the item with envelope id `id`, if present. A no-op if it's already gone (e.g. a duplicate ack). */
  async dequeueAcked(id: string): Promise<void> {
    const items = await this.#read();
    const next = items.filter((item) => item.id !== id);
    if (next.length !== items.length) await this.#write(next);
  }

  /**
   * Calls `send` once per queued item, in FIFO order. Does not remove
   * anything — see this file's header for why. Stops early (without
   * throwing) if `send` throws, so a mid-flush failure (e.g. the
   * connection just dropped again) doesn't lose track of the remaining
   * items — they simply stay queued for the next flush.
   */
  async flush(send: (frame: ClientFrame) => void): Promise<void> {
    const items = await this.#read();
    for (const item of items) {
      try {
        send(item.frame);
      } catch {
        return;
      }
    }
  }

  /** Drops items past `maxAgeMs`/`maxSize`, firing `onExpired` for each. Returns what was dropped. Also runs automatically on every `enqueue`. */
  async prune(now: number = Date.now()): Promise<QueuedSend[]> {
    const items = await this.#read();
    const kept = this.#applyRetention(items, now);
    const dropped = items.filter((item) => !kept.includes(item));
    if (dropped.length > 0) await this.#write(kept);
    return dropped;
  }

  /** All currently queued items, in FIFO order. Does not mutate anything. */
  async peekAll(): Promise<QueuedSend[]> {
    return this.#read();
  }

  /** Empties the queue. Does not fire `onExpired` — this is an explicit reset, not retention dropping items. */
  async clear(): Promise<void> {
    await this.#write([]);
  }

  #applyRetention(items: QueuedSend[], now: number = Date.now()): QueuedSend[] {
    const notExpired = items.filter((item) => {
      const expired = now - item.enqueuedAt > this.#maxAgeMs;
      if (expired) this.#onExpired?.(item);
      return !expired;
    });

    if (notExpired.length <= this.#maxSize) return notExpired;

    const overflowCount = notExpired.length - this.#maxSize;
    for (const dropped of notExpired.slice(0, overflowCount)) {
      this.#onExpired?.(dropped);
    }
    return notExpired.slice(overflowCount);
  }

  async #read(): Promise<QueuedSend[]> {
    let raw: string | null;
    try {
      raw = await this.#storage.get(this.#key);
    } catch {
      return []; // a read failure means "unknown" per StorageAdapter's contract — treat as empty rather than throw
    }
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedSend[]) : [];
    } catch {
      return []; // corrupted/foreign data under our key — degrade to empty rather than throw
    }
  }

  async #write(items: QueuedSend[]): Promise<void> {
    // Per StorageAdapter's failure contract, a rejected set() means the
    // write did not happen — surfaced to the caller rather than swallowed,
    // since silently losing a queued send is exactly the bug this class
    // exists to prevent.
    await this.#storage.set(this.#key, JSON.stringify(items));
  }
}
