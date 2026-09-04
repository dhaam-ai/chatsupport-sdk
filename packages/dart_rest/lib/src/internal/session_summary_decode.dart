/// `GET /chat/sessions/customer` rows → [RestChatSessionSummary].
///
/// The third decoder in this package, and the only one whose route already
/// speaks v2's projected vocabulary. There is no int → string table here, only
/// membership: `status` and `mode` arrive as the canonical names, so
/// [requireStringEnum] is the reader and `ChatStatus.fromWire` is the parse.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMode, ChatStatus, HandledBy, HandledByKind;

import '../errors.dart';
import '../models/session_summary.dart';
import 'json_reading.dart';

/// One item from `sessions[]` → a summary.
///
/// Throws [RestMalformedResponseException] on an unmappable `status`/`mode` or
/// a missing/negative `unreadCount`. See [projectSessionSummaryRow] for the
/// page-level caller that absorbs exactly that.
RestChatSessionSummary decodeRestChatSessionSummary(
  Object? row,
  String context,
) {
  final Map<String, Object?> source =
      requireObject(row, 'a session summary row', context: context);

  return RestChatSessionSummary(
    id: requireNonEmptyString(source, 'id', 'summary', context: context),
    status: requireStringEnum(
      ChatStatus.fromWire,
      source,
      'status',
      'summary',
      context: context,
    ),
    mode: requireStringEnum(
      ChatMode.fromWire,
      source,
      'mode',
      'summary',
      context: context,
    ),
    createdAt:
        requireTimestamp(source, 'createdAt', 'summary', context: context),
    // `null` is a valid, documented value on both of these — "still open" and
    // "no public message yet" — not a parse failure.
    closedAt: optionalTimestamp(source, 'closedAt'),
    lastMessageAt: optionalTimestamp(source, 'lastMessageAt'),
    // Absent — never `''`. An empty string is treated exactly as the field
    // never having been sent, the same rule `message_decode.dart` applies to
    // `replyToMessageId`.
    lastMessagePreview: optionalString(source, 'lastMessagePreview'),
    unreadCount: requireNonNegativeInt(
      source,
      'unreadCount',
      'summary',
      context: context,
    ),
    subject: optionalString(source, 'subject'),
    topic: optionalString(source, 'topic'),
    handledBy: _readHandledBy(source['handledBy']),
  );
}

/// One `handledBy` object → a [HandledBy], or `null`.
///
/// ── Why this is tolerant where `status`/`mode` are strict ─────────────────
///
/// `handledBy` is additive information the picker does not depend on, so a row
/// carrying a bad one should not lose the rest of an otherwise-good session
/// summary over it. `status` and `mode` DO throw, because a picker's own
/// render logic reads them.
///
/// ── Why this does not call `HandledBy.fromJson` ───────────────────────────
///
/// `dhaam_chat`'s own factory throws `FrameDecodeException` on anything
/// malformed — correct on the socket, where §14 makes every bad frame a
/// protocol violation worth surfacing, and wrong here, where the whole point
/// is to degrade quietly. The TYPE is reused; the strictness that belongs to
/// the other transport is not.
///
/// `HandledByKind` refuses `'CUSTOMER'` on its own: a customer is who a
/// session is FOR, never who handles it. That falls out of reusing the enum
/// rather than needing to be restated here.
HandledBy? _readHandledBy(Object? value) {
  if (value is! Map<String, Object?>) return null;

  final Object? rawKind = value['kind'];
  final HandledByKind? kind =
      rawKind is String ? HandledByKind.fromWire(rawKind) : null;
  if (kind == null) return null;

  final String? id = optionalStringValue(value['id']);
  final String? displayName = optionalStringValue(value['displayName']);
  if (id == null || displayName == null) return null;

  return HandledBy(kind: kind, id: id, displayName: displayName);
}

/// One session-summary row → a summary, or nothing.
///
/// Mirrors [projectHistoryRow]'s reasoning: [decodeRestChatSessionSummary]
/// throws on an unrecognized `status`/`mode`, and letting that propagate out
/// of a `map` would turn one forward-incompatible row into an EMPTY PICKER for
/// the whole customer — the same class of silent-emptiness bug the history
/// adapter already had to fix once.
///
/// Unlike a message, a session summary has no sensible placeholder to show in
/// its place: there is no "unsupported session" row a picker could render, and
/// one that showed a session with no status and no name would be a row a
/// customer taps and nothing happens. So a bad row is simply OMITTED rather
/// than replaced — the one place this package's two page-level projectors
/// deliberately differ.
RestChatSessionSummary? projectSessionSummaryRow(Object? row, String context) {
  try {
    return decodeRestChatSessionSummary(row, context);
  } on RestMalformedResponseException {
    // Only this package's own verdict is recoverable; anything else is a bug
    // in this file and is deliberately not caught.
    return null;
  }
}
