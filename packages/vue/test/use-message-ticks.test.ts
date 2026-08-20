// @vitest-environment node
//
// Expected values below are transcribed from `deriveTickState`'s own documented
// table in packages/core/src/messages/ticks.ts — written out as literals, NOT
// recomputed by calling the same function `useMessageTicks` calls. A test that
// asserts `ticks.get(id) === deriveTickStateFromState(...)` proves only that
// one call equals another call; these assert the four states and the four
// documented `null` cases by name.

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatMessage } from '@dhaam-ccrm/core';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import { useMessageTicks } from '../src/index.js';
import { runInChatScope } from './harness.js';

const LOCAL = 'participant_local';
const OTHER = 'participant_other';
const CREATED_AT = '2026-01-01T00:00:00.000Z';

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    sessionId: 'session_1',
    senderId: LOCAL,
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

interface Scenario {
  readonly label: string;
  readonly message: ChatMessage;
  readonly deliveredWatermarks: Record<string, number>;
  readonly readWatermarks: Record<string, string>;
  readonly localParticipantId: string | null;
  /** `undefined` means "absent from the map", which is how this binding renders `deriveTickState`'s `null`. */
  readonly expected: string | undefined;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'queued send → pending',
    message: buildMessage({ delivery: { state: 'queued' } }),
    deliveredWatermarks: {},
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: 'pending',
  },
  {
    label: 'confirmed, no watermark reaches it → sent',
    message: buildMessage({ seq: 10 }),
    deliveredWatermarks: {},
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: 'sent',
  },
  {
    label: "another participant's delivered watermark covers seq → delivered",
    message: buildMessage({ seq: 10 }),
    deliveredWatermarks: { [OTHER]: 12 },
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: 'delivered',
  },
  {
    label: 'read outranks delivered',
    message: buildMessage({ seq: 10 }),
    deliveredWatermarks: { [OTHER]: 12 },
    readWatermarks: { [OTHER]: '2026-01-01T00:00:05.000Z' },
    localParticipantId: LOCAL,
    expected: 'read',
  },
  {
    label: 'our OWN delivered watermark does not count as another participant',
    message: buildMessage({ seq: 10 }),
    deliveredWatermarks: { [LOCAL]: 999 },
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: 'sent',
  },
  {
    label: 'unknown local identity → no tick, ever',
    message: buildMessage({ seq: 10 }),
    deliveredWatermarks: { [OTHER]: 999 },
    readWatermarks: { [OTHER]: '2030-01-01T00:00:00.000Z' },
    localParticipantId: null,
    expected: undefined,
  },
  {
    label: "someone else's message → no tick",
    message: buildMessage({ seq: 10, senderId: OTHER }),
    deliveredWatermarks: {},
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: undefined,
  },
  {
    label: 'failed delivery → no tick (retry affordance, not a tick)',
    message: buildMessage({ delivery: { state: 'failed', reason: 'rejected', retryable: false } }),
    deliveredWatermarks: {},
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: undefined,
  },
  {
    label: 'no seq and not queued → no tick',
    message: buildMessage(),
    deliveredWatermarks: {},
    readWatermarks: {},
    localParticipantId: LOCAL,
    expected: undefined,
  },
];

describe('useMessageTicks', () => {
  it.each(SCENARIOS)('$label', async (scenario) => {
    const client = createConformanceChatClient({
      messages: [scenario.message],
      deliveredWatermarks: scenario.deliveredWatermarks,
      readWatermarks: scenario.readWatermarks,
    });

    const { value: ticks, stop } = runInChatScope(client, () => useMessageTicks(scenario.localParticipantId));

    expect(ticks.value.get(scenario.message.id)).toBe(scenario.expected);
    stop();
  });

  it('never derives delivery from presence — v1s bug, reproduced', async () => {
    // v1 rendered the double-grey tick when "the other party is connected".
    // Connectivity is not delivery. The other participant is ONLINE here and
    // holds no delivery watermark at all: the honest answer is `sent`.
    const message = buildMessage({ seq: 10 });
    const client = createConformanceChatClient({
      messages: [message],
      presence: { [OTHER]: { participantId: OTHER, status: 'ONLINE' } },
      deliveredWatermarks: {},
      readWatermarks: {},
    });

    const { value: ticks, stop } = runInChatScope(client, () => useMessageTicks(LOCAL));

    expect(ticks.value.get(message.id)).toBe('sent');
    stop();
  });

  it('refills the whole map when local identity becomes known', async () => {
    const message = buildMessage({ seq: 10 });
    const client = createConformanceChatClient({ messages: [message], deliveredWatermarks: { [OTHER]: 12 } });
    const localId = ref<string | null>(null);

    const { value: ticks, stop } = runInChatScope(client, () => useMessageTicks(localId));

    expect(ticks.value.size, 'identity unknown — conservative no-tick').toBe(0);

    localId.value = LOCAL;
    expect(ticks.value.get(message.id)).toBe('delivered');
    stop();
  });

  it('follows a watermark change without the message list changing', async () => {
    const message = buildMessage({ seq: 10 });
    const client = createConformanceChatClient({ messages: [message] });

    const { value: ticks, stop } = runInChatScope(client, () => useMessageTicks(LOCAL));
    expect(ticks.value.get(message.id)).toBe('sent');

    client.__harness.setState({ deliveredWatermarks: { [OTHER]: 10 } });
    await client.__harness.flushMicrotasks();
    expect(ticks.value.get(message.id)).toBe('delivered');

    client.__harness.setState({ readWatermarks: { [OTHER]: '2026-01-01T00:00:01.000Z' } });
    await client.__harness.flushMicrotasks();
    expect(ticks.value.get(message.id)).toBe('read');

    stop();
  });

  it('does not re-derive when an unrelated field changes', async () => {
    // The `computed` earning its keep: a 500-message list is not walked because
    // `connectionState` moved. Counted through the localParticipantId getter,
    // which the computed body calls exactly once per evaluation.
    const client = createConformanceChatClient({ messages: [buildMessage({ seq: 10 })] });
    let evaluations = 0;

    const { value: ticks, stop } = runInChatScope(client, () =>
      useMessageTicks(() => {
        evaluations += 1;
        return LOCAL;
      }),
    );

    expect(ticks.value.size).toBe(1);
    expect(evaluations).toBe(1);

    client.__harness.setState({ connectionState: 'connected', unreadCount: 3 });
    await client.__harness.flushMicrotasks();
    expect(ticks.value.size).toBe(1);
    expect(evaluations, 'connectionState/unreadCount are not tick inputs').toBe(1);

    client.__harness.setState({ messages: [buildMessage({ seq: 10 }), buildMessage({ id: 'msg_2', seq: 11 })] });
    await client.__harness.flushMicrotasks();
    expect(ticks.value.size).toBe(2);
    expect(evaluations, 'the message list is a tick input').toBe(2);

    stop();
  });
});
