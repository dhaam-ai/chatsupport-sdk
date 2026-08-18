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
//   - `displayName`/`email`/`avatarUrl` are NOT on the wire snapshot at all.
//     Rather than fabricate a name, the participant's own id is used as a
//     legible-but-honest placeholder (it IS real data, just not a friendly
//     one) until something that actually carries a name arrives — `
//     agent.joined`'s `agentName` (`applyAgentJoined` below), or a REST
//     `SessionActions` call, which returns the full REST `ChatSession` and
//     needs no placeholder at all.
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
 * A profile for `participant`, reusing `known`'s enrichment (display name,
 * email, avatar) when it is the *same* participant id — see the module
 * header on why that is not a §9.4 violation. Falls back to the
 * participant's own id as the display name otherwise: honest, not invented.
 */
function bestEffortProfile(
  participant: ParticipantSnapshot,
  known: ChatParticipantProfile | null,
): ChatParticipantProfile {
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
  };
}

/** True exactly when this is the §6.5 `statusChange` trigger — an actual change, not the first-ever value. */
export function statusOrModeChanged(previous: ChatSession | null, next: ChatSession): boolean {
  return previous !== null && (previous.status !== next.status || previous.mode !== next.mode);
}

/**
 * Applies `agent.joined` to `assignedAgent`, using the frame's `agentName`
 * when present — real data, not a placeholder: this is the one frame the
 * wire protocol actually carries a display name on.
 */
export function applyAgentJoined(session: ChatSession | null, payload: AgentEventPayload): ChatSession | null {
  if (session === null) return null;
  return {
    ...session,
    assignedAgent: {
      participantId: payload.agentId,
      displayName: payload.agentName ?? payload.agentId,
      email: null,
      avatarUrl: null,
    },
  };
}

/** Clears `assignedAgent` on `agent.left`, only if the leaving agent is the one currently assigned. */
export function applyAgentLeft(session: ChatSession | null, agentId: string): ChatSession | null {
  if (session === null || session.assignedAgent?.participantId !== agentId) return session;
  return { ...session, assignedAgent: null };
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
