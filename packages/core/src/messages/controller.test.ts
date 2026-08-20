import { describe, expect, it, vi } from 'vitest';
import {
  DISCONNECTED,
  FakeQueueTransport,
  SendQueue,
  rejected,
} from '../queue/index.js';
import type { QueuedSend } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { DEFAULT_RETRYABLE_FALLBACK, MessageController } from './controller.js';
import { NoActiveSessionError } from './types.js';

/** `subscribe` is microtask-batched (§6.4), so state assertions await a tick. */
const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()));

const SESSION: ChatSession = {
  id: 'sess-1',
  status: 'OPEN',
  mode: 'BOT',
  createdAt: '2026-08-18T09:00:00.000Z',
  closedAt: null,
  assignedAgent: null,
  customer: null,
  ticket: null,
};

interface Harness {
  readonly store: ChatStore;
  readonly queue: SendQueue;
  readonly transport: FakeQueueTransport;
  readonly controller: MessageController;
  readonly events: { name: string; payload: unknown }[];
  messages(): readonly ChatMessage[];

  /**
   * Waits for the queue's delivery round trip to settle.
   *
   * `queue.flush()` rather than a counted number of microtasks: the ack path
   * runs `sendWithId` → settle → persist, and counting ticks would make these
   * tests pass or fail on how many awaits the queue happens to contain.
   */
  settle(): Promise<void>;
}

async function harness(
  options: {
    session?: ChatSession | null;
    slowEnqueue?: boolean;
    retention?: { maxEntries?: number };
  } = {},
): Promise<Harness> {
  const store = new ChatStore();
  const transport = new FakeQueueTransport();
  const events: { name: string; payload: unknown }[] = [];

  for (const name of ['message', 'messageAck', 'sendFailed'] as const) {
    store.on(name, (payload) => events.push({ name, payload }));
  }

  // Wired exactly the way T13 must wire it: the controller takes an `enqueue`
  // function, so the queue can be built with the controller's own callbacks
  // and neither construction has to come first.
  // Explicit annotations break the inference cycle: `enqueue` closes over
  // `queue`, and `queue` is built from `controller`'s callbacks. T13 needs the
  // same two annotations.
  const controller: MessageController = new MessageController({
    store,
    enqueue: async (sessionId, payload) => {
      const entry = await queue.enqueue(sessionId, payload);
      // `slowEnqueue` delays only the seam, not the queue, which forces the
      // interleaving the queue's contract explicitly permits: "Delivery is
      // deliberately not awaited ... Draining starts in the background." The
      // ack then settles before the optimistic message is inserted.
      if (options.slowEnqueue) {
        for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
      }
      return entry;
    },
    sender: () => ({ senderId: 'cust-1', senderType: 'CUSTOMER' }),
    // Pagination is exercised in pagination.test.ts; nothing here reads history.
    history: { listMessages: () => Promise.resolve({ messages: [], hasMore: false }) },
    uploader: { upload: () => Promise.reject(new Error('unused')) },
  });

  const queue: SendQueue = new SendQueue({
    storage: new MemoryStorageAdapter(),
    transport,
    onAck: controller.onAck,
    onFailed: controller.onFailed,
    ...(options.retention === undefined ? {} : { retention: options.retention }),
  });

  await queue.restore();
  store.setState({ session: options.session === undefined ? SESSION : options.session });
  await flush();

  return {
    store,
    queue,
    transport,
    controller,
    events,
    messages: () => store.getState().messages,
    settle: () => queue.flush(),
  };
}

describe('sendMessage — optimistic insert (§6.3)', () => {
  it('shows the message with delivery: queued before any ack', async () => {
    const h = await harness();
    h.transport.isOpen = false; // nothing can ack yet

    await h.controller.sendMessage('hello');
    await flush();

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.content).toBe('hello');
    expect(h.messages()[0]?.delivery).toEqual({ state: 'queued' });
    expect(h.messages()[0]?.seq).toBeUndefined();
  });

  it('emits `message` for the optimistic send', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await h.controller.sendMessage('hello');

    expect(h.events.filter((e) => e.name === 'message')).toHaveLength(1);
  });

  it('defaults type to TEXT and carries the ULID as the message id (D1)', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await h.controller.sendMessage('hello');

    const [message] = h.messages();
    expect(message?.type).toBe('TEXT');
    expect(message?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(h.queue.pending()[0]?.id).toBe(message?.id);
  });

  it('records the sender identity the resolver returned', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await h.controller.sendMessage('hello');

    expect(h.messages()[0]?.senderId).toBe('cust-1');
    expect(h.messages()[0]?.senderType).toBe('CUSTOMER');
  });

  it('throws when there is no active session', async () => {
    const h = await harness({ session: null });

    await expect(h.controller.sendMessage('hello')).rejects.toBeInstanceOf(NoActiveSessionError);
    expect(h.messages()).toHaveLength(0);
  });
});

