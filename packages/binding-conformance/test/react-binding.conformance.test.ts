// @vitest-environment jsdom
//
// Runs the full conformance suite against the REAL @dhaam-ccrm/react
// package (T15) — the task brief's "Run the suite against the real
// @dhaam-ccrm/react and confirm it passes." Every check that turns red here
// is a genuine finding about the reference binding, not a suite bug (see
// this package's negative-fixtures.test.ts for the proof the suite can
// fail things, and test/minimal-reference.conformance.test.ts for the proof
// the suite can pass a correct binding).

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { runBindingConformance } from '../src/checks/run-all.js';
import { createReactAdapter } from './react-adapter.js';

afterEach(() => {
  cleanup();
});

runBindingConformance(createReactAdapter());
