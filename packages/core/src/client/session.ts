// SessionSnapshot -> ChatSession — the mapping the T8 report flagged as
// nobody's job yet: "`connected`'s payload is `{ session: ChatSession }` —
// non-null — but `ChatState.session` is populated by whichever module maps
// the wire `SessionSnapshot` into the binding-facing `ChatSession` ... Until
// that module is wired in the field is `null`, and this emits nothing".
//
// Pure functions only — no store, no I/O — so every rule below is testable
// by direct assertion, and create-chat-client.ts's frame dispatcher is the
// only caller.
//
// ── The information gap this module works around ──
//
// protocol/domain.ts's wire `SessionSnapshot` carries `sessionId`, `status`,
// `mode`, `createdAt`, `ticketId?`, and `participants: ParticipantSnapshot[]`
// (`participantId` + `type` + `lastReadAt?` — no name, no email, no avatar).
// state/types.ts's binding-facing `ChatSession` is field-for-field the REST
// `ChatSession` schema instead, which — per openapi/chat-api.yaml's `Profile`
// schema — requires `displayName`/`email`/`avatarUrl` per participant and a
// `closedAt` the wire snapshot never carries at all.
//
// So mapping the lean WS snapshot onto the rich REST-shaped type is
// necessarily best-effort. This module is deliberately honest about the gap
// rather than inventing data to fill it:
//
//   - `assignedAgent`/`customer` existence (is there one, and which
//     participant) IS structurally present in `participants[]` and is
//     wholesale-authoritative every time (§9.4) — a participant the snapshot
//     omits is gone, full stop.
//   - `displayName` IS on the wire now (`ParticipantSnapshot.displayName`,
//     domain.ts's v2 addition) but only when the server has actually
//     resolved one — absent, never `null`/`""`, for a CUSTOMER row today.
//     `email`/`avatarUrl` are still NOT on the wire snapshot at all. Rather
//     than fabricate a name when the wire has none, the participant's own id
//     is used as a legible-but-honest placeholder (it IS real data, just not
//     a friendly one) until something that actually carries a name arrives —
//     a resolved `displayName` on a later snapshot, `agent.joined`'s
//     `displayName` (`applyAgentJoined` below), or a REST `SessionActions`
//     call, which returns the full REST `ChatSession` and needs no
//     placeholder at all.
//   - `closedAt` has no wire carrier on `SessionSnapshot` at any point — only
//     `session.closed` (`SessionClosedPayload`) exists to mark the moment,
//     and even then only as the *client's local receipt time*, not a
//     server-authoritative timestamp. See `applySessionClosed`.
//   - a ticket's `url` is absent from `SessionSnapshot` (only `ticketId` is
//     there); `ticket.linked`'s `ticketUrl` is the one frame that actually
//     carries it. See `applyTicketLinked`.
//
// Carrying forward `previous`'s enrichment (an agent's known name, a
// ticket's known url, a session's known closedAt) across a *new* snapshot
// for the *same* entity id is not the field-by-field merge §9.4 forbids —
// §9.4's concern is a stale local value shadowing a fresher server one, and
// the snapshot never claims to know these facts in the first place. This is
// the same reasoning watermarks.ts uses to reconcile §9.4 (wholesale
// replace) against §9.5 (monotonic advance): "a per-key maximum is not the
// field-by-field merge it prohibits."

// AgentEventPayload = HandledBy (protocol/domain.ts) as of the v2 wire
// contract — `payload.id`/`payload.kind`/`payload.displayName` below, not
// the old `agentId`/`agentName?`. See the T7 report.
import type {
  AgentEventPayload,
  ParticipantSnapshot,
  ParticipantType,
  SessionSnapshot,
  TicketLinkedPayload,
} from '../protocol/index.js';
import type { ChatParticipantProfile, ChatSession } from '../state/index.js';

function findParticipant(
  participants: readonly ParticipantSnapshot[],
  type: ParticipantType,
): ParticipantSnapshot | null {
  return participants.find((participant) => participant.type === type) ?? null;
}

/**
 * A profile for `participant`.
 *
 * Priority, highest first:
 *   1. `participant.displayName` — the wire snapshot's own, freshest
 *      resolution (domain.ts's v2 addition). Wins over `known` on purpose:
 *      §9.4 treats a new snapshot as wholesale-authoritative, and a
 *      resolved wire name is a fresher fact than anything carried forward.
 *   2. `known`'s enrichment (display name, email, avatar), reused when it is
 *      the *same* participant id — see the module header on why that is not
 *      a §9.4 violation.
 *   3. The participant's own id as the display name: honest, not invented.
 *      **Never the raw id silently disguised as a name outside this last
 *      resort** — this used to be unconditional, which rendered a raw
 *      participant UUID as the name of the person the customer was talking
 *      to; see the T7 report.
 */
