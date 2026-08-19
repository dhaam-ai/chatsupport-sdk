import { describe, expect, it, vi } from 'vitest';

import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import { ManualTimers } from '../presence/index.js';
import type {
  ConnectionAckPayload,
  MessagePayload,
  ServerFrame,
  ServerPushFrame,
  SessionSnapshot,
} from '../protocol/index.js';
import { ChatStore, createInitialChatState } from '../state/index.js';
import { ConnectionController } from './controller.js';
import { FakeTransport } from './fake-transport.js';
import { ResumeTracker, frameSeq } from './resume.js';
import type { ConnectionControllerOptions, ResumeGap, TokenProvider } from './types.js';

// ---------------------------------------------------------------------------
// The pure tracker
// ---------------------------------------------------------------------------

describe('frameSeq', () => {
  it('reads the seq off message.new', () => {
    expect(frameSeq(messageFrame(7))).toBe(7);
  });

  it('returns null for unsequenced push frames', () => {
    const typing: ServerFrame = { v: 1, t: 'typing.start', id: 'f', ts: 0, d: { participantId: 'p' } };
    expect(frameSeq(typing)).toBeNull();
  });

  it('does not mistake connection.ack’s anchor for a frame position', () => {
    expect(frameSeq(ackFrame({ seq: 99 }))).toBeNull();
  });
});

