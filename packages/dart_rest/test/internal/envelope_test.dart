/// Reproduces the assertions of `packages/rest/src/envelope.test.ts`.
library;

import 'dart:convert';

import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/envelope.dart';
import 'package:test/test.dart';

void main() {
  group('unwrapEnvelope', () {
    test('returns the bare payload from a successful envelope', () {
      final Map<String, Object?> data = unwrapEnvelope(
        <String, Object?>{
          'success': true,
          'data': <String, Object?>{
            'messages': <Object?>[],
            'hasMore': false,
          },
        },
        'GET /chat/sessions/{sessionId}/messages',
      );

      expect(data, <String, Object?>{
        'messages': <Object?>[],
        'hasMore': false,
      });
    });

    test('unwraps a body that came through jsonDecode, not just a literal map',
        () {
      // `jsonDecode` returns Map<String, dynamic>, not Map<String, Object?>.
      // The two are mutually assignable in Dart's type system, but that is
      // exactly the kind of fact worth pinning: if the `is Map<String,
      // Object?>` test below ever stopped accepting real decoded JSON, every
      // route in this package would fail at once and no unit test built from
      // literals would notice.
      final Object? body =
          jsonDecode('{"success":true,"data":{"hasMore":true}}');

      expect(unwrapEnvelope(body, 'ctx'), <String, Object?>{'hasMore': true});
    });

    test('rejects a body that is not enveloped at all', () {
      // The defect this exists to catch: the adapters used to read fields off
      // the top level, so an unenveloped body yielded an empty page instead of
      // an error.
      expect(
        () => unwrapEnvelope(
          <String, Object?>{
            'messages': <Object?>[
              <String, Object?>{'id': 'm1'},
            ],
            'hasMore': true,
          },
          'ctx',
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    for (final (String label, Object? body) in <(String, Object?)>[
      (
        'success is false',
        <String, Object?>{
          'success': false,
          'data': <String, Object?>{},
        }
      ),
      ('success is missing', <String, Object?>{'data': <String, Object?>{}}),
      (
        'success is a truthy non-true value',
        <String, Object?>{
          'success': 1,
          'data': <String, Object?>{},
        }
      ),
      ('data is missing', <String, Object?>{'success': true}),
      ('data is null', <String, Object?>{'success': true, 'data': null}),
      ('data is a string', <String, Object?>{'success': true, 'data': 'ok'}),
      // Called out explicitly by the plan. A `List` is not a `Map` in Dart, so
      // unlike TS this needs no `Array.isArray` check to be written — but it
      // is still a stated requirement of the function, so it is still asserted.
      (
        'data is an array',
        <String, Object?>{
          'success': true,
          'data': <Object?>[],
        }
      ),
      ('data is a number', <String, Object?>{'success': true, 'data': 3}),
      ('the body is null', null),
      ('the body is a string', 'not json at all'),
      ('the body is a list', <Object?>[]),
    ]) {
      test('rejects when $label', () {
        expect(
          () => unwrapEnvelope(body, 'ctx'),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('reports a non-retryable failure, since a retry cannot reshape a body',
        () {
      // TS asserts `code: MALFORMED_RESPONSE, status: 200` on a shared error
      // type. Here the type IS the answer — there is no status to read and no
      // code to compare (contract §5.3) — so what is left to assert is the one
      // behavioural fact both encode: retrying is pointless.
      final RestMalformedResponseException error = _catchMalformed(
        () => unwrapEnvelope(<String, Object?>{}, 'ctx'),
      );

      expect(error.retryable, isFalse);
      expect(error, isA<RestException>());
    });

    test('names the route so the failure is locatable', () {
      final RestMalformedResponseException error = _catchMalformed(
        () => unwrapEnvelope(<String, Object?>{}, 'POST /upload'),
      );

      expect(error.context, 'POST /upload');
      expect(error.toString(), contains('POST /upload'));
    });

    test('never echoes the response body — it can carry signed URLs (§14)', () {
      final Map<String, Object?> body = <String, Object?>{
        'url': 'https://cdn.example.test/x.png?X-Amz-Signature=SECRETSIG',
      };

      final RestMalformedResponseException error = _catchMalformed(
        () => unwrapEnvelope(body, 'POST /upload'),
      );

      expect(error.detail, isNot(contains('SECRETSIG')));
      expect(error.detail, isNot(contains('cdn.example.test')));
      // toString() is the one that actually reaches a log, so it is asserted
      // separately rather than assumed to follow from the fields.
      expect(error.toString(), isNot(contains('SECRETSIG')));
      expect(error.toString(), isNot(contains('cdn.example.test')));
    });

    test(
        'passes an empty object through — an envelope with no fields is still '
        'an envelope', () {
      // Shape validation of the payload itself belongs to the typed method
      // that knows which fields its route promises, not here.
      expect(
        unwrapEnvelope(
          <String, Object?>{'success': true, 'data': <String, Object?>{}},
          'ctx',
        ),
        isEmpty,
      );
    });
  });
}

/// Runs [body] and returns the [RestMalformedResponseException] it threw.
///
/// `expect(..., throwsA(...))` proves the type but hands back nothing to
/// inspect, and the leak assertions above need the actual instance.
RestMalformedResponseException _catchMalformed(void Function() body) {
  try {
    body();
  } on RestMalformedResponseException catch (error) {
    return error;
  }
  fail('expected a RestMalformedResponseException');
}
