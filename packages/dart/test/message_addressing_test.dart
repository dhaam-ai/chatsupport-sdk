/// A message is addressed to the session it was COMPOSED in.
///
/// ── The bug this exists to make unreachable ───────────────────────────────
///
/// `message.send` used to carry no session at all, so the server filed every
/// message under whatever session the CONNECTION last joined. "Whatever was
/// joined last" is a property of the connection, not of the message, and the
/// two diverge for as long as a send outlives the session it was typed in.
///
/// This package has no offline queue, so the divergence does not arrive the
/// way it did in the TypeScript core (compose in B, flush after switching to
/// A). It arrives through the two places where a frame built at one moment
/// reaches the wire at another:
///
///  1. [ChatClient.retry] — the whole point of that method is to replay a
///     frame built arbitrarily long ago. Anything that repointed the session
///     in between silently redirected the replay.
///  2. A reconnect. `connection.ack` carries a session the client never asked
///     for (README drift #5), so a reconnect can hand this client a DIFFERENT
///     session than the one a still-failed send was composed in — and the
///     sends orphaned by that same disconnect are exactly the ones a host
///     offers a Retry button for.
///
/// In both, a message the customer typed into one conversation was delivered
/// into another, acked as success. No client-side ordering fix reaches it,
/// because the wire could not express the fact being lost.
///
/// `d.sessionId` is that fact. Optional on the wire — absent means the old
/// behaviour, so an older client keeps working — and ownership-checked by the
/// server when present, with NO fallback to the joined session on a failed
/// check.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:test/test.dart';

import 'fakes.dart';

final PublishableKey testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String ackJson({String sessionId = 's1', int seq = 5}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': seq,
        'session': <String, Object?>{
          'sessionId': sessionId,
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

/// The `session.updated` the server pushes right after it acks a
/// `session.join` — the frame that makes a join real for this client.
String sessionUpdatedJson(String sessionId) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'session.updated',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'session': <String, Object?>{
          'sessionId': sessionId,
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

String rejectFor(String ref) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'ok': false,
        'error': <String, Object?>{
          'code': 'INTERNAL',
          'message': 'nope',
          'retryable': true,
        },
      },
    });

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

  /// Every `message.send` payload written to ANY socket this harness opened,
  /// newest last.
  ///
  /// Across sockets deliberately: a retry after a reconnect writes to a
  /// different socket than the original send, and reading only the current
  /// one would make the pair invisible.
  List<Map<String, Object?>> get sends => <Map<String, Object?>>[
        for (final FakeSocket socket in sockets)
          for (final String raw in socket.sent)
            if ((jsonDecode(raw) as Map<String, Object?>)['t'] ==
                'message.send')
              (jsonDecode(raw) as Map<String, Object?>)['d']!
                  as Map<String, Object?>,
      ];

  /// Drives a `session.join` all the way through the server's answer.
  Future<void> joinAndSettle(String sessionId) async {
    client.joinSession(sessionId);
    await flush();
    socket.deliver(sessionUpdatedJson(sessionId));
    await flush();
  }
}

