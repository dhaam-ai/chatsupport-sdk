import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter, type StorageAdapter, isStorageError } from '../storage/index.js';
import type { MessageSendPayload } from '../protocol/index.js';
import { FaultStorageAdapter } from './fault-storage.js';
import {
  DISCONNECTED,
  FakeQueueTransport,
  TIMEOUT,
  acked,
  rejected,
} from './fake-queue-transport.js';
import { QueueNotRestoredError, SendQueue, StorageQueueError } from './send-queue.js';
import type { FailedSend, QueuedSend } from './types.js';

const HOUR = 60 * 60 * 1000;

function text(content: string): MessageSendPayload {
  return { content, type: 'TEXT' };
}

/** Deterministic, monotonic ids so ordering assertions read plainly. */
function idGenerator(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

interface Harness {
  readonly queue: SendQueue;
  readonly transport: FakeQueueTransport;
  readonly storage: StorageAdapter;
  readonly failures: FailedSend[];
  readonly acks: { entry: QueuedSend; seq: number | undefined }[];
  setNow(value: number): void;
}

function harness(
  options: {
    storage?: StorageAdapter;
    transport?: FakeQueueTransport;
    now?: number;
    maxAgeMs?: number;
    maxEntries?: number;
    nextId?: () => string;
  } = {},
): Harness {
  const storage = options.storage ?? new MemoryStorageAdapter();
  const transport = options.transport ?? new FakeQueueTransport();
  const failures: FailedSend[] = [];
  const acks: { entry: QueuedSend; seq: number | undefined }[] = [];
  let now = options.now ?? 1_000_000;

  const retention = {
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  };

  const queue = new SendQueue({
    storage,
    transport,
    retention,
    now: () => now,
    nextId: options.nextId ?? idGenerator(),
    onFailed: (failure) => failures.push(failure),
    onAck: (entry, seq) => acks.push({ entry, seq }),
  });

  return {
    queue,
    transport,
    storage,
    failures,
    acks,
    setNow: (value) => {
      now = value;
    },
  };
}

describe('SendQueue durability (§9.1)', () => {
  it('survives a simulated reload through the StorageAdapter', async () => {
    // The whole point of §9.1: a message the user believes they sent must not
    // vanish because the page reloaded.
    const storage = new MemoryStorageAdapter();
    const offline = new FakeQueueTransport();
    offline.isOpen = false;

    const first = harness({ storage, transport: offline });
    await first.queue.restore();
    await first.queue.enqueue('sess-1', text('written before reload'));

    // A brand-new queue over the same storage — nothing shared in memory.
    const second = harness({ storage, transport: new FakeQueueTransport() });
    const report = await second.queue.restore();

    expect(report.restored).toBe(1);
    expect(second.queue.pending()).toHaveLength(1);
    expect(second.queue.pending()[0]?.payload.content).toBe('written before reload');
  });

  it('refuses to enqueue before the persisted queue has been read', async () => {
    // Appending to an unread queue would place the new send ahead of older
    // pending ones, silently breaking the FIFO guarantee of §9.2.
    const { queue } = harness();

    await expect(queue.enqueue('sess-1', text('too early'))).rejects.toBeInstanceOf(
      QueueNotRestoredError,
    );
  });

  it('propagates a read fault on restore instead of reporting an empty queue', async () => {
    const storage = new FaultStorageAdapter();
    storage.failNextGet = 'read_failed';
    const { queue } = harness({ storage });

    await expect(queue.restore()).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'read_failed',
    );
  });

  it('reports how many persisted records were unreadable', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'sendQueue',
      JSON.stringify({ v: 1, entries: [{ broken: true }, { alsoBroken: 1 }] }),
    );

    const report = await harness({ storage }).queue.restore();

    expect(report.dropped).toBe(2);
  });

  it('never reports a send as queued when the write did not land', async () => {
    // write_failed is not recoverable: no retry, no salvage, and above all no
    // claim that the message is safe.
    const storage = new FaultStorageAdapter();
    const h = harness({ storage });
    await h.queue.restore();

    storage.failEverySet = 'write_failed';
    await expect(h.queue.enqueue('sess-1', text('never landed'))).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'write_failed',
    );

    expect(h.queue.pending()).toEqual([]);
  });

  it('prunes and retries on quota_exceeded rather than failing the send', async () => {
    // §9.6: quota is recoverable. The new send must survive; the oldest give
    // way for it, and each is individually reported rather than dropped.
    const storage = new FaultStorageAdapter({ maxChars: 400 });
    const h = harness({ storage });
    await h.queue.restore();

    for (let i = 0; i < 6; i += 1) {
      h.transport.isOpen = false;
      await h.queue.enqueue('sess-1', text(`message ${i}`));
    }

    const pending = h.queue.pending();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.length).toBeLessThan(6);

    // The most recent send is the one that survived, and everything shed was
    // reported as evicted rather than silently discarded.
    expect(pending[pending.length - 1]?.payload.content).toBe('message 5');
    expect(h.failures.every((f) => f.reason === 'evicted')).toBe(true);
    expect(h.failures.length + pending.length).toBe(6);
  });

  it('rejects the send when quota sheds the very entry being enqueued', async () => {
    const storage = new FaultStorageAdapter();
    const h = harness({ storage });
    await h.queue.restore();

    storage.failEverySet = 'quota_exceeded';
    await expect(h.queue.enqueue('sess-1', text('shed immediately'))).rejects.toBeInstanceOf(
      StorageQueueError,
    );
    expect(h.queue.pending()).toEqual([]);
  });

  it('does not leak message content into the storage error', async () => {
    // §14: never log or echo message content.
    const storage = new FaultStorageAdapter();
    const h = harness({ storage });
    await h.queue.restore();
    storage.failEverySet = 'quota_exceeded';

    const error = await h.queue.enqueue('sess-1', text('sensitive body')).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain('sensitive body');
  });
});

