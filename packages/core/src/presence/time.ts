// Injectable time — the reason every timeout in this module is testable
// without sleeping.
//
// Two primitives, both injected rather than reached for as globals:
//
//   Clock         reads "now" as epoch millis
//   ScheduleTimer schedules a one-shot callback, returns its canceller
//
// `ScheduleTimer` deliberately returns a *cancel function* instead of an
// opaque handle you later hand to a `clearTimeout` counterpart. A handle-based
// interface has to name the handle's type, and that type differs by runtime —
// the DOM lib types `setTimeout` as returning `number`, Node's types return a
// `Timeout` object. Any single interface over both ends up either `unknown`
// (forcing a cast at the one place that actually clears the timer) or wrong on
// one runtime. Returning a closure sidesteps the question entirely: the handle
// never crosses the seam, so it never needs a portable type, and `systemTimers`
// below compiles with no cast under either runtime's typings.
//
// This is also the whole of PRD §14's "no DOM, no window" compliance for the
// timing half of presence: `setTimeout`/`clearTimeout` are referenced in
// exactly one place (the default implementation), are true cross-runtime
// globals rather than DOM-document APIs, and every consumer in this module
// takes the injected form.

/** Cancels a pending timer. Calling it after the timer fired is a safe no-op. */
export type CancelTimer = () => void;

/**
 * Schedules `callback` to run once after `delayMs`, returning its canceller.
 *
 * Implementations must not invoke `callback` synchronously — every caller in
 * this module schedules from inside a state mutation and relies on the
 * callback landing on a later turn.
 */
export type ScheduleTimer = (callback: () => void, delayMs: number) => CancelTimer;

/** Reads the current time as epoch millis, matching `Date.now()`. */
export type Clock = () => number;

/** The default `ScheduleTimer`, backed by the ambient `setTimeout`. */
export const systemTimers: ScheduleTimer = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(handle);
  };
};

/** The default `Clock`, backed by `Date.now`. */
export const systemClock: Clock = () => Date.now();
