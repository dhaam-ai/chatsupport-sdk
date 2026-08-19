import 'dart:convert';

import 'package:dhaam_chat/src/protocol/envelope.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:test/test.dart';

const String _ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const String _otherUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String frameJson({
  int v = 1,
  String t = 'message.new',
  String id = _ulid,
  Object? ts = 1700000000000,
  Object? d = const <String, Object?>{},
  String? ref,
}) {
  return jsonEncode(<String, Object?>{
    'v': v,
    't': t,
    'id': id,
    'ts': ts,
    'd': d,
    if (ref != null) 'ref': ref,
  });
}

void main() {
  group('ClientFrame encoding', () {
    test('writes ts as epoch millis, never ISO-8601', () {
      // THE trap. §7.2's envelope `ts` is a number of epoch millis while
      // payload timestamps like `createdAt` are ISO-8601 strings. Sending the
      // string form earns
      // "VALIDATION_FAILED: ts must be a finite epoch-millis number".
      final DateTime ts = DateTime.utc(2026, 8, 19, 12, 0, 0);
      final ClientFrame frame = ClientFrame(
        type: 'message.send',
        id: _ulid,
        ts: ts,
        d: const <String, Object?>{'content': 'hi', 'type': 'TEXT'},
      );

      final Map<String, Object?> json =
          jsonDecode(frame.encode()) as Map<String, Object?>;

      expect(json['ts'], isA<int>());
      expect(json['ts'], equals(ts.millisecondsSinceEpoch));
      expect(json['ts'], isNot(isA<String>()));
    });

    test('carries the five §7.2 envelope fields and defaults v', () {
      final ClientFrame frame = ClientFrame(
        type: 'system.heartbeat',
        id: _ulid,
        ts: DateTime.utc(2026),
        d: const <String, Object?>{},
      );
      final Map<String, Object?> json = frame.toJson();
      expect(json.keys.toSet(), equals(<String>{'v', 't', 'id', 'ts', 'd'}));
      expect(json['v'], equals(kProtocolVersion));
      expect(json['t'], equals('system.heartbeat'));
      expect(json['id'], equals(_ulid));
    });
  });

  group('envelope decoding', () {
    test('decodes a push frame', () {
      final ServerFrame frame = decodeServerFrame(
        frameJson(t: 'message.new', d: <String, Object?>{'seq': 12}),
      );
      expect(frame, isA<PushFrame>());
      final PushFrame push = frame as PushFrame;
      expect(push.type, equals('message.new'));
      expect(
          push.ts,
          equals(DateTime.fromMillisecondsSinceEpoch(
            1700000000000,
            isUtc: true,
          )));
    });

    test('rejects an ISO-8601 string in the envelope ts', () {
      // The inbound half of the same confusion. Refused with the server's own
      // words so both directions of the bug read identically.
      expect(
        () => decodeServerFrame(frameJson(ts: '2026-08-19T12:00:00Z')),
        throwsA(
          isA<FrameDecodeException>().having(
            (FrameDecodeException e) => e.reason,
            'reason',
            contains('finite epoch-millis number'),
          ),
        ),
      );
    });

    test('accepts an integral double ts, as Flutter Web produces', () {
      // Every Dart number is a double on the web, so `"ts": 1700000000000`
      // decodes to a double there. An `is int` test alone would reject valid
      // frames on exactly one of three target platforms.
      final ServerFrame frame =
          decodeServerFrame(frameJson(ts: 1700000000000.0));
      expect(frame.ts.millisecondsSinceEpoch, equals(1700000000000));
    });

    test('rejects a non-finite ts', () {
      expect(
        () => decodeServerFrameJson(<String, Object?>{
          'v': 1,
          't': 'message.new',
          'id': _ulid,
          'ts': double.infinity,
          'd': <String, Object?>{},
        }),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects an id that is not a ULID', () {
      expect(
        () => decodeServerFrame(
          frameJson(id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479'),
        ),
        throwsA(
          isA<FrameDecodeException>().having(
            (FrameDecodeException e) => e.path,
            'path',
            equals('id'),
          ),
        ),
      );
    });

    test('rejects an unknown frame type', () {
      expect(
        () => decodeServerFrame(frameJson(t: 'message.reaction')),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects a client→server type arriving from the server', () {
      // Directional, mirroring the server's own validator. The server has no
      // legitimate reason to send us a `message.send`.
      for (final String type in <String>[
        'message.send',
        'connection.hello',
        'system.heartbeat',
      ]) {
        expect(
          () => decodeServerFrame(frameJson(t: type)),
          throwsA(isA<FrameDecodeException>()),
          reason: '$type is client→server only',
        );
      }
    });

    test('rejects malformed JSON without echoing it', () {
      expect(
        () => decodeServerFrame('{"v":1,'),
        throwsA(
          isA<FrameDecodeException>().having(
            (FrameDecodeException e) => e.toString(),
            'toString',
            isNot(contains('"v"')),
          ),
        ),
      );
    });

    test('tolerates unrecognised extra keys', () {
      // Forward compatibility: a validator that hard-rejects unknown fields
      // turns every additive server change into a breaking change for
      // already-shipped mobile binaries, which are the ones that cannot be
      // redeployed on our schedule.
      final ServerFrame frame = decodeServerFrameJson(<String, Object?>{
        'v': 1,
        't': 'message.new',
        'id': _ulid,
        'ts': 1700000000000,
        'd': <String, Object?>{'seq': 1, 'somethingNew': true},
        'unknownEnvelopeKey': 'ignored',
      });
      expect(frame, isA<PushFrame>());
    });

    test('decodes message.delivered even though §7.3 omits it', () {
      // DRIFT: the server implements message.delivered and the §7.3 catalog
      // does not list it. Refusing it would tear down a healthy connection
      // the first time the server sent one.
      final ServerFrame frame = decodeServerFrame(
        frameJson(
          t: 'message.delivered',
          d: <String, Object?>{
            'participantId': 'p1',
            'deliveredUpToSeq': 9,
            'deliveredAt': '2026-08-19T12:00:00Z',
          },
        ),
      );
      expect(frame, isA<PushFrame>());
    });
  });

  group('ack and error frames', () {
    test('decodes a successful ack and strips ok from data', () {
      final ServerFrame frame = decodeServerFrame(
        frameJson(
          t: 'ack',
          ref: _otherUlid,
          d: <String, Object?>{'ok': true, 'seq': 42},
        ),
      );
      expect(frame, isA<AckSuccessFrame>());
      final AckSuccessFrame ack = frame as AckSuccessFrame;
      expect(ack.ref, equals(_otherUlid));
      expect(ack.data, equals(<String, Object?>{'seq': 42}));
      expect(ack.data.containsKey('ok'), isFalse);
    });

    test('decodes a failed ack as its own type', () {
      final ServerFrame frame = decodeServerFrame(
        frameJson(
          t: 'ack',
          ref: _otherUlid,
          d: <String, Object?>{
            'ok': false,
            'error': <String, Object?>{
              'code': 'RATE_LIMITED',
              'message': 'slow down',
              'retryable': true,
            },
          },
        ),
      );
      expect(frame, isA<AckFailureFrame>());
      expect(
          (frame as AckFailureFrame).error.code, equals(ErrorCode.rateLimited));
      expect(frame.error.retryable, isTrue);
    });

    test('decodes an error frame with details and an optional ref', () {
      final ServerFrame frame = decodeServerFrame(
        frameJson(
          t: 'error',
          ref: _otherUlid,
          d: <String, Object?>{
            'code': 'VALIDATION_FAILED',
            'message': 'resumeFrom is ahead of this session',
            'retryable': false,
            'details': <String, Object?>{'serverSeq': 40},
          },
        ),
      );
      final ErrorFrame error = frame as ErrorFrame;
      expect(error.error.code, equals(ErrorCode.validationFailed));
      expect(error.ref, equals(_otherUlid));
      expect(error.error.details?['serverSeq'], equals(40));
    });

    test('rejects an unknown error code rather than defaulting', () {
      expect(
        () => decodeServerFrame(
          frameJson(
            t: 'error',
            d: <String, Object?>{
              'code': 'TOKEN_EXPIRED',
              'message': 'x',
              'retryable': true,
            },
          ),
        ),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects an ack with no ref', () {
      expect(
        () => decodeServerFrame(
          frameJson(t: 'ack', d: <String, Object?>{'ok': true}),
        ),
        throwsA(isA<FrameDecodeException>()),
      );
    });
  });

  group('frame type catalog', () {
    test('typing.start and typing.stop exist in both directions', () {
      // §7.3 collapses v1's four typing event names into one pair used
      // identically in both directions (§12.4).
      for (final String type in <String>['typing.start', 'typing.stop']) {
        expect(kClientFrameTypes.contains(type), isTrue);
        expect(kServerPushFrameTypes.contains(type), isTrue);
      }
    });

    test('does not carry v1 event names forward', () {
      for (final String legacy in <String>[
        'TYPING_INDICATOR',
        'chat.message.send',
        'chat.connection.ack',
        'chat.notification.new_message',
        'NEW_MESSAGE_NOTIFICATION',
      ]) {
        expect(kClientFrameTypes.contains(legacy), isFalse);
        expect(kServerFrameTypes.contains(legacy), isFalse);
      }
    });
  });
}
