// Minimal, deliberately-boring fixture builders — every field a check needs
// filled with an obviously-fake but well-formed value, so a check's
// `overrides` calls read as "what's different about this case" rather than
// re-stating the whole shape (DAMP over DRY in tests — see the
// test-driven-development skill).

import type { ChatMessage, ChatSession } from '@dhaam-ccrm/core';

let counter = 0;

/** A monotonically-increasing suffix so repeated calls in one check produce distinct, order-visible ids without every call site inventing one. */
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: nextId('msg'),
    sessionId: 'session_1',
    senderId: 'participant_customer',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function buildSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session_1',
    status: 'OPEN',
    mode: 'HUMAN',
    createdAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    assignedAgent: null,
    customer: null,
    ticket: null,
    ...overrides,
  };
}

/** Resets the shared id counter — call between independent checks that assert on literal ids, so test order never changes their expected values. */
export function resetBuilderIds(): void {
  counter = 0;
}
