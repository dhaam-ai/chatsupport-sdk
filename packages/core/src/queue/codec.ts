// Serializing the queue to the one string `StorageAdapter` gives us, and —
// the half that actually matters — reading it back without trusting it.
//
// Persisted bytes are the least trustworthy input in the whole SDK. They
// outlive the code that wrote them: a user reloads into a newer SDK, a
// half-finished `localStorage` write leaves truncated JSON, another tab
// clobbers the key. So decoding is total — it never throws — and it is
// *per entry*: one unreadable record loses that record, not the queue.
// Throwing away nine good pending messages because the tenth is malformed is
// the same silent data loss §9.1 exists to prevent, just with a different
// cause.
//
// Nothing here logs, formats, or echoes `content` (§14).

import type { MessageSendPayload } from '../protocol/index.js';
import type { QueuedSend } from './types.js';

/**
 * Schema version of the persisted blob.
 *
 * Written on every encode and checked on every decode. A blob from an
 * unrecognized version is discarded wholesale rather than guessed at — the
 * one case where per-entry recovery is wrong, because the entry *shape*
 * itself is what we would be guessing about.
 */
export const QUEUE_SCHEMA_VERSION = 1;

/** The persisted envelope. */
interface QueueBlob {
  readonly v: number;
  readonly entries: readonly QueuedSend[];
}

/** What a decode recovered, and what it could not. */
export interface QueueDecodeResult {
  /** Entries that round-tripped intact, in their persisted (FIFO) order. */
  readonly entries: QueuedSend[];

  /**
   * How many records were present but unreadable.
   *
   * Deliberately a count and not the records themselves: a record that failed
   * validation is by definition not a `QueuedSend`, and handing callers a bag
   * of `unknown` invites exactly the untyped poking-at-it this module exists
   * to contain. The count is enough to surface "n sends were lost" — see
   * `SendQueue.restore`.
   */
  readonly dropped: number;
}

const EMPTY: QueueDecodeResult = { entries: [], dropped: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural guard for the frame payload.
 *
 * Deliberately shallow. `protocol/validate.ts` owns frame validation and this
 * module does not duplicate it — the job here is only to be sure we are
 * handing back an object of the right *shape*, so that a corrupt blob cannot
 * produce a `QueuedSend` whose `payload.content` is a number. The real
 * validation happens on the way out, at the transport.
 */
function isSendPayload(value: unknown): value is MessageSendPayload {
  if (!isRecord(value)) return false;
  if (typeof value.content !== 'string') return false;
  if (typeof value.type !== 'string') return false;
  return true;
}

function isQueuedSend(value: unknown): value is QueuedSend {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) return false;
  if (typeof value.enqueuedAt !== 'number' || !Number.isFinite(value.enqueuedAt)) return false;
  if (typeof value.attempts !== 'number' || !Number.isFinite(value.attempts)) return false;
  return isSendPayload(value.payload);
}

/** Serializes the queue for `StorageAdapter.set`. */
export function encodeQueue(entries: readonly QueuedSend[]): string {
  const blob: QueueBlob = { v: QUEUE_SCHEMA_VERSION, entries };
  return JSON.stringify(blob);
}

/**
 * Parses what `StorageAdapter.get` returned. Never throws.
 *
 * `null` — the key is absent — is an empty queue with nothing dropped, which
 * is the ordinary first-run case and not a fault. A read *fault* never reaches
 * here: the adapter rejects, and `SendQueue.restore` lets that rejection
 * propagate rather than mistaking "unknown" for "empty".
 */
export function decodeQueue(raw: string | null): QueueDecodeResult {
  if (raw === null || raw === '') return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], dropped: 0 };
  }

  if (!isRecord(parsed)) return EMPTY;
  if (parsed.v !== QUEUE_SCHEMA_VERSION) return EMPTY;
  if (!Array.isArray(parsed.entries)) return EMPTY;

  const entries: QueuedSend[] = [];
  let dropped = 0;

  for (const candidate of parsed.entries) {
    if (isQueuedSend(candidate)) {
      entries.push(candidate);
    } else {
      dropped += 1;
    }
  }

  return { entries, dropped };
}
