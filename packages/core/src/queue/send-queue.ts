// The durable offline send queue — PRD §9.1-§9.4, §9.6, §8.4.
//
// Every user send goes through here, online or offline. That is the design
// decision the rest of the module falls out of, and it is what makes §8.4's
// "the queue flushes in FIFO order *before* any new user-initiated send" true
// by construction rather than by a gate someone has to remember to check: new
// sends append to the tail, delivery drains from the head, so a fresh send
// cannot overtake a queued one because there is no path by which it could.
//
// Three invariants, each chosen so that violating it requires deleting code
// rather than forgetting to write some:
//
//   An entry leaves the queue only when the server acks it or it permanently
//   fails. Not when it is written to the wire. §8.4's "an unacked frame moves
//   into the queue when the transport drops" therefore needs no move at all —
//   the entry never left, so there is no code path that could drop it.
//
//   One in-flight send per session. FIFO (§9.2) is a claim about arrival
//   order, and two concurrent sends can arrive in either order regardless of
//   which was written first. Sessions are independent of one another, which is
//   exactly what "cross-session ordering is undefined" licenses.
//
//   A send is reported queued only after `save()` resolved AND the entry is in
//   what it persisted. `StorageAdapter`'s contract makes the first half
//   meaningful; the quota shed path makes the second half necessary.
//
// Dedup is structural (§9.3, D1): the envelope `id` is the permanent message
// id, minted once at enqueue, replayed byte-identical. A server that persisted
// the frame just before the socket dropped dedupes the replay on that `id`.
// There is no optimistic-id swap and no content-matching echo suppressor —
// both of v1's mechanisms (§12.9) are deleted, not ported.
//
// No message content is logged, formatted into an error, or otherwise echoed
// anywhere in this module (§14).

import { type Clock, systemClock } from '../presence/time.js';
import type { AckOutcome } from '../transport/index.js';
import { createUlidGenerator, type UlidGenerator } from '../transport/index.js';
import type { StorageAdapter } from '../storage/index.js';
import type { MessageSendPayload } from '../protocol/index.js';
import { QueuePersistence } from './persistence.js';
import { type ResolvedRetention, applyRetention, resolveRetention } from './retention.js';
import {
  DEFAULT_STORAGE_KEY,
  type FailedSend,
  type QueuedSend,
  type SendFailureReason,
  type SendQueueRetention,
} from './types.js';

/**
 * The slice of the transport this queue drives.
 *
 * Deliberately NOT `WebSocketTransport`'s `send(t, d)`, and the difference is
 * load-bearing. That method mints its own ULID per call, so replaying through
 * it would put a *fresh* id on a frame the server may already hold under the
 * old one — defeating the dedup in §9.3 and double-sending precisely the
 * message §8.4 exists to protect. Since a third optional parameter would make
 * `send` structurally assignable here, this seam uses a different method name
 * so that wiring the raw transport in is a compile error rather than a
 * silently-duplicating runtime bug. See the T10 report.
 */
export interface QueueTransport {
  /** Whether a frame written now would reach the wire. */
  readonly isOpen: boolean;

  /**
   * Writes one `message.send` under a caller-supplied envelope `id`.
   *
   * Resolves — never rejects — with the ack outcome, matching
   * `PendingAckRegistry`'s contract: `disconnected` is an outcome, not an
   * error.
   */
  sendWithId(id: string, payload: MessageSendPayload): Promise<AckOutcome>;
}

/** What a `restore()` recovered, and what it could not. */
export interface RestoreReport {
  /** Entries recovered and still eligible for delivery. */
  readonly restored: number;

  /**
   * Persisted records that could not be read back. Reported as a count
   * because a record that failed validation is by definition not a
   * `QueuedSend` and cannot be handed back as one — but the user did lose
   * that many messages, so the number is not swallowed.
   */
  readonly dropped: number;

  /** Entries that aged out while nothing was running. Also passed to `onFailed`. */
  readonly expired: number;
}

export interface SendQueueOptions {
  /** Where the queue is persisted (§9.1). */
  readonly storage: StorageAdapter;

  /** How frames reach the wire. */
  readonly transport: QueueTransport;

  /**
   * Called once per permanently-failed send.
   *
   * This is the *only* notification channel for a dead send, by design. The
   * queue takes no `ChatStore`: `messages`/`messageAck` are T11's to emit, and
   * a second module emitting them would double-fire every event. T13 wires
   * this callback to whichever §6.5 event is right.
   */
  readonly onFailed?: (failure: FailedSend) => void;

