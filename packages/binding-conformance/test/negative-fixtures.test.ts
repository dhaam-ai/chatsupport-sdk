// The proof this task's brief asks for by name: "Ship deliberately broken
// reference bindings as fixtures... and assert the suite fails each."
//
// Each fixture is otherwise-correct except for exactly one bug (see each
// fixture file's own header for which). These tests are themselves
// PASSING, green tests — they assert that running the suite against a
// broken binding produces a FAILED report, which is a true, checked fact,
// not a vacuous one: `collectConformanceResults` runs the exact same
// `ALL_CHECKS` array `runBindingConformance` does (src/checks/run-all.ts),
// so there is no separate, weaker code path a fixture could be sneaking
// past.

import { describe, expect, it } from 'vitest';

import { collectConformanceResults } from '../src/checks/run-all.js';
import { createLeaksListenersAdapter } from '../src/fixtures/leaks-listeners.js';
import { createMutatesInPlaceAdapter } from '../src/fixtures/mutates-in-place.js';
import { createNeverNotifiesAdapter } from '../src/fixtures/never-notifies.js';
import { createWrongTicksAdapter } from '../src/fixtures/wrong-ticks.js';
import type { ConformanceReport } from '../src/checks/run-all.js';

function failedCheckIds(report: ConformanceReport): string[] {
  return report.results.filter((r) => r.status === 'failed').map((r) => r.id);
}

describe('negative fixtures — proof the suite actually fails a broken binding', () => {
  it('catches a binding that never notifies its subscribers', async () => {
    const report = await collectConformanceResults(createNeverNotifiesAdapter());

    expect(report.passed, 'the never-notifies fixture must not pass the suite').toBe(false);
    expect(failedCheckIds(report)).toContain('state-delivery-reaches-subscribers');
  });

  it('catches a binding that mutates its cached snapshot in place instead of replacing it', async () => {
    const report = await collectConformanceResults(createMutatesInPlaceAdapter());

    expect(report.passed, 'the mutates-in-place fixture must not pass the suite').toBe(false);
    expect(failedCheckIds(report)).toContain('ordering-replayed-ulid-does-not-duplicate');
  });

  it('catches a binding that leaks listeners on unmount', async () => {
    const report = await collectConformanceResults(createLeaksListenersAdapter());

    expect(report.passed, 'the leaks-listeners fixture must not pass the suite').toBe(false);
    const failed = failedCheckIds(report);
    expect(failed).toContain('lifecycle-unmount-unsubscribes');
    expect(failed).toContain('lifecycle-mount-unmount-remount-leaks-nothing');
  });

  it('catches a binding that reimplements tick derivation slightly wrong', async () => {
    const report = await collectConformanceResults(createWrongTicksAdapter());

    expect(report.passed, 'the wrong-ticks fixture must not pass the suite').toBe(false);
    expect(failedCheckIds(report)).toContain('tick-derivation-binding-owned-computation-agrees-with-core');

    const tickCheck = report.results.find((r) => r.id === 'tick-derivation-binding-owned-computation-agrees-with-core');
    expect(tickCheck?.status).toBe('failed');
  });

  it('the wrong-ticks fixture is otherwise conformant — only the tick-computation check fails', async () => {
    // This is what makes the fixture a meaningful proof rather than a straw
    // man: it does not fail because its state/event plumbing is broken (it
    // delegates to the correct minimal-reference-adapter for that), only
    // because its OWN tick computation disagrees with core's.
    const report = await collectConformanceResults(createWrongTicksAdapter());
    const failed = report.results.filter((r) => r.status === 'failed');

    expect(failed.map((r) => r.id)).toEqual(['tick-derivation-binding-owned-computation-agrees-with-core']);
  });
});