describe('SendQueue ordering (§9.2)', () => {
  it('delivers a session FIFO, one in flight at a time', async () => {
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();

    for (const body of ['first', 'second', 'third']) {
      await h.queue.enqueue('sess-1', text(body));
    }

    h.transport.isOpen = true;
    await h.queue.flush();

    expect(h.transport.sends.map((s) => s.payload.content)).toEqual(['first', 'second', 'third']);
  });

  it('flushes queued sends before any new user-initiated send', async () => {
    // §8.4. New sends append to the tail and delivery drains from the head, so
    // a fresh send cannot overtake a queued one.
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();

    await h.queue.enqueue('sess-1', text('queued while offline'));
    await h.queue.enqueue('sess-1', text('also queued'));

    h.transport.isOpen = true;
    const flushing = h.queue.flush();
    await h.queue.enqueue('sess-1', text('brand new send'));
    await flushing;
    await h.queue.flush();

    expect(h.transport.sends.map((s) => s.payload.content)).toEqual([
      'queued while offline',
      'also queued',
      'brand new send',
    ]);
  });

  it('keeps each session independent, since cross-session order is undefined', async () => {
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();

    await h.queue.enqueue('sess-a', text('a1'));
    await h.queue.enqueue('sess-b', text('b1'));
    await h.queue.enqueue('sess-a', text('a2'));

    h.transport.isOpen = true;
    await h.queue.flush();

    const bodiesFor = (prefix: string): string[] =>
      h.transport.sends
        .map((s) => s.payload.content)
        .filter((content) => content.startsWith(prefix));

    // Per-session FIFO holds; the interleaving between them is not asserted.
    expect(bodiesFor('a')).toEqual(['a1', 'a2']);
    expect(bodiesFor('b')).toEqual(['b1']);
    expect(h.transport.sends).toHaveLength(3);
  });
});

