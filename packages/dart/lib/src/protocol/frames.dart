/// The §7.3 payload catalog — what goes inside `d`.
///
/// ── SPEC GAP, and it is the largest one in this package ───────────────────
///
/// §7.3 is a table of frame NAMES with a prose "Purpose" column and a
/// "Replaces (v1)" column. It contains no payload schemas at all: not one
/// field name, type, or optionality marker for any of the twenty-five frame
/// types it lists. §7.2 defines the envelope precisely and then says only that
/// `d` is the "payload", with global rules (camelCase, string enums, ISO-8601)
/// but no per-frame shape. The OpenAPI document covers the REST surface and
/// does not model WebSocket frames.
///
/// So the PRD's success criterion #1 — "a Swift/Kotlin/Flutter engineer with
/// no access to the TypeScript source could implement a conformant client
/// purely from §7 and the OpenAPI spec" — does not hold today. Every field
/// below was recovered by reading the server, not the spec. The scattered
/// exceptions the PRD does pin down are `connection.hello.d.resumeFrom` (D2),
/// `connection.hello.d.publishableKey` (§10.2), `protocolVersion` on hello and
/// ack (§7.5), and `connection.ack.d.replay` (D2) — four fields out of roughly
/// forty, and even those have no stated types.
///
/// The concrete cost of the gap, in the order it bit:
///
///  1. `resumeFrom` — §8.3 calls it "the id/seq of the last frame the client
///     fully applied". `id` or `seq`: those are a ULID string and an integer.
///     D2 says "carries the last applied `seq`", and the server validates
///     `isInteger`. §8.3 was never updated after D2 closed it, so the section
///     that describes resume is the one that gets it wrong. An implementer
///     following §8.3 sends a ULID and gets VALIDATION_FAILED.
///  2. `connection.ack.d.seq` — the resume anchor. Named nowhere in the PRD.
///     Without it a client cannot know what to send as the next `resumeFrom`,
///     which makes resume unimplementable from the spec.
///  3. `message.send.d.type` — REQUIRED by the server. §6.3 shows it as
///     optional (`opts?: { type?: MessageType }`), so a spec-following client
///     omits it on every plain text message and every send fails.
///  4. The replay array holds `message.new` frames and nothing else. Not
///     stated anywhere; an implementer reasonably builds a general applier
///     for any frame type.
///
/// See README.md for the full list.
library;

import 'enums.dart';
import 'envelope.dart';
import 'errors.dart';
import 'json.dart';

// ---------------------------------------------------------------------------
// Client → server payloads
// ---------------------------------------------------------------------------

/// Builds `connection.hello.d` (§7.3, §10.2, D2).
///
/// [resumeFrom] is the last `seq` this client fully applied — an INTEGER, not
/// a frame id, despite §8.3's "the id/seq of the last frame". Omit it on a
/// first connect; the server reads absent as "fresh" and present-but-stale as
/// something to replay.
Map<String, Object?> connectionHelloPayload({
  required String token,
  required String publishableKey,
  int protocolVersion = kProtocolVersion,
  int? resumeFrom,
}) =>
    <String, Object?>{
      'token': token,
      'publishableKey': publishableKey,
      'protocolVersion': protocolVersion,
      if (resumeFrom != null) 'resumeFrom': resumeFrom,
    };

/// Builds `connection.reauth.d` (§7.3, §10.5, D3).
Map<String, Object?> connectionReauthPayload({required String token}) =>
    <String, Object?>{'token': token};

/// Builds `session.join.d` (§7.3).
Map<String, Object?> sessionJoinPayload({required String sessionId}) =>
    <String, Object?>{'sessionId': sessionId};

/// Builds `session.requestAgent.d` (§7.3).
Map<String, Object?> sessionRequestAgentPayload({String? reason}) =>
    <String, Object?>{if (reason != null) 'reason': reason};

