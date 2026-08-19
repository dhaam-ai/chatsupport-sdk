import 'dart:math';

import 'package:dhaam_chat/src/connection/backoff.dart';
import 'package:test/test.dart';

/// A Random that always returns the maximum draw, so nextDelay lands exactly
/// on the ceiling and the two can be compared.
class _MaxRandom implements Random {
  @override
  int nextInt(int max) => max - 1;
  @override
  double nextDouble() => 1.0;
  @override
  bool nextBool() => true;
}

/// A Random that always draws zero — the case that turns an overflowed
/// ceiling into NaN.
class _ZeroRandom implements Random {
  @override
  int nextInt(int max) => 0;
  @override
  double nextDouble() => 0.0;
  @override
  bool nextBool() => false;
}

void main() {
  group('ceilingFor', () {
    test('doubles from base', () {
      final Backoff backoff = Backoff();
      expect(backoff.ceilingFor(0).inMilliseconds, equals(500));
      expect(backoff.ceilingFor(1).inMilliseconds, equals(1000));
      expect(backoff.ceilingFor(2).inMilliseconds, equals(2000));
      expect(backoff.ceilingFor(3).inMilliseconds, equals(4000));
    });

    test('saturates at the cap instead of overflowing', () {
      final Backoff backoff = Backoff();
      for (final int attempt in <int>[6, 7, 20, 100, 10000, 1 << 30]) {
        expect(
          backoff.ceilingFor(attempt).inMilliseconds,
          equals(30000),
          reason: 'attempt $attempt must saturate, not overflow',
        );
      }
    });

    test('stays finite and positive at absurd attempt counts', () {
      // Transport failures retry INDEFINITELY (§8.2), so a phone in a tunnel
      // genuinely reaches these. `base * pow(2, attempt)` is Infinity here,
      // and on Flutter Web every Dart number is a double.
      final Backoff backoff = Backoff();
      for (final int attempt in <int>[64, 1023, 100000]) {
        final Duration ceiling = backoff.ceilingFor(attempt);
        expect(ceiling.inMilliseconds, greaterThan(0));
        expect(ceiling.inMilliseconds, lessThanOrEqualTo(30000));
      }
    });

    test('a zero jitter draw at a huge attempt yields zero, never NaN', () {
      // The exact failure this design exists to prevent: Infinity * 0 is NaN,
      // NaN.toInt() throws, and reconnect is dead for the life of the process.
      final Backoff backoff = Backoff(random: _ZeroRandom());
      expect(backoff.nextDelay(100000), equals(Duration.zero));
    });
  });

  group('nextDelay', () {
    test('never exceeds the ceiling for its attempt', () {
      final Backoff backoff = Backoff(random: Random(1));
      for (int attempt = 0; attempt < 40; attempt++) {
        final Duration ceiling = backoff.ceilingFor(attempt);
        for (int i = 0; i < 25; i++) {
          final Duration delay = backoff.nextDelay(attempt);
          expect(delay.inMilliseconds, greaterThanOrEqualTo(0));
          expect(
            delay.inMilliseconds,
            lessThanOrEqualTo(ceiling.inMilliseconds),
          );
        }
      }
    });

    test('reaches the ceiling on a maximum draw', () {
      final Backoff backoff = Backoff(random: _MaxRandom());
      expect(backoff.nextDelay(2).inMilliseconds, equals(2000));
    });

    test('can draw zero — full jitter, not a floor', () {
      final Backoff backoff = Backoff(random: _ZeroRandom());
      expect(backoff.nextDelay(5), equals(Duration.zero));
    });

    test('spreads a fleet across the window rather than synchronising it', () {
      // The reason jitter exists: an unjittered backoff reconnects every
      // client that was on a restarted server at the same instant, repeatedly,
      // at each doubling.
      final Backoff backoff = Backoff(random: Random(7));
      final Set<int> delays = <int>{
        for (int i = 0; i < 200; i++) backoff.nextDelay(6).inMilliseconds,
      };
      expect(delays.length, greaterThan(100));
    });
  });

  group('policy', () {
    test('honours a custom base and cap', () {
      final Backoff backoff = Backoff(
        policy: const BackoffPolicy(
          base: Duration(milliseconds: 100),
          cap: Duration(seconds: 1),
        ),
        random: _MaxRandom(),
      );
      expect(backoff.ceilingFor(0).inMilliseconds, equals(100));
      expect(backoff.ceilingFor(3).inMilliseconds, equals(800));
      expect(backoff.ceilingFor(9).inMilliseconds, equals(1000));
    });

    test('handles a base larger than the cap without looping', () {
      final Backoff backoff = Backoff(
        policy: const BackoffPolicy(
          base: Duration(seconds: 60),
          cap: Duration(seconds: 30),
        ),
      );
      expect(backoff.ceilingFor(0).inMilliseconds, equals(30000));
      expect(backoff.ceilingFor(50).inMilliseconds, equals(30000));
    });

    test('defaults match §8.2', () {
      const BackoffPolicy policy = BackoffPolicy();
      expect(policy.base, equals(const Duration(milliseconds: 500)));
      expect(policy.cap, equals(const Duration(seconds: 30)));
      expect(policy.maxAuthAttempts, equals(3));
    });
  });
}
