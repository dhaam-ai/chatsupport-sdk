import { describe, expect, it, vi } from 'vitest';
import type { ParticipantSnapshot, SessionSnapshot } from '../protocol/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage } from '../state/index.js';
import type { OutboundIntent } from './intents.js';
import { WatermarkTracker, maxDeliveredWatermark, maxWatermark } from './watermarks.js';

const CUSTOMER = 'customer-1';

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  return {
    sessionId: 'session-1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    ...overrides,
  };
}

function snapshot(participants: ParticipantSnapshot[]): SessionSnapshot {
  return {
    sessionId: 'session-1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

interface Harness {
  readonly store: ChatStore;
  readonly intents: OutboundIntent[];
  readonly tracker: WatermarkTracker;
  setMessages(messages: ChatMessage[]): void;
}

function harness(options: { localParticipantId?: string } = {}): Harness {
  const store = new ChatStore();
  const intents: OutboundIntent[] = [];
  const tracker = new WatermarkTracker({
    store,
    emitIntent: (intent) => intents.push(intent),
    ...options,
  });

  return {
    store,
    intents,
    tracker,
    setMessages(messages) {
      store.setState({ messages });
      tracker.recomputeUnreadCount();
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()));

describe('maxWatermark', () => {
  it('takes an incoming value when there is no current one', () => {
    expect(maxWatermark(undefined, '2024-01-01T00:00:00.000Z')).toBe('2024-01-01T00:00:00.000Z');
  });

  it('advances forward', () => {
    expect(maxWatermark('2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z')).toBe('2024-01-02T00:00:00.000Z');
  });

  it('refuses to move backwards', () => {
    expect(maxWatermark('2024-01-02T00:00:00.000Z', '2024-01-01T00:00:00.000Z')).toBe('2024-01-02T00:00:00.000Z');
  });

  it('keeps the current value on a tie', () => {
    expect(maxWatermark('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')).toBe('2024-01-01T00:00:00.000Z');
  });

  it('compares instants, not strings, across UTC offsets', () => {
    // 12:00+05:00 is 07:00Z — EARLIER than 09:00Z, but lexicographically
    // greater. A string comparison would accept this as an advance.
    const current = '2024-01-01T09:00:00.000Z';
    expect(maxWatermark(current, '2024-01-01T12:00:00.000+05:00')).toBe(current);
  });

  it('accepts an offset timestamp that genuinely is later', () => {
    const incoming = '2024-01-01T18:00:00.000+05:00'; // 13:00Z
    expect(maxWatermark('2024-01-01T09:00:00.000Z', incoming)).toBe(incoming);
  });

  it('treats differing precision for the same instant as no advance', () => {
    const current = '2024-01-01T00:00:00.000Z';
    expect(maxWatermark(current, '2024-01-01T00:00:00Z')).toBe(current);
  });

  it('rejects an unparseable incoming value', () => {
    const current = '2024-01-01T00:00:00.000Z';
    expect(maxWatermark(current, 'not-a-timestamp')).toBe(current);
  });
});

describe('WatermarkTracker — monotonicity', () => {
  it('never moves a watermark backwards on a stale message.read frame', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-02T00:00:00.000Z' });
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-01T00:00:00.000Z' });
    await flush();

    expect(h.store.getState().readWatermarks['agent-1']).toBe('2024-01-02T00:00:00.000Z');
  });

  it('never moves a watermark backwards on a replayed frame (D2 resume replay)', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    const early = { participantId: 'agent-1', readAt: '2024-01-01T00:00:00.000Z' };
    const late = { participantId: 'agent-1', readAt: '2024-01-03T00:00:00.000Z' };

    h.tracker.applyMessageRead(early);
    h.tracker.applyMessageRead(late);
    // Reconnect replays the earlier frame verbatim.
    h.tracker.applyMessageRead(early);
    await flush();

    expect(h.store.getState().readWatermarks['agent-1']).toBe('2024-01-03T00:00:00.000Z');
  });

  it('does not notify subscribers for a stale frame that changes nothing', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-02T00:00:00.000Z' });
    await flush();

    const listener = vi.fn();
    h.store.subscribe(listener);
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-01T00:00:00.000Z' });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not let a stale server snapshot resurrect read messages', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);
    h.tracker.markRead();
    await flush();
    expect(h.store.getState().unreadCount).toBe(0);

    // A reconnect ack the server built before it processed our markRead.
    h.tracker.applySessionSnapshot(
      snapshot([{ participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2023-12-25T00:00:00.000Z' }]),
    );
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-01T00:00:00.000Z');
    expect(h.store.getState().unreadCount).toBe(0);
  });
});

describe('WatermarkTracker — server snapshot is authoritative wholesale (§9.4)', () => {
  it('drops a locally-known participant the snapshot does not mention', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageRead({ participantId: 'agent-departed', readAt: '2024-01-01T00:00:00.000Z' });
    await flush();
    expect(h.store.getState().readWatermarks).toHaveProperty('agent-departed');

    h.tracker.applySessionSnapshot(
      snapshot([{ participantId: 'agent-fresh', type: 'AGENT', lastReadAt: '2024-01-02T00:00:00.000Z' }]),
    );
    await flush();

    // Wholesale replacement, not a merge: the departed participant is gone,
    // not retained alongside the snapshot's entries.
    expect(h.store.getState().readWatermarks).toEqual({ 'agent-fresh': '2024-01-02T00:00:00.000Z' });
  });

  it('clears every watermark when the snapshot carries no read participants', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-01T00:00:00.000Z' });
    await flush();

    h.tracker.applySessionSnapshot(snapshot([{ participantId: 'agent-2', type: 'AGENT' }]));
    await flush();

    expect(h.store.getState().readWatermarks).toEqual({});
  });

  it('omits participants the snapshot lists without a lastReadAt', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
        { participantId: 'agent-2', type: 'AGENT' },
      ]),
    );
    await flush();

    expect(h.store.getState().readWatermarks).toEqual({ 'agent-1': '2024-01-01T00:00:00.000Z' });
  });

  it('advances a surviving participant to the snapshot value when it is newer', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-01T00:00:00.000Z' });
    h.tracker.applySessionSnapshot(
      snapshot([{ participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-05T00:00:00.000Z' }]),
    );
    await flush();

    expect(h.store.getState().readWatermarks['agent-1']).toBe('2024-01-05T00:00:00.000Z');
  });

  it('adopts the single CUSTOMER participant as the local participant', () => {
    const h = harness();
    expect(h.tracker.localParticipantId).toBeNull();

    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: 'agent-1', type: 'AGENT' },
        { participantId: CUSTOMER, type: 'CUSTOMER' },
      ]),
    );

    expect(h.tracker.localParticipantId).toBe(CUSTOMER);
  });

  it('does not override an explicitly configured local participant', () => {
    const h = harness({ localParticipantId: 'configured' });
    h.tracker.applySessionSnapshot(snapshot([{ participantId: CUSTOMER, type: 'CUSTOMER' }]));

    expect(h.tracker.localParticipantId).toBe('configured');
  });

  it('refuses to guess when a snapshot somehow carries two customers', () => {
    const h = harness();
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: 'customer-a', type: 'CUSTOMER' },
        { participantId: 'customer-b', type: 'CUSTOMER' },
      ]),
    );

    expect(h.tracker.localParticipantId).toBeNull();
  });
});