  /** Called once per server-confirmed send, with the `seq` the server assigned (D2). */
  readonly onAck?: (entry: QueuedSend, seq: number | undefined) => void;

  /** Injected. Defaults to `Date.now`. No global clock is reachable from here. */
  readonly now?: Clock;

  /** Mints entry ids. Defaults to a real ULID generator (D1). */
  readonly nextId?: UlidGenerator;

  /** Defaults to {@link DEFAULT_STORAGE_KEY}. */
  readonly storageKey?: string;

  /** §9.6 bounds. Both have documented defaults. */
  readonly retention?: SendQueueRetention;
}

/** Whether a session's pump ran out of work, or stopped because the peer did. */
type PumpResult = 'drained' | 'stalled';

/** Thrown when `enqueue` is called before the persisted queue has been read. */
export class QueueNotRestoredError extends Error {
  constructor() {
    super('SendQueue.restore() must be awaited before enqueueing');
    this.name = 'QueueNotRestoredError';
  }
}

export class SendQueue {
  readonly #persistence: QueuePersistence;
  readonly #transport: QueueTransport;
  readonly #now: Clock;
  readonly #nextId: UlidGenerator;
  readonly #retention: ResolvedRetention;
  readonly #onFailed: ((failure: FailedSend) => void) | undefined;
  readonly #onAck: ((entry: QueuedSend, seq: number | undefined) => void) | undefined;

  /**
   * Every undelivered entry, in global insertion order across all sessions.
   *
   * One flat list rather than a map of per-session lists: per-session FIFO is
   * a filter over this, and keeping one order means retention eviction has an
   * unambiguous "oldest" without reconciling N independent orderings.
   */
  #entries: QueuedSend[] = [];

  readonly #failed: FailedSend[] = [];

  /** Sessions with a send currently on the wire — the depth-1 pipeline. */
  readonly #pumps = new Map<string, Promise<void>>();

  /**
   * Sessions whose peer stopped answering.
   *
   * Instance-level rather than per-drain so that a background drain and an
   * explicit `flush()` racing cannot each hold their own idea of what has
   * already stalled. Without it, a `timeout` returns from the pump only for
   * the drain loop to restart it immediately, turning the documented "stop
   * rather than spin" into an unbounded retry. `flush()` clears it.
   */
  readonly #stalled = new Set<string>();

  /**
   * Serializes every read-modify-write of `#entries`.
   *
   * Each mutation reads the list, awaits a durable write, then assigns the
   * result — and interleaving two of those loses data in both directions: an
   * enqueue that snapshotted before a delivery completed puts the delivered
   * message back, and a delivery that snapshotted before an enqueue drops the
   * new one. Both are silent. Chaining is the cheap fix, and storage writes
   * are not on any hot path.
   */
  #chain: Promise<unknown> = Promise.resolve();

  #restored = false;

