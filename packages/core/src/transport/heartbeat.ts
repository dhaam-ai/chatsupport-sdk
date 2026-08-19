// Heartbeat scheduling — PRD §7.3's `system.heartbeat` / `system.pong` pair,
// §12.11 (v1 sent a heartbeat every 25s with no documented server pong at
// all — this is the fix). Pure scheduling logic, deliberately independent of
// `Transport`/WebSocket so it's testable with fake timers in isolation.
//
// Judgment call: the PRD confirms v1's 25-second interval as a "confirmed
// gap" motivating better RECONNECT policy (§8.2), not as a locked v2
// interval value — no §7/§8 section pins an exact v2 heartbeat cadence. This
// module keeps v1's 25s as the default (unremarkable, not flagged as broken
// in itself) and adds a 10s pong-timeout on top, which v1 never had at all.

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

export interface HeartbeatSchedulerOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Called on each tick to actually send the `system.heartbeat` frame. */
  sendHeartbeat: () => void;
  /** Called if no pong is observed within `timeoutMs` of the most recent heartbeat. */
  onTimeout: () => void;
}

/**
 * Schedules periodic heartbeats and detects a missing reply.
 *
 * On timeout, this class does not distinguish "stale" from "dropped" — it
 * just calls `onTimeout` once, and `Transport` treats that identically to a
 * real disconnect (see transport.ts's header comment). Higher layers get one
 * signal to react to, not two similar-but-different ones.
 */
export class HeartbeatScheduler {
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  readonly #sendHeartbeat: () => void;
  readonly #onTimeout: () => void;

  #intervalTimer: ReturnType<typeof setInterval> | null = null;
  #timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HeartbeatSchedulerOptions) {
    this.#intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.#sendHeartbeat = options.sendHeartbeat;
    this.#onTimeout = options.onTimeout;
  }

  /** Begins the periodic cycle. Safe to call while already running — restarts cleanly. */
  start(): void {
    this.stop();
    this.#intervalTimer = setInterval(() => this.#beat(), this.#intervalMs);
  }

  /** Cancels both the interval and any pending timeout. Safe to call when not running. */
  stop(): void {
    if (this.#intervalTimer !== null) {
      clearInterval(this.#intervalTimer);
      this.#intervalTimer = null;
    }
    this.#clearPendingTimeout();
  }

  /** Call when a `system.pong` frame arrives — cancels the pending timeout for the most recent heartbeat. */
  notePong(): void {
    this.#clearPendingTimeout();
  }

  #beat(): void {
    this.#sendHeartbeat();
    this.#clearPendingTimeout();
    this.#timeoutTimer = setTimeout(() => this.#onTimeout(), this.#timeoutMs);
  }

  #clearPendingTimeout(): void {
    if (this.#timeoutTimer !== null) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = null;
    }
  }
}