describe('SendQueue dedup and replay (§9.3, D1)', () => {
  it('replays a frame under its original ULID', async () => {
    const h = harness({ nextId: idGenerator('ulid') });
    h.transport.isOpen = false;
    await h.queue.restore();

    const entry = await h.queue.enqueue('sess-1', text('replay me'));

    h.transport.isOpen = true;
    h.transport.respondWith(DISCONNECTED, acked(7));
    await h.queue.flush();
    await h.queue.flush();

    // Two writes, one identity. The id never changes — there is no
    // optimistic-id swap to change it.
    expect(h.transport.sends).toHaveLength(2);
    expect(h.transport.sends.map((s) => s.id)).toEqual([entry.id, entry.id]);
  });

  it('does not double-store a message the server persisted just before the drop', async () => {
    // The §9.3 guarantee, tested against a server that actually dedupes: the
    // frame is persisted, then the socket dies before the ack arrives. Replay
    // must reach the same record, not a second one.
    const h = harness({ nextId: idGenerator('ulid') });
    await h.queue.restore();

    h.transport.onSend = (send) => {
      // The server got it and stored it...
      h.transport.persistedIds.add(send.id);
      h.transport.onSend = undefined;
    };
    h.transport.respondWith(DISCONNECTED, acked(3));

    const entry = await h.queue.enqueue('sess-1', text('persisted then dropped'));
    await h.queue.flush();
    await h.queue.flush();

    // The server saw the same id twice and therefore holds exactly one message.
    expect(h.transport.sends.map((s) => s.id)).toEqual([entry.id, entry.id]);
    expect(h.transport.persistedIds.size).toBe(1);
    expect(h.queue.pending()).toEqual([]);
  });

  it('keeps the id stable across a reload, so replay still dedupes', async () => {
    const storage = new MemoryStorageAdapter();
    const offline = new FakeQueueTransport();
    offline.isOpen = false;

    const first = harness({ storage, transport: offline, nextId: idGenerator('ulid') });
    await first.queue.restore();
    const entry = await first.queue.enqueue('sess-1', text('across a reload'));

    const second = harness({ storage, nextId: idGenerator('other') });
    await second.queue.restore();
    await second.queue.flush();

    expect(second.transport.sends[0]?.id).toBe(entry.id);
  });

  it('preserves a top-level attachment through queue and replay (D4)', async () => {
    const attachment = {
      url: 'https://cdn.example.com/a.pdf',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      mediaType: 'FILE',
    };
    const storage = new MemoryStorageAdapter();
    const offline = new FakeQueueTransport();
    offline.isOpen = false;

    const first = harness({ storage, transport: offline });
    await first.queue.restore();
    await first.queue.enqueue('sess-1', { content: 'see attached', type: 'FILE', attachment });

    const second = harness({ storage });
    await second.queue.restore();
    await second.queue.flush();

    // Top-level, never nested under metadata — the shape that silently dropped
    // attachments behind successful acks when the two sides disagreed.
    expect(second.transport.sends[0]?.payload.attachment).toEqual(attachment);
    expect(second.transport.sends[0]?.payload.metadata).toBeUndefined();
  });
});

describe('SendQueue in-flight sends on disconnect (§8.4)', () => {
  it('keeps an unacked send queued when the transport drops', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(DISCONNECTED);
    const entry = await h.queue.enqueue('sess-1', text('in flight'));
    await h.queue.flush();

    // Never removed, so there is no path that could have dropped it.
    expect(h.queue.pending().map((e) => e.id)).toEqual([entry.id]);
    expect(h.failures).toEqual([]);
  });

  it('keeps an unacked send queued when the socket dies mid-flight', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.onSend = () => {
      h.transport.isOpen = false;
    };

    const entry = await h.queue.enqueue('sess-1', text('socket died'));
    await h.queue.flush();

    expect(h.queue.pending().map((e) => e.id)).toEqual([entry.id]);

    // And it is durable, not merely in memory.
    const reloaded = harness({ storage: h.storage });
    await reloaded.queue.restore();
    expect(reloaded.queue.pending().map((e) => e.id)).toEqual([entry.id]);
  });

  it('holds a timed-out send for replay rather than retrying in a spin', async () => {
    // Enqueued while offline so the only sends counted come from an explicit
    // flush — `enqueue` also kicks a background drain, and conflating the two
    // would make this assert the wrong thing.
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();
    await h.queue.enqueue('sess-1', text('no answer'));

    h.transport.isOpen = true;
    h.transport.respondWith(TIMEOUT);
    await h.queue.flush();

    // Exactly one attempt per flush. A timeout means the peer is not
    // answering, and the connection controller — not this queue — owns
    // deciding when to try again.
    expect(h.transport.sends).toHaveLength(1);
    expect(h.queue.pending()).toHaveLength(1);

    // A later flush is that decision arriving, so it retries — same id.
    await h.queue.flush();
    expect(h.transport.sends).toHaveLength(2);
    expect(h.transport.sends[0]?.id).toBe(h.transport.sends[1]?.id);
  });

  it('removes a send once the server acks it, and reports the assigned seq', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(acked(42));
    const entry = await h.queue.enqueue('sess-1', text('confirmed'));
    await h.queue.flush();

    expect(h.queue.pending()).toEqual([]);
    expect(h.acks).toEqual([{ entry: expect.objectContaining({ id: entry.id }), seq: 42 }]);

    // Gone from storage too, not just from memory.
    const reloaded = harness({ storage: h.storage });
    await reloaded.queue.restore();
    expect(reloaded.queue.pending()).toEqual([]);
  });

  it('tolerates an ack that carries no seq', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(acked());
    await h.queue.enqueue('sess-1', text('no seq'));
    await h.queue.flush();

    expect(h.acks[0]?.seq).toBeUndefined();
  });
});

