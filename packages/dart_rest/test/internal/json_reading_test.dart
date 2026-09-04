/// Covers the field readers `projection.ts`'s own `asRecord`/`requireString`/
/// `toIso`/`requireNonNegativeInt` stand in for, plus the two places this port
/// deliberately diverges from `dhaam_chat`'s equivalents (lenient timestamps,
/// contract §5.1; `DateTime` output, §5.7).
library;

import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/json_reading.dart';
import 'package:test/test.dart';

const String _ctx = 'GET /chat/sessions/{sessionId}/messages';

void main() {
  group('requireObject', () {
    test('accepts a JSON object', () {
      expect(
        requireObject(<String, Object?>{'a': 1}, 'row', context: _ctx),
        <String, Object?>{'a': 1},
      );
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('null', null),
      ('a string', 'nope'),
      ('a number', 3),
      // TS needs an explicit Array.isArray branch here; Dart does not, but the
      // behaviour is asserted either way.
      ('a list', <Object?>[]),
    ]) {
      test('rejects $label', () {
        expect(
          () => requireObject(value, 'row', context: _ctx),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }
  });

  group('requireNonEmptyString', () {
    test('reads a present, non-empty string', () {
      expect(
        requireNonEmptyString(
          <String, Object?>{'id': 'm1'},
          'id',
          'message',
          context: _ctx,
        ),
        'm1',
      );
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('absent', null),
      ('an empty string', ''),
      ('a number', 7),
      ('a bool', true),
    ]) {
      test('rejects a value that is $label', () {
        expect(
          () => requireNonEmptyString(
            <String, Object?>{'id': value},
            'id',
            'message',
            context: _ctx,
          ),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('names the dot path and the route, and never the value', () {
      // The rule dhaam_chat's FrameDecodeException states absolutely and this
      // package inherits: say which field, never what was in it. A malformed
      // row on this service can hold a customer's message text.
      final RestMalformedResponseException error = _catch(
        () => requireNonEmptyString(
          <String, Object?>{'content': 'my credit card is 4111111111111111'},
          'id',
          'message',
          context: _ctx,
        ),
      );

      expect(error.detail, contains('message.id'));
      expect(error.context, _ctx);
      expect(error.toString(), isNot(contains('4111111111111111')));
    });
  });

  group('optionalString', () {
    test('folds absent, null, empty and wrong-typed all into null', () {
      final Map<String, Object?> row = <String, Object?>{
        'present': 'yes',
        'empty': '',
        'nulled': null,
        'numeric': 12,
        'listy': <Object?>[],
      };

      expect(optionalString(row, 'present'), 'yes');
      expect(optionalString(row, 'empty'), isNull);
      expect(optionalString(row, 'nulled'), isNull);
      expect(optionalString(row, 'numeric'), isNull);
      expect(optionalString(row, 'listy'), isNull);
      expect(optionalString(row, 'absent'), isNull);
    });

    test('never throws — an additive field must not cost the row', () {
      expect(
        () => optionalString(<String, Object?>{'x': <Object?>[]}, 'x'),
        returnsNormally,
      );
    });
  });

  group('requireInt — lenient about Flutter Web doubles', () {
    test('accepts a real int', () {
      expect(
        requireInt(<String, Object?>{'n': 3}, 'n', 'row', context: _ctx),
        3,
      );
    });

    test('accepts an integral double, because every JS number is one', () {
      // On Flutter Web `"rating": 3` decodes to 3.0. An `is int` test alone
      // would reject a valid body on exactly one of three target platforms.
      expect(
        requireInt(<String, Object?>{'n': 3.0}, 'n', 'row', context: _ctx),
        3,
      );
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('a non-integral double', 3.5),
      ('a numeric string', '3'),
      ('NaN', double.nan),
      ('infinity', double.infinity),
      ('absent', null),
      ('a bool', true),
    ]) {
      test('rejects $label', () {
        expect(
          () => requireInt(
            <String, Object?>{'n': value},
            'n',
            'row',
            context: _ctx,
          ),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }
  });

  group('requireNonNegativeInt', () {
    test('accepts zero as a normal, present value', () {
      expect(
        requireNonNegativeInt(
          <String, Object?>{'unreadCount': 0},
          'unreadCount',
          'summary',
          context: _ctx,
        ),
        0,
      );
    });

    test('refuses a negative count rather than clamping it', () {
      // A clamped count would make an unread badge lie in a direction no
      // caller can detect.
      expect(
        () => requireNonNegativeInt(
          <String, Object?>{'unreadCount': -1},
          'unreadCount',
          'summary',
          context: _ctx,
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });

  group('requireBool', () {
    test('reads a real boolean', () {
      expect(
        requireBool(<String, Object?>{'rated': false}, 'rated', 'csat',
            context: _ctx),
        isFalse,
      );
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('a truthy number', 1),
      ('the string "true"', 'true'),
      ('absent', null),
    ]) {
      test('refuses to coerce $label', () {
        // Reading a truthy non-boolean as `true` here would lock a CSAT card
        // on a session that was never rated.
        expect(
          () => requireBool(
            <String, Object?>{'rated': value},
            'rated',
            'csat',
            context: _ctx,
          ),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }
  });

  group('readTimestamp — lenient input, DateTime output', () {
    test('accepts an ISO-8601 string with a zone', () {
      expect(
        readTimestamp('2026-08-19T10:00:00.000Z'),
        DateTime.utc(2026, 8, 19, 10),
      );
    });

    test('accepts epoch millis as a number — the cache-miss shape', () {
      // chat-service returns a raw Date on a cache miss and an ISO string on a
      // Redis cache hit (projection.ts:94-106). Both cross HTTP+JSON and both
      // land here. Narrowing this to dhaam_chat's strict WS-only pattern would
      // resurface the exact bug TS's toIso was written to prevent.
      expect(
        readTimestamp(0),
        DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      );
      expect(
        readTimestamp(1755597600000),
        DateTime.fromMillisecondsSinceEpoch(1755597600000, isUtc: true),
      );
    });

    test('accepts an integral double epoch, since Web has no ints', () {
      expect(
        readTimestamp(1755597600000.0),
        DateTime.fromMillisecondsSinceEpoch(1755597600000, isUtc: true),
      );
    });

    test('always returns UTC, whatever offset arrived', () {
      final DateTime? parsed = readTimestamp('2026-08-19T15:30:00+05:30');

      expect(parsed, isNotNull);
      expect(parsed!.isUtc, isTrue);
      expect(parsed, DateTime.utc(2026, 8, 19, 10));
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('null', null),
      ('an unparseable string', 'not a date'),
      ('an empty string', ''),
      ('a bool', true),
      ('an object', <String, Object?>{}),
      ('a list', <Object?>[]),
      // fromMillisecondsSinceEpoch would throw on these rather than return, so
      // they are screened before it is reached — a function documented never to
      // throw must not throw.
      ('NaN', double.nan),
      ('infinity', double.infinity),
    ]) {
      test('returns null for $label', () {
        expect(readTimestamp(value), isNull);
      });
    }

    test('never throws, whatever it is handed', () {
      expect(() => readTimestamp(double.nan), returnsNormally);
      expect(() => readTimestamp(double.infinity), returnsNormally);
    });
  });

  group('requireTimestamp / optionalTimestamp', () {
    test('requireTimestamp throws where readTimestamp returns null', () {
      expect(
        () => requireTimestamp(
          <String, Object?>{'createdAt': 'not a date'},
          'createdAt',
          'message',
          context: _ctx,
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('optionalTimestamp reads null as the documented answer, not a failure',
        () {
      // `closedAt` on an open session is absent by design, not malformed.
      expect(
        optionalTimestamp(<String, Object?>{'closedAt': null}, 'closedAt'),
        isNull,
      );
    });
  });

  group('optionalIntValue', () {
    test('reads an int and an integral double', () {
      expect(optionalIntValue(7), 7);
      expect(optionalIntValue(7.0), 7);
    });

    for (final (String label, Object? value) in <(String, Object?)>[
      ('null', null),
      ('a string', '7'),
      ('a non-integral double', 7.5),
    ]) {
      test('returns null for $label rather than throwing', () {
        // This is the `seq` reader. A row predating sequencing must cost its
        // own ordering, never the page it arrived in.
        expect(optionalIntValue(value), isNull);
      });
    }
  });
}

RestMalformedResponseException _catch(void Function() body) {
  try {
    body();
  } on RestMalformedResponseException catch (error) {
    return error;
  }
  fail('expected a RestMalformedResponseException');
}
