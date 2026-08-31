/// Turning a [ChatSessionSummary] into what a row actually shows — mirrors
/// `ui/session-picker.ts`'s status vocabulary and relative-time formatting,
/// and `ui/home-screen.ts`'s smaller status-pill subset, so a status string
/// or a "2 hours ago" label is spelled the same way wherever it appears.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatStatus, HandledBy;

import 'chat_session_summary.dart';

/// The full status vocabulary — every row on the Messages screen shows one
/// of these. Mirrors `session-picker.ts`'s `STATUS_LABEL`.
const Map<ChatStatus, String> chatStatusLabel = <ChatStatus, String>{
  ChatStatus.open: 'Open',
  ChatStatus.waitingForAgent: 'Waiting for an agent',
  ChatStatus.assigned: 'Assigned',
  ChatStatus.closed: 'Closed',
  ChatStatus.resolved: 'Resolved',
  ChatStatus.onHold: 'On hold',
};

/// The pill shown beside the Home screen's "Recent conversation" row.
///
/// A DELIBERATELY smaller vocabulary than [chatStatusLabel] — mirrors
/// `home-screen.ts`'s `STATUS_PILL`. Only the states a customer can act on
/// are named: `ASSIGNED` and `ON_HOLD` are internal routing facts, and a
/// pill reading "Assigned" explains nothing a customer can use — a status
/// with no entry here renders no pill at all, rather than falling back to
/// [chatStatusLabel].
const Map<ChatStatus, String> homeStatusPill = <ChatStatus, String>{
  ChatStatus.resolved: 'Resolved',
  ChatStatus.closed: 'Closed',
  ChatStatus.waitingForAgent: 'Waiting',
};

/// "with Priya" — or '' when nobody has picked the session up yet.
String handledByText(HandledBy? handledBy) =>
    handledBy == null ? '' : 'with ${handledBy.displayName}';

/// (unit, milliseconds) thresholds, largest first — same table
/// `session-picker.ts`'s `RELATIVE_UNITS` uses.
const List<(String, int)> _relativeUnits = <(String, int)>[
  ('year', 365 * 24 * 60 * 60 * 1000),
  ('month', 30 * 24 * 60 * 60 * 1000),
  ('week', 7 * 24 * 60 * 60 * 1000),
  ('day', 24 * 60 * 60 * 1000),
  ('hour', 60 * 60 * 1000),
  ('minute', 60 * 1000),
];

/// A short, human relative time ("2 hours ago"), or `''` for a `null`
/// timestamp — a row renders nothing rather than "null ago".
///
/// [now] is a parameter, not a fresh `DateTime.now()` read buried in the
/// function, purely so this stays a pure function a table test can assert
/// against exactly — same reasoning `session-picker.ts`'s own version gives.
///
/// ── Deliberately simpler than the TypeScript original ──────────────────
///
/// That version formats through `Intl.RelativeTimeFormat` with
/// `numeric: 'auto'`, which produces idiomatic forms ("yesterday", "last
/// week") for the values close to one. Dart's core SDK has no built-in
/// equivalent, and reaching for `package:intl` for one function would be a
/// dependency this package does not otherwise need (see `dhaam_chat`'s own
/// README on why each one has to earn its place here). This always produces
/// the numeric form ("1 day ago" rather than "yesterday") — less idiomatic,
/// but unambiguous and identical across locales.
String relativeTimeLabel(DateTime? timestamp, {DateTime? now}) {
  if (timestamp == null) return '';
  final DateTime reference = now ?? DateTime.now();
  final int diffMs = timestamp.difference(reference).inMilliseconds;
  final int absMs = diffMs.abs();
  if (absMs < 60000) return 'Just now';

  for (final (String unit, int unitMs) in _relativeUnits) {
    if (absMs < unitMs) continue;
    final int count = (absMs / unitMs).round();
    final String plural = count == 1 ? '' : 's';
    return diffMs < 0 ? '$count $unit$plural ago' : 'in $count $unit$plural';
  }
  return 'Just now';
}

/// The Home screen's "Recent conversation" row — whichever [summaries] entry
/// has the latest `lastMessageAt ?? createdAt`, or `null` for an empty list.
///
/// The same fallback [relativeTimeLabel] callers use to DISPLAY a row's time
/// is what picks it here: `lastMessageAt` is absent only for a session with
/// no messages yet, and `createdAt` is the next most recent fact about it —
/// there is no third timestamp on [ChatSessionSummary] this could defer to
/// instead. Host-supplied order is NOT trusted as "already sorted" — the
/// header on [ChatSessionSummary] describes summaries a host fetched from
/// its own backend, which this package has no way to verify sorted the same
/// way, so it decides directly off the data rather than assuming index 0.
ChatSessionSummary? mostRecentSummary(List<ChatSessionSummary> summaries) {
  ChatSessionSummary? best;
  DateTime? bestWhen;
  for (final ChatSessionSummary summary in summaries) {
    final DateTime when = summary.lastMessageAt ?? summary.createdAt;
    if (bestWhen == null || when.isAfter(bestWhen)) {
      best = summary;
      bestWhen = when;
    }
  }
  return best;
}
