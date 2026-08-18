import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter, StorageError, isStorageError } from '../storage/index.js';
import { decodeQueue } from './codec.js';
import { FaultStorageAdapter } from './fault-storage.js';
import { QueuePersistence } from './persistence.js';
import type { QueuedSend } from './types.js';

const KEY = 'sendQueue';

function entry(id: string, enqueuedAt = 1_000): QueuedSend {
  return {
    id,
    sessionId: 'sess-1',
    payload: { content: `body-${id}`, type: 'TEXT' },
    enqueuedAt,
    attempts: 0,
  };
}

describe('QueuePersistence', () => {
  it('round-trips entries through the adapter', async () => {
    const storage = new MemoryStorageAdapter();
    const persistence = new QueuePersistence(storage, KEY);

    await persistence.save([entry('a'), entry('b')]);

    const loaded = await persistence.load();
    expect(loaded.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('removes the key rather than storing an empty blob', async () => {
    const storage = new MemoryStorageAdapter();
    const persistence = new QueuePersistence(storage, KEY);
    await persistence.save([entry('a')]);

    await persistence.save([]);

    // Frees the space instead of occupying it, which is what matters in the
    // quota-pressure case.
    expect(await storage.get(KEY)).toBeNull();
  });

  it('propagates a read fault instead of reporting an empty queue', async () => {
    // The load-bearing one. `null` means absent; a rejection means unknown.
    // Collapsing the two would let a reload read a transient fault as "no
    // pending messages" and discard every one of them.
    const storage = new FaultStorageAdapter();
    storage.failNextGet = 'read_failed';
    const persistence = new QueuePersistence(storage, KEY);

    await expect(persistence.load()).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'read_failed',
    );
  });

  it('sheds the oldest entries and retries when the store is full', async () => {
    const storage = new FaultStorageAdapter({ maxChars: 260 });
    const persistence = new QueuePersistence(storage, KEY);

    const entries = [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)];
    const outcome = await persistence.save(entries);

    // Something landed, something was shed, and the two account for the whole
    // input with nothing quietly vanishing.
    expect(outcome.persisted.length).toBeGreaterThan(0);
    expect(outcome.evicted.length).toBeGreaterThan(0);
    expect([...outcome.evicted, ...outcome.persisted].map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);

    // Oldest first.
    expect(outcome.evicted[0]?.id).toBe('a');

    // And what it says it kept is genuinely on disk.
    expect(decodeQueue(storage.peek(KEY)).entries.map((e) => e.id)).toEqual(
      outcome.persisted.map((e) => e.id),
    );
  });

  it('sheds every entry when quota never relents, accounting for each one', async () => {
    // Deliberately resolves rather than rejects. Shedding to empty leaves each
    // entry individually reported as evicted, so the app can tell the user
    // exactly which messages died; a blanket rejection would collapse that
    // into one storage error and lose the per-message accounting. The queue
    // then treats "absent from persisted" as "not queued", which is the same
    // check it already makes on every write.
    const storage = new FaultStorageAdapter();
    storage.failEverySet = 'quota_exceeded';
    const persistence = new QueuePersistence(storage, KEY);

    const outcome = await persistence.save([entry('a'), entry('b')]);

    expect(outcome.persisted).toEqual([]);
    expect(outcome.evicted.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('rejects when even clearing the key reports quota', async () => {
    // Out of room with nothing left to give back is no longer a size problem,
    // so it stops being treated as one.
    const persistence = new QueuePersistence(
      {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new StorageError('quota_exceeded', 'full')),
        remove: () => Promise.reject(new StorageError('quota_exceeded', 'still full')),
      },
      KEY,
    );

    await expect(persistence.save([entry('a')])).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'quota_exceeded',
    );
  });

  it('never retries or salvages a write_failed', async () => {
    const storage = new FaultStorageAdapter();
    storage.failEverySet = 'write_failed';
    const persistence = new QueuePersistence(storage, KEY);

    await expect(persistence.save([entry('a'), entry('b')])).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'write_failed',
    );

    // Exactly one attempt: an unknown-cause failure gets no shedding loop,
    // because shedding cannot fix a cause we do not understand.
    expect(storage.setCalls).toHaveLength(1);
  });

  it('propagates a non-StorageError untouched', async () => {
    const boom = new TypeError('adapter blew up');
    const persistence = new QueuePersistence(
      {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(boom),
        remove: () => Promise.resolve(),
      },
      KEY,
    );

    await expect(persistence.save([entry('a')])).rejects.toBe(boom);
  });

  it('reports nothing evicted on an ordinary successful write', async () => {
    const persistence = new QueuePersistence(new MemoryStorageAdapter(), KEY);

    const outcome = await persistence.save([entry('a')]);

    expect(outcome.evicted).toEqual([]);
    expect(outcome.persisted.map((e) => e.id)).toEqual(['a']);
  });

  it('surfaces a StorageError thrown by remove on an empty save', async () => {
    const persistence = new QueuePersistence(
      {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        remove: () => Promise.reject(new StorageError('write_failed', 'remove failed')),
      },
      KEY,
    );

    await expect(persistence.save([])).rejects.toSatisfy(
      (error: unknown) => isStorageError(error) && error.code === 'write_failed',
    );
  });
});
