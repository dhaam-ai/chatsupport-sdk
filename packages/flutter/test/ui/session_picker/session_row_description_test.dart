// Reproduces `session-picker.test.ts`'s accessible-name assertions — the
// `aria-label` half of "renders status, time, preview, handledBy, and
// unreadCount per row", plus the switcher's "current conversation" fragment.
//
// Asserted directly against the function rather than through a pumped
// widget, which is the point of it being a function: the spoken account is
// built from the summary, so it can be checked without a screen at all.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

const HandledBy _ada = HandledBy(
  kind: HandledByKind.agent,
  id: 'agt_1',
  displayName: 'Ada',
);

/// 12:00; every summary below is stamped 09:30, so "2 hours ago" is stable.
final DateTime _now = DateTime.utc(2026, 8, 19, 12);

ChatSessionSummary _summary({
  String id = 's1',
  ChatStatus status = ChatStatus.assigned,
  String? preview = 'Where is my order?',
  HandledBy? handledBy,
  int unreadCount = 0,
  DateTime? lastMessageAt,
}) {
  return ChatSessionSummary(
    id: id,
    status: status,
    mode: ChatMode.human,
    createdAt: DateTime.utc(2026, 8, 19, 9),
    lastMessageAt: lastMessageAt ?? DateTime.utc(2026, 8, 19, 10),
    lastMessagePreview: preview,
    handledBy: handledBy,
    unreadCount: unreadCount,
  );
}

void main() {
  test('names every fact the visible row shows', () {
    final String label = describeSessionRow(
      _summary(handledBy: _ada, unreadCount: 3),
      isCurrent: false,
      now: _now,
    );

    expect(label, contains('With an agent'));
    expect(label, contains('2 hours ago'));
    expect(label, contains('with Ada'));
    expect(label, contains('Where is my order?'));
    // Spelled out, unlike the badge's bare "3 unread": a count beside a
    // status is obvious to look at and meaningless to hear.
    expect(label, contains('3 unread messages'));
  });

  test('singular for one unread, plural for more', () {
    expect(
      describeSessionRow(_summary(unreadCount: 1), isCurrent: false, now: _now),
      contains('1 unread message'),
    );
    expect(
      describeSessionRow(_summary(unreadCount: 2), isCurrent: false, now: _now),
      contains('2 unread messages'),
    );
  });

  test('says which row is the conversation the customer is in', () {
    expect(
      describeSessionRow(_summary(), isCurrent: true, now: _now),
      contains('current conversation'),
    );
    expect(
      describeSessionRow(_summary(), isCurrent: false, now: _now),
      isNot(contains('current conversation')),
    );
  });

  test('omits the fragments it has no fact for, rather than speaking empties',
      () {
    final String label = describeSessionRow(
      _summary(preview: null),
      isCurrent: false,
      now: _now,
    );

    expect(label, 'With an agent, 2 hours ago');
    expect(label, isNot(contains('with ')));
    expect(label, isNot(contains('unread')));
  });

  test('an empty preview is the same as an absent one', () {
    // The wire's own rule is that `lastMessagePreview` is ABSENT rather than
    // present-and-empty, but `RestChatSessionSummary`'s decoder folds `''`
    // into `null` precisely because the wire is not always obeyed. Speaking
    // ", , " for a blank preview would be the visible failure of that.
    expect(
      describeSessionRow(_summary(preview: ''), isCurrent: false, now: _now),
      'With an agent, 2 hours ago',
    );
  });

  test('falls back to createdAt when the session has no messages yet', () {
    final ChatSessionSummary noMessages = ChatSessionSummary(
      id: 's1',
      status: ChatStatus.waitingForAgent,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
    );

    expect(
      describeSessionRow(noMessages, isCurrent: false, now: _now),
      'Waiting for an agent, 3 hours ago',
    );
  });

  test(
      'speaks session_display.dart\'s vocabulary for every status, not a second one',
      () {
    // The named regression `session-picker.test.ts` pins: an earlier version
    // treated anything that was not CLOSED as "live", so RESOLVED read as
    // active. Every status has its own word, and it is the one word the
    // Messages list and Home's pill also use.
    const Map<ChatStatus, String> expected = <ChatStatus, String>{
      ChatStatus.open: 'Open',
      ChatStatus.waitingForAgent: 'Waiting for an agent',
      ChatStatus.assigned: 'With an agent',
      ChatStatus.onHold: 'On hold',
      ChatStatus.resolved: 'Resolved',
      ChatStatus.closed: 'Closed',
    };

    for (final MapEntry<ChatStatus, String> entry in expected.entries) {
      final String label = describeSessionRow(
        _summary(status: entry.key, preview: null),
        isCurrent: false,
        now: _now,
      );
      expect(label, startsWith(entry.value), reason: '${entry.key}');
      // Not a paraphrase of its own: the word comes from `chatStatusLabel`.
      expect(label, startsWith(chatStatusLabel(entry.key)));
    }
  });

  test('is a pure function of its arguments — no ambient clock read', () {
    final ChatSessionSummary summary = _summary();
    expect(
      describeSessionRow(summary, isCurrent: false, now: _now),
      describeSessionRow(summary, isCurrent: false, now: _now),
    );
  });
}
