import { describe, expect, it } from 'vitest';
import type { ServerPushFrame, SessionSnapshot } from '../protocol/index.js';
import { SERVER_PUSH_FRAME_TYPES } from '../protocol/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage } from '../state/index.js';
import { PresenceCoordinator } from './controller.js';
import type { OutboundIntent } from './intents.js';
import { ManualTimers } from './manual-timers.js';
import { DEFAULT_REMOTE_TYPING_TIMEOUT_MS } from './typing.js';

const CUSTOMER = 'customer-1';

/** Wraps a payload in the §7.2 envelope so `handleFrame` sees a real frame. */
function frame<T extends ServerPushFrame['t']>(
  t: T,
  d: Extract<ServerPushFrame, { t: T }>['d'],
): ServerPushFrame {
  return { v: 1, t, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ts: 1_700_000_000_000, d } as ServerPushFrame;
}

function sessionSnapshot(): SessionSnapshot {
  return {
    sessionId: 'session-1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants: [
      { participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2024-01-01T00:00:00.000Z' },
      { participantId: 'agent-1', type: 'AGENT', lastReadAt: '2024-01-02T00:00:00.000Z' },
      { participantId: 'agent-2', type: 'AGENT', lastReadAt: '2024-01-04T00:00:00.000Z' },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function message(id: string, createdAt: string): ChatMessage {
  return {
    id,
    sessionId: 'session-1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    createdAt,
  };
}

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly intents: OutboundIntent[];
  readonly coordinator: PresenceCoordinator;
}

function harness(options: { localParticipantId?: string } = {}): Harness {
  const store = new ChatStore();
  const timers = new ManualTimers();
  const intents: OutboundIntent[] = [];
  const coordinator = new PresenceCoordinator({
    store,
    emitIntent: (intent) => intents.push(intent),
    schedule: timers.schedule,
    clock: timers.clock,
    ...options,
  });

  return { store, timers, intents, coordinator };
}

const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()));

describe('PresenceCoordinator — frame dispatch', () => {
  it('routes typing.start and typing.stop to the typing controller', async () => {
    const h = harness();

    expect(h.coordinator.handleFrame(frame('typing.start', { participantId: 'agent-1' }))).toBe(true);
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-1' });

    h.coordinator.handleFrame(frame('typing.stop', { participantId: 'agent-1' }));
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });

  it('routes presence.update to the registry', () => {
    const h = harness();

    expect(h.coordinator.handleFrame(frame('presence.update', { participantId: 'agent-1', status: 'AWAY' }))).toBe(
      true,
    );
    expect(h.coordinator.presence.statusOf('agent-1')).toBe('AWAY');
  });

  it('routes message.read to the watermark tracker', async () => {
    const h = harness({ localParticipantId: CUSTOMER });

    expect(
      h.coordinator.handleFrame(frame('message.read', { participantId: 'agent-1', readAt: '2024-01-05T00:00:00.000Z' })),
    ).toBe(true);
    await flush();

    expect(h.store.getState().readWatermarks['agent-1']).toBe('2024-01-05T00:00:00.000Z');
  });

  it('applies the session snapshot from connection.ack', async () => {
    const h = harness();

    expect(
      h.coordinator.handleFrame(frame('connection.ack', { protocolVersion: 1, session: sessionSnapshot(), seq: 42 })),
    ).toBe(true);
    await flush();

    expect(h.store.getState().readWatermarks).toEqual({
      [CUSTOMER]: '2024-01-01T00:00:00.000Z',
      'agent-1': '2024-01-02T00:00:00.000Z',
      'agent-2': '2024-01-04T00:00:00.000Z',
    });
  });

  it('applies the session snapshot from session.updated identically (§9.4)', async () => {
    const h = harness();
    h.coordinator.handleFrame(frame('session.updated', { session: sessionSnapshot() }));
    await flush();

    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe('2024-01-01T00:00:00.000Z');
    expect(h.coordinator.watermarks.getAgentReadWatermark()).toBe('2024-01-04T00:00:00.000Z');
  });

  it('returns false for every push frame it does not own', () => {
    const h = harness();
    const owned = new Set([
      'typing.start',
      'typing.stop',
      'presence.update',
      'message.read',
      'message.delivered',
      'connection.ack',
      'session.updated',
    ]);

    for (const type of SERVER_PUSH_FRAME_TYPES) {
      if (owned.has(type)) continue;
      // Payload shape is irrelevant — an unowned type must not be inspected.
      expect(h.coordinator.handleFrame({ v: 1, t: type, id: 'x', ts: 0, d: {} } as ServerPushFrame)).toBe(false);
    }
  });

  it('does not walk connection.ack replay — the connection layer re-dispatches it', async () => {
    const h = harness();
    const replayed = frame('typing.start', { participantId: 'agent-9' });

    h.coordinator.handleFrame(
      frame('connection.ack', {
        protocolVersion: 1,
        session: sessionSnapshot(),
        seq: 42,
        replay: [replayed],
      }),
    );
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });

    // ...and it applies normally once T8 feeds it back through.
    h.coordinator.handleFrame(replayed);
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-9' });
  });
});

