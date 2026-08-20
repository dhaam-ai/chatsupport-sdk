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
import type { ChatSessionSummary } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { CLOSE_CODE, StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig, SessionSummarySource } from './types.js';

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

function rejectedAckJson(
  ref: string,
  idNum: number,
  error: { code: string; message: string; retryable: boolean },
): unknown {
  return { v: 1, t: 'ack', id: ulid(idNum), ref, ts: 0, d: { ok: false, error } };
}

function sessionUpdatedJson(session: SessionSnapshot, idNum: number): unknown {
  return { v: 1, t: 'session.updated', id: ulid(idNum), ts: 0, d: { session } };
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
    publishableKey: 'dhp' + '_test_e2e123',
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
    const h = harness({ publishableKey: 'dhk' + '_live_should_never_reach_a_browser' });

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

// ---------------------------------------------------------------------------
// The closed-session dead end (§12.5)
// ---------------------------------------------------------------------------
//
// An agent closes the chat; the customer must still have a way forward. These
// go through the public surface only, like everything above.

function sessionClosedJson(
  sessionId: string,
  closeReason: 'RESOLVED' | 'MANUAL' | 'SWITCHED',
  idNum: number,
): unknown {
  return {
    v: 1,
    t: 'session.closed',
    id: ulid(idNum),
    ts: 0,
    d: { sessionId, closeReason },
  };
}

/** Connects a fresh client and drives it to `connected` on `session_1`. */
async function connected(h: Harness): Promise<ReturnType<typeof createChatClient>> {
  const client = createChatClient(h.config);
  const promise = client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 1));
  await promise;
  await tick();
  return client;
}

/** Answers the hello on the newest socket with `snapshot`. */
function ackNewSocket(h: Harness, snapshot: SessionSnapshot, seq = 0, idNum = 30): void {
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson(seq, snapshot, idNum));
}

