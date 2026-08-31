import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('chatStatusLabel', () {
    test('names every ChatStatus value — a forgotten one reads as a blank row', () {
      for (final status in ChatStatus.values) {
        expect(chatStatusLabel.containsKey(status), isTrue, reason: '$status has no label');
      }
    });
  });

  group('homeStatusPill', () {
    test('only the customer-actionable states get a pill', () {
      expect(homeStatusPill.keys.toSet(), <ChatStatus>{
        ChatStatus.resolved,
        ChatStatus.closed,
        ChatStatus.waitingForAgent,
      });
    });

    test('ASSIGNED and ON_HOLD are internal routing facts with no pill', () {
      expect(homeStatusPill.containsKey(ChatStatus.assigned), isFalse);
      expect(homeStatusPill.containsKey(ChatStatus.onHold), isFalse);
    });
  });

  group('handledByText', () {
    test('empty when nobody has picked up the session', () {
      expect(handledByText(null), '');
    });

    test('"with <name>" once someone has', () {
      const handledBy = HandledBy(kind: HandledByKind.agent, id: 'a1', displayName: 'Priya');
      expect(handledByText(handledBy), 'with Priya');
    });
  });

  group('relativeTimeLabel', () {
    final DateTime now = DateTime.utc(2026, 1, 15, 12);

    test('null timestamp renders nothing', () {
      expect(relativeTimeLabel(null, now: now), '');
    });

    test('within a minute reads as Just now', () {
      expect(relativeTimeLabel(now.subtract(const Duration(seconds: 30)), now: now), 'Just now');
    });

    test('minutes ago', () {
      expect(relativeTimeLabel(now.subtract(const Duration(minutes: 5)), now: now), '5 minutes ago');
    });

    test('singular unit has no trailing s', () {
      expect(relativeTimeLabel(now.subtract(const Duration(minutes: 1, seconds: 5)), now: now), '1 minute ago');
    });

    test('hours ago', () {
      expect(relativeTimeLabel(now.subtract(const Duration(hours: 3)), now: now), '3 hours ago');
    });

    test('days ago', () {
      expect(relativeTimeLabel(now.subtract(const Duration(days: 2)), now: now), '2 days ago');
    });

    test('weeks ago', () {
      expect(relativeTimeLabel(now.subtract(const Duration(days: 14)), now: now), '2 weeks ago');
    });

    test('a future timestamp reads "in N unit"', () {
      expect(relativeTimeLabel(now.add(const Duration(hours: 2)), now: now), 'in 2 hours');
    });

    test('rounds to the nearest count rather than always flooring', () {
      // 23 hours is closer to "1 day" than to "23 hours" once rounded at the
      // day threshold is reached — but 23h has not reached the day
      // threshold, so it must still read in hours.
      expect(relativeTimeLabel(now.subtract(const Duration(hours: 23)), now: now), '23 hours ago');
      // 25 hours has crossed the day threshold.
      expect(relativeTimeLabel(now.subtract(const Duration(hours: 25)), now: now), '1 day ago');
    });
  });
}