/// Builds `message.send.d` (§7.3, §9.3).
///
/// [type] is REQUIRED on the wire even though §6.3 presents it as an optional
/// option-bag field. It defaults to [MessageType.text] here so a Dart caller
/// gets §6.3's ergonomics and the server still gets its required field.
///
/// The message's id is NOT in here — it is the envelope's `id` (D1), and it is
/// the permanent message id.
Map<String, Object?> messageSendPayload({
  required String content,
  MessageType type = MessageType.text,
  String? replyToMessageId,
  AttachmentMetadata? attachment,
  Map<String, Object?>? metadata,
}) =>
    <String, Object?>{
      'content': content,
      'type': type.wire,
      if (replyToMessageId != null) 'replyToMessageId': replyToMessageId,
      // Top-level, never nested under `metadata` — one canonical location
      // (D4). v1 read `message.attachment` and `message.metadata.attachment`
      // interchangeably (§12.2/§12.10) and that is the mistake being avoided.
      if (attachment != null) 'attachment': attachment.toJson(),
      if (metadata != null) 'metadata': metadata,
    };

/// Builds `message.markRead.d` (§7.3, §9.5).
Map<String, Object?> messageMarkReadPayload({String? upToMessageId}) =>
    <String, Object?>{
      if (upToMessageId != null) 'upToMessageId': upToMessageId,
    };

/// Builds `typing.start.d` / `typing.stop.d` (§7.3).
///
/// `participantId` is set only when the SERVER relays one; a client sends an
/// empty payload and the server attributes it.
Map<String, Object?> typingPayload() => <String, Object?>{};

/// Builds `presence.set.d` (§7.3).
Map<String, Object?> presenceSetPayload({required PresenceStatus status}) =>
    <String, Object?>{'status': status.wire};

/// Builds `system.heartbeat.d` (§7.3).
Map<String, Object?> heartbeatPayload() => <String, Object?>{};

// ---------------------------------------------------------------------------
// Shared domain shapes carried inside `d`
// ---------------------------------------------------------------------------

/// File metadata attached to a message (§12.10, restated for v2 by D4).
///
/// Uploading is out of scope for this pass — the REST upload endpoint is not
/// implemented here. Decoding is in scope, because a `message.new` carrying an
/// attachment must not fail to parse just because this client cannot create
/// one.
class AttachmentMetadata {
  const AttachmentMetadata({
    required this.url,
    required this.fileName,
    required this.mimeType,
    required this.size,
    required this.mediaType,
  });

  factory AttachmentMetadata.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) =>
      AttachmentMetadata(
        url: requireNonEmptyString(json, 'url', path, frameType: frameType),
        fileName:
            requireNonEmptyString(json, 'fileName', path, frameType: frameType),
        mimeType:
            requireNonEmptyString(json, 'mimeType', path, frameType: frameType),
        size: requireInt(json, 'size', path, frameType: frameType),
        mediaType: requireNonEmptyString(
          json,
          'mediaType',
          path,
          frameType: frameType,
        ),
      );

  final String url;
  final String fileName;
  final String mimeType;
  final int size;
  final String mediaType;

  Map<String, Object?> toJson() => <String, Object?>{
        'url': url,
        'fileName': fileName,
        'mimeType': mimeType,
        'size': size,
        'mediaType': mediaType,
      };
}

/// Who is currently handling a session for the customer — a human agent or
/// the bot.
///
/// Resolved server-side through the same lookup chain that produces the
/// "<name> has joined the chat" system message, so a session header built from
/// [SessionSnapshot.handledBy] and a toast built from an `agent.joined` frame
/// can never disagree about the name. That is why there is ONE class here and
/// not two near-duplicates: `agent.joined.d` and `agent.left.d` carry exactly
/// this shape, and [AgentEvent] is an alias for it rather than a copy.
///
/// ── Absence, which is the part that gets misread ───────────────────────────
///
/// [SessionSnapshot.handledBy] is ABSENT — never null, never a placeholder —
/// when nobody is assigned yet or when no display name could be resolved. That
/// absence is presentation-only: it means "render your own configured title",
/// NOT "nobody is handling this chat". `status` and `mode` already carry that
/// signal, and a host that reads absence as unhandled will show "no agent" for
/// every queued session on the platform.
class HandledBy {
  const HandledBy({
    required this.kind,
    required this.id,
    required this.displayName,
  });

