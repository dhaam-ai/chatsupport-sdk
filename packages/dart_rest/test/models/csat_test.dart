/// The strictness `client.test.ts`'s `session actions — getCsat` block
/// asserts, at the level the model owns it.
///
/// T6 owns `RestClient.getCsat`/`submitCsat` themselves; this file pins the
/// decoding those two methods will call, so the strictness is settled before
/// either exists.
library;

import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/models/csat.dart';
import 'package:test/test.dart';

const String _ctx = 'GET /chat/sessions/{sessionId}/csat';

void main() {
  group('RestCsatStatus.fromJson', () {
    test('reads {rated: false} as a normal answer, not a failure', () {
      // "No rating yet" is a fact about a session the customer owns, returned
      // as a 200 — never a 404.
      expect(
        RestCsatStatus.fromJson(<String, Object?>{'rated': false}, _ctx),
        isA<RestCsatUnrated>(),
      );
    });

    test('reads a rated session, with its comment and timestamp', () {
      final RestCsatStatus status = RestCsatStatus.fromJson(
        <String, Object?>{
          'rated': true,
          'rating': 4,
          'comment': 'quick and helpful',
          'submittedAt': '2026-08-19T10:00:00.000Z',
        },
        _ctx,
      );

      expect(status, isA<RestCsatRated>());
      final RestCsatRated rated = status as RestCsatRated;
      expect(rated.rating, 4);
      expect(rated.comment, 'quick and helpful');
      expect(rated.submittedAt, DateTime.utc(2026, 8, 19, 10));
    });

    test('accepts a rated session whose submittedAt the service omitted', () {
      final RestCsatStatus status = RestCsatStatus.fromJson(
        <String, Object?>{'rated': true, 'rating': 5},
        _ctx,
      );

      expect((status as RestCsatRated).submittedAt, isNull);
      expect(status.comment, isNull);
    });

    test('accepts an integral-double rating, which is every rating on Web', () {
      final RestCsatStatus status = RestCsatStatus.fromJson(
        <String, Object?>{'rated': true, 'rating': 5.0},
        _ctx,
      );

      expect((status as RestCsatRated).rating, 5);
    });

    for (final (String label, Object? rated) in <(String, Object?)>[
      ('absent', null),
      ('a truthy number', 1),
      ('the string "false"', 'false'),
    ]) {
      test('throws when rated is $label rather than reading it as unrated', () {
        // Reading a malformed body as "no rating yet" would re-offer the
        // survey and destroy a rating the customer already gave — the exact
        // case this route exists to prevent.
        expect(
          () =>
              RestCsatStatus.fromJson(<String, Object?>{'rated': rated}, _ctx),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    for (final (String label, Object? rating) in <(String, Object?)>[
      ('absent', null),
      ('a string', '4'),
      ('a non-integral double', 4.5),
    ]) {
      test('throws when rated is true but rating is $label', () {
        // A "locked" card with nothing in it is exactly as broken as losing
        // the rating.
        expect(
          () => RestCsatStatus.fromJson(
            <String, Object?>{'rated': true, 'rating': rating},
            _ctx,
          ),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('the union is exhaustive — a switch over it needs no default', () {
      // The property the sealed class buys: adding a third state would be a
      // compile error at every call site rather than a silent fallthrough.
      const RestCsatStatus status = RestCsatUnrated();

      final String rendered = switch (status) {
        RestCsatUnrated() => 'offer the survey',
        RestCsatRated(:final int rating) => 'locked at $rating',
      };

      expect(rendered, 'offer the survey');
    });
  });

  group('RestCsatSubmission.fromJson', () {
    test('reads the submit receipt field for field', () {
      final RestCsatSubmission submission = RestCsatSubmission.fromJson(
        <String, Object?>{
          'sessionId': 's1',
          'rating': 5,
          'comment': 'great',
          'submittedAt': '2026-08-19T10:00:00.000Z',
        },
        'POST /chat/sessions/{sessionId}/csat',
      );

      expect(submission.sessionId, 's1');
      expect(submission.rating, 5);
      expect(submission.comment, 'great');
      expect(submission.submittedAt, DateTime.utc(2026, 8, 19, 10));
    });

    test('folds an absent and an explicitly-null comment into the same null',
        () {
      // The route documents `string | null`; a caller distinguishing the two
      // would be reading a difference the server does not make.
      RestCsatSubmission decode(Map<String, Object?> json) =>
          RestCsatSubmission.fromJson(json, 'POST …/csat');

      expect(
        decode(<String, Object?>{
          'sessionId': 's1',
          'rating': 5,
          'comment': null,
          'submittedAt': '2026-08-19T10:00:00.000Z',
        }).comment,
        isNull,
      );
      expect(
        decode(<String, Object?>{
          'sessionId': 's1',
          'rating': 5,
          'submittedAt': '2026-08-19T10:00:00.000Z',
        }).comment,
        isNull,
      );
    });

    test('requires sessionId, rating and submittedAt', () {
      expect(
        () => RestCsatSubmission.fromJson(
          <String, Object?>{'rating': 5, 'submittedAt': 0},
          'POST …/csat',
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => RestCsatSubmission.fromJson(
          <String, Object?>{'sessionId': 's1', 'submittedAt': 0},
          'POST …/csat',
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => RestCsatSubmission.fromJson(
          <String, Object?>{'sessionId': 's1', 'rating': 5},
          'POST …/csat',
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });
}