describe('sendMessage — offline is queued, not failed (§6.3)', () => {
  it('does not reject when the socket is closed', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await expect(h.controller.sendMessage('offline')).resolves.toBeUndefined();
  });

  it('leaves the message queued, never failed, with no socket', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await h.controller.sendMessage('offline');
    await flush();

    expect(h.messages()[0]?.delivery).toEqual({ state: 'queued' });
    expect(h.events.filter((e) => e.name === 'sendFailed')).toHaveLength(0);
  });

  it('stays queued after a disconnected delivery attempt', async () => {
    const h = await harness();
    h.transport.respondWith(DISCONNECTED);

    await h.controller.sendMessage('offline');
    await h.settle();

    expect(h.messages()[0]?.delivery).toEqual({ state: 'queued' });
    expect(h.events.filter((e) => e.name === 'sendFailed')).toHaveLength(0);
  });
});

describe('sendMessage — ack clears delivery and records seq (§9.3, D2)', () => {
  it('clears delivery and sets seq on ack', async () => {
    const h = await harness();
    h.transport.respondWith({
      status: 'acked',
      frame: { v: 1, t: 'ack', id: 'a', ref: 'r', ts: 0, d: { ok: true, seq: 7 } },
    });

    await h.controller.sendMessage('hello');
    await h.settle();

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.delivery).toBeUndefined();
    expect(h.messages()[0]?.seq).toBe(7);
  });

  it('emits messageAck exactly once, carrying the message id and seq', async () => {
    const h = await harness();
    h.transport.respondWith({
      status: 'acked',
      frame: { v: 1, t: 'ack', id: 'a', ref: 'r', ts: 0, d: { ok: true, seq: 7 } },
    });

    await h.controller.sendMessage('hello');
    await h.settle();

    const acks = h.events.filter((e) => e.name === 'messageAck');
    expect(acks).toHaveLength(1);
    expect(acks[0]?.payload).toEqual({ id: h.messages()[0]?.id, seq: 7 });
  });

  it('emits `message` before `messageAck` in the ordinary ordering', async () => {
    const h = await harness();

    await h.controller.sendMessage('hello');
    await h.settle();

    const names = h.events.map((e) => e.name);
    expect(names.indexOf('message')).toBeLessThan(names.indexOf('messageAck'));
  });

  it('applies an ack that settled before the optimistic message was inserted', async () => {
    // Not hypothetical: `SendQueue.enqueue` starts draining before it
    // resolves, so an ack can settle first. Without the early-settle guard
    // the ack lands on an empty list, is dropped, and a message the server
    // already stored is stuck showing a spinner forever.
    const h = await harness({ slowEnqueue: true });
    h.transport.respondWith({
      status: 'acked',
      frame: { v: 1, t: 'ack', id: 'a', ref: 'r', ts: 0, d: { ok: true, seq: 12 } },
    });

    await h.controller.sendMessage('hello');
    await h.settle();

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.delivery).toBeUndefined();
    expect(h.messages()[0]?.seq).toBe(12);
  });

  it('still emits `message` before `messageAck` when the ack settled first', async () => {
    const h = await harness({ slowEnqueue: true });

    await h.controller.sendMessage('hello');
    await h.settle();

    const names = h.events.map((e) => e.name);
    expect(names).toEqual(['message', 'messageAck']);
  });

  it('applies a failure that settled before the optimistic message was inserted', async () => {
    const h = await harness({ slowEnqueue: true });
    h.transport.respondWith(rejected());

    await h.controller.sendMessage('doomed');
    await h.settle();

    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'VALIDATION_FAILED',
      // The real signal now, not the fallback: `rejected()` defaults to
      // `retryable: false` and `SendQueue` threads it through (T9).
      retryable: false,
    });
    expect(h.events.map((e) => e.name)).toEqual(['message', 'sendFailed']);
  });

  it('never leaves a delivered message stuck on queued', async () => {
    const h = await harness();

    await h.controller.sendMessage('a');
    await h.controller.sendMessage('b');
    await h.controller.sendMessage('c');
    await h.settle();

    expect(h.messages()).toHaveLength(3);
    for (const message of h.messages()) expect(message.delivery).toBeUndefined();
  });
});

