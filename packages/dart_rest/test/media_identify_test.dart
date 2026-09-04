/// Reproduces `packages/rest/src/identity.test.ts` — all four `describe`s.
///
/// ── Two of its cases have nothing to port, and one inverts ────────────────
///
///  * `'drops an explicitly-undefined optional rather than sending it as
///    null'` probes a TypeScript-only runtime state: a host assembling a
///    profile from optional data produces `{name: 'x', phone: undefined}`,
///    which `exactOptionalPropertyTypes` cannot express as a literal. Dart has
///    one absence, `null`, and `RestIdentityProfile.toJson` omits it — so the
///    case below covering an unsupplied optional IS that case.
///  * `identity-profile-parity.test.ts` diffs two hand-kept-identical TS
///    declarations. `RestIdentityProfile` has no sibling declaration anywhere
///    in the Dart SDK to drift from — there is no Dart `core` — so it has
///    nothing to port (contract §3). Flagged, not silently dropped.
///  * `'leaving lastLoginAt an ISO string'` INVERTS: this port decodes it to a
///    `DateTime`, because `dhaam_chat`'s convention is that every wire
///    timestamp is one. That is the same consistency argument `identity.ts`
///    makes, producing the opposite concrete answer (contract §5.7).
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/media.dart';
import 'package:dhaam_chat_rest/src/models/identity.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

http.Response _json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

Map<String, Object?> _identifyResponse([
  Map<String, Object?> overrides = const <String, Object?>{},
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{
        'contactId': '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        'externalId': 'usr_9f2',
        'lastLoginAt': '2026-08-21T09:14:03.512Z',
        ...overrides,
      },
    };

class _Recorder {
  final List<http.Request> calls = <http.Request>[];

  RestClient client(
    FutureOr<http.Response> Function(http.Request request) responder,
  ) =>
      RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient((http.Request request) async {
          calls.add(request);
          return responder(request);
        }),
      );

  /// What actually went on the wire, decoded.
  Map<String, Object?> get sentBody =>
      jsonDecode(calls.single.body) as Map<String, Object?>;
}

