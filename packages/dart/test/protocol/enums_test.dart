import 'package:dhaam_chat/src/protocol/enums.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:test/test.dart';

void main() {
  group('wire enums', () {
    test('ChatStatus models all six backend values', () {
      // v1's type system modelled four and silently folded RESOLVED and
      // ON_HOLD into OPEN (§12.1). This test is the guard against doing it
      // again in Dart.
      expect(
        ChatStatus.values.map((ChatStatus s) => s.wire).toSet(),
        equals(<String>{
          'OPEN',
          'WAITING_FOR_AGENT',
          'ASSIGNED',
          'CLOSED',
          'RESOLVED',
          'ON_HOLD',
        }),
      );
    });

    test('round-trips every value of every enum', () {
      void check<T extends WireEnum>(
          List<T> values, T? Function(String) parse) {
        for (final T value in values) {
          expect(parse(value.wire), same(value));
        }
      }

      check(SenderType.values, SenderType.fromWire);
      check(MessageType.values, MessageType.fromWire);
      check(ChatStatus.values, ChatStatus.fromWire);
      check(ChatMode.values, ChatMode.fromWire);
      check(PresenceStatus.values, PresenceStatus.fromWire);
      check(ParticipantType.values, ParticipantType.fromWire);
      check(CloseReason.values, CloseReason.fromWire);
    });

    test('returns null for an unknown value rather than a default', () {
      // D4 ships zero coercion. A fallback here is how v1's
      // normalizeChatStatus turned RESOLVED into OPEN.
      expect(ChatStatus.fromWire('ESCALATED'), isNull);
      expect(SenderType.fromWire('SUPERVISOR'), isNull);
      expect(MessageType.fromWire('STICKER'), isNull);
    });

    test('returns null for the integer form v1 used to send', () {
      // §12.1: the backend's INTERNAL representation is integers, and v1
      // clients accepted both. D4 says integers never appear on this wire, so
      // accepting one here would resurrect the drift D4 exists to end.
      expect(ChatStatus.fromWire('1'), isNull);
      expect(SenderType.fromWire('1'), isNull);
    });

    test('is case-sensitive', () {
      expect(ChatStatus.fromWire('open'), isNull);
      expect(ChatMode.fromWire('Human'), isNull);
    });

    test('ChatStatus.resolved and CloseReason.resolved are distinct types', () {
      // Both spell 'RESOLVED' on the wire but answer different questions:
      // one is a session status, the other is why a session ended. Keeping
      // them as separate types is what stops a host mixing them up.
      expect(ChatStatus.resolved.wire, equals(CloseReason.resolved.wire));
      expect(ChatStatus.fromWire('SWITCHED'), isNull);
      expect(CloseReason.fromWire('ON_HOLD'), isNull);
    });
  });

  group('ErrorCode', () {
    test('carries exactly the eight §7.4 codes', () {
      expect(
        ErrorCode.values.map((ErrorCode c) => c.wire).toSet(),
        equals(<String>{
          'AUTH_INVALID',
          'AUTH_EXPIRED',
          'PROTOCOL_VERSION_UNSUPPORTED',
          'RATE_LIMITED',
          'VALIDATION_FAILED',
          'SESSION_NOT_FOUND',
          'SESSION_CLOSED',
          'INTERNAL',
        }),
      );
    });

    test('round-trips and rejects unknown codes', () {
      for (final ErrorCode code in ErrorCode.values) {
        expect(ErrorCode.fromWire(code.wire), same(code));
      }
      // v1's actual expiry signal (§12.6). It is not a §7.4 code and must not
      // be mistaken for one.
      expect(ErrorCode.fromWire('TOKEN_EXPIRED'), isNull);
    });
  });

  group('FrameDecodeException', () {
    test('names the field and the reason without the value', () {
      const FrameDecodeException e = FrameDecodeException(
        'd.token',
        'must be a non-empty string',
        frameType: 'connection.hello',
      );
      final String text = e.toString();
      expect(text, contains('d.token'));
      expect(text, contains('connection.hello'));
      expect(text, contains('must be a non-empty string'));
    });
  });
}
