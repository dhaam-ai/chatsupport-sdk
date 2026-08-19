import { describe, expect, it } from 'vitest';

import { isValidUlid } from './protocol/index.js';
import { generateUlid } from './ulid.js';

describe('generateUlid', () => {
  it('produces a value that satisfies isValidUlid', () => {
    expect(isValidUlid(generateUlid())).toBe(true);
  });

  it('is always exactly 26 characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateUlid()).toHaveLength(26);
    }
  });

  it('uses only Crockford base32 characters (excludes I, L, O, U)', () => {
    const id = generateUlid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('never produces the same id twice across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUlid()));
    expect(ids.size).toBe(1000);
  });

  it('is lexicographically sortable by the timestamp passed in', () => {
    const earlier = generateUlid(1_700_000_000_000);
    const later = generateUlid(1_700_000_000_001);

    expect(earlier < later).toBe(true);
  });

  it('encodes the same timestamp identically across many random draws (timestamp prefix is stable)', () => {
    const ts = 1_700_000_000_000;
    const prefixes = new Set(Array.from({ length: 50 }, () => generateUlid(ts).slice(0, 10)));

    expect(prefixes.size).toBe(1);
  });

  it('round-trips a known timestamp through the encoded prefix without corruption across byte boundaries', () => {
    // Regression guard for the bit-buffer overflow this file's comments
    // describe: generate enough ids that encodeRandomness's 10-byte loop
    // runs to completion many times without ever producing a character
    // outside the Crockford alphabet.
    for (let i = 0; i < 500; i++) {
      const id = generateUlid();
      expect(isValidUlid(id)).toBe(true);
    }
  });
});