describe('SendQueue retention (§9.6)', () => {
  it('surfaces an entry that outlived maxAgeMs as permanently failed', async () => {
    const storage = new MemoryStorageAdapter();
    const offline = new FakeQueueTransport();
    offline.isOpen = false;

    const first = harness({ storage, transport: offline, now: 0, maxAgeMs: HOUR });
    await first.queue.restore();
    const entry = await first.queue.enqueue('sess-1', text('too old'));

    // Reload a day later.
    const second = harness({ storage, now: 25 * HOUR, maxAgeMs: HOUR });
    const report = await second.queue.restore();

    expect(report.expired).toBe(1);
    expect(second.failures).toEqual([{ entry: expect.objectContaining({ id: entry.id }), reason: 'expired' }]);
    expect(second.queue.pending()).toEqual([]);

    // Not retried forever in silence — and removed from storage, so a later
    // reload cannot resurrect a message already called dead.
    await second.queue.flush();
    expect(second.transport.sends).toEqual([]);
  });

  it('expires an entry that ages out while queued, before attempting it', async () => {
    const h = harness({ now: 0, maxAgeMs: HOUR });
    h.transport.isOpen = false;
    await h.queue.restore();
    await h.queue.enqueue('sess-1', text('will age out'));

    h.transport.isOpen = true;
    h.setNow(3 * HOUR);
    await h.queue.flush();

    expect(h.transport.sends).toEqual([]);
    expect(h.failures.map((f) => f.reason)).toEqual(['expired']);
  });

  it('bounds the queue by size, evicting oldest first', async () => {
    const h = harness({ maxEntries: 3 });
    h.transport.isOpen = false;
    await h.queue.restore();

    for (const body of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      await h.queue.enqueue('sess-1', text(body));
    }

    expect(h.queue.pending().map((e) => e.payload.content)).toEqual(['m3', 'm4', 'm5']);
    expect(h.failures.map((f) => f.reason)).toEqual(['evicted', 'evicted']);
    expect(h.failures.map((f) => f.entry.payload.content)).toEqual(['m1', 'm2']);
  });

  it('surfaces a server rejection as permanently failed with its code', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(rejected('VALIDATION_FAILED'));
    await h.queue.enqueue('sess-1', text('refused'));
    await h.queue.flush();

    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]?.reason).toBe('rejected');
    expect(h.failures[0]?.code).toBe('VALIDATION_FAILED');
    expect(h.queue.pending()).toEqual([]);
  });

  it('exposes failures and lets them be discarded once handled', async () => {
    const h = harness();
    await h.queue.restore();
    h.transport.respondWith(rejected());
    const entry = await h.queue.enqueue('sess-1', text('refused'));
    await h.queue.flush();

    expect(h.queue.failed()).toHaveLength(1);
    h.queue.discardFailed(entry.id);
    expect(h.queue.failed()).toEqual([]);
  });

  it('records no failure for a send enqueue already rejected', async () => {
    // One fact, one channel: a send that was never queued reports through the
    // rejection, not through failed().
    const storage = new FaultStorageAdapter();
    const h = harness({ storage });
    await h.queue.restore();
    storage.failEverySet = 'write_failed';

    await expect(h.queue.enqueue('sess-1', text('nope'))).rejects.toBeDefined();

    expect(h.queue.failed()).toEqual([]);
    expect(h.failures).toEqual([]);
  });
});

