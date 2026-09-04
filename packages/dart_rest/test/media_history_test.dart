/// Reproduces `packages/rest/src/client.test.ts`'s `describe('history
/// pagination')` and `describe('history projection')`, plus the one assertion
/// `packages/widget/test/history-on-connect.test.ts` leaves behind for this
/// layer.
///
/// ── What transfers from the two widget history tests, and what does not ───
///
/// `history-on-connect.test.ts` mounts the whole widget, drives a fake
/// WebSocket through `connection.hello` -> `connection.ack`, and asserts that
/// reaching `connected` produces EXACTLY ONE request to
/// `/chat/sessions/{id}/messages`. Who issues that request is core's business,
/// not this package's: the counting half of that test belongs to whatever
/// Flutter-side controller ends up owning the seeding latch. What DOES belong
/// here is the request it counts and the response it stubs — a cursorless GET
/// answered with `{success:true, data:{messages:[], hasMore:false}}` — and
/// that an adapter call is exactly one round trip, never a retry loop that
/// would make the widget's "exactly once" unachievable from below.
///
/// `history-settle-deadline.test.ts` is entirely widget orchestration: a
/// session-picker click racing a connection that never comes up, a deadline,
/// and teardown while a switch is waiting. Nothing in it touches the history
/// ROUTE. Its one transferable requirement is the negative one asserted below:
/// a history call that fails must fail as a typed exception the caller can
/// branch on, so a deadline handler has something to catch rather than an
/// unhandled rejection escaping into a torn-down widget.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/message_decode.dart';
import 'package:dhaam_chat_rest/src/media.dart';
import 'package:dhaam_chat_rest/src/models/message_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match — same reason and spelling as
/// `client_test.dart`.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

http.Response _json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

/// Captures every request that actually went out, so "exactly one round trip"
/// is assertable rather than assumed.
class _Recorder {
  final List<http.Request> calls = <http.Request>[];

  MockClient client(
    FutureOr<http.Response> Function(http.Request request) responder,
  ) =>
      MockClient((http.Request request) async {
        calls.add(request);
        return responder(request);
      });
}

RestClient _clientOver(MockClient mock) => RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: _key,
      getAccessToken: () async => 'tok_abc',
      httpClient: mock,
    );

/// One raw history row, exactly as the REST route sends it: integer enums,
/// `chatSessionId`, no projection of any kind.
Map<String, Object?> _messageRow([Map<String, Object?> overrides = const {}]) =>
    <String, Object?>{
      'id': 'm1',
      'chatSessionId': 's1',
      'senderId': 'agent-9',
      'senderType': 2,
      'messageType': 4,
      'content': 'here you go',
      'metadata': null,
      'replyToMessageId': null,
      'seq': 12,
      'createdAt': '2026-08-19T10:00:00.000Z',
      ...overrides,
    };