function bestEffortProfile(
  participant: ParticipantSnapshot,
  known: ChatParticipantProfile | null,
): ChatParticipantProfile {
  if (participant.displayName !== undefined) {
    return {
      participantId: participant.participantId,
      displayName: participant.displayName,
      email: null,
      avatarUrl: null,
    };
  }
  if (known !== null && known.participantId === participant.participantId) return known;
  return {
    participantId: participant.participantId,
    displayName: participant.participantId,
    email: null,
    avatarUrl: null,
  };
}

/**
 * Maps `connection.ack.d.session` / `session.updated.d.session` onto
 * `ChatState.session` (§6.4). See the module header for the full reasoning.
 *
 * `previous` is the session already in state, used only to decide (a)
 * whether this snapshot describes the same session (by id) and, if so, (b)
 * to carry forward the handful of facts the wire snapshot cannot carry at
 * all. Every field the snapshot DOES carry replaces `previous` outright.
 */
export function sessionSnapshotToChatSession(
  snapshot: SessionSnapshot,
  previous: ChatSession | null,
): ChatSession {
  const sameSession = previous !== null && previous.id === snapshot.sessionId;

  const agent = findParticipant(snapshot.participants, 'AGENT');
  const customer = findParticipant(snapshot.participants, 'CUSTOMER');

  return {
    id: snapshot.sessionId,
    status: snapshot.status,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
    closedAt: sameSession ? previous.closedAt : null,
    assignedAgent:
      agent === null ? null : bestEffortProfile(agent, sameSession ? previous.assignedAgent : null),
    customer: customer === null ? null : bestEffortProfile(customer, sameSession ? previous.customer : null),
    ticket:
      snapshot.ticketId === undefined
        ? null
        : {
            id: snapshot.ticketId,
            url: sameSession && previous.ticket?.id === snapshot.ticketId ? previous.ticket.url : null,
          },
    // Wholesale replace, deliberately NOT carried forward from `previous`
    // the way assignedAgent/customer are: unlike ParticipantSnapshot's
    // displayName, HandledBy.displayName is required, never absent, when
    // the wire sends one at all — so there is no "resolved name missing,
    // fall back to what we already knew" gap to bridge here. §9.4 makes a
    // new snapshot wholesale-authoritative, and an absent `handledBy` on a
    // FRESH snapshot must read as absent, not as "still handled by whoever
    // it was last time" — see ChatSession.handledBy's doc for why that
    // absence is not itself a status signal either way.
    ...(snapshot.handledBy === undefined ? {} : { handledBy: snapshot.handledBy }),
  };
}

/** True exactly when this is the §6.5 `statusChange` trigger — an actual change, not the first-ever value. */
export function statusOrModeChanged(previous: ChatSession | null, next: ChatSession): boolean {
  return previous !== null && (previous.status !== next.status || previous.mode !== next.mode);
}

/**
 * Applies `agent.joined` to `assignedAgent` and `handledBy`, using the
 * frame's `displayName` — always present on {@link AgentEventPayload} (=
 * `HandledBy`), real data, never a placeholder.
 *
 * `handledBy` is updated for BOTH `kind`s (T10) — it is the broader field
 * `ChatSession.handledBy`'s doc describes, and a BOT resuming a session (the
 * documented reason `HandledBy`/`AgentEventPayload` ever carries `kind:
 * 'BOT'` at all, per domain.ts) is exactly the case it exists to cover.
 *
 * `assignedAgent`, by contrast, stays AGENT-only — a deliberate, load-bearing
 * asymmetry from the T7 report, not an oversight T10 is fixing: `assignedAgent`
 * is typed and named for a human agent specifically
 * (`ChatParticipantProfile`, populated elsewhere from the snapshot's
 * `AGENT`-type participant only), and writing a bot's identity into it would
 * misrepresent who `assignedAgent` says is handling the chat. So a BOT
 * payload is a no-op for `assignedAgent` and a real write for `handledBy` —
 * see the test coverage in session.test.ts for both halves of that split.
 */
