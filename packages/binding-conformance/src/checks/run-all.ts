// The two entry points every consumer of this package uses:
//
//   runBindingConformance(adapter)        registers real vitest `describe`/
//                                          `it` blocks — what T20/T21/T22
//                                          (and this package's own
//                                          react-binding test) call.
//
//   collectConformanceResults(adapter)    runs the exact same checks
//                                          headlessly and returns a report
//                                          instead of asserting through
//                                          vitest — what this package's own
//                                          negative-fixture tests call to
//                                          prove the suite actually catches
//                                          a broken binding (see
//                                          test/negative-fixtures.test.ts).
//
// Both are built from the same `ALL_CHECKS` array, on purpose: T17's brief
// is explicit that a conformance suite a fixture can pass vacuously is
// worse than none, and the surest way to guarantee `runBindingConformance`
// and the negative-fixture proof never drift apart is for there to be only
// one list of checks, walked two different ways.

import { describe, it } from 'vitest';

import type { BindingAdapter } from '../types.js';
import type { ConformanceCheck } from './check.js';
import { EVENT_DELIVERY_CHECKS } from './event-delivery.js';
import { ERROR_SURFACING_CHECKS } from './error-surfacing.js';
import { LIFECYCLE_CHECKS } from './lifecycle.js';
import { ORDERING_DEDUP_CHECKS } from './ordering-dedup.js';
import { SELECTOR_SEMANTICS_CHECKS } from './selector-semantics.js';
import { STATE_DELIVERY_CHECKS } from './state-delivery.js';
import { TICK_DERIVATION_CHECKS } from './tick-derivation.js';

export type { ConformanceCheck } from './check.js';

/** Every invariant the task brief's "What must be conformant" section enumerates (items 1–7), in that order. */
export const ALL_CHECKS: readonly ConformanceCheck[] = [
  ...STATE_DELIVERY_CHECKS,
  ...SELECTOR_SEMANTICS_CHECKS,
  ...LIFECYCLE_CHECKS,
  ...EVENT_DELIVERY_CHECKS,
  ...TICK_DERIVATION_CHECKS,
  ...ORDERING_DEDUP_CHECKS,
  ...ERROR_SURFACING_CHECKS,
];

export type ConformanceCheckStatus = 'passed' | 'failed' | 'skipped';

export interface ConformanceCheckResult {
  readonly id: string;
  readonly description: string;
  readonly status: ConformanceCheckStatus;
  /** Present only when `status === 'failed'`. Whatever the check threw — usually a vitest `AssertionError`, but any thrown value from a misbehaving adapter counts as a failure too. */
  readonly error?: unknown;
}

export interface ConformanceReport {
  readonly bindingName: string;
  readonly results: readonly ConformanceCheckResult[];
  /** `true` only if every applicable check passed. A `skipped` check does not count against this — see `BindingAdapter.computeTick`'s optionality. */
  readonly passed: boolean;
}

/**
 * Runs every check in `checks` (defaults to {@link ALL_CHECKS}) against
 * `adapter` without going through vitest's `it()`/`expect` failure
 * reporting — each check's outcome is captured into the returned report
 * instead of being (re-)thrown. Used by this package's own negative-fixture
 * tests to assert "the suite caught this" as a normal, passing vitest
 * assertion, rather than needing the broken fixture's failure to itself be
 * a red test in `pnpm test`.
 */
export async function collectConformanceResults(
  adapter: BindingAdapter,
  checks: readonly ConformanceCheck[] = ALL_CHECKS,
): Promise<ConformanceReport> {
  const results: ConformanceCheckResult[] = [];

  for (const check of checks) {
    if (check.applicable && !check.applicable(adapter)) {
      results.push({ id: check.id, description: check.description, status: 'skipped' });
      continue;
    }

    try {
      await check.run(adapter);
      results.push({ id: check.id, description: check.description, status: 'passed' });
    } catch (error) {
      results.push({ id: check.id, description: check.description, status: 'failed', error });
    }
  }

  return {
    bindingName: adapter.name,
    results,
    passed: results.every((result) => result.status !== 'failed'),
  };
}

/**
 * Registers one `describe(`binding conformance: ${adapter.name}`)` block
 * with one `it()` per applicable check (and one `it.skip()` per
 * inapplicable one, so an omitted `computeTick` shows up as a visible skip
 * in test output rather than silently absent). This is the call T20/T21/T22
 * make from their own `*.test.ts` file — see this package's own
 * test/react-binding.conformance.test.ts for the reference usage.
 */
export function runBindingConformance(adapter: BindingAdapter, checks: readonly ConformanceCheck[] = ALL_CHECKS): void {
  describe(`binding conformance: ${adapter.name}`, () => {
    for (const check of checks) {
      const title = `[${check.id}] ${check.description}`;

      if (check.applicable && !check.applicable(adapter)) {
        it.skip(title, () => {});
        continue;
      }

      it(title, async () => {
        await check.run(adapter);
      });
    }
  });
}
