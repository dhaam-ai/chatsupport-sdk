// Dead-peer detection: send `system.heartbeat`, expect `system.pong`.
//
// A TCP connection whose peer has vanished — laptop lid closed, mobile
// radio dropped, load balancer silently discarding — does not raise a close
// event. It just goes quiet, sometimes for minutes, while the client happily
// believes it is connected. §12.11 records that v1 sent a heartbeat every 25s
// and had no documented pong at all, so it detected nothing: it was a
// keepalive, not a liveness check. The pong is what makes this a check.
//
// This is one of two independent liveness mechanisms on the wire, and they
// are not interchangeable. The server also runs an RFC 6455 ping/pong reaper
// that `terminate()`s a silent client every 25-50s — that one is answered by
// the browser automatically at the protocol layer, is invisible to JS, and
// protects the *server*. This one protects the *client*, and nothing else
// does.
//
// Timers are injected, never global (PRD §14).

import type { CancelTimer, ScheduleTimer } from '../presence/time.js';

/**
 * Default interval between heartbeats. Matches v1's cadence (§12.11) — the
 * PRD fixes no v2 number, and there is no reason to change a value the
 * backend has already been receiving at this rate.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Default grace period for a `system.pong`. Long enough to survive a slow
 * mobile round trip, short enough that a dead peer is caught well inside the
 * server's own 25-50s reaper window.
 */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

export interface HeartbeatMonitorOptions {
  /** Injected — no global `setTimeout` is reachable from this module. */
  readonly schedule: ScheduleTimer;

  /** Idle time before each heartbeat. Defaults to {@link DEFAULT_HEARTBEAT_INTERVAL_MS}. */
  readonly intervalMs?: number;

  /** Grace period for the pong. Defaults to {@link DEFAULT_HEARTBEAT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;

  /**
   * Writes one `system.heartbeat` frame.
   *
   * Must not throw: it runs inside a timer callback, where an exception has
   * no caller to catch it. The transport satisfies this by routing the write
   * through its own guarded send path.
   */
  readonly sendHeartbeat: () => void;

  /**
   * The peer missed its deadline. Called once, after the monitor has already
   * stopped itself — so the handler may tear the connection down without
   * racing a timer it does not know about.
   */
  readonly onDeadPeer: () => void;
}

/**
 * Alternates between two states while running: waiting to send the next
 * heartbeat, and waiting for the pong that answers it. Exactly one timer is
 * ever outstanding.
 */
export class HeartbeatMonitor {
  readonly #schedule: ScheduleTimer;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  readonly #sendHeartbeat: () => void;
  readonly #onDeadPeer: () => void;

  #cancel: CancelTimer | null = null;
  #awaitingPong = false;

  constructor(options: HeartbeatMonitorOptions) {
    this.#schedule = options.schedule;
    this.#intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.#sendHeartbeat = options.sendHeartbeat;
    this.#onDeadPeer = options.onDeadPeer;
  }

  get isRunning(): boolean {
    return this.#cancel !== null;
  }

  /** True between sending a heartbeat and receiving its pong. */
  get isAwaitingPong(): boolean {
    return this.#awaitingPong;
  }

  /**
   * Begins monitoring. The first heartbeat goes out one interval from now,
   * not immediately — the connection has just proved itself live.
   *
   * Restarts cleanly if already running.
   */
  start(): void {
    this.stop();
    this.#scheduleHeartbeat();
  }

  /** Cancels any outstanding timer. Safe to call when not running. */
  stop(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#awaitingPong = false;
  }

  /**
   * Records an inbound `system.pong`.
   *
   * A pong arriving when no heartbeat is outstanding is ignored rather than
   * treated as liveness evidence: accepting it would let a peer that echoes
   * unsolicited pongs postpone its own deadline indefinitely.
   */
  notePong(): void {
    if (!this.#awaitingPong) return;

    this.#awaitingPong = false;
    this.#cancel?.();
    this.#scheduleHeartbeat();
  }

  #scheduleHeartbeat(): void {
    this.#cancel = this.#schedule(() => {
      this.#cancel = null;
      this.#awaitingPong = true;
      this.#sendHeartbeat();
      this.#scheduleDeadline();
    }, this.#intervalMs);
  }

  #scheduleDeadline(): void {
    this.#cancel = this.#schedule(() => {
      // Stop first, so `onDeadPeer` sees a monitor with no live timer and can
      // safely close, restart, or dispose without a stale callback firing.
      this.stop();
      this.#onDeadPeer();
    }, this.#timeoutMs);
  }
}