  factory HandledBy.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) =>
      HandledBy(
        kind: requireEnum(
          json,
          'kind',
          path,
          HandledByKind.fromWire,
          'HandledByKind',
          frameType: frameType,
        ),
        id: requireNonEmptyString(json, 'id', path, frameType: frameType),
        // REQUIRED here, unlike the `agentName?` this shape replaced and
        // unlike [ParticipantSnapshot.displayName]. A HandledBy exists to be
        // rendered; one without a name is not a degraded HandledBy, it is a
        // frame the server should not have sent. requireNonEmptyString already
        // refuses `null` and `""` along with every other non-string.
        displayName: requireNonEmptyString(
          json,
          'displayName',
          path,
          frameType: frameType,
        ),
      );

  /// `'AGENT'` or `'BOT'` on the wire — always the string, never the
  /// backend's integer (D4). [HandledByKind] is a string-valued enum for
  /// exactly that reason; nothing reads its `index`.
  ///
  /// [HandledByKind.bot] is not an edge case: the bot resuming a session after
  /// a human agent leaves arrives as an `agent.joined` with `kind: 'BOT'`.
  final HandledByKind kind;

  /// Same id space as [ParticipantSnapshot.participantId].
  final String id;

  final String displayName;
}

/// `agent.joined.d` / `agent.left.d` (§7.3).
///
/// ── BREAKING, v2 wire contract ────────────────────────────────────────────
///
/// This was `{ agentId: String, agentName: String? }` and is now [HandledBy]
/// outright — a replacement, not an extension. Two things make that safe and
/// make leniency wrong: these frames were declared in the catalog but were
/// never actually emitted on the wire until now, so there is no live traffic
/// in the old shape to protect; and coercing an `agentId` into an `id` would
/// be §12.2's normalize-and-guess mistake rebuilt in a new place. The old
/// payload is refused like any other malformed frame.
typedef AgentEvent = HandledBy;

/// One participant in a session snapshot (§9.5).
class ParticipantSnapshot {
  const ParticipantSnapshot({
    required this.participantId,
    required this.type,
    this.lastReadAt,
    this.displayName,
  });

  factory ParticipantSnapshot.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) =>
      ParticipantSnapshot(
        participantId: requireNonEmptyString(
          json,
          'participantId',
          path,
          frameType: frameType,
        ),
        type: requireEnum(
          json,
          'type',
          path,
          ParticipantType.fromWire,
          'ParticipantType',
          frameType: frameType,
        ),
        lastReadAt: optionalIsoTimestamp(json, 'lastReadAt', path,
            frameType: frameType),
        displayName: optionalNonEmptyString(
          json,
          'displayName',
          path,
          frameType: frameType,
        ),
      );

  final String participantId;
  final ParticipantType type;

  /// The read watermark (§9.5). Absent means this participant has read
  /// nothing yet — which is NOT the same as having read at the epoch.
  final DateTime? lastReadAt;

  /// Resolved through the SAME chain as [SessionSnapshot.handledBy] — an
  /// agent-name lookup for an AGENT row, the tenant bot-name resolver for a
  /// BOT row.
  ///
  /// Absent — never `null`, never `""` — when no display name has been
  /// resolved, which is the common case for CUSTOMER rows today. Optional
  /// here and required on [HandledBy]: a participant row is a membership
  /// record that happens to sometimes carry a name, whereas a HandledBy is
  /// nothing BUT a name and an identity. [optionalNonEmptyString] is what
  /// keeps `null` and `""` from reaching a UI as a name.
  final String? displayName;
}

/// The authoritative session snapshot (§9.4).
///
/// §9.4 requires this to overwrite local session state WHOLESALE, never merged
/// field by field against a possibly-stale local copy.
class SessionSnapshot {
  const SessionSnapshot({
    required this.sessionId,
    required this.status,
    required this.mode,
    required this.participants,
    required this.createdAt,
    this.ticketId,
    this.handledBy,
  });

