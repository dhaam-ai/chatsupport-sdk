// The four edges left open after the teardown switch landed.
//
// The single-click happy path and the five interleavings in
// `session-switch-window.test.ts` are sound and untouched by these. What
// follows are the bounded cases the rebuild did not cover:
//
//   1. a picker click for the session ALREADY on screen, while a switch to a
//      different one is still in flight — the customer changing their mind
//      mid-click. The early return took it as "nothing to do", so the switch
//      it was cancelling went on to land, delivering the customer to the
//      conversation their last click asked to stay away from.
//   2. a `session.updated` that REPLACES the session outside the `connected`
//      handler — reachable through the documented public `joinSession`. The
//      commit correctly cleared the transcript and nothing seeded the
//      replacement: a permanently blank pane, zero history requests, and not
//      even an empty-state placeholder. This is the reported symptom verbatim.
//   3. a REFUSED join. `joinedSessionId` correctly refuses to move, but the
//      socket is still joined to whatever the fresh handshake resolved while
//      the store shows the session being left. Everything the customer then
//      types is scoped away by `SendQueueOptions.joinedSession` and queues
//      forever, with `connectionState: 'connected'` and nothing to render.
//
// Written against the PUBLIC `createChatClient` surface and against observable
// outcomes — never against the mechanism.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import type { ChatMessage } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import type { StubWebSocket } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClient, ChatClientConfig } from './types.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5E${suffix}${suffix}`;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';
const AGENT_ID = 'participant_agent_1';
const PUBLISHABLE_KEY = 'dhp' + '_test_edges1';

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

function genericAckJson(ref: string, idNum: number): unknown {
  return { v: 1, t: 'ack', id: ulid(idNum), ref, ts: 0, d: { ok: true } };
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

function historyMessage(id: string, sessionId: string, seq: number): ChatMessage {
  return {
    id,
    sessionId,
    senderId: AGENT_ID,
    senderType: 'AGENT',
    type: 'TEXT',
    content: `${sessionId} / ${id}`,
    seq,
    createdAt: '2026-08-18T08:00:00.000Z',
  };
}

interface HistoryQuery {
  readonly sessionId: string;
  readonly before?: string;
  readonly limit: number;
}

class SessionHistory implements MessageHistorySource {
  readonly calls: HistoryQuery[] = [];
  readonly pages = new Map<string, MessagePage>();

  async listMessages(query: HistoryQuery): Promise<MessagePage> {
    this.calls.push(query);
    return this.pages.get(query.sessionId) ?? { messages: [], hasMore: false };
  }

  callsFor(sessionId: string): HistoryQuery[] {
    return this.calls.filter((call) => call.sessionId === sessionId);
  }
}

interface Harness {
  readonly sockets: StubSocketFactory;
  readonly timers: ManualTimers;
  readonly history: SessionHistory;
  readonly storage: MemoryStorageAdapter;
  readonly config: ChatClientConfig;
}

function harness(overrides: Partial<ChatClientConfig> = {}): Harness {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const history = new SessionHistory();
  const storage = new MemoryStorageAdapter();

  const config: ChatClientConfig = {
    publishableKey: PUBLISHABLE_KEY,
    getToken: async () => 'tok_edges',
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

function framesOfType(socket: StubWebSocket, t: string): { t: string; id: string; d: Record<string, unknown> }[] {
  return socket
    .sentFrames()
    .filter((frame): frame is { t: string; id: string; d: Record<string, unknown> } => (frame as { t: string }).t === t);
}

async function connected(h: Harness, snapshot = sessionSnapshot()): Promise<ChatClient> {
  const client = createChatClient(h.config);
  const promise = client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson(0, snapshot, 1));
  await promise;
  await tick();
  return client;
}

interface WireDriver {
  step(): Promise<boolean>;
  settle(max?: number): Promise<void>;
  readonly joined: string[];
  readonly handshakes: number;
}

interface DriverOptions {
  readonly resolved?: SessionSnapshot;
  readonly refuse?: ReadonlySet<string>;
}

/** Same mechanism-agnostic wire driver as the window probes. */
function driver(h: Harness, options: DriverOptions = {}): WireDriver {
  let idNum = 500;
  let handshakes = 0;
  const handshaked = new Set<StubWebSocket>();
  const ackedJoins = new Set<string>();
  const joined: string[] = [];
  const announced: string[] = [];
  const refuse = options.refuse ?? new Set<string>();

  const step = async (): Promise<boolean> => {
    let acted = false;
    await tick();

    for (const socket of h.sockets.sockets) {
      if (handshaked.has(socket)) continue;
      handshaked.add(socket);
      handshakes += 1;
      socket.open();
      await tick();
      socket.emitJson(ackJson(0, options.resolved ?? sessionSnapshot(), (idNum += 1)));
      acted = true;
      await tick();
    }

    for (const socket of h.sockets.sockets) {
      for (const frame of framesOfType(socket, 'session.join')) {
        if (ackedJoins.has(frame.id)) continue;
        ackedJoins.add(frame.id);
        const sessionId = String(frame.d.sessionId);
        if (refuse.has(sessionId)) {
          socket.emitJson(
            rejectedAckJson(frame.id, (idNum += 1), {
              code: 'SESSION_NOT_FOUND',
              message: 'not yours',
              retryable: false,
            }),
          );
        } else {
          socket.emitJson(genericAckJson(frame.id, (idNum += 1)));
          joined.push(sessionId);
        }
        acted = true;
        await tick();

        if (!refuse.has(sessionId) && !announced.includes(sessionId)) {
          announced.push(sessionId);
          socket.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId }), (idNum += 1)));
          await tick();
        }
      }
    }

    return acted;
  };

  return {
    step,
    joined,
    get handshakes() {
      return handshakes;
    },
    settle: async (max = 12): Promise<void> => {
      for (let i = 0; i < max; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await step())) return;
      }
      await tick();
    },
  };
}

