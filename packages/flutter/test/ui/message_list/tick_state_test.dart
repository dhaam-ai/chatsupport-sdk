// Reproduces `message-list.test.ts`'s "delivery ticks" block and the parts
// of core's own `ticks.test.ts` that the widget's assertions rest on.
//
// The headline assertion is the negative one: presence is not delivery.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

const String _me = 'cus_1';
const String _agent = 'agt_9';
final DateTime _createdAt = DateTime.utc(2026, 8, 19, 10);

ChatMessage _message({
  String senderId = _me,
  SenderType senderType = SenderType.customer,
  int? seq,
  MessageDelivery delivery = MessageDelivery.confirmed,
}) {
  return ChatMessage(
    id: 'm1',
    sessionId: 's1',
    senderId: senderId,
    senderType: senderType,
    type: MessageType.text,
    content: 'where is my order',
    seq: seq,
    createdAt: _createdAt,
    delivery: delivery,
  );
}

MessageTickState? _tick(
  ChatMessage message, {
  String? local = _me,
  Map<String, int> delivered = const <String, int>{},
  Map<String, DateTime> read = const <String, DateTime>{},
}) {
  return deriveTickState(
    TickInput(
      message: message,
      localParticipantId: local,
      deliveredWatermarks: delivered,
      readWatermarks: read,
    ),
  );
}

void main() {
  group('deriveTickState', () {
    test('renders a tick, with a text equivalent, for every state', () {
      final Map<MessageTickState, String> expected = <MessageTickState, String>{
        MessageTickState.pending: 'Sending',
        MessageTickState.sent: 'Sent',
        MessageTickState.delivered: 'Delivered',
        MessageTickState.read: 'Read',
      };

      expect(
        _tick(_message(delivery: MessageDelivery.queued)),
        MessageTickState.pending,
      );
      expect(_tick(_message(seq: 5)), MessageTickState.sent);
      expect(
        _tick(_message(seq: 5), delivered: <String, int>{_agent: 5}),
        MessageTickState.delivered,
      );
      expect(
        _tick(
          _message(seq: 5),
          read: <String, DateTime>{
            _agent: _createdAt.add(const Duration(seconds: 1)),
          },
        ),
        MessageTickState.read,
      );

      // WCAG 1.4.1: colour alone cannot be the difference between
      // "delivered" and "read", so every tick carries the word.
      for (final MessageTickState state in MessageTickState.values) {
        expect(tickPresentation(state).label, expected[state]);
        expect(tickPresentation(state).glyph, isNotEmpty);
      }
    });

    test('an unacked optimistic send reads as pending, like a queued one', () {
      // `dhaam_chat` splits core's `queued` into `pending` and `queued`; both
      // mean "not acked, and nothing for the customer to do".
      expect(
        _tick(_message(delivery: MessageDelivery.pending)),
        MessageTickState.pending,
      );
    });

    test("shows no tick at all on someone else's message", () {
      expect(
        _tick(
          _message(senderId: _agent, senderType: SenderType.agent, seq: 3),
        ),
        isNull,
      );
    });

    test('shows no tick when the local participant is unknown', () {
      // Core's conservative no-tick: guessing would make an agent-side embed
      // draw ticks on the customer's messages.
      expect(_tick(_message(seq: 5), local: null), isNull);
    });

    test('does not treat presence as delivery', () {
      // v1's actual bug. There is no field on TickInput for presence, agent
      // liveness or connection state, so the only thing that can promote
      // `sent` to `delivered` is a watermark — and an empty one does not.
      expect(
        _tick(_message(seq: 5), delivered: const <String, int>{}),
        MessageTickState.sent,
      );
    });

    test('our own watermark never ticks our own message', () {
      // A client advances its own delivery watermark on receipt; counting it
      // would tick everything `delivered` against nothing but ourselves.
      expect(
        _tick(_message(seq: 5), delivered: <String, int>{_me: 99}),
        MessageTickState.sent,
      );
      expect(
        _tick(
          _message(seq: 5),
          read: <String, DateTime>{
            _me: _createdAt.add(const Duration(days: 1)),
          },
        ),
        MessageTickState.sent,
      );
    });

    test('a watermark behind this message does not promote it', () {
      expect(
        _tick(_message(seq: 5), delivered: <String, int>{_agent: 4}),
        MessageTickState.sent,
      );
      expect(
        _tick(
          _message(seq: 5),
          read: <String, DateTime>{
            _agent: _createdAt.subtract(const Duration(seconds: 1)),
          },
        ),
        MessageTickState.sent,
      );
    });

    test('a read watermark exactly at createdAt covers it', () {
      // Inclusive: a watermark means "read up to and including this instant".
      expect(
        _tick(_message(seq: 5), read: <String, DateTime>{_agent: _createdAt}),
        MessageTickState.read,
      );
    });

    test('read outranks delivered when both hold', () {
      expect(
        _tick(
          _message(seq: 5),
          delivered: <String, int>{_agent: 5},
          read: <String, DateTime>{_agent: _createdAt},
        ),
        MessageTickState.read,
      );
    });

    test('a failed send has no tick — a tick would claim it arrived', () {
      expect(
        _tick(_message(seq: 5, delivery: MessageDelivery.failed)),
        isNull,
      );
    });

    test('a confirmed message with no seq has no honest tick', () {
      expect(_tick(_message()), isNull);
    });
  });

  group('failureReasonCopy', () {
    test('a distinct sentence per SendFailureReason, exhaustively', () {
      final Map<SendFailureReason, String> expected =
          <SendFailureReason, String>{
        SendFailureReason.rejected: 'This message could not be sent.',
        SendFailureReason.sessionClosed:
            'This conversation ended before this message could send.',
        SendFailureReason.expired: 'This message took too long to send.',
        SendFailureReason.evicted: 'Too many messages were waiting to send.',
        SendFailureReason.storage:
            'This message could not be saved on this device.',
      };

      // Iterating `values` is what makes this exhaustive at runtime; the
      // `switch` inside `failureReasonCopy` is what makes a new reason a
      // compile error rather than a blank line.
      for (final SendFailureReason reason in SendFailureReason.values) {
        expect(failureReasonCopy(reason), expected[reason], reason: '$reason');
      }
      expect(expected, hasLength(SendFailureReason.values.length));
      expect(expected.values.toSet(), hasLength(expected.length));
    });
  });
}
