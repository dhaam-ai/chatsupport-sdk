// The pending-ack registry: client frames awaiting their `ack`, keyed by the
// envelope `id` the server echoes back as `ref`.
//
// This module exists to make one bug impossible. A promise that never settles
// because the socket died is a permanent hang — the caller's `await` never
// returns, the offline queue never learns the send failed, and nothing throws
// to say so. So there are exactly three ways an entry leaves this registry,
// and all three settle it:
//
//   settle(id, …)     the server answered — `ack`, or an `error` bearing `ref`
//   the timeout       nothing answered in time
//   settleAll(…)      the socket closed; every survivor settles at once
//
// There is no `delete`, no `clear`, and no path that removes an entry without
// resolving its promise.
//
// **Outcomes resolve; they never reject.** Callers legitimately fire and
// forget (`typing.start` is not worth awaiting), and an unawaited rejected
// promise is an `unhandledrejection` — a fire-and-forget send that crashes the
// host app is a worse failure than the one it reports. Every result is
// therefore a value on the success channel, discriminated by `status`.

import type { AckExtraData, AckFrame } from '../protocol/frames.js';
import type { ErrorPayload } from '../protocol/envelope.js';
import type { CancelTimer, ScheduleTimer } from '../presence/time.js';
import type { TransportCloseInfo } from './close.js';

/** How a client frame's acknowledgment ended. Always resolved, never thrown. */
export type AckOutcome =
  /** The server acknowledged it. `frame.d` carries any extra data — e.g. `seq` for `message.send`. */
  | { readonly status: 'acked'; readonly frame: AckFrame<AckExtraData> }

  /**
   * The server refused it, via an `ack` with `d.ok === false` or an `error`
   * frame carrying this frame's `ref`. Both paths land here, because the real
   * server picks between them by *where* the failure happened — business
   * failures come back as a rejecting ack, protocol failures as an `error` —
   * and a caller tracking in-flight frames must release on either.
   */
  | { readonly status: 'rejected'; readonly error: ErrorPayload }

  /** Nothing arrived within the deadline. The frame may or may not have been applied. */
  | { readonly status: 'timeout' }

  /**
   * The socket closed first. Per §8.4 this is the signal to move the frame
   * into the durable offline queue and replay it — with the identical envelope
   * `id`, so a server that did persist it dedupes the replay (§9.3).
   *
   * `close` is `null` when the frame was never written, because the transport
   * had no open socket to write it to.
   */
  | { readonly status: 'disconnected'; readonly close: TransportCloseInfo | null };

export interface PendingAckRegistryOptions {
  /** Injected — no global `setTimeout` is reachable from this module. */
  readonly schedule: ScheduleTimer;

  /** How long to wait before settling with `timeout`. */
  readonly timeoutMs: number;
}

interface PendingEntry {
  readonly resolve: (outcome: AckOutcome) => void;
  readonly cancelTimeout: CancelTimer;
}

export class PendingAckRegistry {
  readonly #schedule: ScheduleTimer;
  readonly #timeoutMs: number;
  readonly #entries = new Map<string, PendingEntry>();

  constructor(options: PendingAckRegistryOptions) {
    this.#schedule = options.schedule;
    this.#timeoutMs = options.timeoutMs;
  }

  /** How many frames are still awaiting an answer. */
  get size(): number {
    return this.#entries.size;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  /**
   * Starts tracking `id` and returns the promise that settles when it is
   * answered, times out, or the socket closes.
   *
   * Registering an `id` that is already pending cannot happen with ULID keys,
   * but if it did, the displaced entry is settled as `disconnected` rather
   * than dropped — an unanswerable promise must never be left behind, and
   * "treat it as unsent" is the interpretation that loses no data.
   */
  register(id: string): Promise<AckOutcome> {
    const displaced = this.#entries.get(id);
    if (displaced) {
      this.#entries.delete(id);
      displaced.cancelTimeout();
      displaced.resolve({ status: 'disconnected', close: null });
    }

    return new Promise<AckOutcome>((resolve) => {
      // The executor runs synchronously, so the entry is registered before
      // `register` returns and an ack arriving on the very next tick finds it.
      const cancelTimeout = this.#schedule(() => {
        this.#entries.delete(id);
        resolve({ status: 'timeout' });
      }, this.#timeoutMs);

      this.#entries.set(id, { resolve, cancelTimeout });
    });
  }

  /**
   * Settles the frame tracked under `id`.
   *
   * Returns `false` when nothing was tracked — a late ack arriving after its
   * own timeout, or a `ref` this client never sent. Both are worth a log line
   * and neither is worth an exception.
   */
  settle(id: string, outcome: AckOutcome): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;

    this.#entries.delete(id);
    entry.cancelTimeout();
    entry.resolve(outcome);
    return true;
  }

  /**
   * Settles every outstanding frame with the same outcome and empties the
   * registry. Called on every close path, so no promise outlives its socket.
   *
   * Returns how many were settled.
   */
  settleAll(outcome: AckOutcome): number {
    // Snapshot first: `resolve` schedules microtasks rather than running
    // callers synchronously, but a caller re-entering through `settle` during
    // iteration would still mutate the map underneath us.
    const entries = [...this.#entries.values()];
    this.#entries.clear();

    for (const entry of entries) {
      entry.cancelTimeout();
      entry.resolve(outcome);
    }

    return entries.length;
  }
}
