/// A retry replays the ORIGINAL envelope, id and all.
///
/// ── The bug this exists to make unreachable ───────────────────────────────
///
/// The envelope id IS the permanent message id (D1) and the server dedupes on
/// it — `@@unique([chatSessionId, clientMessageId])`. A "retry" that builds a
/// fresh frame therefore mints a fresh ULID, defeats the dedup, and creates a
/// second, distinct message. When the underlying reason for the failure has
/// not gone away, every press of Retry spawns another failed message and the
/// user watches their thread fill with copies of a message that never sent.
///
/// The only defence that works is structural: retry replays a frame that was
/// built once, rather than describing a message to be built again.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:test/test.dart';

import 'fakes.dart';

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

String acceptFor(String ref, {int seq = 9}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{'ok': true, 'seq': seq},
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

  Future<void> connected() async {
    unawaited(client.connect());
    await flush();
    socket.deliver(ackJson());
    await flush();
  }

  /// Every `message.send` this client has written, newest last.
  List<Map<String, Object?>> get sends => socket.sent
      .map((String raw) => jsonDecode(raw) as Map<String, Object?>)
      .where((Map<String, Object?> frame) => frame['t'] == 'message.send')
      .toList();
}

void main() {
  group('retry replays the original envelope', () {
    test('reuses the id the server dedupes on', () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();

      final RetryOutcome outcome = harness.client.retry(echo.id);

      expect(outcome, isA<RetryRetried>());
      expect(harness.sends, hasLength(2));
      expect(
        harness.sends[1]['id'],
        equals(harness.sends[0]['id']),
        reason: 'the retry minted a fresh ULID and defeated server dedup',
      );
      expect(harness.sends[1]['id'], equals(echo.id));

      await harness.client.dispose();
    });

    test('replays the payload byte for byte, not a rebuilt one', () async {
      // A rebuilt payload is a second chance to get `type` or `attachment`
      // wrong, and a `createdAt` that drifts on every press.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo =
          harness.client.sendMessage('hello', type: MessageType.text);
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();

      harness.client.retry(echo.id);

      expect(harness.sends[1]['d'], equals(harness.sends[0]['d']));

      await harness.client.dispose();
    });

    test('re-emits the message as pending, under the same id', () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();
      harness.client.retry(echo.id);
      await flush();

      expect(
        seen.map((ChatMessage m) => m.delivery).toList(),
        equals(<MessageDelivery>[
          MessageDelivery.pending,
          MessageDelivery.failed,
          MessageDelivery.pending,
        ]),
      );
      expect(seen.every((ChatMessage m) => m.id == echo.id), isTrue);

      await harness.client.dispose();
    });

    test('a retried send settles normally when the server accepts it',
        () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();
      harness.client.retry(echo.id);
      await flush();
      harness.socket.deliver(acceptFor(echo.id, seq: 9));
      await flush();

      expect(seen.last.delivery, equals(MessageDelivery.confirmed));
      expect(seen.last.seq, equals(9));
      expect(seen.last.id, equals(echo.id));

      await harness.client.dispose();
    });
  });

  group('refusals', () {
    test('an id with nothing failed under it is not-found', () async {
      final Harness harness = Harness();
      await harness.connected();

      expect(
        harness.client.retry('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notFound),
        ),
      );

      await harness.client.dispose();
    });

    test('a send still in flight is not-found, not double-sent', () async {
      // It has not failed. Re-sending it here would put the same envelope on
      // the wire twice while the first is still outstanding.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');

      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notFound),
        ),
      );
      expect(harness.sends, hasLength(1));

      await harness.client.dispose();
    });

    test('a successful retry is claimed — a second press finds nothing',
        () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();

      expect(harness.client.retry(echo.id), isA<RetryRetried>());
      expect(harness.client.retry(echo.id), isA<RetryRefused>());
      expect(harness.sends, hasLength(2));

      await harness.client.dispose();
    });

    test('honours the server saying retrying is futile', () async {
      // Gated on the server's own flag rather than a second, hand-maintained
      // copy of §7.4's code table.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: false));
      await flush();

      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notRetryable),
        ),
      );
      expect(harness.sends, hasLength(1));

      await harness.client.dispose();
    });

    test('a not-retryable refusal is not destructive', () async {
      // Refusing must not consume the record: the app is still rendering this
      // message as failed and may ask again.
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: false));
      await flush();

      harness.client.retry(echo.id);
      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notRetryable),
        ),
      );

      await harness.client.dispose();
    });
  });

  group('a send that was in flight when the connection dropped', () {
    test('is failed rather than left pending forever', () async {
      // The commonest real failure on a phone, and the one with no ack to
      // settle it: the frame reached the wire and the tunnel arrived before
      // the reply did. Nothing else will ever resolve this send, so leaving it
      // `pending` means a spinner that never stops and a Retry button a host
      // has no reason to render.
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      await harness.socket.drop();
      await flush();

      expect(seen.last.id, equals(echo.id));
      expect(seen.last.delivery, equals(MessageDelivery.failed));

      await harness.client.dispose();
    });

    test('is retryable, and replays under the original id', () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');
      final String original = harness.sends.single['id']! as String;

      await harness.socket.drop();
      await flush();
      await harness.scheduler.advanceToNextTimer();
      await flush();
      harness.socket.deliver(ackJson());
      await flush();

      expect(harness.client.retry(echo.id), isA<RetryRetried>());
      expect(harness.sends.single['id'], equals(original));
      expect(original, equals(echo.id));

      await harness.client.dispose();
    });
  });

  group('a send that never reached the transport', () {
    test('defaults to retryable — there was no server flag to read', () async {
      // kDefaultRetryable. The flag gates a Retry affordance, so defaulting to
      // false silently removes a button that would have worked.
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');
      expect(echo.delivery, equals(MessageDelivery.failed));

      await harness.connected();

      final RetryOutcome outcome = harness.client.retry(echo.id);

      expect(outcome, isA<RetryRetried>());
      expect(harness.sends, hasLength(1));
      expect(harness.sends.single['id'], equals(echo.id));

      await harness.client.dispose();
    });

    test('a retry with nowhere to send is refused and stays retryable',
        () async {
      // There is no durable queue behind this method, so "accepted" would be
      // a promise nothing keeps. The record survives the refusal, so the same
      // press succeeds once the connection is back.
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');

      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.disconnected),
        ),
      );

      await harness.connected();
      expect(harness.client.retry(echo.id), isA<RetryRetried>());

      await harness.client.dispose();
    });
  });
}
