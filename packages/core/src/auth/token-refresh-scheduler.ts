// Proactive token-refresh timing — PRD §10.4: "Core calls [getToken]
// proactively ahead of expiry (default: at 80% of the token's `expiresIn`)."
// Pure scheduling, deliberately independent of the auth coordinator itself
// so it's testable in isolation with fake timers — same shape as
// transport/heartbeat.ts's `HeartbeatScheduler`, one scheduled callback at a
// time, no queueing.

export interface TokenRefreshSchedulerOptions {
  onRefresh: () => void;
}

export class TokenRefreshScheduler {
  readonly #onRefresh: () => void;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TokenRefreshSchedulerOptions) {
    this.#onRefresh = options.onRefresh;
  }

  /** Schedules a refresh `delayMs` from now, replacing any previously scheduled one. Negative delays fire on the next tick, not in the past. */
  scheduleIn(delayMs: number): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#onRefresh();
    }, Math.max(0, delayMs));
  }

  /** Cancels a pending refresh, if any. Safe to call when nothing is scheduled. */
  cancel(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