describe('ResumeTracker', () => {
  it('starts with no anchor — a first connect has nothing to resume from', () => {
    expect(new ResumeTracker().lastAppliedSeq).toBeNull();
  });

  it('adopts the first sequenced frame without reporting a gap', () => {
    const tracker = new ResumeTracker();
    expect(tracker.observe(500)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(500);
  });

  it('advances silently across a contiguous run', () => {
    const tracker = new ResumeTracker();
    tracker.observe(10);
    for (const seq of [11, 12, 13]) expect(tracker.observe(seq), String(seq)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(13);
  });

  it('reports the exact missing span on a jump, and steps over it', () => {
    const tracker = new ResumeTracker();
    tracker.observe(10);
    expect(tracker.observe(14)).toEqual({ expectedSeq: 11, receivedSeq: 14 });
    // Stepped over, not stalled: the anchor is the highest the server vouched
    // for, so the next reconnect does not re-request everything since 10.
    expect(tracker.lastAppliedSeq).toBe(14);
    expect(tracker.observe(15)).toBeNull();
  });

  it('treats a duplicate or out-of-order seq as no gap and never rewinds the anchor', () => {
    const tracker = new ResumeTracker();
    tracker.observe(10);
    expect(tracker.observe(10)).toBeNull();
    expect(tracker.observe(4)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(10);
  });

  it('forgets the anchor on reset, so the next hello reads as a first connect', () => {
    const tracker = new ResumeTracker();
    tracker.observe(42);
    tracker.reset();
    expect(tracker.lastAppliedSeq).toBeNull();
  });

  it('does not report a gap on the first seq after a reset', () => {
    const tracker = new ResumeTracker();
    tracker.observe(42);
    tracker.reset();
    // A new session restarts at seq 0. Without the reset the anchor would
    // still read 42, every one of the new session's frames would be `<=
    // previous`, and genuine gaps in it would go unreported forever.
    expect(tracker.observe(0)).toBeNull();
    expect(tracker.observe(1)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(1);
  });

  it('adopts the ack anchor on a first connect without claiming a gap', () => {
    const tracker = new ResumeTracker();
    expect(tracker.settleAck(400)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(400);
  });

  it('reports the tail an ack claimed but never replayed', () => {
    const tracker = new ResumeTracker();
    tracker.observe(10);
    expect(tracker.settleAck(13)).toEqual({ expectedSeq: 11, receivedSeq: 13 });
    expect(tracker.lastAppliedSeq).toBe(13);
  });

  it('reports nothing when replay caught the anchor up to the ack', () => {
    const tracker = new ResumeTracker();
    tracker.observe(10);
    tracker.observe(11);
    tracker.observe(12);
    expect(tracker.settleAck(12)).toBeNull();
  });

  it('never rewinds to an ack that is behind what has already been applied', () => {
    const tracker = new ResumeTracker();
    tracker.observe(20);
    expect(tracker.settleAck(15)).toBeNull();
    expect(tracker.lastAppliedSeq).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_SNAPSHOT: SessionSnapshot = {
  sessionId: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [],
  createdAt: '2026-08-17T00:00:00.000Z',
};

function messagePayload(seq: number): MessagePayload {
  return {
    id: `msg_${seq}`,
    sessionId: 'sess_1',
    senderId: 'agent_1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: `message ${seq}`,
    seq,
    createdAt: '2026-08-17T00:00:00.000Z',
  };
}

function messageFrame(seq: number): ServerPushFrame {
  return { v: 1, t: 'message.new', id: `f_${seq}`, ts: 0, d: messagePayload(seq) };
}

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): ServerFrame {
  const payload: ConnectionAckPayload = {
    protocolVersion: 1,
    session: SESSION_SNAPSHOT,
    seq: 0,
    ...overrides,
  };
  return { v: 1, t: 'connection.ack', id: 'srv_ack', ts: 0, d: payload };
}

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly controller: ConnectionController;
  readonly transport: FakeTransport;
  readonly applied: ServerFrame[];
  readonly gaps: ResumeGap[];
}

function harness(overrides: Partial<ConnectionControllerOptions> = {}): Harness {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const timers = new ManualTimers();
  const applied: ServerFrame[] = [];
  const gaps: ResumeGap[] = [];
  let transport!: FakeTransport;

  const controller = new ConnectionController({
    store,
    url: 'wss://example.test/ws',
    publishableKey: 'dhp_test_1',
    getToken: (async () => 'tok_abc') as TokenProvider,
    schedule: timers.schedule,
    transportBackoff: new TransportBackoffPolicy({ random: () => 1 }),
    authBackoff: new AuthBackoffPolicy({ random: () => 1 }),
    onFrame: (frame) => applied.push(frame),
    onResumeGap: (gap) => gaps.push(gap),
    createTransport: (handlers) => {
      transport = new FakeTransport(handlers);
      return transport;
    },
    ...overrides,
  });

  return { store, timers, controller, transport, applied, gaps };
}

/** Connects and acks with the given payload. */
async function connectWith(h: Harness, ack: Partial<ConnectionAckPayload> = {}): Promise<void> {
  const promise = h.controller.connect();
  await tick();
  h.transport.open();
  h.transport.emitFrame(ackFrame(ack));
  await promise;
}

/** Drops the socket and lets the backoff timer bring it back up to `authenticating`. */
async function reconnect(h: Harness): Promise<void> {
  h.transport.drop();
  h.timers.advance(60_000);
  await tick();
  h.transport.open();
}

// ---------------------------------------------------------------------------
// resumeFrom on the wire
// ---------------------------------------------------------------------------

describe('ConnectionController — resumeFrom (D2, §8.3)', () => {
  it('omits resumeFrom entirely on a first connect', async () => {
    const h = harness();
    await connectWith(h, { seq: 0 });
    expect(h.transport.lastConnect.hello).not.toHaveProperty('resumeFrom');
  });

  it('carries the last applied seq on reconnect', async () => {
    const h = harness();
    await connectWith(h, { seq: 40 });

    h.transport.emitFrame(messageFrame(41));
    h.transport.emitFrame(messageFrame(42));

    await reconnect(h);
    expect(h.transport.lastConnect.hello.resumeFrom).toBe(42);
  });

  it('carries the ack anchor even when no message frame followed it', async () => {
    const h = harness();
    await connectWith(h, { seq: 17 });
    await reconnect(h);
    expect(h.transport.lastConnect.hello.resumeFrom).toBe(17);
  });

  it('exposes the same value as lastAppliedSeq', async () => {
    const h = harness();
    await connectWith(h, { seq: 5 });
    expect(h.controller.lastAppliedSeq).toBe(5);

    h.transport.emitFrame(messageFrame(6));
    expect(h.controller.lastAppliedSeq).toBe(6);
  });

  it('omits resumeFrom after forgetResumeAnchor, so the server opens a new session', async () => {
    const h = harness();
    await connectWith(h, { seq: 40 });
    h.transport.emitFrame(messageFrame(41));
    expect(h.controller.lastAppliedSeq).toBe(41);

    h.controller.forgetResumeAnchor();
    expect(h.controller.lastAppliedSeq).toBeNull();

    await reconnect(h);
    // The whole point: a hello carrying a resumeFrom ahead of the session it
    // opens is answered with a non-retryable VALIDATION_FAILED by the v2
    // endpoint, which would strand the client in `suspended` rather than the
    // new session it asked for.
    expect(h.transport.lastConnect.hello).not.toHaveProperty('resumeFrom');
  });

  it('does not advance the anchor for a frame a downstream handler threw on', async () => {
    const h = harness({
      onFrame: (frame) => {
        if (frame.t === 'message.new') throw new Error('apply failed');
      },
    });
    await connectWith(h, { seq: 10 });
    h.transport.emitFrame(messageFrame(11));

    // "last *applied* seq" — a frame that did not apply must not be claimed,
    // or the next resume would silently skip it.
    expect(h.controller.lastAppliedSeq).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe('ConnectionController — replay (D2)', () => {
  it('applies replayed frames in order, after the session snapshot', async () => {
    const h = harness();
    await connectWith(h, { seq: 3 });
    await reconnect(h);

    h.transport.emitFrame(
      ackFrame({ seq: 6, replay: [messageFrame(4), messageFrame(5), messageFrame(6)] }),
    );

    expect(h.applied.map((f) => f.t)).toEqual([
      'connection.ack',
      'connection.ack',
      'message.new',
      'message.new',
      'message.new',
    ]);
    // The snapshot the replay lands on is applied first (§9.4).
    expect(h.applied.slice(2).map((f) => frameSeq(f))).toEqual([4, 5, 6]);
    expect(h.controller.lastAppliedSeq).toBe(6);
  });

  it('honours the server’s array order rather than sorting it', async () => {
    const h = harness();
    await connectWith(h, { seq: 3 });
    await reconnect(h);

    h.transport.emitFrame(ackFrame({ seq: 6, replay: [messageFrame(6), messageFrame(4)] }));

    // Applied exactly as sent. Sorting would have repaired the symptom and
    // destroyed the evidence that the server sent them out of order.
    expect(h.applied.slice(2).map((f) => frameSeq(f))).toEqual([6, 4]);
  });

  it('tolerates an absent or empty replay when nothing was missed', async () => {
    const h = harness();
    await connectWith(h, { seq: 3 });
    await reconnect(h);

    h.transport.emitFrame(ackFrame({ seq: 3 }));
    expect(h.gaps).toEqual([]);
    expect(h.controller.state).toBe('connected');
  });

  it('reaches `connected` after replay, not before', async () => {
    const states: string[] = [];
    const h = harness({
      onFrame: () => states.push('frame'),
    });
    await connectWith(h, { seq: 3 });
    await reconnect(h);

    h.store.on('connected', () => states.push('connected'));
    h.transport.emitFrame(ackFrame({ seq: 5, replay: [messageFrame(4), messageFrame(5)] }));

    expect(states.filter((s) => s === 'frame')).toHaveLength(4);
    expect(h.controller.state).toBe('connected');
  });

  it('ignores a nested connection.ack inside replay rather than recursing on it', async () => {
    const h = harness();
    await connectWith(h, { seq: 3 });
    await reconnect(h);

    const nested = ackFrame({ seq: 99 }) as ServerPushFrame;
    h.transport.emitFrame(ackFrame({ seq: 4, replay: [nested, messageFrame(4)] }));

    expect(h.applied.filter((f) => f.t === 'connection.ack')).toHaveLength(2);
    expect(h.controller.lastAppliedSeq).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

describe('ConnectionController — seq gaps (D2)', () => {
  it('surfaces a hole inside the replayed run', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);

    h.transport.emitFrame(ackFrame({ seq: 14, replay: [messageFrame(11), messageFrame(14)] }));

    expect(h.gaps).toEqual([
      { resumeFrom: 10, expectedSeq: 12, receivedSeq: 14, ackSeq: 14 },
    ]);
  });

  it('surfaces a replay that stopped short of the ack’s own anchor', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);

    h.transport.emitFrame(ackFrame({ seq: 20, replay: [messageFrame(11)] }));

    expect(h.gaps).toEqual([
      { resumeFrom: 10, expectedSeq: 12, receivedSeq: 20, ackSeq: 20 },
    ]);
    expect(h.controller.lastAppliedSeq).toBe(20);
  });

  it('surfaces an empty replay against a moved-on server', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);

    h.transport.emitFrame(ackFrame({ seq: 40 }));

    expect(h.gaps).toEqual([
      { resumeFrom: 10, expectedSeq: 11, receivedSeq: 40, ackSeq: 40 },
    ]);
  });

  it('surfaces a gap in live frames too, not only in replay', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });

    h.transport.emitFrame(messageFrame(11));
    h.transport.emitFrame(messageFrame(15));

    // `resumeFrom` is null: this connection was a first connect and asked to
    // resume from nothing. The gap is real regardless of how the socket opened.
    expect(h.gaps).toEqual([
      { resumeFrom: null, expectedSeq: 12, receivedSeq: 15, ackSeq: 15 },
    ]);
  });

  it('names the resumeFrom the current connection actually sent', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);
    h.transport.emitFrame(ackFrame({ seq: 10 }));

    h.transport.emitFrame(messageFrame(14));

    // This socket opened with resumeFrom=10, so that is what the gap names —
    // not the anchor as it stands now, which has already moved past the hole.
    expect(h.gaps).toEqual([
      { resumeFrom: 10, expectedSeq: 11, receivedSeq: 14, ackSeq: 14 },
    ]);
  });

  it('reports the gap to the app as a §6.5 error carrying the span', async () => {
    const h = harness();
    const errors: unknown[] = [];
    h.store.on('error', (error) => errors.push(error));

    await connectWith(h, { seq: 10 });
    await reconnect(h);
    h.transport.emitFrame(ackFrame({ seq: 40 }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      source: 'transport',
      code: null,
      retryable: true,
      details: { resumeFrom: 10, expectedSeq: 11, receivedSeq: 40, ackSeq: 40 },
    });
    expect(h.store.getState().lastError?.message).toContain('11-39');
  });

  it('reports no gap on a first connect, however large the ack’s seq', async () => {
    const h = harness();
    await connectWith(h, { seq: 9_000 });

    expect(h.gaps).toEqual([]);
    expect(h.controller.lastAppliedSeq).toBe(9_000);
  });

  it('does not report a gap for a replayed frame the client already had', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);

    // The server re-sent 10 (already applied) plus the genuinely new 11.
    h.transport.emitFrame(ackFrame({ seq: 11, replay: [messageFrame(10), messageFrame(11)] }));

    expect(h.gaps).toEqual([]);
    expect(h.controller.lastAppliedSeq).toBe(11);
  });

  it('keeps the connection alive when history has a hole', async () => {
    const h = harness();
    await connectWith(h, { seq: 10 });
    await reconnect(h);
    h.transport.emitFrame(ackFrame({ seq: 40 }));

    // A hole is a refetch signal (D2), not a reason to tear down a working
    // socket the user is typing into.
    expect(h.controller.state).toBe('connected');
  });

  it('calls onResumeGap even when no error listener is attached', async () => {
    const onResumeGap = vi.fn();
    const h = harness({ onResumeGap });
    await connectWith(h, { seq: 1 });
    h.transport.emitFrame(messageFrame(5));

    expect(onResumeGap).toHaveBeenCalledWith({
      resumeFrom: null,
      expectedSeq: 2,
      receivedSeq: 5,
      ackSeq: 5,
    });
  });
});
