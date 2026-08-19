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

/// One participant in a session snapshot (§9.5).
class ParticipantSnapshot {
  const ParticipantSnapshot({
    required this.participantId,
    required this.type,
    this.lastReadAt,
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
        lastReadAt:
            optionalIsoTimestamp(json, 'lastReadAt', path, frameType: frameType),
      );

  final String participantId;
  final ParticipantType type;

  /// The read watermark (§9.5). Absent means this participant has read
  /// nothing yet — which is NOT the same as having read at the epoch.
  final DateTime? lastReadAt;
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
    );
  }

  final String sessionId;
  final ChatStatus status;
  final ChatMode mode;
  final List<ParticipantSnapshot> participants;

  /// ISO-8601 on the wire (§7.2's payload rules), unlike the envelope's `ts`.
  final DateTime createdAt;
  final String? ticketId;
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
  final int seq;

  /// ISO-8601 on the wire. Informational — display it, do not sort on it.
  final DateTime createdAt;

  final String? replyToMessageId;

  /// Top-level, never under [metadata] — one canonical location (D4).
  final AttachmentMetadata? attachment;

  final Map<String, Object?>? metadata;
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

/// `agent.joined.d` / `agent.left.d` (§7.3).
class AgentEvent {
  const AgentEvent({required this.agentId, this.agentName});

  factory AgentEvent.fromJson(Map<String, Object?> d, String frameType) =>
      AgentEvent(
        agentId:
            requireNonEmptyString(d, 'agentId', 'd', frameType: frameType),
        agentName: optionalString(d, 'agentName', 'd', frameType: frameType),
      );

  final String agentId;
  final String? agentName;
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
