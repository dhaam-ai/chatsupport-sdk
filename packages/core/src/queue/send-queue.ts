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
// Only the fallback constant, a plain `true` with no dependency on anything
// else in messages/ — never re-derived locally, so this module and
// `MessageController.onFailed` can never disagree about what an absent
// `retryable` means (D4). `messages/controller.ts`'s only reference back to
// this module is `import type { FailedSend, QueuedSend }`, which
// `verbatimModuleSyntax` erases at build time, so this does not create a
// runtime import cycle.
import { DEFAULT_RETRYABLE_FALLBACK } from '../messages/index.js';
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

/**
 * How {@link SendQueue.retry} resolved.
 *
 * A dedicated result type rather than a thrown error or a bare boolean,
 * because "refused" is a real, expected outcome a caller must be able to
 * branch on without a `try`/`catch` — and because "refused" itself has two
 * reasons a caller needs to tell apart. `'not-retryable'` means the app is
 * (correctly) never going to get anywhere retrying this id; `'not-found'`
 * means there was nothing eligible under this id at all (already retried by
 * a concurrent call, already discarded, or never failed).
 */
export type RetryOutcome =
  | { readonly status: 'retried'; readonly entry: QueuedSend }
  | { readonly status: 'refused'; readonly reason: 'not-found' | 'not-retryable' };

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

  /**
   * Which session this connection is currently JOINED to, read fresh on every
   * drain. Supplying it makes the queue *session-scoped*: only that session's
   * entries are ever put on the wire.
   *
   * This is the second of the two independent guards against a send being
   * filed under the wrong conversation, and it is the one that survives an
   * old server. `MessageSendPayload.sessionId` (protocol/frames.ts) is an
   * OPTIONAL wire field, so a server that predates it ignores the extra key
   * and files the frame under whatever `session.join` last set — which is the
   * exact cross-conversation delivery the field exists to prevent. Not writing
   * the frame at all is the only guard that does not depend on the peer's
   * version. Both are implemented; neither alone is sufficient.
   *
   * Entries for any other session WAIT rather than being failed: they are the
   * customer's own words, typed into a real conversation, and they become
   * deliverable again the moment that session is joined. Destroying them here
   * would be silent data loss dressed up as a safety check. The two explicit
   * ends they can still reach are unchanged — {@link SendQueue.abandonSession}
   * (a session that genuinely ended) and §9.6 retention (they age out and are
   * reported through `onFailed`), so "waiting" is bounded, not forever.
   *
   * `null` means "joined to nothing", and nothing drains. Omitting the option
   * entirely leaves the queue UNSCOPED — every session it holds is pumped,
   * which is the right behavior for an embedder that owns no notion of joining
   * (and is what this module's own unit tests exercise).
   */
  readonly joinedSession?: () => string | null;
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

  /** See {@link SendQueueOptions.joinedSession}. Absent = unscoped. */
  readonly #joinedSession: (() => string | null) | undefined;

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
    this.#joinedSession = options.joinedSession;
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

  /**
   * Fails every undelivered entry for one session and drops it from storage.
   *
   * For the session-replacement transition (a terminal `session.closed`, then
   * `startNewSession()`). It exists because `message.send` carries no
   * `sessionId` on the wire (protocol/frames.ts): the server attributes a
   * frame to whichever session the socket currently holds, so an entry that
   * outlived its session would be delivered into the *next* conversation —
   * the customer's unsent question about a resolved order reappearing, with
   * no context, in a brand-new ticket.
   *
   * Failing rather than deleting is the other half. Each entry goes out
   * through the ordinary `onFailed` channel with reason `'sessionClosed'`, so
   * the binding renders it as a dead message the customer can see and re-send
   * — dropping them silently would be the same data loss in a quieter form.
   *
   * Resolves with the entries it failed, in FIFO order.
   */
  async abandonSession(sessionId: string): Promise<readonly QueuedSend[]> {
    const abandoned = await this.#mutate(async () => {
      const doomed = this.#entries.filter((entry) => entry.sessionId === sessionId);
      if (doomed.length === 0) return doomed;

      this.#entries = this.#entries.filter((entry) => entry.sessionId !== sessionId);
      await this.#persistCurrent();
      return doomed;
    });

    // The session is gone, so its stall record is meaningless — and leaving it
    // would survive into a session that happens to reuse the id.
    this.#stalled.delete(sessionId);
    this.#reportAll(abandoned, 'sessionClosed');
    return abandoned;
  }

  /** Forgets a recorded failure, once the app has surfaced or re-sent it. */
  discardFailed(id: string): void {
    const index = this.#failed.findIndex((failure) => failure.entry.id === id);
    if (index >= 0) this.#failed.splice(index, 1);
  }

  /**
   * Re-queues a permanently-failed send under its ORIGINAL envelope `id`.
   *
   * This is the one correct way to retry (§9.3, D1) — `enqueue()` is
   * deliberately not it. `enqueue()` mints a fresh ULID on every call, so
   * calling it again with the same content puts a *second* id on the wire
   * for what the user experiences as one message: it fails independently,
   * grows its own Retry affordance, and the user is now looking at two dead
   * messages instead of one retried message. That is the widget bug this
   * method exists to make impossible to reintroduce — see the T9 report.
   *
   * Only an entry `onFailed` has already reported — i.e. currently in
   * {@link failed} — is eligible. A send still `'queued'` has not failed and
   * is already draining on its own; an id that was never queued, already
   * succeeded, or was already retried/discarded has nothing here to
   * re-queue, and both read as `'not-found'` — this method does not
   * distinguish "never existed" from "already handled" because neither is
   * something a caller can do anything different about.
   *
   * Refuses with `'not-retryable'` rather than retrying when the failure
   * says retrying is futile — using the exact same test
   * `MessageController.onFailed` uses to decide `delivery.retryable`
   * (`failure.retryable ?? DEFAULT_RETRYABLE_FALLBACK`, D4). Sharing the test
   * is what guarantees this can never refuse a send the app is still
   * rendering a Retry button for, or silently honor a retry the app told the
   * user was pointless.
   *
   * Atomic against a concurrent call for the same `id`: the failure record
   * is claimed — removed from {@link failed} — synchronously inside the same
   * `#mutate` chain every other mutation in this class serializes through
   * (see `#mutate`'s doc), before the durable write is awaited. A second
   * `retry(id)` racing the first is queued behind it on that chain and, by
   * the time it runs, finds nothing left to claim — `'not-found'` — rather
   * than re-queueing the send a second time. No new locking primitive; this
   * reuses the one the class already has.
   *
   * `enqueuedAt` is reset to now rather than carried over from the original
   * enqueue. Keeping the old timestamp would let `#pump`'s retention check
   * (`this.#now() - head.enqueuedAt > maxAgeMs`) immediately re-fail an entry
   * that was already close to `maxAgeMs` when it first failed — turning a
   * user-initiated retry into a second, unexplained failure with no attempt
   * ever reaching the wire. A retry is fresh evidence the user is still here
   * for this message right now, which is exactly what `enqueuedAt` measures
   * (see `SendQueueRetention.maxAgeMs`'s doc) — `attempts` is left as-is,
   * since it is a cumulative diagnostic counter, not an age.
   *
   * Delivery is not awaited, matching `enqueue()`: this resolves once the
   * retry is durably queued, and draining starts in the background.
   */
  async retry(id: string): Promise<RetryOutcome> {
    if (!this.#restored) throw new QueueNotRestoredError();

    const outcome = await this.#mutate(async () => this.#retryLocked(id));
    if (outcome.status === 'retried') void this.#drain();
    return outcome;
  }

  /** The body of `retry()`. Must run only from inside `#mutate` — see there. */
  async #retryLocked(id: string): Promise<RetryOutcome> {
    const index = this.#failed.findIndex((failure) => failure.entry.id === id);
    if (index < 0) return { status: 'refused', reason: 'not-found' };

    const failure = this.#failed[index] as FailedSend;
    const retryable = failure.retryable ?? DEFAULT_RETRYABLE_FALLBACK;
    if (!retryable) return { status: 'refused', reason: 'not-retryable' };

    // Claimed before the durable write is awaited, so a concurrent retry(id)
    // — chained behind this one on `#mutate` — finds nothing left to claim.
    this.#failed.splice(index, 1);

    const candidate: QueuedSend = { ...failure.entry, enqueuedAt: this.#now() };
    const split = applyRetention([...this.#entries, candidate], this.#now(), this.#retention);
    const saved = await this.#persistence.save(split.kept);

    this.#entries = saved.persisted;
    this.#reportAll(split.expired, 'expired');
    this.#reportAll([...split.evicted, ...saved.evicted], 'evicted');

    // Same shed hazard `enqueue()` guards against: retention or quota can
    // drop the very candidate just added. The failure is not gone — put the
    // record back rather than lose the only trace the app has of it, so
    // `failed()` still shows it as dead instead of silently vanishing.
    if (!this.#entries.some((stored) => stored.id === candidate.id)) {
      this.#failed.push(failure);
      throw new StorageQueueError(candidate);
    }

    return { status: 'retried', entry: candidate };
  }

  async #drain(): Promise<void> {
    for (;;) {
      if (!this.#transport.isOpen) return;

      for (const sessionId of this.#drainable()) {
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
   * Which sessions this drain is allowed to put on the wire.
   *
   * Unscoped (no `joinedSession`), that is every session holding an entry —
   * the original behavior. Scoped, it is AT MOST the joined session: pumping
   * any other one hands the server a frame it can only file under the
   * connection's current join. See {@link SendQueueOptions.joinedSession}.
   */
  #drainable(): readonly string[] {
    const queued = new Set(this.#entries.map((entry) => entry.sessionId));
    if (this.#joinedSession === undefined) return [...queued];

    const joined = this.#joinedSession();
    return joined !== null && queued.has(joined) ? [joined] : [];
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
      // The address is stamped HERE, from the entry's own `sessionId` — the
      // session the message was composed in — and never from "the session we
      // are joined to now". Reading it from current state at flush time is
      // precisely the bug: a message typed offline in session B and flushed
      // after a switch to session A would address itself to A.
      //
      // Stamped at write time rather than stored on the payload so that an
      // entry restored from a pre-upgrade storage record is addressed too, and
      // so the two can never drift apart.
      const outcome = await this.#transport.sendWithId(head.id, {
        ...head.payload,
        sessionId: head.sessionId,
      });

      if (outcome.status === 'acked') {
        if (!(await this.#settle(head, { ack: outcome }))) return 'stalled';
        continue;
      }

      if (outcome.status === 'rejected') {
        const settled = await this.#settle(head, {
          reason: 'rejected',
          code: outcome.error.code,
          retryable: outcome.error.retryable,
        });
        if (!settled) return 'stalled';
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
    result:
      | { ack: Extract<AckOutcome, { status: 'acked' }> }
      | { reason: SendFailureReason; code?: string; retryable?: boolean },
  ): Promise<boolean> {
    let wasQueued = false;
    try {
      await this.#mutate(async () => {
        // The filter happens inside the mutation so that the list it removes
        // from is the same one it writes back — a concurrent enqueue can no
        // longer be clobbered by a snapshot taken before it landed.
        const before = this.#entries.length;
        this.#entries = this.#entries.filter((candidate) => candidate.id !== entry.id);
        wasQueued = this.#entries.length !== before;
        await this.#persistCurrent();
      });
    } catch {
      return false;
    }

    // Already settled by someone else while this send sat on the wire — the
    // one caller that can do that is `abandonSession`, which fails a closed
    // session's entries out from under an in-flight pump. Reporting again
    // would emit a second `sendFailed` for one message, or an `ack` for a
    // message the app has already been told is dead.
    if (!wasQueued) return true;

    if ('ack' in result) {
      this.#onAck?.(entry, ackSeq(result.ack));
    } else {
      this.#report({
        entry,
        reason: result.reason,
        // `exactOptionalPropertyTypes` is on, so an absent code/retryable is
        // an absent property rather than one explicitly set to undefined.
        ...(result.code === undefined ? {} : { code: result.code }),
        ...(result.retryable === undefined ? {} : { retryable: result.retryable }),
      });
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
