// Frame type catalog — every client→server and server→client frame type in
// PRD §7.3, plus a discriminated union mapping each frame type to its exact
// payload shape.
//
// `switch (frame.t)` over `AnyFrame` gives exhaustive narrowing with no
// casts: every member of every union below carries a literal `t` (or, for
// the `ClientFrame`/`ServerPushFrame` halves, a `t: K` derived from the
// payload map's own keys — see `FramesOf`), so TypeScript can narrow `d` to
// the exact payload type for that frame from `t` alone.

import type { AckFrame, ErrorFrame, ErrorPayload, Frame } from './envelope.js';
import type { MessageMetadata, PresenceEntry, SessionSnapshot } from './domain.js';
import type { CloseReason, MessageType, PresenceStatus, SenderType } from './enums.js';

/** Shared shape for frame types whose payload is deliberately empty. */
export type EmptyPayload = Record<string, never>;

// =============================================================================
// Client → Server payloads
// =============================================================================

/**
 * First frame after WS open (§7.3, §10.2, §10.4). `resumeFrom` carries the
 * last applied `seq` per D2 (§0.5) — omit on a genuinely first connection,
 * where there is no prior applied frame to resume from.
 *
 * `token` / `guestId` — exactly one must be present (T9's Gap A amendment to
 * the original PRD, which only specified `token` and had no guest/anonymous
 * path at all — see `PLAN-v2-core-adoption.md`). `token` is an authenticated
 * connection's access token (§10.3/§10.4). `guestId` is a client-generated,
 * client-persisted id for an anonymous connection — never a server-issued
 * credential. A connection started with `guestId` upgrades to authenticated
 * later via `connection.reauth` carrying a real `token` on the same open
 * socket, not by sending a second `connection.hello`.
 */
export interface ConnectionHelloPayload {
  token?: string;
  guestId?: string;
  publishableKey: string;

  /** Highest protocol version this client supports (§7.5). */
  protocolVersion: number;

  /** Last applied `seq` (D2). Omit on first connect. */
  resumeFrom?: number;
}

/**
 * Re-authenticate on an already-open socket (D3, §0.5; §10.5). Judgment
 * call: the PRD does not specify a response frame type for this one
 * explicitly. This module treats it like any other client→server frame —
 * answered by a generic `ack` (§8.4's "or other client-originated frame"
 * language) on success, or `error` (e.g. `AUTH_INVALID`) on failure — rather
 * than re-emitting a full `connection.ack` snapshot, since reauth refreshes
 * credentials only and must not reset session state. See the T1 report.
 */
export interface ConnectionReauthPayload {
  token: string;
}

export interface SessionJoinPayload {
  sessionId: string;
}

export interface SessionRequestAgentPayload {
  reason?: string;
}

export interface MessageSendPayload {
  content: string;

  /**
   * Judgment call: required on the wire even though the public
   * `client.sendMessage()`'s `opts.type` is optional (§6.3) — core fills
   * the `'TEXT'` default before constructing the frame, so every
   * non-TypeScript client has one unambiguous field to populate rather
   * than an implicit default it has to independently discover. See the T1
   * report.
   */
  type: MessageType;

  replyToMessageId?: string;
  metadata?: MessageMetadata;
}

/**
 * Judgment call: the PRD does not give this frame's payload shape
 * explicitly. `upToMessageId` marks read up to (and including) a specific
 * message; omitting it means "up to the latest message currently known to
 * the client" — this covers §9.5's "flush a single 'read up to latest seen
 * message' watermark update" reconnect case without needing a second,
 * differently-shaped frame. See the T1 report.
 */
export interface MessageMarkReadPayload {
  upToMessageId?: string;
}

/**
 * Same shape in both directions (§7.3: "Server relays the same two frame
 * types it accepts from clients — one concept, one pair of names, in both
 * directions"). Judgment call: `participantId` is optional so ONE payload
 * type serves both directions — omitted when a client reports its own
 * typing state (the server already knows the sender from the connection),
 * always populated when the server relays it to other participants. See
 * the T1 report.
 */
export interface TypingPayload {
  participantId?: string;
}

export interface PresenceSetPayload {
  status: PresenceStatus;
}

/** Omit `participantIds` to query every participant in the active session. */
export interface PresenceQueryPayload {
  participantIds?: string[];
}

// =============================================================================
// Server → Client payloads
// =============================================================================

export interface ConnectionAckPayload {
  /** Negotiated version = min(client max, server max) — §7.5. */
  protocolVersion: number;

  session: SessionSnapshot;

  /** The `seq` this ack is current as of — the client's new resume anchor. */
  seq: number;

  /**
   * Frames after the client's `resumeFrom`, replayed inline (D2, §0.5).
   * Absent or empty on a fresh connect, or when nothing was missed.
   */
  replay?: ServerPushFrame[];
}

export interface SessionUpdatedPayload {
  /** Full snapshot, always applied wholesale — never merged (§9.4). */
  session: SessionSnapshot;
}

export interface SessionClosedPayload {
  sessionId: string;
  closeReason: CloseReason;
}

/** Shared by `agent.joined` and `agent.left` (§6.5's event catalog uses the same shape for both). */
export interface AgentEventPayload {
  agentId: string;
  agentName?: string;
}

/**
 * The pushed message itself. `id` is the message's permanent id — for a
 * client-originated message this is the SAME ULID the client generated as
 * the `message.send` envelope's `id` (D1, §0.5); for a server/agent/bot-
 * originated message, the server generates this id instead. Either way it
 * is the one stable identity for the message from here on — no
 * optimistic-id-swap field exists anywhere in this payload or elsewhere in
 * the protocol.
 */
