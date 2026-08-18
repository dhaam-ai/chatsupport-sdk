// Wire-level domain snapshot shapes shared by multiple frame payloads.
//
// These are the shapes that live *inside* `d` on several different frame
// types (frames.ts) — not the richer, binding-facing `ChatState`/
// `ChatSession`/`ChatMessage` types from PRD §6.4, which a later task
// (observable store, §"T3") derives from these wire shapes. Keeping the
// two separate is deliberate: the wire contract must stay exactly what
// §7 specifies even if the state layer later decides to reshape, cache, or
// enrich this data before exposing it to bindings.

import type { ChatMode, ChatStatus, ParticipantType, PresenceStatus } from './enums.js';

/**
 * Generalized from v1's confirmed upload response shape (§12.10):
 * `POST /chat-services/api/v1/upload` → `{url, fileName, mimeType, size,
 * mediaType}`. Carried as a message's top-level `attachment` field on both
 * `message.send` (client→server) and `message.new` (server→client).
 */
export interface AttachmentMetadata {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  mediaType: string;
}

/**
 * Free-form message metadata bag: opaque application data core never
 * interprets. Attachments are NOT in here — see {@link AttachmentMetadata}.
 */
export interface MessageMetadata {
  [key: string]: unknown;
}

/**
 * Per-participant read watermark entry — v1's confirmed `lastReadAt`-per-
 * participant model (§9.5, §12.9), generalized from a single `agentReadAt`
 * field to be keyed by `participantId` per §6.4's `ChatState.readWatermarks`
 * comment ("generalized from v1's single agentReadAt field").
 */
export interface ParticipantSnapshot {
  participantId: string;
  type: ParticipantType;

  /** ISO-8601. Absent if this participant has not read anything yet. */
  lastReadAt?: string;
}

/**
 * Full session snapshot. Per §7.3, `connection.ack` "Carries full session
 * snapshot"; per §9.4, `connection.ack` and `session.updated` snapshots
 * must both be treated as the SAME kind of authoritative, wholesale-replace
 * data — "never merge field-by-field against a possibly-stale local copy" —
 * so both frame types carry this identical shape (see
 * `ConnectionAckPayload.session` and `SessionUpdatedPayload.session` in
 * frames.ts).
 *
 * Judgment call: message history is deliberately NOT embedded here.
 * Initial/backfill messages are loaded via the cursor-paginated history
 * path (§6.3 `loadOlderMessages`, §9's pagination model), not pushed
 * inline on every ack/update — "session snapshot" is read as session-level
 * state (status, mode, participants, ticket), not session+message-history.
 * See the T1 report for the reasoning.
 */
export interface SessionSnapshot {
  sessionId: string;
  status: ChatStatus;
  mode: ChatMode;
  participants: ParticipantSnapshot[];

  /** ISO-8601. */
  createdAt: string;

  ticketId?: string;
}

/**
 * A presence entry — same shape whether it arrives via `presence.query`'s
 * ack (one entry per queried participant) or is pushed via
 * `presence.update` (one entry, the participant whose presence changed).
 */
export interface PresenceEntry {
  participantId: string;
  status: PresenceStatus;

  /** ISO-8601. Absent while the participant is currently online. */
  lastSeen?: string;
}
