// Shared test helper: run a composable outside any component, the way a Pinia
// store or a Nuxt plugin would.
//
// `app.runWithContext()` (Vue 3.3+) is what makes `inject()` — and therefore
// `useChatClient()` — resolve with no component instance in scope; `effectScope`
// is what gives `onScopeDispose` something to hang teardown on. Together they
// are the officially-supported non-component call path, and this package's
// error message points callers at exactly this pattern.
//
// Deliberately no DOM: every test file that uses this runs in vitest's `node`
// environment, so a stray `window`/`document` read anywhere under
// `useChatSelector` would fail loudly instead of silently hitting jsdom's.

import type { ChatClient } from '@dhaam-ccrm/core';
import { createApp, effectScope } from 'vue';

import { chatClientKey } from '../src/index.js';

export interface ChatScopeResult<T> {
  /** Whatever the composable returned. */
  readonly value: T;
  /** Stops the effect scope — the analogue of unmounting the component that called the composable. */
  readonly stop: () => void;
}

export function runInChatScope<T>(client: ChatClient, fn: () => T): ChatScopeResult<T> {
  const app = createApp({ render: () => null });
  app.provide(chatClientKey, client);

  const scope = effectScope();
  const value = app.runWithContext(() => scope.run(fn)) as T;

  return { value, stop: () => scope.stop() };
}

/** Same, minus the effect scope — for asserting what happens when a caller gives teardown nowhere to live. */
export function runWithNoScope<T>(client: ChatClient, fn: () => T): T {
  const app = createApp({ render: () => null });
  app.provide(chatClientKey, client);
  return app.runWithContext(fn);
}