// ---------------------------------------------------------------------------
// EDGE 1 — clicking the row you are already on, mid-switch
// ---------------------------------------------------------------------------

describe('edge 1: a picker click for the session already on screen', () => {
  it('cancels a switch already in flight instead of letting it land', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: false });
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    expect(client.getState().session?.id).toBe('session_1');

    // Click away — and change your mind before the wire has answered.
    const away = client.switchSession('session_2').catch(() => undefined);
    await tick();
    const stay = client.switchSession('session_1').catch(() => undefined);

    await driver(h).settle();
    await away;
    await stay;
    await tick();

    // The LAST click wins. Landing in session_2 here is the customer being
    // delivered to the conversation they clicked away from.
    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().messages.every((row) => row.sessionId === 'session_1')).toBe(true);
  });

  it('honours the last click when the customer alternates rapidly', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: false });
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: false });

    const client = await connected(h);

    const clicks = [
      client.switchSession('session_2').catch(() => undefined),
      client.switchSession('session_1').catch(() => undefined),
      client.switchSession('session_2').catch(() => undefined),
      client.switchSession('session_1').catch(() => undefined),
    ];

    await driver(h).settle(16);
    await Promise.all(clicks);
    await tick();

    expect(client.getState().session?.id).toBe('session_1');
  });

  it('does not restart the switch a double-click asked for twice', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    const baselineSockets = h.sockets.sockets.length;

    const first = client.switchSession('session_2');
    const second = client.switchSession('session_2');

    const wire = driver(h);
    await wire.settle();
    await first;
    await second;
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    // One click, one teardown, one join, one page-one read — a double-click
    // must not tear down the connection its own first click just opened.
    expect(h.sockets.sockets.length - baselineSockets).toBe(1);
    expect(wire.joined.filter((id) => id === 'session_2')).toHaveLength(1);
    expect(h.history.callsFor('session_2')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// EDGE 2 — an out-of-band session replacement
// ---------------------------------------------------------------------------

describe('edge 2: a session replaced outside the connected handler', () => {
  it('seeds the transcript of a session installed by a raw joinSession', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: false });
    h.history.pages.set('session_5', { messages: [historyMessage('five', 'session_5', 1)], hasMore: false });

    const client = await connected(h);
    await tick();
    expect(client.getState().messages.map((row) => row.id)).toEqual(['one']);

    // The documented public frame. The server acks it and volunteers the
    // snapshot — outside `connected`, so nothing on the restore path runs.
    client.joinSession('session_5');
    await tick();
    const joins = framesOfType(h.sockets.last, 'session.join');
    const join = joins[joins.length - 1];
    expect(join).toBeDefined();
    h.sockets.last.emitJson(genericAckJson(join!.id, 800));
    await tick();
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_5' }), 801));
    await tick();

    expect(client.getState().session?.id).toBe('session_5');
    // A committed session with no history read is the reported symptom: a
    // blank pane that is not even an empty state.
    expect(h.history.callsFor('session_5')).toHaveLength(1);
    expect(client.getState().messages.map((row) => row.id)).toEqual(['five']);
    expect(client.getState().pagination.initialLoaded).toBe(true);
  });

  it('does not double-read page one on the switch path', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    const switching = client.switchSession('session_2');
    await driver(h).settle();
    await switching;
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(h.history.callsFor('session_2')).toHaveLength(1);
    expect(client.getState().messages.map((row) => row.id)).toEqual(['two']);
  });
});

// ---------------------------------------------------------------------------
// EDGE 3 — a refused join must not silently mute the customer
// ---------------------------------------------------------------------------

describe('edge 3: a refused join', () => {
  it('leaves the socket and the store naming the same session, so sends still go out', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    // The fresh handshake resolves a THIRD session (most-recently-updated,
    // ACTIVE only — it carries no session id), and the join for the session
    // the customer picked is refused.
    const failed = client
      .switchSession('session_gone')
      .then(() => null as unknown)
      .catch((error: unknown) => error);

    await driver(h, {
      resolved: sessionSnapshot({ sessionId: 'session_3' }),
      refuse: new Set(['session_gone']),
    }).settle();

    expect(await failed).toBeInstanceOf(Error);
    await tick();

    // The customer is left where they were.
    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().connectionState).toBe('connected');

    // The failure is observable, not silent.
    expect(client.getState().lastError).not.toBeNull();

    // And the customer is not muted: what they type reaches the wire rather
    // than queueing forever against a session the socket is not in.
    await client.sendMessage('are you still there?');
    await tick();

    const sent = h.sockets.sockets.flatMap((socket) => framesOfType(socket, 'message.send'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.d.sessionId).toBe('session_1');
    expect(client.getState().messages.some((row) => row.content === 'are you still there?')).toBe(true);
  });

  it('reports a refusal through the error event as well as lastError', async () => {
    const h = harness();
    const client = await connected(h);
    const errors: unknown[] = [];
    client.on('error', (error) => errors.push(error));

    const failed = client.switchSession('session_gone').catch(() => undefined);
    await driver(h, {
      resolved: sessionSnapshot({ sessionId: 'session_3' }),
      refuse: new Set(['session_gone']),
    }).settle();
    await failed;
    await tick();

    expect(errors.length).toBeGreaterThan(0);
    expect(client.getState().lastError).not.toBeNull();
  });
});
