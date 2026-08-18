import { describe, expect, it } from 'vitest';
import { AuthBackoffPolicy, DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES } from './auth-backoff-policy';

describe('AuthBackoffPolicy — defaults', () => {
  it('defaults to escalating after 3 consecutive failures (PRD §10.6)', () => {
    expect(DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES).toBe(3);
  });
});

describe('AuthBackoffPolicy — escalation on exactly the Nth consecutive failure', () => {
  it('retries the first two consecutive failures, suspends on exactly the 3rd', () => {
    const policy = new AuthBackoffPolicy({ random: () => 0 });

    const first = policy.recordFailure();
    expect(first).toEqual({ action: 'retry', attempt: 0, delayMs: 0 });
    expect(policy.consecutiveFailures).toBe(1);

    const second = policy.recordFailure();
    expect(second).toEqual({ action: 'retry', attempt: 1, delayMs: 0 });
    expect(policy.consecutiveFailures).toBe(2);

    const third = policy.recordFailure();
    expect(third).toEqual({ action: 'suspend', attempts: 3 });
    expect(policy.consecutiveFailures).toBe(3);
  });

  it('computes retry delays via the same full-jitter formula, honoring configured base/cap', () => {
    const policy = new AuthBackoffPolicy({
      base: 100,
      cap: 5000,
      random: () => 1,
      maxConsecutiveFailures: 5,
    });
    const first = policy.recordFailure();
    expect(first).toEqual({ action: 'retry', attempt: 0, delayMs: 100 });

    const second = policy.recordFailure();
    expect(second).toEqual({ action: 'retry', attempt: 1, delayMs: 200 });
  });
});

describe('AuthBackoffPolicy — a success in between resets the counter', () => {
  it('resets consecutiveFailures to 0 on recordSuccess', () => {
    const policy = new AuthBackoffPolicy({ random: () => 0 });
    policy.recordFailure();
    policy.recordFailure();
    expect(policy.consecutiveFailures).toBe(2);

    policy.recordSuccess();
    expect(policy.consecutiveFailures).toBe(0);
  });

  it('a reset means a fresh run of 3 consecutive failures is required to suspend again', () => {
    const policy = new AuthBackoffPolicy({ random: () => 0 });

    policy.recordFailure(); // 1
    policy.recordFailure(); // 2
    policy.recordSuccess(); // reset — would have suspended on the next call otherwise

    const afterReset1 = policy.recordFailure();
    expect(afterReset1).toEqual({ action: 'retry', attempt: 0, delayMs: 0 });

    const afterReset2 = policy.recordFailure();
    expect(afterReset2).toEqual({ action: 'retry', attempt: 1, delayMs: 0 });

    const afterReset3 = policy.recordFailure();
    expect(afterReset3).toEqual({ action: 'suspend', attempts: 3 });
  });

  it('recordSuccess is a no-op when the counter is already 0', () => {
    const policy = new AuthBackoffPolicy();
    policy.recordSuccess();
    expect(policy.consecutiveFailures).toBe(0);
  });
});

describe('AuthBackoffPolicy — custom maxConsecutiveFailures', () => {
  it('honors a lower threshold', () => {
    const policy = new AuthBackoffPolicy({ maxConsecutiveFailures: 1, random: () => 0 });
    const outcome = policy.recordFailure();
    expect(outcome).toEqual({ action: 'suspend', attempts: 1 });
  });

  it('honors a higher threshold', () => {
    const policy = new AuthBackoffPolicy({ maxConsecutiveFailures: 5, random: () => 0 });
    for (let i = 0; i < 4; i += 1) {
      expect(policy.recordFailure().action).toBe('retry');
    }
    expect(policy.recordFailure()).toEqual({ action: 'suspend', attempts: 5 });
  });

  it('keeps signaling suspend if recordFailure is called again after suspension', () => {
    const policy = new AuthBackoffPolicy({ maxConsecutiveFailures: 1, random: () => 0 });
    expect(policy.recordFailure()).toEqual({ action: 'suspend', attempts: 1 });
    expect(policy.recordFailure()).toEqual({ action: 'suspend', attempts: 2 });
  });
});

describe('AuthBackoffPolicy — input validation', () => {
  it('rejects a non-positive maxConsecutiveFailures', () => {
    expect(() => new AuthBackoffPolicy({ maxConsecutiveFailures: 0 })).toThrow(RangeError);
    expect(() => new AuthBackoffPolicy({ maxConsecutiveFailures: -1 })).toThrow(RangeError);
  });

  it('rejects a non-integer maxConsecutiveFailures', () => {
    expect(() => new AuthBackoffPolicy({ maxConsecutiveFailures: 1.5 })).toThrow(RangeError);
  });
});
