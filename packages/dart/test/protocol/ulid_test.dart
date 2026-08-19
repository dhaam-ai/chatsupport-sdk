import 'dart:math';

import 'package:dhaam_chat/src/protocol/ulid.dart';
import 'package:test/test.dart';

void main() {
  group('isValidUlid', () {
    test('accepts a canonical 26-character Crockford base32 id', () {
      expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'), isTrue);
    });

    test('rejects the four excluded Crockford letters', () {
      // I, L, O and U are excluded precisely so they cannot be confused with
      // 1, 1, 0 and V. A generator that emits them is using the wrong
      // alphabet, and the server refuses the frame.
      for (final String letter in <String>['I', 'L', 'O', 'U']) {
        final String id = letter * 26;
        expect(isValidUlid(id), isFalse, reason: 'should reject "$letter"');
      }
    });

    test('rejects lowercase', () {
      expect(isValidUlid('01arz3ndektsv4rrffq69g5fav'), isFalse);
    });

    test('rejects the wrong length', () {
      expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FA'), isFalse);
      expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVX'), isFalse);
      expect(isValidUlid(''), isFalse);
    });

    test('rejects a UUID, the likeliest wrong guess from the spec alone', () {
      // §7.2 says "ULID" without defining it. A UUID is what an implementer
      // reaches for when the format is unstated; it fails here, which is the
      // whole reason this test exists.
      expect(isValidUlid('f47ac10b-58cc-4372-a567-0e02b2c3d479'), isFalse);
    });
  });

  group('UlidGenerator', () {
    test('produces ids that validate', () {
      final UlidGenerator generator = UlidGenerator();
      for (int i = 0; i < 100; i++) {
        expect(isValidUlid(generator.next()), isTrue);
      }
    });

    test('is monotonic within a single millisecond', () {
      // Clock pinned: every call lands in the same millisecond, so only the
      // monotonic increment can keep these ordered.
      final UlidGenerator generator = UlidGenerator(
        now: () => 1700000000000,
        random: Random(42),
      );

      final List<String> ids = <String>[
        for (int i = 0; i < 500; i++) generator.next(),
      ];

      final List<String> sorted = List<String>.of(ids)..sort();
      expect(ids, equals(sorted));
      expect(ids.toSet().length, equals(ids.length));
    });

    test('sorts by time across advancing milliseconds', () {
      int millis = 1700000000000;
      final UlidGenerator generator = UlidGenerator(
        now: () => millis,
        random: Random(7),
      );

      final List<String> ids = <String>[];
      for (int i = 0; i < 50; i++) {
        ids.add(generator.next());
        millis += 1;
      }

      expect(ids, equals(List<String>.of(ids)..sort()));
    });

    test('encodes the timestamp in the leading 10 characters', () {
      // Two ids from the same millisecond must share a time prefix; one from a
      // later millisecond must not. This is what makes the prefix meaningful.
      int millis = 1700000000000;
      final UlidGenerator generator = UlidGenerator(
        now: () => millis,
        random: Random(1),
      );

      final String first = generator.next();
      final String second = generator.next();
      millis += 1000;
      final String later = generator.next();

      expect(second.substring(0, 10), equals(first.substring(0, 10)));
      expect(later.substring(0, 10), isNot(equals(first.substring(0, 10))));
    });

    test('stays valid and unique when the clock jumps backwards', () {
      // Routine on a phone: NTP correction, or the user changing the device
      // time. Ordering is lost — `seq` is the wire ordering key (D2), not this
      // — but ids must stay well-formed and distinct.
      final List<int> clock = <int>[
        1700000000000,
        1699999999000,
        1700000000001
      ];
      int index = 0;
      final UlidGenerator generator = UlidGenerator(
        now: () => clock[index++],
        random: Random(3),
      );

      final List<String> ids = <String>[
        generator.next(),
        generator.next(),
        generator.next(),
      ];

      expect(ids.every(isValidUlid), isTrue);
      expect(ids.toSet().length, equals(3));
    });

    test('never emits a character outside the Crockford alphabet', () {
      const String allowed = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      final UlidGenerator generator = UlidGenerator(random: Random(99));
      for (int i = 0; i < 200; i++) {
        for (final int unit in generator.next().codeUnits) {
          expect(allowed.contains(String.fromCharCode(unit)), isTrue);
        }
      }
    });
  });
}
