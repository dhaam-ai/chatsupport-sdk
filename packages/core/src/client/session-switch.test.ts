// The two reported bugs, reproduced at the core level.
//
//   Bug 1 — "click on prev session ... does not load the session messages"
//   Bug 2 — "reload the app ... does not load message of current session"
//
// Both come out of one missing concept: *the session the user chose*. It was
// never reset on switch, never re-seeded, and never durable across a reload.
// Every test below is written against `createChatClient`'s public surface —
// nothing reaches into `MessageController`, `SendQueue` or `ConnectionController`.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, MessagePayload, SessionSnapshot } from '../protocol/index.js';
import type { ChatMessage } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { CLOSE_CODE, StubSocketFactory } from '../transport/index.js';
import type { StubWebSocket } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';
const AGENT_ID = 'participant_agent_1';
const PUBLISHABLE_KEY = 'dhp' + '_test_switch1';
/**
 * Exactly the key `createChatClient` namespaces its durable state under.
 *
 * Three levels, and the third is load-bearing: the publishable key identifies
 * the TENANT, so without the local participant one browser's guest identity
 * and its signed-in identity shared a remembered session and a send queue. See
 * the namespace comment in create-chat-client.ts.
 */
const SELECTED_SESSION_KEY = `chatsdk:${PUBLISHABLE_KEY}:${CUSTOMER_ID}:selectedSession`;

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

function sessionClosedJson(sessionId: string, closeReason: string, idNum: number): unknown {
  return { v: 1, t: 'session.closed', id: ulid(idNum), ts: 0, d: { sessionId, closeReason } };
}

