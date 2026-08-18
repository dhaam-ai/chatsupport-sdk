// Full-jitter exponential backoff — PRD §8.2.
//
//   delay = random(0, min(cap, base * 2^attempt))
//
// This module is the single source of truth for the delay formula. It is
// deliberately pure: no timers, no I/O, no `Math.random()` call baked in —
// the random source is injectable so the formula is deterministically
// testable at its boundaries (rng=0, rng=1) instead of only statistically.
//
// `TransportBackoffPolicy` and `AuthBackoffPolicy` (siblings in this
// directory) both build on this formula but diverge on when/whether they
// ever stop retrying — that divergence is deliberately modeled outside this
// file. See PRD §8.2 and §10.6.

/** A source of randomness in the half-open range [0, 1), matching `Math.random()`. */
export type RandomSource = () => number;

export interface BackoffConfig {
  /** Base delay in ms before exponential growth. Default 500 (PRD §8.2). */
  readonly base?: number;
  /** Maximum delay ceiling in ms. Default 30_000 (PRD §8.2). */
  readonly cap?: number;
  /** Injectable randomness for full jitter. Defaults to `Math.random`. */
  readonly random?: RandomSource;
}

export const DEFAULT_BASE_MS = 500;
export const DEFAULT_CAP_MS = 30_000;

/**
 * Compute the full-jitter delay (ms) for the given 0-based reconnect attempt.
 *
 * The exponential ceiling (`base * 2^attempt`) is never materialized as a raw
 * `Math.pow` for large `attempt` — doing so eventually overflows to
 * `Infinity`, and `random() === 0` at that point would compute `0 * Infinity
 * === NaN`, permanently breaking reconnect. Instead this finds the attempt at
 * which the exponential term would already reach `cap` (via `log2`) and
 * short-circuits to `cap` from that point on, so the ceiling is always a
 * finite, non-negative number regardless of how large `attempt` gets.
 */
export function fullJitterDelay(attempt: number, config: BackoffConfig = {}): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`attempt must be a non-negative integer, got ${String(attempt)}`);
  }

  const base = config.base ?? DEFAULT_BASE_MS;
  const cap = config.cap ?? DEFAULT_CAP_MS;
  const random = config.random ?? Math.random;

  if (!Number.isFinite(base) || base <= 0) {
    throw new RangeError(`base must be a finite number greater than 0, got ${String(base)}`);
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new RangeError(`cap must be a finite number greater than 0, got ${String(cap)}`);
  }

  const ceiling = backoffCeiling(attempt, base, cap);
  return random() * ceiling;
}

/**
 * `min(cap, base * 2^attempt)`, computed without ever forming an overflowed
 * intermediate value. Callers are expected to have already validated that
 * `base` and `cap` are finite and positive.
 */
function backoffCeiling(attempt: number, base: number, cap: number): number {
  // The attempt (possibly fractional) at which base * 2^attempt first
  // reaches cap. Once the actual (integer) attempt is at or past this point,
  // the ceiling is cap — full stop, no need to ever compute 2**attempt.
  const attemptAtCap = Math.log2(cap / base);
  if (attempt >= attemptAtCap) {
    return cap;
  }
  return base * 2 ** attempt;
}
