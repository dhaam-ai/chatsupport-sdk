// The durable offline send queue's vocabulary — PRD §9 (durability, ordering,
// dedup, conflict resolution, retention), §8.4 (in-flight sends on disconnect).
//
// Two ideas carry this whole module, and both come straight from D1 (§0.5):
//
//   1. A queued send's `id` is a ULID that IS the message's permanent id. It
//      is minted once, at enqueue, and never changes. Replay after a
//      reconnect writes the same `id`, so a server that already persisted the
//      frame dedupes it structurally rather than storing it twice. There is
//      no optimistic-id-swap path here because there is nothing to swap, and
//      v1's content-matching echo suppressor (§12.9) is not ported.
//
//   2. An entry stays in the durable queue until the server acks it. It is
//      NOT removed when it goes out on the wire. §8.4's "an unacked frame
//      moves into the queue when the transport drops" therefore needs no
//      move — the entry never left. A path that has to remember to put
//      something back is a path that can forget to.

import type { MessageSendPayload } from '../protocol/index.js';
import type { StorageErrorCode } from '../storage/index.js';

/**
 * One user-originated `message.send` awaiting delivery.
 *
 * This is also the durable record of the *optimistic* message (§9.1): a
 * binding that reloads mid-send rebuilds what the user sees from these
 * entries, because everything needed to re-render the bubble is here.
 */
export interface QueuedSend {
  /**
   * The client-generated ULID. Permanent message id under D1 — stable from
   * enqueue through every replay, never reassigned.
   */
  readonly id: string;

  /** FIFO is scoped to this session (§9.2). Cross-session order is undefined. */
  readonly sessionId: string;

  /** The exact frame payload. `attachment` is top-level, never nested (D4). */
  readonly payload: MessageSendPayload;

  /** Epoch millis at enqueue. The age half of the retention bound (§9.6). */
  readonly enqueuedAt: number;

  /** How many times this entry has been written to the wire, replays included. */
  readonly attempts: number;
}

/**
 * Why a queued send will never be retried again.
 *
 * Re-exported from `state/` rather than declared here: `ChatMessage.delivery`
 * and the `sendFailed` event carry the same reasons, and two copies of a
 * four-value union is exactly the drift D4 exists to prevent.
 */
import type { SendFailureReason } from '../state/types.js';
export type { SendFailureReason };

/**
 * A send that has permanently failed.
 *
 * §6.4 has no state representation for this, and that gap is deliberate to
 * leave rather than paper over: `ChatMessage.seq` being absent means "not yet
 * server-confirmed", which describes a *queued* message and a *dead* one
 * identically. Overloading it would make a message that will never arrive
 * indistinguishable from one still on its way.
 *
 * So a failure is surfaced through this module's own channel instead — the
 * `onFailed` callback and the `failed()` accessor — and the missing
 * `ChatState` field is reported upward rather than faked with a field that
 * would mean two different things.
 */
export interface FailedSend {
  readonly entry: QueuedSend;
  readonly reason: SendFailureReason;

  /** Present when `reason` is `'rejected'` — the server's §7.4 code. */
  readonly code?: string;

  /**
   * Whether retrying this exact send is worth attempting — the server's
   * `ErrorPayload.retryable` (§7.4), copied through unchanged. Present only
   * when `reason` is `'rejected'`: every other `SendFailureReason` is this
   * SDK's own local determination (queue retention, a session abandoned
   * before its send reached the wire), with no wire `ErrorPayload` behind it
   * to mirror.
   *
   * Absent does NOT mean "not retryable" — it means "no server signal to
   * trust". `messages/controller.ts`'s `DEFAULT_RETRYABLE_FALLBACK` (`true`)
   * is what fills that gap for rendering, and `SendQueue.retry()` (T9)
   * applies the identical fallback, so a caller can never see a Retry
   * affordance the retry primitive itself would then refuse.
   */
  readonly retryable?: boolean;

  /** Present when the failure originated in storage. */
  readonly storageCode?: StorageErrorCode;
}

/**
 * Bounded age and size before a queued send is surfaced as permanently failed
 * rather than retried forever in silence (§9.6).
 *
 * Open Question 9 leaves the exact numbers undecided and explicitly asks for a
 * documented default rather than a blocked implementation, so these are
 * defaults, not constants — both are overridable per client.
 */
export interface SendQueueRetention {
  /**
   * Maximum age of a queued send. Default {@link DEFAULT_MAX_AGE_MS}.
   *
   * Checked on restore *and* before every delivery attempt, so an entry that
   * aged out while the tab was closed fails at restore rather than being
   * delivered a week late to a conversation that has moved on.
   */
  readonly maxAgeMs?: number;

  /**
   * Maximum entries retained across all sessions. Default
   * {@link DEFAULT_MAX_ENTRIES}. Oldest are evicted first.
   */
  readonly maxEntries?: number;
}

/**
 * 24 hours.
 *
 * Rationale, since Open Question 9 asks for a documented number rather than a
 * blocked task: a support message that lands within a day of being written is
 * still recognizably a reply to its own conversation. Past that the user has
 * usually reloaded, given up, or re-asked, and silently delivering it re-opens
 * a thread they consider closed — a worse outcome than being told it failed. A
 * day also covers the overnight-laptop-closed case, which is the common one.
 */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 200 entries.
 *
 * Sized against the storage floor rather than a guess: `localStorage` gives
 * roughly 5 MB per origin, and 200 text sends is a small fraction of that
 * while still being far more than a human types into a support chat during a
 * plausible offline stretch. Being bounded is the point — the exact number is
 * a tuning knob (Open Question 9), which is why it is an option.
 */
export const DEFAULT_MAX_ENTRIES = 200;

/** Default `StorageAdapter` key holding the serialized queue. */
export const DEFAULT_STORAGE_KEY = 'sendQueue';
