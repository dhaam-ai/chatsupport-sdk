/// Turning a [ChatSessionSummary] into what a row actually shows — mirrors
/// `ui/session-status.ts`'s status vocabulary and `ui/session-picker.ts`'s
/// relative-time formatting, so a status string or a "2 hours ago" label is
/// spelled the same way wherever it appears, on either binding.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatStatus, HandledBy;

import 'chat_session_summary.dart';

/// The two wordings one status has: spelled out for a list row, short for
/// Home's inline pill. Mirrors `ui/session-status.ts`'s `SessionStatusWords`.
typedef SessionStatusWords = ({String label, String pill});

/// The ONE status vocabulary this binding speaks — every status, both
/// wordings.
///
/// ── Why one function and not two tables ──────────────────────────────────
///
/// The Messages list and Home's "Recent conversation" row used to read two
/// separate maps: a six-entry [Map] of labels, and a three-entry pill map
/// that named only RESOLVED, CLOSED and WAITING_FOR_AGENT. A status missing
/// from the second rendered NO PILL AT ALL, so the conversation a customer is
/// most likely to be in the middle of — OPEN, ASSIGNED, ON_HOLD — was the one
/// row that refused to say where it stood, while the same conversation on the
/// Messages screen said so plainly. One conversation reading two ways on two
/// screens is what a second copy of a mapping always produces.
///
/// A `switch` expression rather than a `Map`, because the analyzer checks it
/// for exhaustiveness over [ChatStatus]: a seventh wire status is a compile
/// error here rather than a blank pill in front of a customer. That is the
/// same totality `session-status.ts` gets from `Record<ChatStatus, …>`.
///
/// ── Why ASSIGNED is not called "Assigned" ────────────────────────────────
///
/// "Assigned" answers "which agent owns this row" — a routing fact about the
/// queue, not a question the customer asked. What it MEANS to them is that a
/// person now has it, so it reads "With an agent": the same information,
/// phrased as the thing they can act on. Kept identical to the web widget's
/// wording, deliberately — a merchant supporting both should not have to
/// learn two vocabularies for one status.
SessionStatusWords sessionStatusWords(ChatStatus status) => switch (status) {
      ChatStatus.open => (label: 'Open', pill: 'Open'),
      ChatStatus.waitingForAgent => (
          label: 'Waiting for an agent',
          pill: 'Waiting'
        ),
      ChatStatus.assigned => (label: 'With an agent', pill: 'With an agent'),
      ChatStatus.onHold => (label: 'On hold', pill: 'On hold'),
      ChatStatus.resolved => (label: 'Resolved', pill: 'Resolved'),
      ChatStatus.closed => (label: 'Closed', pill: 'Closed'),
    };

/// The spelled-out status for a Messages row. Mirrors `statusLabel`.
String chatStatusLabel(ChatStatus status) => sessionStatusWords(status).label;

/// The same status, short enough for Home's inline pill. Mirrors
/// `statusPill` — and, unlike the map it replaces, it always answers, so
/// every recent conversation carries a pill.
String homeStatusPill(ChatStatus status) => sessionStatusWords(status).pill;

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