  factory SessionSnapshot.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) {
    final Object? rawParticipants = json['participants'];
    if (rawParticipants is! List<Object?>) {
      throw FrameDecodeException(
        '$path.participants',
        'must be an array',
        frameType: frameType,
      );
    }
    return SessionSnapshot(
      sessionId:
          requireNonEmptyString(json, 'sessionId', path, frameType: frameType),
      status: requireEnum(
        json,
        'status',
        path,
        ChatStatus.fromWire,
        'ChatStatus',
        frameType: frameType,
      ),
      mode: requireEnum(
        json,
        'mode',
        path,
        ChatMode.fromWire,
        'ChatMode',
        frameType: frameType,
      ),
      participants: <ParticipantSnapshot>[
        for (int i = 0; i < rawParticipants.length; i++)
          ParticipantSnapshot.fromJson(
            requireObject(
              rawParticipants[i],
              '$path.participants[$i]',
              frameType: frameType,
            ),
            '$path.participants[$i]',
            frameType: frameType,
          ),
      ],
      createdAt:
          requireIsoTimestamp(json, 'createdAt', path, frameType: frameType),
      ticketId: optionalString(json, 'ticketId', path, frameType: frameType),
      // Additive: a server that predates the identity contract sends no
      // `handledBy` at all and still produces a valid snapshot, so an old
      // server cannot break a new client's handshake. `containsKey` rather
      // than a null check, because an explicit null is a claim the server
      // never makes and is refused by requireObject below.
      handledBy: json.containsKey('handledBy')
          ? HandledBy.fromJson(
              requireObject(
                json['handledBy'],
                '$path.handledBy',
                frameType: frameType,
              ),
              '$path.handledBy',
              frameType: frameType,
            )
          : null,
    );
  }

  final String sessionId;
  final ChatStatus status;
  final ChatMode mode;
  final List<ParticipantSnapshot> participants;

  /// ISO-8601 on the wire (§7.2's payload rules), unlike the envelope's `ts`.
  final DateTime createdAt;
  final String? ticketId;

  /// Who the customer is currently talking to. See [HandledBy] — in
  /// particular, absence here is a presentation signal ("render your own
  /// title"), never evidence that the session is unhandled.
  final HandledBy? handledBy;
}

