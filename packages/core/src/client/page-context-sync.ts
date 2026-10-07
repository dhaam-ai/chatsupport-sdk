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
import { normalizeVisitorContext, visitorContextKey, withLocation, withTimeZone } from '../protocol/index.js';
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
  /**
   * The visitor's time zone. When given, every context this sends (the hello's and each update, which
   * REPLACES the stored one) carries it as `attributes.timezone`, so the server can show them dates in
   * their own zone; a hello goes out with just that when the host set no context at all.
   */
  readonly timeZone?: () => string | undefined;
  /**
   * Where the visitor is (the browser's GPS fix, once they allowed it). When given and it answers, every context this sends
   * carries it as `location`, unless the host set its own. Call {@link PageContextSync.refresh} when it starts to answer or
   * changes, so a connected visitor's server learns it.
   */
  readonly location?: () => { readonly lat: number; readonly lng: number } | undefined;
}

export class PageContextSync {
  readonly #isConnected: () => boolean;
  readonly #send: (context: VisitorContext) => void;
  readonly #schedule: ScheduleTimer;
  readonly #clock: Clock;
  readonly #debounceMs: number;
  readonly #maxPerMinute: number;
  readonly #timeZone: (() => string | undefined) | undefined;
  readonly #location: (() => { readonly lat: number; readonly lng: number } | undefined) | undefined;
  /** What the host last set (normalised), without anything this class adds itself. */
  #host: VisitorContext | undefined;

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
    this.#timeZone = options.timeZone;
    this.#location = options.location;
  }

  /** `context` plus what this class knows about the visitor: their time zone and, once they allowed it, their position. */
  #zoned(context: VisitorContext): VisitorContext {
    const zoned = this.#timeZone === undefined ? context : withTimeZone(context, this.#timeZone());
    return this.#location === undefined ? zoned : withLocation(zoned, this.#location());
  }

  /**
   * Records the page the visitor is on. Returns `false` when `input` was not an
   * object at all (nothing recorded); `true` otherwise, even when a field was
   * dropped or the content was unchanged.
   */
  set(input: unknown): boolean {
    const normalized = normalizeVisitorContext(input);
    if (normalized === null) return false;
    this.#host = normalized;
    this.#apply(normalized);
    return true;
  }

  /**
   * Re-reads what this class adds on its own (the visitor's position, which arrives after the page's context was set) and,
   * if the context the server should have is now different, sends it. A no-op when nothing changed.
   */
  refresh(): void {
    const base = this.#host ?? {};
    // Nothing the host set and nothing to add (no position the server would accept, no zone): there is no context to send,
    // and an EMPTY update would clear the one the server holds.
    if (this.#host === undefined && Object.keys(this.#zoned(base)).length === 0) return;
    this.#apply(base);
  }

  #apply(normalized: VisitorContext): void {
    const context = this.#zoned(normalized);

    const key = visitorContextKey(context);
    if (key === this.#latestKey && key === this.#sentKey) return;

    this.#latest = context;
    this.#latestKey = key;
    // Not connected: only latched. The next hello carries it (`forHello`), and
    // the client flushes once connected for a change made after that hello.
    if (this.#isConnected()) this.#arm(this.#debounceMs);
  }

  /**
   * What the next `connection.hello` should carry, or `undefined` for "nothing
   * to say" (absent on the wire, not `{}`). Marks it as delivered, so the same
   * content is not sent again as an update.
   */
  forHello(): VisitorContext | undefined {
    if ((this.#latestKey === null || this.#latest === undefined) && (this.#timeZone !== undefined || this.#location !== undefined)) {
      // The host set no context: the hello still says which zone the visitor is in, and where, once they allowed it.
      const zoned = this.#zoned({});
      if (Object.keys(zoned).length > 0) {
        this.#latest = zoned;
        this.#latestKey = visitorContextKey(zoned);
      }
    }
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
