// Test support: a hand-driven `QueueTransport`.
//
// Records every write with the envelope `id` it was given, which is the whole
// point — the assertions that matter in this module are about *which id* went
// out and *how many times*, not about bytes on a socket. Replay identity
// (§9.3) and no-double-send are both id-level claims.

import type { AckFrame, AckExtraData, ErrorPayload } from '../protocol/index.js';
import type { MessageSendPayload } from '../protocol/index.js';
import type { AckOutcome } from '../transport/index.js';
import type { QueueTransport } from './send-queue.js';

/** One write the queue made. */
export interface RecordedSend {
  readonly id: string;
  readonly payload: MessageSendPayload;
}

/** Builds an `acked` outcome carrying the server-assigned `seq` (D2). */
export function acked(seq?: number): AckOutcome {
  const d = (seq === undefined ? { ok: true } : { ok: true, seq }) as AckFrame<AckExtraData>['d'];
  return {
    status: 'acked',
    frame: { v: 1, t: 'ack', id: 'ack-id', ref: 'ref', ts: 1_755_475_200_000, d },
  };
}

/**
 * Builds a `rejected` outcome — the server refused it (§7.4).
 *
 * `retryable` defaults to `false`, matching every call site that predates
 * T9's retry primitive — none of them cared, and flipping the default would
 * silently change what they were asserting. Pass `true` explicitly for a
 * test that needs a genuinely-retryable rejection (e.g. `RATE_LIMITED`).
 */
export function rejected(
  code: ErrorPayload['code'] = 'VALIDATION_FAILED',
  retryable = false,
): AckOutcome {
  return { status: 'rejected', error: { code, message: 'refused', retryable } };
}

export const TIMEOUT: AckOutcome = { status: 'timeout' };
export const DISCONNECTED: AckOutcome = { status: 'disconnected', close: null };

export class FakeQueueTransport implements QueueTransport {
  isOpen = true;

  /** Every write, in order, including replays of the same id. */
  readonly sends: RecordedSend[] = [];

  /** Outcomes handed out in order; the last one repeats once exhausted. */
  #outcomes: AckOutcome[] = [acked()];

  /**
   * Server-side dedup, modelled honestly: ids the "server" has already
   * persisted. A replay of one of these is acked without being stored twice,
   * which is exactly the §9.3 guarantee under test.
   */
  readonly persistedIds = new Set<string>();

  /** Called on every send, so a test can drop the socket mid-flight. */
  onSend: ((send: RecordedSend) => void) | undefined;

  /** Queues the outcomes to return, in order. */
  respondWith(...outcomes: AckOutcome[]): void {
    this.#outcomes = outcomes;
  }

  sendWithId(id: string, payload: MessageSendPayload): Promise<AckOutcome> {
    const send: RecordedSend = { id, payload };
    this.sends.push(send);
    this.onSend?.(send);

    if (!this.isOpen) return Promise.resolve(DISCONNECTED);

    const outcome =
      this.#outcomes.length > 1
        ? (this.#outcomes.shift() as AckOutcome)
        : (this.#outcomes[0] as AckOutcome);

    if (outcome.status === 'acked') this.persistedIds.add(id);
    return Promise.resolve(outcome);
  }
}
