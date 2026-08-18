// Seq tracking and gap detection — D2 (§0.5), §8.3.
//
// D2 makes `seq` — never `ts` — core's ordering key and gap-detection signal:
// "`connection.hello.d.resumeFrom` carries the last applied `seq`;
// `connection.ack` replays missed frames inline", and "a `seq` jump means
// refetch". This module is the whole of that bookkeeping, kept pure so the
// arithmetic is testable without a socket.
//
// The one judgment worth stating plainly: a gap is **reported and then
// stepped over**, not swallowed and not fatal. The anchor advances to the
// highest `seq` the server vouched for, because refusing to advance it would
// make the next reconnect ask to resume from a point the server has already
// moved past and re-replay everything since. Closing the hole is a refetch
// (D2), which is why `ResumeGap` is handed out as structured data rather than
// only logged — the caller can act on it. What must never happen is the hole
// passing unremarked, which is the failure this module exists to prevent.

import type { ServerFrame } from '../protocol/index.js';

/** A missing run of sequence numbers: `expectedSeq .. receivedSeq - 1` never arrived. */
export interface ResumeGapSpan {
  /** The `seq` that should have come next. */
  readonly expectedSeq: number;

  /** The `seq` that actually did, which is strictly greater. */
  readonly receivedSeq: number;
}

/**
 * The `seq` a frame carries, or `null` for the frame types that carry none.
 *
 * Only `message.new` declares a `seq` in its payload
 * (`ServerPushFramePayloadMap`, protocol/frames.ts) — `typing.*`,
 * `presence.update` and friends are not sequenced, so they neither advance the
 * anchor nor can reveal a gap. Written as an explicit check on `t` rather than
 * a structural `'seq' in d` probe: it narrows with no cast, and it will not
 * silently start consuming `connection.ack.d.seq`, which is an anchor rather
 * than a frame's own position.
 */
export function frameSeq(frame: ServerFrame): number | null {
  return frame.t === 'message.new' ? frame.d.seq : null;
}

/**
 * Tracks the last `seq` applied to state and reports the holes.
 *
 * Deliberately has no `reset()`. The anchor is the client's position in a
 * per-session history; it must survive a reconnect — that is the entire point
 * of D2 — and there is no event in §8 after which forgetting it would be
 * correct.
 */
export class ResumeTracker {
  #lastApplied: number | null = null;

  /** The value that goes into `connection.hello.d.resumeFrom`, or `null` on a first connect. */
  get lastAppliedSeq(): number | null {
    return this.#lastApplied;
  }

  /**
   * Records one applied frame's `seq`, live or replayed, returning the gap it
   * revealed.
   *
   * A `seq` at or below the anchor returns `null` and changes nothing: that is
   * a duplicate or an out-of-order delivery, which D1's ULID dedup already
   * resolves structurally. It is not a hole — nothing is missing — so
   * reporting it as one would send the caller refetching over data it already
   * has.
   */
  observe(seq: number): ResumeGapSpan | null {
    const previous = this.#lastApplied;

    // The first sequenced frame of a session has no predecessor to be
    // discontinuous with. History before it is loaded by pagination (§6.3),
    // not by replay.
    if (previous === null) {
      this.#lastApplied = seq;
      return null;
    }

    if (seq <= previous) return null;

    this.#lastApplied = seq;
    return seq > previous + 1 ? { expectedSeq: previous + 1, receivedSeq: seq } : null;
  }

  /**
   * Adopts `connection.ack.d.seq` as the new anchor once replay has been
   * applied, returning the tail the server claimed but never sent.
   *
   * This is the case an implementation that only walks the replay array
   * misses entirely: an ack that says "I am current as of 40" after replaying
   * nothing past 12 has left frames 13-40 unaccounted for, and every one of
   * them is missing history. Replay being *empty* is the same bug in its
   * starkest form.
   *
   * On a first connect (no prior anchor) the ack's `seq` is simply adopted —
   * there is no gap, because the client was never claiming to hold anything
   * earlier.
   */
  settleAck(ackSeq: number): ResumeGapSpan | null {
    const previous = this.#lastApplied;

    if (previous === null) {
      this.#lastApplied = ackSeq;
      return null;
    }

    // The server is not ahead of us. Nothing is missing; do not rewind the
    // anchor to a value behind what has already been applied.
    if (ackSeq <= previous) return null;

    this.#lastApplied = ackSeq;
    return { expectedSeq: previous + 1, receivedSeq: ackSeq };
  }
}
