/// Every connect attempt terminates, exactly once, into the ONE retry path.
///
/// ── The bug being ported out of existence ─────────────────────────────────
///
/// The retry path is reachable only from a terminated attempt. A connect that
/// hangs — server down, no route to host, a network that dropped mid-connect —
/// produces no open and no close, so nothing terminates the attempt, so
/// nothing schedules a retry, and the client parks in `connecting` for as long
/// as the OS's own TCP timeout happens to be: tens of seconds to several
/// minutes on a mobile network, with no WebSocket-level event in the meantime
/// and no way for a host to tell the difference between "connecting" and
/// "hung".
///
/// Two shapes have to be covered and both are here: an attempt that hangs
/// before the socket exists (the deadline's job), and an attempt whose socket
/// signals twice — error AND done — which must still produce exactly one
/// retry, not two.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:dhaam_chat/src/auth/keys.dart';
import 'package:dhaam_chat/src/connection/backoff.dart';
import 'package:dhaam_chat/src/connection/connection.dart';
import 'package:dhaam_chat/src/connection/socket.dart';
import 'package:test/test.dart';

import '../fakes.dart';

final PublishableKey testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String ackJson() => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': 5,
        'session': <String, Object?>{
          'sessionId': 's1',
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

/// A controller whose token fetch and socket factory a test controls.
class Harness {
  Harness({
    Future<String> Function()? getToken,
    ChatSocketFactory? socketFactory,
  }) {
    scheduler = FakeScheduler();
    controller = ConnectionController(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: testKey,
      getToken: getToken ?? () async => 'jwt-token',
      scheduler: scheduler,
      backoff: Backoff(random: Random(1)),
      socketFactory: socketFactory ??
          (Uri _) async {
            final FakeSocket socket = FakeSocket();
            sockets.add(socket);
            return socket;
          },
    );
    controller.reconnecting.listen(reconnects.add);
  }

  late final FakeScheduler scheduler;
  late final ConnectionController controller;
  final List<FakeSocket> sockets = <FakeSocket>[];
  final List<ReconnectingEvent> reconnects = <ReconnectingEvent>[];

  FakeSocket get socket => sockets.last;

  Future<void> connected() async {
    unawaited(controller.connect());
    await flush();
    socket.deliver(ackJson());
    await flush();
  }
}

void main() {
  group('connect deadline', () {
    test('a socket factory that never completes is not waited on forever',
        () async {
      // "Server down" on many platforms: the connect neither succeeds nor
      // fails, it simply does not call back.
      final Harness harness = Harness(
        socketFactory: (Uri _) => Completer<ChatSocket>().future,
      );

      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      expect(harness.controller.state, equals(ConnectionState.connecting));
      expect(harness.reconnects, isEmpty);

      await harness.scheduler.advance(const Duration(seconds: 10));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.reconnecting));
      expect(harness.reconnects, hasLength(1));

      await harness.controller.disconnect();
    });

    test('a getToken that never completes is not waited on forever', () async {
      // getToken() is host code reaching the host's own backend. §10.6 covers
      // it THROWING; nothing covers it hanging, and a hung token fetch parks
      // the client in exactly the same place a hung socket does.
      final Harness harness =
          Harness(getToken: () => Completer<String>().future);

      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      expect(harness.controller.state, equals(ConnectionState.connecting));

      await harness.scheduler.advance(const Duration(seconds: 10));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.reconnecting));
      expect(harness.reconnects, hasLength(1));

      await harness.controller.disconnect();
    });

    test('keeps retrying a hung connect rather than giving up after one',
        () async {
      // §8.2: transport failures retry indefinitely. A deadline that fired
      // once and then left the client in `reconnecting` with no timer would
      // be the same stall one layer along.
      final Harness harness = Harness(
        socketFactory: (Uri _) => Completer<ChatSocket>().future,
      );

      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();

      for (int i = 0; i < 3; i++) {
        await harness.scheduler.advance(const Duration(minutes: 1));
        await flush();
      }

      expect(harness.reconnects.length, greaterThan(2));
      // Mid-cycle when the clock stopped: the last retry timer has already
      // fired and armed the next attempt's deadline. Either way it is moving,
      // which is the property that was missing.
      expect(
        harness.controller.state,
        anyOf(
          equals(ConnectionState.connecting),
          equals(ConnectionState.reconnecting),
        ),
      );

      await harness.controller.disconnect();
    });

    test('a late socket from a deadlined attempt is closed, not adopted',
        () async {
      // The factory's future is still outstanding when the deadline fires. If
      // it resolves afterwards, that socket belongs to an attempt that has
      // already been retried — adopting it would leave two live sockets, and
      // the abandoned one would tear down the connection that replaced it.
      final Completer<ChatSocket> pending = Completer<ChatSocket>();
      final FakeSocket late = FakeSocket();
      final Harness harness = Harness(socketFactory: (Uri _) => pending.future);

      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      await harness.scheduler.advance(const Duration(seconds: 10));
      await flush();
      expect(harness.controller.state, equals(ConnectionState.reconnecting));

      pending.complete(late);
      await flush();

      expect(late.closed, isTrue);
      expect(late.sent, isEmpty, reason: 'hello was written to a dead attempt');

      await harness.controller.disconnect();
    });

    test('is disarmed once the socket is up, and never fires on a live one',
        () async {
      // The deadline bounds the attempt, not the connection. A deadline still
      // armed after the socket came up would kill a perfectly healthy
      // connection ten seconds in.
      final Harness harness = Harness();
      await harness.connected();
      expect(harness.controller.state, equals(ConnectionState.connected));

      await harness.scheduler.advance(const Duration(minutes: 5));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.connected));
      expect(harness.reconnects, isEmpty);
      expect(harness.socket.closed, isFalse);

      await harness.controller.disconnect();
    });
  });

  group('one close per attempt', () {
    test('a socket that errors WITHOUT closing still schedules a retry',
        () async {
      // The error callback cannot be a log statement. Nothing guarantees a
      // close follows an error across the ChatSocket seam, and if none comes,
      // an error that only logged would strand the connection.
      final Harness harness = Harness();
      await harness.connected();

      harness.socket.fail();
      await flush();

      expect(harness.controller.state, equals(ConnectionState.reconnecting));
      expect(harness.reconnects, hasLength(1));

      await harness.controller.disconnect();
    });

    test('an error FOLLOWED by a close still schedules exactly one retry',
        () async {
      // The browser ordering, which most backends do follow. Two terminal
      // signals for one attempt must not mean two retries: the second would
      // double-advance the backoff attempt counter and emit a phantom
      // "reconnecting in Ns" a host would render.
      final Harness harness = Harness();
      await harness.connected();

      harness.socket.fail();
      await harness.socket.drop();
      await flush();

      expect(harness.reconnects, hasLength(1));
      expect(harness.reconnects.single.attempt, equals(0));

      await harness.controller.disconnect();
    });

    test('the handshake timeout and a later close are one retry, not two',
        () async {
      // A server that accepts the socket, says nothing, and closes it a moment
      // after the client gave up: two terminal signals again, one attempt.
      final Harness harness = Harness();
      // The connect future is still pending when disconnect() fails it; §8.1
      // makes that the documented outcome, and this test is not about it.
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      expect(harness.controller.state, equals(ConnectionState.authenticating));

      await harness.scheduler.advance(const Duration(seconds: 10));
      await flush();
      expect(harness.reconnects, hasLength(1));

      await harness.sockets.first.drop();
      await flush();

      expect(harness.reconnects, hasLength(1));

      await harness.controller.disconnect();
    });

    test('a dropped socket from a superseded attempt is ignored', () async {
      // The first attempt's socket outlives it — a close arriving from an
      // attempt two generations back must not schedule a retry against the
      // attempt currently in flight.
      final Harness harness = Harness();
      await harness.connected();

      await harness.socket.drop();
      await flush();
      expect(harness.reconnects, hasLength(1));

      await harness.scheduler.advance(const Duration(seconds: 30));
      await flush();
      expect(harness.sockets.length, greaterThan(1));

      // Whatever the retries did in the meantime is not the point; the point
      // is that the FIRST attempt's socket can no longer add to it.
      final int settled = harness.reconnects.length;

      // The first socket's stream is already closed; re-closing it is what a
      // real transport does when the OS finally notices.
      await harness.sockets.first.drop();
      harness.sockets.first.fail();
      await flush();

      expect(harness.reconnects, hasLength(settled));

      await harness.controller.disconnect();
    });
  });
}