  constructor(options: SendQueueOptions) {
    this.#persistence = new QueuePersistence(
      options.storage,
      options.storageKey ?? DEFAULT_STORAGE_KEY,
    );
    this.#transport = options.transport;
    this.#now = options.now ?? systemClock;
    this.#nextId = options.nextId ?? createUlidGenerator();
    this.#retention = resolveRetention(options.retention);
    this.#onFailed = options.onFailed;
    this.#onAck = options.onAck;
  }

  /**
   * Reads the persisted queue back into memory (§9.1).
   *
   * Must be awaited before `enqueue`, and the reason is ordering rather than
   * bookkeeping: appending to a queue whose stored contents have not been read
   * yet would place the new send *ahead* of older pending ones, breaking the
   * FIFO guarantee §9.2 makes. So it is an explicit error rather than a
   * convenience auto-load.
   *
   * A storage read fault propagates. It is emphatically not treated as an
   * empty queue — that would silently discard every message the user believes
   * they already sent, which is the exact failure `StorageAdapter`'s contract
   * is written to prevent.
   */
  async restore(): Promise<RestoreReport> {
    return this.#mutate(async () => {
      const { entries, dropped } = await this.#persistence.load();
      const split = applyRetention(entries, this.#now(), this.#retention);

      this.#entries = split.kept;

      // Aged-out entries are removed from storage before they are reported, so
      // a crash between the two cannot resurrect a message already called dead.
      if (split.expired.length > 0 || split.evicted.length > 0) {
        await this.#persistCurrent();
        this.#reportAll(split.expired, 'expired');
        this.#reportAll(split.evicted, 'evicted');
      }

      this.#restored = true;
      return { restored: this.#entries.length, dropped, expired: split.expired.length };
    });
  }

  /**
   * Durably queues one send and returns its entry.
   *
   * Resolves only once the write has landed — the returned entry's `id` is the
   * message's permanent id from this moment (D1). Rejects if the send was not
   * persisted, whether the adapter refused the write outright or the entry was
   * shed to fit under quota. A rejection means the send is not queued and the
   * caller must not show it as sent.
   *
   * Delivery is deliberately not awaited: the promise answers "is it safe?",
   * not "has it arrived". Draining starts in the background.
   */
  async enqueue(sessionId: string, payload: MessageSendPayload): Promise<QueuedSend> {
    if (!this.#restored) throw new QueueNotRestoredError();

    const entry = await this.#mutate(async () => {
      // Built inside the mutation, so `enqueuedAt` and the list it is appended
      // to are read at the same moment rather than either side of an await.
      const candidate: QueuedSend = {
        id: this.#nextId(),
        sessionId,
        payload,
        enqueuedAt: this.#now(),
        attempts: 0,
      };

      const split = applyRetention([...this.#entries, candidate], this.#now(), this.#retention);
      const outcome = await this.#persistence.save(split.kept);

      this.#entries = outcome.persisted;
      this.#reportAll(split.expired, 'expired');
      this.#reportAll([...split.evicted, ...outcome.evicted], 'evicted');

      // Both shed paths converge here. Whether retention or quota dropped it,
      // the new send is not in storage, so reporting it as queued would be the
      // lie this check exists to prevent.
      if (!this.#entries.some((stored) => stored.id === candidate.id)) {
        throw new StorageQueueError(candidate);
      }

      return candidate;
    });

    void this.#drain();
    return entry;
  }

  /**
   * Drains the queue, FIFO per session, and resolves when it settles.
   *
   * Call this on reconnect. It is safe to call at any time and safe to call
   * concurrently — a session already draining is not started twice.
   */
  async flush(): Promise<void> {
    // Clearing the stall set IS the meaning of this call: the caller is saying
    // the connection is back, so a session that stopped because the peer went
    // quiet is worth trying again. A background drain started by `enqueue`
    // deliberately does not clear it — nothing has changed about the peer just
    // because the user typed another message.
    this.#stalled.clear();
    await this.#drain();
  }

  /** Undelivered entries in FIFO order, optionally for one session. */
  pending(sessionId?: string): readonly QueuedSend[] {
    if (sessionId === undefined) return [...this.#entries];
    return this.#entries.filter((entry) => entry.sessionId === sessionId);
  }

  /**
   * Sends that were queued and later died.
   *
   * Only ever entries that made it into storage: a send `enqueue` rejected was
   * never queued, and its rejection is its report. One fact, one channel.
   */
  failed(): readonly FailedSend[] {
    return [...this.#failed];
  }

  /** Forgets a recorded failure, once the app has surfaced or re-sent it. */
  discardFailed(id: string): void {
    const index = this.#failed.findIndex((failure) => failure.entry.id === id);
    if (index >= 0) this.#failed.splice(index, 1);
  }

  async #drain(): Promise<void> {
    for (;;) {
      if (!this.#transport.isOpen) return;

      for (const sessionId of new Set(this.#entries.map((entry) => entry.sessionId))) {
        if (this.#pumps.has(sessionId) || this.#stalled.has(sessionId)) continue;

        const pump = this.#pump(sessionId)
          // The pump settles every entry it touches, so a throw here is a bug
          // rather than a delivery failure. Contain it: `enqueue` starts a
          // drain it does not await, and an unhandled rejection there would
          // surface as a crash in the host app rather than as a failed send.
          .catch(() => 'stalled' as const)
          .then((result) => {
            if (result === 'stalled') this.#stalled.add(sessionId);
          })
          .finally(() => this.#pumps.delete(sessionId));

        this.#pumps.set(sessionId, pump);
      }

      if (this.#pumps.size === 0) return;
      await Promise.all([...this.#pumps.values()]);
    }
  }

  /**
   * Delivers one session's entries head-first, one at a time.
   *
   * Stops — rather than spins — on `timeout` and `disconnected`. Both mean the
   * peer is not answering, and the queue is a passive participant: the
   * connection controller owns reconnection, and its `flush()` on reconnect is
   * what resumes this. Hammering an unresponsive server from here would be
   * driving the connection, which is not this module's job.
   */
  async #pump(sessionId: string): Promise<PumpResult> {
    while (this.#transport.isOpen) {
      const head = this.#entries.find((entry) => entry.sessionId === sessionId);
      if (head === undefined) return 'drained';

      if (this.#now() - head.enqueuedAt > this.#retention.maxAgeMs) {
        if (!(await this.#settle(head, { reason: 'expired' }))) return 'stalled';
        continue;
      }

      this.#bumpAttempts(head);
      const outcome = await this.#transport.sendWithId(head.id, head.payload);

      if (outcome.status === 'acked') {
        if (!(await this.#settle(head, { ack: outcome }))) return 'stalled';
        continue;
      }

      if (outcome.status === 'rejected') {
        if (!(await this.#settle(head, { reason: 'rejected', code: outcome.error.code }))) {
          return 'stalled';
        }
        continue;
      }

      // `timeout` or `disconnected`: the entry stays queued, unchanged, with
      // its original id. Replay after reconnect is byte-identical, so a server
      // that did persist it dedupes rather than storing a second copy (§9.3).
      return 'stalled';
    }

    return 'stalled';
  }

  /**
   * Removes a settled entry and persists the shorter queue, then reports it.
   *
   * Returns whether the pump should continue. A failed write stops the pump
   * but loses nothing: the entry is still in storage under the same id, so the
   * next flush replays it and the server dedupes. That is the one case where
   * a swallowed write error is safe, and it is safe *because* of D1.
   */
  async #settle(
    entry: QueuedSend,
    result: { ack: Extract<AckOutcome, { status: 'acked' }> } | { reason: SendFailureReason; code?: string },
  ): Promise<boolean> {
    try {
      await this.#mutate(async () => {
        // The filter happens inside the mutation so that the list it removes
        // from is the same one it writes back — a concurrent enqueue can no
        // longer be clobbered by a snapshot taken before it landed.
        this.#entries = this.#entries.filter((candidate) => candidate.id !== entry.id);
        await this.#persistCurrent();
      });
    } catch {
      return false;
    }

    if ('ack' in result) {
      this.#onAck?.(entry, ackSeq(result.ack));
    } else if (result.code === undefined) {
      // `exactOptionalPropertyTypes` is on, so an absent code is an absent
      // property rather than one explicitly set to undefined.
      this.#report({ entry, reason: result.reason });
    } else {
      this.#report({ entry, reason: result.reason, code: result.code });
    }

    return true;
  }

  /**
   * Writes the current in-memory queue, absorbing any entries quota sheds.
   *
   * Always called from inside a `#mutate`, which is what makes reading
   * `#entries` here safe.
   */
  async #persistCurrent(): Promise<void> {
    const outcome = await this.#persistence.save(this.#entries);
    this.#entries = outcome.persisted;
    this.#reportAll(outcome.evicted, 'evicted');
  }

  /**
   * `attempts` is tracked in memory and persisted opportunistically, on the
   * next write the queue makes for its own reasons. A durable write per
   * attempt would double the storage traffic to record a diagnostic counter
   * nothing branches on.
   */
  #bumpAttempts(entry: QueuedSend): void {
    const index = this.#entries.indexOf(entry);
    if (index >= 0) this.#entries[index] = { ...entry, attempts: entry.attempts + 1 };
  }

  #reportAll(entries: readonly QueuedSend[], reason: SendFailureReason): void {
    for (const entry of entries) this.#report({ entry, reason });
  }

  #report(failure: FailedSend): void {
    this.#failed.push(failure);
    this.#onFailed?.(failure);
  }

  /**
   * Runs `operation` after every previously-queued mutation has settled.
   *
   * Serializing is what lets each mutation read `#entries`, await a durable
   * write, and assign the result without another mutation interleaving. A
   * failed operation does not poison the chain — the next one still runs.
   */
  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(operation, operation);
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Raised when a send could not be durably queued. Carries no message content (§14). */
export class StorageQueueError extends Error {
  readonly entryId: string;
  readonly sessionId: string;

  constructor(entry: QueuedSend) {
    super(`send ${entry.id} could not be durably queued`);
    this.name = 'StorageQueueError';
    this.entryId = entry.id;
    this.sessionId = entry.sessionId;
  }
}

/** Narrows `message.send`'s ack extra data to its `seq` (D2), defensively. */
function ackSeq(outcome: Extract<AckOutcome, { status: 'acked' }>): number | undefined {
  const data: unknown = outcome.frame.d;
  if (typeof data !== 'object' || data === null) return undefined;
  const seq = (data as { seq?: unknown }).seq;
  return typeof seq === 'number' ? seq : undefined;
}
