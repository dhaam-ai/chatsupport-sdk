// Runs the full suite against the package's own framework-free reference
// adapter — an independent proof (alongside test/react-binding.conformance.test.ts)
// that the suite is satisfiable by a correct implementation at all, not
// tuned to any one framework's particular quirks.

import { runBindingConformance } from '../src/checks/run-all.js';
import { createMinimalReferenceAdapter } from '../src/fixtures/minimal-reference-adapter.js';

runBindingConformance(createMinimalReferenceAdapter('minimal-reference'));