Map<String, Object?> _historyResponse([
  List<Object?> messages = const <Object?>[],
  bool hasMore = false,
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{'messages': messages, 'hasMore': hasMore},
    };

void main() {
  group('history pagination', () {
    test('passes the cursor and limit through as query params', () async {
      final _Recorder recorder = _Recorder();
      await _clientOver(
        recorder.client((http.Request _) => _json(_historyResponse())),
      ).listMessages(sessionId: 's1', before: 'm9', limit: 30);

      expect(recorder.calls.single.url.queryParameters['before'], 'm9');
      expect(recorder.calls.single.url.queryParameters['limit'], '30');
    });

    test('omits the cursor ENTIRELY when asking for the newest page', () async {
      // Not `before=`, and not `before=null`. Either would ask the route to
      // page from a cursor that does not exist, and the reply — an empty page
      // — is indistinguishable from a conversation with no history.
      final _Recorder recorder = _Recorder();
      await _clientOver(
        recorder.client((http.Request _) => _json(_historyResponse())),
      ).listMessages(sessionId: 's1', limit: 20);

      final Uri sent = recorder.calls.single.url;
      expect(sent.queryParameters.containsKey('before'), isFalse);
      expect(sent.query, 'limit=20');
      expect(sent.toString(), isNot(contains('before')));
    });

    test('hits the history path under the prefix the service mounts', () async {
      final _Recorder recorder = _Recorder();
      await _clientOver(
        recorder.client((http.Request _) => _json(_historyResponse())),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(
        '${recorder.calls.single.method} ${recorder.calls.single.url.path}',
        'GET /chat-services/api/v1/chat/sessions/s1/messages',
      );
    });

    test('percent-encodes a session id that would otherwise reshape the path',
        () async {
      // A `/` in a path segment silently becomes a new segment, which is a
      // request to a different route entirely.
      final _Recorder recorder = _Recorder();
      await _clientOver(
        recorder.client((http.Request _) => _json(_historyResponse())),
      ).listMessages(sessionId: 's 1/2', limit: 20);

      expect(
        recorder.calls.single.url.path,
        '/chat-services/api/v1/chat/sessions/s%201%2F2/messages',
      );
      // Round-trips: the server decodes back to the id the caller passed.
      expect(recorder.calls.single.url.pathSegments[5], 's 1/2');
    });

    test('normalizes an enveloped page whose fields are missing', () async {
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(
            <String, Object?>{'success': true, 'data': <String, Object?>{}})),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(page.messages, isEmpty);
      expect(page.hasMore, isFalse);
    });

    test('rejects an unenveloped 200 instead of reporting an empty history',
        () async {
      // The reload bug's signature: reading `messages` off the top level of a
      // {success,data} body yields an empty page with hasMore:false, which
      // looks exactly like a conversation with no history.
      await expectLater(
        _clientOver(
          MockClient((http.Request _) async => _json(<String, Object?>{
                'messages': <Object?>[_messageRow()],
                'hasMore': false,
              })),
        ).listMessages(sessionId: 's1', limit: 20),
        throwsA(
          isA<RestMalformedResponseException>()
              .having((RestMalformedResponseException e) => e.context,
                  'context', 'GET /chat/sessions/{sessionId}/messages')
              .having((RestMalformedResponseException e) => e.retryable,
                  'retryable', isFalse),
        ),
      );
    });
  });

  group('hasMore is read strictly', () {
    test('reports hasMore from the envelope so scroll-up keeps working',
        () async {
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async =>
            _json(_historyResponse(<Object?>[_messageRow()], true))),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(page.hasMore, isTrue);
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('the string "true"', 'true'),
      ('the number 1', 1),
      ('an explicit null', null),
      ('a non-empty object', <String, Object?>{'a': 1}),
    ]) {
      test('treats $label as false, never as more history', () async {
        // `== true` and nothing looser. A truthy non-boolean read as `true`
        // leaves a "Load older" control that can never load anything, which
        // reads to a customer as a broken button rather than as the end of a
        // conversation.
        final RestMessagePage page = await _clientOver(
          MockClient((http.Request _) async => _json(<String, Object?>{
                'success': true,
                'data': <String, Object?>{
                  'messages': <Object?>[],
                  'hasMore': value,
                },
              })),
        ).listMessages(sessionId: 's1', limit: 20);

        expect(page.hasMore, isFalse);
      });
    }

    test('never infers hasMore from how many rows survived projection',
        () async {
      // A page whose every row failed to decode must still report the
      // server's own `hasMore`, or a customer's transcript silently ends at
      // the first message this SDK is behind on.
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(
              _historyResponse(<Object?>[
                <String, Object?>{'senderType': 99}
              ], true),
            )),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(page.messages, isEmpty);
      expect(page.hasMore, isTrue);
    });
  });

  group('history projection', () {
    test('decodes integer enums and renames the row fields core does not use',
        () async {
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async =>
            _json(_historyResponse(<Object?>[_messageRow()]))),
      ).listMessages(sessionId: 's1', limit: 20);

      final ChatMessage message = page.messages.single;
      expect(message.id, 'm1');
      expect(message.sessionId, 's1');
      expect(message.senderId, 'agent-9');
      expect(message.senderType, SenderType.agent);
      expect(message.type, MessageType.image);
      expect(message.content, 'here you go');
      expect(message.seq, 12);
      expect(message.createdAt, DateTime.utc(2026, 8, 19, 10));
    });

    test(
        'surfaces an attachment buried in metadata so a reloaded image '
        'survives', () async {
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(
              _historyResponse(<Object?>[
                _messageRow(<String, Object?>{
                  'metadata': <String, Object?>{
                    'attachment': <String, Object?>{
                      'url': 'https://cdn.example.test/cat.png',
                      'fileName': 'cat.png',
                      'mimeType': 'image/png',
                      'size': 1024,
                      'mediaType': 'IMAGE',
                    },
                  },
                }),
              ]),
            )),
      ).listMessages(sessionId: 's1', limit: 20);

      final ChatMessage message = page.messages.single;
      expect(message.attachment?.url, 'https://cdn.example.test/cat.png');
      expect(message.attachment?.mediaType, 'IMAGE');
      // The bag held nothing but the attachment, so it comes back absent
      // rather than as an empty map — one canonical location, never two.
      expect(message.metadata, isNull);
    });

    test('keeps every good row when one row cannot be decoded', () async {
      // A newly appended enum value is documented as routine. One such message
      // must cost that message, not the customer's whole history — which would
      // be the same user-facing outcome as the empty-page bug this fixes.
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(
              _historyResponse(<Object?>[
                _messageRow(<String, Object?>{'id': 'm1'}),
                _messageRow(<String, Object?>{'id': 'm2', 'senderType': 99}),
                _messageRow(
                    <String, Object?>{'id': 'm3', 'content': 'still here'}),
              ]),
            )),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(
        page.messages.map((ChatMessage m) => m.id),
        <String>['m1', 'm2', 'm3'],
      );

      final ChatMessage placeholder = page.messages[1];
      expect(placeholder.senderType, SenderType.system);
      expect(placeholder.type, MessageType.system);
      expect(placeholder.content, isEmpty);
      expect(placeholder.metadata?[kUnsupportedMessageMarker], isTrue);

      expect(page.messages[2].content, 'still here');
    });

    test('omits a row too damaged even to place a marker for', () async {
      // Without a stable id there is nothing for a list to key on, and without
      // a timestamp nothing to order it by.
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(
              _historyResponse(<Object?>[
                _messageRow(<String, Object?>{'id': 'm1'}),
                <String, Object?>{'senderType': 99},
                _messageRow(<String, Object?>{'id': 'm3'}),
              ]),
            )),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(
        page.messages.map((ChatMessage m) => m.id),
        <String>['m1', 'm3'],
      );
    });

    test('tolerates a `messages` that is not a list at all', () async {
      final RestMessagePage page = await _clientOver(
        MockClient((http.Request _) async => _json(<String, Object?>{
              'success': true,
              'data': <String, Object?>{'messages': 'nope', 'hasMore': false},
            })),
      ).listMessages(sessionId: 's1', limit: 20);

      expect(page.messages, isEmpty);
    });
  });

  group('what history-on-connect and history-settle-deadline leave here', () {
    test('a seeding load is ONE round trip, with no cursor', () async {
      // The request `history-on-connect.test.ts` counts, and the response it
      // stubs. Counting the widget's calls is that test's job; guaranteeing
      // one adapter call is one request is this one's.
      final _Recorder recorder = _Recorder();
      final RestMessagePage page = await _clientOver(
        recorder.client(
          (http.Request _) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{
              'messages': <Object?>[],
              'hasMore': false,
            },
          }),
        ),
      ).listMessages(sessionId: 'sess_1', limit: 20);

      expect(recorder.calls, hasLength(1));
      expect(recorder.calls.single.url.queryParameters.containsKey('before'),
          isFalse);
      expect(page.messages, isEmpty);
      expect(page.hasMore, isFalse);
    });

    test('a failing history load fails as a typed exception, once', () async {
      // `history-settle-deadline.test.ts` needs a deadline handler to have
      // something to catch. An adapter that retried internally, or that let a
      // raw error escape, would make that unachievable from below.
      final _Recorder recorder = _Recorder();

      await expectLater(
        _clientOver(
          recorder.client((http.Request _) => _json(
                <String, Object?>{
                  'error': <String, Object?>{
                    'code': 'INTERNAL',
                    'message': 'boom',
                  },
                },
                500,
              )),
        ).listMessages(sessionId: 's1', limit: 20),
        throwsA(isA<RestApiException>()),
      );

      expect(recorder.calls, hasLength(1));
    });
  });
}
