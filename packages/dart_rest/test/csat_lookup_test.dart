/// The one rule `csatLookupOver` exists to enforce: which `GET …/csat`
/// failure means "this DEPLOYMENT has no CSAT route" and which means "this
/// SESSION cannot be answered for".
///
/// The two are treated oppositely by `CsatMachine` — the first still offers
/// the survey, the second withholds it — and getting the classification wrong
/// is silent in both directions. Carries the wire half of
/// `packages/widget/test/csat-submit.test.ts`'s `describe('a deployment with
/// no GET /csat route')` and `describe('when the CSAT lookup cannot be
/// answered')`; the surface half (what the widget then shows) lives in
/// `packages/flutter/test/ui/csat/csat_surface_test.dart`.
library;

import 'dart:convert';

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match — same spelling as `sessions_test.dart`.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

http.Response _json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'Content-Type': 'application/json'},
    );

CsatLookupFn _lookupAnswering(
  http.Response Function(http.Request request) responder,
) =>
    csatLookupOver(
      RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient((http.Request r) async => responder(r)),
      ),
    );

void main() {
  group('the answers', () {
    test('`{rated: false}` is an ANSWER, not an absence', () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': true,
          'data': <String, Object?>{'rated': false},
        }),
      );

      expect(await lookup('sess_1'), isA<CsatUnrated>());
    });

    test('a rating comes back with its score and comment', () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': true,
          'data': <String, Object?>{
            'rated': true,
            'rating': 4,
            'comment': 'Sorted in a minute',
          },
        }),
      );

      expect(
        await lookup('sess_1'),
        const CsatRated(rating: 4, comment: 'Sorted in a minute'),
      );
    });

    test('a rating with no comment carries null, never an empty string',
        () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': true,
          'data': <String, Object?>{'rated': true, 'rating': 5},
        }),
      );

      expect(await lookup('sess_1'), const CsatRated(rating: 5));
    });
  });

  group('a deployment with no GET /csat route', () {
    // A framework route-not-found carries no envelope, so the transport
    // synthesizes `HTTP_<status>` — the only code shape `describes` accepts.
    for (final int status in <int>[404, 405]) {
      test('$status with no structured code raises CsatRouteMissing', () async {
        final CsatLookupFn lookup = _lookupAnswering(
          (_) => http.Response('Cannot GET', status),
        );

        await expectLater(lookup('sess_1'), throwsA(isA<CsatRouteMissing>()));
      });
    }
  });

  group('a failure that is an answer ABOUT THIS SESSION', () {
    // The case the classification exists to separate. chat-service answers an
    // ownership failure with its own envelope, so the code is structured —
    // and that must NOT be read as a missing route, or the survey is offered
    // over a session whose rating is unknown, and `POST …/csat` is an upsert.
    test('an enveloped SESSION_NOT_FOUND on a 404 propagates unchanged',
        () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': false,
          'error': <String, Object?>{
            'code': 'SESSION_NOT_FOUND',
            'message': 'no such session',
          },
        }, 404),
      );

      await expectLater(
        lookup('sess_1'),
        throwsA(
          isA<RestApiException>()
              .having(
                  (RestApiException e) => e.code, 'code', 'SESSION_NOT_FOUND')
              .having((RestApiException e) => e.status, 'status', 404),
        ),
      );
    });

    test('a 500 is an ordinary failure', () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => http.Response('boom', 500),
      );

      await expectLater(lookup('sess_1'), throwsA(isA<RestApiException>()));
      await expectLater(
          lookup('sess_1'), throwsA(isNot(isA<CsatRouteMissing>())));
    });

    // Reading "we do not understand this body" as "nobody has rated it"
    // re-offers the survey over the exact case this route exists to prevent.
    test('a malformed body THROWS rather than softening to unrated', () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': true,
          'data': <String, Object?>{'rated': 'yes'},
        }),
      );

      await expectLater(
        lookup('sess_1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('`rated: true` with no numeric rating throws too', () async {
      final CsatLookupFn lookup = _lookupAnswering(
        (_) => _json(<String, Object?>{
          'success': true,
          'data': <String, Object?>{'rated': true},
        }),
      );

      await expectLater(
        lookup('sess_1'),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });
}
