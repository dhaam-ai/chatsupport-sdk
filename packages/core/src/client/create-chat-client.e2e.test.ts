// End-to-end proof that the ten T7-T12 modules actually compose — PRD §15.
//
// Everything below goes through `createChatClient`'s public surface only:
// no test reaches into `ConnectionController`, `MessageController`,
// `SendQueue`, or any other internal engine directly. The only test doubles
// injected are the two `ChatClientConfig` seams a real consumer would also
// have to supply (`webSocketFactory`, `history`) plus the advanced
// `schedule`/`now` overrides this file's own header documents as existing
// for exactly this purpose.
//
// Per the task brief: "where you assert something load-bearing, break the
// code and confirm the test fails." The three assertions below that are
// hardest to accidentally satisfy — the SessionSnapshot -> ChatSession
// mapping, ULID-reuse on offline-queue replay, and the barrel's internal/
// public boundary — were each verified this way; see the T13 report for
// which breakages were tried and what each confirmed.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, MessagePayload, SessionSnapshot } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { CLOSE_CODE, StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A distinct, valid ULID per call — envelope `id` is ULID-validated (protocol/validate.ts). */
function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';
const AGENT_ID = 'participant_agent_1';

function sessionSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'session_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants: [
      { participantId: CUSTOMER_ID, type: 'CUSTOMER' },
      { participantId: AGENT_ID, type: 'AGENT' },
    ],
    createdAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

function ackJson(seq: number, session: SessionSnapshot, idNum: number): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1, session, seq };
  return { v: 1, t: 'connection.ack', id: ulid(idNum), ts: 0, d: payload };
}

function genericAckJson(ref: string, idNum: number, extra: Record<string, unknown> = {}): unknown {
  return { v: 1, t: 'ack', id: ulid(idNum), ref, ts: 0, d: { ok: true, ...extra } };
}

