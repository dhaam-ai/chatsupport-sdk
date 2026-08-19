// Invariant #1 — State delivery (task brief, item 1):
//   "A store change reaches subscribers; the full snapshot arrives, never a
//    patch; the snapshot is immutable from outside; getState() returns the
//    identical reference while nothing changed."

import { expect } from 'vitest';

import { buildMessage } from '../harness/builders.js';
import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

export const STATE_DELIVERY_CHECKS: ConformanceCheck[] = [
  {
    id: 'state-delivery-reaches-subscribers',
    description: 'a store change reaches a mounted subscriber',
    async run(adapter) {
      const client = createConformanceChatClient({ unreadCount: 0 });
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => s.unreadCount);
        expect(view.value(), 'initial value before any change').toBe(0);

        client.__harness.setState({ unreadCount: 3 });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(view.value(), 'value after a store change reached the mounted view').toBe(3);
        expect(view.updateCount(), 'exactly one update for one store change').toBe(1);
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'state-delivery-full-snapshot-not-a-patch',
    description: 'every notification carries the full ChatState, not a partial patch',
    async run(adapter) {
      const client = createConformanceChatClient({ unreadCount: 5, uploading: false });
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => s);

        // A patch that touches only `uploading` must still leave `unreadCount`
        // fully present and correct on the exposed value — a binding that
        // forwards a diff/patch instead of the full snapshot would drop it.
        client.__harness.setState({ uploading: true });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        const exposed = view.value();
        expect(exposed.uploading, 'the field the patch touched').toBe(true);
        expect(exposed.unreadCount, 'a field the patch did NOT touch must still be present, from the full snapshot').toBe(5);
        expect(exposed).toEqual(client.getState());
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'state-delivery-immutable-from-outside',
    description: 'the exposed snapshot cannot be mutated by the consumer',
    async run(adapter) {
      const seed = buildMessage();
      const client = createConformanceChatClient({ messages: [seed] });
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => s);
        const exposed = view.value();

        // `ChatState`'s fields are not spelled `Readonly<...>` (state/types.ts's
        // own comment: the runtime, not just the compiler, is what refuses
        // mutation) — so these assignments are legal TypeScript that must
        // still throw at runtime because the object is deep-frozen.
        expect(() => {
          exposed.unreadCount = 999;
        }, 'assigning a top-level field on the exposed state must throw (frozen), not silently succeed').toThrow();

        expect(() => {
          exposed.messages.push(seed);
        }, 'mutating a nested collection on the exposed state must throw (deep-frozen), not silently succeed').toThrow();

        // The attempted mutation must not have partially succeeded either —
        // still exactly the one seeded message, not two.
        expect(client.getState().unreadCount).toBe(0);
        expect(client.getState().messages).toHaveLength(1);
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'state-delivery-getstate-reference-stability',
    description: 'client.getState() returns the identical reference while nothing has changed',
    async run() {
      // Deliberately does not go through `adapter.mount()` — this is the
      // harness's own contract (mirroring core's ChatStore, see
      // conformance-client.ts's header), which every binding depends on but
      // which no binding code can affect either way. Kept as an explicit,
      // fast sanity check: if this ever failed, the fault is in the suite's
      // harness, not in whatever binding is under test.
      const client = createConformanceChatClient();
      const a = client.getState();
      const b = client.getState();
      expect(a, 'two synchronous getState() calls with no change between them').toBe(b);

      client.__harness.setState({});
      await client.__harness.flushMicrotasks();
      expect(client.getState(), 'an empty patch must not produce a new snapshot').toBe(a);

      client.__harness.setState({ unreadCount: client.getState().unreadCount });
      await client.__harness.flushMicrotasks();
      expect(client.getState(), 'a patch whose value is already reference-identical must not produce a new snapshot').toBe(a);

      client.__harness.setState({ unreadCount: (client.getState().unreadCount ?? 0) + 1 });
      await client.__harness.flushMicrotasks();
      expect(client.getState(), 'a genuine change must produce a new snapshot reference').not.toBe(a);
    },
  },
];