describe('WatermarkTracker — markRead', () => {
  it('advances the local watermark and emits exactly one intent', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);

    expect(h.tracker.markRead()).toBe(true);
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-02T00:00:00.000Z');
    expect(h.intents).toEqual([{ t: 'message.markRead', d: {} }]);
  });

  it('flushes ONE watermark update after an offline gap of many messages (§9.5)', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    const backlog = Array.from({ length: 200 }, (_, i) =>
      message({ id: `m${i}`, createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString() }),
    );
    h.setMessages(backlog);
    await flush();
    expect(h.store.getState().unreadCount).toBe(200);

    h.tracker.markRead();
    await flush();

    // Not 200 markRead frames — one.
    expect(h.intents).toHaveLength(1);
    expect(h.store.getState().unreadCount).toBe(0);
    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe(backlog[199]?.createdAt);
  });

  it('is silent when already read up to the latest message', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);

    expect(h.tracker.markRead()).toBe(true);
    expect(h.tracker.markRead()).toBe(false);
    expect(h.tracker.markRead()).toBe(false);
    await flush();

    expect(h.intents).toHaveLength(1);
  });

  it('marks read up to a specific message, leaving newer ones unread', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
      message({ id: 'm3', createdAt: '2024-01-03T00:00:00.000Z' }),
    ]);

    expect(h.tracker.markRead('m2')).toBe(true);
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-02T00:00:00.000Z');
    expect(h.store.getState().unreadCount).toBe(1);
    expect(h.intents).toEqual([{ t: 'message.markRead', d: { upToMessageId: 'm2' } }]);
  });

  it('omits upToMessageId entirely for read-up-to-latest (exactOptionalPropertyTypes)', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);
    h.tracker.markRead();

    expect('upToMessageId' in (h.intents[0]?.d ?? {})).toBe(false);
  });

  it('refuses to move backwards when marking read to an older message', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);

    h.tracker.markRead('m2');
    expect(h.tracker.markRead('m1')).toBe(false);
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-02T00:00:00.000Z');
    expect(h.intents).toHaveLength(1);
  });

  it('anchors read-to-latest on the newest message, not the last array element', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    // Newest is in the middle — e.g. an optimistic send appended after a
    // backfilled older message.
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm3', createdAt: '2024-01-03T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);

    h.tracker.markRead();
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-03T00:00:00.000Z');
    expect(h.store.getState().unreadCount).toBe(0);
  });

  it('does nothing when there are no messages', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    expect(h.tracker.markRead()).toBe(false);
    expect(h.intents).toEqual([]);
  });

  it('does nothing for an unknown message id', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);

    expect(h.tracker.markRead('nope')).toBe(false);
    expect(h.intents).toEqual([]);
  });

  it('does nothing while the local participant is unknown', () => {
    const h = harness();
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);

    expect(h.tracker.markRead()).toBe(false);
    expect(h.intents).toEqual([]);
  });
});

