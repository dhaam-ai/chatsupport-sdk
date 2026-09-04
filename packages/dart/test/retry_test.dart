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
          const MessageFailed(
            reason: SendFailureReason.rejected,
            retryable: true,
            code: ErrorCode.internal,
          ),
          // Back to pending, and the reason does NOT ride along: one message
          // cannot be in flight and permanently failed at the same time.
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

  // ── What retry() is NOT for any more ───────────────────────────────────
  //
  // Both groups below used to end in a Retry press, because a send that never
  // reached the wire was marked `failed` and a human was the only thing that
  // could move it. The queue moves it now, so these pin the same properties —
  // the original id, the original address, nothing lost — through the path
  // that no longer asks the customer for anything.
  //
  // retry() keeps exactly one job: a send the SERVER refused. Replaying that
  // on a timer would collect the same verdict, so it stays manual and stays
  // gated on the server's own `retryable` flag (the groups above).

  group('a send that was in flight when the connection dropped', () {
    test('goes back in the queue rather than sitting pending forever',
        () async {
      // The commonest real failure on a phone, and the one with no ack to
      // settle it: the frame reached the wire and the tunnel arrived before
      // the reply did. Nothing else will ever resolve this send, so leaving it
      // `pending` means a spinner that never stops.
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      await harness.socket.drop();
      await flush();

      expect(seen.last.id, equals(echo.id));
      expect(seen.last.delivery, equals(MessageDelivery.queued));
      expect(harness.client.queuedCount, equals(1));

      await harness.client.dispose();
    });

    test('replays under the original id, with nobody pressing anything',
        () async {
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

      // The id is the point: the server dedupes on it, so replaying a frame
      // it had already persisted before the drop resolves to one message
      // rather than two.
      expect(harness.sends.single['id'], equals(original));
      expect(original, equals(echo.id));
      expect(harness.client.queuedCount, isZero);

      // And there is nothing left for a Retry button to act on.
      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notFound),
        ),
      );

      await harness.client.dispose();
    });
  });

  group('a send that never reached the transport', () {
    test('is queued, and sends itself once there is a connection', () async {
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');
      expect(echo.delivery, equals(MessageDelivery.queued));

      await harness.connected();

      expect(harness.sends, hasLength(1));
      expect(harness.sends.single['id'], equals(echo.id));
      expect(harness.client.queuedCount, isZero);

      await harness.client.dispose();
    });

    test('is not something retry() will touch — it needs no affordance',
        () async {
      // The queue is the drain. A Retry button offered over a queued send
      // would either double-send it or, worse, invite the customer to babysit
      // something already handled.
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');

      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notFound),
        ),
      );
      // Refused, and still queued — the refusal did not consume it.
      expect(harness.client.queuedCount, equals(1));

      await harness.connected();
      expect(harness.sends, hasLength(1));

      await harness.client.dispose();
    });
  });

  group('the failure the host renders is the failure retry gates on', () {
    test('a rejection carries the server code and verdict onto the message',
        () async {
      // The two facts the AckFailureFrame arm used to hold and drop. Without
      // them a host could only discover retryability by CALLING retry() —
      // after the customer had already pressed a button that should never
      // have been drawn.
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: false));
      await flush();

      expect(
        seen.last.delivery,
        equals(
          const MessageFailed(
            reason: SendFailureReason.rejected,
            retryable: false,
            code: ErrorCode.validationFailed,
          ),
        ),
      );

      await harness.client.dispose();
    });

    test('a host that reads retryable off the message predicts the refusal',
        () async {
      // The whole point of the union. These two assertions must agree for
      // every failure: what the transcript decided to draw, and what retry()
      // decides to do. Reading them from one boolean is what makes agreeing
      // structural rather than a coincidence two files maintain.
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: false));
      await flush();

      final MessageDelivery delivery = seen.last.delivery;
      expect(delivery, isA<MessageFailed>());
      expect((delivery as MessageFailed).retryable, isFalse);

      expect(
        harness.client.retry(echo.id),
        isA<RetryRefused>().having(
          (RetryRefused r) => r.reason,
          'reason',
          equals(RetryRefusalReason.notRetryable),
        ),
      );
      // Nothing went out, and the record survives so the host may ask again
      // and get the same answer.
      expect(harness.sends, hasLength(1));

      await harness.client.dispose();
    });

    test('a retried message drops the reason it no longer has', () async {
      // A transcript that kept the failure alongside the retry would be
      // describing one message in two contradictory states at once.
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hello');
      harness.socket.deliver(rejectFor(echo.id, retryable: true));
      await flush();
      final RetryOutcome outcome = harness.client.retry(echo.id);
      await flush();

      expect(seen.last.delivery, isNot(isA<MessageFailed>()));
      expect(seen.last.delivery, equals(MessageDelivery.pending));
      expect(
        (outcome as RetryRetried).message.delivery,
        equals(MessageDelivery.pending),
        reason: 'RetryRetried.message must be the pending echo it documents',
      );

      await harness.client.dispose();
    });

    test('ships only the reasons this client can actually produce', () {
      // Guards the D17 call. Every value here needs a producer, and every
      // producer needs a sentence in the transcript; a value with neither is
      // a renderer branch nothing can reach. `expired`, `evicted` and
      // `storage` are absent until the durable offline queue (§9.1, §9.6)
      // gives them a way to happen — see SendFailureReason's own doc.
      expect(
        SendFailureReason.values,
        equals(<SendFailureReason>[
          SendFailureReason.rejected,
          SendFailureReason.sessionClosed,
        ]),
      );
    });
  });
}
