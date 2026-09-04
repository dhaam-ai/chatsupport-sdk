/// The wire end of the contact-info capture — `ChatClient.setContactInfo`
/// and the four fields it puts on `connection.hello.d`.
///
/// Reproduces the properties `packages/core/src/connection/controller.ts`
/// states for its own `#contactInfo` record: merge-never-replace, read at
/// hello-build time, never cleared by `connection.ack`, and therefore resent
/// on every reconnect.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
// `connectionHelloPayload` is an internal builder, not part of the public
// barrel — the same direct import `test/protocol/frames_test.dart` uses.
import 'package:dhaam_chat/src/protocol/frames.dart';
import 'package:test/test.dart';

import 'fakes.dart';

final PublishableKey _testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String _ackJson({int seq = 5}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': seq,
        'session': <String, Object?>{
          'sessionId': 's1',
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

class _Harness {
  _Harness() {
    scheduler = FakeScheduler();
    client = ChatClient(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: _testKey,
      getToken: () async => 'jwt',
      scheduler: scheduler,
      socketFactory: (Uri _) async {
        final FakeSocket socket = FakeSocket();
        sockets.add(socket);
        return socket;
      },
    );
  }

  late final FakeScheduler scheduler;
  late final ChatClient client;
  final List<FakeSocket> sockets = <FakeSocket>[];

  FakeSocket get socket => sockets.last;

  Future<void> connected() async {
    unawaited(client.connect());
    await flush();
    socket.deliver(_ackJson());
    await flush();
  }

  /// The `d` of the hello this socket sent.
  Map<String, Object?> helloPayload([int index = 0]) {
    final Map<String, Object?> frame =
        jsonDecode(sockets[index].sent.first) as Map<String, Object?>;
    expect(frame['t'], equals('connection.hello'));
    return frame['d']! as Map<String, Object?>;
  }
}

void main() {
  group('connectionHelloPayload carries contact info', () {
    test('omits every contact field when nothing was captured', () {
      final Map<String, Object?> d =
          connectionHelloPayload(token: 't', publishableKey: 'k');

      expect(d.containsKey('ip'), isFalse);
      expect(d.containsKey('ipWatermark'), isFalse);
      expect(d.containsKey('userAgent'), isFalse);
      expect(d.containsKey('geo'), isFalse);
    });

    test('puts the four fields FLAT, with geo the only nested one', () {
      // The reference's shape: four top-level siblings, not a `contactInfo`
      // sub-object. `controller.ts:511`.
      final Map<String, Object?> d = connectionHelloPayload(
        token: 't',
        publishableKey: 'k',
        ip: '203.0.113.7',
        ipWatermark: 'wm_abc',
        userAgent: 'Dart/3.5 (dhaam_chat)',
        geo: const ContactGeo(lat: 12.5, lng: -77.25),
      );

      expect(d['ip'], equals('203.0.113.7'));
      expect(d['ipWatermark'], equals('wm_abc'));
      expect(d['userAgent'], equals('Dart/3.5 (dhaam_chat)'));
      expect(d['geo'], equals(<String, Object?>{'lat': 12.5, 'lng': -77.25}));
      expect(d.containsKey('contactInfo'), isFalse);
    });

    test('a partial capture omits only what is missing', () {
      final Map<String, Object?> d = connectionHelloPayload(
        token: 't',
        publishableKey: 'k',
        userAgent: 'Dart/3.5',
      );

      expect(d['userAgent'], equals('Dart/3.5'));
      expect(d.containsKey('ip'), isFalse);
      expect(d.containsKey('geo'), isFalse);
    });
  });

  group('ChatClient.setContactInfo', () {
    test('a user agent recorded before connect rides the FIRST hello',
        () async {
      // The property that makes "do not await the capture" safe:
      // `captureContactInfo` records the user agent synchronously, before its
      // own first `await`, so it is already here when the hello is built.
      final _Harness harness = _Harness();
      harness.client.setContactInfo(userAgent: 'Dart/3.5 (dhaam_chat)');

      await harness.connected();

      expect(
        harness.helloPayload()['userAgent'],
        equals('Dart/3.5 (dhaam_chat)'),
      );
    });

    test('merges across calls rather than replacing', () async {
      // Each capture reports as it resolves and carries ONE field. A call
      // that blanked the other three would lose the user agent the moment
      // the ip landed.
      final _Harness harness = _Harness();
      harness.client.setContactInfo(userAgent: 'Dart/3.5');
      harness.client.setContactInfo(ip: '203.0.113.7', ipWatermark: 'wm_abc');
      harness.client.setContactInfo(geo: const ContactGeo(lat: 1.5, lng: 2.5));

      await harness.connected();

      final Map<String, Object?> d = harness.helloPayload();
      expect(d['userAgent'], equals('Dart/3.5'));
      expect(d['ip'], equals('203.0.113.7'));
      expect(d['ipWatermark'], equals('wm_abc'));
      expect(d['geo'], equals(<String, Object?>{'lat': 1.5, 'lng': 2.5}));
    });

    test('a null argument means "nothing new", never "clear it"', () async {
      final _Harness harness = _Harness();
      harness.client.setContactInfo(ip: '203.0.113.7');
      harness.client.setContactInfo(userAgent: 'Dart/3.5');

      await harness.connected();

      expect(harness.helloPayload()['ip'], equals('203.0.113.7'));
    });

    test('a later call wins for the same field', () async {
      final _Harness harness = _Harness();
      harness.client.setContactInfo(ip: '203.0.113.7');
      harness.client.setContactInfo(ip: '198.51.100.2');

      await harness.connected();

      expect(harness.helloPayload()['ip'], equals('198.51.100.2'));
    });

    test('sends nothing by itself', () async {
      final _Harness harness = _Harness();
      await harness.connected();
      final int sentBefore = harness.socket.sent.length;

      harness.client.setContactInfo(ip: '203.0.113.7');
      await flush();

      expect(harness.socket.sent.length, equals(sentBefore));
    });

    test('a capture that lands AFTER the hello rides the next one', () async {
      // The whole reason the capture need not be awaited: a slow
      // ip-watermark fetch or an unanswered location prompt misses this
      // hello and is picked up by the next socket open, rather than being
      // lost or delaying connect.
      final _Harness harness = _Harness();
      harness.client.setContactInfo(userAgent: 'Dart/3.5');
      await harness.connected();

      expect(harness.helloPayload().containsKey('geo'), isFalse);

      // Resolves late.
      harness.client.setContactInfo(geo: const ContactGeo(lat: 1.5, lng: 2.5));

      // A reconnect: drop the socket and let the backoff timer fire.
      await harness.socket.drop();
      await flush();
      await harness.scheduler.advanceToNextTimer();
      await flush();

      expect(harness.sockets.length, greaterThan(1));
      final Map<String, Object?> second = harness.helloPayload(1);
      expect(second['geo'], equals(<String, Object?>{'lat': 1.5, 'lng': 2.5}));
      // And the user agent is STILL there — the record is not cleared by the
      // ack that fulfilled the first hello.
      expect(second['userAgent'], equals('Dart/3.5'));
    });
  });
}