describe('WatermarkTracker — unreadCount', () => {
  it('counts every inbound message when nothing has been read', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    await flush();

    expect(h.store.getState().unreadCount).toBe(2);
  });

  it('excludes the local participant’s own messages', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', senderId: CUSTOMER, senderType: 'CUSTOMER' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    await flush();

    expect(h.store.getState().unreadCount).toBe(1);
  });

  it('falls back to sender type while the local participant is unknown', async () => {
    const h = harness();
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', senderId: 'whoever', senderType: 'CUSTOMER' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    await flush();

    expect(h.store.getState().unreadCount).toBe(1);
  });

  it('drops to zero after marking read, and tracks each subsequent advance', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
      message({ id: 'm3', createdAt: '2024-01-03T00:00:00.000Z' }),
      message({ id: 'm4', createdAt: '2024-01-04T00:00:00.000Z' }),
    ]);
    await flush();
    expect(h.store.getState().unreadCount).toBe(4);

    h.tracker.markRead('m1');
    await flush();
    expect(h.store.getState().unreadCount).toBe(3);

    h.tracker.markRead('m3');
    await flush();
    expect(h.store.getState().unreadCount).toBe(1);

    h.tracker.markRead();
    await flush();
    expect(h.store.getState().unreadCount).toBe(0);
  });

  it('counts a message created exactly at the watermark as read', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);
    h.tracker.applyMessageRead({ participantId: CUSTOMER, readAt: '2024-01-01T00:00:00.000Z' });
    await flush();

    expect(h.store.getState().unreadCount).toBe(0);
  });

  it('rises again as new messages arrive past the watermark', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);
    h.tracker.markRead();
    await flush();
    expect(h.store.getState().unreadCount).toBe(0);

    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    await flush();

    expect(h.store.getState().unreadCount).toBe(1);
  });

  it('recomputes against the server watermark from a snapshot', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' }),
      message({ id: 'm2', createdAt: '2024-01-02T00:00:00.000Z' }),
      message({ id: 'm3', createdAt: '2024-01-03T00:00:00.000Z' }),
    ]);
    await flush();
    expect(h.store.getState().unreadCount).toBe(3);

    // Read on another device — the server tells us about it.
    h.tracker.applySessionSnapshot(
      snapshot([{ participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2024-01-02T00:00:00.000Z' }]),
    );
    await flush();

    expect(h.store.getState().unreadCount).toBe(1);
  });
});

