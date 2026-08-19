// Runs the full `@dhaam-ccrm/binding-conformance` suite (T17) against the
// REAL @dhaam-ccrm/angular package. Every check that turns red here is a
// finding about this binding, not a suite bug — that package's own
// negative-fixtures.test.ts is the proof the suite can fail things.
//
// Runs in vitest's default `node` environment: no jsdom, no zone.js, no
// TestBed. See test/angular-test-host.ts for how.

import { runBindingConformance } from '@dhaam-ccrm/binding-conformance';

import { createAngularAdapter } from './angular-adapter.js';

runBindingConformance(createAngularAdapter());
