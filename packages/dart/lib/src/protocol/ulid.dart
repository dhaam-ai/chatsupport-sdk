/// ULID generation and validation — PRD §0.5 D1, §9.3.
///
/// D1 makes the client-generated ULID the message's PERMANENT id: the server
/// validates the format, enforces per-session uniqueness, and stores it as the
/// canonical id. There is no id-swap path anywhere in this package. That makes
/// this file load-bearing in a way it would not be if the server minted ids —
/// a malformed id here is a message that can never be sent, and a colliding
/// one is a message that silently vanishes into a dedup check.
///
/// ── SPEC GAP (recorded deliberately) ──────────────────────────────────────
///
/// §7.2 says the envelope `id` is a "ULID" and D1 says the server "validates
/// ULID format". Neither §7 nor the OpenAPI document states WHAT that format
/// is: not the length, not the alphabet, not the case, not the time/random
/// split, and not whether monotonicity within a millisecond is required.
///
/// The accepted format is `^[0-9A-HJKMNP-TV-Z]{26}$` — 26 characters of
/// uppercase Crockford base32 (the alphabet omits I, L, O and U to survive
/// transcription). That regex is enforced by the server and by the TypeScript
/// core, and appears in neither the PRD nor the OpenAPI spec. An implementer
/// working from §7 alone would plausibly reach for a UUID, or a lowercase
/// ULID, and every frame they sent would be refused with VALIDATION_FAILED.
///
/// Deriving this required reading the implementation. See README.md §"Spec
/// gaps found".
library;

import 'dart:math';

/// Crockford base32, excluding I, L, O and U.
const String _encoding = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/// 10 characters of timestamp + 16 of randomness = the canonical 26.
const int _timeLength = 10;
const int _randomLength = 16;

/// The one canonical ULID shape. Must stay byte-identical to the server's
/// `ULID_PATTERN`; loosening it here does not loosen it there.
final RegExp _ulidPattern = RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$');

/// Whether [value] is a syntactically valid ULID.
///
/// This is the same test the server applies to every inbound envelope `id`,
/// so anything failing here would be refused on the wire.
bool isValidUlid(String value) => _ulidPattern.hasMatch(value);

/// Generates ULIDs that sort lexicographically in creation order.
///
/// ── Why this is a class and not a top-level function ──────────────────────
///
/// Monotonicity within a millisecond requires remembering the previous value.
/// A ULID's first 10 characters encode epoch-millis, so two ULIDs minted in
/// the same millisecond differ only in their random half and sort in random
/// order relative to each other. Messages are ordered by `seq` on the wire
/// (D2), so this does not affect protocol correctness — but a host app that
/// sorts its own optimistic, not-yet-acked messages by id would see them
/// flicker into a different order, and two messages sent by a fast typist land
/// in the same millisecond routinely.
///
/// So when the clock has not advanced, the random half is incremented as a
/// base-32 integer rather than redrawn — the behaviour the ULID specification
/// calls monotonic. This is NOT required by the PRD; the PRD does not mention
/// it at all (see the library comment above).
///
/// Both the clock and the entropy source are injectable so tests can pin them.
class UlidGenerator {
  /// Creates a generator.
  ///
  /// [now] returns epoch-millis and defaults to the system clock. [random]
  /// defaults to [Random.secure]; a seeded [Random] makes output reproducible
  /// in tests, and must never be used in production — a predictable message id
  /// is a predictable idempotency key.
  UlidGenerator({int Function()? now, Random? random})
      : _now = now ?? _systemNowMillis,
        _random = random ?? Random.secure();

  static int _systemNowMillis() => DateTime.now().millisecondsSinceEpoch;

  final int Function() _now;
  final Random _random;

  /// Epoch-millis of the last ULID minted, or -1 before the first.
  int _lastMillis = -1;

  /// The random half of the last ULID, as 16 digits each in 0..31.
  final List<int> _lastRandom = List<int>.filled(_randomLength, 0);

  /// Mints the next ULID.
  ///
  /// Throws [StateError] in the (practically unreachable) case that the random
  /// half overflows after 32^16 calls inside a single millisecond. Throwing
  /// beats wrapping: a wrapped counter mints a duplicate id, and under D1 a
  /// duplicate id is a message the server dedups away — data loss reported as
  /// success. A crash is the honest outcome.
  String next() {
    final int millis = _now();

    if (millis == _lastMillis) {
      _incrementLastRandom();
    } else {
      // A clock that jumps BACKWARD (NTP correction, user changing the device
      // time — routine on a phone) is treated the same as any forward jump:
      // the random half is redrawn and `_lastMillis` follows the clock. The
      // ids stop being globally sorted, which is unavoidable once the clock
      // lies, but they stay unique and stay valid. Ordering on the wire is
      // `seq` (D2) and is unaffected.
      _lastMillis = millis;
      for (int i = 0; i < _randomLength; i++) {
        _lastRandom[i] = _random.nextInt(32);
      }
    }

    return _encodeTime(millis) + _encodeRandom();
  }

  /// Adds one to `_lastRandom`, read as a big-endian base-32 integer.
  void _incrementLastRandom() {
    for (int i = _randomLength - 1; i >= 0; i--) {
      if (_lastRandom[i] < 31) {
        _lastRandom[i]++;
        return;
      }
      _lastRandom[i] = 0;
    }
    throw StateError(
      'ULID random component overflowed within a single millisecond',
    );
  }

  String _encodeRandom() {
    final StringBuffer out = StringBuffer();
    for (int i = 0; i < _randomLength; i++) {
      out.write(_encoding[_lastRandom[i]]);
    }
    return out.toString();
  }
}

/// Encodes epoch-millis as 10 Crockford base32 characters, most significant
/// first (which is what makes ULIDs sort by time as plain strings).
///
/// Uses division and modulo rather than bit shifts on purpose. Dart's `>>` and
/// `&` are 32-bit when compiled to JavaScript, and a 48-bit millisecond
/// timestamp does not fit in 32 bits — a shift-based encoder is correct on
/// Android and iOS and silently wrong on Flutter Web. Division is correct on
/// all three.
String _encodeTime(int millis) {
  int remaining = millis;
  final List<String> chars = List<String>.filled(_timeLength, '0');
  for (int i = _timeLength - 1; i >= 0; i--) {
    final int mod = remaining % 32;
    chars[i] = _encoding[mod];
    remaining = (remaining - mod) ~/ 32;
  }
  return chars.join();
}
