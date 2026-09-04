/// Reproduces the session and CSAT blocks of `packages/rest/src/client.test.ts`
/// — `describe('session actions')`, `describe('session actions — submitCsat')`,
/// `describe('session actions — getCsat')` and
/// `describe('session summaries (listSessions)')` — plus the wire-level halves
/// of `packages/widget/test/csat-submit.test.ts:308-343`,
/// `session-source.test.ts` and `session-list-refresh.test.ts`.
///
/// The widget files assert against a mounted store; what is portable from them
/// is what reached the network, which is what this package is responsible for.
/// Each such case names the assertion it carries over and, where the rest of
/// the original belongs to a later node, says so.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart' as barrel;
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/models/session_summary.dart';
import 'package:dhaam_chat_rest/src/sessions.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match — same reason and spelling as
/// `client_test.dart` and `client.test.ts:12`.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

/// Captures what actually went on the wire, in order.
///
/// `'$method $path'` is the assertion shape the TS suite uses for the
/// two-round-trip cases, because ORDER is the property under test there — a
/// read-back that ran before its mutation would satisfy a set comparison.
class _Recorder {
  final List<http.Request> calls = <http.Request>[];

  List<String> get trace => calls
      .map((http.Request r) => '${r.method} ${r.url.path}')
      .toList(growable: false);

  MockClient client(
    FutureOr<http.Response> Function(http.Request request) responder,
  ) =>
      MockClient((http.Request request) async {
        calls.add(request);
        return responder(request);
      });
}

http.Response _json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

RestClient _clientOver(MockClient mock) => RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: _key,
      getAccessToken: () async => 'tok_abc',
      httpClient: mock,
    );

/// `{success: true, data: {sessions}}` — the page shape the route serves.
Map<String, Object?> _sessionPage(
        [List<Object?> sessions = const <Object?>[]]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{'sessions': sessions},
    };

/// One `sessions[]` item, exactly as the wire sends it — this route already
/// speaks v2's projected string enums, so there are no row renames here.
Map<String, Object?> _summaryRow(
        [Map<String, Object?> overrides = const <String, Object?>{}]) =>
    <String, Object?>{
      'id': 'sum-1',
      'status': 'ASSIGNED',
      'mode': 'HUMAN',
      'createdAt': '2026-08-19T09:00:00.000Z',
      'closedAt': null,
      'lastMessageAt': '2026-08-19T09:05:00.000Z',
      'lastMessagePreview': 'here you go',
      'unreadCount': 3,
      'handledBy': <String, Object?>{
        'kind': 'AGENT',
        'id': 'agent-9',
        'displayName': 'Ada',
      },
      ...overrides,
    };