describe('WatermarkTracker — max across agents (§12.9)', () => {
  it('takes the furthest-advanced agent watermark', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2024-06-01T00:00:00.000Z' },
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
        { participantId: 'agent-2', type: 'AGENT', lastReadAt: '2024-01-03T00:00:00.000Z' },
        { participantId: 'agent-3', type: 'AGENT', lastReadAt: '2024-01-02T00:00:00.000Z' },
      ]),
    );

    expect(h.tracker.getAgentReadWatermark()).toBe('2024-01-03T00:00:00.000Z');
  });

  it('ignores customer and bot participants when deriving the agent watermark', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2025-01-01T00:00:00.000Z' },
        { participantId: 'bot-1', type: 'BOT', lastReadAt: '2025-01-01T00:00:00.000Z' },
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
      ]),
    );

    expect(h.tracker.getAgentReadWatermark()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns null when no agent has read anything', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2024-01-01T00:00:00.000Z' },
        { participantId: 'agent-1', type: 'AGENT' },
      ]),
    );

    expect(h.tracker.getAgentReadWatermark()).toBeNull();
  });

  it('tracks a live message.read push from one of several agents', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
        { participantId: 'agent-2', type: 'AGENT', lastReadAt: '2024-01-02T00:00:00.000Z' },
      ]),
    );
    h.tracker.applyMessageRead({ participantId: 'agent-1', readAt: '2024-01-09T00:00:00.000Z' });

    expect(h.tracker.getAgentReadWatermark()).toBe('2024-01-09T00:00:00.000Z');
  });

  it('answers "has an agent read this" inclusively at the watermark', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
        { participantId: 'agent-2', type: 'AGENT', lastReadAt: '2024-01-03T00:00:00.000Z' },
      ]),
    );

    expect(h.tracker.hasAgentRead('2024-01-02T00:00:00.000Z')).toBe(true);
    expect(h.tracker.hasAgentRead('2024-01-03T00:00:00.000Z')).toBe(true);
    expect(h.tracker.hasAgentRead('2024-01-04T00:00:00.000Z')).toBe(false);
  });

  it('reports nothing read when there are no agent watermarks at all', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    expect(h.tracker.hasAgentRead('2024-01-01T00:00:00.000Z')).toBe(false);
  });

  it('forgets agent types when a snapshot no longer lists them', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applySessionSnapshot(
      snapshot([{ participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' }]),
    );
    expect(h.tracker.getAgentReadWatermark()).toBe('2024-01-01T00:00:00.000Z');

    h.tracker.applySessionSnapshot(snapshot([{ participantId: CUSTOMER, type: 'CUSTOMER' }]));
    expect(h.tracker.getAgentReadWatermark()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Delivery watermarks. Same model as read watermarks, keyed on `seq` (D2)
// instead of an instant — so every monotonicity check below compares numbers,
// and none of them can be satisfied by a timestamp.
// ---------------------------------------------------------------------------

describe('maxDeliveredWatermark', () => {
  it('takes an incoming value when there is no current one', () => {
    expect(maxDeliveredWatermark(undefined, 5)).toBe(5);
  });

  it('advances forward', () => {
    expect(maxDeliveredWatermark(5, 9)).toBe(9);
  });

  it('refuses to move backwards', () => {
    expect(maxDeliveredWatermark(9, 5)).toBe(9);
  });

  it('returns the current value unchanged on a tie, so callers can detect no-change with !==', () => {
    expect(maxDeliveredWatermark(9, 9)).toBe(9);
  });

  it('accepts seq 0 — a falsy but entirely valid ordering key', () => {
    expect(maxDeliveredWatermark(undefined, 0)).toBe(0);
    expect(maxDeliveredWatermark(0, 1)).toBe(1);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a fraction', 2.5],
  ])('rejects %s in favour of the current value', (_label, next) => {
    expect(maxDeliveredWatermark(4, next)).toBe(4);
    expect(maxDeliveredWatermark(undefined, next)).toBeUndefined();
  });
});

describe('WatermarkTracker — inbound message.delivered', () => {
  it('records a participant’s watermark', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({
      participantId: 'agent-1',
      deliveredUpToSeq: 7,
      deliveredAt: '2024-01-01T00:00:00.000Z',
    });

    expect(h.store.getState().deliveredWatermarks['agent-1']).toBe(7);
  });

  it('refuses a replayed frame carrying a lower seq', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 9, deliveredAt: '2024-01-02T00:00:00.000Z' });
    // Replayed after `resumeFrom` (D2) — older seq, NEWER timestamp. A
    // timestamp comparison would accept this and walk the watermark back.
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 4, deliveredAt: '2024-01-03T00:00:00.000Z' });

    expect(h.store.getState().deliveredWatermarks['agent-1']).toBe(9);
  });

  it('writes nothing at all when the value does not change', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 9, deliveredAt: '2024-01-02T00:00:00.000Z' });
    const before = h.store.getState().deliveredWatermarks;

    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 9, deliveredAt: '2024-01-02T00:00:00.000Z' });

    // Same reference: a redundant push must not wake every binding.
    expect(h.store.getState().deliveredWatermarks).toBe(before);
  });

  it('tracks each participant independently', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 3, deliveredAt: '2024-01-01T00:00:00.000Z' });
    h.tracker.applyMessageDelivered({ participantId: 'agent-2', deliveredUpToSeq: 8, deliveredAt: '2024-01-01T00:00:00.000Z' });

    expect(h.store.getState().deliveredWatermarks).toEqual({ 'agent-1': 3, 'agent-2': 8 });
  });

  it('does not touch unreadCount — delivery is not read state', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 1 })]);
    const before = h.store.getState().unreadCount;

    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 1, deliveredAt: '2024-01-02T00:00:00.000Z' });

    expect(before).toBe(1);
    expect(h.store.getState().unreadCount).toBe(1);
  });
});