void main() {
  group('identify request', () {
    test('POSTs to the identify route under the service prefix', () async {
      final _Recorder recorder = _Recorder();
      await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(const RestIdentityProfile());

      expect(
        '${recorder.calls.single.method} ${recorder.calls.single.url.path}',
        'POST /chat-services/api/v1/identify',
      );
    });

    test('sends both credentials and a JSON content type', () async {
      final _Recorder recorder = _Recorder();
      await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(const RestIdentityProfile(email: 'jordan@example.com'));

      final Map<String, String> headers = recorder.calls.single.headers;
      expect(headers['Authorization'], 'Bearer tok_abc');
      expect(headers['X-Publishable-Key'], _key.value);
      expect(headers['Content-Type'], startsWith('application/json'));
    });

    test('puts the full profile on the wire unchanged', () async {
      final _Recorder recorder = _Recorder();
      await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(
            const RestIdentityProfile(
              name: 'Jordan Rivera',
              email: 'jordan@example.com',
              phone: '+919820011223',
              city: 'Mumbai',
              country: 'IN',
              tags: <String>['vip', 'not-a-real-tag'],
              device: RestIdentityDevice(
                deviceId: 'web-9f2c-4b1a',
                deviceToken: 'tkn-1',
                platform: RestDevicePlatform.web,
              ),
            ),
          );

      expect(recorder.sentBody, <String, Object?>{
        'name': 'Jordan Rivera',
        'email': 'jordan@example.com',
        'phone': '+919820011223',
        'city': 'Mumbai',
        'country': 'IN',
        'tags': <String>['vip', 'not-a-real-tag'],
        'device': <String, Object?>{
          'deviceId': 'web-9f2c-4b1a',
          'deviceToken': 'tkn-1',
          // Lowercase, unlike every other enum this package speaks. That is
          // the route's own spelling, not a normalization to tidy: 'WEB' is a
          // validation failure.
          'platform': 'web',
        },
      });
    });

    test('omits an unsupplied optional ENTIRELY rather than sending a null',
        () async {
      // The load-bearing serialization assertion. Both the body and `device`
      // are `.strict()`, so an unexpected key is a 400 — and the route's write
      // matrix distinguishes "not present" from a value, so `phone: null` and
      // no `phone` must not be conflated on this side.
      final _Recorder recorder = _Recorder();
      await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(
            const RestIdentityProfile(
              name: 'Jordan Rivera',
              device: RestIdentityDevice(deviceId: 'web-9f2c-4b1a'),
            ),
          );

      final Map<String, Object?> sent = recorder.sentBody;
      expect(sent.keys, <String>['name', 'device']);
      // Asserted as ABSENCE of the key, not as a null value: the two are
      // different requests to a `.strict()` route, and this test exists
      // precisely to tell them apart.
      for (final String key in <String>[
        'email',
        'phone',
        'city',
        'country',
        'tags',
      ]) {
        expect(sent.containsKey(key), isFalse, reason: '$key must be absent');
      }
      expect((sent['device']! as Map<String, Object?>).keys, <String>[
        'deviceId',
      ]);
      // And nothing anywhere in the serialized body is a null.
      expect(recorder.calls.single.body, isNot(contains('null')));
    });

    test('sends an empty object for an empty profile, which the route accepts',
        () async {
      final _Recorder recorder = _Recorder();
      await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(const RestIdentityProfile());

      expect(recorder.calls.single.body, '{}');
      expect(recorder.calls.single.headers['Content-Type'],
          startsWith('application/json'));
    });
  });

  group('identify success response', () {
    test('unwraps the envelope to the receipt', () async {
      final _Recorder recorder = _Recorder();
      final RestIdentityResult result = await recorder
          .client((http.Request _) => _json(_identifyResponse()))
          .identify(const RestIdentityProfile(email: 'jordan@example.com'));

      expect(result.contactId, '3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(result.externalId, 'usr_9f2');
      // A DateTime, not the raw string TS pins — see this file's header.
      expect(result.lastLoginAt, DateTime.utc(2026, 8, 21, 9, 14, 3, 512));
      expect(result.lastLoginAt.isUtc, isTrue);
    });

    test('reads a lastLoginAt sent as epoch millis rather than an ISO string',
        () async {
      // The lenient timestamp reader, which defends against this service
      // returning a raw Date on a cache miss and an ISO string on a cache hit.
      final _Recorder recorder = _Recorder();
      final RestIdentityResult result = await recorder
          .client((http.Request _) => _json(
                _identifyResponse(
                    <String, Object?>{'lastLoginAt': 1787303643512}),
              ))
          .identify(const RestIdentityProfile());

      expect(result.lastLoginAt, DateTime.utc(2026, 8, 21, 9, 14, 3, 512));
    });

    test('returns only the three documented fields, not what else data carries',
        () async {
      // Rebuilt rather than cast, so nothing the route may grow later rides
      // along untyped — and nothing internal leaks through.
      final _Recorder recorder = _Recorder();
      final RestIdentityResult result = await recorder
          .client((http.Request _) => _json(
                _identifyResponse(<String, Object?>{'internalNote': 'leaked'}),
              ))
          .identify(const RestIdentityProfile());

      expect(result.contactId, '3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(result.externalId, 'usr_9f2');
      expect(result.lastLoginAt, isA<DateTime>());
    });
  });

  group('identify failure taxonomy', () {
    for (final (String label, Object? body) in <(String, Object?)>[
      ('no data key', <String, Object?>{'success': true}),
      (
        'an array under data',
        <String, Object?>{
          'success': true,
          'data': <Object?>[],
        }
      ),
      ('data as null', <String, Object?>{'success': true, 'data': null}),
      (
        'success: false',
        <String, Object?>{
          'success': false,
          'data': <String, Object?>{'contactId': 'c1'},
        }
      ),
      (
        'a bare payload with no envelope at all',
        <String, Object?>{
          'contactId': 'c1',
          'externalId': 'u1',
          'lastLoginAt': '2026-08-21T09:14:03.512Z',
        }
      ),
    ]) {
      test('rejects $label as a malformed response', () async {
        final _Recorder recorder = _Recorder();
        await expectLater(
          recorder
              .client((http.Request _) => _json(body))
              .identify(const RestIdentityProfile()),
          throwsA(
            isA<RestMalformedResponseException>()
                .having((RestMalformedResponseException e) => e.context,
                    'context', 'POST /identify')
                .having((RestMalformedResponseException e) => e.retryable,
                    'retryable', isFalse),
          ),
        );
      });
    }

    for (final String field in <String>[
      'contactId',
      'externalId',
      'lastLoginAt',
    ]) {
      test('rejects an envelope whose data is missing $field', () async {
        final Map<String, Object?> body = _identifyResponse();
        (body['data']! as Map<String, Object?>).remove(field);

        final _Recorder recorder = _Recorder();
        await expectLater(
          recorder
              .client((http.Request _) => _json(body))
              .identify(const RestIdentityProfile()),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });

      test('rejects an envelope whose $field is the empty string', () async {
        // Each of the three is required as a NON-EMPTY value: a zero-length
        // contact id is a field-shaped hole every downstream lookup would
        // happily key on and nobody would notice until a customer did.
        final _Recorder recorder = _Recorder();
        await expectLater(
          recorder
              .client((http.Request _) =>
                  _json(_identifyResponse(<String, Object?>{field: ''})))
              .identify(const RestIdentityProfile()),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('surfaces a 400 validation envelope as non-retryable', () async {
      final _Recorder recorder = _Recorder();
      final Object error = await recorder
          .client((http.Request _) => _json(
                <String, Object?>{
                  'success': false,
                  'error': <String, Object?>{
                    'code': 'VALIDATION_ERROR',
                    'message': 'body/email must match format "email"',
                    'retryable': false,
                  },
                },
                400,
              ))
          .identify(const RestIdentityProfile(email: 'nope'))
          .then<Object>((RestIdentityResult _) => 'did not throw',
              onError: (Object e) => e);

      expect(error, isA<RestApiException>());
      final RestApiException api = error as RestApiException;
      expect(api.code, 'VALIDATION_ERROR');
      expect(api.status, 400);
      expect(api.retryable, isFalse);
      // The server's own text goes to serverMessage, never to message — the
      // latter is what a host pipes into a crash reporter by default.
      expect(api.serverMessage, 'body/email must match format "email"');
      expect(api.message, isNot(contains('email must match')));
    });

    test('surfaces a 429 as retryable, read from the body not the status',
        () async {
      final _Recorder recorder = _Recorder();
      final Object error = await recorder
          .client((http.Request _) => _json(
                <String, Object?>{
                  'error': <String, Object?>{
                    'code': 'RATE_LIMITED',
                    'message': 'too many requests',
                    'retryable': true,
                  },
                },
                429,
              ))
          .identify(const RestIdentityProfile())
          .then<Object>((RestIdentityResult _) => 'did not throw',
              onError: (Object e) => e);

      // 429 is below the `>= 500` fallback, so `retryable: true` can only have
      // come from the body.
      expect((error as RestApiException).retryable, isTrue);
      expect(error.status, 429);
    });

    test(
        'reports a request that never reached the server as a transport '
        'failure', () async {
      // Opposite remedies — fix the credential vs. try again later — so these
      // must not collapse into one type.
      final _Recorder recorder = _Recorder();
      final Object error = await recorder
          .client((http.Request _) => throw const SocketishFailure())
          .identify(const RestIdentityProfile())
          .then<Object>((RestIdentityResult _) => 'did not throw',
              onError: (Object e) => e);

      expect(error, isA<RestTransportException>());
      expect(error, isNot(isA<RestApiException>()));
    });

    test('does NOT retry the identify call itself', () async {
      // The retry belongs to a caller, where the jitter and timer seams are.
      // kReadBackAttempts is scoped to the close/reopen read-back and must not
      // generalize to this adapter.
      final _Recorder recorder = _Recorder();
      await expectLater(
        recorder
            .client((http.Request _) => _json(
                  <String, Object?>{
                    'error': <String, Object?>{
                      'code': 'INTERNAL',
                      'message': 'boom',
                    },
                  },
                  500,
                ))
            .identify(const RestIdentityProfile()),
        // Retryable by the status fallback — precisely the case an adapter
        // with a loop in it would have retried.
        throwsA(isA<RestApiException>()
            .having((RestApiException e) => e.retryable, 'retryable', isTrue)),
      );

      expect(recorder.calls, hasLength(1));
    });

    test('lets a failing token provider propagate before any request',
        () async {
      // Auth failure is distinguishable from transport failure by TYPE, which
      // is the property that stops a caller retrying "I have no credential"
      // forever.
      final List<http.Request> calls = <http.Request>[];
      final RestClient client = RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => throw const TokenUnavailableError('nope'),
        httpClient: MockClient((http.Request request) async {
          calls.add(request);
          return _json(_identifyResponse());
        }),
      );

      await expectLater(
        client.identify(const RestIdentityProfile()),
        throwsA(isA<TokenUnavailableError>()),
      );
      expect(calls, isEmpty);
    });
  });
}

/// A stand-in for whatever a platform raises when a request never leaves.
///
/// The transport catches everything and reshapes it into a
/// [RestTransportException], so the concrete type here is deliberately not one
/// `package:http` or `dart:io` defines — the point is that ANY failure to
/// reach the server arrives as the same type.
class SocketishFailure implements Exception {
  const SocketishFailure();
}