/// A message (`message.new.d`, and every entry of a replay array).
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.sessionId,
    required this.senderId,
    required this.senderType,
    required this.type,
    required this.content,
    required this.seq,
    required this.createdAt,
    this.replyToMessageId,
    this.attachment,
    this.metadata,
    this.delivery = MessageDelivery.confirmed,
  });

  factory ChatMessage.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) {
    final Object? rawAttachment = json['attachment'];
    final Object? rawMetadata = json['metadata'];
    return ChatMessage(
      id: requireNonEmptyString(json, 'id', path, frameType: frameType),
      sessionId:
          requireNonEmptyString(json, 'sessionId', path, frameType: frameType),
      senderId:
          requireNonEmptyString(json, 'senderId', path, frameType: frameType),
      senderType: requireEnum(
        json,
        'senderType',
        path,
        SenderType.fromWire,
        'SenderType',
        frameType: frameType,
      ),
      type: requireEnum(
        json,
        'type',
        path,
        MessageType.fromWire,
        'MessageType',
        frameType: frameType,
      ),
      content: requireString(json, 'content', path, frameType: frameType),
      seq: requireSeq(json, 'seq', path, frameType: frameType),
      createdAt:
          requireIsoTimestamp(json, 'createdAt', path, frameType: frameType),
      replyToMessageId:
          optionalString(json, 'replyToMessageId', path, frameType: frameType),
      attachment: rawAttachment == null
          ? null
          : AttachmentMetadata.fromJson(
              requireObject(
                rawAttachment,
                '$path.attachment',
                frameType: frameType,
              ),
              '$path.attachment',
              frameType: frameType,
            ),
      metadata: rawMetadata == null
          ? null
          : requireObject(rawMetadata, '$path.metadata', frameType: frameType),
    );
  }

  /// The permanent message id (D1). For a message this client sent, this is
  /// the ULID it generated — there is no id-swap path anywhere.
  final String id;

  final String sessionId;
  final String senderId;
  final SenderType senderType;
  final MessageType type;
  final String content;

  /// The ordering key (D2). Order by this. NEVER by [createdAt] and never by
  /// the envelope's `ts`.
  ///
  /// Null ONLY for an optimistic local echo that has not been acknowledged
  /// yet — the server allocates `seq`, so a client cannot know it before the
  /// ack. §6.4's own amendment says the same: "`seq` is absent both for a
  /// message still in flight and for one the queue has permanently given up
  /// on". [delivery] is what separates those two.
  final int? seq;

  /// ISO-8601 on the wire. Informational — display it, do not sort on it.
  final DateTime createdAt;

  final String? replyToMessageId;

  /// Top-level, never under [metadata] — one canonical location (D4).
  final AttachmentMetadata? attachment;

  final Map<String, Object?>? metadata;

  /// Whether this message has reached the server (§6.4's amendment).
  final MessageDelivery delivery;

  /// A copy with [seq] and [delivery] replaced, for the ack path.
  ///
  /// The id is NOT a parameter and cannot change: under D1 a message's
  /// identity is fixed at creation and there is no id-swap path (§9.3).
  ChatMessage settled({required int seq}) => ChatMessage(
        id: id,
        sessionId: sessionId,
        senderId: senderId,
        senderType: senderType,
        type: type,
        content: content,
        seq: seq,
        createdAt: createdAt,
        replyToMessageId: replyToMessageId,
        attachment: attachment,
        metadata: metadata,
        delivery: MessageDelivery.confirmed,
      );

  /// A copy marked failed.
  ChatMessage failed() => ChatMessage(
        id: id,
        sessionId: sessionId,
        senderId: senderId,
        senderType: senderType,
        type: type,
        content: content,
        seq: seq,
        createdAt: createdAt,
        replyToMessageId: replyToMessageId,
        attachment: attachment,
        metadata: metadata,
        delivery: MessageDelivery.failed,
      );
}

/// Whether a message has reached the server.
///
/// §6.4's amendment made this a union so "a reason cannot exist without a
/// failure". This pass has one failure reason — the socket was not connected —
/// because the durable offline queue that would produce the others is out of
/// scope. When that queue lands, [failed] gains a reason and this becomes the
/// union the PRD describes.
enum MessageDelivery {
  /// Sent optimistically; no `ack` yet. [ChatMessage.seq] is null.
  pending,

  /// Acknowledged by the server, or received from it. [ChatMessage.seq] is set.
  confirmed,

  /// Could not be handed to the transport. NOT retried — §8.4 requires a
  /// durable queue for that and this pass does not have one.
  failed,
}

/// A presence entry (`presence.update.d`).
class PresenceEntry {
  const PresenceEntry({
    required this.participantId,
    required this.status,
    this.lastSeen,
  });

  factory PresenceEntry.fromJson(
    Map<String, Object?> json,
    String path, {
    String? frameType,
  }) =>
      PresenceEntry(
        participantId: requireNonEmptyString(
          json,
          'participantId',
          path,
          frameType: frameType,
        ),
        status: requireEnum(
          json,
          'status',
          path,
          PresenceStatus.fromWire,
          'PresenceStatus',
          frameType: frameType,
        ),
        lastSeen:
            optionalIsoTimestamp(json, 'lastSeen', path, frameType: frameType),
      );

  final String participantId;
  final PresenceStatus status;

  /// Absent while the participant is currently online.
  final DateTime? lastSeen;
}

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

/// `connection.ack.d` (§7.3, §8.3, D2).
class ConnectionAck {
  const ConnectionAck({
    required this.protocolVersion,
    required this.session,
    required this.seq,
    required this.replay,
  });

