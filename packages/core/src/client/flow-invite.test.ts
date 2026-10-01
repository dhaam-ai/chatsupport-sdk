// client.acceptInvite/dismissInvite and the flow.invite push —
// chatbot-workflows-commerce.md §6, through createChatClient's public surface.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';

const SESSION: SessionSnapshot = {
  sessionId: 'session_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
  createdAt: '2026-08-18T09:00:00.000Z',
};

function ackJson(): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1, session: SESSION, seq: 0 };
  return { v: 1, t: 'connection.ack', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', ts: 0, d: payload };
}

class EmptyHistory implements MessageHistorySource {
  async listMessages(): Promise<MessagePage> {
    return { messages: [], hasMore: false };
  }
}

function harness(logger = (_level: string, _msg: string, _meta?: Record<string, unknown>) => undefined) {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_flowinvite1',
    getToken: async () => 'tok_fi',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: new EmptyHistory(),
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
    logger: (level, msg, meta) => logger(level, msg, meta),
  };
  const client = createChatClient(config);
  return { client, sockets, timers };
}

type Frame = { t: string; d: Record<string, unknown> };

const framesOf = (h: ReturnType<typeof harness>, type: string): Frame[] =>
  (h.sockets.last.sentFrames() as Frame[]).filter((frame) => frame.t === type);

async function connect(h: ReturnType<typeof harness>): Promise<void> {
  const connecting = h.client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson());
  await connecting;
  await tick();
}

describe('a pushed flow.invite', () => {
  it('is delivered as the flowInvite event, payload verbatim', async () => {
    const h = harness();
    const received: unknown[] = [];
    h.client.on('flowInvite', (payload) => received.push(payload));
    await connect(h);
    h.sockets.last.emitJson({
      v: 1,
      t: 'flow.invite',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
      ts: 0,
      d: { inviteId: 'inv_1', text: 'Need a hand?' },
    });
    expect(received).toEqual([{ inviteId: 'inv_1', text: 'Need a hand?' }]);
  });
});

describe('acceptInvite', () => {
  it('reconnects, and the new hello carries inviteId', async () => {
    const h = harness();
    await connect(h);
    h.client.acceptInvite('inv_1');
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson());
    await tick();
    const [hello] = framesOf(h, 'connection.hello');
    expect(hello?.d['inviteId']).toBe('inv_1');
  });

  // The latch is cleared by the first good `connection.ack` (Task 5). If
  // acceptInvite latched the id while an older hello was still waiting for
  // its ack, that unrelated ack would clear it and the invite would never be
  // sent. acceptInvite must tear the in-flight attempt down so its ack can
  // never land, then carry the id on a hello built afterwards.
  it('is not swallowed by the ack of a hello that was already in flight', async () => {
    const h = harness();
    void h.client.connect();
    await tick();
    const inFlight = h.sockets.last;
    inFlight.open(); // hello written without inviteId, ack still outstanding
    expect((framesOf(h, 'connection.hello')[0]?.d ?? {})['inviteId']).toBeUndefined();

    h.client.acceptInvite('inv_1');
    inFlight.emitJson(ackJson()); // the stale ack arrives late
    await tick();

    const fresh = h.sockets.last;
    expect(fresh).not.toBe(inFlight);
    expect(inFlight.closeCalls.length).toBeGreaterThan(0);
    fresh.open();
    const [hello] = framesOf(h, 'connection.hello');
    expect(hello?.d['inviteId']).toBe('inv_1');
  });

  it('emits flowInviteCleared synchronously, before the reconnect settles', async () => {
    const h = harness();
    await connect(h);
    const cleared: unknown[] = [];
    h.client.on('flowInviteCleared', (payload) => cleared.push(payload));
    h.client.acceptInvite('inv_1');
    expect(cleared).toEqual([{ inviteId: 'inv_1' }]);
  });

  // The server only offers an invite once the chat has ended, so the client
  // usually holds an anchor N > 0 by then. Resuming N against the new session
  // (seq 0) is refused as `ahead`; accepting starts a new conversation.
  it('after a closed session with anchor N > 0, the hello is fresh: inviteId + newSession, no resumeFrom', async () => {
    const h = harness();
    const connecting = h.client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson({ ...(ackJson() as object), d: { protocolVersion: 1, session: SESSION, seq: 7 } });
    await connecting;
    await tick();
    h.sockets.last.emitJson({
      v: 1,
      t: 'session.closed',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAC',
      ts: 0,
      d: { sessionId: 'session_1', closeReason: 'RESOLVED' },
    });
    await tick();

    h.client.acceptInvite('inv_1');
    await tick();
    h.sockets.last.open();
    const [hello] = framesOf(h, 'connection.hello');
    expect(hello?.d['inviteId']).toBe('inv_1');
    expect(hello?.d['newSession']).toBe(true);
    expect(hello?.d).not.toHaveProperty('resumeFrom');
    expect(h.client.getState().session).toBeNull();
  });

  it('during an in-flight switchSession leaves no stale switch target: the new session paints', async () => {
    const h = harness();
    await connect(h);
    const switching = h.client.switchSession('session_2');
    void switching.catch(() => undefined);
    h.client.acceptInvite('inv_1');
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson({
      ...(ackJson() as object),
      d: { protocolVersion: 1, session: { ...SESSION, sessionId: 'session_new' }, seq: 0 },
    });
    await tick();
    expect(h.client.getState().session?.id).toBe('session_new');
    const hellos = (h.sockets.last.sentFrames() as Frame[]).filter((f) => f.t === 'connection.hello');
    expect(hellos[0]?.d['inviteId']).toBe('inv_1');
  });

  it('ignores a non-string/empty id and never throws', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.acceptInvite('')).not.toThrow();
    expect(() => h.client.acceptInvite(undefined as never)).not.toThrow();
    expect(h.sockets.sockets).toHaveLength(1); // no reconnect for a bad id
  });
});

describe('dismissInvite', () => {
  it('sends flow.inviteDismissed immediately and emits flowInviteCleared', async () => {
    const h = harness();
    await connect(h);
    const cleared: unknown[] = [];
    h.client.on('flowInviteCleared', (payload) => cleared.push(payload));
    h.client.dismissInvite('inv_1');
    expect(framesOf(h, 'flow.inviteDismissed')).toEqual([
      expect.objectContaining({ d: { inviteId: 'inv_1' } }),
    ]);
    expect(cleared).toEqual([{ inviteId: 'inv_1' }]);
  });

  it('never throws on a bad id', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.dismissInvite('')).not.toThrow();
  });
});