describe('sendMessage — permanent failure (§9.6, §6.5)', () => {
  it('sets delivery.failed and emits sendFailed exactly once', async () => {
    const h = await harness();
    h.transport.respondWith(rejected('VALIDATION_FAILED'));

    await h.controller.sendMessage('doomed');
    await h.settle();

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'VALIDATION_FAILED',
      // The real signal now, not the fallback: `rejected('VALIDATION_FAILED')`
      // defaults to `retryable: false` and `SendQueue` threads it through (T9).
      retryable: false,
    });

    const failures = h.events.filter((e) => e.name === 'sendFailed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toEqual({
      id: h.messages()[0]?.id,
      sessionId: 'sess-1',
      reason: 'rejected',
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
  });

  it('emits `message` before `sendFailed`', async () => {
    const h = await harness();
    h.transport.respondWith(rejected());

    await h.controller.sendMessage('doomed');
    await h.settle();

    const names = h.events.map((e) => e.name);
    expect(names.indexOf('message')).toBeLessThan(names.indexOf('sendFailed'));
  });

  it('keeps the failed message in the list so the app can offer a retry', async () => {
    const h = await harness();
    h.transport.respondWith(rejected());

    await h.controller.sendMessage('doomed');
    await h.settle();

    expect(h.messages().map((m) => m.content)).toEqual(['doomed']);
  });
});

// The bug this section guards against: an agent closes the session, the
// customer's next message is rejected `SESSION_CLOSED`, and the pre-fix SDK
// collapsed that into the same bare 'rejected' every other rejection produces
// — so the widget could not tell "retrying is futile" from "retrying will
// probably work" and showed the same Retry affordance either way. `onFailed`
// is exercised directly here (rather than only through the real `SendQueue`)
// because `code`/`retryable` are threaded through `MessageController` ahead
// of `queue/` gaining them (T9's node) — `FailedSend & { retryable?: boolean
// }` is exactly the shape `queue/` will hand this callback once it does, so a
// hand-built payload of that shape is what a real, upgraded queue will send.
describe('sendMessage — permanent failure surfaces the server\'s retryable signal (§7.4, §9.6)', () => {
  async function queuedEntry(h: Harness, content: string): Promise<QueuedSend> {
    await h.controller.sendMessage(content);
    const entry = h.queue.pending().find((candidate) => candidate.payload.content === content);
    if (entry === undefined) throw new Error('expected the send to still be queued');
    return entry;
  }

  it('surfaces code: SESSION_CLOSED and retryable: false for a non-retryable rejection', async () => {
    const h = await harness();
    h.transport.isOpen = false; // keep the entry queued so it can be hand-settled below

    const entry = await queuedEntry(h, 'doomed');
    h.controller.onFailed({ entry, reason: 'rejected', code: 'SESSION_CLOSED', retryable: false });
    await flush();

    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'SESSION_CLOSED',
      retryable: false,
    });

    const failures = h.events.filter((e) => e.name === 'sendFailed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toEqual({
      id: entry.id,
      sessionId: entry.sessionId,
      reason: 'rejected',
      code: 'SESSION_CLOSED',
      retryable: false,
    });
  });

  it('surfaces retryable: true for a genuinely transient rejection', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    const entry = await queuedEntry(h, 'try me again');
    h.controller.onFailed({ entry, reason: 'rejected', code: 'RATE_LIMITED', retryable: true });
    await flush();

    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'RATE_LIMITED',
      retryable: true,
    });

    const failures = h.events.filter((e) => e.name === 'sendFailed');
    expect(failures[0]?.payload).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('falls back to the documented default when the server sent no retryable field', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    const entry = await queuedEntry(h, 'unknown fate');
    // No `retryable` key at all — the exact shape an older server's
    // `FailedSend` carries, since the field did not exist before this fix.
    h.controller.onFailed({ entry, reason: 'rejected', code: 'INTERNAL' });
    await flush();

    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'INTERNAL',
      retryable: DEFAULT_RETRYABLE_FALLBACK,
    });
  });

  it('drops an unrecognized code rather than mis-surfacing it as a canonical ErrorCode', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    const entry = await queuedEntry(h, 'mystery');
    h.controller.onFailed({ entry, reason: 'rejected', code: 'SOME_FUTURE_CODE', retryable: false });
    await flush();

    expect(h.messages()[0]?.delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      retryable: false, // still trusted — retryable and code are independent
    });
  });

  it('keeps `reason` alone readable — an existing consumer reading only reason is unaffected', async () => {
    const h = await harness();
    h.transport.respondWith(rejected('VALIDATION_FAILED'));

    await h.controller.sendMessage('doomed');
    await h.settle();

    const failures = h.events.filter((e) => e.name === 'sendFailed');
    // Deliberately typed as the pre-fix shape: a consumer that only ever knew
    // about `reason` still compiles and still reads the right value.
    const payload = failures[0]?.payload as { id: string; sessionId: string; reason: string };
    expect(payload.reason).toBe('rejected');
    expect(payload.id).toBe(h.messages()[0]?.id);
    expect(payload.sessionId).toBe('sess-1');
  });
});

