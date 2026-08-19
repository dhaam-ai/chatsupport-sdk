/// Reconnect backoff — PRD §8.2.
///
/// ```
/// delay = random(0, min(cap, base * 2^attempt))
/// ```
///
/// Full jitter, not v1's fixed 1000ms with a 5-attempt cap (§12.11). The
/// jitter is the load-bearing part: when a server restarts, every client that
/// was connected to it wakes at the same instant, and an unjittered backoff
/// reconnects them all simultaneously — repeatedly, at each doubling — which
/// is how a recovering server gets knocked back down.
library;

import 'dart:math';

/// Backoff tuning (§8.2).
class BackoffPolicy {
  const BackoffPolicy({
    this.base = const Duration(milliseconds: 500),
    this.cap = const Duration(seconds: 30),
    this.maxAuthAttempts = 3,
  });

  /// First doubling step. §8.2's default, tunable.
  final Duration base;

  /// Ceiling on the exponential term. §8.2's default.
  final Duration cap;

  /// Consecutive AUTH failures before escalating to suspended (§8.2, §10.6).
  ///
  /// Applies ONLY to auth failures. Transport failures retry indefinitely —
  /// "a dropped WiFi connection is not a reason to give up" — and on a phone
  /// that is not an edge case: a tunnel, a lift, or a backgrounded app is a
  /// transport failure several times a day. A client that gave up after N
  /// network blips would be dead by lunchtime.
  final int maxAuthAttempts;
}

/// Computes reconnect delays.
class Backoff {
  Backoff({this.policy = const BackoffPolicy(), Random? random})
      : _random = random ?? Random();

  final BackoffPolicy policy;
  final Random _random;

  /// The exponential ceiling for [attempt], saturated at [BackoffPolicy.cap].
  ///
  /// ── Why this is a doubling loop and not `base * pow(2, attempt)` ─────────
  ///
  /// This is a real bug class, not a hypothetical. Transport failures retry
  /// INDEFINITELY (§8.2), so `attempt` is unbounded — a phone left in a tunnel
  /// reaches attempt 200 without anything being wrong. `pow(2, 200)` is
  /// `Infinity` as a double, and on Flutter Web every Dart number IS a double,
  /// so this overflows on one of the three platforms this package targets.
  ///
  /// `Infinity` then meets full jitter, whose whole point is that it can draw
  /// ZERO. `Infinity * 0` is `NaN`; `NaN.toInt()` throws, and a caller that
  /// instead clamped it would schedule a timer that never fires. Either way
  /// reconnect is dead for the life of the process, and the failure appears
  /// only after a device has been offline long enough to reach a high attempt
  /// count — which is to say, in the field and never in a test.
  ///
  /// The loop below returns as soon as it reaches the cap, so it performs at
  /// most log2(cap/base) iterations — six, at the §8.2 defaults — and the
  /// running value never exceeds twice the cap. There is no value of [attempt]
  /// that can overflow it.
  Duration ceilingFor(int attempt) {
    final int capMillis = policy.cap.inMilliseconds;
    final int baseMillis = policy.base.inMilliseconds;

    if (attempt <= 0 || baseMillis >= capMillis) {
      return Duration(milliseconds: baseMillis.clamp(0, capMillis));
    }

    int ceiling = baseMillis;
    // The iteration guard is belt-and-braces: the `>= capMillis` return below
    // already bounds this at log2(cap/base). It matters only if someone
    // configures a cap so large that the doubling would run for a long time
    // before reaching it.
    final int steps = attempt < 64 ? attempt : 64;
    for (int i = 0; i < steps; i++) {
      if (ceiling >= capMillis) return Duration(milliseconds: capMillis);
      ceiling *= 2;
    }
    return Duration(milliseconds: ceiling > capMillis ? capMillis : ceiling);
  }

  /// A full-jitter delay for [attempt] — uniform in `[0, ceilingFor(attempt)]`.
  ///
  /// Zero is a legal and intended outcome. A caller must not treat a zero
  /// delay as "no backoff configured".
  Duration nextDelay(int attempt) {
    final int ceiling = ceilingFor(attempt).inMilliseconds;
    if (ceiling <= 0) return Duration.zero;
    return Duration(milliseconds: _random.nextInt(ceiling + 1));
  }
}
