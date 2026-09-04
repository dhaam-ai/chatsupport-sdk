/// The offline queue (§9.1) and the reconnect that drains it (§8.4, §8.2).
///
/// ── The behaviour this file exists to hold ────────────────────────────────
///
/// A customer types three messages in a tunnel. When their signal comes back,
/// all three arrive, in the order they were typed, once each, in the
/// conversation they were typed in — and nobody pressed anything.
///
/// Every property in that sentence is separately breakable, and each one below
/// is one of them. The ordering ones are the subtle half: an orphaned send (one
/// written to a socket that then dropped) was composed BEFORE anything typed
/// afterwards, so putting it back at the tail would deliver the customer's
/// words out of order — a bug that only shows up when a drop happens mid-
/// conversation, which is to say in the field and never in a demo.
///
/// [ChatClient.retryNow] is here too, because the queue is only half the fix.
/// Full-jitter backoff (§8.2) climbs toward a 30-second cap, so a queue that
/// drains perfectly still leaves the customer watching nothing happen for half
/// a minute after their signal returns. A host with a connectivity stream knows
/// better than the backoff does.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:test/test.dart';

import 'fakes.dart';

final PublishableKey testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String ackJson({String sessionId = 's1'}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': 5,
        'session': <String, Object?>{
          'sessionId': sessionId,
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

String ackFor(String ref, {int seq = 6}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{'ok': true, 'seq': seq},
    });

String rejectFor(String ref, {required bool retryable}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'ok': false,
        'error': <String, Object?>{
          'code': retryable ? 'INTERNAL' : 'VALIDATION_FAILED',
          'message': 'nope',
          'retryable': retryable,
        },
      },
    });

Future<void> flush() => Future<void>.delayed(Duration.zero);

class Harness {
  Harness() {
    scheduler = FakeScheduler();
    client = ChatClient(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: testKey,
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

  Future<void> connected({String sessionId = 's1'}) async {
    unawaited(client.connect());
    await flush();
    socket.deliver(ackJson(sessionId: sessionId));
    await flush();
  }

  /// Drops the live socket and completes the handshake on its replacement.
  Future<void> reconnect({String sessionId = 's1'}) async {
    await socket.drop();
    await flush();
    await scheduler.advanceToNextTimer();
    await flush();
    socket.deliver(ackJson(sessionId: sessionId));
    await flush();
  }

  /// Every `message.send` envelope written to ANY socket, newest last.
  ///
  /// Across sockets deliberately: the whole point of the queue is that a
  /// message composed on one connection is written on another, and reading
  /// only the current socket would make the pair invisible.
  List<Map<String, Object?>> get sends => <Map<String, Object?>>[
        for (final FakeSocket socket in sockets)
          for (final String raw in socket.sent)
            if ((jsonDecode(raw) as Map<String, Object?>)['t'] ==
                'message.send')
              jsonDecode(raw) as Map<String, Object?>,
      ];

  /// The `content` of each `message.send`, in write order.
  List<String> get contents => sends
      .map((Map<String, Object?> f) =>
          (f['d']! as Map<String, Object?>)['content']! as String)
      .toList();

  /// The envelope ids of each `message.send`, in write order.
  List<String> get ids =>
      sends.map((Map<String, Object?> f) => f['id']! as String).toList();
}

void main() {
  group('what happens to a message typed with no connection', () {
    test('it is queued, not failed — and the count says how many', () async {
      final Harness harness = Harness();

      harness.client.sendMessage('one');
      harness.client.sendMessage('two');

      expect(harness.client.queuedCount, equals(2));
      expect(
        harness.client.queuedMessages
            .map((ChatMessage m) => m.delivery)
            .toSet(),
        equals(<MessageDelivery>{MessageDelivery.queued}),
      );
      expect(harness.sends, isEmpty);

      await harness.client.dispose();
    });

    test('every one of them goes out on connect, in the order typed', () async {
      final Harness harness = Harness();

      harness.client.sendMessage('one');
      harness.client.sendMessage('two');
      harness.client.sendMessage('three');

      await harness.connected();

      expect(harness.contents, equals(<String>['one', 'two', 'three']));
      expect(harness.client.queuedCount, isZero);

      await harness.client.dispose();
    });

    test('the echo is re-emitted as pending once it is on the wire', () async {
      final Harness harness = Harness();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('one');
      await flush();
      expect(seen.last.delivery, equals(MessageDelivery.queued));

      await harness.connected();

      // Same id throughout — a host keyed on it replaces the row rather than
      // growing a second one.
      expect(seen.last.id, equals(echo.id));
      expect(seen.last.delivery, equals(MessageDelivery.pending));

      await harness.client.dispose();
    });
  });

  group('a drop mid-conversation', () {
    test('puts the unacked send back at the FRONT, ahead of what came after',
        () async {
      // The ordering bug this pins: 'first' was composed before 'second', so
      // appending the orphan to the tail would deliver the customer's own
      // sentences in the wrong order — visible only when a drop lands between
      // two messages, which is to say never in a demo.
      final Harness harness = Harness();
      await harness.connected();

      harness.client.sendMessage('first');
      await harness.socket.drop();
      await flush();

      harness.client.sendMessage('second');
      expect(harness.client.queuedCount, equals(2));

      await harness.scheduler.advanceToNextTimer();
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      // 'first' appears twice across the two sockets — once on the socket that
      // dropped, once on its replacement — which is exactly the replay the
      // server's envelope-id dedup exists to collapse.
      expect(
        harness.contents,
        equals(<String>['first', 'first', 'second']),
      );
      expect(harness.ids[0], equals(harness.ids[1]));

      await harness.client.dispose();
    });

    test('replays under the original envelope id, so the server can dedupe',
        () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      await harness.reconnect();

      expect(harness.ids, equals(<String>[echo.id, echo.id]));

      await harness.client.dispose();
    });

    test('leaves an already-acked send alone', () async {
      // The queue must not resurrect what the server already has. A send is
      // removed from `_pending` by its ack, so there is nothing to orphan.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('done');
      harness.socket.deliver(ackFor(echo.id));
      await flush();

      await harness.reconnect();

      expect(harness.client.queuedCount, isZero);
      expect(harness.contents, equals(<String>['done']));

      await harness.client.dispose();
    });
  });

  group('what the queue deliberately does NOT swallow', () {
    test('a send the server refused stays failed, and is never replayed',
        () async {
      // Replaying a rejection on a timer collects the same verdict forever.
      // This one needs a human and the server's own `retryable` flag.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('bad');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();

      expect(harness.client.queuedCount, isZero);

      await harness.reconnect();

      expect(harness.client.queuedCount, isZero);
      expect(harness.contents, equals(<String>['bad']));

      // Still exactly where a Retry button expects it.
      expect(harness.client.retry(echo.id), isA<RetryRetried>());

      await harness.client.dispose();
    });

    test('a non-retryable rejection is not queued either', () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('malformed');
      harness.socket.deliver(rejectFor(echo.id, retryable: false));
      await flush();

      await harness.reconnect();

      expect(harness.client.queuedCount, isZero);
      expect(harness.contents, equals(<String>['malformed']));

      await harness.client.dispose();
    });
  });

