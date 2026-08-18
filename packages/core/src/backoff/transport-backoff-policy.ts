import type { BackoffConfig } from './full-jitter';
import { fullJitterDelay } from './full-jitter';

/**
 * Reconnect backoff for transport-level failures (dropped socket, network
 * blip, server restart) — PRD §8.2.
 *
 * A dropped WiFi connection is not a reason to stop trying: this policy
 * retries **indefinitely**. It never signals termination or a "give up"
 * outcome, and deliberately exposes only a delay computation — no attempt
 * ceiling, no suspend path. That is the point: v1's 5-attempt cap (§12.11)
 * was a bug, not a feature, and this type makes it structurally impossible
 * to reintroduce one by accident.
 *
 * The scheduling of the actual retry (the `setTimeout`) belongs to the
 * connection state machine (task T8), not here — this only computes delays.
 */
export class TransportBackoffPolicy {
  private readonly config: BackoffConfig;

  constructor(config: BackoffConfig = {}) {
    this.config = config;
  }

  /** Delay (ms) before the given 0-based reconnect attempt. Always defined; never "stop". */
  nextDelay(attempt: number): number {
    return fullJitterDelay(attempt, this.config);
  }
}
