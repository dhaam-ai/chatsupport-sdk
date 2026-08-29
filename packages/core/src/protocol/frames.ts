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
import type {
  AttachmentMetadata,
  HandledBy,
  MessageMetadata,
  PresenceEntry,
  SessionSnapshot,
} from './domain.js';
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
 */
export interface ConnectionHelloPayload {
  token: string;

  /**
   * The tenant this connection belongs to — and, by its PRESENCE, which of the
   * server's two flows the hello selects.
   *
   * Present ⇒ the customer flow, byte-for-byte what it has always been.
   * Absent ⇒ the STAFF flow, where the tenant is resolved from the staff token
   * itself rather than from a key a browser was handed.
   *
   * Optional rather than removed-and-replaced because absence is the whole
   * signal: a staff client has no publishable key to send, and inventing a
   * sentinel value for it (`''`, `'STAFF'`) would put the routing decision in
   * a STRING the server has to interpret instead of in the shape of the frame,
   * which every non-TypeScript client would then have to discover.
   *
   * Still shape-checked when present — see validate.ts. A blank key is
   * REJECTED rather than treated as absent: tolerating it would open a second,
   * undocumented route into the staff flow for a customer client whose key
   * happened to resolve to empty, which is a privilege boundary and not a
   * formatting detail.
   */
  publishableKey?: string;

  /** Highest protocol version this client supports (§7.5). */
  protocolVersion: number;

  /** Last applied `seq` (D2). Omit on first connect. */
  resumeFrom?: number;

  /**
   * "Start a new conversation": the server must mint a FRESH session rather
   * than resume this customer's active one, closing that one with `SWITCHED`
   * first.
   *
   * Set only by `startNewSession()`. Dropping the resume anchor is NOT enough
   * on its own and never was: chat-service resolves a customer to their one
   * active session regardless of `resumeFrom` (its schema permits exactly one,
   * via a partial unique index), so a hello without this flag was handed the
   * old session back and the customer's "new" conversation silently continued
   * the previous one.
   *
   * Optional and omitted — never `false` — on every ordinary connect and
   * reconnect: a server that predates the field ignores an absent key, and
   * §7.2/D4 wants absence rather than a null.
   */
  newSession?: boolean;
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
   * The session this message belongs to — the message's own address.
   *
   * OPTIONAL, and the server's fallback when it is absent is exactly the old
   * behavior: attribute the message to whatever session `session.join` last
   * established on this connection. That keeps an older client working and
   * keeps this a non-breaking wire change.
   *
   * It exists because "whatever was joined last" is a property of the
   * CONNECTION, not of the message, and the two diverge for as long as a send
   * outlives the session it was typed in. A message composed offline in
   * session B and flushed after the client switched to session A was filed by
   * the server into session A — the send frame carried no session at all, so
   * there was nothing for the server to file it under except the connection's
   * current join. That is cross-conversation delivery of user content, and no
   * amount of client-side ordering fixes it, because the wire cannot express
   * the fact being lost.
   *
   * Core fills this from the queue entry's own `sessionId` — the session the
   * message was composed in — never from the currently joined session.
   */
  sessionId?: string;

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

  /** Top-level, never under `metadata` — one canonical location (D4). */
  attachment?: AttachmentMetadata;

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
 * Delivery-receipt watermark, the mirror of {@link MessageMarkReadPayload}
 * (§9.5's model, D2's ordering key).
 *
 * One integer per participant, never a list of message ids: §9.5 already
 * settled watermarks as the model for read state, and delivery is the same
 * shape of fact about the same messages. `seq` rather than a message id
 * because delivery is a *range* claim — "everything up to here" — and only
 * `seq` totally orders the range (D2). A `upToMessageId` variant would force
 * every receiver to resolve the id back to a seq before it could compare,
 * against a list it may not hold.
 *
 * Required, unlike `markRead`'s optional `upToMessageId`: there is no
 * "up to latest" reading of an absent number that the server could evaluate
 * without knowing what this client has actually received. Core fills it from
 * the highest `seq` it holds when the caller does not name one.
 */
export interface MessageMarkDeliveredPayload {
  /** Highest seq this client has received and rendered. */
  upToSeq: number;
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

/**
 * Pushed on `agent.joined` / `agent.left`. Identical shape to
 * {@link SessionSnapshot.handledBy} (domain.ts) — see that doc comment for
 * why: both are populated from the same resolver, so a client rendering the
 * session header from `handledBy` and one reacting to `agent.joined` for a
 * toast/animation can never see two different names for the same
 * participant.
 *
 * `kind` is `'BOT'` when the bot starts/stops handling a session (e.g. the
 * bot resumes after a human agent leaves), not only for human agents —
 * "agent" here is the §6.5 event-catalog name for "who is handling this
 * chat", not a claim that only humans fire it.
 *
 * BREAKING (v2 wire contract): this replaced
 * `{ agentId: string; agentName?: string }` outright rather than extending
 * it. `agent.joined`/`agent.left` were declared in §6.5 but never actually
 * emitted on the wire, so there was zero live traffic to protect — see the
 * T7 report.
 */
export type AgentEventPayload = HandledBy;

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

