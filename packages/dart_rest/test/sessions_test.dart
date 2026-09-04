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
import 'package:dhaam_chat_rest/src/models/csat.dart';
import 'package:dhaam_chat_rest/src/models/session.dart';
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

/// `chat.routes.ts`'s own `/csat` POST response — `{success, data: CsatRecord}`.
Map<String, Object?> _csatRecord([
  Map<String, Object?> overrides = const <String, Object?>{},
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{
        'sessionId': 's1',
        'rating': 4,
        'comment': null,
        'submittedAt': '2026-08-19T09:30:00.000Z',
        ...overrides,
      },
    };

/// The GET route's answered shape — a rating that already exists.
Map<String, Object?> _ratedStatus([
  Map<String, Object?> overrides = const <String, Object?>{},
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{
        'rated': true,
        'rating': 4,
        'comment': 'quick and clear',
        'submittedAt': '2026-08-19T09:30:00.000Z',
        ...overrides,
      },
    };

/// The JSON body that actually went out on a recorded request.
Map<String, Object?> _sentBody(http.Request request) =>
    jsonDecode(request.body) as Map<String, Object?>;

/// A raw session row as `GET /chat/sessions/{id}/full` nests it under
/// `session` — integer enums, a bare `ticketId`, enrichment blocks with no ids
/// of their own.
Map<String, Object?> _fullSession([
  Map<String, Object?> overrides = const <String, Object?>{},
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{
        'session': <String, Object?>{
          'id': 's1',
          'tenantId': 't1',
          'customerId': 'cust-1',
          'assignedAgentId': 'agent-9',
          'ticketId': 'TICK-7',
          'mode': 2,
          'status': 3,
          'priority': 2,
          'closedAt': null,
          'createdAt': '2026-08-19T09:00:00.000Z',
          'updatedAt': '2026-08-19T09:30:00.000Z',
          // enrichSessionWithUsers attaches these — with no id of their own.
          'assignedAgent': <String, Object?>{
            'displayName': 'Ada',
            'email': 'ada@x.test',
            'avatarUrl': null,
            'isOnline': true,
          },
          'customer': <String, Object?>{
            'displayName': 'Bob',
            'email': null,
            'avatarUrl': null,
            'isOnline': false,
          },
          ...overrides,
        },
        'messages': <Object?>[],
        'participants': <Object?>[],
        'hasMore': false,
      },
    };

/// Routes a two-request action: the mutation receipt, then the `/full`
/// read-back.
MockClient _sessionActionMock(
  _Recorder recorder, {
  Map<String, Object?> fullOverrides = const <String, Object?>{},
  String receiptId = 's1',
}) =>
    recorder.client(
      (http.Request request) => request.url.path.endsWith('/full')
          ? _json(_fullSession(fullOverrides))
          : _json(<String, Object?>{
              'success': true,
              'data': <String, Object?>{'sessionId': receiptId, 'status': 4},
            }),
    );

void main() {
  group('session actions — close and reopen', () {
    test('posts the mutation, then reads the session back from /full',
        () async {
      // TWO round trips on purpose: the mutating routes return only a receipt
      // (`{sessionId, status, closedAt}`), and a caller needs the enriched
      // session — assigned agent, customer profile, ticket. Order is asserted,
      // not membership: a read-back that ran BEFORE its mutation would satisfy
      // a set comparison and be exactly wrong.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(_sessionActionMock(recorder));

      await client.reopenSession('s1');
      await client.closeSession('s1');

      expect(recorder.trace, <String>[
        'POST /chat-services/api/v1/chat/sessions/s1/reopen',
        'GET /chat-services/api/v1/chat/sessions/s1/full',
        'POST /chat-services/api/v1/chat/sessions/s1/close',
        'GET /chat-services/api/v1/chat/sessions/s1/full',
      ]);
    });

    test('returns a fully-populated session, not a receipt', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(_sessionActionMock(recorder));

      final RestChatSession session = await client.closeSession('s1');

      expect(session.id, 's1');
      expect(session.status, ChatStatus.assigned);
      expect(session.mode, ChatMode.human);
      expect(session.createdAt, DateTime.utc(2026, 8, 19, 9));
      expect(session.closedAt, isNull);
      expect(session.assignedAgent?.participantId, 'agent-9');
      expect(session.assignedAgent?.displayName, 'Ada');
      expect(session.assignedAgent?.avatarUrl, isNull);
      expect(session.customer?.participantId, 'cust-1');
      expect(session.customer?.displayName, 'Bob');
      expect(session.ticket?.id, 'TICK-7');
      expect(session.ticket?.url, isNull);
    });

    test('never carries the email /full actually returns', () async {
      // The row above DOES contain `ada@x.test`. Nothing renders this field,
      // and the widget this SDK serves runs inside third-party pages whose
      // session-replay tools serialize application state wholesale — so
      // populating it would put a real customer address into a store built for
      // someone else's page to record, in exchange for zero feature.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(_sessionActionMock(recorder));

      final RestChatSession session = await client.closeSession('s1');

      expect(session.assignedAgent?.email, isNull);
      expect(session.customer?.email, isNull);
    });

    test('reads back the session reopen converged on, not the one requested',
        () async {
      // reopen may converge onto a different, already-active session and
      // returns THAT id; re-reading the requested one would return the wrong
      // session. The convergence stays inside the authorization boundary, so
      // the returned id is safe to follow — and a differing id is NOT an error.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        _sessionActionMock(
          recorder,
          fullOverrides: <String, Object?>{'id': 's2'},
          receiptId: 's2',
        ),
      );

      final RestChatSession session = await client.reopenSession('s1');

      expect(recorder.trace, <String>[
        'POST /chat-services/api/v1/chat/sessions/s1/reopen',
        'GET /chat-services/api/v1/chat/sessions/s2/full',
      ]);
      expect(session.id, 's2');
    });

    test('falls back to the requested id when the receipt names none',
        () async {
      // TS reads any string, so an EMPTY one would build `/chat/sessions//full`
      // — a URL addressing no session. Folding `''` into absent is the only
      // reading that can still be right (one notch stricter, same shape as the
      // apiUrl trim in §5.5).
      for (final Object? receiptId in <Object?>[null, '', 42]) {
        final _Recorder recorder = _Recorder();
        final RestClient client = _clientOver(
          recorder.client(
            (http.Request request) => request.url.path.endsWith('/full')
                ? _json(_fullSession())
                : _json(<String, Object?>{
                    'success': true,
                    'data': <String, Object?>{'sessionId': receiptId},
                  }),
          ),
        );

        await client.closeSession('s1');

        expect(
          recorder.trace.last,
          'GET /chat-services/api/v1/chat/sessions/s1/full',
          reason: 'a receipt sessionId of ${jsonEncode(receiptId)} names no '
              'session to follow',
        );
      }
    });

    test('decodes the integer status and ISO closedAt of a closed session',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        _sessionActionMock(
          recorder,
          fullOverrides: <String, Object?>{
            'status': 4,
            'closedAt': '2026-08-19T11:00:00.000Z',
          },
        ),
      );

      final RestChatSession session = await client.closeSession('s1');

      expect(session.status, ChatStatus.closed);
      expect(session.closedAt, DateTime.utc(2026, 8, 19, 11));
    });

    test(
        'rejects an unenveloped /full response rather than returning a hollow '
        'session', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (http.Request request) => request.url.path.endsWith('/full')
              ? _json(<String, Object?>{
                  'session': <String, Object?>{
                    'id': 's1',
                    'status': 3,
                    'mode': 2,
                  },
                })
              : _json(<String, Object?>{
                  'success': true,
                  'data': <String, Object?>{'sessionId': 's1'},
                }),
        ),
      );

      // Surfaced as a READ-BACK failure — the mutation still happened — with
      // the underlying verdict retained rather than interpolated into a string.
      await expectLater(
        client.closeSession('s1'),
        throwsA(
          isA<RestSessionReadBackException>()
              .having(
                (RestSessionReadBackException e) => e.sessionId,
                'sessionId',
                's1',
              )
              .having(
                (RestSessionReadBackException e) => e.cause,
                'cause',
                isA<RestMalformedResponseException>(),
              ),
        ),
      );
    });

    test('reports a failed read-back distinguishably from a failed mutation',
        () async {
      // The server HAS closed the session by this point. A caller that treats
      // this like a failed close is wrong in both directions: it will either
      // leave the UI open on a closed session, or replay a non-idempotent POST.
      //
      // TS spells this with a `sessionMutationApplied = true` boolean, so
      // `@dhaam-ccrm/core` — which may not import `@dhaam-ccrm/rest` — can
      // recognise it structurally. Dart has no such layer to protect: every
      // consumer already imports this package, so the TYPE is the marker, and
      // unlike a duck-typed boolean it is statically checked (§5.6).
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (http.Request request) => request.url.path.endsWith('/full')
              ? _json(
                  <String, Object?>{
                    'error': <String, Object?>{
                      'code': 'INTERNAL',
                      'message': 'boom',
                    },
                  },
                  500,
                )
              : _json(<String, Object?>{
                  'success': true,
                  'data': <String, Object?>{'sessionId': 's1'},
                }),
        ),
      );

      final Object error = await client
          .closeSession('s1')
          .then<Object>((RestChatSession _) => 'did not throw')
          .onError<RestException>((RestException e, _) => e);

      expect(error, isA<RestSessionReadBackException>());
      final RestSessionReadBackException readBack =
          error as RestSessionReadBackException;
      expect(readBack.sessionId, 's1');
      expect(readBack.cause, isA<RestApiException>());
      expect((readBack.cause as RestApiException).status, 500);
      // Retrying the WHOLE action is specifically wrong on receipt of this.
      expect(readBack.retryable, isFalse);
    });

    test('retries the read-back GET and never re-issues the mutation',
        () async {
      // closeSession is NOT idempotent: a second POST re-runs the status
      // update, re-marks participants as left, and emits another "chat closed"
      // SYSTEM message plus another Kafka event — all visible to the customer.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (http.Request request) => request.url.path.endsWith('/full')
              ? _json(
                  <String, Object?>{
                    'error': <String, Object?>{
                      'code': 'INTERNAL',
                      'message': 'boom',
                    },
                  },
                  500,
                )
              : _json(<String, Object?>{
                  'success': true,
                  'data': <String, Object?>{'sessionId': 's1'},
                }),
        ),
      );

      await expectLater(
        client.closeSession('s1'),
        throwsA(isA<RestSessionReadBackException>()),
      );

      expect(
        recorder.calls
            .where((http.Request r) => r.method == 'POST')
            .map((http.Request r) => r.url.path),
        <String>['/chat-services/api/v1/chat/sessions/s1/close'],
        reason: 'exactly one POST, however many times the read-back failed',
      );
      expect(
        recorder.calls.where((http.Request r) => r.method == 'GET'),
        hasLength(kReadBackAttempts),
      );
    });

    test('succeeds when a retried read-back recovers', () async {
      int fullCalls = 0;
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request request) {
          if (!request.url.path.endsWith('/full')) {
            return _json(<String, Object?>{
              'success': true,
              'data': <String, Object?>{'sessionId': 's1'},
            });
          }
          fullCalls += 1;
          // A dropped connection on the first attempt — the case the retry
          // budget exists for.
          if (fullCalls == 1) throw const SocketLikeFailure();
          return _json(_fullSession());
        }),
      );

      final RestChatSession session = await client.closeSession('s1');

      expect(session.id, 's1');
      expect(fullCalls, 2);
    });

    test('does not retry a read-back whose body no retry could reshape',
        () async {
      // A malformed envelope is contract drift, not a blip. `retryable` on the
      // sealed base answers this in one line, where TS maintains a four-branch
      // `isWorthRetrying` chain every new error type must be added to by hand.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (http.Request request) => request.url.path.endsWith('/full')
              ? _json(<String, Object?>{
                  'session': <String, Object?>{'id': 's1'},
                })
              : _json(<String, Object?>{
                  'success': true,
                  'data': <String, Object?>{'sessionId': 's1'},
                }),
        ),
      );

      await expectLater(
        client.closeSession('s1'),
        throwsA(isA<RestSessionReadBackException>()),
      );

      expect(
        recorder.calls.where((http.Request r) => r.method == 'GET'),
        hasLength(1),
      );
    });

    test('does not issue the read-back when the mutation itself fails',
        () async {
      // Nothing happened server-side, so there is nothing to read back and no
      // read-back exception to raise: a plain API refusal, which is what tells
      // a caller it is safe to retry the whole action.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            <String, Object?>{
              'error': <String, Object?>{
                'code': 'SESSION_NOT_FOUND',
                'message': 'nope',
              },
            },
            404,
          ),
        ),
      );

      await expectLater(
        client.closeSession('s1'),
        throwsA(
          isA<RestApiException>().having(
            (RestApiException e) => e.code,
            'code',
            'SESSION_NOT_FOUND',
          ),
        ),
      );
      expect(recorder.calls, hasLength(1));
    });

    test(
        'does not read back — or wrap — when the mutation receipt is '
        'unenveloped', () async {
      // The POST succeeded, so something DID happen server-side, but with no
      // envelope there is no id to follow. Surfaced as a plain malformed
      // response rather than a read-back failure: no read was attempted, and
      // claiming one would misreport which half of the pair broke.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => _json(<String, Object?>{'sessionId': 's1'})),
      );

      await expectLater(
        client.closeSession('s1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(recorder.calls, hasLength(1));
    });

    test(
        'reports a token failure during the read-back as a read-back failure, '
        'so the caller still learns the mutation applied', () async {
      // The window is narrow — the provider answered milliseconds earlier for
      // the POST — but a token expiring exactly there is ordinary, not exotic.
      // What the caller needs from this case is the ONE fact the bare auth
      // error cannot carry: the close already happened. `closeSession` is not
      // idempotent, so a caller who reads a bare `TokenUnavailableError` as
      // "it never happened" and retries re-emits a "chat closed" SYSTEM
      // message and a Kafka event.
      //
      // The auth failure is not lost — it is `cause`, asserted below.
      final _Recorder recorder = _Recorder();
      int tokenCalls = 0;
      final RestClient client = RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async {
          tokenCalls += 1;
          if (tokenCalls == 1) return 'tok_abc';
          throw const TokenUnavailableError('refresh failed');
        },
        httpClient: _sessionActionMock(recorder),
      );

      await expectLater(
        client.closeSession('s1'),
        throwsA(
          isA<RestSessionReadBackException>()
              .having((RestSessionReadBackException e) => e.sessionId,
                  'sessionId', 's1')
              .having((RestSessionReadBackException e) => e.cause, 'cause',
                  isA<TokenUnavailableError>()),
        ),
      );
      // The POST went out; the GET never did.
      expect(recorder.trace, <String>[
        'POST /chat-services/api/v1/chat/sessions/s1/close',
      ]);
    });

    test('percent-encodes the session id on both round trips', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (http.Request request) => request.url.path.endsWith('/full')
              ? _json(_fullSession())
              : _json(<String, Object?>{
                  'success': true,
                  'data': <String, Object?>{'sessionId': 'a/b'},
                }),
        ),
      );

      await client.closeSession('a/b');

      expect(
        recorder.calls.map((http.Request r) => r.url.toString()),
        <String>[
          'https://chat.example.test/chat-services/api/v1/chat/sessions/a%2Fb/close',
          'https://chat.example.test/chat-services/api/v1/chat/sessions/a%2Fb/full',
        ],
      );
    });
  });

  group('submitCsat', () {
    test('is ONE round trip, unlike reopen/close — no /full read-back',
        () async {
      // A rating touches no session state, so there is nothing for a read-back
      // to refresh. This is the assertion that keeps someone from "fixing" the
      // asymmetry with close/reopen by adding one.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_csatRecord())));

      await client.submitCsat('s1', rating: 4);

      expect(
        recorder.trace,
        <String>['POST /chat-services/api/v1/chat/sessions/s1/csat'],
      );
    });

    test('sends the rating and comment as the JSON body', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_csatRecord())));

      await client.submitCsat('s1', rating: 5, comment: 'great help');

      expect(
        _sentBody(recorder.calls.single),
        <String, Object?>{'rating': 5, 'comment': 'great help'},
      );
    });

    test('POSTs to /csat rather than sending the rating as a chat message',
        () async {
      // `csat-submit.test.ts:308-331`'s wire half. The rest of that case — the
      // card, the thanks panel, and specifically that no `message.send` frame
      // goes out — is the CSAT card's (T10); what this package answers for is
      // that a rating leaves over HTTP at all, with the customer's typed
      // comment intact.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_csatRecord())));

      await client.submitCsat(
        'sess_current',
        rating: 4,
        comment: 'Great help, thanks!',
      );

      expect(
        recorder.calls.single.url.path,
        contains('/chat/sessions/sess_current/csat'),
      );
      expect(
        _sentBody(recorder.calls.single),
        <String, Object?>{'rating': 4, 'comment': 'Great help, thanks!'},
      );
    });

    test('omits comment from the body rather than sending it as null',
        () async {
      // `csat-submit.test.ts:332-343` — "omits the comment from the request
      // body when the customer left none". The key must be ABSENT, not null:
      // an explicit null asserts that the customer was asked and declined.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_csatRecord())));

      await client.submitCsat('s1', rating: 3);

      final Map<String, Object?> body = _sentBody(recorder.calls.single);
      expect(body.containsKey('comment'), isFalse);
      expect(body, <String, Object?>{'rating': 3});
    });

    test('omits an EMPTY comment too — one notch stricter than TS', () async {
      // TS omits only `undefined`, so `''` reaches the wire as `comment: ''`.
      // An empty string is not something a customer typed either, and this
      // package already folds `''` into absent on the read side. The route
      // trims and nulls a blank comment regardless, so nothing is lost —
      // except a body claiming an answer that was never given.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_csatRecord())));

      await client.submitCsat('s1', rating: 3, comment: '');

      expect(_sentBody(recorder.calls.single), <String, Object?>{'rating': 3});
    });

    test('returns the stored rating field-for-field', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            _csatRecord(<String, Object?>{'rating': 2, 'comment': 'meh'}),
          ),
        ),
      );

      final RestCsatSubmission record =
          await client.submitCsat('s1', rating: 2, comment: 'meh');

      expect(record.sessionId, 's1');
      expect(record.rating, 2);
      expect(record.comment, 'meh');
      // A DateTime, not the raw string TS keeps — every wire timestamp in this
      // SDK is a DateTime, with no exceptions (contract §5.7).
      expect(record.submittedAt, DateTime.utc(2026, 8, 19, 9, 30));
    });

    test('rejects an unenveloped response, never a hollow record', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => _json(<String, Object?>{'rating': 4})),
      );

      await expectLater(
        client.submitCsat('s1', rating: 4),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('propagates a refused rating as a RestApiException', () async {
      // e.g. another customer's session.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(
            <String, Object?>{
              'error': <String, Object?>{
                'code': 'UNAUTHORIZED',
                'message': 'not your session',
              },
            },
            403,
          ),
        ),
      );

      await expectLater(
        client.submitCsat('s1', rating: 4),
        throwsA(
          isA<RestApiException>()
              .having((RestApiException e) => e.code, 'code', 'UNAUTHORIZED')
              .having((RestApiException e) => e.status, 'status', 403),
        ),
      );
    });
  });

  group('getCsat', () {
    test('is a GET on the same path the POST uses, in one round trip',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_ratedStatus())));

      await client.getCsat('s1');

      expect(
        recorder.trace,
        <String>['GET /chat-services/api/v1/chat/sessions/s1/csat'],
      );
    });

    test('returns the stored rating', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(_ratedStatus())));

      final RestCsatStatus status = await client.getCsat('s1');

      final RestCsatRated rated = status as RestCsatRated;
      expect(rated.rating, 4);
      expect(rated.comment, 'quick and clear');
      expect(rated.submittedAt, DateTime.utc(2026, 8, 19, 9, 30));
    });

    test(
        'normalises a missing comment to null — the route documents '
        '`string | null`', () async {
      final Map<String, Object?> body = _ratedStatus();
      (body['data']! as Map<String, Object?>).remove('comment');
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((_) => _json(body)));

      final RestCsatRated rated = await client.getCsat('s1') as RestCsatRated;

      expect(rated.rating, 4);
      expect(rated.comment, isNull);
      expect(rated.submittedAt, DateTime.utc(2026, 8, 19, 9, 30));
    });

    test('reports an unrated session as an ANSWER, not an absence', () async {
      // A caller acts on this: it is what lets the survey be offered at all,
      // and it must stay distinguishable from a lookup that failed. The sealed
      // union is what makes that distinction a compile-time one.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{'rated': false},
          }),
        ),
      );

      expect(await client.getCsat('s1'), isA<RestCsatUnrated>());
    });

    test(
        'rejects a body with no boolean `rated` rather than reading it as '
        'unrated', () async {
      // Reading a malformed body as "not rated yet" would offer the survey
      // again over a rated session, and the POST is an upsert — the exact
      // duplicate this call exists to prevent.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{'rating': 4},
          }),
        ),
      );

      await expectLater(
        client.getCsat('s1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('rejects a non-boolean `rated` — the string "true" is not a verdict',
        () async {
      // TS tests `typeof data.rated !== 'boolean'` through an absent field
      // only. A truthy STRING is the shape that would slip past a looser check
      // and lock a card on a value the server never asserted.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{'rated': 'true', 'rating': 4},
          }),
        ),
      );

      await expectLater(
        client.getCsat('s1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test(
        'rejects `rated: true` with no numeric rating — a locked card with '
        'nothing in it', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{'rated': true, 'comment': 'hm'},
          }),
        ),
      );

      await expectLater(
        client.getCsat('s1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test(
        'accepts an integral JSON double as the rating — Flutter Web sends '
        'every number as one', () async {
      // Not a TS case: it cannot be one, because JS has a single number type.
      // On Flutter Web `"rating": 4` decodes to `4.0`, and an `is int` test
      // alone would reject a valid body on exactly one of the three platforms
      // this package targets.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => http.Response(
            '{"success":true,"data":{"rated":true,"rating":4.0}}',
            200,
          ),
        ),
      );

      expect((await client.getCsat('s1') as RestCsatRated).rating, 4);
    });

    test('rejects an unenveloped response as malformed', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((_) => _json(<String, Object?>{'rated': false})),
      );

      await expectLater(
        client.getCsat('s1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test("propagates the POST's own owner guards — 403 and 404", () async {
      for (final (int status, String code) in <(int, String)>[
        (403, 'UNAUTHORIZED'),
        (404, 'SESSION_NOT_FOUND'),
      ]) {
        final _Recorder recorder = _Recorder();
        final RestClient client = _clientOver(
          recorder.client(
            (_) => _json(
              <String, Object?>{
                'error': <String, Object?>{'code': code, 'message': 'nope'},
              },
              status,
            ),
          ),
        );

        await expectLater(
          client.getCsat('s1'),
          throwsA(
            isA<RestApiException>()
                .having((RestApiException e) => e.status, 'status', status),
          ),
          reason: 'a $status must stay an ordinary API refusal',
        );
      }
    });

    test('percent-encodes the session id into the path', () async {
      // `Uri.parse` escapes nothing, so an unencoded `/` would silently
      // address `/chat/sessions/a/b/csat` — a different route.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client(
          (_) => _json(<String, Object?>{
            'success': true,
            'data': <String, Object?>{'rated': false},
          }),
        ),
      );

      await client.getCsat('a/b');

      expect(
        recorder.calls.single.url.toString(),
        'https://chat.example.test/chat-services/api/v1/chat/sessions/a%2Fb/csat',
      );
    });
  });

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
