import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_MS, DEFAULT_CAP_MS, fullJitterDelay } from './full-jitter';

describe('fullJitterDelay — defaults', () => {
  it('defaults to base=500ms and cap=30000ms per PRD §8.2', () => {
    expect(DEFAULT_BASE_MS).toBe(500);
    expect(DEFAULT_CAP_MS).toBe(30_000);
  });

  it('defaults the random source to Math.random when none is provided', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      expect(fullJitterDelay(0)).toBe(DEFAULT_BASE_MS * 0.25);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('fullJitterDelay — boundary correctness across attempts 0..20', () => {
  const base = DEFAULT_BASE_MS;
  const cap = DEFAULT_CAP_MS;

  for (let attempt = 0; attempt <= 20; attempt += 1) {
    // Safe to compute directly here: 2**20 is nowhere near double overflow.
    const expectedCeiling = Math.min(cap, base * 2 ** attempt);

    it(`attempt ${attempt}: rng=0 yields exactly 0`, () => {
      const delay = fullJitterDelay(attempt, { random: () => 0 });
      expect(delay).toBe(0);
    });

    it(`attempt ${attempt}: rng=1 yields exactly the ceiling (${expectedCeiling}ms)`, () => {
      const delay = fullJitterDelay(attempt, { random: () => 1 });
      expect(delay).toBe(expectedCeiling);
    });

    it(`attempt ${attempt}: rng midpoint stays within [0, ceiling]`, () => {
      const delay = fullJitterDelay(attempt, { random: () => 0.5 });
      expect(delay).toBeCloseTo(expectedCeiling * 0.5, 8);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(expectedCeiling);
    });
  }
});

describe('fullJitterDelay — high attempt counts must not overflow, go negative, or NaN', () => {
  // A naive implementation that lets 2**attempt leak into `random() * ceiling`
  // unguarded produces NaN the instant rng=0 (0 * Infinity === NaN),
  // permanently breaking reconnect. The ceiling must saturate at `cap`
  // instead. Included per spec: attempt 50 and 1000.
  it.each([50, 1000])('attempt %i: ceiling saturates at cap, no NaN/Infinity/negative', (attempt) => {
    const atZero = fullJitterDelay(attempt, { random: () => 0 });
    const atOne = fullJitterDelay(attempt, { random: () => 1 });

    expect(Number.isNaN(atZero)).toBe(false);
    expect(Number.isNaN(atOne)).toBe(false);
    expect(Number.isFinite(atZero)).toBe(true);
    expect(Number.isFinite(atOne)).toBe(true);

    expect(atZero).toBe(0);
    expect(atOne).toBe(DEFAULT_CAP_MS);

    expect(atZero).toBeGreaterThanOrEqual(0);
    expect(atOne).toBeGreaterThanOrEqual(0);
  });

  // With base=500, `base * 2**attempt` itself only reaches actual IEEE-754
  // Infinity around attempt ~1016 (2**1024 is the first power of two that
  // overflows a double). Math.min(cap, Infinity) alone would still happen to
  // rescue a naive implementation here — but an implementation that applies
  // jitter *before* capping (`Math.min(cap, random() * base * 2**attempt)`,
  // an easy transcription slip from the spec's `random(0, min(cap, ...))`)
  // computes `0 * Infinity === NaN` *before* the min ever runs, and
  // `Math.min(cap, NaN)` is NaN. These attempts are deliberately chosen past
  // that real overflow boundary to make such an ordering bug unmistakable.
  it.each([1024, 2000])(
    'attempt %i: genuinely past the double-precision overflow boundary, still saturates cleanly',
    (attempt) => {
      expect(Number.isFinite(2 ** attempt)).toBe(false); // sanity: 2**attempt really is Infinity here

      const atZero = fullJitterDelay(attempt, { random: () => 0 });
      const atOne = fullJitterDelay(attempt, { random: () => 1 });

      expect(atZero).toBe(0);
      expect(atOne).toBe(DEFAULT_CAP_MS);
      expect(Number.isNaN(atZero)).toBe(false);
      expect(Number.isNaN(atOne)).toBe(false);
    },
  );
});

describe('fullJitterDelay — custom base/cap are honored', () => {
  it('scales the ceiling using a custom base and cap instead of the defaults', () => {
    const config = { base: 100, cap: 2000 };
    expect(fullJitterDelay(0, { ...config, random: () => 1 })).toBe(100);
    expect(fullJitterDelay(3, { ...config, random: () => 1 })).toBe(800); // 100 * 2^3 = 800 < 2000
    expect(fullJitterDelay(10, { ...config, random: () => 1 })).toBe(2000); // saturates
    expect(fullJitterDelay(10, { ...config, random: () => 0 })).toBe(0);
  });

  it('a custom cap smaller than base saturates immediately at attempt 0', () => {
    const delay = fullJitterDelay(0, { base: 5000, cap: 1000, random: () => 1 });
    expect(delay).toBe(1000);
  });
});

describe('fullJitterDelay — input validation', () => {
  it('rejects a negative attempt', () => {
    expect(() => fullJitterDelay(-1)).toThrow(RangeError);
  });

  it('rejects a non-integer attempt', () => {
    expect(() => fullJitterDelay(1.5)).toThrow(RangeError);
  });

  it('rejects a non-positive base', () => {
    expect(() => fullJitterDelay(0, { base: 0 })).toThrow(RangeError);
    expect(() => fullJitterDelay(0, { base: -10 })).toThrow(RangeError);
  });

  it('rejects a non-finite base', () => {
    expect(() => fullJitterDelay(0, { base: Infinity })).toThrow(RangeError);
    expect(() => fullJitterDelay(0, { base: NaN })).toThrow(RangeError);
  });

  it('rejects a non-positive cap', () => {
    expect(() => fullJitterDelay(0, { cap: 0 })).toThrow(RangeError);
    expect(() => fullJitterDelay(0, { cap: -1 })).toThrow(RangeError);
  });

  it('rejects a non-finite cap', () => {
    expect(() => fullJitterDelay(0, { cap: Infinity })).toThrow(RangeError);
  });
});