describe('WatermarkTracker.markDelivered', () => {
  it('reports the highest seq the client holds and emits exactly one intent', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 4 }),
      message({ id: 'm2', createdAt: '2024-01-01T00:00:01.000Z', seq: 9 }),
    ]);

    expect(h.tracker.markDelivered()).toBe(true);
    expect(h.intents).toEqual([{ t: 'message.markDelivered', d: { upToSeq: 9 } }]);
    expect(h.store.getState().deliveredWatermarks[CUSTOMER]).toBe(9);
  });

  it('takes the MAXIMUM seq, not the last element’s', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    // Deliberately out of order in the array, and with an unconfirmed message
    // (no seq) trailing — the shape an optimistic send produces.
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 12 }),
      message({ id: 'm2', createdAt: '2024-01-01T00:00:01.000Z', seq: 3 }),
      message({ id: 'm3', createdAt: '2024-01-01T00:00:02.000Z' }),
    ]);

    h.tracker.markDelivered();

    expect(h.intents).toEqual([{ t: 'message.markDelivered', d: { upToSeq: 12 } }]);
  });

  it('includes our own acked messages — a watermark is one contiguous range', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([
      message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 2 }),
      message({ id: 'm2', createdAt: '2024-01-01T00:00:01.000Z', senderId: CUSTOMER, senderType: 'CUSTOMER', seq: 5 }),
    ]);

    h.tracker.markDelivered();

    expect(h.intents).toEqual([{ t: 'message.markDelivered', d: { upToSeq: 5 } }]);
  });

  it('accepts an explicit seq from a caller that knows what became visible', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 20 })]);

    expect(h.tracker.markDelivered(4)).toBe(true);
    expect(h.intents).toEqual([{ t: 'message.markDelivered', d: { upToSeq: 4 } }]);
  });

  it('collapses a burst into one frame — the second call is silent', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 9 })]);

    expect(h.tracker.markDelivered()).toBe(true);
    expect(h.tracker.markDelivered()).toBe(false);
    expect(h.intents).toHaveLength(1);
  });

  it('never walks its own watermark backwards', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 9 })]);
    h.tracker.markDelivered();

    expect(h.tracker.markDelivered(2)).toBe(false);
    expect(h.intents).toHaveLength(1);
    expect(h.store.getState().deliveredWatermarks[CUSTOMER]).toBe(9);
  });

  it('is a no-op when nothing with a seq has arrived yet', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z' })]);

    expect(h.tracker.markDelivered()).toBe(false);
    expect(h.intents).toHaveLength(0);
    expect(h.store.getState().deliveredWatermarks).toEqual({});
  });

  it('is a no-op when the local participant is unknown', () => {
    const h = harness();
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 9 })]);

    expect(h.tracker.markDelivered()).toBe(false);
    expect(h.intents).toHaveLength(0);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a fraction', 1.5],
  ])('refuses a caller-supplied %s rather than poisoning the watermark', (_label, seq) => {
    const h = harness({ localParticipantId: CUSTOMER });

    expect(h.tracker.markDelivered(seq)).toBe(false);
    expect(h.intents).toHaveLength(0);
    expect(h.store.getState().deliveredWatermarks).toEqual({});
  });

  it('commits state before emitting, so a throwing sink cannot lose the advance', () => {
    const store = new ChatStore();
    const tracker = new WatermarkTracker({
      store,
      emitIntent: () => {
        throw new Error('socket exploded');
      },
      localParticipantId: CUSTOMER,
    });
    store.setState({ messages: [message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 6 })] });

    expect(() => tracker.markDelivered()).toThrow('socket exploded');
    expect(store.getState().deliveredWatermarks[CUSTOMER]).toBe(6);
  });

  it('notifies subscribers once for the advance', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.setMessages([message({ id: 'm1', createdAt: '2024-01-01T00:00:00.000Z', seq: 6 })]);
    await flush();

    const listener = vi.fn();
    h.store.subscribe(listener);
    h.tracker.markDelivered();
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].deliveredWatermarks).toEqual({ [CUSTOMER]: 6 });
  });
});