describe('PresenceCoordinator — cross-cutting local participant', () => {
  it('adopts the local participant from a snapshot and filters our own typing echo', async () => {
    const h = harness();
    h.coordinator.handleFrame(frame('session.updated', { session: sessionSnapshot() }));

    expect(h.coordinator.watermarks.localParticipantId).toBe(CUSTOMER);

    // The server relaying our own typing.start back must not light the
    // indicator for ourselves.
    h.coordinator.handleFrame(frame('typing.start', { participantId: CUSTOMER }));
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: false });

    h.coordinator.handleFrame(frame('typing.start', { participantId: 'agent-1' }));
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-1' });
  });

  it('fans an explicit local participant out to both units', async () => {
    const h = harness();
    h.coordinator.setLocalParticipantId('me');

    expect(h.coordinator.watermarks.localParticipantId).toBe('me');

    h.coordinator.handleFrame(frame('typing.start', { participantId: 'me' }));
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });
});

describe('PresenceCoordinator — end-to-end offline gap and reconnect (§9.5)', () => {
  it('flushes one watermark update for a backlog, then reconciles with the server', async () => {
    const h = harness({ localParticipantId: CUSTOMER });

    // 150 messages arrived while offline.
    const backlog = Array.from({ length: 150 }, (_, i) =>
      message(`m${i}`, new Date(Date.UTC(2024, 5, 1, 0, 0, i)).toISOString()),
    );
    h.store.setState({ messages: backlog });
    h.coordinator.watermarks.recomputeUnreadCount();
    await flush();
    expect(h.store.getState().unreadCount).toBe(150);

    // The user opens the thread: one call, one frame.
    h.coordinator.watermarks.markRead();
    await flush();
    expect(h.intents.filter((i) => i.t === 'message.markRead')).toHaveLength(1);
    expect(h.store.getState().unreadCount).toBe(0);

    // A reconnect ack built before the server saw our markRead must not
    // resurrect the backlog.
    h.coordinator.handleFrame(
      frame('connection.ack', {
        protocolVersion: 1,
        session: {
          ...sessionSnapshot(),
          participants: [{ participantId: CUSTOMER, type: 'CUSTOMER', lastReadAt: '2024-01-01T00:00:00.000Z' }],
        },
        seq: 99,
      }),
    );
    await flush();

    expect(h.store.getState().unreadCount).toBe(0);
    expect(h.store.getState().readWatermarks[CUSTOMER]).toBe(backlog[149]?.createdAt);
  });
});

describe('PresenceCoordinator — reset on disconnect', () => {
  it('clears typing and presence but keeps watermarks', async () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.coordinator.handleFrame(frame('typing.start', { participantId: 'agent-1' }));
    h.coordinator.handleFrame(frame('presence.update', { participantId: 'agent-1', status: 'ONLINE' }));
    h.coordinator.handleFrame(frame('message.read', { participantId: 'agent-1', readAt: '2024-01-05T00:00:00.000Z' }));
    await flush();

    h.coordinator.reset();
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });
    expect(h.coordinator.presence.all()).toEqual([]);
    // Durable read state survives a dropped socket (§9.5).
    expect(h.store.getState().readWatermarks['agent-1']).toBe('2024-01-05T00:00:00.000Z');
  });

  it('cancels pending typing timers so nothing fires after reset', () => {
    const h = harness();
    h.coordinator.handleFrame(frame('typing.start', { participantId: 'agent-1' }));
    h.coordinator.typing.startTyping();

    h.coordinator.reset();
    const countAtReset = h.intents.length;
    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS * 10);

    expect(h.timers.pendingCount).toBe(0);
    expect(h.intents).toHaveLength(countAtReset);
  });
});

describe('PresenceCoordinator — construction', () => {
  it('applies default typing timings when none are supplied', () => {
    const h = harness();
    expect(h.coordinator.typing.timings).toEqual({
      remoteTypingTimeoutMs: 5_000,
      startIntervalMs: 3_000,
      idleMs: 3_000,
    });
  });

  it('forwards custom typing timings through to the controller', () => {
    const store = new ChatStore();
    const coordinator = new PresenceCoordinator({
      store,
      emitIntent: () => {},
      remoteTypingTimeoutMs: 2_000,
      startIntervalMs: 500,
      idleMs: 400,
    });

    expect(coordinator.typing.timings).toEqual({
      remoteTypingTimeoutMs: 2_000,
      startIntervalMs: 500,
      idleMs: 400,
    });
  });

  it('produces outbound intents through one shared sink', () => {
    const h = harness({ localParticipantId: CUSTOMER });
    h.store.setState({ messages: [message('m1', '2024-01-01T00:00:00.000Z')] });

    h.coordinator.typing.startTyping();
    h.coordinator.presence.setPresence('ONLINE');
    h.coordinator.watermarks.markRead();

    expect(h.intents.map((intent) => intent.t)).toEqual(['typing.start', 'presence.set', 'message.markRead']);
  });
});
