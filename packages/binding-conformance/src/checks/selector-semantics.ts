// Invariant #2 — Selector semantics (task brief, item 2):
//   "A slice that did not change does not notify; a composite selector
//    still settles. Core does no field-level diffing... every binding must
//    implement it and must agree on when a notification fires."

import { expect } from 'vitest';

import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.is(a[key], b[key]));
}

export const SELECTOR_SEMANTICS_CHECKS: ConformanceCheck[] = [
  {
    id: 'selector-unchanged-slice-does-not-notify',
    description: 'a selected slice that did not change does not update its view',
    async run(adapter) {
      const client = createConformanceChatClient({ typing: { isTyping: true, participantId: 'agent_1' } });
      const handle = adapter.mount(client);
      try {
        // Mirrors packages/react/src/use-typing-indicator.ts's own
        // documented case exactly: `state.typing` is untouched by an
        // unrelated field change.
        const view = handle.observeState((s) => s.typing);
        expect(view.updateCount()).toBe(0);

        client.__harness.setState({ unreadCount: 1 });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(view.updateCount(), 'unreadCount changed, typing did not — this view must not have updated').toBe(0);

        client.__harness.setState({ unreadCount: 2 });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(view.updateCount(), 'a second unrelated change — still must not have updated').toBe(0);

        client.__harness.setState({ typing: { isTyping: false } });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(view.updateCount(), 'typing itself finally changed').toBe(1);
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'selector-shallow-equal-caching-suppresses-notify',
    description: 'a composite selector returning a shallow-equal new object does not notify (React useSyncExternalStore identity trap)',
    async run(adapter) {
      const client = createConformanceChatClient({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
      const handle = adapter.mount(client);
      try {
        // A fresh object literal every call, by construction — the exact
        // case react's use-chat-selector.ts's module doc calls out as
        // "the one place a naive implementation breaks React's
        // useSyncExternalStore contract".
        const view = handle.observeState((s) => ({ hasMore: s.pagination.hasMore }), shallowEqual);
        expect(view.updateCount()).toBe(0);

        client.__harness.setState({ unreadCount: 7 });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(
          view.updateCount(),
          'pagination.hasMore is unchanged even though the selector builds a new object every call — must not notify',
        ).toBe(0);
        expect(view.value()).toEqual({ hasMore: true });

        client.__harness.setState({ pagination: { hasMore: false, loadingMore: false, initialLoaded: true } });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(view.updateCount(), 'hasMore itself finally changed').toBe(1);
        expect(view.value()).toEqual({ hasMore: false });
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'selector-composite-settles-after-a-batch',
    description: 'a composite selector reflects every field from a batch of synchronous changes, not an intermediate state',
    async run(adapter) {
      const client = createConformanceChatClient({ connectionState: 'idle', unreadCount: 0 });
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => ({ connectionState: s.connectionState, unreadCount: s.unreadCount }), shallowEqual);

        // Two synchronous setState calls, both before any microtask flush —
        // core batches these into exactly one notification (store.ts's
        // documented "any number of setState calls in one synchronous run
        // produce exactly one notification, carrying the final state").
        client.__harness.setState({ connectionState: 'connected' });
        client.__harness.setState({ unreadCount: 4 });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(view.value(), 'both fields from the batch must be present — not just the first, not neither').toEqual({
          connectionState: 'connected',
          unreadCount: 4,
        });
        expect(view.updateCount(), 'one batch, one update — not two, not zero').toBe(1);
      } finally {
        handle.unmount();
      }
    },
  },
];