describe('SendQueue concurrent mutation (regression)', () => {
  // Every mutation reads `#entries`, awaits a durable write, then assigns the
  // result. Interleaving two of those loses data in both directions, and both
  // directions are silent, so both get a test.

  it('persists every one of several concurrent enqueues', async () => {
    // Without serialization each call snapshots the same empty list and the
    // last write wins, leaving exactly one survivor out of five.
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();

    await Promise.all(
      ['m1', 'm2', 'm3', 'm4', 'm5'].map((body) => h.queue.enqueue('sess-1', text(body))),
    );

    expect(h.queue.pending().map((e) => e.payload.content)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
    ]);

    // And durably, not just in memory.
    const reloaded = harness({ storage: h.storage });
    await reloaded.queue.restore();
    expect(reloaded.queue.pending()).toHaveLength(5);
  });

  it('neither drops nor duplicates when an enqueue lands mid-delivery', async () => {
    // The other direction. A delivery removes the head and writes the shorter
    // list; an enqueue that snapshotted before that write appends to the
    // longer one. Unserialized, whichever resolves last wins: either the
    // delivered message comes back and is sent twice, or the new message is
    // silently discarded. Both are asserted against here.
    const h = harness();
    h.transport.isOpen = false;
    await h.queue.restore();

    // Queued offline, so the first delivery happens under the flush below
    // rather than under the background drain `enqueue` kicks — that drain
    // reaches `sendWithId` synchronously, so a hook installed afterwards would
    // never fire and the race would quietly not be exercised at all.
    const first = await h.queue.enqueue('sess-1', text('delivered once'));
    h.transport.isOpen = true;

    let raced: Promise<unknown> = Promise.resolve();
    h.transport.onSend = () => {
      h.transport.onSend = undefined;
      raced = h.queue.enqueue('sess-1', text('arrived mid-flight'));
    };

    await h.queue.flush();
    await raced;
    await h.queue.flush();

    // Delivered exactly once — not resurrected.
    expect(h.transport.sends.filter((send) => send.id === first.id)).toHaveLength(1);

    // And the message that raced it was delivered too — not dropped.
    const bodies = h.transport.sends.map((send) => send.payload.content);
    expect(bodies).toContain('arrived mid-flight');
    expect(h.queue.pending()).toEqual([]);
    expect(h.failures).toEqual([]);
  });
});

describe('SendQueue.abandonSession — a session that ended under its queue (§12.5)', () => {
  it('fails only the closed session\'s entries and leaves every other session alone', async () => {
    const offline = new FakeQueueTransport();
    offline.isOpen = false;
    const h = harness({ transport: offline });
    await h.queue.restore();

    await h.queue.enqueue('sess-closed', text('about the resolved order'));
    await h.queue.enqueue('sess-other', text('a different conversation'));
    await h.queue.enqueue('sess-closed', text('and one more'));

    const abandoned = await h.queue.abandonSession('sess-closed');

    expect(abandoned.map((entry) => entry.payload.content)).toEqual([
      'about the resolved order',
      'and one more',
    ]);
    expect(h.queue.pending().map((entry) => entry.sessionId)).toEqual(['sess-other']);
  });

  it('reports each abandoned send through onFailed as sessionClosed', async () => {
    const offline = new FakeQueueTransport();
    offline.isOpen = false;
    const h = harness({ transport: offline });
    await h.queue.restore();
    await h.queue.enqueue('sess-closed', text('never sent'));

    await h.queue.abandonSession('sess-closed');

    // Not silently dropped: the customer's binding gets one failure per dead
    // send, which is what lets it render them as re-sendable rather than
    // having them simply vanish.
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]?.reason).toBe('sessionClosed');
    expect(h.failures[0]?.entry.payload.content).toBe('never sent');
  });

  it('never delivers an abandoned send once the socket comes back', async () => {
    const offline = new FakeQueueTransport();
    offline.isOpen = false;
    const h = harness({ transport: offline });
    await h.queue.restore();
    await h.queue.enqueue('sess-closed', text('must not reappear'));

    await h.queue.abandonSession('sess-closed');

    // The hazard this method exists for: `message.send` carries no sessionId,
    // so a surviving entry would be attributed to whatever session the socket
    // holds after the reconnect — i.e. the NEW conversation.
    offline.isOpen = true;
    await h.queue.flush();

    expect(offline.sends).toHaveLength(0);
  });

  it('drops the entries from storage, so a reload does not resurrect them', async () => {
    const storage = new MemoryStorageAdapter();
    const offline = new FakeQueueTransport();
    offline.isOpen = false;

    const first = harness({ storage, transport: offline });
    await first.queue.restore();
    await first.queue.enqueue('sess-closed', text('gone for good'));
    await first.queue.abandonSession('sess-closed');

    const second = harness({ storage, transport: new FakeQueueTransport() });
    const report = await second.queue.restore();

    expect(report.restored).toBe(0);
    expect(second.queue.pending()).toHaveLength(0);
  });

  it('is a no-op for a session with nothing queued', async () => {
    const h = harness();
    await h.queue.restore();

    await expect(h.queue.abandonSession('sess-empty')).resolves.toEqual([]);
    expect(h.failures).toHaveLength(0);
  });

  it('reports an in-flight send exactly once when it is abandoned mid-wire', async () => {
    const transport = new FakeQueueTransport();
    // Answer the send only after the abandon has already removed the entry,
    // which is the race a naive implementation double-reports.
    let abandon!: Promise<readonly QueuedSend[]>;
    const h = harness({ transport });
    await h.queue.restore();

    transport.onSend = () => {
      transport.onSend = undefined;
      abandon = h.queue.abandonSession('sess-closed');
    };
    transport.respondWith(rejected('VALIDATION_FAILED'));

    await h.queue.enqueue('sess-closed', text('in flight when it died'));
    await h.queue.flush();
    await abandon;

    expect(h.failures).toHaveLength(1);
    expect(h.queue.pending()).toHaveLength(0);
  });
});

