// Co-located tests for session.ts's pure mapping functions — previously
// untested directly (only reachable indirectly through
// create-chat-client.e2e.test.ts, which never exercised displayName or
// agent.joined/left). Added alongside the v2 wire contract fix: see the T7
// report.
//
// T10 addition: `handledBy` coverage (snapshot mapping, agent.joined/left for
// both AGENT and BOT kinds, and `isHandledByCurrent`'s WAITING_FOR_AGENT
// staleness rule) — see the T10 report for the full ruling.

import { describe, expect, it } from 'vitest';

import type { AgentEventPayload, ParticipantSnapshot, SessionSnapshot } from '../protocol/index.js';
import type { ChatParticipantProfile, ChatSession } from '../state/index.js';
import { applyAgentJoined, applyAgentLeft, isHandledByCurrent, sessionSnapshotToChatSession } from './session.js';

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

describe('sessionSnapshotToChatSession — handledBy', () => {
  it('populates handledBy from snapshot.handledBy, verbatim', () => {
    const session = sessionSnapshotToChatSession(
      snapshot({ handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' } }),
      null,
    );
    expect(session.handledBy).toEqual({ kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' });
  });

  it('populates handledBy for a BOT kind exactly the same way', () => {
    const session = sessionSnapshotToChatSession(
      snapshot({ handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Botty' } }),
      null,
    );
    expect(session.handledBy).toEqual({ kind: 'BOT', id: 'bot_1', displayName: 'Botty' });
  });

  it('stays absent — never null — when the snapshot has no handledBy, even on a fresh connect', () => {
    const session = sessionSnapshotToChatSession(snapshot(), null);
    expect(session.handledBy).toBeUndefined();
    expect('handledBy' in session).toBe(false);
  });

  it('is wholesale-replaced, NOT carried forward from previous, when a fresh snapshot omits it', () => {
    // Unlike assignedAgent/customer, an absent handledBy on a NEW snapshot
    // must read as absent — it must not keep showing a stale previous
    // handler's name (see the doc comment on sessionSnapshotToChatSession).
    const known: ChatSession = {
      id: 'sess_1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      assignedAgent: null,
      customer: null,
      ticket: null,
      handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' },
    };

    const session = sessionSnapshotToChatSession(snapshot(), known);

    expect(session.handledBy).toBeUndefined();
  });

  it('replaces a previously-known handledBy with a fresh one for a different participant', () => {
    const known: ChatSession = {
      id: 'sess_1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      assignedAgent: null,
      customer: null,
      ticket: null,
      handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' },
    };

    const session = sessionSnapshotToChatSession(
      snapshot({ handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Botty' } }),
      known,
    );

    expect(session.handledBy).toEqual({ kind: 'BOT', id: 'bot_1', displayName: 'Botty' });
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

  // T10: handledBy is the broader field — updated for BOTH kinds, unlike assignedAgent.
  it('sets handledBy from a kind:AGENT payload, alongside assignedAgent', () => {
    const payload: AgentEventPayload = { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' };
    const result = applyAgentJoined(baseSession, payload);
    expect(result?.handledBy).toEqual({ kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' });
    expect(result?.assignedAgent).toEqual({ participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null });
  });

  it('sets handledBy from a kind:BOT payload — NOT a no-op, unlike assignedAgent', () => {
    const payload: AgentEventPayload = { kind: 'BOT', id: 'bot_1', displayName: 'Botty' };
    const result = applyAgentJoined(baseSession, payload);
    expect(result?.handledBy).toEqual({ kind: 'BOT', id: 'bot_1', displayName: 'Botty' });
    // The half that IS still a no-op for BOT.
    expect(result?.assignedAgent).toBeNull();
  });

  it('a BOT taking over after an agent updates handledBy without resurrecting assignedAgent', () => {
    const withAgent: ChatSession = {
      ...baseSession,
      assignedAgent: { participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null },
      handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' },
    };
    const payload: AgentEventPayload = { kind: 'BOT', id: 'bot_1', displayName: 'Botty' };
    const result = applyAgentJoined(withAgent, payload);
    expect(result?.handledBy).toEqual({ kind: 'BOT', id: 'bot_1', displayName: 'Botty' });
    expect(result?.assignedAgent).toEqual({ participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null });
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

  // T10: handledBy clears independently of assignedAgent — each keyed by
  // whether the LEAVING id matches THAT field's own current occupant.
  it('clears handledBy (kind:AGENT) when the leaving id matches, alongside assignedAgent', () => {
    const withBoth: ChatSession = { ...sessionWithAgent, handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' } };
    const result = applyAgentLeft(withBoth, AGENT_ID);
    expect(result?.assignedAgent).toBeNull();
    expect(result?.handledBy).toBeUndefined();
    expect(result !== null && 'handledBy' in result).toBe(false);
  });

  it('clears a BOT handledBy on its own agent.left, without ever having touched assignedAgent', () => {
    const botHandled: ChatSession = {
      ...sessionWithAgent,
      assignedAgent: null,
      handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Botty' },
    };
    const result = applyAgentLeft(botHandled, 'bot_1');
    expect(result?.handledBy).toBeUndefined();
    expect(result?.assignedAgent).toBeNull();
  });

  it('leaves handledBy untouched when the leaving id does not match it', () => {
    const withHandledBy: ChatSession = { ...sessionWithAgent, handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' } };
    const result = applyAgentLeft(withHandledBy, 'someone_else');
    expect(result?.handledBy).toEqual({ kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' });
    expect(result?.assignedAgent).toEqual({ participantId: AGENT_ID, displayName: 'Ada', email: null, avatarUrl: null });
  });

  it('returns null when there is no session to apply to', () => {
    expect(applyAgentLeft(null, AGENT_ID)).toBeNull();
  });
});

describe('isHandledByCurrent', () => {
  const base = { status: 'ASSIGNED' as const };

  it('is true when handledBy is present and status is not WAITING_FOR_AGENT', () => {
    expect(isHandledByCurrent({ ...base, handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' } })).toBe(true);
  });

  it('is false when handledBy is absent, regardless of status', () => {
    expect(isHandledByCurrent({ status: 'ASSIGNED' })).toBe(false);
    expect(isHandledByCurrent({ status: 'WAITING_FOR_AGENT' })).toBe(false);
  });

  it('is false when status is WAITING_FOR_AGENT even though handledBy is present — the T6 reactivation-staleness case', () => {
    expect(
      isHandledByCurrent({ status: 'WAITING_FOR_AGENT', handledBy: { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' } }),
    ).toBe(false);
  });

  it('trusts handledBy for every other status, including CLOSED/RESOLVED — not a general lifecycle classifier', () => {
    const handledBy: AgentEventPayload = { kind: 'AGENT', id: AGENT_ID, displayName: 'Ada' };
    expect(isHandledByCurrent({ status: 'OPEN', handledBy })).toBe(true);
    expect(isHandledByCurrent({ status: 'ON_HOLD', handledBy })).toBe(true);
    expect(isHandledByCurrent({ status: 'CLOSED', handledBy })).toBe(true);
    expect(isHandledByCurrent({ status: 'RESOLVED', handledBy })).toBe(true);
  });
});
