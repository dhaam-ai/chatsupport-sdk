import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:dhaam_chat/src/auth/keys.dart';
import 'package:dhaam_chat/src/auth/token.dart';
import 'package:dhaam_chat/src/connection/backoff.dart';
import 'package:dhaam_chat/src/connection/connection.dart';
import 'package:dhaam_chat/src/protocol/envelope.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:dhaam_chat/src/resume/resume_tracker.dart';
import 'package:test/test.dart';

import '../fakes.dart';

final PublishableKey testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String ackJson({
  int seq = 5,
  int protocolVersion = 1,
  List<Map<String, Object?>>? replay,
}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': protocolVersion,
        'seq': seq,
        'session': <String, Object?>{
          'sessionId': 's1',
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
        if (replay != null) 'replay': replay,
      },
    });

Map<String, Object?> messageFrame(int seq) => <String, Object?>{
      'v': 1,
      't': 'message.new',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'id': '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'sessionId': 's1',
        'senderId': 'u1',
        'senderType': 'AGENT',
        'type': 'TEXT',
        'content': 'hi',
        'seq': seq,
        'createdAt': '2026-08-19T12:00:00.000Z',
      },
    };

String errorJson(String code, {bool retryable = false}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'error',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'code': code,
        'message': 'nope',
        'retryable': retryable,
      },
    });

/// Builds a controller wired to fakes, exposing every socket it opened.
class Harness {
  Harness({
    TokenProvider? getToken,
    ResumeTracker? resumeTracker,
    Backoff? backoff,
  }) {
    scheduler = FakeScheduler();
    controller = ConnectionController(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: testKey,
      getToken: getToken ?? () async => 'jwt-token',
      scheduler: scheduler,
      backoff: backoff ?? Backoff(random: Random(1)),
      resumeTracker: resumeTracker,
      socketFactory: (Uri _) async {
        final FakeSocket socket = FakeSocket();
        sockets.add(socket);
        return socket;
      },
    );
  }

  late final FakeScheduler scheduler;
  late final ConnectionController controller;
  final List<FakeSocket> sockets = <FakeSocket>[];

  FakeSocket get socket => sockets.last;

  Map<String, Object?> sentFrame(int index) =>
      jsonDecode(socket.sent[index]) as Map<String, Object?>;
}

