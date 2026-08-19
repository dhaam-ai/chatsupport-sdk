// The one shape every invariant in `checks/*.ts` is expressed as, and the
// only thing `run-all.ts` needs to know about a check to either wire it into
// a real vitest `it()` (`runBindingConformance`) or run it headlessly and
// collect a pass/fail report (`collectConformanceResults`, used by the
// negative-fixture meta-tests — see this package's `test/` directory and
// the task's "make it impossible to pass vacuously" requirement).
//
// `run` uses vitest's own `expect` internally (checks/*.ts files import it
// directly) rather than a bespoke assertion helper: `expect(...).toBe(...)`
// throws a normal error on failure regardless of whether it is invoked
// directly inside an `it()` callback or several frames deep inside a
// `collectConformanceResults` call that itself runs inside an `it()` — both
// of this package's own consumers satisfy that. This keeps one assertion
// vocabulary (vitest's) instead of two, which matters because a failure
// message a binding author reads should look like every other vitest
// failure they already know how to debug.

import type { BindingAdapter } from '../types.js';

export interface ConformanceCheck {
  /** Stable, kebab-case — appears in test titles and in `ConformanceReport.results[].id`. Never renamed once shipped; T20/T21/T22 may come to depend on the id for their own reporting. */
  readonly id: string;

  /** One sentence, present tense, reads naturally after the id in a test title: `[id] description`. */
  readonly description: string;

  /** Defaults to always-applicable. Return `false` to skip (never to silently pass) — see `computeTick`'s optionality on `BindingAdapter`. */
  applicable?(adapter: BindingAdapter): boolean;

  /** Throws on failure (via vitest's `expect`, or by letting an unexpected error from the adapter itself propagate — both are failures). Resolves cleanly on success. */
  run(adapter: BindingAdapter): Promise<void>;
}
