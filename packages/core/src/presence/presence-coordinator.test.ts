import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame, ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
import { createInitialChatState, ChatStateStore } from '../state/index.js';
import { MockWebSocket } from '../../test/mock-websocket.js';
import { Transport } from '../transport/index.js';
import { ConnectionMachine } from '../connection/index.js';
import { PresenceCoordinator } from './presence-coordinator.js';

function sessionSnapshot(): SessionSnapshot {
  return { sessionId: 's1', status: 'OPEN', mode: 'BOT', participants: [], createdAt: '2026-01-01T00:00:00.000Z' };
}

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): AnyFrame {
  return { v: 1, t: 'connection.ack', id: generateUlid(), ts: Date.now(), d: { protocolVersion: 1, session: sessionSnapshot(), seq: 1, ...overrides } };
}

describe('PresenceCoordinator', () => {
  let sockets: MockWebSocket[];
  let transport: Transport;
  let connection: ConnectionMachine;
  let store: ChatStateStore;
  let presence: PresenceCoordinator;

  function currentSocket(): MockWebSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket yet');
    return socket;
  }

  function sentFrames(): Array<{ t: string; id: string; d: Record<string, unknown> }> {
    return currentSocket().sent.map((s) => JSON.parse(s));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    transport = new Transport({
      webSocketFactory: () => {
        const socket = new MockWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    connection = new ConnectionMachine({
      url: 'ws://example.invalid',
      transport,
      buildHello: async () => ({ guestId: 'guest_1', publishableKey: 'pk1' }),
    });
    store = new ChatStateStore(createInitialChatState());
    presence = new PresenceCoordinator({ store, connection, getSenderId: () => 'guest_1' });
    presence.attach();
  });

  afterEach(() => {
    presence.destroy();
    connection.destroy();
    vi.useRealTimers();
  });

  async function connectAndAck(): Promise<void> {
    connection.connect();
    currentSocket().simulateOpen();
    await vi.waitFor(() => expect(sentFrames().some((f) => f.t === 'connection.hello')).toBe(true));
    currentSocket().simulateMessage(JSON.stringify(ackFrame()));
    await vi.waitFor(() => expect(connection.state).toBe('connected'));
  }

  describe('startTyping / stopTyping', () => {
    it('sends typing.start when connected', async () => {
      await connectAndAck();

      presence.startTyping();

      expect(sentFrames().some((f) => f.t === 'typing.start')).toBe(true);
    });

    it('sends typing.stop when connected', async () => {
      await connectAndAck();

      presence.stopTyping();

      expect(sentFrames().some((f) => f.t === 'typing.stop')).toBe(true);
    });

    it('is a silent no-op when not connected — never throws', () => {
      expect(() => presence.startTyping()).not.toThrow();
    });
  });

  describe('inbound typing', () => {
    it('applies typing.start to ChatState.typing, including the remote participantId', async () => {
      await connectAndAck();

      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.start', id: generateUlid(), ts: Date.now(), d: { participantId: 'agent-1' } }));

      expect(store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-1' });
    });

    it('applies typing.stop to ChatState.typing', async () => {
      await connectAndAck();
      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.start', id: generateUlid(), ts: Date.now(), d: { participantId: 'agent-1' } }));

      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.stop', id: generateUlid(), ts: Date.now(), d: { participantId: 'agent-1' } }));

      expect(store.getState().typing.isTyping).toBe(false);
    });

    it('auto-clears a stuck typing.start after the timeout if no typing.stop follows', async () => {
      await connectAndAck();

      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.start', id: generateUlid(), ts: Date.now(), d: {} }));
      expect(store.getState().typing.isTyping).toBe(true);

      await vi.advanceTimersByTimeAsync(5000);

      expect(store.getState().typing.isTyping).toBe(false);
    });

    it('a fresh typing.start resets the auto-clear timer rather than stacking timers', async () => {
      await connectAndAck();
      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.start', id: generateUlid(), ts: Date.now(), d: {} }));

      await vi.advanceTimersByTimeAsync(4000);
      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'typing.start', id: generateUlid(), ts: Date.now(), d: {} })); // resets the clock

      await vi.advanceTimersByTimeAsync(4000); // 8s since the first start, but only 4s since the reset
      expect(store.getState().typing.isTyping).toBe(true);

      await vi.advanceTimersByTimeAsync(1000); // now 5s since the reset
      expect(store.getState().typing.isTyping).toBe(false);
    });
  });

  describe('markRead', () => {
    it('optimistically advances the local watermark for this client\'s own id', async () => {
      await connectAndAck();

      presence.markRead();

      expect(store.getState().readWatermarks['guest_1']).toEqual(expect.any(String));
    });

    it('sends message.markRead when connected', async () => {
      await connectAndAck();

      presence.markRead();

      expect(sentFrames().some((f) => f.t === 'message.markRead')).toBe(true);
    });

    it('still updates the local watermark even when not connected (optimistic, not gated on delivery)', () => {
      presence.markRead();

      expect(store.getState().readWatermarks['guest_1']).toEqual(expect.any(String));
    });
  });

  describe('inbound message.read', () => {
    it('updates the watermark for whichever participant the frame names', async () => {
      await connectAndAck();

      currentSocket().simulateMessage(JSON.stringify({ v: 1, t: 'message.read', id: generateUlid(), ts: Date.now(), d: { participantId: 'agent-1', readAt: '2026-01-01T00:05:00.000Z' } }));

      expect(store.getState().readWatermarks['agent-1']).toBe('2026-01-01T00:05:00.000Z');
    });
  });

  describe('presence set/query', () => {
    it('sends presence.set with the given status when connected', async () => {
      await connectAndAck();

      presence.setPresence('ONLINE');

      const sent = sentFrames().find((f) => f.t === 'presence.set');
      expect(sent?.d['status']).toBe('ONLINE');
    });

    it('sends presence.query with no participantIds to mean "everyone in the session"', async () => {
      await connectAndAck();

      presence.queryPresence();

      const sent = sentFrames().find((f) => f.t === 'presence.query');
      expect(sent?.d['participantIds']).toBeUndefined();
    });

    it('sends presence.query with the given participantIds', async () => {
      await connectAndAck();

      presence.queryPresence(['agent-1', 'agent-2']);

      const sent = sentFrames().find((f) => f.t === 'presence.query');
      expect(sent?.d['participantIds']).toEqual(['agent-1', 'agent-2']);
    });
  });
});