void main() {
  group('handshake', () {
    test('sends connection.hello with ts as epoch millis', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();

      final Map<String, Object?> hello = harness.sentFrame(0);
      expect(hello['t'], equals('connection.hello'));
      expect(hello['ts'], isA<int>());
      expect(hello['v'], equals(1));

      final Map<String, Object?> d = hello['d']! as Map<String, Object?>;
      expect(d['token'], equals('jwt-token'));
      expect(d['publishableKey'], equals(testKey.value));
      expect(d['protocolVersion'], equals(1));

      await harness.controller.dispose();
    });

    test('omits resumeFrom on a first connect', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();

      final Map<String, Object?> d =
          harness.sentFrame(0)['d']! as Map<String, Object?>;
      // Absent means "fresh". A 0 would mean "replay the whole session".
      expect(d.containsKey('resumeFrom'), isFalse);

      await harness.controller.dispose();
    });

    test('reaches connected on ack and resolves connect()', () async {
      final Harness harness = Harness();
      final Future<void> connected = harness.controller.connect();
      await flush();

      expect(harness.controller.state, equals(ConnectionState.authenticating));
      harness.socket.deliver(ackJson(seq: 5));
      await connected;

      expect(harness.controller.state, equals(ConnectionState.connected));
      expect(harness.controller.resumeFrom, equals(5));

      await harness.controller.dispose();
    });

    test('sends resumeFrom as an integer seq on reconnect', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson(seq: 12));
      await flush();

      await harness.socket.drop();
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();

      final Map<String, Object?> d =
          harness.sentFrame(0)['d']! as Map<String, Object?>;
      expect(d['resumeFrom'], isA<int>());
      expect(d['resumeFrom'], equals(12));

      await harness.controller.dispose();
    });

    test('a silent server does not strand the client in authenticating',
        () async {
      // SPEC GAP: §8.1 never bounds the authenticating wait. A half-open
      // connection through a NAT that dropped state is routine on mobile.
      final Harness harness = Harness();
      final List<ConnectionState> states = <ConnectionState>[];
      harness.controller.states.listen(states.add);
      final List<ReconnectingEvent> events = <ReconnectingEvent>[];
      harness.controller.reconnecting.listen(events.add);

      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      expect(harness.controller.state, equals(ConnectionState.authenticating));

      harness.scheduler.advance(const Duration(seconds: 11));
      await flush();

      // The timeout must hand over to `reconnecting` — §8.1's backoff-pending
      // state — and not straight back to `authenticating`, or a host cannot
      // tell "waiting to retry" from "handshaking" and shows a spinner
      // through a silent backoff.
      //
      // Asserted on the TRANSITION HISTORY rather than on the state after the
      // advance, because the two are not the same question. §8.2's backoff for
      // attempt 0 is uniform in [0, 500ms], so the retry this schedules always
      // comes due inside these same 11 seconds: by the time the clock stops
      // the machine is legitimately in `authenticating` again, on a second
      // socket that has had its own `connection.hello` written. Pinning the
      // final state would assert the opposite of §8.1 — that a client sits out
      // its backoff without retrying.
      expect(
        states,
        containsAllInOrder(<ConnectionState>[
          ConnectionState.authenticating,
          ConnectionState.reconnecting,
          ConnectionState.connecting,
          ConnectionState.authenticating,
        ]),
      );

      // A backoff timer really was pending in between — this event is what a
      // host renders a "reconnecting in Ns" affordance from (§6.5).
      expect(events, hasLength(1));
      expect(events.single.attempt, equals(0));

      // And the retry really happened. A silent server is a transport
      // failure, which §8.2 retries indefinitely rather than suspending.
      expect(harness.sockets, hasLength(2));
      expect(
          harness.controller.state, isNot(equals(ConnectionState.suspended)));

      await harness.controller.dispose();
    });
  });

  group('resume', () {
    test('delivers replayed frames in seq order and reports no gap', () async {
      final Harness harness =
          Harness(resumeTracker: ResumeTracker()..settleAck(10));
      final List<ResumeGap> gaps = <ResumeGap>[];
      harness.controller.gaps.listen(gaps.add);

      final List<int> delivered = <int>[];
      harness.controller.frames.listen((ServerFrame frame) {
        final int? seq = seqOf(frame);
        if (seq != null) delivered.add(seq);
      });

      unawaited(harness.controller.connect());
      await flush();
      // Deliberately out of array order: ordering is by seq, never by
      // position or by ts (D2).
      harness.socket.deliver(
        ackJson(
          seq: 12,
          replay: <Map<String, Object?>>[messageFrame(12), messageFrame(11)],
        ),
      );
      await flush();

      expect(delivered, equals(<int>[11, 12]));
      expect(gaps, isEmpty);
      expect(harness.controller.resumeFrom, equals(12));

      await harness.controller.dispose();
    });

    test('surfaces the over-cap span as exactly one gap', () async {
      // D2: more than 200 behind, the server sends NO replay and a truthful
      // seq. Only the ack's own number reveals the span.
      final Harness harness =
          Harness(resumeTracker: ResumeTracker()..settleAck(10));
      final List<ResumeGap> gaps = <ResumeGap>[];
      harness.controller.gaps.listen(gaps.add);

      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson(seq: 300));
      await flush();

      expect(
          gaps, equals(<ResumeGap>[const ResumeGap(fromSeq: 11, toSeq: 300)]));

      await harness.controller.dispose();
    });

    test('reports a hole between live frames', () async {
      final Harness harness = Harness();
      final List<ResumeGap> gaps = <ResumeGap>[];
      harness.controller.gaps.listen(gaps.add);

      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson(seq: 5));
      await flush();

      harness.socket.deliver(jsonEncode(messageFrame(6)));
      harness.socket.deliver(jsonEncode(messageFrame(9)));
      await flush();

      expect(gaps, equals(<ResumeGap>[const ResumeGap(fromSeq: 7, toSeq: 8)]));

      await harness.controller.dispose();
    });
  });

  group('reconnect', () {
    test('retries transport failures indefinitely', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      // Far more than v1's 5-attempt cap. A dropped WiFi connection is not a
      // reason to give up (§8.2).
      for (int i = 0; i < 25; i++) {
        await harness.socket.drop();
        await flush();
        expect(harness.controller.state, equals(ConnectionState.reconnecting));
        harness.scheduler.advance(const Duration(seconds: 60));
        await flush();
        harness.socket.deliver(ackJson());
        await flush();
        expect(harness.controller.state, equals(ConnectionState.connected));
      }

      expect(harness.sockets.length, equals(26));

      await harness.controller.dispose();
    });

    test('emits a reconnecting event with attempt and delay', () async {
      final Harness harness = Harness();
      final List<ReconnectingEvent> events = <ReconnectingEvent>[];
      harness.controller.reconnecting.listen(events.add);

      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();
      await harness.socket.drop();
      await flush();

      expect(events, hasLength(1));
      expect(events.single.attempt, equals(0));
      expect(
        events.single.delay.inMilliseconds,
        lessThanOrEqualTo(500),
      );

      await harness.controller.dispose();
    });

    test('disconnect is terminal — no reconnect follows', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      await harness.controller.disconnect();
      await flush();
      expect(harness.controller.state, equals(ConnectionState.closed));

      harness.scheduler.advance(const Duration(minutes: 5));
      await flush();
      expect(harness.sockets.length, equals(1));
      expect(harness.controller.state, equals(ConnectionState.closed));

      await harness.controller.dispose();
    });
  });

  group('auth escalation', () {
    test('suspends after three consecutive auth rejections', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();

      for (int i = 0; i < 3; i++) {
        harness.socket.deliver(errorJson('AUTH_INVALID'));
        await flush();
        harness.scheduler.advance(const Duration(seconds: 60));
        await flush();
      }

      expect(harness.controller.state, equals(ConnectionState.suspended));
      expect(harness.controller.suspendReason, equals(SuspendReason.auth));

      await harness.controller.dispose();
    });

    test('counts a throwing getToken as an auth failure', () async {
      // §10.6: getToken throwing IS an auth failure, not a transport one.
      final Harness harness =
          Harness(getToken: () async => throw StateError('no'));
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.suspended));
      expect(harness.controller.suspendReason, equals(SuspendReason.auth));

      await harness.controller.dispose();
    });

    test('counts an empty token without spending a round trip', () async {
      final Harness harness = Harness(getToken: () async => '');
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.suspended));
      // No socket was ever opened for the empty token.
      expect(harness.sockets, isEmpty);

      await harness.controller.dispose();
    });

    test('an explicit connect() clears suspension and resets the counter',
        () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      for (int i = 0; i < 3; i++) {
        harness.socket.deliver(errorJson('AUTH_INVALID'));
        await flush();
        harness.scheduler.advance(const Duration(seconds: 60));
        await flush();
      }
      expect(harness.controller.state, equals(ConnectionState.suspended));

      final Future<void> reconnected = harness.controller.connect();
      await flush();
      harness.socket.deliver(ackJson());
      await reconnected;
      expect(harness.controller.state, equals(ConnectionState.connected));

      await harness.controller.dispose();
    });

    test('a single auth rejection retries rather than suspending', () async {
      // A merely expired token must recover on its own — getToken is invoked
      // again on the retry (§10.4).
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(errorJson('AUTH_EXPIRED', retryable: true));
      await flush();
      harness.scheduler.advance(const Duration(seconds: 60));
      await flush();

      harness.socket.deliver(ackJson());
      await flush();
      expect(harness.controller.state, equals(ConnectionState.connected));

      await harness.controller.dispose();
    });
  });

  group('protocol version', () {
    test('suspends rather than retry-looping on an unsupported version',
        () async {
      // §7.5: "Core must surface this as a suspended state, not retry-loop
      // against a version it cannot speak."
      final Harness harness = Harness();
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      harness.socket.deliver(errorJson('PROTOCOL_VERSION_UNSUPPORTED'));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.suspended));
      expect(
        harness.controller.suspendReason,
        equals(SuspendReason.protocolUnsupported),
      );

      harness.scheduler.advance(const Duration(minutes: 10));
      await flush();
      expect(harness.sockets.length, equals(1));

      await harness.controller.dispose();
    });

    test('suspends if the ack negotiates a version we do not implement',
        () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect().catchError((Object _) {}));
      await flush();
      harness.socket.deliver(ackJson(protocolVersion: 2));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.suspended));

      await harness.controller.dispose();
    });
  });

  group('robustness', () {
    test('a malformed frame is surfaced but does not drop the connection',
        () async {
      final Harness harness = Harness();
      final List<ErrorPayload> errors = <ErrorPayload>[];
      harness.controller.errors.listen(errors.add);

      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      harness.socket.deliver('{not json');
      harness.socket
          .deliver(jsonEncode(<String, Object?>{'v': 1, 't': 'nope'}));
      await flush();

      expect(errors, hasLength(2));
      expect(
          errors
              .every((ErrorPayload e) => e.code == ErrorCode.validationFailed),
          isTrue);
      // One bad frame from an otherwise healthy server is not a reason to
      // reconnect the whole fleet.
      expect(harness.controller.state, equals(ConnectionState.connected));

      await harness.controller.dispose();
    });

    test('a standalone VALIDATION_FAILED does not tear down the socket',
        () async {
      // The server sends exactly this, without closing, when resumeFrom is
      // ahead of its own last_seq.
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      harness.socket.deliver(errorJson('VALIDATION_FAILED'));
      await flush();

      expect(harness.controller.state, equals(ConnectionState.connected));

      await harness.controller.dispose();
    });

    test('sends a heartbeat on the interval once connected', () async {
      final Harness harness = Harness();
      unawaited(harness.controller.connect());
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      final int before = harness.socket.sent.length;
      harness.scheduler.advance(const Duration(seconds: 26));
      await flush();

      final Map<String, Object?> beat =
          jsonDecode(harness.socket.sent[before]) as Map<String, Object?>;
      expect(beat['t'], equals('system.heartbeat'));
      expect(beat['ts'], isA<int>());

      await harness.controller.dispose();
    });

    test('send() reports false when not connected', () async {
      final Harness harness = Harness();
      final ClientFrame frame =
          harness.controller.buildFrame('typing.start', <String, Object?>{});
      // §8.4 wants unacked frames queued durably; that queue is out of scope,
      // so this reports the drop rather than pretending it went.
      expect(harness.controller.send(frame), isFalse);

      await harness.controller.dispose();
    });
  });
}