  /** Top-level, never under `metadata` — one canonical location (D4). */
  attachment?: AttachmentMetadata;

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

/**
 * Delivery-watermark push — the server→client half of the pair, exactly
 * mirroring `message.markRead` → `message.read`.
 *
 * `deliveredAt` is carried for display ("delivered 12:04"), never for
 * ordering: two participants' clocks are not comparable, and D2 already
 * names `seq` the ordering key. Anything advancing or comparing a watermark
 * reads `deliveredUpToSeq` and nothing else.
 */
export interface MessageDeliveredPayload {
  participantId: string;

  /** Highest seq this participant has received. */
  deliveredUpToSeq: number;

  /** ISO-8601. Display only — never an ordering or monotonicity input. */
  deliveredAt: string;
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

  /**
   * The sender label the server actually recorded, derived from the verified
   * identity on the connection.
   *
   * ── Why the ack carries this at all ────────────────────────────────────
   * The server excludes the sender from its own `message.new` fan-out (the
   * ack already told it, and D1 means there is no id to reconcile), so this
   * ack is the ONLY frame that can tell a client how its message was
   * labelled. `LocalSender` (messages/types.ts) is configured by the embedding app for
   * the optimistic echo, and an app that configures `'AGENT'` while holding a
   * customer token would otherwise keep a wrong local label indefinitely,
   * with nothing to correct it against.
   *
   * ── Read this before adding a role to a client→server frame ────────────
   * The direction is one-way on purpose. The server REPORTS the role it
   * derived from the token's claims; it never ACCEPTS one. There is no role
   * field on `connection.hello`, on {@link MessageSendPayload}, or anywhere
   * else in the client→server half of this catalog, and adding one would
   * rebuild v1's `?role=AGENT` query-parameter hole — where any client that
   * typed the word AGENT was served as an agent. A staff sender is
   * expressible on this protocol precisely because the wire does not carry
   * the claim.
   *
   * Optional so that a client built against this version still works against
   * a server that predates the field; treat `undefined` as "no correction
   * available", never as CUSTOMER.
   */
  senderType?: SenderType;
}

/** Extra data on a successful ack of `presence.query`. */
export interface PresenceQueryAckData {
  presences: PresenceEntry[];
}

/**
 * An ack carrying nothing beyond `{ ok: true }` — what `connection.reauth`,
 * `session.join`, and friends return.
 *
 * Deliberately NOT {@link EmptyPayload}: `AckFrame.d` is `{ ok: true } & T`,
 * and `Record<string, never>` maps *every* string key to `never`, so that
 * intersection demands `ok: never` and no data-free ack satisfies it.
 * `Record<never, never>` constrains no keys, so the intersection is just
 * `{ ok: true }`.
 */
export type EmptyAckData = Record<never, never>;

export type AckExtraData = MessageSendAckData | PresenceQueryAckData | EmptyAckData;

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
  'message.markDelivered',
  'typing.start',
  'typing.stop',
  'presence.set',
  'presence.query',
  'system.heartbeat',
] as const;

export type ClientToServerFrameType = (typeof CLIENT_TO_SERVER_FRAME_TYPES)[number];

/**
 * The 13 plain-`Frame<T>`-shaped server→client push types — excludes `ack`
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
  'message.delivered',
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
  'message.markDelivered': MessageMarkDeliveredPayload;
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
  'message.delivered': MessageDeliveredPayload;
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
