// Where a throwing listener's error goes.
//
// Consumer callbacks — `subscribe` listeners and `on` handlers — are app
// code running inside core's notify loop. Three things must all hold when
// one throws:
//
//   1. The store must not break. Its own invariants (current state, the
//      notifying snapshot, the scheduled-flush flag) must survive.
//   2. Sibling listeners must still be notified. One binding's bug must not
//      silently blind every other binding on the same client.
//   3. The error must not be swallowed. A `catch {}` here would make an
//      exception inside a React render callback vanish with no trace, which
//      is materially worse than a noisy crash.
//
// Catching satisfies (1) and (2) but conflicts with (3), so the caught error
// is re-thrown *outside* the loop instead of inside it.

/**
 * Receives an error thrown by a consumer callback. Never called for errors
 * raised by core itself — those propagate normally.
 */
export type ListenerErrorReporter = (error: unknown) => void;

/**
 * Default policy: re-throw on a fresh macrotask.
 *
 * The throw escapes to the platform's own unhandled-error path —
 * `window.onerror` / `unhandledrejection` in a browser,
 * `process.on('uncaughtException')` in Node — so the error reaches whatever
 * error reporting the host app already installed, with its original stack
 * intact. Because it lands on a later task, it cannot abort core's notify
 * loop or corrupt store state.
 *
 * `setTimeout` rather than `queueMicrotask` deliberately: the store batches
 * its notifications on the microtask queue, and re-throwing there would
 * interleave a consumer's error with core's own scheduling. It is also what
 * makes the two separable in tests.
 *
 * Pass a `ListenerErrorReporter` to `ChatStore` to route errors somewhere
 * else (Sentry, a test spy) instead.
 */
export function rethrowListenerError(error: unknown): void {
  setTimeout(() => {
    throw error;
  }, 0);
}