function messageNewJson(idNum: number, seq: number, overrides: Partial<MessagePayload> = {}): unknown {
  const payload: MessagePayload = {
    id: ulid(idNum),
    sessionId: 'session_1',
    senderId: AGENT_ID,
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'live message',
    seq,
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
  return { v: 1, t: 'message.new', id: ulid(idNum), ts: 0, d: payload };
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

/** A history source with a distinct, per-session transcript. */
class SessionHistory implements MessageHistorySource {
  readonly calls: HistoryQuery[] = [];
  readonly pages = new Map<string, MessagePage>();
  /** Number of upcoming calls that should reject. */
  failures = 0;

  /**
   * Sessions whose reads are PARKED — the request is recorded, but the
   * response is withheld until `release(sessionId)`. This is what makes the
   * switch race deterministic: a page-one read issued for the outgoing
   * session can be made to land in the middle of the incoming session's join
   * round trip, which is exactly the window the reported bug lives in.
   */
  readonly held = new Set<string>();
  readonly #parked: { sessionId: string; release: () => void }[] = [];

  async listMessages(query: HistoryQuery): Promise<MessagePage> {
    this.calls.push(query);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('history endpoint unavailable');
    }
    if (this.held.has(query.sessionId)) {
      await new Promise<void>((resolve) => {
        this.#parked.push({ sessionId: query.sessionId, release: resolve });
      });
    }
    return this.pages.get(query.sessionId) ?? { messages: [], hasMore: false };
  }

  /** Lets every parked read for `sessionId` answer, and stops parking new ones. */
  release(sessionId: string): void {
    this.held.delete(sessionId);
    for (const parked of this.#parked.splice(0)) {
      if (parked.sessionId === sessionId) parked.release();
      else this.#parked.push(parked);
    }
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

function harness(
  overrides: Partial<ChatClientConfig> = {},
  storage = new MemoryStorageAdapter(),
  history = new SessionHistory(),
): Harness {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();

  const config: ChatClientConfig = {
    publishableKey: PUBLISHABLE_KEY,
    getToken: async () => 'tok_switch',
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

/** Acks every `session.join` frame written so far that has not been acked yet. */
function ackJoins(h: Harness, startIdNum = 60): void {
  let idNum = startIdNum;
  for (const frame of framesOfType(h.sockets.last, 'session.join')) {
    h.sockets.last.emitJson(genericAckJson(frame.id, idNum));
    idNum += 1;
  }
}

/**
 * Drives the wire through a `switchSession()`.
 *
 * `switchSession` is a TEARDOWN and a re-establish, not an in-place join (see
 * `switchToSession` in create-chat-client.ts), so a test has to answer two
 * things rather than one:
 *
 *   1. the fresh socket's `connection.ack` — `connection.hello` carries no
 *      session id, so the server resolves the customer's most-recently-updated
 *      ACTIVE session on its own, which for a picked CLOSED/RESOLVED session is
 *      a DIFFERENT conversation. `resolved` is that answer;
 *   2. the one explicit `session.join` that corrects it, and the
 *      `session.updated` snapshot the server volunteers after acking it.
 *
 * Deliberately driven step by step rather than in one call, so a test can stop
 * the wire at any point and release a parked history read into the gap.
 */
interface SwitchWireOptions {
  /** What the server resolves for the fresh hello. Defaults to session_1. */
  readonly resolved?: SessionSnapshot;
  /** Refuse `session.join` for these ids instead of acking them. */
  readonly refuse?: readonly string[];
  /** Ack the join but withhold the `session.updated` snapshot. */
  readonly withhold?: readonly string[];
  /** The snapshot pushed for an acked join. */
  readonly snapshotFor?: (sessionId: string) => SessionSnapshot;
}

function switchWire(h: Harness, options: SwitchWireOptions = {}) {
  let idNum = 300;
  const handshaked = new Set<StubWebSocket>();
  const answered = new Set<string>();
  const announced = new Set<string>();
  const joined: string[] = [];
  const refuse = new Set(options.refuse ?? []);
  const withhold = new Set(options.withhold ?? []);
  const snapshotFor = options.snapshotFor ?? ((id: string): SessionSnapshot => sessionSnapshot({ sessionId: id }));

  /** Completes the handshake on any socket the client opened but nobody drove. */
  const handshake = async (): Promise<boolean> => {
    let acted = false;
    await tick();
    for (const socket of h.sockets.sockets) {
      if (handshaked.has(socket)) continue;
      handshaked.add(socket);
      socket.open();
      await tick();
      socket.emitJson(ackJson(0, options.resolved ?? sessionSnapshot(), (idNum += 1)));
      await tick();
      acted = true;
    }
    return acted;
  };

  /** Acks (or refuses) every unanswered `session.join`, then pushes its snapshot. */
  const answerJoins = async (): Promise<boolean> => {
    let acted = false;
    await tick();
    for (const socket of h.sockets.sockets) {
      for (const frame of framesOfType(socket, 'session.join')) {
        if (answered.has(frame.id)) continue;
        answered.add(frame.id);
        acted = true;
        const sessionId = String(frame.d.sessionId);
        if (refuse.has(sessionId)) {
          socket.emitJson(
            rejectedAckJson(frame.id, (idNum += 1), {
              code: 'SESSION_NOT_FOUND',
              message: 'not yours',
              retryable: false,
            }),
          );
          await tick();
          continue;
        }
        socket.emitJson(genericAckJson(frame.id, (idNum += 1)));
        joined.push(sessionId);
        await tick();
        if (!withhold.has(sessionId) && !announced.has(sessionId)) {
          announced.add(sessionId);
          socket.emitJson(sessionUpdatedJson(snapshotFor(sessionId), (idNum += 1)));
          await tick();
        }
      }
    }
    return acted;
  };

  /** Pushes a withheld snapshot by hand. */
  const announce = async (sessionId: string): Promise<void> => {
    announced.add(sessionId);
    h.sockets.last.emitJson(sessionUpdatedJson(snapshotFor(sessionId), (idNum += 1)));
    await tick();
  };

  return {
    handshake,
    answerJoins,
    announce,
    joined,
    /** Runs handshakes and joins until the wire goes quiet. */
    settle: async (max = 6): Promise<void> => {
      for (let i = 0; i < max; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const acted = (await handshake()) || (await answerJoins());
        if (!acted) return;
      }
      await tick();
    },
  };
}

async function connected(h: Harness, snapshot = sessionSnapshot()): Promise<ReturnType<typeof createChatClient>> {
  const client = createChatClient(h.config);
  const promise = client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson(0, snapshot, 1));
  await promise;
  await tick();
  return client;
}

// ---------------------------------------------------------------------------
// BUG 1 — switching to a past session must replace the transcript
// ---------------------------------------------------------------------------

describe('bug 1: switchSession replaces the session rather than only sending a frame', () => {
  it('clears every per-session projection, keeps pastSessions, and loads the new transcript', async () => {
    const h = harness();
    h.history.pages.set('session_2', {
      messages: [historyMessage('hist_a', 'session_2', 1), historyMessage('hist_b', 'session_2', 2)],
      hasMore: false,
    });
    const client = await connected(h);

    // Populate the OLD session's projections so a leak is visible.
    h.sockets.last.emitJson(messageNewJson(50, 1, { content: 'old session transcript' }));
    h.sockets.last.emitJson({
      v: 1,
      t: 'typing.start',
      id: ulid(51),
      ts: 0,
      d: { participantId: AGENT_ID },
    });
    h.sockets.last.emitJson({
      v: 1,
      t: 'presence.update',
      id: ulid(52),
      ts: 0,
      d: { participantId: AGENT_ID, status: 'ONLINE' },
    });
    h.sockets.last.emitJson({
      v: 1,
      t: 'message.read',
      id: ulid(53),
      ts: 0,
      d: { participantId: AGENT_ID, readAt: '2026-08-18T10:05:00.000Z' },
    });
    await tick();
    expect(client.getState().messages.length).toBeGreaterThan(0);
    expect(client.getState().readWatermarks).not.toEqual({});

    const pastSessions = client.getState().pastSessions;

    const wire = switchWire(h, { snapshotFor: (id) => sessionSnapshot({ sessionId: id, status: 'CLOSED' }) });
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    expect(state.messages.map((message) => message.id)).toEqual(['hist_a', 'hist_b']);
    expect(state.messages.every((message) => message.sessionId === 'session_2')).toBe(true);
    expect(state.pagination).toEqual({ hasMore: false, loadingMore: false, initialLoaded: true });
    expect(state.readWatermarks).toEqual({});
    expect(state.deliveredWatermarks).toEqual({});
    expect(state.presence).toEqual({});
    expect(state.typing.isTyping).toBe(false);
    expect(state.unreadCount).toBe(0);
    expect(state.lastError).toBeNull();
    // `pastSessions` is a list ABOUT other sessions, not state OF this one.
    expect(state.pastSessions).toEqual(pastSessions);
  });

  it('issues exactly one history request for the NEW session, with no cross-session `before` cursor', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: true });
    const client = await connected(h);
    await tick();

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;

    const calls = h.history.callsFor('session_2');
    expect(calls).toHaveLength(1);
    // `before` absent — a cursor taken from the OLD session's oldest message
    // would ask the server to page a session it does not belong to.
    expect(calls[0]?.before).toBeUndefined();
  });

  it('never lets a subscriber observe the new session id against the old transcript', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('hist_a', 'session_2', 1)], hasMore: false });
    const client = await connected(h);
    h.sockets.last.emitJson(messageNewJson(50, 1, { content: 'old session transcript' }));
    await tick();

    const torn: string[] = [];
    client.subscribe((state) => {
      const foreign = state.messages.filter(
        (message) => state.session !== null && message.sessionId !== state.session.id,
      );
      if (foreign.length > 0) torn.push(`${state.session?.id ?? 'null'}<-${foreign[0]?.sessionId ?? '?'}`);
    });

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    expect(torn).toEqual([]);
  });

  it('PRESERVES the outgoing session\'s queued sends, and never puts them on a wire joined elsewhere', async () => {
    // This reverses what this file used to assert, deliberately.
    //
    // `switchSession` used to `abandonSession(previous)`, because
    // `message.send` carried no `sessionId` and an entry that outlived its
    // session would be filed under whichever session was joined next. That
    // hazard is now closed twice over and independently: every entry is
    // stamped with the session it was COMPOSED in
    // (`MessageSendPayload.sessionId`), and the queue's `joinedSession`
    // scoping refuses to pump any session but the joined one — so the frame
    // cannot be misdelivered even against a server that ignores the field.
    //
    // What abandoning still cost was real and unrecoverable: it failed the
    // customer's own unsent words with `sessionClosed` for a session that had
    // not closed, and `retryMessage` then REFUSES them for belonging to a
    // session that is no longer current. There is no public call that gets
    // that message back. Preserved, it waits — never on the wire, never lost
    // — and drains the moment its session is joined again.
    const h = harness();
    const client = await connected(h);

    const failures: unknown[] = [];
    client.on('sendFailed', (failure) => failures.push(failure));

    // Never acked, so it is still queued when the switch begins.
    await client.sendMessage('about the old conversation');
    await tick();

    const wire = switchWire(h, { resolved: sessionSnapshot({ sessionId: 'session_1' }) });
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    // Not failed, not deleted — the user's words survive the switch.
    expect(failures).toEqual([]);

    // And not written into session_2 either: the only `message.send` on the
    // new connection would be a cross-conversation delivery.
    const sends = framesOfType(h.sockets.last, 'message.send');
    expect(sends.filter((frame) => frame.d.sessionId === 'session_2')).toHaveLength(0);

    // It goes out only when its own session is joined again.
    const back = switchWire(h, { resolved: sessionSnapshot({ sessionId: 'session_2' }) });
    const returning = client.switchSession('session_1');
    await back.settle();
    await returning;
    await tick();

    const delivered = framesOfType(h.sockets.last, 'message.send');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.d.sessionId).toBe('session_1');
  });

  it('forgets the resume anchor, so the hello after a switch omits resumeFrom', async () => {
    const h = harness();
    const client = await connected(h);

    h.sockets.last.emitJson(messageNewJson(50, 7));
    await tick();

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    h.timers.advance(60_000);
    await tick();
    h.sockets.last.open(); // the hello is written once the socket opens
    await tick();

    const hello = framesOfType(h.sockets.last, 'connection.hello')[0];
    expect(hello).toBeDefined();
    // A `resumeFrom` from the OLD session's history is answered with a
    // NON-RETRYABLE VALIDATION_FAILED, stranding the client in `suspended`.
    expect(hello?.d.resumeFrom).toBeUndefined();
  });

  it('resolves only once the new transcript is in state', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('hist_a', 'session_2', 1)], hasMore: false });
    const client = await connected(h);

    const wire = switchWire(h, { withhold: ['session_2'] });

    let settled = false;
    const switching = client.switchSession('session_2').then(() => {
      settled = true;
    });

    await tick();
    expect(settled).toBe(false); // the socket has not even handshaked yet

    await wire.handshake();
    expect(settled).toBe(false); // ...and the ack names whatever the SERVER resolved

    await wire.answerJoins();
    expect(settled).toBe(false); // the join ack is EmptyAckData — it proves nothing about state

    await wire.announce('session_2');
    await switching;

    expect(settled).toBe(true);
    expect(client.getState().messages.map((m) => m.id)).toEqual(['hist_a']);
  });

  it('leaves the LAST of two concurrent switches holding the transcript', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('from_2', 'session_2', 1)], hasMore: false });
    h.history.pages.set('session_3', { messages: [historyMessage('from_3', 'session_3', 1)], hasMore: false });
    const client = await connected(h);

    const wire = switchWire(h);
    // The loser's own teardown is aborted by the winner's, so it resolves
    // quietly rather than reporting a failure nobody asked about.
    const second = client.switchSession('session_2');
    const third = client.switchSession('session_3');
    await wire.settle();

    await second;
    await third;
    await tick();

    expect(client.getState().session?.id).toBe('session_3');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['from_3']);
    // The superseded switch must not prepend its page into the winner.
    expect(h.history.callsFor('session_2')).toHaveLength(0);
  });

  it('rejects — rather than silently dropping — a join the server refuses', async () => {
    const h = harness();
    const client = await connected(h);
    const errors: unknown[] = [];
    client.on('error', (error) => errors.push(error));

    const wire = switchWire(h, { refuse: ['session_not_owned'] });
    const switching = client.switchSession('session_not_owned');
    await wire.settle();

    await expect(switching).rejects.toThrow();
    await tick();

    expect(errors).toHaveLength(1);
    expect(client.getState().lastError?.code).toBe('SESSION_NOT_FOUND');
    // The session the client WAS in is untouched.
    expect(client.getState().session?.id).toBe('session_1');
  });

  it('does not silently resolve while the connection it needs is still down', async () => {
    // The teardown rebuild changed what a dead socket MEANS here. The
    // in-place version wrote `session.join` onto whatever socket it had and
    // failed outright when that socket was closed; this one opens its own
    // connection, so a dead socket is something it recovers from rather than
    // something it reports. What must not change is the half this test was
    // written for: it must never resolve having accomplished nothing.
    const h = harness();
    const client = await connected(h);

    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();

    let settled: 'resolved' | 'rejected' | null = null;
    const switching = client.switchSession('session_2').then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );

    await tick();
    h.timers.advance(60_000);
    await tick();
    expect(settled).toBeNull();
    // The customer is still looking at the conversation they have not left.
    expect(client.getState().session?.id).toBe('session_1');

    // An explicit disconnect aborts the connect the switch is waiting on, and
    // THAT is reported rather than swallowed.
    client.disconnect();
    await switching;
    expect(settled).toBe('rejected');
  });

  it('never takes the transcript away in the first place when the join is refused', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('mine', 'session_1', 1)], hasMore: false });
    const client = await connected(h);
    await tick();
    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);

    const wire = switchWire(h, { refuse: ['session_not_owned'] });
    const switching = client.switchSession('session_not_owned');

    // Mid-switch, before the wire has answered anything: the outgoing session
    // is still whole. The old design reset here and had to ROLL BACK on
    // failure — a rollback is a second write, and every probe that beat the
    // earlier rounds landed in the gap between the two.
    await tick();
    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);

    await wire.settle();
    await expect(switching).rejects.toThrow();
    await tick();

    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);
    expect(client.getState().lastError?.code).toBe('SESSION_NOT_FOUND');
    // No recovery read was needed, because nothing was destroyed.
    expect(h.history.callsFor('session_1')).toHaveLength(1);
  });

  it('keeps the transcript on screen for the whole of a switch that never completes', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('mine', 'session_1', 1)], hasMore: false });
    const client = await connected(h);
    await tick();

    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();

    const switching = client.switchSession('session_2').catch(() => undefined);
    await tick();
    h.timers.advance(60_000);
    await tick();

    // Never a blank pane, at any point — not while it is in flight...
    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);

    client.disconnect();
    await switching;
    await tick();

    // ...and not after it gives up.
    expect(client.getState().session?.id).toBe('session_1');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);
  });

  it('never nulls ChatState.session mid-switch, so a concurrent send does not throw', async () => {
    const h = harness();
    const client = await connected(h);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await tick();

    // Nulling `session` during the window would make this reject with
    // NoActiveSessionError and blank a binding's header. The teardown rebuild
    // strengthens this rather than weakening it: the outgoing session is not
    // merely non-null, it is UNCHANGED — header, transcript and all — until
    // the incoming one replaces it in a single write.
    expect(client.getState().session?.id).toBe('session_1');
    await expect(client.sendMessage('typed mid-switch')).resolves.toBeUndefined();
    // And the message is addressed to the conversation it was composed in.
    const composed = client.getState().messages;
    expect(composed[composed.length - 1]?.sessionId).toBe('session_1');

    await wire.settle();
    await switching;
  });

  it('emits no statusChange when the switch lands on a session with a different status (RC13)', async () => {
    const h = harness();
    const client = await connected(h); // session_1, ASSIGNED

    const changes: unknown[] = [];
    client.on('statusChange', (payload) => changes.push(payload));

    const wire = switchWire(h, { snapshotFor: (id) => sessionSnapshot({ sessionId: id, status: 'CLOSED' }) });
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    // A DIFFERENT session having a different status is not "your chat's
    // status changed" — it is a different chat.
    expect(changes).toEqual([]);
    expect(client.getState().session?.status).toBe('CLOSED');
  });

  it('is idempotent — switching to the session already joined does nothing', async () => {
    const h = harness();
    const client = await connected(h);
    h.sockets.last.emitJson(messageNewJson(50, 1, { content: 'still here' }));
    await tick();

    await client.switchSession('session_1');
    await tick();

    expect(framesOfType(h.sockets.last, 'session.join')).toHaveLength(0);
    expect(client.getState().messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RC5/RC7 — core seeds the first page on connect, so every binding gets it
// ---------------------------------------------------------------------------

describe('core seeds the first page of history on connect', () => {
  it('fetches page one once connected, without any binding asking', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('seed', 'session_1', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    expect(h.history.callsFor('session_1')).toHaveLength(1);
    expect(h.history.callsFor('session_1')[0]?.before).toBeUndefined();
    expect(client.getState().messages.map((m) => m.id)).toEqual(['seed']);
    expect(client.getState().pagination.initialLoaded).toBe(true);
  });

  it('does not re-request page one on reconnect, so it cannot fight the user\'s scroll-back', async () => {
    const h = harness();
    const client = await connected(h);
    await tick();
    expect(h.history.callsFor('session_1')).toHaveLength(1);

    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    h.timers.advance(60_000);
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 80));
    await tick();

    expect(client.getState().connectionState).toBe('connected');
    expect(h.history.callsFor('session_1')).toHaveLength(1);
  });

  it('a FAILED first load does not latch — a retry still fetches (RC7)', async () => {
    const h = harness();
    h.history.failures = 1;
    h.history.pages.set('session_1', { messages: [historyMessage('seed', 'session_1', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    expect(h.history.callsFor('session_1')).toHaveLength(1);
    expect(client.getState().messages).toHaveLength(0);
    expect(client.getState().pagination.initialLoaded).toBe(false);
    expect(client.getState().lastError).not.toBeNull();

    await client.loadOlderMessages();
    await tick();

    expect(h.history.callsFor('session_1')).toHaveLength(2);
    expect(client.getState().messages.map((m) => m.id)).toEqual(['seed']);
    expect(client.getState().pagination.initialLoaded).toBe(true);
  });

  it('rehydrated queue entries do not suppress the connect-time seed (RC6)', async () => {
    const storage = new MemoryStorageAdapter();

    // "Process one": queue a send with the socket down, so it persists.
    const h1 = harness({}, storage);
    const client1 = await connected(h1);
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('typed just before the reload').catch(() => undefined);
    await tick();
    expect(client1.getState().messages).toHaveLength(1);
    client1.disconnect();

    // "Process two": same storage, brand-new client.
    const h2 = harness({}, storage);
    const client2 = createChatClient(h2.config);
    await tick();
    expect(client2.getState().messages).toHaveLength(1); // rehydrated, non-empty

    h2.history.pages.set('session_1', { messages: [historyMessage('seed', 'session_1', 1)], hasMore: false });

    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 90));
    await connecting;
    await tick();

    // A non-empty list must not be mistaken for "history already loaded".
    expect(h2.history.callsFor('session_1')).toHaveLength(1);
    expect(client2.getState().messages.map((m) => m.id)).toContain('seed');
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — the chosen session must survive a reload
// ---------------------------------------------------------------------------

describe('bug 2: the selected session is durable across a reload', () => {
  it('persists the session the user switched to', async () => {
    const h = harness();
    const client = await connected(h);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();

    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_2');
  });

  it('re-joins the persisted session on connect instead of accepting the ack\'s active session', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(SELECTED_SESSION_KEY, 'session_2');

    const h = harness({}, storage);
    h.history.pages.set('session_2', { messages: [historyMessage('kept', 'session_2', 1)], hasMore: false });

    const client = createChatClient(h.config);
    const connecting = client.connect();
    await tick();
    h.sockets.last.open();
    // `ConnectionHelloPayload` has no sessionId, so the server re-resolves the
    // customer's most recently updated ACTIVE session — usually NOT the one
    // the customer was reading.
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_1' }), 90));
    await connecting;
    await tick();

    const join = framesOfType(h.sockets.last, 'session.join')[0];
    expect(join?.d).toEqual({ sessionId: 'session_2' });

    ackJoins(h, 91);
    await tick();
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 95));
    await tick();

    expect(client.getState().session?.id).toBe('session_2');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['kept']);
  });

  it('records the session a fresh conversation opened, and never re-joins the abandoned one', async () => {
    const h = harness();
    const client = await connected(h);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();
    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_2');

    const restart = client.startNewSession();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_9' }), 96));
    await restart;
    await tick();

    expect(client.getState().session?.id).toBe('session_9');
    // Not session_2: a reload must land on the conversation just opened.
    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_9');
    expect(framesOfType(h.sockets.last, 'session.join')).toHaveLength(0);
  });

  it('carries a subject/topic payload onto the hello the restart sends', async () => {
    const h = harness();
    const client = await connected(h);

    const restart = client.startNewSession({ subject: 'Order never arrived', topic: 'Delivery issue' });
    await tick();
    h.sockets.last.open();

    const hello = framesOfType(h.sockets.last, 'connection.hello')[0];
    expect(hello?.d).toMatchObject({
      newSession: true,
      subject: 'Order never arrived',
      topic: 'Delivery issue',
    });

    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_9' }), 96));
    await restart;
  });

  it('starts a new session with no topic exactly as before when called with no payload', async () => {
    const h = harness();
    const client = await connected(h);

    const restart = client.startNewSession();
    await tick();
    h.sockets.last.open();

    const hello = framesOfType(h.sockets.last, 'connection.hello')[0];
    expect(hello?.d).toMatchObject({ newSession: true });
    expect(hello?.d).not.toHaveProperty('subject');
    expect(hello?.d).not.toHaveProperty('topic');

    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_9' }), 96));
    await restart;
  });

  it('forgets the selection when that session closes', async () => {
    const h = harness();
    const client = await connected(h);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await wire.settle();
    await switching;
    await tick();
    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_2');

    h.sockets.last.emitJson(sessionClosedJson('session_2', 'RESOLVED', 75));
    await tick();

    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBeNull();
  });

  it('keeps the selection when the restore fails for a TRANSPORT reason, not a refusal', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(SELECTED_SESSION_KEY, 'session_2');

    const h = harness({}, storage);
    const client = createChatClient(h.config);
    const connecting = client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 90));
    await connecting;
    await tick();

    // The socket dies before the join can be acked. That says nothing about
    // whether session_2 is still the customer's — erasing their choice over a
    // flaky network would turn a blip into a lost conversation.
    h.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();

    await expect(storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_2');
  });

  it('forgets the selection when the server refuses the join', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(SELECTED_SESSION_KEY, 'session_gone');

    const h = harness({}, storage);
    const client = createChatClient(h.config);
    const connecting = client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot(), 90));
    await connecting;
    await tick();

    const join = framesOfType(h.sockets.last, 'session.join')[0];
    expect(join?.d).toEqual({ sessionId: 'session_gone' });
    h.sockets.last.emitJson(
      rejectedAckJson(join?.id ?? '', 92, { code: 'SESSION_NOT_FOUND', message: 'gone', retryable: false }),
    );
    await tick();

    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBeNull();
    // ...and the client falls back to the session the ack gave it, seeded.
    expect(client.getState().session?.id).toBe('session_1');
    expect(h.history.callsFor('session_1')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RC9 — messages from a session that is not the current one never render
// ---------------------------------------------------------------------------

describe('cross-session message rows are dropped', () => {
  it('ignores a message.new for a session the client is not in', async () => {
    const h = harness();
    const client = await connected(h);

    h.sockets.last.emitJson(messageNewJson(55, 3, { sessionId: 'session_other', content: 'not yours' }));
    await tick();

    expect(client.getState().messages).toHaveLength(0);
  });

  it('drops history rows belonging to a different session', async () => {
    const h = harness();
    h.history.pages.set('session_1', {
      messages: [historyMessage('mine', 'session_1', 1), historyMessage('theirs', 'session_other', 2)],
      hasMore: false,
    });

    const client = await connected(h);
    await tick();

    expect(client.getState().messages.map((m) => m.id)).toEqual(['mine']);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1 — a history read issued for the OUTGOING session, answered after
// the switch began, must not touch the incoming session's state.
//
// This is the shape an independent verifier reproduced against the public
// surface after the first fix landed: `switchSession()` RESOLVED, with no
// throw and no `lastError`, and left the NEW session's id sitting on top of
// the OLD session's messages, having never asked for the new session's
// history at all.
// ---------------------------------------------------------------------------

describe('a page-one read for the outgoing session cannot survive a switch', () => {
  it('does not latch the old page, and still loads the NEW session\'s transcript', async () => {
    const h = harness();
    // Page one for session_1 is issued by the connect-time seed and parked.
    h.history.held.add('session_1');
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: false });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    expect(h.history.callsFor('session_1')).toHaveLength(1);
    expect(client.getState().pagination.initialLoaded).toBe(false); // still parked

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await tick();

    // The old session's page answers DURING the switch — after it began,
    // before the incoming session's snapshot has landed.
    h.history.release('session_1');
    await tick();

    await wire.settle();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    // Not ['old_1'] — the outgoing session's rows are not this session's.
    expect(state.messages.map((m) => m.id)).toEqual(['new_1']);
    // ...and the latched `initialLoaded`/`hasMore` must not have silenced the
    // switch's own seed.
    expect(h.history.callsFor('session_2')).toHaveLength(1);
    expect(state.pagination).toEqual({ hasMore: false, loadingMore: false, initialLoaded: true });
    expect(state.lastError).toBeNull();
  });

  it('does not splice the two transcripts together when the old page had more', async () => {
    const h = harness();
    h.history.held.add('session_1');
    // `hasMore: true` — the switch's own load is NOT silenced this time, so
    // its page is prepended onto whatever the stale page left behind.
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: false });

    const client = await connected(h);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await tick();
    h.history.release('session_1');
    await tick();
    await wire.settle();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    // One conversation, not two.
    expect(state.messages.map((m) => m.id)).toEqual(['new_1']);
    expect(state.messages.every((m) => m.sessionId === 'session_2')).toBe(true);
    expect(state.pagination.hasMore).toBe(false); // session_2's answer, not session_1's
  });

  it('leaves loadMore usable after a stale read is discarded', async () => {
    const h = harness();
    h.history.held.add('session_1');
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: true });

    const client = await connected(h);
    expect(h.history.callsFor('session_1')).toHaveLength(1); // parked

    // The raw frame API, NOT switchSession: this replaces the session with no
    // per-session reset and no switch generation bump, so the parked read is
    // stale purely because the session id moved underneath it. Nothing else
    // will clear `loadingMore` on its behalf.
    client.joinSession('session_2');
    await tick();
    ackJoins(h);
    await tick();
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 70));
    await tick();
    expect(client.getState().session?.id).toBe('session_2');

    h.history.release('session_1');
    await tick();

    // The stale page belongs to a conversation nobody is reading, so not one
    // of its rows lands.
    expect(client.getState().messages.every((m) => m.sessionId === 'session_2')).toBe(true);
    // A committed session always gets its history read, whichever path
    // committed it — a raw `joinSession` included (see `seedReplacedSession`).
    // This assertion used to read `messages).toHaveLength(0)`: the blank pane
    // with zero history requests WAS the reported symptom, pinned here by
    // accident because nothing on this path had ever seeded.
    expect(h.history.callsFor('session_2')).toHaveLength(1);
    expect(client.getState().messages.map((m) => m.id)).toEqual(['new_1']);
    // ...and the read that was discarded must not leave `loadingMore` latched,
    // or the reentrancy guard jams and every later page request is a silent
    // no-op — the transcript would never appear at all.
    expect(client.getState().pagination.loadingMore).toBe(false);

    await client.loadOlderMessages();
    await tick();

    expect(h.history.callsFor('session_2')).toHaveLength(2);
    expect(h.history.calls[h.history.calls.length - 1]?.before).toBe('new_1');
    expect(client.getState().messages.map((m) => m.id)).toEqual(['new_1']);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — `message.send` carries no sessionId, so a queued send is filed
// under whatever session is joined when it goes out.
// ---------------------------------------------------------------------------

describe('queued sends never flush into a session they were not typed in', () => {
  it('holds the flush until the remembered session has been re-joined', async () => {
    const storage = new MemoryStorageAdapter();

    // Process one: the customer is in session_2 and types with the socket down.
    const h1 = harness({}, storage);
    const client1 = await connected(h1, sessionSnapshot({ sessionId: 'session_2' }));
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('about my session_2 order').catch(() => undefined);
    await tick();
    client1.disconnect();
    // Stated explicitly rather than leaned on from another fix.
    await storage.set(SELECTED_SESSION_KEY, 'session_2');

    // Process two: the server re-resolves the customer to session_1.
    const h2 = harness({}, storage);
    const client2 = createChatClient(h2.config);
    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_1' }), 90));
    await connecting;
    await tick();

    // session_1 is joined right now. The send belongs to session_2 and the
    // wire frame carries no sessionId, so anything delivered here is filed
    // under the wrong conversation — irreversibly.
    expect(framesOfType(h2.sockets.last, 'message.send')).toHaveLength(0);

    ackJoins(h2, 91);
    await tick();
    h2.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 95));
    await tick();

    expect(client2.getState().session?.id).toBe('session_2');
    const order = h2.sockets.last.sentFrames().map((frame) => (frame as { t: string }).t);
    expect(order.indexOf('message.send')).toBeGreaterThan(order.indexOf('session.join'));
    expect(framesOfType(h2.sockets.last, 'message.send')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 3 — bug 2 was only half durable: nothing was remembered unless the
// customer made an explicit pick.
// ---------------------------------------------------------------------------

describe('the session the connection established is remembered too', () => {
  it('records it with no explicit pick anywhere', async () => {
    const h = harness();
    const client = await connected(h);
    await tick();

    expect(client.getState().session?.id).toBe('session_1');
    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBe('session_1');
  });

  it('comes back to it on the next reload, even when the server resolves another', async () => {
    const storage = new MemoryStorageAdapter();

    const h1 = harness({}, storage);
    await connected(h1); // ordinary connect into session_1 — no pick, no switch
    await tick();

    const h2 = harness({}, storage);
    h2.history.pages.set('session_1', { messages: [historyMessage('kept', 'session_1', 1)], hasMore: false });
    const client2 = createChatClient(h2.config);
    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_9' }), 90));
    await connecting;
    await tick();

    expect(framesOfType(h2.sockets.last, 'session.join')[0]?.d).toEqual({ sessionId: 'session_1' });
    ackJoins(h2, 91);
    await tick();
    h2.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_1' }), 95));
    await tick();

    expect(client2.getState().session?.id).toBe('session_1');
    expect(client2.getState().messages.map((m) => m.id)).toEqual(['kept']);
  });

  it('does not pin the customer to a session that is already finished', async () => {
    const h = harness();
    await connected(h, sessionSnapshot({ status: 'RESOLVED' }));
    await tick();

    // The server resolves ACTIVE sessions on its own. Recording a dead one
    // would override that resolution on the next reload and drop the customer
    // back into a conversation that cannot be continued.
    await expect(h.storage.get(SELECTED_SESSION_KEY)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ROOT A — during a switch there was no representation of "the session this
// client is now committed to".
//
// `performSwitch` bumps the epoch, resets per-session state, then awaits the
// join round trip. For that whole window `ChatState.session` STILL NAMES THE
// OUTGOING SESSION (deliberately — nulling it would make a concurrent
// `sendMessage` throw). So a history read ISSUED inside the window resolved
// its target from `ChatState.session?.id` and got the session being LEFT, and
// `#isStale` then compared that target against the same stale value and
// answered "fresh". The epoch half cannot save it either: the epoch is bumped
// once, up front, so a read issued after the bump samples the already-current
// value.
//
// The trigger is ordinary public API: the widget wires
// `onLoadOlder: () => client.loadOlderMessages()` to its scroll handler, and
// the switch's own `resetPerSessionState()` empties `messages` — which is
// exactly the list mutation a scroll handler reacts to.
// ---------------------------------------------------------------------------

describe('a history read issued DURING the switch window belongs to the INCOMING session', () => {
  it('pages the incoming session when the read answers before the join ack', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    await tick();
    expect(client.getState().messages.map((m) => m.id)).toEqual(['old_1']);
    expect(h.history.callsFor('session_1')).toHaveLength(1);

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await tick();

    // Mid-window, through the public surface the widget itself wires.
    // `ChatState.session` still names session_1 and still holds session_1's
    // rows, so this read is unambiguously session_1's — and is discarded on
    // the switch generation rather than being allowed to latch `initialLoaded`
    // under the incoming session.
    await client.loadOlderMessages();
    await tick();

    await wire.settle();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    // Two reads for the session being LEFT at most — the connect-time seed and
    // the mid-switch scroll — and NEITHER of them may survive into session_2.
    expect(h.history.callsFor('session_2')).toHaveLength(1);
    expect(state.messages.map((m) => m.id)).toEqual(['new_1']);
    expect(state.messages.every((m) => m.sessionId === 'session_2')).toBe(true);
    expect(state.pagination.loadingMore).toBe(false);
    expect(state.pagination.initialLoaded).toBe(true);
  });

  it('pages the incoming session when the read answers between the ack and session.updated', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    // Both parked, so the read is held whichever session it went to — the
    // assertion cannot be smuggled in by the parking itself.
    h.history.held.add('session_1');
    h.history.held.add('session_2');

    const wire = switchWire(h, { withhold: ['session_2'] });
    const switching = client.switchSession('session_2');
    await tick();
    void client.loadOlderMessages();
    await tick();

    await wire.handshake();
    await wire.answerJoins();

    // The gap the ack does NOT close: `session.join`'s ack is EmptyAckData, so
    // `ChatState.session` still names session_1 right here — together with
    // session_1's transcript, which is the point.
    expect(client.getState().session?.id).toBe('session_1');
    h.history.release('session_1');
    h.history.release('session_2');
    await tick();

    await wire.announce('session_2');
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    expect(state.messages.map((m) => m.id)).toEqual(['new_1']);
    expect(state.pagination.loadingMore).toBe(false);
    expect(state.pagination.initialLoaded).toBe(true);
  });

  it('still ends up with the incoming transcript when the read answers after the seed started', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old_1', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new_1', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    h.history.held.add('session_1');
    h.history.held.add('session_2');

    const wire = switchWire(h);
    const switching = client.switchSession('session_2');
    await tick();
    void client.loadOlderMessages();
    await tick();

    await wire.settle(); // the seed for session_2 is issued in here

    h.history.release('session_1');
    await tick();
    h.history.release('session_2');
    await tick();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    // Whichever read wins the `loadingMore` slot, the transcript on screen is
    // the incoming session's — never a blank pane, never the outgoing one's.
    expect(state.messages.map((m) => m.id)).toEqual(['new_1']);
    expect(state.pagination.initialLoaded).toBe(true);
    expect(state.pagination.loadingMore).toBe(false);
  });

  it('follows the LAST target through a double switch', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('two_1', 'session_2', 1)], hasMore: false });
    h.history.pages.set('session_3', { messages: [historyMessage('three_1', 'session_3', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    const wire = switchWire(h);
    const first = client.switchSession('session_2').catch(() => undefined);
    await tick();
    const second = client.switchSession('session_3').catch(() => undefined);
    await tick();

    await client.loadOlderMessages();
    await tick();

    await wire.settle();
    await first;
    await second;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_3');
    expect(state.messages.map((m) => m.id)).toEqual(['three_1']);
    // Never the abandoned intermediate target, never the session left behind.
    expect(h.history.callsFor('session_2')).toHaveLength(0);
    expect(h.history.callsFor('session_1')).toHaveLength(1);
    expect(state.pagination.loadingMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ROOT B (client half) — a send is addressed by the session it was TYPED in,
// and the queue only ever pumps the session the connection is actually joined
// to.
// ---------------------------------------------------------------------------

describe('the send queue addresses its own session', () => {
  it('stamps every message.send with the queue entry\'s own sessionId', async () => {
    const h = harness();
    const client = await connected(h);

    await client.sendMessage('addressed');
    await tick();

    const sends = framesOfType(h.sockets.last, 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]?.d.sessionId).toBe('session_1');
  });

  it('does not pump a THIRD session\'s entries over a connection joined elsewhere', async () => {
    const storage = new MemoryStorageAdapter();

    // Process one: the customer types in session_3 with the socket down.
    const h1 = harness({}, storage);
    const client1 = await connected(h1, sessionSnapshot({ sessionId: 'session_3' }));
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('about my session_3 order').catch(() => undefined);
    await tick();
    client1.disconnect();

    // The remembered session is session_1, so nothing re-joins session_3 —
    // `performSwitch`'s `abandonSession(previous)` never sees it either.
    await storage.set(SELECTED_SESSION_KEY, 'session_1');

    const h2 = harness({}, storage);
    const client2 = createChatClient(h2.config);
    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_1' }), 90));
    await connecting;
    await tick();
    await tick();

    expect(client2.getState().session?.id).toBe('session_1');
    // A frame here is cross-conversation delivery of the customer's words.
    expect(framesOfType(h2.sockets.last, 'message.send')).toHaveLength(0);
    // Not destroyed either — still theirs, still queued.
    expect(client2.getState().messages.map((m) => m.content)).toContain('about my session_3 order');
  });
});

// ---------------------------------------------------------------------------
// COLLATERAL — the flush gate.
// ---------------------------------------------------------------------------

describe('the flush gate opens on the join decision, not on the history read', () => {
  it('flushes once the re-join is acked, even while page one is still hanging', async () => {
    const storage = new MemoryStorageAdapter();

    const h1 = harness({}, storage);
    const client1 = await connected(h1, sessionSnapshot({ sessionId: 'session_2' }));
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('typed in session_2').catch(() => undefined);
    await tick();
    client1.disconnect();
    await storage.set(SELECTED_SESSION_KEY, 'session_2');

    const h2 = harness({}, storage);
    // `packages/rest` has no deadline anywhere and `loadMore` never rejects,
    // so a hung history endpoint is indefinite.
    h2.history.held.add('session_2');

    const client2 = createChatClient(h2.config);
    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_1' }), 90));
    await connecting;
    await tick();

    ackJoins(h2, 91);
    await tick();
    h2.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 95));
    await tick();

    // Page one has still not answered...
    expect(h2.history.callsFor('session_2').length).toBeGreaterThan(0);
    expect(client2.getState().pagination.initialLoaded).toBe(false);
    // ...but the join IS decided, so the queue must not still be stranded.
    const sends = framesOfType(h2.sockets.last, 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]?.d.sessionId).toBe('session_2');
  });

  it('writes no message.send when the server REFUSES the re-join', async () => {
    const storage = new MemoryStorageAdapter();

    const h1 = harness({}, storage);
    const client1 = await connected(h1, sessionSnapshot({ sessionId: 'session_2' }));
    h1.sockets.last.emitClose({ code: CLOSE_CODE.ABNORMAL, reason: '', wasClean: false });
    await tick();
    void client1.sendMessage('typed in session_2').catch(() => undefined);
    await tick();
    client1.disconnect();
    await storage.set(SELECTED_SESSION_KEY, 'session_2');

    const h2 = harness({}, storage);
    const client2 = createChatClient(h2.config);
    const connecting = client2.connect();
    await tick();
    h2.sockets.last.open();
    h2.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_1' }), 90));
    await connecting;
    await tick();

    const join = framesOfType(h2.sockets.last, 'session.join')[0];
    expect(join?.d).toEqual({ sessionId: 'session_2' });
    h2.sockets.last.emitJson(
      rejectedAckJson(join?.id as string, 91, {
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found',
        retryable: false,
      }),
    );
    await tick();
    await tick();

    // The client never joined session_2, so its queued send has no address
    // this connection can honour.
    expect(client2.getState().session?.id).toBe('session_1');
    expect(framesOfType(h2.sockets.last, 'message.send')).toHaveLength(0);
  });
});