  group('retryNow', () {
    test('abandons the armed backoff and attempts immediately', () async {
      final Harness harness = Harness();
      await harness.connected();

      await harness.socket.drop();
      await flush();
      expect(
          harness.client.connectionState, equals(ConnectionState.reconnecting));

      final int before = harness.sockets.length;
      expect(harness.client.retryNow(), isTrue);
      await flush();

      // A socket opened without the clock moving at all.
      expect(harness.sockets.length, equals(before + 1));
      expect(
          harness.client.connectionState, isNot(ConnectionState.reconnecting));

      await harness.client.dispose();
    });

    test('resets the transport attempt count, so backoff restarts at base',
        () async {
      final Harness harness = Harness();
      final List<Duration> delays = <Duration>[];
      harness.client.reconnecting
          .listen((ReconnectingEvent e) => delays.add(e.delay));
      await harness.connected();

      // Climb the curve, leaving the client parked in `reconnecting`.
      for (int i = 0; i < 3; i++) {
        await harness.socket.drop();
        await flush();
        if (i == 2) break;
        await harness.scheduler.advanceToNextTimer();
        await flush();
      }
      final int attemptsBefore = delays.length;

      harness.client.retryNow();
      await flush();
      await harness.socket.drop();
      await flush();

      // Full jitter draws in [0, ceiling], so the exact delay is not
      // assertable — but the ceiling after a reset is `base` (500ms), and
      // three failures in would otherwise have been at least 2s.
      expect(delays.length, equals(attemptsBefore + 1));
      expect(delays.last, lessThanOrEqualTo(const Duration(milliseconds: 500)));

      await harness.client.dispose();
    });

    test('is a no-op in every state but reconnecting', () async {
      final Harness harness = Harness();

      // idle
      expect(harness.client.retryNow(), isFalse);

      await harness.connected();
      // connected — nothing to retry, and the live socket must not be
      // superseded.
      expect(harness.client.retryNow(), isFalse);
      expect(harness.sockets, hasLength(1));

      // closed — §8.1 gives it exactly one way out, and this is not it.
      await harness.client.disconnect();
      expect(harness.client.retryNow(), isFalse);
      expect(harness.client.connectionState, equals(ConnectionState.closed));

      await harness.client.dispose();
    });

    test('drains the queue once the attempt it started succeeds', () async {
      // The two halves together, which is the whole feature: the network comes
      // back, the host says so, and what the customer typed in the tunnel
      // arrives — without waiting out a backoff that had grown to 30 seconds.
      final Harness harness = Harness();
      await harness.connected();

      await harness.socket.drop();
      await flush();
      harness.client.sendMessage('typed in the tunnel');
      expect(harness.client.queuedCount, equals(1));

      expect(harness.client.retryNow(), isTrue);
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      expect(harness.contents, equals(<String>['typed in the tunnel']));
      expect(harness.client.queuedCount, isZero);

      await harness.client.dispose();
    });
  });
}