// T9: the queue-side primitive that makes a correct client-level
// `retryMessage(id)` possible (T10). The widget's pre-fix "retry" called
// `sendMessage(message.content)` again, which mints a brand-new ULID
// (`enqueue()`) — every retry therefore created a second, independently
// failing message instead of re-attempting the first one. `retry()` is the
// fix's queue-level half: it replays the SAME id and nothing else.
describe('SendQueue.retry — correct retry of a permanently-failed send (§9.3, D1)', () => {
  it('replays the original id on retry, minting no new ULID', async () => {
    const h = harness({ nextId: idGenerator('ulid') });
    await h.queue.restore();

    h.transport.respondWith(rejected('RATE_LIMITED', true));
    const entry = await h.queue.enqueue('sess-1', text('will fail then retry'));
    await h.queue.flush();

    expect(h.failures).toHaveLength(1);
    expect(h.queue.pending()).toEqual([]);

    h.transport.respondWith(acked(9));
    const outcome = await h.queue.retry(entry.id);
    expect(outcome.status).toBe('retried');
    if (outcome.status === 'retried') expect(outcome.entry.id).toBe(entry.id);

    await h.queue.flush();

    // Same id both times on the wire — no fresh ULID for the retry.
    expect(h.transport.sends.map((s) => s.id)).toEqual([entry.id, entry.id]);

    // And the generator itself was only ever asked once: the next genuinely
    // new send gets the next id in sequence, proving retry() never called it.
    const next = await h.queue.enqueue('sess-1', text('a different message'));
    expect(next.id).toBe('ulid-2');
  });

  it('refuses to retry a non-retryable failure, leaving it failed and enqueuing nothing', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(rejected('VALIDATION_FAILED')); // retryable: false (default)
    const entry = await h.queue.enqueue('sess-1', text('permanently wrong'));
    await h.queue.flush();
    expect(h.transport.sends).toHaveLength(1);

    const outcome = await h.queue.retry(entry.id);

    expect(outcome).toEqual({ status: 'refused', reason: 'not-retryable' });
    // Not silently dropped — still there for the app to keep showing as dead.
    expect(h.queue.failed().map((f) => f.entry.id)).toEqual([entry.id]);
    // And nothing new was ever written to the wire or the durable queue.
    expect(h.transport.sends).toHaveLength(1);
    expect(h.queue.pending()).toEqual([]);
  });

  it('refuses retry of an id with nothing eligible under it', async () => {
    const h = harness();
    await h.queue.restore();

    await expect(h.queue.retry('never-existed')).resolves.toEqual({
      status: 'refused',
      reason: 'not-found',
    });
  });

  it('refuses a second retry of an id already claimed by the first (not a no-op, not a double send)', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(rejected('RATE_LIMITED', true));
    const entry = await h.queue.enqueue('sess-1', text('flaky'));
    await h.queue.flush();
    expect(h.queue.failed()).toHaveLength(1);

    // Isolate the claim/idempotency logic from delivery timing — both
    // `retry()` calls only need to durably re-queue, not be answered.
    h.transport.isOpen = false;

    const outcomes = await Promise.all([h.queue.retry(entry.id), h.queue.retry(entry.id)]);

    expect(outcomes.filter((o) => o.status === 'retried')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'refused')).toEqual([
      { status: 'refused', reason: 'not-found' },
    ]);

    // Exactly one copy re-queued, not two, and the failure record is consumed
    // by whichever call won — this is the `#mutate` chain doing its job.
    expect(h.queue.pending().filter((e) => e.id === entry.id)).toHaveLength(1);
    expect(h.queue.failed()).toEqual([]);
  });

  it('throws QueueNotRestoredError if called before restore()', async () => {
    const h = harness();
    await expect(h.queue.retry('whatever')).rejects.toThrow(QueueNotRestoredError);
  });
});

