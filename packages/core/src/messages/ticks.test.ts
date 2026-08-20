// The tick derivation is the one place four bindings agree, so these tests
// are written as the conformance table T17 will extend: one row per condition
// in the §6.4 amendment's table, plus the four cases that deliberately have
// no tick at all.

import { describe, expect, it } from 'vitest';

import { createInitialChatState } from '../state/index.js';
import type { ChatMessage } from '../state/index.js';
import { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState } from './ticks.js';
import type { MessageTickState, TickInput } from './ticks.js';

const ME = 'customer-1';
const AGENT = 'agent-1';
const OTHER_AGENT = 'agent-2';

const CREATED_AT = '2024-01-01T00:00:10.000Z';
const BEFORE = '2024-01-01T00:00:09.000Z';
const AFTER = '2024-01-01T00:00:11.000Z';

function mine(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    sessionId: 'session-1',
    senderId: ME,
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function tick(message: ChatMessage, overrides: Partial<Omit<TickInput, 'message'>> = {}): MessageTickState | null {
  return deriveTickState({
    message,
    localParticipantId: ME,
    deliveredWatermarks: {},
    readWatermarks: {},
    ...overrides,
  });
}

describe('MESSAGE_TICK_STATES', () => {
  it('lists the four states weakest-first', () => {
    expect([...MESSAGE_TICK_STATES]).toEqual(['pending', 'sent', 'delivered', 'read']);
  });
});

describe('deriveTickState — the four states', () => {
  it('pending: queued, not yet acked', () => {
    expect(tick(mine({ delivery: { state: 'queued' } }))).toBe('pending');
  });

  it('sent: has a seq, and nobody’s watermark reaches it', () => {
    expect(tick(mine({ seq: 5 }))).toBe('sent');
  });

  it('delivered: another participant’s watermark reaches the seq', () => {
    expect(tick(mine({ seq: 5 }), { deliveredWatermarks: { [AGENT]: 5 } })).toBe('delivered');
  });

  it('delivered: a watermark past the seq counts too', () => {
    expect(tick(mine({ seq: 5 }), { deliveredWatermarks: { [AGENT]: 99 } })).toBe('delivered');
  });

  it('read: another participant’s read watermark covers createdAt', () => {
    expect(tick(mine({ seq: 5 }), { readWatermarks: { [AGENT]: AFTER } })).toBe('read');
  });

  it('read: a watermark exactly at createdAt counts — the watermark is inclusive', () => {
    expect(tick(mine({ seq: 5 }), { readWatermarks: { [AGENT]: CREATED_AT } })).toBe('read');
  });

  it('read outranks delivered when both are satisfied', () => {
    expect(
      tick(mine({ seq: 5 }), {
        deliveredWatermarks: { [AGENT]: 5 },
        readWatermarks: { [AGENT]: AFTER },
      }),
    ).toBe('read');
  });
});

describe('deriveTickState — the boundaries each state stops at', () => {
  it('stays sent when the delivered watermark is one short of the seq', () => {
    expect(tick(mine({ seq: 5 }), { deliveredWatermarks: { [AGENT]: 4 } })).toBe('sent');
  });

  it('stays sent when the read watermark predates createdAt', () => {
    expect(tick(mine({ seq: 5 }), { readWatermarks: { [AGENT]: BEFORE } })).toBe('sent');
  });

  it('reports delivered when ANY other participant has it, not all', () => {
    expect(
      tick(mine({ seq: 5 }), { deliveredWatermarks: { [AGENT]: 1, [OTHER_AGENT]: 7 } }),
    ).toBe('delivered');
  });

  it('reports read when ANY other participant has read it', () => {
    expect(
      tick(mine({ seq: 5 }), { readWatermarks: { [AGENT]: BEFORE, [OTHER_AGENT]: AFTER } }),
    ).toBe('read');
  });

  it('handles seq 0 — a falsy but valid ordering key', () => {
    expect(tick(mine({ seq: 0 }))).toBe('sent');
    expect(tick(mine({ seq: 0 }), { deliveredWatermarks: { [AGENT]: 0 } })).toBe('delivered');
  });
});

describe('deriveTickState — our own watermarks never tick our own message', () => {
  // This is the bug the `participantId === localParticipantId` skip exists to
  // prevent: core advances OUR delivery watermark the moment markDelivered()
  // runs, so counting it would tick every outgoing message `delivered`
  // against nothing but our own receipt.
  it('ignores the local participant’s delivery watermark', () => {
    expect(tick(mine({ seq: 5 }), { deliveredWatermarks: { [ME]: 99 } })).toBe('sent');
  });

  it('ignores the local participant’s read watermark', () => {
    expect(tick(mine({ seq: 5 }), { readWatermarks: { [ME]: AFTER } })).toBe('sent');
  });

  it('still finds another participant alongside our own entry', () => {
    expect(
      tick(mine({ seq: 5 }), { deliveredWatermarks: { [ME]: 99, [AGENT]: 5 } }),
    ).toBe('delivered');
  });
});

describe('deriveTickState — the four no-tick cases', () => {
  it('someone else’s message has no tick', () => {
    const theirs = mine({ senderId: AGENT, senderType: 'AGENT', seq: 5 });
    expect(tick(theirs, { deliveredWatermarks: { [ME]: 5 } })).toBeNull();
  });

  it('an unknown local participant yields no tick, never a guessed one', () => {
    expect(
      deriveTickState({
        message: mine({ seq: 5 }),
        localParticipantId: null,
        deliveredWatermarks: { [AGENT]: 99 },
        readWatermarks: { [AGENT]: AFTER },
      }),
    ).toBeNull();
  });

  it('a permanently failed send has no tick — §6.4’s delivery.reason is the affordance', () => {
    expect(tick(mine({ delivery: { state: 'failed', reason: 'expired', retryable: true } }))).toBeNull();
  });

  it('an acked message that never got a seq has no tick — no key to compare against', () => {
    expect(tick(mine(), { deliveredWatermarks: { [AGENT]: 99 } })).toBeNull();
  });
});

describe('deriveTickState — malformed timestamps under-report rather than over-report', () => {
  it('ignores an unparseable read watermark', () => {
    expect(tick(mine({ seq: 5 }), { readWatermarks: { [AGENT]: 'not a date' } })).toBe('sent');
  });

  it('ignores an unparseable createdAt', () => {
    expect(
      tick(mine({ seq: 5, createdAt: 'not a date' }), { readWatermarks: { [AGENT]: AFTER } }),
    ).toBe('sent');
  });

  it('compares instants, not strings — a +hh:mm offset sorts differently as text', () => {
    // '2024-01-01T12:00:00+05:00' is 07:00Z: EARLIER than the 09:00Z message,
    // but lexicographically greater. A string comparison reports `read`.
    expect(
      tick(mine({ seq: 5, createdAt: '2024-01-01T09:00:00.000Z' }), {
        readWatermarks: { [AGENT]: '2024-01-01T12:00:00+05:00' },
      }),
    ).toBe('sent');
  });
});

describe('deriveTickState — purity', () => {
  it('does not mutate its inputs', () => {
    const message = mine({ seq: 5 });
    const delivered = { [AGENT]: 5 };
    const read = { [AGENT]: AFTER };
    const snapshot = JSON.stringify({ message, delivered, read });

    deriveTickState({ message, localParticipantId: ME, deliveredWatermarks: delivered, readWatermarks: read });

    expect(JSON.stringify({ message, delivered, read })).toBe(snapshot);
  });

  it('returns the same answer for the same inputs', () => {
    const input: TickInput = {
      message: mine({ seq: 5 }),
      localParticipantId: ME,
      deliveredWatermarks: { [AGENT]: 5 },
      readWatermarks: {},
    };

    expect(deriveTickState(input)).toBe(deriveTickState(input));
  });
});

describe('deriveTickStateFromState', () => {
  it('reads both watermark maps straight off a ChatState', () => {
    const state = {
      ...createInitialChatState(),
      deliveredWatermarks: { [AGENT]: 5 },
    };

    expect(deriveTickStateFromState(state, mine({ seq: 5 }), ME)).toBe('delivered');
  });

  it('agrees with deriveTickState on the initial state', () => {
    const state = createInitialChatState();
    const message = mine({ seq: 5 });

    expect(deriveTickStateFromState(state, message, ME)).toBe(
      deriveTickState({
        message,
        localParticipantId: ME,
        deliveredWatermarks: state.deliveredWatermarks,
        readWatermarks: state.readWatermarks,
      }),
    );
  });
});
