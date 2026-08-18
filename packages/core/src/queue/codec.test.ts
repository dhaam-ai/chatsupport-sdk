import { describe, expect, it } from 'vitest';

import { QUEUE_SCHEMA_VERSION, decodeQueue, encodeQueue } from './codec.js';
import type { QueuedSend } from './types.js';

function entry(overrides: Partial<QueuedSend> = {}): QueuedSend {
  return {
    id: '01HQ0000000000000000000001',
    sessionId: 'sess-1',
    payload: { content: 'hello', type: 'TEXT' },
    enqueuedAt: 1_700_000_000_000,
    attempts: 0,
    ...overrides,
  };
}

describe('encodeQueue / decodeQueue', () => {
  it('round-trips entries in order', () => {
    const entries = [
      entry({ id: 'a', payload: { content: 'first', type: 'TEXT' } }),
      entry({ id: 'b', payload: { content: 'second', type: 'TEXT' } }),
    ];

    const decoded = decodeQueue(encodeQueue(entries));

    expect(decoded.entries).toEqual(entries);
    expect(decoded.dropped).toBe(0);
  });

  it('preserves a top-level attachment rather than nesting it under metadata', () => {
    // D4: a recent production bug had the client writing `attachment`
    // top-level while the server read `metadata.attachment`, so attachments
    // vanished behind successful acks. A persisted round trip must not
    // reintroduce that by relocating the field.
    const attachment = {
      url: 'https://cdn.example.com/f.png',
      fileName: 'f.png',
      mimeType: 'image/png',
      size: 1024,
      mediaType: 'IMAGE',
    };

    const decoded = decodeQueue(encodeQueue([entry({ payload: { content: 'see', type: 'IMAGE', attachment } })]));

    expect(decoded.entries[0]?.payload.attachment).toEqual(attachment);
    expect(decoded.entries[0]?.payload.metadata).toBeUndefined();
  });

  it('treats an absent key as an empty queue, not a fault', () => {
    expect(decodeQueue(null)).toEqual({ entries: [], dropped: 0 });
  });

  it('returns an empty queue for unparseable JSON instead of throwing', () => {
    // A truncated localStorage write must not take the process down on the
    // next boot.
    expect(() => decodeQueue('{"v":1,"entries":[{')).not.toThrow();
    expect(decodeQueue('{"v":1,"entries":[{').entries).toEqual([]);
  });

  it('discards a blob written by an unrecognized schema version', () => {
    const foreign = JSON.stringify({ v: QUEUE_SCHEMA_VERSION + 1, entries: [entry()] });

    expect(decodeQueue(foreign).entries).toEqual([]);
  });

  it('drops only the malformed records and keeps the readable ones', () => {
    // The point of per-entry decoding: nine good pending sends must survive
    // one corrupt neighbour.
    const raw = JSON.stringify({
      v: QUEUE_SCHEMA_VERSION,
      entries: [
        entry({ id: 'good-1' }),
        { id: 'no-payload', sessionId: 's', enqueuedAt: 1, attempts: 0 },
        { nonsense: true },
        entry({ id: 'good-2' }),
      ],
    });

    const decoded = decodeQueue(raw);

    expect(decoded.entries.map((e) => e.id)).toEqual(['good-1', 'good-2']);
    expect(decoded.dropped).toBe(2);
  });

  it('rejects records whose payload fields have the wrong type', () => {
    const raw = JSON.stringify({
      v: QUEUE_SCHEMA_VERSION,
      entries: [
        { ...entry(), payload: { content: 42, type: 'TEXT' } },
        { ...entry(), payload: { content: 'ok', type: 7 } },
        { ...entry(), enqueuedAt: 'yesterday' },
        { ...entry(), id: '' },
      ],
    });

    const decoded = decodeQueue(raw);

    expect(decoded.entries).toEqual([]);
    expect(decoded.dropped).toBe(4);
  });

  it('ignores a blob whose entries field is not an array', () => {
    expect(decodeQueue(JSON.stringify({ v: QUEUE_SCHEMA_VERSION, entries: 'nope' })).entries).toEqual([]);
  });
});
