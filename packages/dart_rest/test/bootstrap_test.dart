/// Reproduces `packages/widget/test/contact-info.test.ts`'s
/// `describe('fetchIpWatermark')`, and covers `fetchWidgetConfig` against the
/// same fixtures `packages/flutter/test/config/remote_config_client_test.dart`
/// already uses for the transport half T16 will delegate to it (D3).
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/bootstrap.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

http.Response _json(Object? body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

void main() {
  group('fetchIpWatermark', () {
    test('parses a well-formed response', () async {
      final RestIpWatermark? result = await fetchIpWatermark(
        apiUrl: 'https://api.example.com',
        httpClient: MockClient((http.Request _) async => _json(
              <String, Object?>{'ip': '203.0.113.7', 'watermark': 'abc.def'},
            )),
      );

      expect(result?.ip, '203.0.113.7');
      expect(result?.watermark, 'abc.def');
    });

    test('hits the fixed path, with no trailing slash duplicated', () async {
      late Uri requested;
      await fetchIpWatermark(
        apiUrl: 'https://api.example.com/',
        httpClient: MockClient((http.Request request) async {
          requested = request.url;
          return _json(<String, Object?>{'ip': '1.2.3.4', 'watermark': 'w'});
        }),
      );

      expect(
        requested.toString(),
        'https://api.example.com/chat-services/api/v1/ip-watermark',
      );
    });

    test('sends NO credential — not a token, not a publishable key', () async {
      // The route authenticates nothing and identifies no tenant; it echoes
      // the caller's own observed address back, watermarked. This function
      // takes no PublishableKey at all, so the assertion is that nothing
      // credential-shaped appears on the wire.
      late http.Request sent;
      await fetchIpWatermark(
        apiUrl: 'https://api.example.com',
        httpClient: MockClient((http.Request request) async {
          sent = request;
          return _json(<String, Object?>{'ip': '1.2.3.4', 'watermark': 'w'});
        }),
      );

      expect(sent.headers.containsKey('Authorization'), isFalse);
      expect(sent.headers.containsKey('X-Publishable-Key'), isFalse);
      expect(sent.method, 'GET');
    });

    test('asks for a fresh watermark rather than a cached one', () async {
      // TS passes `cache: 'no-store'`. On iOS and Android there is no
      // transparent cache to defeat, but this package builds for Flutter Web
      // too, where the browser's cache is real. A stale watermark is worse
      // than none: it describes an address the caller may no longer be at.
      late http.Request sent;
      await fetchIpWatermark(
        apiUrl: 'https://api.example.com',
        httpClient: MockClient((http.Request request) async {
          sent = request;
          return _json(<String, Object?>{'ip': '1.2.3.4', 'watermark': 'w'});
        }),
      );

      expect(sent.headers['Cache-Control'], 'no-store');
    });

    test('returns null on a non-2xx status', () async {
      expect(
        await fetchIpWatermark(
          apiUrl: 'https://api.example.com',
          httpClient: MockClient(
              (http.Request _) async => _json(<String, Object?>{}, 500)),
        ),
        isNull,
      );
    });

    for (final (String label, Object? body) in <(String, Object?)>[
      ('ip is not a string', <String, Object?>{'ip': 7, 'watermark': 'w'}),
      ('watermark is missing', <String, Object?>{'ip': '1.2.3.4'}),
      ('ip is missing', <String, Object?>{'watermark': 'w'}),
      ('the body is null', null),
      ('the body is a list', <Object?>[]),
      ('the body is a string', 'nope'),
    ]) {
      test('returns null on a malformed body — $label', () {
        // Both fields are required: a watermark with no address is not half an
        // answer, it is an answer the console cannot render.
        expect(
          fetchIpWatermark(
            apiUrl: 'https://api.example.com',
            httpClient: MockClient((http.Request _) async => _json(body)),
          ),
          completion(isNull),
        );
      });
    }

    test('returns null, never throws, on a body that is not JSON at all',
        () async {
      expect(
        await fetchIpWatermark(
          apiUrl: 'https://api.example.com',
          httpClient: MockClient(
              (http.Request _) async => http.Response('<html>', 200)),
        ),
        isNull,
      );
    });

    test('returns null, never throws, on a network failure', () async {
      expect(
        await fetchIpWatermark(
          apiUrl: 'https://api.example.com',
          httpClient: MockClient(
            (http.Request _) async =>
                throw http.ClientException('Failed to fetch'),
          ),
        ),
        isNull,
      );
    });

    test('returns null, never throws, when the request times out', () async {
      // The Dart equivalent of TS's AbortController case: a request that never
      // settles must not hang a widget's boot.
      expect(
        await fetchIpWatermark(
          apiUrl: 'https://api.example.com',
          timeout: const Duration(milliseconds: 5),
          httpClient: MockClient(
            (http.Request _) => Completer<http.Response>().future,
          ),
        ),
        isNull,
      );
    });

    test('returns null, never throws, on an unparseable apiUrl', () async {
      // The catch is deliberately broad — see _getJson's own comment. A
      // FormatException out of Uri.parse is exactly the kind of thing a
      // narrower `on Exception` would still let escape a function documented
      // never to throw.
      expect(
        await fetchIpWatermark(
          apiUrl: ':::not a url:::',
          httpClient:
              MockClient((http.Request _) async => _json(<String, Object?>{})),
        ),
        isNull,
      );
    });
  });

  group('fetchWidgetConfig', () {
    test('returns the raw decoded body, untyped and unenveloped', () async {
      // Deliberately untyped: the RemoteConfig model stays in
      // dhaam_chat_flutter, which already depends on equatable for it (D3).
      final Object? body = await fetchWidgetConfig(
        apiUrl: 'https://api.example.com',
        publishableKey: _key,
        httpClient: MockClient((http.Request _) async => _json(
              <String, Object?>{'enabled': true, 'primaryColor': '#123456'},
            )),
      );

      expect(body, <String, Object?>{
        'enabled': true,
        'primaryColor': '#123456',
      });
    });

    test('sends the publishable key in a header, never the query string',
        () async {
      // It stays out of access logs and any request-logging middleware keyed
      // off the URL.
      late http.Request sent;
      await fetchWidgetConfig(
        apiUrl: 'https://api.example.com/',
        publishableKey: _key,
        httpClient: MockClient((http.Request request) async {
          sent = request;
          return _json(<String, Object?>{});
        }),
      );

      expect(sent.headers['X-Publishable-Key'], _key.value);
      expect(sent.url.query, isEmpty);
      expect(
        sent.url.toString(),
        'https://api.example.com/chat-services/api/v1/widget/config',
      );
    });

    test('carries no bearer token — this route has a lighter auth model',
        () async {
      // A publishable key and no minted token, which is a different auth model
      // from the two-credential one every RestClient route uses. That
      // difference is why this is not a method on RestClient.
      late http.Request sent;
      await fetchWidgetConfig(
        apiUrl: 'https://api.example.com',
        publishableKey: _key,
        httpClient: MockClient((http.Request request) async {
          sent = request;
          return _json(<String, Object?>{});
        }),
      );

      expect(sent.headers.containsKey('Authorization'), isFalse);
    });

    for (final (String label, Future<http.Response> Function() responder)
        in <(String, Future<http.Response> Function())>[
      (
        'a non-2xx status',
        () async => _json(<String, Object?>{'enabled': true}, 503)
      ),
      ('a body that is not JSON', () async => http.Response('<html>', 200)),
      (
        'a network failure',
        () async => throw http.ClientException('Failed to fetch')
      ),
    ]) {
      test('returns null on $label', () async {
        expect(
          await fetchWidgetConfig(
            apiUrl: 'https://api.example.com',
            publishableKey: _key,
            httpClient: MockClient((http.Request _) => responder()),
          ),
          isNull,
        );
      });
    }

    test('returns null on a timeout rather than blocking the panel', () async {
      expect(
        await fetchWidgetConfig(
          apiUrl: 'https://api.example.com',
          publishableKey: _key,
          timeout: const Duration(milliseconds: 5),
          httpClient:
              MockClient((http.Request _) => Completer<http.Response>().future),
        ),
        isNull,
      );
    });

    test('a JSON null body is indistinguishable from a failure, by design',
        () async {
      // Both mean "render your own defaults" to the caller, so neither needs
      // to be told apart from the other.
      expect(
        await fetchWidgetConfig(
          apiUrl: 'https://api.example.com',
          publishableKey: _key,
          httpClient: MockClient((http.Request _) async => _json(null)),
        ),
        isNull,
      );
    });
  });

  group('timeouts are the documented defaults', () {
    test('both bootstrap calls default to two seconds', () {
      expect(kIpWatermarkTimeout, const Duration(seconds: 2));
      expect(kWidgetConfigTimeout, const Duration(seconds: 2));
    });
  });
}