void main() {
  group('a send names its own session', () {
    test('carries the composed session as d.sessionId', () async {
      final Harness harness = Harness();
      await harness.connected();

      harness.client.sendMessage('hello');

      expect(harness.sends.single['sessionId'], equals('s1'));

      await harness.client.dispose();
    });

    test('omits the field entirely when there is no session to name', () async {
      // NOT an empty string. The server validates `sessionId` as a non-empty
      // string WHEN PRESENT, so `''` is VALIDATION_FAILED at the edge — and
      // `_sessionId ?? ''` is the obvious wrong way to write this. Absent is
      // the documented "fall back to the joined session" signal.
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');
      await harness.connected();
      harness.client.retry(echo.id);

      expect(harness.sends.single.containsKey('sessionId'), isFalse);

      await harness.client.dispose();
    });

    test('the optimistic echo and the wire name the same session', () async {
      // A host renders the echo and the server files the frame. If those two
      // disagree the message appears in one conversation and lands in another,
      // which is the same bug seen from the two ends.
      final Harness harness = Harness();
      await harness.connected(sessionId: 's7');

      final ChatMessage echo = harness.client.sendMessage('hello');

      expect(echo.sessionId, equals('s7'));
      expect(harness.sends.single['sessionId'], equals('s7'));

      await harness.client.dispose();
    });
  });

  group('a retry replays the original address', () {
    test(
        'a session change between the failure and the retry does not '
        'redirect the message', () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('meant for s1');
      harness.socket.deliver(rejectFor(echo.id));
      await flush();

      // The customer moves to another conversation, and only then presses
      // Retry on the message they typed in the first one.
      await harness.joinAndSettle('s2');
      expect(harness.client.retry(echo.id), isA<RetryRetried>());

      expect(harness.sends, hasLength(2));
      expect(harness.sends[1]['sessionId'], equals('s1'));
      expect(
        harness.sends[1],
        equals(harness.sends[0]),
        reason: 'a retry must replay the frame AS SENT, address and all',
      );

      await harness.client.dispose();
    });

    test(
        'a reconnect that lands a different session does not redirect a '
        'send composed before the drop', () async {
      // README drift #5: the server resolves a session during the handshake
      // and puts it in `connection.ack`, so a reconnect can hand this client a
      // session it never asked for — and the sends orphaned by that same drop
      // are the ones the queue is about to replay onto it, automatically.
      //
      // This is where the address earns its keep. Without it the replay is
      // filed under whatever the CONNECTION last joined, and the customer's
      // message lands in a conversation they were never in — acked as success.
      final Harness harness = Harness();
      await harness.connected();

      harness.client.sendMessage('meant for s1');
      await harness.socket.drop();
      await flush();
      await harness.scheduler.advanceToNextTimer();
      await flush();
      harness.socket.deliver(ackJson(sessionId: 's2'));
      await flush();

      // Nobody pressed anything: the drain wrote it.
      expect(harness.sends, hasLength(2));
      expect(harness.sends[1]['sessionId'], equals('s1'));
      expect(harness.client.queuedCount, isZero);

      await harness.client.dispose();
    });

    test('two failures composed in two sessions keep two addresses', () async {
      // The property a single "current session" pointer cannot express: the
      // set of un-sent messages spans conversations, and each one belongs to
      // its own. Retried from a THIRD session, so neither answer can be the
      // one the pointer happens to hold.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage first = harness.client.sendMessage('for s1');
      harness.socket.deliver(rejectFor(first.id));
      await flush();

      await harness.joinAndSettle('s2');
      final ChatMessage second = harness.client.sendMessage('for s2');
      harness.socket.deliver(rejectFor(second.id));
      await flush();

      await harness.joinAndSettle('s3');
      expect(harness.client.retry(first.id), isA<RetryRetried>());
      expect(harness.client.retry(second.id), isA<RetryRetried>());

      expect(
        harness.sends.map((Map<String, Object?> d) => d['sessionId']).toList(),
        equals(<String>['s1', 's2', 's1', 's2']),
      );

      await harness.client.dispose();
    });

    test(
        'a send composed while disconnected keeps the session it was typed '
        'in', () async {
      // Distinct from the orphaned-in-flight path: this frame never reached
      // the transport at all, so its address is the only record of where it
      // was going. The reconnect then lands a different session, and the queue
      // drains onto it without asking anyone.
      final Harness harness = Harness();
      await harness.connected();

      await harness.socket.drop();
      await flush();
      final ChatMessage echo = harness.client.sendMessage('typed offline');
      expect(echo.delivery, equals(MessageDelivery.queued));

      await harness.scheduler.advanceToNextTimer();
      await flush();
      harness.socket.deliver(ackJson(sessionId: 's2'));
      await flush();

      // `sends` in this file unwraps to the PAYLOAD, so the envelope id is not
      // visible here — retry_test.dart pins that half. What this one is about
      // is the address, and it survived a reconnect into another session.
      expect(harness.sends.single['sessionId'], equals('s1'));
      expect(echo.delivery, equals(MessageDelivery.queued));

      await harness.client.dispose();
    });
  });

  group('which session a message is composed in', () {
    test('a join does not repoint it until the server\'s snapshot lands',
        () async {
      // The Dart mirror of the window that the TypeScript core's session
      // switch was rebuilt to remove. `sessions` is what a host renders off,
      // and it only moves on a snapshot — so between `joinSession` and
      // `session.updated` the host is still showing the OUTGOING conversation.
      // A message typed into that screen belongs to the conversation on it.
      //
      // Pre-pointing is also unrecoverable when the join is REFUSED: nothing
      // rolls it back, so every later send names a session this client is not
      // in and the server refuses each one.
      final Harness harness = Harness();
      await harness.connected();

      harness.client.joinSession('s2');
      await flush();
      harness.client.sendMessage('typed while s1 is still on screen');

      expect(harness.sends.single['sessionId'], equals('s1'));

      await harness.client.dispose();
    });

    test('the snapshot is what commits the move', () async {
      final Harness harness = Harness();
      await harness.connected();

      await harness.joinAndSettle('s2');
      harness.client.sendMessage('typed in s2');

      expect(harness.sends.single['sessionId'], equals('s2'));

      await harness.client.dispose();
    });
  });
}