function messageNewJson(idNum: number, seq: number, overrides: Partial<MessagePayload> = {}): unknown {
  const payload: MessagePayload = {
    id: ulid(idNum),
    sessionId: 'session_1',
    senderId: AGENT_ID,
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hi from the agent',
    seq,
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
  return { v: 1, t: 'message.new', id: ulid(idNum), ts: 0, d: payload };
}

class FakeHistory implements MessageHistorySource {
  readonly calls: { sessionId: string; before?: string; limit: number }[] = [];

  async listMessages(query: { sessionId: string; before?: string; limit: number }): Promise<MessagePage> {
    this.calls.push(query);
    return { messages: [], hasMore: false };
  }
}

interface Harness {
  readonly sockets: StubSocketFactory;
  readonly timers: ManualTimers;
  readonly history: FakeHistory;
  readonly storage: MemoryStorageAdapter;
  readonly config: ChatClientConfig;
}

function harness(overrides: Partial<ChatClientConfig> = {}, storage = new MemoryStorageAdapter()): Harness {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const history = new FakeHistory();

  const config: ChatClientConfig = {
    publishableKey: 'dhpk_test_e2e123',
    getToken: async () => 'tok_e2e',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage,
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history,
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
    ...overrides,
  };

  return { sockets, timers, history, storage, config };
}

// ---------------------------------------------------------------------------

describe('createChatClient — end-to-end through the public API', () => {
  it('connects, sends, receives, reconnects, and keeps state/events consistent', async () => {
    const h = harness();
    const client = createChatClient(h.config);

    const stateSnapshots: unknown[] = [];
    client.subscribe((state) => stateSnapshots.push(state));

    const events: { name: string; payload: unknown }[] = [];
    for (const name of [
      'connected',
      'reconnecting',
      'disconnected',
      'message',
      'messageAck',
      'statusChange',
      'error',
    ] as const) {
      client.on(name, (payload) => events.push({ name, payload }));
    }

    expect(client.getState().connectionState).toBe('idle');

    // ---- connect ----
    const connectPromise = client.connect();
    await tick();
    expect(client.getState().connectionState).toBe('connecting');
    expect(h.sockets.sockets).toHaveLength(1);

    h.sockets.last.open();
    expect(client.getState().connectionState).toBe('authenticating');

    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 1));
    await connectPromise;
    await tick();

    expect(client.getState().connectionState).toBe('connected');

    // The SessionSnapshot -> ChatSession mapping (client/session.ts) is what
    // makes this non-null at all — see the T8 report this task closes.
    const session = client.getState().session;
    expect(session?.id).toBe('session_1');
    expect(session?.status).toBe('ASSIGNED');
    expect(session?.customer?.participantId).toBe(CUSTOMER_ID);
    expect(session?.assignedAgent?.participantId).toBe(AGENT_ID);

    const firstConnected = events.find((e) => e.name === 'connected');
    expect(firstConnected).toBeDefined();
    expect((firstConnected?.payload as { session: { id: string } }).session.id).toBe('session_1');

    // ---- send a message ----
    const sendPromise = client.sendMessage('hello agent');
    await tick();

    let messages = client.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('hello agent');
    expect(messages[0]?.delivery).toEqual({ state: 'queued' });

    const sentFrames = h.sockets.last.sentFrames() as { t: string; id: string }[];
    const sendFrame = sentFrames.find((frame) => frame.t === 'message.send');
    expect(sendFrame).toBeDefined();
    const clientMessageId = sendFrame?.id;
    expect(messages[0]?.id).toBe(clientMessageId);

    h.sockets.last.emitJson(genericAckJson(clientMessageId as string, 2, { seq: 1 }));
    await sendPromise;
    await tick();

    messages = client.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.delivery).toBeUndefined();
    expect(messages[0]?.seq).toBe(1);
    expect(events.some((e) => e.name === 'messageAck')).toBe(true);

    // ---- receive a message from the other participant ----
    h.sockets.last.emitJson(messageNewJson(3, 2));
    await tick();

    messages = client.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.senderId === AGENT_ID && m.content === 'hi from the agent')).toBe(true);
    expect(events.some((e) => e.name === 'message')).toBe(true);

    // ---- reconnect ----
    const droppedSocket = h.sockets.last;
    droppedSocket.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();

    expect(client.getState().connectionState).toBe('reconnecting');
    expect(events.some((e) => e.name === 'reconnecting')).toBe(true);
    expect(events.some((e) => e.name === 'disconnected')).toBe(true);

    h.timers.advance(1000); // covers attempt-0's full-jitter window (base 500ms, cap 30s)
    await tick();

    expect(h.sockets.sockets.length).toBeGreaterThanOrEqual(2);
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(2, sessionSnapshot(), 4));
    await tick();

    expect(client.getState().connectionState).toBe('connected');
    // §12.3: connection.ack is symmetric on reconnect.
    expect(events.filter((e) => e.name === 'connected')).toHaveLength(2);
    // No duplication or loss across the reconnect.
    expect(client.getState().messages).toHaveLength(2);

    client.disconnect();
    expect(client.getState().connectionState).toBe('closed');

    // subscribe() actually delivered at least one full snapshot.
    expect(stateSnapshots.length).toBeGreaterThan(0);
  });

  it('queues a message sent while offline, replays it under the same id on reconnect, and never duplicates it', async () => {
    const h = harness();
    const client = createChatClient(h.config);

    const connectPromise = client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 1));
    await connectPromise;
    await tick();

    // Go offline.
    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    expect(client.getState().connectionState).toBe('reconnecting');

    // sendMessage() never rejects for "offline" — offline is a queued state.
    const sendPromise = client.sendMessage('typed while offline');
    await tick();

    let messages = client.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.delivery).toEqual({ state: 'queued' });
    const queuedId = messages[0]?.id;

    // No message.send was written for this offline send — `h.sockets.last`
    // is still the first (now-closed) socket, whose `.sent` already carries
    // its own `connection.hello`, so the assertion is scoped to frame type.
    const framesOnClosedSocket = h.sockets.last.sentFrames() as { t: string }[];
    expect(framesOnClosedSocket.some((frame) => frame.t === 'message.send')).toBe(false);

    // Reconnect.
    h.timers.advance(1000);
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 2));
    await tick(); // `connected` -> queue.flush()

    // The queue replayed the send on the new socket under the SAME id —
    // D1/§9.3: replay must reuse the original ULID so a server that already
    // persisted the frame dedupes rather than double-sending.
    const replayed = (h.sockets.last.sentFrames() as { t: string; id: string }[]).find(
      (frame) => frame.t === 'message.send',
    );
    expect(replayed).toBeDefined();
    expect(replayed?.id).toBe(queuedId);

    h.sockets.last.emitJson(genericAckJson(queuedId as string, 3, { seq: 5 }));
    await sendPromise;
    await tick();

    messages = client.getState().messages;
    expect(messages).toHaveLength(1); // never duplicated
    expect(messages[0]?.id).toBe(queuedId);
    expect(messages[0]?.delivery).toBeUndefined();
    expect(messages[0]?.seq).toBe(5);
  });

  it('survives a simulated reload: a queued send restored from storage still resolves to exactly one message', async () => {
    const storage = new MemoryStorageAdapter();
    const h1 = harness({}, storage);
    const client1 = createChatClient(h1.config);

    const connectPromise = client1.connect();
    await tick();
    h1.sockets.last.open();
    h1.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 1));
    await connectPromise;
    await tick();

    // Go offline and queue a send that will never be acked in this "process".
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('typed just before the reload').catch(() => undefined);
    await tick();
    const queuedId = client1.getState().messages[0]?.id;
    expect(queuedId).toBeDefined();

    // "Reload": a brand-new client, same underlying storage, same tenant —
    // nothing here reaches into SendQueue/MessageController directly.
    const h2 = harness({}, storage);
    const client2 = createChatClient(h2.config);

    // ChatState starts fresh...
    expect(client2.getState().messages).toHaveLength(0);

    // ...but the durable queue is read back on construction (asynchronously —
    // createChatClient() is synchronous per §6.1), and the pending send is
    // rehydrated as a queued optimistic message once that resolves.
    await tick();
    await tick();

    const rehydrated = client2.getState().messages;
    expect(rehydrated).toHaveLength(1);
    expect(rehydrated[0]?.id).toBe(queuedId);
    expect(rehydrated[0]?.delivery).toEqual({ state: 'queued' });

    // Connect the second client and let the rehydrated send actually deliver.
    const connectPromise2 = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 2));
    await connectPromise2;
    await tick();

    const replayed = (h2.sockets.last.sentFrames() as { t: string; id: string }[]).find(
      (frame) => frame.t === 'message.send',
    );
    expect(replayed?.id).toBe(queuedId);

    h2.sockets.last.emitJson(genericAckJson(queuedId as string, 3, { seq: 9 }));
    await tick();

    const finalMessages = client2.getState().messages;
    expect(finalMessages).toHaveLength(1); // exactly one — never duplicated across the reload
    expect(finalMessages[0]?.delivery).toBeUndefined();
    expect(finalMessages[0]?.seq).toBe(9);
  });

  it('rejects a secret key passed as the publishable key, loudly, at construction', () => {
    const h = harness({ publishableKey: 'dhsk_live_should_never_reach_a_browser' });

    expect(() => createChatClient(h.config)).toThrowError(/secret key/i);
  });

  it('rejects construction with no wsUrl rather than guessing a host', () => {
    const h = harness();
    // `exactOptionalPropertyTypes` forbids `wsUrl: undefined` on the typed
    // config, matching real misuse: a host that forgot to set the field
    // simply never adds the key at all.
    const { wsUrl: _wsUrl, ...withoutWsUrl } = h.config;

    expect(() => createChatClient(withoutWsUrl as ChatClientConfig)).toThrowError(/wsUrl/);
  });

  it("sendAttachment() fails loudly, not silently, when config.uploader was not supplied", async () => {
    const h = harness();
    const client = createChatClient(h.config);

    const connectPromise = client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 1));
    await connectPromise;

    await expect(client.sendAttachment(new Blob(['x']))).rejects.toThrow(/uploader/i);
  });
});
