import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientFrame } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import type { StorageAdapter } from '../storage/index.js';
import { SendQueue } from './send-queue.js';

function sendFrame(id: string, content: string): ClientFrame {
  return { v: 1, t: 'message.send', id, ts: Date.now(), d: { content, type: 'TEXT' } };
}

describe('SendQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is empty initially', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });

    expect(await queue.peekAll()).toEqual([]);
  });

  it('enqueue then peekAll returns the item', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    const frame = sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'hi');

    await queue.enqueue(frame);
    const items = await queue.peekAll();

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(items[0]?.frame).toEqual(frame);
  });

  it('preserves FIFO order across multiple enqueues', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });

    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'second'));
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA3', 'third'));

    const items = await queue.peekAll();
    expect(items.map((i) => i.id)).toEqual([
      '01ARZ3NDEKTSV4RRFFQ69G5FA1',
      '01ARZ3NDEKTSV4RRFFQ69G5FA2',
      '01ARZ3NDEKTSV4RRFFQ69G5FA3',
    ]);
  });

  it('dequeueAcked removes only the matching item', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'second'));

    await queue.dequeueAcked('01ARZ3NDEKTSV4RRFFQ69G5FA1');

    const items = await queue.peekAll();
    expect(items.map((i) => i.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FA2']);
  });

  it('dequeueAcked is a no-op for an id not in the queue', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));

    await expect(queue.dequeueAcked('01ARZ3NDEKTSV4RRFFQ69G5FA9')).resolves.toBeUndefined();
    expect(await queue.peekAll()).toHaveLength(1);
  });

  it('flush calls send for every item in FIFO order, without removing anything', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'second'));
    const sent: string[] = [];

    await queue.flush((frame) => sent.push((frame as { d: { content: string } }).d.content));

    expect(sent).toEqual(['first', 'second']);
    expect(await queue.peekAll()).toHaveLength(2); // flush never mutates — see this class's header
  });

  it('flush stops without throwing if send() throws partway through, leaving the rest queued', async () => {
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'second'));
    const sent: string[] = [];

    await expect(
      queue.flush((frame) => {
        sent.push((frame as { d: { content: string } }).d.content);
        throw new Error('connection dropped mid-flush');
      }),
    ).resolves.toBeUndefined();

    expect(sent).toEqual(['first']); // stopped after the first throw, never reached 'second'
    expect(await queue.peekAll()).toHaveLength(2); // nothing removed either way
  });

  it('persists across separate SendQueue instances sharing the same storage and namespace', async () => {
    const storage = new MemoryStorageAdapter();
    const first = new SendQueue({ storage, namespace: 'q1' });
    await first.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));

    const second = new SendQueue({ storage, namespace: 'q1' });
    const items = await second.peekAll();

    expect(items).toHaveLength(1);
  });

  it('isolates queues with different namespaces sharing the same storage', async () => {
    const storage = new MemoryStorageAdapter();
    const a = new SendQueue({ storage, namespace: 'tenant-a' });
    const b = new SendQueue({ storage, namespace: 'tenant-b' });
    await a.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'from a'));

    expect(await a.peekAll()).toHaveLength(1);
    expect(await b.peekAll()).toHaveLength(0);
  });

  it('clear empties the queue without firing onExpired', async () => {
    const onExpired = vi.fn();
    const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1', onExpired });
    await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'first'));

    await queue.clear();

    expect(await queue.peekAll()).toEqual([]);
    expect(onExpired).not.toHaveBeenCalled();
  });

  describe('retention — age', () => {
    it('prunes an item older than maxAgeMs and fires onExpired for it', async () => {
      const onExpired = vi.fn();
      const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1', maxAgeMs: 1000, onExpired });
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'stale'));

      vi.advanceTimersByTime(1001);
      const dropped = await queue.prune();

      expect(dropped.map((i) => i.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FA1']);
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(await queue.peekAll()).toEqual([]);
    });

    it('keeps an item younger than maxAgeMs', async () => {
      const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1', maxAgeMs: 1000 });
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'fresh'));

      vi.advanceTimersByTime(999);
      const dropped = await queue.prune();

      expect(dropped).toEqual([]);
      expect(await queue.peekAll()).toHaveLength(1);
    });

    it('applies retention automatically on enqueue, not just on explicit prune()', async () => {
      const onExpired = vi.fn();
      const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1', maxAgeMs: 1000, onExpired });
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'stale'));

      vi.advanceTimersByTime(1001);
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'fresh'));

      expect(onExpired).toHaveBeenCalledTimes(1);
      const items = await queue.peekAll();
      expect(items.map((i) => i.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FA2']);
    });
  });

  describe('retention — size', () => {
    it('drops the oldest items once over maxSize, keeping the newest', async () => {
      const onExpired = vi.fn();
      const queue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1', maxSize: 2, onExpired });
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'oldest'));
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA2', 'middle'));
      await queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA3', 'newest'));

      const items = await queue.peekAll();
      expect(items.map((i) => i.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FA2', '01ARZ3NDEKTSV4RRFFQ69G5FA3']);
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(onExpired.mock.calls[0]?.[0]).toMatchObject({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA1' });
    });
  });

  describe('degrades gracefully on bad storage', () => {
    it('treats corrupted JSON under the key as an empty queue rather than throwing', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.set('q1:sendQueue', 'not valid json {{{');
      const queue = new SendQueue({ storage, namespace: 'q1' });

      await expect(queue.peekAll()).resolves.toEqual([]);
    });

    it('treats a storage read failure as an empty queue rather than throwing', async () => {
      const failingStorage: StorageAdapter = {
        get: () => Promise.reject(new Error('storage unavailable')),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };
      const queue = new SendQueue({ storage: failingStorage, namespace: 'q1' });

      await expect(queue.peekAll()).resolves.toEqual([]);
    });

    it('propagates a storage write failure from enqueue rather than silently losing the item', async () => {
      const failingStorage: StorageAdapter = {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new Error('quota exceeded')),
        remove: () => Promise.resolve(),
      };
      const queue = new SendQueue({ storage: failingStorage, namespace: 'q1' });

      await expect(queue.enqueue(sendFrame('01ARZ3NDEKTSV4RRFFQ69G5FA1', 'x'))).rejects.toThrow(/quota/);
    });
  });
});
