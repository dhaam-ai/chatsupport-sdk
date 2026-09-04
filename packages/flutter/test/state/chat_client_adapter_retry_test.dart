// The one chain nothing in this repo covered: a wire frame to a widget's
// verdict, through the real `ChatClient` and the real `ChatClientAdapter`.
//
// ── Why this is worth its ~100 lines ────────────────────────────────────
//
// `ChatClientAdapter` is the ONLY path from a live `ChatClient` to the widget
// layer, and it has no tests at all — every one of its members is a
// delegation nothing exercises. That is tolerable for a stream getter, where
// a wrong wire is a compile error. It is not tolerable for `retry`, because
// the whole point of this node is that the Retry button must be able to do
// what its label says, and everything ELSE about it is proven against a fake
// that answers however a test tells it to.
//
// So this drives the genuine article: a real `ChatClient` over a hand-fed
// socket, an `ack` with `ok: false` carrying the server's own `retryable` and
// §7.4 code, and the assertion that both survive the whole journey onto
// `ChatMessage.delivery` — and that a retry through the adapter puts the
// ORIGINAL envelope back on the wire.
//
// `packages/dart`'s own suite covers the protocol; this covers the seam
// between the two packages, which is nobody else's file.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// A socket whose inbound frames this file delivers by hand.
///
/// A local copy rather than an import: `packages/dart`'s `test/fakes.dart` is
/// not published, and reaching into another package's test directory would
/// make this file break on a refactor it has no stake in.
class _FakeSocket implements ChatSocket {
  final StreamController<String> _controller = StreamController<String>();
  final List<String> sent = <String>[];

  @override
  Stream<String> get frames => _controller.stream;

  @override
  void send(String frame) => sent.add(frame);

  @override
  Future<void> close([int? code, String? reason]) async {
    if (!_controller.isClosed) await _controller.close();
  }

  void deliver(String raw) {
    if (!_controller.isClosed) _controller.add(raw);
  }

