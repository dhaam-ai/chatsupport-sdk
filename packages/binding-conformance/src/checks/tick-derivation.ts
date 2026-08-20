// Invariant #5 — Tick derivation (task brief, item 5):
//   "All bindings return identical tick state for identical input —
//    asserted against ticks.ts, so a binding computing its own is caught."
//
// See src/ticks-oracle.ts's header for GAP-1 (packages/core/src/index.ts
// does not re-export ticks.ts's derivation from its public barrel) and how
// `resolveTickOracle()` works around it. Two checks here:
//
//   1. always-applicable: does the DATA a tick derivation needs (messages,
//      watermarks) survive intact through the binding's exposed state, such
//      that computing the canonical derivation against what the binding
//      exposes agrees with computing it against the raw client state.
//   2. only for a binding that opts in via `BindingAdapter.computeTick`
//      (most bindings — including the reference @dhaam-ccrm/react binding —
//      do not; ticks.ts is meant to be called by app code directly): does
//      that binding-owned computation agree with the canonical one. This is
//      the one the `wrong-ticks` negative fixture exists to fail.

import { expect } from 'vitest';

import { buildMessage } from '../harness/builders.js';
import { createConformanceChatClient } from '../harness/conformance-client.js';
import { resolveTickOracle } from '../ticks-oracle.js';
import type { MirroredMessageTickState } from '../types.js';
import type { ConformanceCheck } from './check.js';

const LOCAL_ID = 'participant_local';
const OTHER_ID = 'participant_other';
const CREATED_AT = '2026-01-01T00:00:00.000Z';

interface TickCase {
  readonly label: string;
  readonly message: ReturnType<typeof buildMessage>;
  readonly localParticipantId: string | null;
  readonly deliveredWatermarks: Record<string, number>;
  readonly readWatermarks: Record<string, string>;
  readonly expected: MirroredMessageTickState | null;
}

/**
 * One case per row of `deriveTickState`'s documented table, plus its four
 * documented `null` cases — transcribed from packages/core/src/messages/ticks.ts's
 * own doc comment, not invented independently.
 */
function buildTickTable(): TickCase[] {
  return [
    {
      label: 'queued send → pending',
      message: buildMessage({ id: 'tick_pending', senderId: LOCAL_ID, delivery: { state: 'queued' } }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: {},
      readWatermarks: {},
      expected: 'pending',
    },
    {
      label: 'confirmed, no watermark reaches it → sent',
      message: buildMessage({ id: 'tick_sent', senderId: LOCAL_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: {},
      readWatermarks: {},
      expected: 'sent',
    },
    {
      label: 'another participant delivered past seq → delivered',
      message: buildMessage({ id: 'tick_delivered', senderId: LOCAL_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: { [OTHER_ID]: 12 },
      readWatermarks: {},
      expected: 'delivered',
    },
    {
      label: 'another participant read past createdAt → read (outranks delivered)',
      message: buildMessage({ id: 'tick_read', senderId: LOCAL_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: { [OTHER_ID]: 12 },
      readWatermarks: { [OTHER_ID]: '2026-01-01T00:00:05.000Z' },
      expected: 'read',
    },
    {
      label: 'our OWN delivered watermark must not count as "another participant"',
      message: buildMessage({ id: 'tick_own_watermark', senderId: LOCAL_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: { [LOCAL_ID]: 999 },
      readWatermarks: {},
      expected: 'sent',
    },
    {
      label: 'localParticipantId null → no tick, ever',
      message: buildMessage({ id: 'tick_null_local', senderId: LOCAL_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: null,
      deliveredWatermarks: { [OTHER_ID]: 999 },
      readWatermarks: {},
      expected: null,
    },
    {
      label: "someone else's message → no tick",
      message: buildMessage({ id: 'tick_not_ours', senderId: OTHER_ID, seq: 10, createdAt: CREATED_AT }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: {},
      readWatermarks: {},
      expected: null,
    },
    {
      label: 'failed delivery → no tick (retry affordance, not a tick)',
      message: buildMessage({ id: 'tick_failed', senderId: LOCAL_ID, delivery: { state: 'failed', reason: 'rejected', retryable: false } }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: {},
      readWatermarks: {},
      expected: null,
    },
    {
      label: 'no seq and not queued → no tick',
      message: buildMessage({ id: 'tick_no_seq', senderId: LOCAL_ID }),
      localParticipantId: LOCAL_ID,
      deliveredWatermarks: {},
      readWatermarks: {},
      expected: null,
    },
  ];
}

export const TICK_DERIVATION_CHECKS: ConformanceCheck[] = [
  {
    id: 'tick-derivation-fidelity-through-binding',
    description: 'computing the canonical tick derivation against the binding-exposed state matches computing it against the raw client state',
    async run(adapter) {
      const oracle = resolveTickOracle();
      const client = createConformanceChatClient();
      const handle = adapter.mount(client);
      try {
        const view = handle.observeState((s) => s);

        for (const testCase of buildTickTable()) {
          client.__harness.setState({
            messages: [testCase.message],
            deliveredWatermarks: testCase.deliveredWatermarks,
            readWatermarks: testCase.readWatermarks,
          });
          await client.__harness.flushMicrotasks();
          await handle.settle();

          const viaRawClient = oracle.deriveTickStateFromState(client.getState(), testCase.message, testCase.localParticipantId);
          expect(viaRawClient, `oracle vs. table for '${testCase.label}' (harness bug, not a binding bug, if this fails)`).toBe(
            testCase.expected,
          );

          const exposed = view.value();
          const exposedMessage = exposed.messages.find((m) => m.id === testCase.message.id);
          expect(exposedMessage, `'${testCase.label}': the message must still be present in the binding's exposed state`).toBeDefined();

          const viaBinding = oracle.deriveTickStateFromState(exposed, exposedMessage!, testCase.localParticipantId);
          expect(viaBinding, `'${testCase.label}': tick computed from the binding's exposed state must match the canonical derivation`).toBe(
            testCase.expected,
          );
        }
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'tick-derivation-binding-owned-computation-agrees-with-core',
    description: "a binding that offers its own tick computation (BindingAdapter.computeTick) agrees with core's canonical derivation",
    applicable: (adapter) => typeof adapter.computeTick === 'function',
    async run(adapter) {
      const oracle = resolveTickOracle();
      const client = createConformanceChatClient();
      const handle = adapter.mount(client);
      try {
        for (const testCase of buildTickTable()) {
          client.__harness.setState({
            messages: [testCase.message],
            deliveredWatermarks: testCase.deliveredWatermarks,
            readWatermarks: testCase.readWatermarks,
          });
          await client.__harness.flushMicrotasks();
          await handle.settle();

          const viaBindingOwnComputation = adapter.computeTick!(handle, testCase.message.id, testCase.localParticipantId);
          expect(
            viaBindingOwnComputation,
            `'${testCase.label}': binding's own tick computation disagrees with ${oracle.source === 'core' ? 'core' : "core's mirrored"} deriveTickState`,
          ).toBe(testCase.expected);
        }
      } finally {
        handle.unmount();
      }
    },
  },
];
