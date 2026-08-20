// Invariant #4 — Event delivery (task brief, item 4):
//   "Every §6.5 event reaches a handler with correctly typed payload;
//    unsubscribing one handler does not disturb others."

import { CHAT_EVENT_NAMES } from '@dhaam-ccrm/core';
import type { ChatEventMap, ChatEventName } from '@dhaam-ccrm/core';
import { expect } from 'vitest';

import { createConformanceChatClient } from '../harness/conformance-client.js';
import type { ConformanceCheck } from './check.js';

/**
 * One well-formed payload per §6.5 event — literal, not derived from
 * `buildMessage`/`buildSession`, so a check comparing against this table
 * is comparing against an independent hand-written value, not the same
 * object the harness happens to reuse elsewhere.
 */
const SAMPLE_PAYLOADS: { [E in ChatEventName]: ChatEventMap[E] } = {
  connected: {
    session: {
      id: 'session_1',
      status: 'OPEN',
      mode: 'HUMAN',
      createdAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      assignedAgent: null,
      customer: null,
      ticket: null,
    },
  },
  reconnecting: { attempt: 2, delayMs: 850 },
  suspended: { reason: 'maxAttempts' },
  disconnected: { reason: 'transport closed' },
  message: {
    id: 'msg_evt_1',
    sessionId: 'session_1',
    senderId: 'participant_customer',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hi',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  messageAck: { id: 'msg_evt_1', seq: 42 },
  sendFailed: { id: 'msg_evt_2', sessionId: 'session_1', reason: 'rejected', retryable: false },
  typing: { isTyping: true, participantId: 'participant_agent' },
  agentJoined: { kind: 'AGENT', id: 'agent_1', displayName: 'Jamie' },
  agentLeft: { kind: 'AGENT', id: 'agent_1', displayName: 'Jamie' },
  statusChange: { status: 'ASSIGNED', mode: 'HUMAN' },
  sessionClosed: { closeReason: 'RESOLVED' },
  presenceUpdate: { participantId: 'participant_agent', status: 'ONLINE' },
  ticketLinked: { ticketId: 'ticket_1', ticketUrl: 'https://example.test/tickets/1' },
  tokenRefreshed: {},
  error: { source: 'transport', code: null, message: 'synthetic', retryable: true },
};

export const EVENT_DELIVERY_CHECKS: ConformanceCheck[] = [
  {
    id: 'event-delivery-every-catalog-event-reaches-a-handler',
    description: 'every §6.5 event reaches a mounted handler with the exact payload',
    async run(adapter) {
      const client = createConformanceChatClient();
      const handle = adapter.mount(client);
      try {
        for (const event of CHAT_EVENT_NAMES) {
          const view = handle.observeEvent(event);
          const payload = SAMPLE_PAYLOADS[event];

          client.__harness.emit(event, payload);
          await handle.settle();

          expect(view.received(), `handler for '${event}'`).toEqual([payload]);
          view.dispose();
        }
      } finally {
        handle.unmount();
      }
    },
  },

  {
    id: 'event-delivery-unsubscribing-one-does-not-disturb-others',
    description: 'disposing one event handler leaves a sibling handler for the same event receiving',
    async run(adapter) {
      const client = createConformanceChatClient();
      const handle = adapter.mount(client);
      try {
        const first = handle.observeEvent('typing');
        const second = handle.observeEvent('typing');

        const payloadA: ChatEventMap['typing'] = { isTyping: true, participantId: 'p1' };
        client.__harness.emit('typing', payloadA);
        await handle.settle();
        expect(first.received()).toEqual([payloadA]);
        expect(second.received()).toEqual([payloadA]);

        first.dispose();

        const payloadB: ChatEventMap['typing'] = { isTyping: false, participantId: 'p1' };
        client.__harness.emit('typing', payloadB);
        await handle.settle();

        expect(first.received(), 'disposed handler must not have received the second event').toEqual([payloadA]);
        expect(second.received(), 'the still-mounted sibling must have received both events').toEqual([payloadA, payloadB]);
      } finally {
        handle.unmount();
      }
    },
  },
];
