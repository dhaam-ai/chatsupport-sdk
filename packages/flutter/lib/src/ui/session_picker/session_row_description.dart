/// The ONE spoken account of a session row — the port of
/// `ui/session-picker.ts`'s `describeRow`.
///
/// ── Composed from the summary, never from the rendered strings ──────────
///
/// Every fragment below is read off a [ChatSessionSummary] field, not off a
/// `Text` widget's contents. That split is deliberate and is the whole
/// reason this is a function rather than a `Semantics(label:)` assembled
/// inline next to the widgets it describes:
///
///   * the visible row abbreviates ("3 unread"), the spoken one does not
///     ("3 unread messages") — a badge reading "3" beside a status is
///     obvious to look at and meaningless to hear;
///   * the visible row can drop a fragment for width (an ellipsised
///     preview) without the spoken one losing the fact;
///   * a later restyle that changes wording on screen cannot silently
///     change what a screen reader is told, because it never reads the
///     screen.
///
/// So the two accounts may differ in WORDING and must never differ in
/// FACTS. `message_list`'s tick glyph vs its announced text is the same
/// split, made for the same reason.
///
/// ── The vocabulary is `session_display.dart`'s, not a second copy ───────
///
/// [chatStatusLabel], [handledByText] and [relativeTimeLabel] all come from
/// there. This file states no status word and no "with X" phrasing of its
/// own: a status that reads "With an agent" in the Messages list and
/// "Assigned" in the picker's spoken name is exactly the two-tables drift
/// that file's own header records having already been fixed once.
library;

import '../../session/chat_session_summary.dart';
import '../../session/session_display.dart';

/// One row's accessible name — "With an agent, current conversation, 2 hours
/// ago, with Ada, Where is my order?, 3 unread messages".
///
/// [isCurrent] is passed in rather than derived here: whether a row is the
/// conversation the customer is presently in is a fact about the picker's
/// input, and the switcher and the pre-chat screen answer it differently
/// (the screen passes `null` for the current id and so never marks a row).
///
/// [now] is a parameter for the same reason [relativeTimeLabel] takes one —
/// it keeps this a pure function a table test can assert exactly, with no
/// ambient clock read buried inside it.
String describeSessionRow(
  ChatSessionSummary summary, {
  required bool isCurrent,
  DateTime? now,
}) {
  final List<String> parts = <String>[chatStatusLabel(summary.status)];

  if (isCurrent) parts.add('current conversation');

  // The TypeScript original guards this fragment with `relative !== ''`,
  // because there it is `relativeTimeLabel(iso)` over a STRING that may not
  // parse. Here the argument is `DateTime?` and the fallback chain makes it
  // non-null, so `relativeTimeLabel` cannot answer `''` — the guard would be
  // unreachable, and an unreachable guard reads as a case that can happen.
  final DateTime when = summary.lastMessageAt ?? summary.createdAt;
  parts.add(relativeTimeLabel(when, now: now));

  final String handled = handledByText(summary.handledBy);
  if (handled.isNotEmpty) parts.add(handled);

  final String? preview = summary.lastMessagePreview;
  if (preview != null && preview.isNotEmpty) parts.add(preview);

  if (summary.unreadCount > 0) {
    final String noun = summary.unreadCount == 1 ? 'message' : 'messages';
    parts.add('${summary.unreadCount} unread $noun');
  }

  return parts.join(', ');
}
