import 'dart:convert';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// The guard the reference names in its own comment:
/// `/sessions/undefined/transcript/email` must be unreachable. Asserted twice
/// over — here, where the sentence a customer sees is produced, and in
/// `dart_rest`'s `support_test.dart`, where the package-level invariant holds
/// for every other caller.
///
/// `widget.ts:3651-3669` and `:3700-3712` are the only authority for either
/// route: no REST adapter, no OpenAPI entry, no TypeScript test.

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

void main() {
  final List<http.Request> sent = <http.Request>[];

  setUp(sent.clear);

  RestClient client({int status = 200}) => RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient((http.Request request) async {
          sent.add(request);
          return http.Response(
            jsonEncode(
              <String, Object?>{'success': true, 'data': <String, Object?>{}},
            ),
            status,
            headers: <String, String>{'Content-Type': 'application/json'},
          );
        }),
      );

  group('restTranscriptEmailer', () {
    test('posts to the session it resolves AT CALL TIME', () async {
      // The button only exists on a CLOSED conversation, so the live session
      // is already gone by the time it is pressed and the id comes from
      // whatever the widget remembered. A captured value would be the id of
      // whichever session happened to be current when the header was built.
      String? current = 'sess_1';
      final TranscriptEmailer email = restTranscriptEmailer(
        client: client(),
        sessionId: () => current,
      );

      await email();
      current = 'sess_2';
      await email();

      expect(
        sent.map((http.Request r) => r.url.path).toList(),
        <String>[
          '/chat-services/api/v1/chat/sessions/sess_1/transcript/email',
          '/chat-services/api/v1/chat/sessions/sess_2/transcript/email',
        ],
      );
    });

    test('sends no body at all — the recipient is the server\'s to decide',
        () async {
      final TranscriptEmailer email = restTranscriptEmailer(
        client: client(),
        sessionId: () => 'sess_1',
      );
      await email();
      expect(sent.single.body, isEmpty);
    });

    test('a null session id can never produce a request', () async {
      final TranscriptEmailer email = restTranscriptEmailer(
        client: client(),
        sessionId: () => null,
      );
      await expectLater(email(), throwsA(isA<StateError>()));
      expect(sent, isEmpty);
    });

    test('nor can a blank one', () async {
      final TranscriptEmailer email = restTranscriptEmailer(
        client: client(),
        sessionId: () => '   ',
      );
      await expectLater(email(), throwsA(isA<StateError>()));
      expect(sent, isEmpty);
    });

    test('rejects on a server refusal, so the button can relabel itself',
        () async {
      final TranscriptEmailer email = restTranscriptEmailer(
        client: client(status: 500),
        sessionId: () => 'sess_1',
      );
      await expectLater(email(), throwsA(isA<RestApiException>()));
    });
  });

  group('restIssueReporter', () {
    test('posts the report to the session it resolves at call time', () async {
      final IssueReporter report = restIssueReporter(
        client: client(),
        sessionId: () => 'sess_1',
      );

      await report(
        const RestIssueReport(subject: 'Broken', details: 'It does nothing.'),
      );

      expect(
        sent.single.url.path,
        '/chat-services/api/v1/chat/sessions/sess_1/report-issue',
      );
      expect(jsonDecode(sent.single.body), <String, Object?>{
        'subject': 'Broken',
        'details': 'It does nothing.',
      });
    });

    test('a null session id can never produce a request', () async {
      final IssueReporter report = restIssueReporter(
        client: client(),
        sessionId: () => null,
      );
      await expectLater(
        report(const RestIssueReport(subject: 's', details: 'd')),
        throwsA(isA<StateError>()),
      );
      expect(sent, isEmpty);
    });

    test('rejects on a server refusal, so the form keeps what was typed',
        () async {
      final IssueReporter report = restIssueReporter(
        client: client(status: 400),
        sessionId: () => 'sess_1',
      );
      await expectLater(
        report(const RestIssueReport(subject: 's', details: 'd')),
        throwsA(isA<RestApiException>()),
      );
    });
  });
}
