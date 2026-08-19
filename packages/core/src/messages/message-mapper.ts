// Maps the WS wire push shape (`MessagePayload`, protocol/frames.ts) onto
// the binding-facing `ChatMessage` (state/types.ts).
//
// Judgment call: `MessagePayload` has no `senderName` or reply-preview
// field at all, and nests `attachment` inside `metadata` rather than
// hoisting it to the top level the way the REST `Message` schema (and
// therefore `ChatMessage`) does — see state/types.ts's own header comment
// on why `ChatMessage` mirrors the REST shape, not the WS one. This mapper
// is the seam that reconciles the two: `senderName`/`replyToMessage` come
// through `null` (nothing else provides them on this path), and
// `attachment` is hoisted out of `metadata` into the canonical top-level
// field, matching D4's "one canonical location for attachment data."

import type { ChatMessage, ChatSession } from '../state/index.js';
import type { MessagePayload, SessionSnapshot } from '../protocol/index.js';

/**
 * Maps the WS wire session snapshot (`connection.ack.session` /
 * `session.updated.session`) onto the binding-facing `ChatSession`.
 *
 * Nothing else populates `ChatState.session` yet — no prior task owned this
 * wiring (T8 deliberately stays decoupled from `state/`; see
 * connection-machine.ts's header), and T11 is the first task that actually
 * needs a session id for its own REST/send operations. T13's assembly may
 * consolidate this elsewhere later, but the mapping itself doesn't change.
 *
 * `SessionSnapshot` is deliberately lighter than the REST `ChatSession`
 * schema (no resolved agent/customer profiles, no full ticket object — see
 * domain.ts's header on why) — those fields degrade to `null` here rather
 * than being guessed at. A REST `GET /sessions/{id}/full` call (outside
 * this mapper's scope) is what actually hydrates them.
 */
export function sessionSnapshotToChatSession(snapshot: SessionSnapshot): ChatSession {
  return {
    id: snapshot.sessionId,
    status: snapshot.status,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
    closedAt: null,
    assignedAgent: null,
    customer: null,
    ticket: snapshot.ticketId ? { id: snapshot.ticketId, url: null } : null,
  };
}

export function messagePayloadToChatMessage(payload: MessagePayload): ChatMessage {
  const { attachment, ...restMetadata } = payload.metadata ?? {};
  const hasRestMetadata = Object.keys(restMetadata).length > 0;

  return {
    id: payload.id,
    chatSessionId: payload.sessionId,
    senderType: payload.senderType,
    senderId: payload.senderId,
    senderName: null,
    content: payload.content,
    messageType: payload.type,
    createdAt: payload.createdAt,
    attachment: attachment ?? null,
    replyToMessageId: payload.replyToMessageId ?? null,
    replyToMessage: null,
    ...(hasRestMetadata ? { metadata: restMetadata } : {}),
  };
}