describe('WatermarkTracker — delivery watermarks against a session snapshot', () => {
  it('drops a participant the snapshot no longer lists', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 5, deliveredAt: '2024-01-01T00:00:00.000Z' });
    h.tracker.applyMessageDelivered({ participantId: 'agent-2', deliveredUpToSeq: 8, deliveredAt: '2024-01-01T00:00:00.000Z' });

    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER' },
        { participantId: 'agent-2', type: 'AGENT' },
      ]),
    );

    expect(h.store.getState().deliveredWatermarks).toEqual({ 'agent-2': 8 });
  });

  it('keeps surviving participants’ values — a snapshot carries no delivery data to reconcile against', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 5, deliveredAt: '2024-01-01T00:00:00.000Z' });

    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER' },
        { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-01T00:00:00.000Z' },
      ]),
    );

    expect(h.store.getState().deliveredWatermarks['agent-1']).toBe(5);
  });

  it('leaves the record reference untouched when the snapshot changes nothing', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.tracker.applyMessageDelivered({ participantId: 'agent-1', deliveredUpToSeq: 5, deliveredAt: '2024-01-01T00:00:00.000Z' });
    const before = h.store.getState().deliveredWatermarks;

    h.tracker.applySessionSnapshot(
      snapshot([
        { participantId: CUSTOMER, type: 'CUSTOMER' },
        { participantId: 'agent-1', type: 'AGENT' },
      ]),
    );

    expect(h.store.getState().deliveredWatermarks).toBe(before);
  });
});
