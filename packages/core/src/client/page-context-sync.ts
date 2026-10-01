// Keeps the server's idea of "where the visitor is" in step with the host page
// (chatbot-workflows.md §9.2–9.3, §11.1).
//
// Two channels carry the context, and this class decides which one a change
// takes:
//   - `connection.hello.context` — whatever is known when a hello is built,
//     which is how page flows can start the moment a session is created.
//   - `context.update` — a change made while connected.
//
// The contract asks for three things, all handled here rather than left to
// every host: send an update only when the content ACTUALLY changed (a single
// page app calls `setPage` on every render), coalesce a burst (a checkout step
// change often fires two or three route events), and stay under the server's
// 10-per-minute cap (`RATE_LIMITED` is retryable, but an SDK that hits it on
// purpose is broken). The cap here is lower than the server's so a reconnect's
// own traffic never tips it over.
//
// A bad context must never cost the visitor their chat, so nothing here
// throws: input is normalised (`normalizeVisitorContext` drops each field the
// server would reject) and an unusable call is simply reported as ignored.

import type { Clock, ScheduleTimer, CancelTimer } from '../presence/index.js';
import { normalizeVisitorContext, visitorContextKey } from '../protocol/index.js';
import type { VisitorContext } from '../protocol/index.js';

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_MAX_PER_MINUTE = 8;
const WINDOW_MS = 60_000;

export interface PageContextSyncOptions {
  /** Whether a `context.update` written now would reach a joined session. */
  readonly isConnected: () => boolean;
  /** Writes the frame. Fire-and-forget: a failed update is not worth surfacing. */
  readonly send: (context: VisitorContext) => void;
  readonly schedule: ScheduleTimer;
  readonly clock: Clock;
  readonly debounceMs?: number;
  readonly maxPerMinute?: number;
}

export class PageContextSync {
  readonly #isConnected: () => boolean;
  readonly #send: (context: VisitorContext) => void;
  readonly #schedule: ScheduleTimer;
  readonly #clock: Clock;
  readonly #debounceMs: number;
  readonly #maxPerMinute: number;

  #latest: VisitorContext | undefined;
  /** Identity of `#latest`; `null` until anything usable was set. */
  #latestKey: string | null = null;
  /** Identity of what the server last received (in a hello or an update). */
  #sentKey: string | null = null;
  #sentTimes: number[] = [];
  #cancelTimer: CancelTimer | null = null;

  constructor(options: PageContextSyncOptions) {
    this.#isConnected = options.isConnected;
    this.#send = options.send;
    this.#schedule = options.schedule;
    this.#clock = options.clock;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  }

  /**
   * Records the page the visitor is on. Returns `false` when `input` was not an
   * object at all (nothing recorded); `true` otherwise, even when a field was
   * dropped or the content was unchanged.
   */
  set(input: unknown): boolean {
    const context = normalizeVisitorContext(input);
    if (context === null) return false;

    const key = visitorContextKey(context);
    if (key === this.#latestKey && key === this.#sentKey) return true;

    this.#latest = context;
    this.#latestKey = key;
    // Not connected: only latched. The next hello carries it (`forHello`), and
    // the client flushes once connected for a change made after that hello.
    if (this.#isConnected()) this.#arm(this.#debounceMs);
    return true;
  }

  /**
   * What the next `connection.hello` should carry, or `undefined` for "nothing
   * to say" (absent on the wire, not `{}`). Marks it as delivered, so the same
   * content is not sent again as an update.
   */
  forHello(): VisitorContext | undefined {
    if (this.#latestKey === null || this.#latest === undefined) return undefined;
    this.#sentKey = this.#latestKey;
    return Object.keys(this.#latest).length === 0 ? undefined : this.#latest;
  }

  /**
   * Sends the latest context now if the server does not have it yet. The client
   * calls this on every connect, to cover a change made between a hello being
   * built and its ack. Returns whether a frame was written.
   */
  flush(): boolean {
    if (!this.#isConnected()) return false;
    if (this.#latest === undefined || this.#latestKey === null || this.#latestKey === this.#sentKey) return false;

    const now = this.#clock();
    this.#sentTimes = this.#sentTimes.filter((at) => at > now - WINDOW_MS);
    const oldest = this.#sentTimes[0];
    if (this.#sentTimes.length >= this.#maxPerMinute && oldest !== undefined) {
      // Over the cap: hold the NEWEST value and try again when a slot frees up.
      // Intermediate values are skipped on purpose — only where the visitor is
      // now matters to a page flow.
      this.#arm(oldest + WINDOW_MS - now + 1);
      return false;
    }

    this.#send(this.#latest);
    this.#sentKey = this.#latestKey;
    this.#sentTimes.push(now);
    return true;
  }

  destroy(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }

  #arm(delayMs: number): void {
    this.#cancelTimer?.();
    this.#cancelTimer = this.#schedule(() => {
      this.#cancelTimer = null;
      this.flush();
    }, delayMs);
  }
}
