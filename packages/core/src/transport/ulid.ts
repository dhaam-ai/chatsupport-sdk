// Monotonic ULID generation for client→server envelope `id`.
//
// Hand-rolled because `@dhaam-ccrm/core` has zero runtime dependencies —
// no `ulid` package, no `uuid`, no crypto polyfill.
//
// Why monotonic specifically (rather than plain random ULIDs): a ULID's
// sort order is its timestamp prefix followed by its random suffix. Two
// ULIDs minted in the SAME millisecond have identical prefixes, so their
// relative order is decided by 80 bits of unrelated randomness — it flips
// run to run. Sending three messages in one tick would give three ids
// whose lexical order does not match the order the user typed them. The
// ULID spec's monotonic factory fixes this by reusing the previous random
// suffix incremented by one whenever the clock has not advanced:
//
//   "When generating a ULID within the same millisecond, we can provide
//    some guarantees regarding sort order. Namely, if the same millisecond
//    is detected, the `random` component is incremented by 1 bit in the
//    least significant bit position (with carrying)."
//   — https://github.com/ulid/spec#monotonicity
//
// This matters beyond aesthetics: for `message.send` the envelope `id` IS
// the message's permanent id (D1, PRD §0.5/§9.3), so an unstable order
// here is an unstable order in persisted data.
//
// The server enforces the same 26-char Crockford base32 shape on EVERY
// client frame's `id`, not just `message.send` — see protocol/validate.ts
// `isValidUlid`, which is byte-identical to the server's own pattern.

import type { Clock } from '../presence/time.js';

/**
 * Returns a float in `[0, 1)`, exactly like `Math.random`.
 *
 * Injectable so tests can pin the random suffix and assert monotonic
 * increment without relying on chance.
 */
export type RandomSource = () => number;

/** Mints one ULID per call. */
export type UlidGenerator = () => string;

/** Crockford base32 — the standard alphabet minus I, L, O and U. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;

/** 10 base32 chars of 48-bit millisecond timestamp. */
const TIME_CHARS = 10;

/** 16 base32 chars of 80-bit randomness. */
const RANDOM_CHARS = 16;

/** 2^48 - 1 — the largest timestamp representable in 10 base32 chars. */
const MAX_TIME_MS = 281_474_976_710_655;

/** Largest value a single base32 char can hold. */
const MAX_CHAR_VALUE = ENCODING_LEN - 1;

/**
 * Reads `globalThis.crypto` lazily, per call — never at module scope.
 * Importing this module must not touch any global (PRD §14, and the same
 * SSR-safety rule that governs the `WebSocket` global in socket.ts).
 * Falls back to `Math.random` where WebCrypto is absent.
 */
const defaultRandom: RandomSource = () => {
  const webCrypto = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array };
    }
  ).crypto;

  if (typeof webCrypto?.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    webCrypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 0x1_0000_0000;
  }

  return Math.random();
};

/** Encodes epoch millis as `TIME_CHARS` base32 chars, most significant first. */
function encodeTime(timeMs: number): string {
  let remaining = timeMs;
  let out = '';

  for (let i = 0; i < TIME_CHARS; i += 1) {
    const digit = remaining % ENCODING_LEN;
    // `charAt` rather than `[]` — under `noUncheckedIndexedAccess` an index
    // access is `string | undefined`, and `digit` is provably in range.
    out = ENCODING.charAt(digit) + out;
    remaining = (remaining - digit) / ENCODING_LEN;
  }

  return out;
}

/** Draws a fresh 80-bit random suffix as `RANDOM_CHARS` 5-bit digits. */
function drawRandom(random: RandomSource): number[] {
  const digits: number[] = [];

  for (let i = 0; i < RANDOM_CHARS; i += 1) {
    // `Math.floor` of a `[0, 1)` float scaled by 32 lands in `[0, 31]`.
    // `Math.min` guards a `RandomSource` that returns exactly 1.
    digits.push(Math.min(Math.floor(random() * ENCODING_LEN), MAX_CHAR_VALUE));
  }

  return digits;
}

/**
 * Adds one to the 80-bit suffix in place, with carry.
 *
 * Returns `false` on overflow — every one of the 16 digits was already at
 * its maximum, i.e. 2^80 ULIDs were minted inside a single millisecond.
 */
function incrementRandom(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const digit = digits[i] ?? 0;

    if (digit < MAX_CHAR_VALUE) {
      digits[i] = digit + 1;
      return true;
    }

    digits[i] = 0;
  }

  return false;
}

function encodeRandom(digits: number[]): string {
  let out = '';
  for (const digit of digits) out += ENCODING.charAt(digit);
  return out;
}

export interface UlidGeneratorOptions {
  /** Defaults to `Date.now`. */
  now?: Clock;

  /** Defaults to WebCrypto when present, `Math.random` otherwise. */
  random?: RandomSource;
}

/**
 * Builds a monotonic ULID generator.
 *
 * Guarantees, in order of importance:
 *
 * 1. Every returned string matches protocol/validate.ts's `isValidUlid`
 *    (26 chars, Crockford base32, uppercase) — the same check the server
 *    applies to every inbound client frame.
 * 2. Successive calls are strictly increasing lexically, including within
 *    one millisecond and across a clock that jumps *backwards* (NTP
 *    correction, VM resume). A backwards jump reuses the last timestamp
 *    rather than emitting an id that sorts before its predecessor.
 *
 * @throws RangeError if the clock reads negative, non-finite, or beyond
 *   2^48-1 ms — an id built from such a clock could not round-trip.
 * @throws RangeError on 80-bit suffix overflow inside one millisecond
 *   (unreachable in practice; ~1.2e24 ids per ms would be required). The
 *   ULID spec mandates an error here rather than silently wrapping, which
 *   would break guarantee 2.
 */
export function createUlidGenerator(options: UlidGeneratorOptions = {}): UlidGenerator {
  const { now, random = defaultRandom } = options;
  const clock: Clock = now ?? ((): number => Date.now());

  let lastTimeMs = -1;
  let lastRandom: number[] = [];

  return function nextUlid(): string {
    const rawNow = clock();

    if (!Number.isFinite(rawNow) || rawNow < 0 || rawNow > MAX_TIME_MS) {
      throw new RangeError(`ULID timestamp out of range: ${String(rawNow)}`);
    }

    const timeMs = Math.floor(rawNow);

    // `<=`, not `===`: a backwards clock must not be allowed to emit an id
    // that sorts before the previous one. Pinning to `lastTimeMs` and
    // incrementing keeps the sequence strictly increasing either way.
    if (timeMs <= lastTimeMs) {
      if (!incrementRandom(lastRandom)) {
        throw new RangeError('ULID random component overflowed within a single millisecond');
      }
    } else {
      lastTimeMs = timeMs;
      lastRandom = drawRandom(random);
    }

    return encodeTime(lastTimeMs) + encodeRandom(lastRandom);
  };
}