describe('createChatClient — recovering from a closed session', () => {
  it('emits sessionClosed with the reason and stamps closedAt', async () => {
    const h = harness();
    const client = await connected(h);

    const closures: { closeReason: string }[] = [];
    client.on('sessionClosed', (payload) => closures.push(payload));

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'RESOLVED', 20));
    await tick();

    expect(closures).toEqual([{ closeReason: 'RESOLVED' }]);
    // The transcript is deliberately still there — the history is valid and
    // the customer may want to read it.
    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().session?.closedAt).not.toBeNull();
  });

  it('startNewSession opens a NEW session with a fresh, non-merged transcript', async () => {
    const h = harness();
    const client = await connected(h);

    // A message from the first conversation, so a merge would be visible.
    h.sockets.last.emitJson(messageNewJson(11, 1, { content: 'first conversation' }));
    await tick();
    expect(client.getState().messages).toHaveLength(1);

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'RESOLVED', 20));
    await tick();

    const restart = client.startNewSession();
    await tick();
    ackNewSocket(h, sessionSnapshot({ sessionId: 'session_2', status: 'WAITING_FOR_AGENT' }));
    await restart;
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().session?.status).toBe('WAITING_FOR_AGENT');
    // The whole point of item 3: two conversations, two transcripts.
    expect(client.getState().messages).toEqual([]);
    expect(client.getState().session?.closedAt).toBeNull();
  });

  it('omits resumeFrom on the new hello, which is what makes the session new', async () => {
    const h = harness();
    const client = await connected(h);

    h.sockets.last.emitJson(messageNewJson(12, 7));
    await tick();
    h.sockets.last.emitJson(sessionClosedJson('session_1', 'RESOLVED', 20));
    await tick();

    const restart = client.startNewSession();
    await tick();
    // The hello is written from the socket's `open`, so it does not exist
    // until the new socket opens.
    h.sockets.last.open();

    const hello = h.sockets.last.sentFrames()[0] as { t: string; d: Record<string, unknown> };
    expect(hello.t).toBe('connection.hello');
    // With `resumeFrom: 7` the v2 endpoint answers a non-retryable
    // VALIDATION_FAILED ("resumeFrom is ahead of this session") and the client
    // lands in `suspended` instead of a new conversation.
    expect(hello.d).not.toHaveProperty('resumeFrom');

    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_2' }), 30));
    await restart;
  });

  it('leaves no watermark, presence, typing or unread state from the old session', async () => {
    const h = harness();
    const client = await connected(h);

    h.sockets.last.emitJson({
      v: 1,
      t: 'typing.start',
      id: ulid(13),
      ts: 0,
      d: { participantId: AGENT_ID },
    });
    h.sockets.last.emitJson({
      v: 1,
      t: 'presence.update',
      id: ulid(14),
      ts: 0,
      d: { participantId: AGENT_ID, status: 'ONLINE' },
    });
    h.sockets.last.emitJson({
      v: 1,
      t: 'message.read',
      id: ulid(15),
      ts: 0,
      d: { participantId: AGENT_ID, readAt: '2026-08-18T10:05:00.000Z' },
    });
    await tick();

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'MANUAL', 20));
    await tick();

    const restart = client.startNewSession();
    await tick();
    ackNewSocket(h, sessionSnapshot({ sessionId: 'session_2' }));
    await restart;
    await tick();

    const state = client.getState();
    // A watermark is keyed by participant, not by session — the same agent
    // picking up the new chat must not arrive already "having read" it.
    expect(state.readWatermarks).toEqual({});
    expect(state.deliveredWatermarks).toEqual({});
    expect(state.presence).toEqual({});
    expect(state.typing.isTyping).toBe(false);
    expect(state.unreadCount).toBe(0);
    // `initialLoaded` is true, not false: core seeds page one on every
    // `connected`, and the new session's (empty) history has been read.
    expect(state.pagination).toEqual({ hasMore: false, loadingMore: false, initialLoaded: true });
  });

  it('fails a send queued against the closed session instead of delivering it into the new one', async () => {
    const h = harness();
    const client = await connected(h);

    const failures: { id: string; reason: string }[] = [];
    client.on('sendFailed', (payload) => failures.push(payload));

    // Never acked, so the entry stays in the queue — an entry leaves only on
    // an ack or a permanent failure (queue/send-queue.ts's first invariant).
    await client.sendMessage('about my resolved order');
    await tick();

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'RESOLVED', 22));
    await tick();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe('sessionClosed');

    const restart = client.startNewSession();
    await tick();
    ackNewSocket(h, sessionSnapshot({ sessionId: 'session_2' }));
    await restart;
    await tick();

    // `message.send` carries no sessionId, so a surviving entry would have
    // been attributed to session_2. Nothing was sent on the new socket.
    const sentOnNewSocket = h.sockets.last
      .sentFrames()
      .filter((frame) => (frame as { t: string }).t === 'message.send');
    expect(sentOnNewSocket).toEqual([]);
  });

  it('leaves a SWITCHED session\'s queued sends alone — it is parked, not ended', async () => {
    const h = harness();
    const client = await connected(h);

    const failures: { reason: string }[] = [];
    client.on('sendFailed', (payload) => failures.push(payload));

    await client.sendMessage('still relevant');
    await tick();

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'SWITCHED', 24));
    await tick();

    // §12.5: SWITCHED parks the session rather than ending it, so its
    // undelivered sends are still live.
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listSessions() — the picker's data source (T10)
// ---------------------------------------------------------------------------

class FakeSessionSummarySource implements SessionSummarySource {
  readonly calls: Array<{ readonly limit?: number } | undefined> = [];
  result: readonly ChatSessionSummary[] = [];
  failure: unknown;