export function applyAgentJoined(session: ChatSession | null, payload: AgentEventPayload): ChatSession | null {
  if (session === null) return null;
  if (payload.kind !== 'AGENT') return { ...session, handledBy: payload };
  return {
    ...session,
    assignedAgent: {
      participantId: payload.id,
      displayName: payload.displayName,
      email: null,
      avatarUrl: null,
    },
    handledBy: payload,
  };
}

/**
 * Clears `assignedAgent` and/or `handledBy` on `agent.left`, each
 * independently, only for whichever one the leaving participant currently
 * occupies.
 *
 * The two clears are independent because the two fields can already disagree
 * before this runs — e.g. a BOT is `handledBy` but was never `assignedAgent`
 * (T10; see `applyAgentJoined`), so a BOT's `agent.left` must clear
 * `handledBy` without touching `assignedAgent` (which was never set by it),
 * and conversely a human agent's `agent.left` must clear `assignedAgent`
 * without necessarily clearing `handledBy` if a fresher `agent.joined`
 * (a BOT taking back over) has already updated it to someone else's id.
 *
 * `handledBy` is deleted, not set to `undefined` — `exactOptionalPropertyTypes`
 * makes the two different, and §6.4's contract for this field is "absent",
 * not "explicitly nothing".
 */
export function applyAgentLeft(session: ChatSession | null, id: string): ChatSession | null {
  if (session === null) return null;

  const clearingAssignedAgent = session.assignedAgent?.participantId === id;
  const clearingHandledBy = session.handledBy?.id === id;
  if (!clearingAssignedAgent && !clearingHandledBy) return session;

  const next: ChatSession = {
    ...session,
    assignedAgent: clearingAssignedAgent ? null : session.assignedAgent,
  };
  if (clearingHandledBy) delete next.handledBy;
  return next;
}

/**
 * Whether `session.handledBy` is safe to narrate as an ACTIVE handoff right
 * now — e.g. "you're chatting with <name>" — as opposed to merely being
 * present.
 *
 * `handledBy` is wholesale-authoritative off the wire and this SDK never
 * suppresses, clears, or second-guesses it (see `sessionSnapshotToChatSession`
 * and `ChatSession.handledBy`'s doc) — but it can legitimately lag `status`.
 * Backend node T6: a session reactivated from `CLOSED`/`RESOLVED` by a new
 * customer message keeps its previous `assignedAgentId` server-side, so a
 * freshly-reactivated session's `handledBy` can still name the agent who
 * closed it, even though `status` has already gone back to
 * `WAITING_FOR_AGENT` — queued, nobody actively engaged.
 *
 * `WAITING_FOR_AGENT` is the only status this checks for, deliberately: it
 * is the one status the reactivation flow is documented to produce this
 * mismatch for. This is NOT a general session-lifecycle classifier — every
 * other status (including `CLOSED`/`RESOLVED`, which a binding already gates
 * its own "conversation is over" UI on independently of this) is treated as
 * "trust `handledBy`", because nothing else in the wire contract is
 * documented to leave it stale.
 *
 * Every binding (React/Vue/Angular/vanilla) should gate active-handoff copy
 * on this rather than re-deriving the rule ad hoc — the same reasoning
 * `messages/ticks.ts`'s `deriveTickState` gives for being the one canonical
 * tick derivation.
 */
export function isHandledByCurrent(session: Pick<ChatSession, 'status' | 'handledBy'>): boolean {
  return session.handledBy !== undefined && session.status !== 'WAITING_FOR_AGENT';
}

/** Applies `ticket.linked`'s real url — see the module header on why the snapshot mapping alone cannot. */
export function applyTicketLinked(session: ChatSession | null, payload: TicketLinkedPayload): ChatSession | null {
  if (session === null) return null;
  return { ...session, ticket: { id: payload.ticketId, url: payload.ticketUrl ?? null } };
}

/**
 * Applies `session.closed`'s receipt time as a best-effort `closedAt`.
 *
 * `closedAt` is approximate (the moment this client learned of the closure,
 * not necessarily the server's own closing timestamp) because
 * `SessionClosedPayload` carries no timestamp of its own — see the module
 * header. Only applied when the closed session is the one currently in
 * state; a stale `session.closed` for a session already replaced by a newer
 * snapshot is a no-op.
 */
export function applySessionClosed(
  session: ChatSession | null,
  sessionId: string,
  closedAt: string,
): ChatSession | null {
  if (session === null || session.id !== sessionId) return session;
  return { ...session, closedAt };
}
