/// The barrel is the only file most consumers import, so what it does and
/// does not expose is part of the contract.
library;

import 'dart:io';

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';
import 'package:test/test.dart';

void main() {
  group('dhaam_chat_rest barrel', () {
    test('exposes the public surface through one import', () {
      // Naming each type is the assertion: this file imports ONLY the barrel,
      // so it would not compile if any of these were missing from it.
      expect(kRestBasePath, isA<String>());
      expect(kReadBackAttempts, isA<int>());
      expect(kSessionSummaryLimitMin, isA<int>());
      expect(kSessionSummaryLimitMax, isA<int>());
      expect(kIpWatermarkTimeout, isA<Duration>());
      expect(kWidgetConfigTimeout, isA<Duration>());
      expect(normalizeMediaType('images'), 'IMAGE');
      expect(RestClient, isNotNull);
      expect(const RestCsatUnrated(), isA<RestCsatStatus>());
      expect(const RestIdentityProfile().toJson(), isEmpty);
      expect(RestDevicePlatform.web.wire, 'web');
      expect(
        const RestIssueReport(subject: 's', details: 'd').toJson(),
        isNotEmpty,
      );
      expect(
        const RestMessagePage(messages: <ChatMessage>[], hasMore: false)
            .hasMore,
        isFalse,
      );
      expect(const RestChatTicket(id: 't').url, isNull);
      expect(
          const RestIpWatermark(ip: '1.2.3.4', watermark: 'w').ip, '1.2.3.4');
    });

    test('re-exports the dhaam_chat types that appear in its own signatures',
        () {
      // A consumer decoding a message page gets back dhaam_chat's ChatMessage.
      // Re-exporting the handful of types this package's signatures actually
      // mention saves every such consumer a second import to name one type.
      expect(PublishableKey.parse('dhp' '_test_' '${'A' * 43}'),
          isA<PublishableKey>());
      expect(ChatStatus.open.wire, 'OPEN');
      expect(ChatMode.bot.wire, 'BOT');
      expect(HandledByKind.agent.wire, 'AGENT');
      expect(const TokenUnavailableError('x'), isA<Exception>());
      expect(
        const AttachmentMetadata(
          url: 'https://x.test/a.png',
          fileName: 'a.png',
          mimeType: 'image/png',
          size: 1,
          mediaType: 'IMAGE',
        ).mediaType,
        'IMAGE',
      );
    });

    test('the exception hierarchy is sealed and exhaustively switchable', () {
      // The property the sealed base buys a caller: a new failure mode cannot
      // be added without every exhaustive handler being told about it.
      const List<RestException> all = <RestException>[
        RestTransportException('cause'),
        RestApiException(
          code: 'INTERNAL',
          message: 'request failed with status 500',
          status: 500,
          retryable: true,
        ),
        RestMalformedResponseException(context: 'ctx', detail: 'detail'),
        RestValidationException('limit out of range'),
        RestSessionReadBackException(
          sessionId: 's1',
          cause: RestTransportException('cause'),
        ),
      ];

      final List<String> labels = all.map((RestException error) {
        return switch (error) {
          RestTransportException() => 'transport',
          RestApiException() => 'api',
          RestMalformedResponseException() => 'malformed',
          RestValidationException() => 'validation',
          RestSessionReadBackException() => 'read-back',
        };
      }).toList();

      expect(labels, <String>[
        'transport',
        'api',
        'malformed',
        'validation',
        'read-back',
      ]);
      // isWorthRetrying's Dart equivalent collapses to one expression, which
      // is the direct consequence of putting `retryable` on the sealed base
      // instead of maintaining an instanceof chain per caller.
      expect(
        all.map((RestException e) => e.retryable).toList(),
        <bool>[true, true, false, false, false],
      );
    });

    test('does NOT export anything under src/internal/', () {
      // Asserted against the file, not by trying to import a private path —
      // an internal import would be a compile error and could not be tested.
      // A consumer reaching for these would be depending on how a route is
      // parsed rather than on what it returns.
      final String barrel = File('lib/dhaam_chat_rest.dart').readAsStringSync();

      expect(barrel, isNot(contains("export 'src/internal/")));

      // And the internal directory really does hold things worth not
      // exporting, so this is not passing vacuously.
      final List<String> internals = Directory('lib/src/internal')
          .listSync()
          .whereType<File>()
          .map((File f) => f.uri.pathSegments.last)
          .toList()
        ..sort();

      expect(internals, <String>[
        'attachment_safety.dart',
        'envelope.dart',
        'json_reading.dart',
        'limits.dart',
        'message_decode.dart',
        'session_decode.dart',
        'session_summary_decode.dart',
      ]);
    });
  });
}
