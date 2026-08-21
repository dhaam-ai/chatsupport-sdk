// The five interleavings that beat rounds 1-3 of the "click a previous
// session, its messages do not load" fix.
//
// Every one of them is the same defect seen from a different angle: the old
// `performSwitch` transitioned IN PLACE, so between "we reset this session's
// state" and "the server told us about the new session" there was an interval
// in which `ChatState.session` named one conversation and `ChatState.messages`
// held another's. Each round guarded one more read across that interval; each
// probe below found a read that slipped through.
//
// They are written against the PUBLIC `createChatClient` surface and against
// the OBSERVABLE outcome, never against the mechanism — `settleSwitch` below
// drives whatever the client does on the wire (an in-place `session.join`, or
// a full teardown and re-handshake) so the assertions stay true statements
// about behaviour rather than about the current implementation.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, MessagePayload, SessionSnapshot } from '../protocol/index.js';
import type { ChatMessage, ChatState } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import type { StubWebSocket } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClient, ChatClientConfig } from './types.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(n: number): string {
  const suffix = ULID_ALPHABET[n % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';
const AGENT_ID = 'participant_agent_1';
const PUBLISHABLE_KEY = 'dhp' + '_test_window1';

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

/** A history source with a distinct, per-session transcript and parkable reads. */
class SessionHistory implements MessageHistorySource {
  readonly calls: HistoryQuery[] = [];
  readonly pages = new Map<string, MessagePage>();
  failures = 0;

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

  /** Number of reads for `sessionId` currently parked. */
  parkedCount(sessionId: string): number {
    return this.#parked.filter((parked) => parked.sessionId === sessionId).length;
  }

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

function harness(overrides: Partial<ChatClientConfig> = {}): Harness {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const history = new SessionHistory();
  const storage = new MemoryStorageAdapter();

  const config: ChatClientConfig = {
    publishableKey: PUBLISHABLE_KEY,
    getToken: async () => 'tok_window',
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

/**
 * Drives whatever the client does on the wire to move it into `target`.
 *
 * Deliberately mechanism-agnostic. It will:
 *   - hand a `connection.ack` to any socket the client has opened but not yet
 *     handshaked (the teardown-and-re-establish shape), answering with
 *     `options.resolved` — the session the SERVER would resolve for a hello
 *     that carries no session id;
 *   - ack (or refuse) every `session.join` frame written on any socket;
 *   - push `session.updated` for `target` once its join has been acked.
 *
 * `steps` bounds how far it drives, so a test can stop the wire mid-switch.
 */
interface WireDriver {
  /** Runs one wire step. Returns true if it did anything. */
  step(): Promise<boolean>;
  /** Runs until nothing more happens, or `max` steps. */
  settle(max?: number): Promise<void>;
  /** Joins acked so far, in order. */
  readonly joined: string[];
  /** Sessions whose `session.updated` has been pushed. */
  readonly announced: string[];
}

interface DriverOptions {
  /** Session the server resolves for a bare hello. Defaults to the current one. */
  readonly resolved?: SessionSnapshot;
  /** Refuse joins for these session ids rather than acking them. */
  readonly refuse?: ReadonlySet<string>;
  /** Do not push `session.updated` for these ids even after acking the join. */
  readonly withholdSnapshot?: ReadonlySet<string>;
  /** Snapshot to announce for an acked join. */
  readonly snapshotFor?: (sessionId: string) => SessionSnapshot;
}

function driver(h: Harness, options: DriverOptions = {}): WireDriver {
  let idNum = 400;
  const handshaked = new Set<StubWebSocket>();
  const ackedJoins = new Set<string>();
  const joined: string[] = [];
  const announced: string[] = [];
  const refuse = options.refuse ?? new Set<string>();
  const withhold = options.withholdSnapshot ?? new Set<string>();
  const snapshotFor = options.snapshotFor ?? ((id: string) => sessionSnapshot({ sessionId: id }));

  const step = async (): Promise<boolean> => {
    let acted = false;
    await tick();

    for (const socket of h.sockets.sockets) {
      if (handshaked.has(socket)) continue;
      // A socket the client has created but not driven — complete the
      // handshake the way a real server would.
      handshaked.add(socket);
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

        if (!refuse.has(sessionId) && !withhold.has(sessionId) && !announced.includes(sessionId)) {
          announced.push(sessionId);
          socket.emitJson(sessionUpdatedJson(snapshotFor(sessionId), (idNum += 1)));
          await tick();
        }
      }
    }

    return acted;
  };

  return {
    step,
    joined,
    announced,
    settle: async (max = 8): Promise<void> => {
      for (let i = 0; i < max; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await step())) return;
      }
      await tick();
    },
  };
}

/** Records every state a subscriber could observe, so a torn one is provable. */
function watchForTears(client: ChatClient): { readonly tears: string[] } {
  const tears: string[] = [];
  client.subscribe((state: ChatState) => {
    if (state.session === null) return;
    const foreign = state.messages.filter((message) => message.sessionId !== state.session?.id);
    if (foreign.length > 0) {
      tears.push(`${state.session.id} <- ${foreign.map((row) => row.sessionId).join(',')}`);
    }
  });
  return { tears };
}

// ---------------------------------------------------------------------------
// PROBE 1 — a history read parked and released mid-switch
// ---------------------------------------------------------------------------

describe('probe 1: a page-one read parked across the switch', () => {
  it('released BEFORE the join is decided cannot leave the old transcript on screen', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new', 'session_2', 1)], hasMore: false });

    h.history.held.add('session_1');
    const client = await connected(h);
    const tears = watchForTears(client);
    expect(h.history.parkedCount('session_1')).toBe(1);

    const switching = client.switchSession('session_2');
    await tick();

    // Released while the switch has not yet been decided on the wire.
    h.history.release('session_1');
    await tick();

    await driver(h).settle();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    expect(state.messages.map((message) => message.id)).toEqual(['new']);
    expect(state.pagination).toEqual({ hasMore: false, loadingMore: false, initialLoaded: true });
    expect(tears.tears).toEqual([]);
  });

  it('released BETWEEN the join ack and session.updated cannot splice two transcripts', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new', 'session_2', 1)], hasMore: false });

    h.history.held.add('session_1');
    const client = await connected(h);
    const tears = watchForTears(client);

    const wire = driver(h, { withholdSnapshot: new Set(['session_2']) });
    const switching = client.switchSession('session_2');
    await wire.settle();
    expect(wire.joined).toContain('session_2');

    // The join is acked; the snapshot has NOT arrived. Release now.
    h.history.release('session_1');
    await tick();

    await driver(h, { refuse: new Set() }).settle();
    // Push the withheld snapshot.
    h.sockets.last.emitJson(sessionUpdatedJson(sessionSnapshot({ sessionId: 'session_2' }), 900));
    await tick();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    expect(state.messages.map((message) => message.id)).toEqual(['new']);
    expect(state.pagination.hasMore).toBe(false);
    expect(state.pagination.loadingMore).toBe(false);
    expect(tears.tears).toEqual([]);
  });

  it('released AFTER the seed has begun does not disarm the seed', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('old', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('new', 'session_2', 1)], hasMore: false });

    h.history.held.add('session_1');
    const client = await connected(h);
    const tears = watchForTears(client);

    const switching = client.switchSession('session_2');
    await driver(h).settle();
    await tick();

    // The seed for session_2 has already run; the old read is still parked.
    h.history.release('session_1');
    await tick();
    await switching;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_2');
    expect(state.messages.map((message) => message.id)).toEqual(['new']);
    expect(state.pagination.initialLoaded).toBe(true);
    expect(state.pagination.loadingMore).toBe(false);
    expect(tears.tears).toEqual([]);

    // And `load older` still works afterwards.
    h.history.pages.set('session_2', { messages: [], hasMore: false });
    await client.loadOlderMessages();
    expect(client.getState().pagination.loadingMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROBE 2 — a switch that FAILS while a read is in flight
// ---------------------------------------------------------------------------

describe('probe 2: a failed switch with a read in flight', () => {
  it('leaves the customer looking at the session they never left, not a blank pane', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('mine', 'session_1', 1)], hasMore: false });

    const client = await connected(h);
    await tick();
    expect(client.getState().messages.map((message) => message.id)).toEqual(['mine']);

    // A second read for the session we are in, parked across the failure.
    h.history.held.add('session_1');
    const reading = client.loadOlderMessages();
    await tick();

    const switching = client.switchSession('session_not_owned');
    const wire = driver(h, { refuse: new Set(['session_not_owned']) });
    await wire.settle();

    await expect(switching).rejects.toThrow();
    h.history.release('session_1');
    await reading;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_1');
    // Round 3 left this empty with zero recovery requests.
    expect(state.messages.map((message) => message.id)).toEqual(['mine']);
    expect(state.pagination.loadingMore).toBe(false);
    expect(state.lastError?.code).toBe('SESSION_NOT_FOUND');
  });

  it('leaves loadOlderMessages usable after the failure', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('mine', 'session_1', 1)], hasMore: true });

    const client = await connected(h);
    await tick();

    const switching = client.switchSession('session_not_owned');
    await driver(h, { refuse: new Set(['session_not_owned']) }).settle();
    await expect(switching).rejects.toThrow();
    await tick();

    const before = h.history.calls.length;
    h.history.pages.set('session_1', { messages: [historyMessage('older', 'session_1', 0)], hasMore: false });
    await client.loadOlderMessages();
    await tick();

    expect(h.history.calls.length).toBeGreaterThan(before);
    expect(client.getState().messages.some((message) => message.id === 'older')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PROBE 3 — a parked read landing just before a refusal
// ---------------------------------------------------------------------------

describe('probe 3: a parked read landing just before a refusal', () => {
  it('never renders the refused session\'s transcript under the current session\'s header', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('a_row', 'session_1', 1)], hasMore: false });
    h.history.pages.set('session_2', { messages: [historyMessage('b_row', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    await tick();

    const tears = watchForTears(client);

    // A read for the INCOMING session, parked, then released one tick before
    // the join for it is refused.
    h.history.held.add('session_2');
    const switching = client.switchSession('session_2');
    await tick();

    h.history.release('session_2');
    await tick();

    await driver(h, { refuse: new Set(['session_2']) }).settle();
    await expect(switching).rejects.toThrow();
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_1');
    // Round 3 rendered conversation B's transcript under conversation A's header.
    expect(state.messages.every((message) => message.sessionId === 'session_1')).toBe(true);
    expect(tears.tears).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PROBE 4 — two rapid successive switches
// ---------------------------------------------------------------------------

describe('probe 4: two rapid successive switches', () => {
  it('lands on the LAST target with only its rows', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('from_2', 'session_2', 1)], hasMore: false });
    h.history.pages.set('session_3', { messages: [historyMessage('from_3', 'session_3', 1)], hasMore: false });

    const client = await connected(h);
    const tears = watchForTears(client);

    const second = client.switchSession('session_2').catch(() => undefined);
    const third = client.switchSession('session_3');
    await driver(h).settle(12);

    await second;
    await third;
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_3');
    expect(state.messages.map((message) => message.id)).toEqual(['from_3']);
    expect(state.pagination.loadingMore).toBe(false);
    expect(h.history.callsFor('session_2')).toHaveLength(0);
    expect(tears.tears).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PROBE 5 — a cross-session history cursor
// ---------------------------------------------------------------------------

describe('probe 5: history cursors never cross a session boundary', () => {
  it('never sends a `before` taken from another session\'s row', async () => {
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('one', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: true });

    const client = await connected(h);
    h.sockets.last.emitJson(messageNewJson(50, 2, { content: 'live in session_1' }));
    await tick();

    const switching = client.switchSession('session_2');
    await driver(h).settle();
    await switching;
    await tick();

    // Every read is either cursor-less, or its cursor is a row of the very
    // session it is reading.
    const rowsBySession = new Map<string, Set<string>>([
      ['session_1', new Set(['one', ulid(50)])],
      ['session_2', new Set(['two'])],
    ]);
    for (const call of h.history.calls) {
      if (call.before === undefined) continue;
      expect(rowsBySession.get(call.sessionId)?.has(call.before)).toBe(true);
    }

    // And a subsequent `load older` in session_2 pages session_2.
    h.history.pages.set('session_2', { messages: [historyMessage('older_two', 'session_2', 0)], hasMore: false });
    await client.loadOlderMessages();
    await tick();

    const last = h.history.calls[h.history.calls.length - 1];
    expect(last?.sessionId).toBe('session_2');
    expect(last?.before).toBe('two');
  });
});

// ---------------------------------------------------------------------------
// The invariant itself, and the two things the teardown must not leak
// ---------------------------------------------------------------------------

describe('the commit is atomic, and the teardown leaks nothing', () => {
  it('replaces identity and transcript together on a RECONNECT the server resolves elsewhere', async () => {
    // No switch is involved at all. `connection.hello` carries no session id,
    // so a reconnect can land the customer in a different conversation than
    // the one they were reading — and before the commit rule that left the
    // OLD transcript sitting under the NEW session's header indefinitely,
    // with nothing to correct it.
    const h = harness();
    h.history.pages.set('session_1', { messages: [historyMessage('mine', 'session_1', 1)], hasMore: true });
    h.history.pages.set('session_9', { messages: [historyMessage('theirs', 'session_9', 1)], hasMore: false });

    const client = await connected(h);
    await tick();
    expect(client.getState().messages.map((message) => message.id)).toEqual(['mine']);

    const tears = watchForTears(client);

    // The socket drops and the server resolves a different session.
    h.sockets.last.emitClose({ code: 1006, reason: '', wasClean: false });
    await tick();
    h.timers.advance(60_000);
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson(0, sessionSnapshot({ sessionId: 'session_9' }), 700));
    await tick();

    const state = client.getState();
    expect(state.session?.id).toBe('session_9');
    // The old conversation's rows do not come with it, and `pagination` is
    // re-armed so the new session's own page one is fetched.
    expect(state.messages.every((message) => message.sessionId === 'session_9')).toBe(true);
    expect(state.pagination.hasMore).toBe(false);
    expect(tears.tears).toEqual([]);
  });

  it('leaves no timer behind after a switch, a failed switch, or two of them', async () => {
    const h = harness();
    h.history.pages.set('session_2', { messages: [historyMessage('two', 'session_2', 1)], hasMore: false });

    const client = await connected(h);
    await tick();
    const baseline = h.timers.pendingCount;

    const first = client.switchSession('session_2');
    await driver(h).settle();
    await first;
    await tick();

    const refused = client.switchSession('session_gone').catch(() => undefined);
    await driver(h, { refuse: new Set(['session_gone']) }).settle();
    await refused;
    await tick();

    // The snapshot-wait timer, the typing timers and the reconnect timer are
    // all cancelled on their way out; nothing accumulates per switch.
    expect(h.timers.pendingCount).toBeLessThanOrEqual(baseline);
  });
});
