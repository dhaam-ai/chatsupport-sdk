// A hand-driven `Clock` + `ScheduleTimer` pair, so tests assert timeout
// behaviour without sleeping.
//
// Lives in src/ rather than in a test file because all three of this module's
// units (typing, watermarks, presence) plus the controller need it — four
// consumers, so the duplication threshold is well past. It ships zero runtime
// dependencies and is not re-exported by the package's public entry point
// (T13's src/index.ts decides that), so it costs consumers nothing.
//
// `advance` deliberately replays real timer semantics rather than just firing
// everything due: it steps the clock to each timer's due time *before* running
// it, and re-scans afterwards. So a callback that reads `clock()` sees its own
// scheduled time (not the end of the window), and a callback that schedules a
// further timer inside the same window still fires within that window — which
// is exactly the re-arming pattern the typing throttle uses.

import type { CancelTimer, Clock, ScheduleTimer } from './time.js';

interface ScheduledTimer {
  readonly dueAt: number;
  readonly seq: number;
  readonly callback: () => void;
  cancelled: boolean;
}

export class ManualTimers {
  #now: number;
  #seq = 0;
  #timers: ScheduledTimer[] = [];

  constructor(startAt = 0) {
    this.#now = startAt;
  }

  /** The injectable `Clock`. Bound, so it can be passed as a bare function. */
  readonly clock: Clock = () => this.#now;

  /** The injectable `ScheduleTimer`. Bound, so it can be passed as a bare function. */
  readonly schedule: ScheduleTimer = (callback, delayMs): CancelTimer => {
    const timer: ScheduledTimer = {
      dueAt: this.#now + delayMs,
      seq: this.#seq++,
      callback,
      cancelled: false,
    };
    this.#timers.push(timer);

    return () => {
      // Flag rather than splice: `advance` may be mid-scan over this array,
      // and a timer cancelled from inside another timer's callback must be
      // skipped without shifting the entries the scan has yet to reach.
      timer.cancelled = true;
    };
  };

  /**
   * Moves time forward by `ms`, firing every timer that comes due, in due
   * order (ties broken by scheduling order).
   */
  advance(ms: number): void {
    const target = this.#now + ms;

    for (;;) {
      const next = this.#takeNextDue(target);
      if (next === null) break;

      this.#now = next.dueAt;
      next.callback();
    }

    this.#now = target;
  }

  /** Number of scheduled, not-yet-fired, not-cancelled timers. */
  get pendingCount(): number {
    return this.#timers.filter((timer) => !timer.cancelled).length;
  }

  /**
   * Removes and returns the earliest live timer due at or before `target`,
   * or `null` when none remain. Cancelled timers are swept here rather than
   * on cancellation, so cancelling never disturbs an in-progress scan.
   */
  #takeNextDue(target: number): ScheduledTimer | null {
    let best: ScheduledTimer | null = null;

    for (const timer of this.#timers) {
      if (timer.cancelled || timer.dueAt > target) continue;
      if (best === null || timer.dueAt < best.dueAt || (timer.dueAt === best.dueAt && timer.seq < best.seq)) {
        best = timer;
      }
    }

    if (best === null) {
      this.#timers = this.#timers.filter((timer) => !timer.cancelled);
      return null;
    }

    const taken = best;
    this.#timers = this.#timers.filter((timer) => timer !== taken && !timer.cancelled);
    return taken;
  }
}
