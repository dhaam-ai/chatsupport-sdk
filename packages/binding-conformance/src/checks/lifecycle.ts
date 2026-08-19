// Invariant #3 — Lifecycle (task brief, item 3):
//   "Unmount unsubscribes; double-unsubscribe is safe; a listener that
//    throws does not break the store or starve siblings; a mount/unmount/
//    remount cycle leaks no listeners."

import { expect } from 'vitest';

import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

export const LIFECYCLE_CHECKS: ConformanceCheck[] = [
  {
    id: 'lifecycle-unmount-unsubscribes',
    description: 'unmounting the binding drops its subscription(s) from the client',
    async run(adapter) {
      const client = createConformanceChatClient();
      const baseline = client.__harness.subscriberCount();

      const handle = adapter.mount(client);
      handle.observeState((s) => s.unreadCount);
      expect(client.__harness.subscriberCount(), 'mounting a view must register at least one subscriber').toBeGreaterThan(baseline);

      handle.unmount();
      expect(client.__harness.subscriberCount(), 'unmount must return the subscriber count to its pre-mount baseline').toBe(baseline);
    },
  },

  {
    id: 'lifecycle-double-unsubscribe-is-safe',
    description: 'unmounting twice (or disposing a view twice) does not throw and does not under/over-count',
    async run(adapter) {
      const client = createConformanceChatClient();
      const baseline = client.__harness.subscriberCount();

      const handle = adapter.mount(client);
      const view = handle.observeState((s) => s.unreadCount);

      expect(() => view.dispose(), 'first dispose').not.toThrow();
      expect(() => view.dispose(), 'second dispose of the same view').not.toThrow();
      expect(() => handle.unmount(), 'first unmount').not.toThrow();
      expect(() => handle.unmount(), 'second unmount').not.toThrow();

      expect(client.__harness.subscriberCount()).toBe(baseline);
    },
  },

  {
    id: 'lifecycle-mount-unmount-remount-leaks-nothing',
    description: 'ten mount/unmount cycles leave the subscriber count exactly where it started',
    async run(adapter) {
      const client = createConformanceChatClient();
      const baseline = client.__harness.subscriberCount();

      for (let cycle = 0; cycle < 10; cycle += 1) {
        const handle = adapter.mount(client);
        handle.observeState((s) => s.unreadCount);
        handle.observeEvent('message');
        handle.unmount();

        expect(client.__harness.subscriberCount(), `subscriber count after cycle ${cycle}`).toBe(baseline);
      }
    },
  },

  {
    id: 'lifecycle-throwing-view-does-not-starve-siblings',
    description: "one view's selector throwing does not stop a sibling view (mounted from the same handle) from updating",
    async run(adapter) {
      const client = createConformanceChatClient({ unreadCount: 0 });
      const handle = adapter.mount(client);
      try {
        // View A throws once the trigger value is reached — a selector CAN
        // legitimately throw; a conformant binding must contain that to
        // this one view rather than let it corrupt or starve view B.
        const viewA = handle.observeState((s) => {
          if (s.unreadCount === 13) throw new Error('synthetic selector failure (conformance suite)');
          return s.unreadCount;
        });
        const viewB = handle.observeState((s) => s.unreadCount);

        expect(viewA.value()).toBe(0);
        expect(viewB.value()).toBe(0);

        client.__harness.setState({ unreadCount: 13 });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(viewB.value(), 'the well-behaved sibling must still see the new value').toBe(13);
        expect(viewB.updateCount(), 'the well-behaved sibling must still have updated exactly once').toBe(1);

        // A further, unrelated change must still reach viewB — proving the
        // client's own listener bookkeeping was not corrupted by A's throw.
        client.__harness.setState({ unreadCount: 14 });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(viewB.value()).toBe(14);
        expect(viewB.updateCount()).toBe(2);
      } finally {
        handle.unmount();
      }
    },
  },
];
