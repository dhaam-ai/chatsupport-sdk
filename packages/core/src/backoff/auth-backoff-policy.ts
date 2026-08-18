import type { BackoffConfig } from './full-jitter';
import { fullJitterDelay } from './full-jitter';

export interface AuthBackoffConfig extends BackoffConfig {
  /** Consecutive auth failures before escalating to suspend. Default 3 (PRD §10.6). */
  readonly maxConsecutiveFailures?: number;
}

export const DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES = 3;

export type AuthBackoffOutcome =
  | { readonly action: 'retry'; readonly attempt: number; readonly delayMs: number }
  | { readonly action: 'suspend'; readonly attempts: number };

/**
 * Reconnect backoff for auth-level failures (`getToken()` throws/rejects, or
 * the server returns `AUTH_INVALID`/`AUTH_EXPIRED` after a freshly-fetched
 * token) — PRD §8.2, §10.6.
 *
 * Unlike {@link TransportBackoffPolicy}, this policy *does* terminate:
 * backoff cannot fix broken credentials, so retrying against them just burns
 * the backoff budget on something the delay formula was never meant to
 * solve. After a small bounded number of consecutive failures (default 3)
 * it escalates to `suspend` — the caller (the connection state machine, task
 * T8) is expected to transition to `suspended` and stop calling this policy
 * until an explicit `client.connect()` creates a fresh attempt.
 *
 * This is intentionally a separate stateful type rather than a shared
 * retry counter with {@link TransportBackoffPolicy}: the two policies
 * terminate differently, and collapsing them into one counter would make
 * that difference implicit and easy to regress.
 */
export class AuthBackoffPolicy {
  private readonly backoffConfig: BackoffConfig;
  private readonly maxConsecutiveFailures: number;
  private failures = 0;

  constructor(config: AuthBackoffConfig = {}) {
    const { maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES, ...backoffConfig } = config;

    if (!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1) {
      throw new RangeError(
        `maxConsecutiveFailures must be a positive integer, got ${String(maxConsecutiveFailures)}`,
      );
    }

    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.backoffConfig = backoffConfig;
  }

  /** Current consecutive-failure count (0 after construction or a `recordSuccess()`). */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /**
   * Record one auth-level failure. Returns a retry delay unless this is the
   * Nth consecutive failure (default 3), in which case it signals suspend.
   * Calling this again after suspend keeps returning suspend — it does not
   * self-reset; only {@link recordSuccess} or a fresh instance does.
   */
  recordFailure(): AuthBackoffOutcome {
    this.failures += 1;

    if (this.failures >= this.maxConsecutiveFailures) {
      return { action: 'suspend', attempts: this.failures };
    }

    const attempt = this.failures - 1;
    return { action: 'retry', attempt, delayMs: fullJitterDelay(attempt, this.backoffConfig) };
  }

  /** Record a successful auth/connect, resetting the consecutive-failure count to 0. */
  recordSuccess(): void {
    this.failures = 0;
  }
}