describe('sendMessage — retention eviction (§9.6)', () => {
  it('marks an evicted older send failed and emits sendFailed once', async () => {
    // maxEntries 1: queueing the second send sheds the first.
    const h = await harness({ retention: { maxEntries: 1 } });
    h.transport.isOpen = false;

    await h.controller.sendMessage('first');
    const firstId = h.messages()[0]?.id;
    await h.controller.sendMessage('second');

    const evicted = h.messages().find((m) => m.id === firstId);
    expect(evicted?.delivery).toEqual({
      state: 'failed',
      reason: 'evicted',
      retryable: true, // fallback default — eviction never carries a server code
    });

    const failures = h.events.filter((e) => e.name === 'sendFailed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toEqual({
      id: firstId,
      sessionId: 'sess-1',
      reason: 'evicted',
      retryable: true,
    });
  });

  it('rejects a send that could not be durably queued and shows nothing', async () => {
    // maxEntries 0: the candidate itself is shed, so it was never queued.
    const h = await harness({ retention: { maxEntries: 0 } });
    h.transport.isOpen = false;

    await expect(h.controller.sendMessage('doomed')).rejects.toThrow();

    // The queue's contract: "a rejected enqueue means the send is not queued
    // and the caller must not show it as sent." Its rejection is its report,
    // so there is no second report through `sendFailed` either.
    expect(h.messages()).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('strands no outcome for a send that was never queued', async () => {
    const h = await harness({ retention: { maxEntries: 0 } });
    h.transport.isOpen = false;

    await expect(h.controller.sendMessage('doomed')).rejects.toThrow();

    // The queue reported the shed candidate through `onFailed`, but no
    // optimistic message will ever be inserted to consume that outcome. Left
    // behind, it would accumulate one entry per storage-rejected send for the
    // life of the client.
    expect(h.controller.settledEarlyCount).toBe(0);
  });

  it('holds nothing once an ordinary send has settled', async () => {
    const h = await harness();

    await h.controller.sendMessage('fine');
    await h.settle();

    expect(h.controller.settledEarlyCount).toBe(0);
  });
});

describe('replay reuses the original ULID (D1)', () => {
  it('writes the same envelope id on the retry after a disconnect', async () => {
    const h = await harness();
    h.transport.respondWith(DISCONNECTED);

    // No settle here: `settle()` clears the queue's stalled set and would
    // itself trigger the retry this test wants to drive explicitly. The
    // optimistic message is already in state — `setState` applies
    // synchronously; only `subscribe` notification is batched.
    await h.controller.sendMessage('replay me');

    const originalId = h.messages()[0]?.id;
    expect(originalId).toBeDefined();

    h.transport.respondWith({
      status: 'acked',
      frame: { v: 1, t: 'ack', id: 'a', ref: 'r', ts: 0, d: { ok: true, seq: 4 } },
    });
    await h.queue.flush();
    await flush();

    // Two writes, one identity. A fresh ULID on replay would be a second
    // distinct message to a server that dedupes on `id` (§9.3).
    expect(h.transport.sends).toHaveLength(2);
    expect(h.transport.sends.map((s) => s.id)).toEqual([originalId, originalId]);
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.id).toBe(originalId);
    expect(h.messages()[0]?.seq).toBe(4);
  });
});

describe('emission ownership', () => {
  it('fires each event once per send — no double-emission from the queue', async () => {
    const h = await harness();
    const spy = vi.fn();
    h.store.on('message', spy);

    await h.controller.sendMessage('once');
    await h.settle();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
