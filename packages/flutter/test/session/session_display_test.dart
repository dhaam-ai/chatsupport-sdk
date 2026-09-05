import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('chatStatusLabel', () {
    test('names every ChatStatus value — a forgotten one reads as a blank row',
        () {
      for (final status in ChatStatus.values) {
        expect(chatStatusLabel(status), isNotEmpty,
            reason: '\$status has no label');
      }
    });

    test('ASSIGNED reads as what it means to a customer, not as a queue fact',
        () {
      expect(chatStatusLabel(ChatStatus.assigned), 'With an agent');
    });
  });

  group('homeStatusPill', () {
    // The Home pill used to come from a three-entry map, so OPEN, ASSIGNED and
    // ON_HOLD rendered no pill at all — the conversation a customer is most
    // likely still in the middle of was the one row that would not say where it
    // stood. Every status now answers.
    test('every status gets a pill, including the in-progress ones', () {
      for (final status in ChatStatus.values) {
        expect(homeStatusPill(status), isNotEmpty,
            reason: '\$status has no pill');
      }
    });

    test('the short wording is used where the row is one line', () {
      expect(homeStatusPill(ChatStatus.waitingForAgent), 'Waiting');
      expect(
          chatStatusLabel(ChatStatus.waitingForAgent), 'Waiting for an agent');
    });

    test('matches the web widget word for word on the statuses it shares', () {
      // `ui/session-status.ts`'s SESSION_STATUS_WORDS — one merchant, one
      // vocabulary, whichever binding the customer happens to be on.
      expect(homeStatusPill(ChatStatus.assigned), 'With an agent');
      expect(homeStatusPill(ChatStatus.onHold), 'On hold');
      expect(homeStatusPill(ChatStatus.open), 'Open');
      expect(homeStatusPill(ChatStatus.resolved), 'Resolved');
      expect(homeStatusPill(ChatStatus.closed), 'Closed');
    });
  });

  group('handledByText', () {
    test('empty when nobody has picked up the session', () {
      expect(handledByText(null), '');
    });

    test('"with <name>" once someone has', () {
      const handledBy =
          HandledBy(kind: HandledByKind.agent, id: 'a1', displayName: 'Priya');
      expect(handledByText(handledBy), 'with Priya');
    });
  });

  group('relativeTimeLabel', () {
    final DateTime now = DateTime.utc(2026, 1, 15, 12);

    test('null timestamp renders nothing', () {
      expect(relativeTimeLabel(null, now: now), '');
    });

    test('within a minute reads as Just now', () {
      expect(
          relativeTimeLabel(now.subtract(const Duration(seconds: 30)),
              now: now),
          'Just now');
    });

    test('minutes ago', () {
      expect(
          relativeTimeLabel(now.subtract(const Duration(minutes: 5)), now: now),
          '5 minutes ago');
    });

    test('singular unit has no trailing s', () {
      expect(
          relativeTimeLabel(
              now.subtract(const Duration(minutes: 1, seconds: 5)),
              now: now),
          '1 minute ago');
    });

    test('hours ago', () {
      expect(
          relativeTimeLabel(now.subtract(const Duration(hours: 3)), now: now),
          '3 hours ago');
    });

    test('days ago', () {
      expect(relativeTimeLabel(now.subtract(const Duration(days: 2)), now: now),
          '2 days ago');
    });

    test('weeks ago', () {
      expect(
          relativeTimeLabel(now.subtract(const Duration(days: 14)), now: now),
          '2 weeks ago');
    });

    test('a future timestamp reads "in N unit"', () {
      expect(relativeTimeLabel(now.add(const Duration(hours: 2)), now: now),
          'in 2 hours');
    });

    test('rounds to the nearest count rather than always flooring', () {
      // 23 hours is closer to "1 day" than to "23 hours" once rounded at the
      // day threshold is reached — but 23h has not reached the day
      // threshold, so it must still read in hours.
      expect(
          relativeTimeLabel(now.subtract(const Duration(hours: 23)), now: now),
          '23 hours ago');
      // 25 hours has crossed the day threshold.
      expect(
          relativeTimeLabel(now.subtract(const Duration(hours: 25)), now: now),
          '1 day ago');
    });
  });

  group('mostRecentSummary', () {
    ChatSessionSummary summary(
        {required String id,
        required DateTime createdAt,
        DateTime? lastMessageAt}) {
      return ChatSessionSummary(
        id: id,
        status: ChatStatus.open,
        mode: ChatMode.human,
        createdAt: createdAt,
        lastMessageAt: lastMessageAt,
      );
    }

    test('null for an empty list', () {
      expect(mostRecentSummary(const []), isNull);
    });

    test('picks the summary with the latest lastMessageAt', () {
      final older = summary(
          id: 'a',
          createdAt: DateTime.utc(2026, 1, 1),
          lastMessageAt: DateTime.utc(2026, 1, 2));
      final newer = summary(
          id: 'b',
          createdAt: DateTime.utc(2026, 1, 1),
          lastMessageAt: DateTime.utc(2026, 1, 5));
      expect(mostRecentSummary([older, newer])?.id, 'b');
    });

    test('falls back to createdAt for a session with no messages yet', () {
      final noMessages = summary(id: 'a', createdAt: DateTime.utc(2026, 1, 10));
      final oldWithMessage = summary(
          id: 'b',
          createdAt: DateTime.utc(2026, 1, 1),
          lastMessageAt: DateTime.utc(2026, 1, 2));
      expect(mostRecentSummary([oldWithMessage, noMessages])?.id, 'a');
    });

    test(
        'does not trust host-supplied order — the latest wins regardless of position',
        () {
      final newer = summary(
        id: 'listed-second',
        createdAt: DateTime.utc(2026, 1, 1),
        lastMessageAt: DateTime.utc(2026, 6, 1),
      );
      final older = summary(
        id: 'listed-first',
        createdAt: DateTime.utc(2026, 1, 1),
        lastMessageAt: DateTime.utc(2026, 1, 1),
      );
      // `older` is index 0 and `newer` is index 1 — if the function trusted
      // position it would return `older`.
      expect(mostRecentSummary([older, newer])?.id, newer.id);
    });
  });
}
