/// Reproduces `client.test.ts`'s `describe('RestClient paths and
/// credentials')` and `describe('error taxonomy')`, plus the constructor and
/// limit-range assertions §5.5 calls out.
///
/// The per-endpoint methods those blocks drive through `createHistorySource`
/// belong to T6 and T7; this file drives the same behaviour through
/// [RestClient.request], which is the primitive all of them call.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/limits.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match — same reason and same spelling as
/// `client.test.ts:12`.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

/// Captures what actually went on the wire.
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

http.Response _json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

RestClient _clientOver(
  MockClient mock, {
  String apiUrl = 'https://chat.example.test',
  TokenProvider? getAccessToken,
}) =>
    RestClient(
      apiUrl: apiUrl,
      publishableKey: _key,
      getAccessToken: getAccessToken ?? () async => 'tok_abc',
      httpClient: mock,
    );

void main() {
  group('constructor', () {
    test('pins the base path to what the service mounts', () {
      // Literal, deliberately NOT built from the constant: asserting a
      // constant against itself is tautological — it passes even when the
      // constant is wrong, which is the exact defect this guards.
      expect(kRestBasePath, '/chat-services/api/v1');
    });

    test('rejects an empty apiUrl', () {
      expect(
        () => RestClient(
          apiUrl: '',
          publishableKey: _key,
          getAccessToken: () async => 't',
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('rejects an apiUrl of only slashes — stricter than TS, on purpose',
        () {
      // TS checks emptiness BEFORE trimming, so `"/"` passes its truthy check
      // and then trims to `""`, silently building a path against whatever
      // origin the app is served from. Checking after closes that gap
      // (contract §5.5).
      for (final String apiUrl in <String>['/', '//', '///']) {
        expect(
          () => RestClient(
            apiUrl: apiUrl,
            publishableKey: _key,
            getAccessToken: () async => 't',
          ),
          throwsA(isA<ArgumentError>()),
          reason: 'apiUrl "$apiUrl" trims to empty',
        );
      }
    });

    test(
        'needs no empty-publishableKey guard — the type makes it '
        'unconstructible', () {
      // TS throws on a falsy publishableKey. Here the parameter is a
      // PublishableKey, and PublishableKey.parse already refuses an empty
      // value before an instance can exist. There is no runtime state left to
      // guard against, which is the point of taking the type (§5.5).
      expect(
        () => PublishableKey.parse(''),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });

    test('close() does not close a client it does not own', () {
      // The seam contract: a caller that supplied its own client may still be
      // using it afterwards, so this must not reach through and close it.
      //
      // Asserted against a client that RECORDS close(), not against MockClient
      // — whose inherited close() is a no-op, so a test built on it would pass
      // just as happily if this reached through and closed it.
      final _ClosableClient supplied = _ClosableClient();

      RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 't',
        httpClient: supplied,
      ).close();

      expect(supplied.closeCount, 0);
    });
  });

  group('paths and credentials', () {
    test('builds URLs under the prefix the service actually mounts', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request('GET', '/chat/sessions/s1/messages');

      expect(
        recorder.calls.first.url.path,
        '/chat-services/api/v1/chat/sessions/s1/messages',
      );
    });

    test('sends both credentials on every request', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request('GET', '/chat/sessions/s1/messages');

      final http.Request sent = recorder.calls.first;
      expect(sent.headers['Authorization'], 'Bearer tok_abc');
      expect(sent.headers['X-Publishable-Key'], _key.value);
    });

    test('reads the token per request, so a refreshed token is picked up',
        () async {
      String token = 'first';
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
        getAccessToken: () async => token,
      );

      await client.request('GET', '/a');
      token = 'second';
      await client.request('GET', '/a');

      expect(
        recorder.calls
            .map((http.Request r) => r.headers['Authorization'])
            .toList(),
        <String>['Bearer first', 'Bearer second'],
      );
    });

    test('does not double the slash when apiUrl has a trailing one', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
        apiUrl: 'https://chat.example.test/',
      );

      await client.request('GET', '/chat/sessions/s1/messages');

      expect(recorder.calls.first.url.path, isNot(contains('//')));
    });

    test('omits a null query value entirely rather than sending "null"',
        () async {
      // `?before=null` would ask the history route to page from a cursor
      // spelled "null" rather than from the newest page.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request(
        'GET',
        '/chat/sessions/s1/messages',
        query: <String, Object?>{'before': null, 'limit': 20},
      );

      final Uri url = recorder.calls.first.url;
      expect(url.queryParameters.containsKey('before'), isFalse);
      expect(url.queryParameters['limit'], '20');
    });

    test('adds no query string at all when every value was null', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request('GET', '/x', query: <String, Object?>{'a': null});

      expect(recorder.calls.first.url.toString(), isNot(contains('?')));
    });

    test('sends a JSON body with a JSON content type', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request(
        'POST',
        '/chat/sessions/s1/csat',
        jsonBody: <String, Object?>{'rating': 5},
      );

      final http.Request sent = recorder.calls.first;
      expect(sent.method, 'POST');
      expect(sent.headers['Content-Type'], startsWith('application/json'));
      expect(jsonDecode(sent.body), <String, Object?>{'rating': 5});
    });

    test('sets no Content-Type when there is no body', () async {
      // A GET carrying a Content-Type describes a payload it does not have.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await client.request('GET', '/x');

      expect(recorder.calls.first.headers.containsKey('Content-Type'), isFalse);
    });
  });

  group('multipart', () {
    /// MockClient's plain-request callback cannot see a MultipartRequest, so
    /// these use the streamed form to inspect what was actually built.
    Future<http.BaseRequest> captureMultipart(RestMultipartFile file) async {
      late http.BaseRequest captured;
      final MockClient mock = MockClient.streaming(
        (http.BaseRequest request, http.ByteStream body) async {
          captured = request;
          // Drain, so the request is genuinely finalized the way a real send
          // would finalize it.
          await body.toBytes();
          return http.StreamedResponse(
            Stream<List<int>>.value(utf8.encode('{}')),
            200,
          );
        },
      );

      await _clientOver(mock).request('POST', '/upload', multipart: file);
      return captured;
    }

    test('sets a multipart content type with a boundary the runtime generated',
        () async {
      final http.BaseRequest sent = await captureMultipart(
        RestMultipartFile(
          fieldName: 'file',
          fileName: 'cat.png',
          bytes: Uint8List.fromList(<int>[1, 2, 3]),
          mimeType: 'image/png',
        ),
      );

      final String contentType = sent.headers['content-type']!;
      expect(contentType, startsWith('multipart/form-data'));
      // The header is never written by hand — a hand-written one carries no
      // boundary and produces a body the server cannot parse.
      expect(contentType, contains('boundary='));
    });

    test("carries the caller's mimeType on the file PART", () async {
      // The reason this package takes http_parser (contract §5.4). Without it
      // every upload reports application/octet-stream server-side and degrades
      // to a generic FILE attachment.
      final http.BaseRequest sent = await captureMultipart(
        RestMultipartFile(
          fieldName: 'file',
          fileName: 'cat.png',
          bytes: Uint8List.fromList(<int>[1, 2, 3]),
          mimeType: 'image/png',
        ),
      );

      final http.MultipartFile part =
          (sent as http.MultipartRequest).files.single;
      expect(part.contentType.mimeType, 'image/png');
      expect(part.field, 'file');
      expect(part.filename, 'cat.png');
    });

    test('refuses an unparseable mimeType before making any request', () async {
      // A caller bug, not a wire condition — so an ArgumentError, matching the
      // constructor, rather than one of this package's RestException leaves,
      // which describe things the server or the network did.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
      );

      await expectLater(
        client.request(
          'POST',
          '/upload',
          multipart: RestMultipartFile(
            fieldName: 'file',
            fileName: 'x',
            bytes: Uint8List(0),
            mimeType: 'not a mime type',
          ),
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect(recorder.calls, isEmpty);
    });
  });

  group('token failures are not transport failures', () {
    test('lets a failing TokenProvider propagate unwrapped', () async {
      // The two demand opposite responses — fix the credential vs retry later
      // — so a caller that cannot tell them apart retries the first forever.
      // No new exception type was invented: dhaam_chat already models this.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => _json(<String, Object?>{})),
        getAccessToken: () async =>
            throw const TokenUnavailableError('backend refused'),
      );

      await expectLater(
        client.request('GET', '/x'),
        throwsA(isA<TokenUnavailableError>()),
      );
      // And no request was attempted.
      expect(recorder.calls, isEmpty);
    });

    test('does not reshape it into a RestException', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(<String, Object?>{})),
        getAccessToken: () async =>
            throw const TokenUnavailableError('backend refused'),
      );

      await expectLater(
        client.request('GET', '/x'),
        throwsA(isNot(isA<RestException>())),
      );
    });
  });

  group('error taxonomy', () {
    test('surfaces a structured API error as a typed exception', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'SESSION_NOT_FOUND',
                  'message': 'Session not found',
                  'retryable': false,
                },
              },
              404,
            )),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.code, 'SESSION_NOT_FOUND');
      expect(error.status, 404);
      expect(error.retryable, isFalse);
      expect(error.serverMessage, 'Session not found');
    });

    test('distinguishes a 401 from a network failure', () async {
      // These demand opposite responses — fix the credential vs try again
      // later — so collapsing them into one type is a real bug.
      final RestClient unauthorized = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'AUTH_INVALID',
                  'message': 'bad key',
                  'retryable': false,
                },
              },
              401,
            )),
      );
      final RestClient offline = _clientOver(
        MockClient((http.Request _) async =>
            throw const SocketExceptionStub('connection refused')),
      );

      await expectLater(
        unauthorized.request('GET', '/x'),
        throwsA(isA<RestApiException>()),
      );
      await expectLater(
        offline.request('GET', '/x'),
        throwsA(isA<RestTransportException>()),
      );
    });

    test('a transport failure holds its cause and is retryable', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async =>
            throw const SocketExceptionStub('connection refused')),
      );

      final Object error = await _catchAny(() => client.request('GET', '/x'));

      expect(error, isA<RestTransportException>());
      final RestTransportException transport = error as RestTransportException;
      expect(transport.retryable, isTrue);
      expect(transport.cause, isA<SocketExceptionStub>());
      // Held, never interpolated: a lower-level error's own text can embed the
      // request URL, and on this service the token has historically travelled
      // in the query string (§14).
      expect(transport.toString(), isNot(contains('connection refused')));
    });

    test('treats a 5xx without a structured body as retryable', () async {
      final RestClient client = _clientOver(
        MockClient(
            (http.Request _) async => http.Response('gateway exploded', 502)),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.retryable, isTrue);
      expect(error.status, 502);
      expect(error.code, 'HTTP_502');
    });

    test('falls back to the status when the server omits retryable entirely',
        () async {
      // The service's global error handler emits {code, message} and no
      // `retryable`. Coercing that absence to false made the status fallback
      // unreachable and reported every 500 as permanent — retry silently off
      // for exactly the class of failure retry exists for.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'INTERNAL',
                  'message': 'boom',
                },
              },
              500,
            )),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.code, 'INTERNAL');
      expect(error.status, 500);
      expect(error.retryable, isTrue);
    });

    test('ignores a non-boolean retryable and still reaches the fallback',
        () async {
      // Only a LITERAL boolean is the server's verdict. The string "false" is
      // not one, and reading it as such would disable retry on a 500.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'INTERNAL',
                  'message': 'boom',
                  'retryable': 'false',
                },
              },
              500,
            )),
      );

      expect((await _catchApi(() => client.request('GET', '/x'))).retryable,
          isTrue);
    });

    test('keeps a 4xx without retryable non-retryable', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'UNAUTHORIZED',
                  'message': 'Invalid or expired credentials',
                },
              },
              401,
            )),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.code, 'UNAUTHORIZED');
      expect(error.status, 401);
      expect(error.retryable, isFalse);
    });

    test('honours an explicit retryable:false on a 5xx over the fallback',
        () async {
      // The server's own verdict still wins — the fallback only fills a gap.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'INTERNAL',
                  'message': 'give up',
                  'retryable': false,
                },
              },
              503,
            )),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.status, 503);
      expect(error.retryable, isFalse);
    });

    test('keeps the server error string off message, where reporters read it',
        () async {
      // The upload route returns the raw caught AWS SDK message on its 500
      // branch, which can name the bucket, key, region or endpoint. Host apps
      // pipe an exception straight into their crash reporter.
      const String leaky = 'PutObject failed: '
          'https://acme-private.s3.us-east-1.amazonaws.com/x'
          '?X-Amz-Signature=SECRETSIG';
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{
                  'code': 'INTERNAL',
                  'message': leaky,
                },
              },
              500,
            )),
      );

      final RestApiException error =
          await _catchApi(() => client.request('POST', '/upload'));

      expect(error.message, 'request failed with status 500');
      expect(error.message, isNot(contains('SECRETSIG')));
      expect(error.message, isNot(contains('acme-private')));
      // toString() is what actually reaches a log, so it is asserted
      // separately rather than assumed to follow from message.
      expect(error.toString(), isNot(contains('SECRETSIG')));
      expect(error.toString(), isNot(contains('acme-private')));
      // Still reachable for a human who went looking, and only there.
      expect(error.serverMessage, leaky);
    });

    test('leaves serverMessage null when the body carried no structured error',
        () async {
      final RestClient client = _clientOver(
        MockClient(
            (http.Request _) async => http.Response('gateway exploded', 502)),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.serverMessage, isNull);
      expect(error.message, isNot(contains('gateway exploded')));
    });

    test('never puts a raw non-JSON error body into the message', () async {
      // An error body is attacker-influencable and may echo request detail.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async =>
            http.Response('token=${'dhk' '_live_'}LEAKED', 400)),
      );

      final RestApiException error =
          await _catchApi(() => client.request('GET', '/x'));

      expect(error.message, isNot(contains('LEAKED')));
      expect(error.toString(), isNot(contains('LEAKED')));
      expect(error.code, 'HTTP_400');
    });

    test('falls back to the code when the server message is not a string',
        () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(
              <String, Object?>{
                'error': <String, Object?>{'code': 'INTERNAL', 'message': 42},
              },
              500,
            )),
      );

      expect((await _catchApi(() => client.request('GET', '/x'))).serverMessage,
          'INTERNAL');
    });

    test('synthesizes HTTP_<status> when the error body has no string code',
        () async {
      for (final Object? body in <Object?>[
        <String, Object?>{
          'error': <String, Object?>{'code': 7}
        },
        <String, Object?>{'error': 'nope'},
        <String, Object?>{'nope': true},
        <Object?>[],
      ]) {
        final RestClient client = _clientOver(
          MockClient((http.Request _) async => _json(body, 418)),
        );

        expect((await _catchApi(() => client.request('GET', '/x'))).code,
            'HTTP_418');
      }
    });
  });

  group('successful responses', () {
    test('returns null for a 204 without parsing a body', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => http.Response('', 204)),
      );

      expect(await client.request('POST', '/x'), isNull);
    });

    test('returns the decoded body verbatim, unwrapping no envelope', () async {
      // The transport has no opinion on the payload of a successful response.
      // Unwrapping here would mean carrying a route-exception list — /tokens,
      // /health*, /ready and /live serve no envelope.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => _json(<String, Object?>{
              'success': true,
              'data': <String, Object?>{'hasMore': false},
            })),
      );

      expect(await client.request('GET', '/x'), <String, Object?>{
        'success': true,
        'data': <String, Object?>{'hasMore': false},
      });
    });

    test('returns null for an empty 200 body', () async {
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => http.Response('', 200)),
      );

      expect(await client.request('GET', '/x'), isNull);
    });

    test('returns null rather than throwing on a non-JSON 200 body', () async {
      // A route returning something unparseable is a malformed response for
      // the TYPED method to reject with a route name attached, not something
      // for the transport to crash on.
      final RestClient client = _clientOver(
        MockClient((http.Request _) async => http.Response('<html>', 200)),
      );

      expect(await client.request('GET', '/x'), isNull);
    });
  });

  group('validateSessionSummaryLimit', () {
    test('accepts the boundary values and the server default', () {
      for (final int limit in <int>[1, 5, 20]) {
        expect(() => validateSessionSummaryLimit(limit), returnsNormally);
      }
    });

    test('accepts null — the parameter is omitted, not sent as null', () {
      expect(() => validateSessionSummaryLimit(null), returnsNormally);
    });

    // §5.5: `client.test.ts` drives this with `it.each([0, 21, 1.5, -1, NaN])`.
    // Dart's `int` cannot hold `1.5` or `NaN`, so those two states are
    // compile-time impossible and there is nothing here to assert — this
    // equivalent covers `[0, 21, -1]` only. Not a coverage gap: the same
    // guarantee, enforced one layer earlier by the type system.
    for (final int limit in <int>[0, 21, -1]) {
      test('rejects an out-of-range limit ($limit) locally', () {
        expect(
          () => validateSessionSummaryLimit(limit),
          throwsA(isA<RestValidationException>()),
        );
      });
    }

    test('the failure states that no request was made — as a TYPE', () {
      // TS spells this with `status: 0` on an ordinary API error. A caller
      // checking `is RestValidationException` never has to learn that 0 is
      // special (contract §5.3).
      final Object error = _catchSync(() => validateSessionSummaryLimit(0));

      expect(error, isA<RestValidationException>());
      expect(error, isA<RestException>());
      expect((error as RestException).retryable, isFalse);
    });
  });
}

/// An [http.Client] that records whether it was closed.
///
/// `MockClient` inherits a no-op `close()`, so it cannot tell "we left the
/// caller's client alone" apart from "we closed it and nothing happened".
class _ClosableClient extends http.BaseClient {
  int closeCount = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(const Stream<List<int>>.empty(), 204);

  @override
  void close() => closeCount++;
}

/// Stands in for a platform socket failure without importing `dart:io`, which
/// does not exist on every platform this package targets.
class SocketExceptionStub implements Exception {
  const SocketExceptionStub(this.message);
  final String message;
  @override
  String toString() => 'SocketExceptionStub: $message';
}

Future<RestApiException> _catchApi(Future<Object?> Function() body) async {
  final Object error = await _catchAny(body);
  if (error is RestApiException) return error;
  fail('expected a RestApiException, got $error');
}

Future<Object> _catchAny(Future<Object?> Function() body) async {
  try {
    await body();
  } catch (error) {
    return error;
  }
  fail('expected a throw');
}

Object _catchSync(void Function() body) {
  try {
    body();
  } catch (error) {
    return error;
  }
  fail('expected a throw');
}
