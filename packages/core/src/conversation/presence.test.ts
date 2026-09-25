// `ConversationClient.queryPresence` — the keyless/staff surface's presence
// query, end to end over the real transport.
//
// Companion to `presence/presence.test.ts` (which covers `PresenceRegistry`
// in isolation) and `client/create-chat-client.e2e.test.ts`'s customer-flow
// equivalent. This is the party surface's own: `queryPresence` is not in
// `ADDRESSABLE_INTENT_TYPES` (addressing.ts — presence is a fact about the
// CONNECTION, not one conversation), so its ack carries no `sessionId` to
// correlate by, and `ConversationRegistry`'s `#emitIntent` instead applies a
// successful answer to every open conversation's own `PresenceRegistry`
// (`registry.ts`). That is the exact mechanism this file pins.

import { describe, expect, it } from 'vitest';

import { createConversationClient } from './create-conversation-client.js';
import type { ConversationClient, ConversationClientConfig } from './types.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { StubSocketFactory } from '../transport/index.js';
import type { StubWebSocket } from '../transport/index.js';

const SESSION = 'session_alpha';
const STAFF_ID = 'agent_7';
const PEER_ID = 'outlet_9';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function staffAckJson(idNum = 0): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1 };
  return { v: 1, t: 'connection.ack', id: ulid(idNum), ts: 0, d: payload };
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: SESSION,
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants: [
      { participantId: PEER_ID, type: 'AGENT' },
      { participantId: STAFF_ID, type: 'AGENT' },
    ],
    createdAt: '2026-09-06T09:00:00.000Z',
  };
}

interface RawFrame {
  readonly t: string;
  readonly id: string;
  readonly d: Record<string, unknown>;
}

function sent(socket: StubWebSocket): RawFrame[] {
  return socket.sentFrames() as RawFrame[];
}

interface Harness {
  readonly sockets: StubSocketFactory;
  readonly client: ConversationClient;
}

function harness(): Harness {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ConversationClientConfig = {
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    getToken: async () => 'id_token_admin',
    localSender: { senderId: STAFF_ID, senderType: 'AGENT' },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
  };
  return { sockets, client: createConversationClient(config) };
}

async function connect(h: Harness): Promise<void> {
  const connecting = h.client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(staffAckJson(0));
  await connecting;
  await tick();
}

/** Drives one full `open()`: join frame -> ack -> pushed snapshot. */
async function open(h: Harness): Promise<void> {
  const opening = h.client.open({ conversationId: SESSION });
  await tick();
  const join = last(sent(h.sockets.last).filter((f) => f.t === 'session.join'));
  if (join === undefined) throw new Error('no session.join frame was written');
  h.sockets.last.emitJson({ v: 1, t: 'ack', id: ulid(30), ref: join.id, ts: 0, d: { ok: true, seq: 7 } });
  h.sockets.last.emitJson({ v: 1, t: 'session.updated', id: ulid(31), ts: 0, d: { session: snapshot() } });
  await opening;
  await tick();
}

describe('queryPresence() — the party surface, over the real transport', () => {
  it('sends presence.query with no sessionId (a connection-wide fact), and applies a successful ack into the open conversation\'s ChatState.presence', async () => {
    const h = harness();
    await connect(h);
    await open(h);

    h.client.queryPresence(SESSION, [PEER_ID]);
    await tick();

    const query = last(sent(h.sockets.last).filter((f) => f.t === 'presence.query'));
    if (query === undefined) throw new Error('no presence.query frame was written');
    expect(query.d).toEqual({ participantIds: [PEER_ID] });

    h.sockets.last.emitJson({
      v: 1,
      t: 'ack',
      id: ulid(40),
      ref: query.id,
      ts: 0,
      d: { ok: true, presences: [{ participantId: PEER_ID, status: 'ONLINE' }] },
    });
    await tick();

    expect(h.client.getState().conversations[SESSION]?.presence[PEER_ID]).toEqual({
      participantId: PEER_ID,
      status: 'ONLINE',
    });
  });

  it('is a silent no-op for a conversation this client has not opened', async () => {
    const h = harness();
    await connect(h);

    expect(() => h.client.queryPresence('never_opened', [PEER_ID])).not.toThrow();
    await tick();
    expect(sent(h.sockets.last).some((f) => f.t === 'presence.query')).toBe(false);
  });

  it('a live presence.update push updates the same ChatState.presence field', async () => {
    const h = harness();
    await connect(h);
    await open(h);

    h.sockets.last.emitJson({
      v: 1,
      t: 'presence.update',
      id: ulid(50),
      ts: 0,
      d: { participantId: PEER_ID, status: 'OFFLINE' },
    });
    await tick();

    expect(h.client.getState().conversations[SESSION]?.presence[PEER_ID]).toEqual({
      participantId: PEER_ID,
      status: 'OFFLINE',
    });
  });

  it('a live push AFTER a query answer still applies — the two paths do not clobber each other', async () => {
    const h = harness();
    await connect(h);
    await open(h);

    h.client.queryPresence(SESSION, [PEER_ID]);
    await tick();
    const query = last(sent(h.sockets.last).filter((f) => f.t === 'presence.query'));
    if (query === undefined) throw new Error('no presence.query frame was written');
    h.sockets.last.emitJson({
      v: 1,
      t: 'ack',
      id: ulid(60),
      ref: query.id,
      ts: 0,
      d: { ok: true, presences: [{ participantId: PEER_ID, status: 'ONLINE' }] },
    });
    await tick();
    expect(h.client.getState().conversations[SESSION]?.presence[PEER_ID]?.status).toBe('ONLINE');

    h.sockets.last.emitJson({
      v: 1,
      t: 'presence.update',
      id: ulid(61),
      ts: 0,
      d: { participantId: PEER_ID, status: 'OFFLINE' },
    });
    await tick();

    expect(h.client.getState().conversations[SESSION]?.presence[PEER_ID]?.status).toBe('OFFLINE');
  });
});
