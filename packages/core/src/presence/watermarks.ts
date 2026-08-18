// Read-state sync — PRD §9.5 (the model), §9.4 (snapshot authority),
// §6.4 (`ChatState.readWatermarks` / `unreadCount`), §12.9 (v1's reality).
//
// The model is a WATERMARK, not per-message receipts: one `lastReadAt` per
// participant, confirmed real in v1 (§12.9 — `GET /sessions/{id}/full`
// returns `participants[]` with `lastReadAt`, and `chat.message.read` pushes
// `{readBy, readAt}`). v2 keeps the model and drops v1's second write path:
// §9.5 requires exactly one write per read action, so `markRead()` produces a
// single `message.markRead` intent and there is no parallel REST call to keep
// in sync by hand.
//
// ---------------------------------------------------------------------------
// Monotonicity — the invariant this file exists to hold
// ---------------------------------------------------------------------------
//
// A watermark may only ever move FORWARD. Every write goes through
// `maxWatermark`, which returns the later of the current and incoming values;
// there is no code path that assigns an incoming timestamp directly. A
// replayed `connection.ack` (D2 replays frames after `resumeFrom`, §7.3), an
// out-of-order `message.read`, or a server snapshot that predates a local
// optimistic `markRead()` therefore cannot move a watermark backwards. The
// bug that guards against is specific and user-visible: a watermark moving
// back resurrects already-read messages as unread, so the badge count jumps
// up on reconnect.
//
// Comparison is on `Date.parse`, never string ordering. protocol/validate.ts
// accepts `±hh:mm` offsets and optional fractional seconds, so two ISO-8601
// strings can order differently as text than as instants:
// `2024-01-01T12:00:00+05:00` is 07:00Z — earlier than `2024-01-01T09:00:00Z`,
// but lexicographically greater. String comparison would silently accept a
// backwards move from any client in a positive-offset timezone.
//
// ---------------------------------------------------------------------------
// Reconciling a server snapshot (§9.4 vs monotonicity)
// ---------------------------------------------------------------------------
//
// These two requirements meet here and the resolution is deliberate:
//
//   §9.4  take the freshest `connection.ack`/`session.updated` snapshot as
//         authoritative and overwrite wholesale — never merge field-by-field
//         against a possibly-stale local copy.
//   §9.5  a watermark must never move backwards.
//
// They govern different things, and `applySessionSnapshot` applies both:
//
//   * The snapshot is wholesale authoritative over WHICH PARTICIPANTS EXIST.
//     The watermark record is rebuilt from the snapshot's `participants[]`,
//     so a participant the snapshot omits is dropped from state entirely.
//     No local entry survives a snapshot that does not mention it.
//   * Each surviving participant's VALUE advances monotonically.
//
// Taking the snapshot's value unconditionally would defeat the invariant
// above in the exact case it was written for: a `connection.ack` replayed on
// reconnect legitimately carries a watermark older than the optimistic
// `markRead()` the server has not processed yet, and honouring it would
// resurrect read messages. §9.4's concern is stale local *session* fields
// (status, mode, assignment) shadowing fresher server state — a per-key
// maximum is not the field-by-field merge it prohibits.

import type {
  MessageReadPayload,
  ParticipantType,
  SessionSnapshot,
} from '../protocol/index.js';
import type { ChatMessage, ChatState, ChatStore } from '../state/index.js';
import type { IntentSink } from './intents.js';

/**
 * The later of two watermarks, comparing instants rather than strings.
 *
 * Returns `current` unchanged on a tie or a backwards move, so callers detect
 * "did anything change" with `!==` and skip the write. An unparseable `next`
 * is rejected in favour of `current` — the safe direction, since the whole
 * point is that a watermark never regresses.
 */
export function maxWatermark(current: string | undefined, next: string): string {
  if (current === undefined) return next;

  const nextMs = Date.parse(next);
  if (Number.isNaN(nextMs)) return current;

  const currentMs = Date.parse(current);
  if (Number.isNaN(currentMs)) return next;

  return nextMs > currentMs ? next : current;
}

/** Shallow value equality, so an unchanged rebuild does not wake every binding. */
function sameWatermarks(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/** Epoch millis, with unparseable input collapsing to `fallback`. */
function toEpoch(iso: string, fallback: number): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallback : ms;
}

export interface WatermarkTrackerOptions {
  readonly store: ChatStore;
  readonly emitIntent: IntentSink;

  /**
   * Whose watermark `markRead()` advances. When omitted it is adopted from the
   * first session snapshot carrying exactly one `CUSTOMER` participant — see
   * `setLocalParticipantId`.
   */
  readonly localParticipantId?: string;
}

