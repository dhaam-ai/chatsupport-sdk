// Co-located tests for session.ts's pure mapping functions — previously
// untested directly (only reachable indirectly through
// create-chat-client.e2e.test.ts, which never exercised displayName or
// agent.joined/left). Added alongside the v2 wire contract fix: see the T7
// report.

import { describe, expect, it } from 'vitest';

import type { AgentEventPayload, ParticipantSnapshot, SessionSnapshot } from '../protocol/index.js';
import type { ChatParticipantProfile, ChatSession } from '../state/index.js';
import { applyAgentJoined, applyAgentLeft, sessionSnapshotToChatSession } from './session.js';

const CUSTOMER_ID = 'p_cust_1';
const AGENT_ID = 'p_agent_1';

function participant(overrides: Partial<ParticipantSnapshot> & { participantId: string; type: ParticipantSnapshot['type'] }): ParticipantSnapshot {
  return { ...overrides };
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'sess_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('sessionSnapshotToChatSession — participant display names', () => {
  it('renders the wire displayName when the snapshot carries one, even on a fresh connect (previous = null)', () => {
    const session = sessionSnapshotToChatSession(
      snapshot({ participants: [participant({ participantId: AGENT_ID, type: 'AGENT', displayName: 'Ada' })] }),
      null,
    );
    expect(session.assignedAgent?.displayName).toBe('Ada');
    // The bug this fixes: this must never equal the raw participant id.
    expect(session.assignedAgent?.displayName).not.toBe(AGENT_ID);
  });

  it('falls back to previously-known enrichment, not a raw id, when the new snapshot omits displayName', () => {
    const known: ChatSession = {
      id: 'sess_1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      assignedAgent: { participantId: AGENT_ID, displayName: 'Ada (from agent.joined)', email: null, avatarUrl: null },
      customer: null,
      ticket: null,
    };

    const session = sessionSnapshotToChatSession(
      snapshot({ participants: [participant({ participantId: AGENT_ID, type: 'AGENT' })] }),
      known,
    );

    expect(session.assignedAgent?.displayName).toBe('Ada (from agent.joined)');
    expect(session.assignedAgent?.displayName).not.toBe(AGENT_ID);
  });

  it('falls back to the honest raw-id placeholder only when neither the wire nor known state has a name', () => {
    const session = sessionSnapshotToChatSession(
      snapshot({ participants: [participant({ participantId: CUSTOMER_ID, type: 'CUSTOMER' })] }),
      null,
    );
    // Deliberate, documented placeholder — not the bug. CUSTOMER rows
    // commonly have no resolved displayName at all (domain.ts).
    expect(session.customer?.displayName).toBe(CUSTOMER_ID);
  });

  it('prefers a fresh wire displayName over stale known enrichment for the same participant id', () => {
    const known: ChatSession = {
      id: 'sess_1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      assignedAgent: { participantId: AGENT_ID, displayName: 'Stale Name', email: null, avatarUrl: null },
      customer: null,
      ticket: null,
    };

    const session = sessionSnapshotToChatSession(
      snapshot({ participants: [participant({ participantId: AGENT_ID, type: 'AGENT', displayName: 'Fresh Name' })] }),
      known,
    );

    expect(session.assignedAgent?.displayName).toBe('Fresh Name');
  });
});

describe('applyAgentJoined', () => {
  const baseSession: ChatSession = {
    id: 'sess_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: '2026-08-20T00:00:00.000Z',
    closedAt: null,
    assignedAgent: null,
    customer: null,
    ticket: null,
  };

  it('sets assignedAgent from a kind:AGENT payload using id/displayName', () => {
    const payload: AgentEventPayload = { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' };
    const result = applyAgentJoined(baseSession, payload);
    expect(result?.assignedAgent).toEqual<ChatParticipantProfile>({
      participantId: AGENT_ID,
      displayName: 'Ada',
      email: null,
      avatarUrl: null,
    });
  });

  it('is a no-op for a kind:BOT payload — must not overwrite assignedAgent with a bot identity', () => {
    const withAgent: ChatSession = {
      ...baseSession,
      assignedAgent: { participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null },
    };
    const payload: AgentEventPayload = { kind: 'BOT', id: 'bot_1', displayName: 'Botty' };
    const result = applyAgentJoined(withAgent, payload);
    expect(result?.assignedAgent).toEqual({ participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null });
  });

  it('returns null when there is no session to apply to', () => {
    const payload: AgentEventPayload = { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' };
    expect(applyAgentJoined(null, payload)).toBeNull();
  });
});

describe('applyAgentLeft', () => {
  const sessionWithAgent: ChatSession = {
    id: 'sess_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: '2026-08-20T00:00:00.000Z',
    closedAt: null,
    assignedAgent: { participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null },
    customer: null,
    ticket: null,
  };

  it('clears assignedAgent when the leaving id matches (agent.left.d.id, formerly d.agentId)', () => {
    const result = applyAgentLeft(sessionWithAgent, AGENT_ID);
    expect(result?.assignedAgent).toBeNull();
  });

  it('leaves assignedAgent untouched when the leaving id does not match — covers a BOT kind:"BOT" id too', () => {
    const result = applyAgentLeft(sessionWithAgent, 'bot_1');
    expect(result?.assignedAgent).toEqual({ participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null });
  });
});
