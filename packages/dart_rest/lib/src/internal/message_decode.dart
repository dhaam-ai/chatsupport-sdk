/// Raw Prisma message rows → `dhaam_chat`'s `ChatMessage`.
///
/// ── Why this file exists ──────────────────────────────────────────────────
///
/// chat-service is internally consistent, but its two paths are not the same
/// shape. The WebSocket path emits PROJECTED payloads: string enum names,
/// attachments lifted to the top level, `chatSessionId` renamed `sessionId`
/// (`api/websocket/v2/projection.ts`). The REST path emits RAW ROWS —
/// `message.service.ts:285-296` hands Prisma's output straight to the route,
/// which sends it as-is.
///
/// `dhaam_chat`'s `ChatMessage` is the projected shape, because that is what
/// the socket delivers all day. So the REST path has to be projected too, and
/// this is where that happens. Three things occur here that the REST service
/// does not do for itself, each matching what `projectMessage` does for the
/// socket:
///
///  1. Integer enums are decoded (`senderType`, `messageType`).
///  2. Fields are renamed: `chatSessionId` → `sessionId`, `messageType` →
///     `type`.
///  3. An attachment stored in the legacy `metadata` column is lifted to the
///     top level and stripped from the metadata that survives.
///
/// Fields `ChatMessage` does not model are dropped rather than passed along —
/// notably `replyToMessage`, the nested copy of the parent message the row
/// carries next to `replyToMessageId`.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show AttachmentMetadata, ChatMessage, MessageType, SenderType;

import '../errors.dart';
import 'attachment_safety.dart';
import 'json_reading.dart';

// ── Integer enum tables ────────────────────────────────────────────────────
//
// Mirrored EXACTLY from chat-service-node's `shared/constants/enums.ts`, which
// states the org-wide rule these tables encode: enums are stored in the DB and
// transmitted over APIs/WS as INTEGERS, 1-based and append-only, never
// renumbered and never reused. The WS path converts them via `toSenderType` /
// `toMessageType`; the REST path never did, which is why history arrived with
// `senderType: 1` where the projected shape needs `SenderType.customer`.
//
// Note this is the ONE place in either Dart package that reads the integer
// form at all. `dhaam_chat`'s own `enums.dart` deliberately parses only the
// string names and says so: "The INTEGER values in §12.1 are the backend's
// internal representation and never appear on this endpoint (D4)." That
// remains true of the WebSocket. It is not true of this one, which is the
// whole reason these tables live here and not there.

/// `SenderType` — enums.ts:29-34.
const Map<int, SenderType> _senderTypeByInt = <int, SenderType>{
  1: SenderType.customer,
  2: SenderType.agent,
  3: SenderType.bot,
  4: SenderType.system,
};

/// `MessageType` — enums.ts:36-44.
const Map<int, MessageType> _messageTypeByInt = <int, MessageType>{
  1: MessageType.text,
  2: MessageType.system,
  3: MessageType.file,
  4: MessageType.image,
  5: MessageType.video,
  6: MessageType.audio,
  7: MessageType.typing,
};

// ── Metadata ───────────────────────────────────────────────────────────────

/// The one key never copied into the metadata bag this package publishes.
///
/// `attachment` has exactly one canonical home and that is the top-level field
/// (D4). v1 read `message.attachment` and `message.metadata.attachment`
/// interchangeably (§12.2/§12.10) and that ambiguity is what D4 removed.
///
/// ── The three JS-specific keys are deliberately NOT here ──────────────────
///
/// `projection.ts` also strips `__proto__`, `constructor` and `prototype`,
/// defending against a JavaScript-specific fact: `JSON.parse` makes
/// `__proto__` an OWN property of the resulting object — unlike an object
/// literal, where the same key sets the prototype — so a polluted `metadata`
/// bag can detach the prototype of anything a host app later `Object.assign`s
/// or deep-merges it onto.
///
/// `jsonDecode` in `dart:convert` produces a plain `Map<String, Object?>`: a
/// real hash map, with no prototype chain to detach. There is no vulnerability
/// class here for a Dart port to close, so those three names are not carried
/// forward and a key called `__proto__` survives as ordinary application data,
/// which on this runtime is all it is. Stated explicitly, and asserted by
/// test, because "the Dart port does not defend against X" should be a
/// decision on record rather than an accident (contract §5.8).
const String _attachmentKey = 'attachment';

/// The marker a placeholder carries so a binding can render an "unsupported
/// message" notice.
///
/// It travels in `metadata` because that is the only field on `ChatMessage`
/// meant to carry data the SDK does not interpret, and adding an SDK-level
/// field to that shape would change a type `dhaam_chat` owns. No collision
/// with a host application's own metadata is possible: a placeholder discards
/// the row's metadata entirely — a row that cannot be decoded is not a row
/// whose other fields are worth trusting.
const String kUnsupportedMessageMarker = 'unsupportedMessage';

// ── Decoding ───────────────────────────────────────────────────────────────

