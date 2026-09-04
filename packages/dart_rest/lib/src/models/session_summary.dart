/// One entry from `GET /chat/sessions/customer` — what a session picker
/// renders.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMode, ChatStatus, HandledBy;

import '../internal/session_summary_decode.dart';

/// One entry from `GET /chat/sessions/customer`.
///
/// No WebSocket equivalent exists — the session picker is REST-only — so this
/// is unconditionally a new type. But [status], [mode] and [handledBy] all
/// reuse `dhaam_chat`'s own [ChatStatus]/[ChatMode]/[HandledBy]: this route
/// already returns v2's projected STRING enums, and a `handledBy` shape
/// byte-identical to the one `agent.joined`/`agent.left` push over the socket.
/// The same vocabulary and the same type apply on both paths.
///
/// ── This route is NOT the raw-row shape ───────────────────────────────────
///
/// Unlike `/full` and `/messages`, which hand back Prisma output, this one is
/// already projected. So its decoder mainly validates rather than reshapes,
/// and a stray INTEGER `status` arriving here is exactly as unmappable as a
/// bogus string — it would mean the raw-row shape had leaked onto a projected
/// route.
class RestChatSessionSummary {
  const RestChatSessionSummary({
    required this.id,
    required this.status,
    required this.mode,
    required this.createdAt,
    required this.closedAt,
    required this.lastMessageAt,
    this.lastMessagePreview,
    this.unreadCount = 0,
    this.subject,
    this.topic,
    this.handledBy,
  });

  /// Decodes one `sessions[]` item.
  ///
  /// Throws `RestMalformedResponseException` on an unmappable `status`/`mode`
  /// or a missing/negative `unreadCount`. Callers mapping a page want
  /// `projectSessionSummaryRow` instead, which costs one row rather than the
  /// customer's whole picker.
  factory RestChatSessionSummary.fromJson(
    Map<String, Object?> json,
    String context,
  ) =>
      decodeRestChatSessionSummary(json, context);

  final String id;
  final ChatStatus status;
  final ChatMode mode;
  final DateTime createdAt;

  /// `null` while still open.
  final DateTime? closedAt;

  /// `null` if no PUBLIC message has been sent yet — a documented value, not a
  /// parse failure.
  final DateTime? lastMessageAt;

  /// `null` — never `''` — when there is no public message yet. The wire omits
  /// the field; the decoder folds an empty string into the same `null`, the
  /// same rule it applies to [subject] and [topic].
  final String? lastMessagePreview;

  /// Required with a `0` default rather than nullable.
  ///
  /// The wire documents this as "`0`, never absent", so the decoder THROWS on
  /// a missing or negative count rather than defaulting silently: a count that
  /// defaulted would make an unread badge lie in a direction no caller can
  /// detect. The `0` default on this constructor exists only for a caller
  /// building a summary by hand — in a test, or for an empty-state row — and
  /// is never how a decoded value gets here.
  final int unreadCount;

  final String? subject;
  final String? topic;

  /// `null` — never a placeholder — when nobody has picked the session up yet.
  ///
  /// A MALFORMED `handledBy` on the wire is treated the same as an absent one.
  /// This is additive information a picker does not depend on, so a bad
  /// `handledBy` costs itself and not the whole summary — unlike
  /// [status]/[mode], which a picker's own render logic does depend on and
  /// which therefore throw.
  final HandledBy? handledBy;
}
