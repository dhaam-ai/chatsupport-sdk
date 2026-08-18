import { describe, expect, it } from 'vitest';

import * as queue from './index.js';

// The barrel is a decision about what the rest of core may depend on, so it
// gets a test for the same reason state/ and protocol/ do: an export added by
// reflex is a commitment nobody argued for, and one deleted by accident is a
// silent break in a consumer that has not been written yet.

describe('queue module barrel', () => {
  it('exports exactly the intended surface', () => {
    // Runtime values only — types are erased and cannot be asserted here.
    expect(Object.keys(queue).sort()).toEqual(
      [
        'DEFAULT_MAX_AGE_MS',
        'DEFAULT_MAX_ENTRIES',
        'DEFAULT_STORAGE_KEY',
        'DISCONNECTED',
        'FakeQueueTransport',
        'FaultStorageAdapter',
        'QUEUE_SCHEMA_VERSION',
        'QueueNotRestoredError',
        'QueuePersistence',
        'SendQueue',
        'StorageQueueError',
        'TIMEOUT',
        'acked',
        'applyRetention',
        'decodeQueue',
        'encodeQueue',
        'rejected',
        'resolveRetention',
      ].sort(),
    );
  });

  it('publishes the retention defaults as values, not just types', () => {
    // §9.6 / Open Question 9: the numbers are a documented default and a
    // tuning knob, so a consumer must be able to read them at runtime in order
    // to show or override them.
    expect(queue.DEFAULT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(queue.DEFAULT_MAX_ENTRIES).toBe(200);
    expect(queue.DEFAULT_STORAGE_KEY).toBe('sendQueue');
  });

  it('constructs a working queue through the barrel alone', () => {
    // The barrel has to be sufficient on its own — a consumer should never
    // need a deep import to use this module.
    const transport = new queue.FakeQueueTransport();
    const storage = new queue.FaultStorageAdapter();

    const sendQueue = new queue.SendQueue({ storage, transport });

    expect(sendQueue).toBeInstanceOf(queue.SendQueue);
    expect(sendQueue.pending()).toEqual([]);
    expect(sendQueue.failed()).toEqual([]);
  });

  it('refuses to enqueue before restore, through the barrel surface', async () => {
    const sendQueue = new queue.SendQueue({
      storage: new queue.FaultStorageAdapter(),
      transport: new queue.FakeQueueTransport(),
    });

    await expect(
      sendQueue.enqueue('sess-1', { content: 'too early', type: 'TEXT' }),
    ).rejects.toBeInstanceOf(queue.QueueNotRestoredError);
  });

  it('round-trips a durable send end to end through the barrel', async () => {
    // One integration pass over the seam a consumer actually touches:
    // restore, enqueue, deliver, confirm the queue is empty and stayed empty
    // in storage.
    const storage = new queue.FaultStorageAdapter();
    const transport = new queue.FakeQueueTransport();
    const sendQueue = new queue.SendQueue({ storage, transport });

    await sendQueue.restore();
    const entry = await sendQueue.enqueue('sess-1', { content: 'hello', type: 'TEXT' });
    await sendQueue.flush();

    expect(transport.sends.map((send) => send.id)).toEqual([entry.id]);
    expect(sendQueue.pending()).toEqual([]);
    expect(storage.peek(queue.DEFAULT_STORAGE_KEY)).toBeNull();
  });
});
