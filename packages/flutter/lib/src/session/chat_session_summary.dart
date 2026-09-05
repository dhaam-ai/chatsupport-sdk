/// A past or current conversation, as a host app supplies it for the Home
/// and Messages screens to render — the Dart mirror of core's
/// `ChatSessionSummary` (`packages/core/src/state/types.ts`).
///
/// ── Why this is not sourced from `dhaam_chat` ──────────────────────────
///
/// `dhaam_chat`'s own `SessionSnapshot` is the CONNECTION-level snapshot —
/// `sessionId`, `status`, `mode`, `participants`, `createdAt`, `ticketId`,
/// `handledBy` — everything `connection.ack`/`session.updated` carry, and
/// nothing more, because `dhaam_chat` has no HTTP layer and cannot list
/// sessions (see its README: "A multi-session picker cannot be built on this
/// package"). It has no `lastMessagePreview`, no `unreadCount`, no
/// `closedAt`/`lastMessageAt` — none of what a Messages list or a "Recent
/// conversation" row needs.
///
/// This type is that richer, REST-sourced shape instead. A Flutter host that
/// wants more than the ONE session `dhaam_chat` tracks (whatever
/// `connection.ack` resolves) has to supply the list itself, from its own
/// backend — exactly what `dhaam_chat`'s README recommends for this case
/// ("a host that has its own backend can list sessions there"). This
/// package does not add a REST client to do that itself: it was not in this
/// pass's scope (only the config fetch was — see the SDK plan's §C), and
/// building one now would mean inventing an auth model this package has no
/// other reason to hold (a customer JWT, not the publishable key
/// `fetchRemoteConfig` uses). The Messages and Home screens are built to
/// accept a `List<ChatSessionSummary>` from their caller and degrade
/// gracefully to whatever `dhaam_chat` alone provides — see
/// `state/chat_widget_cubit.dart`.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMode, ChatStatus, HandledBy;

class ChatSessionSummary {
  const ChatSessionSummary({
    required this.id,
    required this.status,
    required this.mode,
    required this.createdAt,
    this.closedAt,
    this.lastMessageAt,
    this.lastMessagePreview,
    this.unreadCount = 0,
    this.handledBy,
    this.subject,
    this.topic,
  });

  final String id;
  final ChatStatus status;
  final ChatMode mode;
  final DateTime createdAt;

  /// `null` while still open.
  final DateTime? closedAt;

  /// `null` if the session has no messages yet.
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final int unreadCount;
  final HandledBy? handledBy;

  /// ── Landing in parallel, treated as optional on purpose ────────────
  ///
  /// `ChatSessionSummary` is gaining `subject`/`topic` on the wire in a
  /// separate, concurrent pass (the SDK plan's §A). Both are nullable HERE
  /// regardless of whether that work has landed yet, and every row this
  /// package renders has to look sensible with both absent — no title is
  /// invented from the first message or anything else when they are null.
  /// A session opened before that field existed, or with no topic chosen,
  /// is the common case, not an edge case.
  final String? subject;
  final String? topic;
}
