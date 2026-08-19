// @vitest-environment jsdom
//
// Runs the full @dhaam-ccrm/binding-conformance suite (T17) against the real
// @dhaam-ccrm/vue package. PRD §15 requires every binding to behave
// identically; four hand-written reactivity mappings will drift and prose
// cannot stop it, so this file — three lines of integration — is what makes
// "identical" checkable rather than asserted.
//
// Every check that turns red here is a genuine finding about this binding, not
// a suite bug: the conformance package ships permanent negative fixtures
// (never-notifies, mutates-in-place, leaks-listeners, wrong-ticks) proving the
// suite can fail a broken binding, and a minimal reference adapter proving it
// can pass a correct one.

import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';

import { runBindingConformance } from '@dhaam-ccrm/binding-conformance';

import { createVueAdapter } from './vue-adapter.js';

// Belt and braces: the adapter unmounts every view it creates through
// `dispose`/`unmount`, but a check that fails mid-way (before its `finally`)
// would otherwise leave a mounted app behind and pollute the next check's
// subscriber counts.
enableAutoUnmount(afterEach);

runBindingConformance(createVueAdapter());
