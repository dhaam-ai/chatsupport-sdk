// Invariant #7 — Error surfacing (task brief, item 7):
//   "A failed operation surfaces through observable state rather than an
//    unhandled rejection."
//
// PRD §6.3/§6.4 route operation failures through `ChatState.lastError` and
// the `error` event (`sendMessage` "Never throws for offline";
// `sendAttachment`'s failures are documented in client/types.ts as reported
// "through ChatState.lastError/the error event instead" specifically
// because MessageController#sendAttachment never rejects on upload
// failure). A conformant binding must (a) deliver that state/event
// faithfully — covered by the general state-delivery/event-delivery checks
// too, asserted again here in this specific "an operation just failed"
// framing — and (b) must not itself introduce an unhandled promise
// rejection while doing so.

import { expect } from 'vitest';

import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

export const ERROR_SURFACING_CHECKS: ConformanceCheck[] = [
  {
    id: 'error-surfacing-via-observable-state-no-unhandled-rejection',
    description: 'a simulated operation failure surfaces through lastError/the error event without an unhandled promise rejection',
    async run(adapter) {
      const client = createConformanceChatClient({ lastError: null });
      const handle = adapter.mount(client);

      const unhandled: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        const stateView = handle.observeState((s) => s.lastError);
        const errorEvents = handle.observeEvent('error');

        const failure = {
          source: 'transport' as const,
          code: null,
          message: 'synthetic operation failure (conformance suite)',
          retryable: true,
        };

        // Mirrors how core actually reports an operation failure: the
        // state field and the event both change, together, synchronously
        // (store.ts: "since setState applies its change synchronously too
        // ... a handler calling getState() already sees the state that
        // accompanied this event").
        client.__harness.setState({ lastError: failure });
        client.__harness.emit('error', failure);
        await client.__harness.flushMicrotasks();
        await handle.settle();

        expect(stateView.value(), 'lastError must reflect the failure').toEqual(failure);
        expect(errorEvents.received(), 'the error event must have been delivered').toEqual([failure]);

        // Give a stray unhandled rejection a turn of the event loop to
        // surface before asserting none occurred.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled, 'surfacing this failure must not have produced an unhandled promise rejection').toEqual([]);
      } finally {
        process.removeListener('unhandledRejection', onUnhandledRejection);
        handle.unmount();
      }
    },
  },
];