  /// Every `message.send` written, newest last.
  List<Map<String, Object?>> get sends => sent
      .map((String raw) => jsonDecode(raw) as Map<String, Object?>)
      .where((Map<String, Object?> f) => f['t'] == 'message.send')
      .toList();
}

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String _ack() => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'sessionId': 's1',
        'seq': 0,
        'session': <String, Object?>{
          'sessionId': 's1',
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

String _reject(String ref, {required bool retryable, required String code}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'ok': false,
        'error': <String, Object?>{
          'code': code,
          'message': 'nope',
          'retryable': retryable,
        },
      },
    });

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late _FakeSocket socket;
  late ChatClient client;
  late WidgetChatClient adapter;

  setUp(() async {
    socket = _FakeSocket();
    client = ChatClient(
      wsUrl: Uri.parse('wss://example.test/ws'),
      publishableKey: PublishableKey.parse('dhp_test_abc123XYZ'),
      getToken: () async => 'token',
      socketFactory: (Uri _) async => socket,
    );
    adapter = ChatClientAdapter(client);
    final Future<void> connected = client.connect();
    await _flush();
    socket.deliver(_ack());
    await connected;
  });

  tearDown(() async {
    await client.dispose();
  });

  test("the server's retryable and code reach the widget layer intact",
      () async {
    final List<ChatMessage> seen = <ChatMessage>[];
    adapter.messages.listen(seen.add);

    final ChatMessage echo = adapter.sendMessage('hello');
    socket.deliver(
      _reject(echo.id, retryable: false, code: 'VALIDATION_FAILED'),
    );
    await _flush();

    // Everything the transcript needs to say WHY and to decide whether to
    // draw a button, on the message itself. Before the union it had a bare
    // `failed` and the two facts stayed inside a private map.
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
  });

  test('a retryable failure replays the ORIGINAL envelope through the adapter',
      () async {
    final ChatMessage echo = adapter.sendMessage('hello');
    socket.deliver(_reject(echo.id, retryable: true, code: 'INTERNAL'));
    await _flush();

    expect(adapter.retry(echo.id), isA<RetryRetried>());

    // Two `message.send` frames carrying ONE id — which is what the server
    // dedupes on (D1, §9.3). A retry that minted a fresh ULID would show up
    // here as two different ids and, in production, as two dead messages.
    expect(socket.sends, hasLength(2));
    expect(socket.sends[1]['id'], equals(socket.sends[0]['id']));
    expect(socket.sends[1]['id'], equals(echo.id));
  });

  test('a non-retryable failure is refused, and nothing goes out', () async {
    final ChatMessage echo = adapter.sendMessage('hello');
    socket.deliver(
      _reject(echo.id, retryable: false, code: 'VALIDATION_FAILED'),
    );
    await _flush();

    expect(
      adapter.retry(echo.id),
      isA<RetryRefused>().having(
        (RetryRefused r) => r.reason,
        'reason',
        equals(RetryRefusalReason.notRetryable),
      ),
    );
    expect(socket.sends, hasLength(1));
  });

  // ── The attachment hop ──────────────────────────────────────────────
  //
  // Same exposure `retry` had and for the same reason: `ChatClientAdapter`'s
  // members are one-line delegations that nothing exercises, so an
  // `attachment:` this adapter accepted and then quietly failed to pass on
  // would leave every attachment test in the package green — the controller
  // uploads, the composer calls back, the cubit forwards — while a customer
  // sends a message that mentions no file at all.
  //
  // So this asserts against the FRAME, not against a fake's record of the
  // call: the only thing that proves the file reached the wire is the wire.
  group('an uploaded attachment reaches the wire', () {
    const AttachmentMetadata photo = AttachmentMetadata(
      url: 'https://cdn.example.com/receipt.pdf',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      size: 4096,
      mediaType: 'DOCUMENT',
    );

    test('the metadata rides on the message.send frame', () async {
      adapter.sendMessage('here you go', attachment: photo);

      final Map<String, Object?> frame = socket.sends.single;
      final Map<String, Object?> payload = frame['d']! as Map<String, Object?>;
      final Map<String, Object?> sent =
          payload['attachment']! as Map<String, Object?>;

      expect(sent['url'], 'https://cdn.example.com/receipt.pdf');
      expect(sent['fileName'], 'receipt.pdf');
      expect(sent['mimeType'], 'application/pdf');
      expect(sent['size'], 4096);
      expect(sent['mediaType'], 'DOCUMENT');
    });

    test('the optimistic echo describes the frame that went out', () async {
      // The transcript draws its attachment bubble from the echo, so an echo
      // that dropped the file would show the caption with no file under it
      // until the server's confirmation landed — or forever, offline.
      final ChatMessage echo =
          adapter.sendMessage('here you go', attachment: photo);

      expect(echo.attachment, equals(photo));
    });

    test('a send with no file omits the key entirely, never sends null',
        () async {
      adapter.sendMessage('just words');

      final Map<String, Object?> payload =
          socket.sends.single['d']! as Map<String, Object?>;

      // Absent, not present-and-null: `messageSendPayload` omits it, and a
      // literal null would be a claim that this message HAS an attachment
      // which is nothing.
      expect(payload.containsKey('attachment'), isFalse);
    });

    test('a file travels on the same send as its caption', () async {
      // One message, not two. A separate attachment send would let whatever
      // else arrives in between separate a caption from the file it
      // describes.
      adapter.sendMessage('the receipt you asked for', attachment: photo);

      expect(socket.sends, hasLength(1));
      final Map<String, Object?> payload =
          socket.sends.single['d']! as Map<String, Object?>;
      expect(payload['content'], 'the receipt you asked for');
      expect(payload['attachment'], isNotNull);
    });
  });

  test('the adapter forwards the id it was given, not some other message',
      () async {
    // The one failure mode a type-checked one-line delegation still has.
    final ChatMessage first = adapter.sendMessage('one');
    final ChatMessage second = adapter.sendMessage('two');
    socket.deliver(_reject(first.id, retryable: true, code: 'INTERNAL'));
    socket.deliver(_reject(second.id, retryable: true, code: 'INTERNAL'));
    await _flush();

    expect(adapter.retry(second.id), isA<RetryRetried>());

    expect(socket.sends, hasLength(3));
    expect(socket.sends[2]['id'], equals(second.id));
    expect(socket.sends[2]['id'], isNot(equals(first.id)));
  });
}
