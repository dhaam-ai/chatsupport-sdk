// An agent starting a conversation with a customer who had no open one.
//
// The server creates the session, moves the customer's connection into it, and
// pushes the EXISTING `session.updated` frame carrying the new snapshot — no
// new wire frame type is involved, because `SERVER_PUSH_FRAME_TYPES`
// (protocol/frames.ts) is a closed catalog and adding to it would mean a
// protocol version bump plus a coordinated server release.
//
// Core already replaced the conversation wholesale on that frame. What it did
// not do was tell anyone, which is why the widget's panel stayed shut. These
// cover the `conversationStarted` event that closes that gap, and — just as
// importantly — the three cases that must NOT emit it.

import { describe, expect, it, vi } from 'vitest';

import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot, SessionUpdatedPayload } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

const CUSTOMER_ID = 'participant_customer_1';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function snapshot(sessionId: string, status: SessionSnapshot['status'] = 'ASSIGNED'): SessionSnapshot {
  return {
    sessionId,
    status,
    mode: 'HUMAN',
    participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
    createdAt: '2026-08-21T09:00:00.000Z',
  };
}

function ackJson(sessionId: string): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1, session: snapshot(sessionId), seq: 0 };
  return { v: 1, t: 'connection.ack', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', ts: 0, d: payload };
}

/** The frame the staff-tier session-create endpoint makes the server push. */
function updatedJson(sessionId: string, status: SessionSnapshot['status'] = 'ASSIGNED'): unknown {
  const payload: SessionUpdatedPayload = { session: snapshot(sessionId, status) };
  return { v: 1, t: 'session.updated', id: '01ARZ3NDEKTSV4RRFFQ69G5FAB', ts: 0, d: payload };
}

/** Connected, with `session_1` on screen. */
async function connected() {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_agentinit',
    getToken: async () => 'tok',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
  };
  const client = createChatClient(config);
  const connecting = client.connect();
  await tick();
  sockets.last.open();
  sockets.last.emitJson(ackJson('session_1'));
  await connecting;
  await tick();
  return { sockets, client };
}

describe('conversationStarted', () => {
  it('fires when session.updated names a session other than the one on screen', async () => {
    const { sockets, client } = await connected();
    const started = vi.fn();
    client.on('conversationStarted', started);

    sockets.last.emitJson(updatedJson('session_2'));
    await tick();

    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0]?.[0]).toMatchObject({
      previousSessionId: 'session_1',
      session: { id: 'session_2' },
    });
  });

  it('hands the handler a store that already names the new session', async () => {
    // The ordering the whole feature rests on: a widget's handler calls
    // `open()`, and the panel it opens must be showing the conversation this
    // event is announcing, not the one it replaced. Guaranteed by emitting
    // after `commitSession` rather than before.
    const { sockets, client } = await connected();
    const seen: Array<string | null> = [];
    client.on('conversationStarted', () => seen.push(client.getState().session?.id ?? null));

    sockets.last.emitJson(updatedJson('session_2'));
    await tick();

    expect(seen).toEqual(['session_2']);
  });

  it('does NOT fire when session.updated names the session already on screen', async () => {
    const { sockets, client } = await connected();
    const started = vi.fn();
    client.on('conversationStarted', started);

    // A real status change on the SAME session — the ordinary refresh case,
    // which must stay a `statusChange` and nothing more.
    sockets.last.emitJson(updatedJson('session_1', 'RESOLVED'));
    await tick();

    expect(started).not.toHaveBeenCalled();
  });

  it('does NOT fire for connection.ack, even when it resolves a different session', async () => {
    // A reconnect landing where the server put us is an ordinary page load,
    // not an agent opening a conversation. Emitting here would fire on
    // nearly every visit and train hosts to ignore the event.
    const { sockets, client } = await connected();
    const started = vi.fn();
    client.on('conversationStarted', started);

    sockets.last.emitJson(ackJson('session_9'));
    await tick();

    expect(started).not.toHaveBeenCalled();
    expect(client.getState().session?.id).toBe('session_9');
  });

  it('leaves statusChange subscribers behaving exactly as before', async () => {
    // The backward-compatibility check. `statusChange` and
    // `conversationStarted` are disjoint by construction — same id vs
    // different id — so no existing subscriber can start seeing an extra
    // occurrence because this event was added.
    const { sockets, client } = await connected();
    const status = vi.fn();
    client.on('statusChange', status);

    // Different session: statusChange must stay silent (pre-existing rule).
    sockets.last.emitJson(updatedJson('session_2', 'RESOLVED'));
    await tick();
    expect(status).not.toHaveBeenCalled();

    // Same session, real change: statusChange fires, exactly as it always did.
    sockets.last.emitJson(updatedJson('session_2', 'CLOSED'));
    await tick();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0]?.[0]).toEqual({ status: 'CLOSED', mode: 'HUMAN' });
  });

  it('replaces the transcript and seeds page one, as the pre-existing path already did', async () => {
    // Guards the additive claim from the other side: adding an emit must not
    // have disturbed the commit/seed the event rides on.
    const { sockets, client } = await connected();

    sockets.last.emitJson(updatedJson('session_2'));
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().messages).toEqual([]);
    expect(client.getState().pagination.initialLoaded).toBe(true);
  });
});