export class WatermarkTracker {
  readonly #store: ChatStore;
  readonly #emitIntent: IntentSink;

  #localParticipantId: string | null;
  #localParticipantConfigured: boolean;

  /**
   * participantId → type, rebuilt wholesale from each session snapshot.
   *
   * Needed because §6.4's `readWatermarks` is a flat `Record<participantId,
   * ISO>` with no type information, but §12.9 requires "has an agent read
   * this" to take the max across AGENT participants specifically. The wire
   * `SessionSnapshot.participants[]` is the only carrier of that mapping.
   */
  readonly #participantTypes = new Map<string, ParticipantType>();

  constructor(options: WatermarkTrackerOptions) {
    this.#store = options.store;
    this.#emitIntent = options.emitIntent;
    this.#localParticipantId = options.localParticipantId ?? null;
    this.#localParticipantConfigured = options.localParticipantId !== undefined;
  }

  /** Whose watermark `markRead()` advances, or `null` if not yet known. */
  get localParticipantId(): string | null {
    return this.#localParticipantId;
  }

  /**
   * Sets the local participant explicitly, pinning it against snapshot
   * adoption.
   *
   * `markRead()` has to write to *some* key in `readWatermarks`, and before a
   * session snapshot arrives there is nothing to name. Rather than guess, this
   * is either configured up front or adopted from the snapshot's single
   * `CUSTOMER` participant — this PRD scopes a customer-facing client, so that
   * participant is us. `markRead()` is a documented no-op until one of the two
   * happens.
   */
  setLocalParticipantId(participantId: string | null): void {
    this.#localParticipantId = participantId;
    this.#localParticipantConfigured = participantId !== null;
  }

  // ---------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------

  /**
   * Reconciles against an authoritative server snapshot from `connection.ack`
   * or `session.updated` (§9.4). See the header for how wholesale replacement
   * and monotonicity combine here.
   */
  applySessionSnapshot(snapshot: SessionSnapshot): void {
    this.#participantTypes.clear();
    for (const participant of snapshot.participants) {
      this.#participantTypes.set(participant.participantId, participant.type);
    }

    if (!this.#localParticipantConfigured) {
      const customers = snapshot.participants.filter((participant) => participant.type === 'CUSTOMER');
      // Exactly one, or none — never guess between two.
      this.#localParticipantId = customers.length === 1 ? (customers[0]?.participantId ?? null) : null;
    }

    const current = this.#store.getState().readWatermarks;
    const next: Record<string, string> = {};
    for (const participant of snapshot.participants) {
      if (participant.lastReadAt === undefined) continue;
      next[participant.participantId] = maxWatermark(current[participant.participantId], participant.lastReadAt);
    }

    this.#commit(next);
  }

  /** Applies a `message.read` watermark push (§7.3), monotonically. */
  applyMessageRead(payload: MessageReadPayload): void {
    const current = this.#store.getState().readWatermarks;
    const advanced = maxWatermark(current[payload.participantId], payload.readAt);
    if (advanced === current[payload.participantId]) return;

    this.#commit({ ...current, [payload.participantId]: advanced });
  }

  // ---------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------

