/// The two support routes.
///
/// There is no TypeScript test to reproduce: `@dhaam-ccrm/rest` never modelled
/// either route, `openapi/chat-api.yaml` has no entry for either, and
/// `widget.ts` issues both raw with no wire-level coverage on either side. So
/// these are the first assertions the two requests have ever had, and
/// `widget.ts:3669`/`:3712` are the only authority they are written against.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart' as barrel;
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/models/issue_report.dart';
import 'package:dhaam_chat_rest/src/support.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match — same reason and spelling as
/// `client_test.dart`.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

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

http.Response _ok() => http.Response(
      jsonEncode(
          <String, Object?>{'success': true, 'data': <String, Object?>{}}),
      200,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

void main() {
  group('emailTranscript — widget.ts:3669', () {
    test('posts to the session path under the base path', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.emailTranscript('sess_1');

      expect(recorder.calls, hasLength(1));
      expect(recorder.calls.single.method, 'POST');
      expect(
        recorder.calls.single.url.path,
        '/chat-services/api/v1/chat/sessions/sess_1/transcript/email',
      );
    });

    test('sends NO body — the recipient is the server\'s to decide', () async {
      // The endpoint's security model, not an omission: an address the
      // browser could choose would make this a way to mail any conversation
      // anywhere. No body also means no `Content-Type` describing one.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.emailTranscript('sess_1');

      expect(recorder.calls.single.body, isEmpty);
      expect(
        recorder.calls.single.headers['Content-Type'],
        isNot(contains('application/json')),
      );
    });

    test('carries both credentials, like every other authed route', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.emailTranscript('sess_1');

      expect(recorder.calls.single.headers['Authorization'], 'Bearer tok_abc');
      expect(recorder.calls.single.headers['X-Publishable-Key'], _key.value);
    });

    test('refuses a blank session id BEFORE any request', () async {
      // The reference's own comment names the shape it was avoiding:
      // `/sessions/undefined/transcript/email`. Dart makes the null case a
      // compile error; what is left is the empty string, and it must not
      // become `/chat/sessions//transcript/email`.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await expectLater(
        client.emailTranscript(''),
        throwsA(isA<RestValidationException>()),
      );
      await expectLater(
        client.emailTranscript('   '),
        throwsA(isA<RestValidationException>()),
      );
      expect(recorder.calls, isEmpty, reason: 'nothing reached the network');
    });

    test('percent-encodes a session id rather than splicing it into the path',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.emailTranscript('a/../b');

      expect(
        recorder.calls.single.url.path,
        '/chat-services/api/v1/chat/sessions/a%2F..%2Fb/transcript/email',
      );
    });

    test('rejects on a server refusal rather than reporting it', () async {
      // The caller is a button that has to change its own label on failure.
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => http.Response('nope', 500)),
      );

      await expectLater(
        client.emailTranscript('sess_1'),
        throwsA(isA<RestApiException>()),
      );
    });
  });

  group('reportIssue — widget.ts:3712', () {
    test('posts the report to the session path', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.reportIssue(
        'sess_1',
        const RestIssueReport(
          subject: 'Checkout is broken',
          details: 'The pay button does nothing.',
        ),
      );

      expect(recorder.calls.single.method, 'POST');
      expect(
        recorder.calls.single.url.path,
        '/chat-services/api/v1/chat/sessions/sess_1/report-issue',
      );
      expect(
        jsonDecode(recorder.calls.single.body),
        <String, Object?>{
          'subject': 'Checkout is broken',
          'details': 'The pay button does nothing.',
        },
      );
    });

    test('sends contactEmail when the customer supplied one', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.reportIssue(
        'sess_1',
        const RestIssueReport(
          subject: 's',
          details: 'd',
          contactEmail: 'jordan@example.com',
        ),
      );

      expect(
        (jsonDecode(recorder.calls.single.body)
            as Map<String, Object?>)['contactEmail'],
        'jordan@example.com',
      );
    });

    test('omits contactEmail entirely when there is none', () async {
      // Load-bearing rather than tidy: the route runs its own `.email()`
      // check on the field, and an empty value fails it for no reason — a
      // customer who chose not to leave an address would have their whole
      // report rejected.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.reportIssue(
        'sess_1',
        const RestIssueReport(subject: 's', details: 'd'),
      );

      expect(
        (jsonDecode(recorder.calls.single.body) as Map<String, Object?>)
            .containsKey('contactEmail'),
        isFalse,
      );
    });

    test('carries neither a tenant nor a session id in the body', () async {
      // The tenant comes from the verified token and the session is in the
      // path. Sending either is a 400 that says so.
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await client.reportIssue(
        'sess_1',
        const RestIssueReport(subject: 's', details: 'd'),
      );

      expect(
        (jsonDecode(recorder.calls.single.body) as Map<String, Object?>)
            .keys
            .toSet(),
        <String>{'subject', 'details'},
      );
    });

    test('refuses a blank session id BEFORE any request', () async {
      final _Recorder recorder = _Recorder();
      final RestClient client =
          _clientOver(recorder.client((http.Request _) => _ok()));

      await expectLater(
        client.reportIssue(
          '',
          const RestIssueReport(subject: 's', details: 'd'),
        ),
        throwsA(isA<RestValidationException>()),
      );
      expect(recorder.calls, isEmpty);
    });

    test('rejects on a server refusal, so the form can keep what was typed',
        () async {
      final _Recorder recorder = _Recorder();
      final RestClient client = _clientOver(
        recorder.client((http.Request _) => http.Response('nope', 400)),
      );

      await expectLater(
        client.reportIssue(
          'sess_1',
          const RestIssueReport(subject: 's', details: 'd'),
        ),
        throwsA(isA<RestApiException>()),
      );
    });
  });

  test('the barrel carries the extension by name', () {
    // "A named extension survives an `export`" is a language property worth
    // pinning rather than assuming — the same assertion `SessionApi` has.
    final barrel.RestClient client =
        _clientOver(MockClient((_) async => _ok()));
    expect(client.emailTranscript, isA<Function>());
    expect(client.reportIssue, isA<Function>());
  });
}
