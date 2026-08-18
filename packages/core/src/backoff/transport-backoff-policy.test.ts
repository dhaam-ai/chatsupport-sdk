import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_MS, DEFAULT_CAP_MS } from './full-jitter';
import { TransportBackoffPolicy } from './transport-backoff-policy';

describe('TransportBackoffPolicy', () => {
  it('computes the full-jitter formula using the default base/cap', () => {
    const policy = new TransportBackoffPolicy({ random: () => 1 });
    expect(policy.nextDelay(0)).toBe(DEFAULT_BASE_MS);
    expect(policy.nextDelay(1)).toBe(DEFAULT_BASE_MS * 2);
    expect(policy.nextDelay(10)).toBe(DEFAULT_CAP_MS); // 500*2^10 saturates well past cap
  });

  it('yields 0 at the rng=0 boundary for any attempt', () => {
    const policy = new TransportBackoffPolicy({ random: () => 0 });
    expect(policy.nextDelay(0)).toBe(0);
    expect(policy.nextDelay(1000)).toBe(0);
  });

  it('honors a custom base/cap', () => {
    const policy = new TransportBackoffPolicy({ base: 100, cap: 1000, random: () => 1 });
    expect(policy.nextDelay(0)).toBe(100);
    expect(policy.nextDelay(20)).toBe(1000);
  });

  it('never terminates: stays finite and bounded at arbitrarily high attempt counts', () => {
    const policy = new TransportBackoffPolicy({ random: () => 1 });
    for (const attempt of [0, 1, 2, 20, 50, 1000, 10_000, 1_000_000]) {
      const delay = policy.nextDelay(attempt);
      expect(Number.isNaN(delay)).toBe(false);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(DEFAULT_CAP_MS);
    }
  });

  it('has no notion of a terminal/suspend outcome — nextDelay always returns a plain number', () => {
    const policy = new TransportBackoffPolicy();
    const result = policy.nextDelay(5);
    expect(typeof result).toBe('number');
  });

  it('does not throw or refuse arbitrarily large attempt counts', () => {
    const policy = new TransportBackoffPolicy({ random: () => 0 });
    expect(() => policy.nextDelay(1_000_000)).not.toThrow();
  });
});