  /**
   * Advances the local watermark optimistically and produces exactly one
   * `message.markRead` intent (§9.5).
   *
   * Returns `false` — writing nothing and sending nothing — when the local
   * participant is unknown, when there is nothing to read, or when the
   * watermark is already at or past the target. That last case is what
   * satisfies §9.5's reconnect requirement: after an offline gap of 200
   * messages, ONE call flushes ONE "read up to latest" update covering all of
   * them, and any redundant follow-up call is silent.
   *
   * @param upToMessageId Mark read up to and including this message. Omit for
   *   "up to the latest message known to the client".
   */
  markRead(upToMessageId?: string): boolean {
    const localId = this.#localParticipantId;
    if (localId === null) return false;

    const state = this.#store.getState();
    const target = this.#resolveTarget(state.messages, upToMessageId);
    if (target === null) return false;

    const current = state.readWatermarks[localId];
    const advanced = maxWatermark(current, target);
    if (advanced === current) return false;

    // State first, then the intent: a throwing sink must not leave the
    // watermark unadvanced while the frame is already on its way out.
    this.#commit({ ...state.readWatermarks, [localId]: advanced });
    this.#emitIntent({
      t: 'message.markRead',
      // `exactOptionalPropertyTypes` forbids an explicit `undefined` here —
      // the key must be genuinely absent to mean "up to latest".
      d: upToMessageId === undefined ? {} : { upToMessageId },
    });
    return true;
  }

  // ---------------------------------------------------------------------
  // Derivations
  // ---------------------------------------------------------------------

  /**
   * Recomputes `ChatState.unreadCount` against the current messages.
   *
   * The seam with T10: this module owns the watermarks but not the message
   * list, so whoever applies `message.new` calls this afterwards. Everything
   * this module does itself already recomputes as part of committing.
   */
  recomputeUnreadCount(): void {
    this.#commit(this.#store.getState().readWatermarks);
  }

  /**
   * The max `lastReadAt` across all AGENT participants, or `null` if no agent
   * has read anything.
   *
   * Max rather than any single agent's value, preserving v1's confirmed
   * behaviour for multi-agent sessions (§12.9: "the client taking the *max*
   * `lastReadAt` across all agent participants"). "An agent has read this" is
   * true if *any* agent has, so the furthest-advanced one is the answer.
   */
  getAgentReadWatermark(): string | null {
    let max: string | null = null;

    for (const [participantId, watermark] of Object.entries(this.#store.getState().readWatermarks)) {
      if (this.#participantTypes.get(participantId) !== 'AGENT') continue;
      max = max === null ? watermark : maxWatermark(max, watermark);
    }

    return max;
  }

  /** Whether any agent's watermark covers a message created at `createdAt`. */
  hasAgentRead(createdAt: string): boolean {
    const agentWatermark = this.getAgentReadWatermark();
    if (agentWatermark === null) return false;

    const watermarkMs = Date.parse(agentWatermark);
    const createdMs = Date.parse(createdAt);
    if (Number.isNaN(watermarkMs) || Number.isNaN(createdMs)) return false;

    // Inclusive: the watermark means "read up to and including this instant".
    return watermarkMs >= createdMs;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * The watermark value that marking read should advance to.
   *
   * With an id, that message's `createdAt`. Without one, the MAXIMUM
   * `createdAt` across known messages — not the last array element. The
   * watermark is compared against every message's `createdAt` to derive
   * `unreadCount`, so anchoring to a trailing element that is not the newest
   * (an optimistic send, an out-of-order arrival) would leave a message
   * permanently above the watermark: a badge reading "1 unread" with nothing
   * unread to show. The max is correct under any ordering.
   */
  #resolveTarget(messages: readonly ChatMessage[], upToMessageId: string | undefined): string | null {
    if (upToMessageId !== undefined) {
      const match = messages.find((message) => message.id === upToMessageId);
      return match?.createdAt ?? null;
    }

    let latest: string | null = null;
    for (const message of messages) {
      latest = latest === null ? message.createdAt : maxWatermark(latest, message.createdAt);
    }
    return latest;
  }

  /**
   * A message the local participant sent — never unread to its own author.
   *
   * Identity when we know it; otherwise sender type, since this PRD scopes a
   * customer-facing client (protocol/enums.ts) and the customer is us.
   */
  #isOwnMessage(message: ChatMessage): boolean {
    if (this.#localParticipantId !== null) return message.senderId === this.#localParticipantId;
    return message.senderType === 'CUSTOMER';
  }

  #deriveUnreadCount(messages: readonly ChatMessage[], watermarks: Readonly<Record<string, string>>): number {
    const localId = this.#localParticipantId;
    const watermark = localId === null ? undefined : watermarks[localId];
    const watermarkMs = watermark === undefined ? Number.NEGATIVE_INFINITY : toEpoch(watermark, Number.NEGATIVE_INFINITY);

    let count = 0;
    for (const message of messages) {
      if (this.#isOwnMessage(message)) continue;
      // An unparseable `createdAt` counts as unread: hiding a message is the
      // worse failure of the two.
      if (toEpoch(message.createdAt, Number.POSITIVE_INFINITY) > watermarkMs) count += 1;
    }
    return count;
  }

  /**
   * Writes `nextWatermarks` and the `unreadCount` derived from it, touching
   * only the fields that actually changed.
   *
   * The record is rebuilt on every call, so it is always a new reference and
   * `setState`'s reference check would report a change every time — hence the
   * explicit value comparison. An empty patch is already a `setState` no-op.
   */
  #commit(nextWatermarks: Record<string, string>): void {
    const state = this.#store.getState();

    const watermarksChanged = !sameWatermarks(state.readWatermarks, nextWatermarks);
    const watermarks = watermarksChanged ? nextWatermarks : state.readWatermarks;
    const unreadCount = this.#deriveUnreadCount(state.messages, watermarks);

    const patch: Partial<ChatState> = {};
    if (watermarksChanged) patch.readWatermarks = watermarks;
    if (unreadCount !== state.unreadCount) patch.unreadCount = unreadCount;

    this.#store.setState(patch);
  }
}