export interface MessagePayload {
  id: string;
  sessionId: string;
  senderId: string;
  senderType: SenderType;
  type: MessageType;
  content: string;
  replyToMessageId?: string;
  metadata?: MessageMetadata;

  /** Ordering key (D2). Use this, never the envelope's `ts`, to order or detect gaps. */
  seq: number;

  /** ISO-8601. One canonical name per concept (§12.2) — no timestamp/createdAt/created_at/sentAt aliasing. */
  createdAt: string;
}

export interface MessageReadPayload {
  participantId: string;

  /** ISO-8601. */
  readAt: string;
}

/** Same shape as a `presence.query` ack's per-participant entry (domain.ts). */
export type PresenceUpdatePayload = PresenceEntry;

export interface TicketLinkedPayload {
  ticketId: string;
  ticketUrl?: string;
}

// =============================================================================
// `ack` extra data
// =============================================================================
//
// `ack` (§7.2 AckFrame) is one frame type shared by every acked
// client→server frame. This module cannot statically know, from `t` alone,
// which client→server frame a given `ack` is acking — that requires
// stateful `ref` correlation owned by the transport layer (out of this
// module's scope). `AckExtraData` is the union of known "extra fields
// beyond `{ok:true}`" shapes; callers narrow further themselves once they
// know what `ref` pointed to.

/** Extra data on a successful ack of `message.send`. */
export interface MessageSendAckData {
  /** The `seq` the server assigned this message (D2). */
  seq: number;
}

/** Extra data on a successful ack of `presence.query`. */
export interface PresenceQueryAckData {
  presences: PresenceEntry[];
}

export type AckExtraData = MessageSendAckData | PresenceQueryAckData | EmptyPayload;

// =============================================================================
// Frame type catalog
// =============================================================================

export const CLIENT_TO_SERVER_FRAME_TYPES = [
  'connection.hello',
  'connection.reauth',
  'session.join',
  'session.leave',
  'session.requestAgent',
  'message.send',
  'message.markRead',
  'typing.start',
  'typing.stop',
  'presence.set',
  'presence.query',
  'system.heartbeat',
] as const;

export type ClientToServerFrameType = (typeof CLIENT_TO_SERVER_FRAME_TYPES)[number];

/**
 * The 12 plain-`Frame<T>`-shaped server→client push types — excludes `ack`
 * and `error`, which use the `AckFrame`/`ErrorFrame` envelope shapes
 * instead (§7.2).
 */
export const SERVER_PUSH_FRAME_TYPES = [
  'connection.ack',
  'session.updated',
  'session.closed',
  'agent.joined',
  'agent.left',
  'message.new',
  'typing.start',
  'typing.stop',
  'message.read',
  'presence.update',
  'ticket.linked',
  'system.pong',
] as const;

export type ServerPushFrameType = (typeof SERVER_PUSH_FRAME_TYPES)[number];

export const SERVER_TO_CLIENT_FRAME_TYPES = [...SERVER_PUSH_FRAME_TYPES, 'ack', 'error'] as const;

export type ServerToClientFrameType = (typeof SERVER_TO_CLIENT_FRAME_TYPES)[number];

export const ALL_FRAME_TYPES = [
  ...CLIENT_TO_SERVER_FRAME_TYPES,
  ...SERVER_TO_CLIENT_FRAME_TYPES,
] as const;

export type FrameType = ClientToServerFrameType | ServerToClientFrameType;

// -----------------------------------------------------------------------------
// Payload maps — one entry per frame type, keyed by the frame type literal.
// -----------------------------------------------------------------------------

export interface ClientFramePayloadMap {
  'connection.hello': ConnectionHelloPayload;
  'connection.reauth': ConnectionReauthPayload;
  'session.join': SessionJoinPayload;
  'session.leave': EmptyPayload;
  'session.requestAgent': SessionRequestAgentPayload;
  'message.send': MessageSendPayload;
  'message.markRead': MessageMarkReadPayload;
  'typing.start': TypingPayload;
  'typing.stop': TypingPayload;
  'presence.set': PresenceSetPayload;
  'presence.query': PresenceQueryPayload;
  'system.heartbeat': EmptyPayload;
}

export interface ServerPushFramePayloadMap {
  'connection.ack': ConnectionAckPayload;
  'session.updated': SessionUpdatedPayload;
  'session.closed': SessionClosedPayload;
  'agent.joined': AgentEventPayload;
  'agent.left': AgentEventPayload;
  'message.new': MessagePayload;
  'typing.start': TypingPayload;
  'typing.stop': TypingPayload;
  'message.read': MessageReadPayload;
  'presence.update': PresenceUpdatePayload;
  'ticket.linked': TicketLinkedPayload;
  'system.pong': EmptyPayload;
}

// -----------------------------------------------------------------------------
// Discriminated unions.
// -----------------------------------------------------------------------------

/**
 * Distributes a payload map into a union of `Frame<T> & { t: K }`, one
 * member per key — the standard "map to discriminated union" pattern.
 * Every resulting member has a literal `t`, so `switch (frame.t)` narrows
 * `d` correctly with no casts.
 */
type FramesOf<M> = { [K in keyof M]: Frame<M[K]> & { t: K } }[keyof M];

/** Every client→server frame, discriminated on `t`. */
export type ClientFrame = FramesOf<ClientFramePayloadMap>;

/** The 12 plain-envelope server→client push frames, discriminated on `t`. */
export type ServerPushFrame = FramesOf<ServerPushFramePayloadMap>;

/** Every server→client frame, including the two special-cased envelope shapes. */
export type ServerFrame = ServerPushFrame | AckFrame<AckExtraData> | ErrorFrame;

/** Every frame this protocol defines, in either direction. */
export type AnyFrame = ClientFrame | ServerFrame;

export type { AckFrame, ErrorFrame, ErrorPayload, Frame };