// T5 left a required follow-up here: `FailedSend` needed `retryable?:
// boolean`, populated in `#settle`'s 'rejected' branch from
// `outcome.error.retryable`, so `MessageController.onFailed` (which already
// reads `failure.retryable ?? DEFAULT_RETRYABLE_FALLBACK`) stops always
// taking the fallback path. These prove the queue's half of that wiring;
// `messages/controller.test.ts` proves the controller reads it correctly —
// unchanged by this, since those tests call `controller.onFailed` directly
// with hand-built `FailedSend`-shaped objects rather than through a real
// `SendQueue`.
describe('SendQueue — retryable flows from the server signal into FailedSend (§7.4)', () => {
  it('records retryable: true on a rejection the server marked retryable', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(rejected('RATE_LIMITED', true));
    await h.queue.enqueue('sess-1', text('try again later'));
    await h.queue.flush();

    expect(h.failures[0]?.retryable).toBe(true);
    expect(h.queue.failed()[0]?.retryable).toBe(true);
  });

  it('records retryable: false on a rejection the server marked non-retryable', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(rejected('VALIDATION_FAILED', false));
    await h.queue.enqueue('sess-1', text('malformed'));
    await h.queue.flush();

    expect(h.failures[0]?.retryable).toBe(false);
  });

  it('leaves retryable absent for a locally-decided reason with no wire ErrorPayload to mirror', async () => {
    const offline = new FakeQueueTransport();
    offline.isOpen = false;
    const h = harness({ transport: offline });
    await h.queue.restore();
    await h.queue.enqueue('sess-closed', text('never sent'));

    await h.queue.abandonSession('sess-closed');

    expect(h.failures[0]?.reason).toBe('sessionClosed');
    expect(h.failures[0]?.retryable).toBeUndefined();
  });
});

// T4 asked T9 to audit the queue for its own version of the unbounded-wait
// gap T4 closed at the connection layer, and flagged one specific,
// previously-filed defect to decide on: an ack `timeout` on a still-OPEN
// socket leaves the entry `'queued'` (renders as the pending tick) until an
// explicit `flush()` — which today fires only on the `connected` transition.
// If the peer goes quiet for exactly one message's ack while the socket
// otherwise looks healthy, nothing re-triggers `flush()` and the message
// spins forever. This suite documents that behavior as a spec — a guard
// against a "fix" that reintroduces the busy-loop `#stalled` exists to
// prevent — rather than papering over it with queue-level polling. See the
// T9 report for why the real fix belongs at the transport/connection layer
// (treat a send ack-timeout as a liveness signal, same as a missed
// heartbeat), not here.
describe('SendQueue stall on ack timeout — documented gap, not fixed in this module', () => {
  it('does not resume a timed-out session on its own; only an explicit flush() does', async () => {
    const h = harness();
    await h.queue.restore();

    h.transport.respondWith(TIMEOUT);
    await h.queue.enqueue('sess-1', text('no answer'));
    await h.queue.flush();

    expect(h.transport.sends).toHaveLength(1);
    // Still 'queued', not 'failed' — a silent spinner, not a Retry button.
    expect(h.queue.pending()).toHaveLength(1);
    expect(h.failures).toEqual([]);

    // The socket is still reported open — this is the "connected but acking
    // nothing" half, distinct from the disconnect T4 already covers — yet a
    // brand-new send to the SAME session gets no attempt at all: `#stalled`
    // gates the whole session per `#drain`'s doc, and background drains
    // (the one `enqueue()` starts) deliberately do not clear it.
    h.transport.respondWith(acked(1));
    await h.queue.enqueue('sess-1', text('a second message, same session'));
    expect(h.transport.sends).toHaveLength(1);

    // The one existing recovery path: an explicit flush(), as fired by the
    // `connected` transition. Both entries go out once it does.
    await h.queue.flush();
    expect(h.transport.sends).toHaveLength(3);
    expect(h.queue.pending()).toEqual([]);
  });
});
