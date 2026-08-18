import { describe, expect, it, vi } from 'vitest';

import { isValidUlid } from '../protocol/validate.js';
import { createUlidGenerator } from './ulid.js';
import type { RandomSource } from './ulid.js';

/** A `RandomSource` that walks a fixed script, then repeats its last value. */
function scriptedRandom(values: number[]): RandomSource {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

/** Every random digit lands on 0 — a suffix of sixteen '0' chars. */
const allZero: RandomSource = () => 0;

/** Every random digit lands on 31 ('Z') — the overflow boundary. */
const allMax: RandomSource = () => 0.999_999;

describe('createUlidGenerator', () => {
  it('produces ids the protocol validator accepts', () => {
    const next = createUlidGenerator({ now: () => 1_700_000_000_000 });

    for (let i = 0; i < 50; i += 1) {
      expect(isValidUlid(next())).toBe(true);
    }
  });

  it('produces ids that are exactly 26 Crockford base32 chars', () => {
    const next = createUlidGenerator({ now: () => 1_700_000_000_000 });
    const id = next();

    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Crockford excludes I, L, O and U — a generator that used the plain
    // base32 alphabet would pass a length check but fail the server.
    expect(id).not.toMatch(/[ILOU]/);
  });

  it('encodes the timestamp in the first 10 chars, most significant first', () => {
    const atZero = createUlidGenerator({ now: () => 0, random: allZero })();
    expect(atZero).toBe('0'.repeat(26));

    // 32ms == one carry into the second-least-significant time digit.
    const at32 = createUlidGenerator({ now: () => 32, random: allZero })();
    expect(at32.slice(0, 10)).toBe('0000000010');
  });

  it('sorts lexically in timestamp order', () => {
    let clock = 1_700_000_000_000;
    const next = createUlidGenerator({ now: () => clock, random: allZero });

    const first = next();
    clock += 1;
    const second = next();
    clock += 1_000;
    const third = next();

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  // The headline guarantee: ids minted in one tick must still sort in
  // mint order. Random suffixes alone would order these by chance.
  it('is monotonic within a single millisecond', () => {
    const next = createUlidGenerator({ now: () => 1_700_000_000_000, random: allZero });

    const ids = Array.from({ length: 100 }, () => next());

    expect(new Set(ids).size).toBe(100);
    expect([...ids].sort()).toEqual(ids);
  });

  it('increments the random suffix by exactly one per same-millisecond call', () => {
    const next = createUlidGenerator({ now: () => 0, random: allZero });

    expect(next()).toBe(`${'0'.repeat(10)}${'0'.repeat(16)}`);
    expect(next()).toBe(`${'0'.repeat(10)}${'0'.repeat(15)}1`);
    expect(next()).toBe(`${'0'.repeat(10)}${'0'.repeat(15)}2`);
  });

  it('carries across digit boundaries when incrementing', () => {
    // Suffix starts at 0…0Z ("Z" == 31). One increment must carry into the
    // next digit rather than wrapping in place.
    const next = createUlidGenerator({
      now: () => 0,
      random: scriptedRandom([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.999_999]),
    });

    expect(next().slice(10)).toBe(`${'0'.repeat(15)}Z`);
    expect(next().slice(10)).toBe(`${'0'.repeat(14)}10`);
  });

  it('draws a fresh random suffix when the clock advances', () => {
    let clock = 0;
    const random = vi.fn(() => 0);
    const next = createUlidGenerator({ now: () => clock, random });

    next();
    expect(random).toHaveBeenCalledTimes(16);

    next(); // same ms — increments, must not redraw
    expect(random).toHaveBeenCalledTimes(16);

    clock = 1;
    next(); // new ms — redraws all 16 digits
    expect(random).toHaveBeenCalledTimes(32);
  });

  // NTP correction / VM resume. Falling back to the earlier timestamp would
  // emit an id sorting *before* its predecessor and, for `message.send`,
  // reorder persisted messages.
  it('stays monotonic when the clock jumps backwards', () => {
    let clock = 1_700_000_000_000;
    const next = createUlidGenerator({ now: () => clock, random: allZero });

    const before = next();
    clock -= 5_000;
    const after = next();

    expect(after > before).toBe(true);
    expect(after.slice(0, 10)).toBe(before.slice(0, 10));
  });

  it('keeps separate generators independent', () => {
    const options = { now: () => 1_700_000_000_000, random: allZero };
    const a = createUlidGenerator(options);
    const b = createUlidGenerator(options);

    expect(a()).toBe(b());
  });

  it('throws rather than wrapping when the random suffix overflows', () => {
    const next = createUlidGenerator({ now: () => 0, random: allMax });

    expect(next().slice(10)).toBe('Z'.repeat(16));
    expect(() => next()).toThrow(RangeError);
  });

  it('rejects clock values that cannot round-trip', () => {
    expect(() => createUlidGenerator({ now: () => -1 })()).toThrow(RangeError);
    expect(() => createUlidGenerator({ now: () => Number.NaN })()).toThrow(RangeError);
    expect(() => createUlidGenerator({ now: () => Number.POSITIVE_INFINITY })()).toThrow(RangeError);
    expect(() => createUlidGenerator({ now: () => 281_474_976_710_656 })()).toThrow(RangeError);
  });

  it('accepts the maximum representable timestamp', () => {
    const id = createUlidGenerator({ now: () => 281_474_976_710_655, random: allZero })();

    expect(isValidUlid(id)).toBe(true);
    // Ten base32 chars hold 50 bits, but the ULID spec fixes the timestamp
    // at 48 — so the ceiling encodes with a leading 7, not a leading Z.
    expect(id.slice(0, 10)).toBe('7ZZZZZZZZZ');
  });

  it('truncates fractional clock readings', () => {
    const next = createUlidGenerator({ now: () => 1.9, random: allZero });
    const first = next();

    expect(first.slice(0, 10)).toBe('0000000001');
    // 1.9 floors to the same ms, so the next call must increment.
    expect(next().slice(0, 10)).toBe('0000000001');
  });

  it('does not read any global at import or construction time', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    // @ts-expect-error — deliberately removing an optional platform global.
    delete globalThis.crypto;

    try {
      const next = createUlidGenerator({ now: () => 0, random: allZero });
      expect(isValidUlid(next())).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });
});