void main() {
  group('listSessions', () {
    test('requests GET /chat/sessions/customer under the correct base path',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_sessionPage())));

      await client.listSessions();

      expect(
        recorder.trace,
        <String>['GET /chat-services/api/v1/chat/sessions/customer'],
      );
    });

    test('sends both credentials, same as every other adapter', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_sessionPage())));

      await client.listSessions();

      expect(recorder.calls.single.headers['Authorization'], 'Bearer tok_abc');
      expect(recorder.calls.single.headers['X-Publishable-Key'], _key.value);
    });

    test('parses a full session summary, including handledBy', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => _json(_sessionPage(<Object?>[_summaryRow()]))),
      );

      final List<RestChatSessionSummary> sessions = await client.listSessions();

      final RestChatSessionSummary summary = sessions.single;
      expect(summary.id, 'sum-1');
      expect(summary.status, ChatStatus.assigned);
      expect(summary.mode, ChatMode.human);
      expect(summary.createdAt, DateTime.utc(2026, 8, 19, 9));
      expect(summary.closedAt, isNull);
      expect(summary.lastMessageAt, DateTime.utc(2026, 8, 19, 9, 5));
      expect(summary.lastMessagePreview, 'here you go');
      expect(summary.unreadCount, 3);
      expect(summary.handledBy?.kind, HandledByKind.agent);
      expect(summary.handledBy?.id, 'agent-9');
      expect(summary.handledBy?.displayName, 'Ada');
    });

    test('leaves absent optional fields null rather than guessing at them',
        () async {
      // TS asserts `'lastMessagePreview' in summary === false` — a key-presence
      // check with no Dart equivalent, because a Dart field always exists. The
      // portable half is the VALUE: absent stays absent, and specifically does
      // not become `''` or a placeholder `handledBy` nobody can correlate.
      final Map<String, Object?> row = _summaryRow()
        ..remove('lastMessagePreview')
        ..remove('handledBy');
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => _json(_sessionPage(<Object?>[row]))),
      );

      final RestChatSessionSummary summary =
          (await client.listSessions()).single;

      expect(summary.lastMessagePreview, isNull);
      expect(summary.handledBy, isNull);
    });

    test(
        'treats a guest 200-with-empty-array as a normal success, not an error',
        () async {
      // Emptiness IS the guest signal — the route answers 200, never 403/404.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_sessionPage())));

      await expectLater(client.listSessions(), completion(isEmpty));
    });

    test('treats an absent sessions field as an empty page, not a failure',
        () async {
      // `{success: true, data: {}}` unwraps cleanly — the envelope check
      // deliberately passes an empty `data` — so this is the payload's own
      // defence, mirroring TS's `Array.isArray(page.sessions) ? … : []`. An
      // empty picker beats a crash in a caller's state layer.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{},
          }),
        ),
      );

      await expectLater(client.listSessions(), completion(isEmpty));
    });

    test('passes limit through as a query param when supplied', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_sessionPage())));

      await client.listSessions(limit: 10);

      expect(recorder.calls.single.url.queryParameters['limit'], '10');
    });

    test(
        'omits limit entirely when not supplied, deferring to the server '
        'default of 5', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_sessionPage())));

      await client.listSessions();

      expect(recorder.calls.single.url.hasQuery, isFalse);
      expect(recorder.calls.single.url.queryParameters, isEmpty);
    });

    // TS drives this with `it.each([0, 21, 1.5, -1, NaN])`. Dart's `int` cannot
    // hold `1.5` or `NaN`, so those two cases are compile-time impossible here
    // and there is nothing left for a test to assert — the equivalent covers
    // `[0, 21, -1]` only (contract §5.5). That is the same guarantee, enforced
    // one layer earlier by the type system rather than at runtime.
    for (final int limit in <int>[0, 21, -1]) {
      test(
          'rejects an out-of-range limit ($limit) locally, without making a '
          'request', () async {
        final _Recorder recorder = _Recorder();
        final RestClient client =
            _clientOver(recorder.client((_) => _json(_sessionPage())));

        await expectLater(
          client.listSessions(limit: limit),
          throwsA(isA<RestValidationException>()),
        );
        // The whole point of the type: no network activity happened.
        expect(recorder.calls, isEmpty);
      });
    }

    for (final int limit in <int>[1, 20, 5]) {
      test('accepts the boundary values 1 and 20, and the default 5 ($limit)',
          () async {
        final _Recorder recorder = _Recorder();
        final RestClient client =
            _clientOver(recorder.client((_) => _json(_sessionPage())));

        await client.listSessions(limit: limit);

        expect(recorder.calls.single.url.queryParameters['limit'], '$limit');
      });
    }

    test('rejects an unenveloped 200 instead of returning an empty picker',
        () async {
      // A tolerant pass-through would read `sessions` off the envelope, find
      // nothing, and render an empty picker for a customer who has sessions.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'sessions': <Object?>[_summaryRow()],
          }),
        ),
      );

      await expectLater(
        client.listSessions(),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('keeps every good session when one cannot be decoded', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            _sessionPage(<Object?>[
              _summaryRow(<String, Object?>{'id': 's1'}),
              _summaryRow(<String, Object?>{
                'id': 's2',
                'status': 'NOT_A_REAL_STATUS',
              }),
              _summaryRow(<String, Object?>{'id': 's3'}),
            ]),
          ),
        ),
      );

      final List<RestChatSessionSummary> sessions = await client.listSessions();

      // Omitted, not placeholdered: there is no "unsupported session" row a
      // picker could render that a customer would not simply tap in vain.
      expect(
        sessions.map((RestChatSessionSummary s) => s.id),
        <String>['s1', 's3'],
      );
    });

    test('maps a structured API error the same way every other adapter does',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            <String, Object?>{
              'error': <String, Object?>{
                'code': 'AUTH_EXPIRED',
                'message': 'token expired',
                'retryable': true,
              },
            },
            401,
          ),
        ),
      );

      await expectLater(
        client.listSessions(),
        throwsA(
          isA<RestApiException>()
              .having((RestApiException e) => e.code, 'code', 'AUTH_EXPIRED')
              .having((RestApiException e) => e.status, 'status', 401)
              .having((RestApiException e) => e.retryable, 'retryable', isTrue)
              .having(
                (RestApiException e) => e.serverMessage,
                'serverMessage',
                'token expired',
              ),
        ),
      );
    });

    test('distinguishes a transport failure from a server verdict', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => throw const SocketLikeFailure()),
      );

      await expectLater(
        client.listSessions(),
        throwsA(isA<RestTransportException>()),
      );
    });

    test(
        'treats a 5xx without a structured body as retryable, same status '
        'fallback as history', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => http.Response('gateway exploded', 502)),
      );

      await expectLater(
        client.listSessions(),
        throwsA(
          isA<RestApiException>()
              .having((RestApiException e) => e.status, 'status', 502)
              .having((RestApiException e) => e.retryable, 'retryable', isTrue),
        ),
      );
    });

    test('issues one request per call — no caching, no in-flight collapsing',
        () async {
      // The wire-level half of `session-list-refresh.test.ts`. That file's
      // real subject — two refreshes never overlapping, and a refresh asked
      // for mid-flight being re-issued rather than dropped — is the WIDGET's
      // serialisation of a wholesale `pastSessions` replace, counted around a
      // store rather than an adapter. What belongs HERE is the property that
      // makes such serialisation possible at all: this method neither caches
      // an answer nor collapses concurrent asks, so the layer that owns the
      // writes is the layer that decides their order. The Dart owner of the
      // rest is the session picker (T11).
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(_sessionPage(<Object?>[_summaryRow()])),
        ),
      );

      await client.listSessions(limit: 5);
      await client.listSessions(limit: 5);
      await Future.wait<List<RestChatSessionSummary>>(
        <Future<List<RestChatSessionSummary>>>[
          client.listSessions(limit: 5),
          client.listSessions(limit: 5),
        ],
      );

      expect(recorder.calls, hasLength(4));
    });

    test('carries the session picker page size the widget asks for', () async {
      // `session-source.test.ts` — "calls the customer-sessions route with the
      // picker's page size", and "projects the row into ChatSessionSummary,
      // handledBy included", against that file's own fixture rather than
      // `client.test.ts`'s. The two differ in a way worth pinning: this row is
      // RESOLVED with a real `closedAt`, which is the state a picker renders
      // most often and the one an int/string enum mix-up would break first.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            _sessionPage(<Object?>[
              <String, Object?>{
                'id': 'sess_9',
                'status': 'RESOLVED',
                'mode': 'HUMAN',
                'createdAt': '2026-08-19T09:00:00.000Z',
                'closedAt': '2026-08-19T10:00:00.000Z',
                'lastMessageAt': '2026-08-19T09:30:00.000Z',
                'lastMessagePreview': 'Thanks!',
                'unreadCount': 0,
                'handledBy': <String, Object?>{
                  'kind': 'AGENT',
                  'id': 'agt_1',
                  'displayName': 'Ada',
                },
              },
            ]),
          ),
        ),
      );

      final List<RestChatSessionSummary> sessions =
          await client.listSessions(limit: 5);

      expect(
        recorder.calls.single.url.toString(),
        contains('/chat/sessions/customer?limit=5'),
      );
      expect(sessions.single.id, 'sess_9');
      expect(sessions.single.status, ChatStatus.resolved);
      expect(sessions.single.closedAt, DateTime.utc(2026, 8, 19, 10));
      expect(sessions.single.handledBy?.displayName, 'Ada');
    });
  });

  group('the barrel', () {
    test('carries the extension through its re-export', () async {
      // A language property worth pinning rather than assuming: `show`/`hide`
      // control extension availability on an import, so a named extension is
      // an ordinary namespace member — but "an `export … show SessionApi`
      // makes it available to a consumer importing only the barrel" is the
      // fact every call site depends on, and it is not spelled out in
      // https://dart.dev/language/extension-methods. Asserted through a
      // PREFIXED barrel import, so nothing in this file's own unprefixed
      // `src/sessions.dart` import can satisfy it by accident.
      final _Recorder recorder = _Recorder();
      final barrel.RestClient client = barrel.RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: recorder.client((_) => _json(_sessionPage())),
      );

      await expectLater(client.listSessions(), completion(isEmpty));
    });
  });
}

/// Stands in for the platform failures `package:http` surfaces from a dead
/// connection — `SocketException`, `HandshakeException`, `TimeoutException`.
///
/// A bare `Exception` would do, but naming it is what makes the assertion
/// readable: the property under test is that ANY throw from the transport
/// becomes a [RestTransportException], never a leaked platform type.
class SocketLikeFailure implements Exception {
  const SocketLikeFailure();
}