  async listSessions(query?: { readonly limit?: number }): Promise<readonly ChatSessionSummary[]> {
    this.calls.push(query);
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}

describe('createChatClient — listSessions()', () => {
  it('throws ChatClientConfigError when config.sessionSummarySource was not supplied', async () => {
    const h = harness();
    const client = createChatClient(h.config);
    await expect(client.listSessions()).rejects.toThrow(/sessionSummarySource/);
  });

  it('writes the result to ChatState.pastSessions (including handledBy) and returns the same data', async () => {
    const source = new FakeSessionSummarySource();
    const summary: ChatSessionSummary = {
      id: 'sess_old_1',
      status: 'RESOLVED',
      mode: 'HUMAN',
      createdAt: '2026-08-01T00:00:00.000Z',
      closedAt: '2026-08-01T01:00:00.000Z',
      lastMessageAt: '2026-08-01T00:30:00.000Z',
      unreadCount: 0,
      handledBy: { kind: 'AGENT', id: 'agent_old_1', displayName: 'Ada' },
    };
    source.result = [summary];

    const h = harness({ sessionSummarySource: source });
    const client = createChatClient(h.config);

    const result = await client.listSessions({ limit: 5 });

    expect(result).toEqual([summary]);
    expect(client.getState().pastSessions).toEqual([summary]);
    expect(source.calls).toEqual([{ limit: 5 }]);
  });

  it('an empty result is a normal, successful state — not an error, not converted to a special case', async () => {
    const source = new FakeSessionSummarySource();
    source.result = []; // e.g. an unidentified guest — the wire's own "200 { sessions: [] }".

    const h = harness({ sessionSummarySource: source });
    const client = createChatClient(h.config);

    await expect(client.listSessions()).resolves.toEqual([]);
    expect(client.getState().pastSessions).toEqual([]);
    expect(client.getState().lastError).toBeNull();
  });

  it('rejects when the adapter rejects, rather than swallowing the failure into lastError', async () => {
    const source = new FakeSessionSummarySource();
    source.failure = new Error('network down');

    const h = harness({ sessionSummarySource: source });
    const client = createChatClient(h.config);

    await expect(client.listSessions()).rejects.toThrow('network down');
    // Unlike loadOlderMessages, this does not have a side-channel — a picker
    // calling this once on open needs a direct rejection to show its own
    // "couldn't load" state.
    expect(client.getState().lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// switchSession() — the session-picker's action (T10)
// ---------------------------------------------------------------------------

describe('createChatClient — switchSession()', () => {
  it('sends session.join with the given id and does not optimistically change ChatState.session', async () => {
    const h = harness();
    const client = await connected(h);
    const before = client.getState().session;

    void client.switchSession('session_2').catch(() => undefined);
    await tick();

    const sent = h.sockets.last
      .sentFrames()
      .find((frame) => (frame as { t: string }).t === 'session.join') as { d: Record<string, unknown> };
    expect(sent?.d).toEqual({ sessionId: 'session_2' });
    // Same object — the switch never guesses at a session the server has not
    // confirmed, so `session` still describes the one the client is in.
    expect(client.getState().session).toBe(before);
  });

  it('DOES replace the transcript, rather than leaving the old session\'s messages on screen', async () => {
    // User-reported bug 1, at the level core owns it. `switchSession` used to
    // be `joinSession` under a second name: it sent the frame and changed
    // nothing else, so a picker moved the header onto the new session while
    // the old session's messages stayed put. Full coverage of the
    // replacement lives in ./session-switch.test.ts; this is the headline
    // behaviour asserted from the composed client.
    const h = harness();
    const client = await connected(h);
    h.sockets.last.emitJson(messageNewJson(50, 1, { content: 'existing transcript' }));
    await tick();
    expect(client.getState().messages).toHaveLength(1);

    const switching = client.switchSession('session_2');
    await tick();

    const join = h.sockets.last
      .sentFrames()
      .find((frame) => (frame as { t: string }).t === 'session.join') as { id: string };
    h.sockets.last.emitJson(genericAckJson(join.id, 44));
    await tick();
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 45));
    await tick();
    await switching;

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().messages).toHaveLength(0); // FakeHistory serves an empty page
    expect(h.history.calls.some((call) => call.sessionId === 'session_2')).toBe(true);
  });

  it('applies the switch only once session.updated for the new session arrives — status is observed, never guessed', async () => {
    const h = harness();
    const client = await connected(h); // session_1, ASSIGNED

    void client.switchSession('session_2').catch(() => undefined);
    await tick();
    // Still the old session: `session.join`'s ack is EmptyAckData, so the
    // switch is confirmed only by the snapshot that follows.
    expect(client.getState().session?.id).toBe('session_1');

    // v2/handlers.ts already accepts a TERMINAL session join — this one
    // comes back CLOSED, unreactivated, and the client must render exactly
    // that rather than assuming a join reopens it.
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2', status: 'CLOSED' }), 40));
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().session?.status).toBe('CLOSED');

    // Reactivation (T1, backend) is observed from a LATER snapshot, never
    // assumed locally — this client never flips status itself.
    h.sockets.last.emitJson(
      sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2', status: 'WAITING_FOR_AGENT' }), 41),
    );
    await tick();
    expect(client.getState().session?.status).toBe('WAITING_FOR_AGENT');
  });

  it('surfaces a REJECTED join through lastError/error rather than vanishing silently (v2/handlers.ts ownership check)', async () => {
    const h = harness();
    const client = await connected(h);
    const errors: unknown[] = [];
    client.on('error', (error) => errors.push(error));

    const switching = client.switchSession('session_not_owned');
    await tick();

    const sent = h.sockets.last
      .sentFrames()
      .find((frame) => (frame as { t: string }).t === 'session.join') as { id: string };
    h.sockets.last.emitJson(
      rejectedAckJson(sent.id, 41, { code: 'SESSION_NOT_FOUND', message: 'not yours', retryable: false }),
    );
    // Reported through lastError/error AND thrown, so a picker awaiting the
    // switch and a subscriber watching state hear the same thing.
    await expect(switching).rejects.toThrow(/session_not_owned/);
    await tick();

    expect(errors).toHaveLength(1);
    expect(client.getState().lastError?.code).toBe('SESSION_NOT_FOUND');
    // A rejected switch leaves the session the client WAS in untouched.
    expect(client.getState().session?.id).toBe('session_1');
  });

  it('the SWITCHED-close of the OLD session, arriving AFTER the switch is confirmed, does not corrupt or announce-closed the new one', async () => {
    const h = harness();
    const client = await connected(h); // session_1
    const closures: { closeReason: string }[] = [];
    client.on('sessionClosed', (payload) => closures.push(payload));

    void client.switchSession('session_2').catch(() => undefined);
    await tick();

    // The switch is confirmed and reactivated first — the realistic
    // ordering: T1's reactivation only fires once the customer sends a
    // message into the newly-joined session, well after the join's own
    // snapshot already landed.
    h.sockets.last.emitJson(
      sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2', status: 'WAITING_FOR_AGENT' }), 40),
    );
    await tick();
    expect(client.getState().session?.id).toBe('session_2');

    // ...and only THEN does the OLD session (session_1), elsewhere, close
    // with SWITCHED.
    h.sockets.last.emitJson(sessionClosedJson('session_1', 'SWITCHED', 41));
    await tick();

    // Must NOT read as "your current chat just closed" — session_1 is not
    // ChatState.session by this point.
    expect(closures).toEqual([]);
    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().session?.status).toBe('WAITING_FOR_AGENT');
    expect(client.getState().session?.closedAt).toBeNull();
  });

  it('the same pairing in the opposite order still lands correctly on the new session, never stuck closed', async () => {
    const h = harness();
    const client = await connected(h); // session_1

    void client.switchSession('session_2').catch(() => undefined);
    await tick();

    // This time the OLD session's SWITCHED close arrives WHILE session_1 is
    // still ChatState.session (the switch has not been confirmed yet) — a
    // legitimate "the session I am currently in just closed" observation at
    // that instant, not the corruption case above.
    h.sockets.last.emitJson(sessionClosedJson('session_1', 'SWITCHED', 40));
    await tick();

    // The switch itself is unaffected by that close either way.
    h.sockets.last.emitJson(
      sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2', status: 'WAITING_FOR_AGENT' }), 41),
    );
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().session?.status).toBe('WAITING_FOR_AGENT');
    expect(client.getState().session?.closedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// retryMessage() — wraps SendQueue.retry() (T9) verbatim, plus the
// wrong-session guard T10 added (T9's primitive cannot see "the current
// session" on its own).
// ---------------------------------------------------------------------------

describe('createChatClient — retryMessage()', () => {
  it('refuses as not-found when nothing failed under that id', async () => {
    const h = harness();
    const client = await connected(h);
    await expect(client.retryMessage('01ARZ3NDEKTSV4RRFFQ69G5FAA')).resolves.toEqual({
      status: 'refused',
      reason: 'not-found',
    });
  });

  it('retries a rejected-but-retryable send: re-queues under the SAME id and shows it as queued again immediately', async () => {
    const h = harness();
    const client = await connected(h);

    await client.sendMessage('will fail');
    await tick();
    const sendFrame = h.sockets.last
      .sentFrames()
      .find((frame) => (frame as { t: string }).t === 'message.send') as { id: string };
    const id = sendFrame.id;

    h.sockets.last.emitJson(
      rejectedAckJson(id, 40, { code: 'RATE_LIMITED', message: 'slow down', retryable: true }),
    );
    await tick();
    expect(client.getState().messages.find((m) => m.id === id)?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'RATE_LIMITED',
      retryable: true,
    });

    const outcome = await client.retryMessage(id);
    expect(outcome.status).toBe('retried');
    if (outcome.status === 'retried') {
      // The ORIGINAL envelope id, verbatim — the server dedupes on it (§9.3).
      expect(outcome.entry.id).toBe(id);
    }

    // Back to 'queued' immediately — no waiting on the eventual outcome to
    // drop the dead bubble's Retry affordance.
    expect(client.getState().messages.find((m) => m.id === id)?.delivery).toEqual({ state: 'queued' });

    // Two message.send frames went out in total (the original attempt, then
    // the replay) — both under the IDENTICAL id, never a second, distinct
    // ULID for what the user experiences as one message.
    const sendFrames = h.sockets.last
      .sentFrames()
      .filter((frame): frame is { t: string; id: string } => (frame as { t: string }).t === 'message.send');
    expect(sendFrames).toHaveLength(2);
    expect(sendFrames.every((frame) => frame.id === id)).toBe(true);

    // And the eventual outcome still arrives the normal way, through the
    // same onAck wiring — retryMessage did not have to rewire anything.
    h.sockets.last.emitJson(genericAckJson(id, 41, { seq: 9 }));
    await tick();
    const finalMessage = client.getState().messages.find((m) => m.id === id);
    expect(finalMessage?.delivery).toBeUndefined();
    expect(finalMessage?.seq).toBe(9);
  });

  it('refuses as not-retryable, and leaves the message failed, when the server said retryable:false', async () => {
    const h = harness();
    const client = await connected(h);

    await client.sendMessage('will fail for good');
    await tick();
    const id = (
      h.sockets.last.sentFrames().find((frame) => (frame as { t: string }).t === 'message.send') as { id: string }
    ).id;

    h.sockets.last.emitJson(
      rejectedAckJson(id, 40, { code: 'VALIDATION_FAILED', message: 'bad content', retryable: false }),
    );
    await tick();

    const outcome = await client.retryMessage(id);
    expect(outcome).toEqual({ status: 'refused', reason: 'not-retryable' });
    // Unchanged — still failed, no re-queue attempt went out.
    expect(client.getState().messages.find((m) => m.id === id)?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
  });

  it("refuses as not-retryable a failure whose ORIGINAL session is no longer the one currently joined (T10's wrong-session guard)", async () => {
    const h = harness();
    const client = await connected(h); // session_1

    // Never acked, so it is still queued when session_1 closes.
    await client.sendMessage('about my resolved order');
    await tick();
    const id = (
      h.sockets.last.sentFrames().find((frame) => (frame as { t: string }).t === 'message.send') as { id: string }
    ).id;

    h.sockets.last.emitJson(sessionClosedJson('session_1', 'RESOLVED', 20));
    await tick();
    expect(client.getState().messages.find((m) => m.id === id)?.delivery).toMatchObject({
      state: 'failed',
      reason: 'sessionClosed',
    });

    const restart = client.startNewSession();
    await tick();
    ackNewSocket(h, sessionSnapshot({ sessionId: 'session_2' }));
    await restart;
    await tick();

    // T9's SendQueue.retry() alone cannot see this: message.send carries no
    // sessionId, so replaying this entry now would silently attribute the
    // old session's message to session_2.
    const outcome = await client.retryMessage(id);
    expect(outcome).toEqual({ status: 'refused', reason: 'not-retryable' });

    // Nothing for it went out on the new socket.
    const sentOnNewSocket = h.sockets.last
      .sentFrames()
      .filter((frame) => (frame as { t: string; id: string }).t === 'message.send' && (frame as { id: string }).id === id);
    expect(sentOnNewSocket).toEqual([]);
  });
});