  factory ConnectionAck.fromJson(Map<String, Object?> d) {
    const String frameType = 'connection.ack';
    final Object? rawReplay = d['replay'];

    final List<ServerFrame> replay;
    if (rawReplay == null) {
      // Absent, not empty. The server sends NO `replay` key on a fresh
      // connect, when the client is already current, AND when it is too far
      // behind to inline (D2's over-cap path) — three quite different
      // situations that look identical here. Only `seq` separates them, which
      // is why the gap check in resume/ lives on `seq` and not on this list.
      //
      // Undocumented fourth case: the server also omits `replay` when its own
      // read or projection failed. The ack still carries a truthful `seq`, so
      // it degrades into the same gap.
      replay = const <ServerFrame>[];
    } else if (rawReplay is List<Object?>) {
      replay = <ServerFrame>[
        for (final Object? entry in rawReplay) decodeServerFrameJson(entry),
      ];
    } else {
      throw const FrameDecodeException(
        'd.replay',
        'must be an array of frames',
        frameType: frameType,
      );
    }

    return ConnectionAck(
      protocolVersion:
          requireInt(d, 'protocolVersion', 'd', frameType: frameType),
      session: SessionSnapshot.fromJson(
        requireObject(d['session'], 'd.session', frameType: frameType),
        'd.session',
        frameType: frameType,
      ),
      seq: requireSeq(d, 'seq', 'd', frameType: frameType),
      replay: replay,
    );
  }

  /// The negotiated version, `min(client max, server max)` (§7.5).
  final int protocolVersion;

  /// Authoritative session state. Overwrite local state wholesale (§9.4).
  final SessionSnapshot session;

  /// The `seq` this ack is current as of — the client's new resume anchor.
  ///
  /// Not named anywhere in the PRD. Resume is not implementable without it.
  final int seq;

  /// Frames missed while disconnected, replayed inline (D2).
  ///
  /// In practice every entry is a `message.new`; the server builds this list
  /// from message rows only. Empty means either nothing was missed or the
  /// server declined to inline — [seq] is what tells those apart.
  final List<ServerFrame> replay;
}

/// `session.closed.d` (§7.3, §12.5).
class SessionClosed {
  const SessionClosed({required this.sessionId, required this.closeReason});

  factory SessionClosed.fromJson(Map<String, Object?> d) => SessionClosed(
        sessionId: requireNonEmptyString(
          d,
          'sessionId',
          'd',
          frameType: 'session.closed',
        ),
        closeReason: requireEnum(
          d,
          'closeReason',
          'd',
          CloseReason.fromWire,
          'CloseReason',
          frameType: 'session.closed',
        ),
      );

  final String sessionId;

  /// [CloseReason.switched] means "parked because the customer moved to
  /// another chat", not "ended" (§12.5).
  final CloseReason closeReason;
}

/// `message.read.d` (§7.3, §9.5).
class MessageRead {
  const MessageRead({required this.participantId, required this.readAt});

  factory MessageRead.fromJson(Map<String, Object?> d) => MessageRead(
        participantId: requireNonEmptyString(
          d,
          'participantId',
          'd',
          frameType: 'message.read',
        ),
        readAt: requireIsoTimestamp(
          d,
          'readAt',
          'd',
          frameType: 'message.read',
        ),
      );

  final String participantId;

  /// The read watermark, ISO-8601 (§9.5).
  final DateTime readAt;
}

/// `ticket.linked.d` (§7.3).
class TicketLinked {
  const TicketLinked({required this.ticketId, this.ticketUrl});

  factory TicketLinked.fromJson(Map<String, Object?> d) => TicketLinked(
        ticketId: requireNonEmptyString(
          d,
          'ticketId',
          'd',
          frameType: 'ticket.linked',
        ),
        ticketUrl:
            optionalString(d, 'ticketUrl', 'd', frameType: 'ticket.linked'),
      );

  final String ticketId;
  final String? ticketUrl;
}