/// One row from `GET /chat/sessions/{id}/messages` → a [ChatMessage].
///
/// Throws [RestMalformedResponseException] on a row this package cannot
/// decode. Callers paginating a page want [projectHistoryRow] instead, which
/// contains the blast radius to the single row.
ChatMessage decodeChatMessage(Object? row, String context) {
  final Map<String, Object?> source =
      requireObject(row, 'a message row', context: context);

  final (AttachmentMetadata?, Map<String, Object?>?) lifted =
      _liftAttachment(source['metadata']);
  final Object? rawContent = source['content'];

  return ChatMessage(
    id: requireNonEmptyString(source, 'id', 'message', context: context),
    // Rename: the row keys this `chatSessionId`, the projected shape calls it
    // `sessionId`.
    sessionId: requireNonEmptyString(
      source,
      'chatSessionId',
      'message',
      context: context,
    ),
    // Nullable on the row — a SYSTEM message has no sender — but required by
    // `ChatMessage`. An empty string is what the WS projection substitutes
    // (`projection.ts:204`), so this matches rather than inventing a second
    // answer.
    senderId: optionalString(source, 'senderId') ?? '',
    senderType: requireIntEnum(
      _senderTypeByInt,
      source,
      'senderType',
      'message',
      context: context,
    ),
    // Rename: the row keys this `messageType`.
    type: requireIntEnum(
      _messageTypeByInt,
      source,
      'messageType',
      'message',
      context: context,
    ),
    // A non-string `content` becomes `''` rather than throwing, matching TS.
    // `ChatMessage.content` is non-nullable and a SYSTEM row can legitimately
    // carry none.
    content: rawContent is String ? rawContent : '',
    // `seq` is required by the WS schema and that path throws without it, but
    // `ChatMessage.seq` is nullable and rows predating sequencing legitimately
    // have none. Failing a whole page of history over one legacy row would be
    // a worse outcome than that row arriving unordered.
    seq: optionalIntValue(source['seq']),
    createdAt:
        requireTimestamp(source, 'createdAt', 'message', context: context),
    replyToMessageId: optionalString(source, 'replyToMessageId'),
    attachment: lifted.$1,
    metadata: lifted.$2,
  );
}

/// Splits a row's raw `metadata` into a lifted attachment and the bag that
/// survives.
///
/// The database keeps attachments inside the legacy `metadata` column; the
/// projected shape carries them top-level (D4: one canonical location). Lift
/// and strip, so an attachment never appears in both places — the exact
/// ambiguity v1 clients had to defend against.
(AttachmentMetadata?, Map<String, Object?>?) _liftAttachment(Object? metadata) {
  // A column declared `Json?` places no constraint narrower than "valid JSON"
  // on what a row can hold, and a value written by something other than this
  // service's own write path — a migration, a direct DB fixup — could leave a
  // scalar or an array there. That must degrade to no attachment and no
  // metadata rather than throw: one malformed legacy row failing an entire
  // history page is a worse outcome than it losing its own metadata.
  if (metadata is! Map<String, Object?>) return (null, null);

  final AttachmentMetadata? attachment =
      readAttachmentMetadata(metadata[_attachmentKey]);

  final Map<String, Object?> rest = <String, Object?>{
    for (final MapEntry<String, Object?> entry in metadata.entries)
      if (entry.key != _attachmentKey) entry.key: entry.value,
  };

  // A bag that held nothing but the attachment comes back absent, not as an
  // empty map — an empty map would be a second, contradictory answer to "is
  // there metadata?", which is the ambiguity D4 exists to remove.
  return (attachment, rest.isEmpty ? null : rest);
}

/// One history row → a message, a placeholder, or nothing.
///
/// ── Why a bad row must not fail the page ──────────────────────────────────
///
/// [decodeChatMessage] throws on an enum it cannot decode, and appending new
/// enum values is documented as routine. Mapping a page with
/// `rows.map(decodeChatMessage)` would therefore turn ONE newer-typed message
/// into ZERO history for that customer — the same user-facing outcome as the
/// empty-page bug this whole layer exists to fix. The backend's own socket
/// path already scopes the blast radius this way: a projection failure drops
/// one push, not a conversation.
///
/// ── What a placeholder does and does not claim ────────────────────────────
///
/// It is attributed to `SYSTEM`, never to a participant. Refusing to guess a
/// sender is the entire reason [decodeChatMessage] throws; a placeholder that
/// named an author would reintroduce exactly the misattribution being avoided.
/// `SYSTEM` claims no person, and bindings already render it as a notice
/// rather than as somebody's bubble. When only the message TYPE failed to
/// decode this understates a known sender, which is the safe direction to be
/// wrong in.
///
/// `content` is dropped rather than passed through: an unrecognized message
/// type is precisely the case where the content field may hold something not
/// meant to be read as prose, and rendering a future card format's payload as
/// raw text is a worse answer than rendering a notice.
///
/// Returns `null` when not even a placeholder can be built — without a stable
/// id there is nothing for a list to key on, and without a timestamp nothing
/// to order it by.
ChatMessage? projectHistoryRow(Object? row, String context) {
  try {
    return decodeChatMessage(row, context);
  } on RestMalformedResponseException {
    // Only this package's own verdict is recoverable. Anything else — a bug in
    // this file — must not be quietly turned into a placeholder, so it is
    // deliberately not caught.
  }

  if (row is! Map<String, Object?>) return null;

  final String? id = optionalStringValue(row['id']);
  final String? sessionId = optionalStringValue(row['chatSessionId']);
  final DateTime? createdAt = readTimestamp(row['createdAt']);
  if (id == null || sessionId == null || createdAt == null) return null;

  return ChatMessage(
    id: id,
    sessionId: sessionId,
    senderId: '',
    senderType: SenderType.system,
    type: MessageType.system,
    content: '',
    // Kept when present so the placeholder still orders and de-duplicates
    // against the live socket stream like any other message.
    seq: optionalIntValue(row['seq']),
    createdAt: createdAt,
    metadata: <String, Object?>{kUnsupportedMessageMarker: true},
  );
}
