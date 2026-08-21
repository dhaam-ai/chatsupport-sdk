// Round-trips every event in §6.5's catalog through the public surface, and
// checks the barrel exports the whole observable surface Decision #2 rests
// on. Unlike events.test.ts (which asserts the *types*), this drives real
// payloads through `on`/`emit` so a wiring mistake in the emitter shows up
// per event rather than only in aggregate.

import { describe, expect, it, vi } from 'vitest';

import { CHAT_EVENT_NAMES, ChatStore } from './index.js';
import type { ChatEventMap, ChatEventName, ChatSession } from './index.js';

const session: ChatSession = {
  id: 'sess-1',
  status: 'ASSIGNED',
  mode: 'HUMAN',
  createdAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  assignedAgent: { participantId: 'p_agent_1', displayName: 'Ada', email: null, avatarUrl: null },
  customer: { participantId: 'p_cust_1', displayName: 'Grace', email: null, avatarUrl: null },
  ticket: null,
};

/**
 * One representative payload per event. Typing this as a total mapped type
 * is the point: adding an event to `ChatEventMap` without a fixture here
 * fails to compile, so this suite cannot silently fall behind the catalog.
 */
const PAYLOADS: { [E in ChatEventName]: ChatEventMap[E] } = {
  connected: { session },
  reconnecting: { attempt: 3, delayMs: 1200 },
  suspended: { reason: 'auth' },
  disconnected: { reason: 'transport closed' },
  message: {
    id: 'msg-1',
    sessionId: 'sess-1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    seq: 7,
    createdAt: '2026-01-01T00:00:01.000Z',
  },
  messageAck: { id: 'msg-1', seq: 7 },
  sendFailed: { id: 'msg-1', sessionId: 'sess-1', reason: 'expired', retryable: true },
  typing: { isTyping: true, participantId: 'agent-1' },
  // HandledBy (protocol/domain.ts) as of the v2 wire contract — see the T7
  // report. Mechanical fixture update only: this file's own event-round-trip
  // logic is untouched.
  agentJoined: { kind: 'AGENT', id: 'agent-1', displayName: 'Ada' },
  agentLeft: { kind: 'AGENT', id: 'agent-1', displayName: 'Ada' },
  statusChange: { status: 'RESOLVED', mode: 'HUMAN' },
  sessionClosed: { closeReason: 'SWITCHED' },
  conversationStarted: { session, previousSessionId: 'sess-0' },
  presenceUpdate: { participantId: 'agent-1', status: 'AWAY', lastSeen: '2026-01-01T00:00:02.000Z' },
  ticketLinked: { ticketId: 'T-1', ticketUrl: 'https://example.test/T-1' },
  tokenRefreshed: {},
  error: { source: 'protocol', code: 'RATE_LIMITED', message: 'slow down', retryable: true },
};

describe('§6.5 event catalog round-trip', () => {
  it.each(CHAT_EVENT_NAMES)('round-trips %s through on/emit', (event) => {
    const store = new ChatStore();
    const handler = vi.fn();
    const payload = PAYLOADS[event];

    store.on(event, handler);
    // The one cast: `event` is the whole union here, so the compiler cannot
    // correlate it with its own payload. PAYLOADS' mapped type already
    // proved that correlation above.
    store.emit(event, payload as ChatEventMap[typeof event]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('has a fixture for every event and no extras', () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual([...CHAT_EVENT_NAMES].sort());
  });

  it('delivers each event only to its own handlers', () => {
    const store = new ChatStore();
    const handlers = new Map<ChatEventName, ReturnType<typeof vi.fn>>();

    for (const event of CHAT_EVENT_NAMES) {
      const handler = vi.fn();
      handlers.set(event, handler);
      store.on(event, handler);
    }

    store.emit('ticketLinked', PAYLOADS.ticketLinked);

    for (const event of CHAT_EVENT_NAMES) {
      expect(handlers.get(event)).toHaveBeenCalledTimes(event === 'ticketLinked' ? 1 : 0);
    }
  });

  it('unsubscribes every event independently', () => {
    const store = new ChatStore();
    const handler = vi.fn();

    for (const event of CHAT_EVENT_NAMES) {
      const off = store.on(event, handler);
      off();
      store.emit(event, PAYLOADS[event] as ChatEventMap[typeof event]);
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('state barrel', () => {
  it('exports a working store as the single observable surface', async () => {
    // The integration §6.4 actually promises: state and events on one
    // object, snapshot readable, notification batched.
    const store = new ChatStore();
    const listener = vi.fn();
    const onConnected = vi.fn();

    store.subscribe(listener);
    store.on('connected', onConnected);

    store.setState({ connectionState: 'connected', session });
    store.emit('connected', { session });

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(store.getState().session).toBe(session);
    expect(listener).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Two field changes, one notification.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(store.getState());
  });

  it('freezes state reached through the barrel', () => {
    const store = new ChatStore({ initialState: { ...new ChatStore().getState(), session } });

    expect(() => {
      (store.getState().session as { id: string }).id = 'tampered';
    }).toThrow(TypeError);
  });
});
