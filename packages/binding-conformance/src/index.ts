// @dhaam-ccrm/binding-conformance — public barrel.
//
// This is T17: the anti-divergence mechanism PRD §15 needs so that React
// (T15), Vue (T20), Angular (T21), and vanilla (T22) "behave identically"
// as more than prose. A binding gets the whole suite by writing one small
// adapter (see types.ts's `BindingAdapter`) and calling:
//
//   import { runBindingConformance } from '@dhaam-ccrm/binding-conformance';
//   runBindingConformance({ name: 'vue', mount: (client) => ... });
//
// inside its own `*.test.ts` file — that's the entire integration.
//
// Framework-agnostic by construction: nothing under src/ imports React,
// Vue, or Angular. The one framework this repo currently has a binding for
// (@dhaam-ccrm/react) is exercised only from this package's own test/
// directory (test/react-adapter.ts, test/react-binding.conformance.test.ts)
// — never from src/ — specifically so this package's own dependency graph
// stays proof, not just policy, of "no React import in the suite itself".
//
// Everything below is grouped the same way the task brief structured T17's
// brief: the adapter contract, the two ways to run the suite, and the
// negative fixtures that prove the suite can fail (shipped permanently, per
// the brief — "those negative fixtures are the proof the suite works").

// ---------------------------------------------------------------------------
// The adapter contract every binding implements.
// ---------------------------------------------------------------------------
export type { BindingAdapter, BindingHandle, EventView, MirroredMessageTickState, StateView } from './types.js';

// ---------------------------------------------------------------------------
// Running the suite.
// ---------------------------------------------------------------------------
export {
  ALL_CHECKS,
  collectConformanceResults,
  runBindingConformance,
} from './checks/run-all.js';
export type { ConformanceCheck, ConformanceCheckResult, ConformanceCheckStatus, ConformanceReport } from './checks/run-all.js';

// ---------------------------------------------------------------------------
// The harness — the suite's own `ChatClient` test double. Exported so a
// binding's own test file can build additional, binding-specific scenarios
// on top of the same faithful-to-core double this package's checks use,
// instead of hand-rolling a second one (react/test/fake-chat-client.ts's
// precedent, generalized).
// ---------------------------------------------------------------------------
export { createConformanceChatClient } from './harness/conformance-client.js';
export type { ConformanceChatClient, ConformanceHarness } from './harness/conformance-client.js';
export { buildMessage, buildSession, resetBuilderIds } from './harness/builders.js';

// ---------------------------------------------------------------------------
// Tick derivation oracle — see this file's header on ticks-oracle.ts for
// GAP-1 (packages/core/src/index.ts does not export
// deriveTickState/deriveTickStateFromState). Exported so a binding's own
// tests can use the same canonical-or-mirrored oracle this suite does.
// ---------------------------------------------------------------------------
export { resolveTickOracle } from './ticks-oracle.js';
export type { TickOracle, TickOracleInput } from './ticks-oracle.js';

// ---------------------------------------------------------------------------
// Reference and negative fixtures — shipped permanently, not scratch (task
// brief). `minimal-reference-adapter` is a correct, framework-free
// `BindingAdapter` used both as the base every negative fixture below is a
// one-thing-broken variant of, and as a second, independent proof (beyond
// the real @dhaam-ccrm/react adapter under test/) that the suite is
// satisfiable by a correct implementation at all.
// ---------------------------------------------------------------------------
export { createMinimalReferenceAdapter } from './fixtures/minimal-reference-adapter.js';
export { createNeverNotifiesAdapter } from './fixtures/never-notifies.js';
export { createMutatesInPlaceAdapter } from './fixtures/mutates-in-place.js';
export { createLeaksListenersAdapter } from './fixtures/leaks-listeners.js';
export { createWrongTicksAdapter } from './fixtures/wrong-ticks.js';
