// Invariant #6 — Ordering and dedup (task brief, item 6):
//   "Messages surface ordered by seq, never ts; a replayed frame with a
//    known ULID does not duplicate."
//
// Core (MessageController) already guarantees `ChatState.messages` arrives
// pre-sorted and pre-deduped by the time any binding sees it — the list
// algebra doing that (`sortMessages`/`upsertMessage`) is exported from
// `@dhaam-ccrm/core`'s public barrel specifically so a binding writing its
// own optimistic UI can honour the same rules (messages/index.ts's own
// comment: "ordering and dedup are protocol rules... that a binding writing
// its own optimistic UI has to honour identically"). So what these checks
// exercise is narrower than "is core's algorithm correct" (covered by
// core's own suite) — it is "does the binding pass this already-correct
// array through to its consumers verbatim", which is exactly where a
// binding that keeps its own parallel bookkeeping (e.g. appending on the
// `message` event instead of trusting `state.messages`) goes wrong.

import { sortMessages, upsertMessage } from '@dhaam-ccrm/core';
import { expect } from 'vitest';

import { buildMessage } from '../harness/builders.js';
import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

export const ORDERING_DEDUP_CHECKS: ConformanceCheck[] = [
  {
    id: 'ordering-by-seq-not-by-timestamp',
    description: 'messages surface ordered by seq, even when that disagrees with createdAt order',
    async run(adapter) {
      const client = createConformanceChatClient({ messages: [] });
      const handle = adapter.mount(client);
      try {
        // createdAt order would be A, B, C — seq order is B, A, C. A binding
        // that (incorrectly) re-sorts by createdAt/ts instead of trusting
        // the array's given order would expose the wrong sequence.
        const messageA = buildMessage({ id: 'm_a', seq: 2, createdAt: '2026-01-01T00:00:00.000Z' });
        const messageB = buildMessage({ id: 'm_b', seq: 1, createdAt: '2026-01-01T00:00:05.000Z' });
        const messageC = buildMessage({ id: 'm_c', seq: 3, createdAt: '2026-01-01T00:00:02.000Z' });

        // `sortMessages` is core's own ordering rule — mirrors exactly what
        // MessageController hands to ChatState in production.
        const ordered = sortMessages([messageA, messageB, messageC]);

        const view = handle.observeState((s) => s.messages);
        client.__harness.setState({ messages: ordered });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(view.value().map((m) => m.id)).toEqual(['m_b', 'm_a', 'm_c']);
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'ordering-replayed-ulid-does-not-duplicate',
    description: 'a replayed frame carrying a known message ULID updates the existing entry instead of appending a duplicate',
    async run(adapter) {
      const client = createConformanceChatClient({ messages: [] });
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => s.messages);

        const original = buildMessage({ id: 'm_replay' });
        client.__harness.setState({ messages: upsertMessage([], original) });
        await client.__harness.flushMicrotasks();
        await handle.settle();
        expect(view.value()).toHaveLength(1);

        // Same ULID, now server-confirmed with a seq — a replayed
        // `message.new` frame, not a new message.
        const replayed = { ...original, seq: 7 };
        client.__harness.setState({ messages: upsertMessage(view.value(), replayed) });
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(view.value(), 'the replay must update the existing entry, not append a second one').toHaveLength(1);
        expect(view.value()[0]?.id).toBe('m_replay');
        expect(view.value()[0]?.seq, 'the exposed entry must be the latest (confirmed) version').toBe(7);
      } finally {
        handle.unmount();
      }
    },
  },
];
