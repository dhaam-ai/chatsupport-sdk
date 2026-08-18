import { describe, expect, it } from 'vitest';

import { applyRetention, resolveRetention } from './retention.js';
import { DEFAULT_MAX_AGE_MS, DEFAULT_MAX_ENTRIES } from './types.js';
import type { QueuedSend } from './types.js';

const HOUR = 60 * 60 * 1000;

function entry(id: string, enqueuedAt: number, sessionId = 'sess-1'): QueuedSend {
  return {
    id,
    sessionId,
    payload: { content: `body-${id}`, type: 'TEXT' },
    enqueuedAt,
    attempts: 0,
  };
}

describe('resolveRetention', () => {
  it('fills in the documented defaults', () => {
    // Open Question 9 asks for documented defaults rather than a blocked task.
    expect(resolveRetention()).toEqual({
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      maxEntries: DEFAULT_MAX_ENTRIES,
    });
    expect(DEFAULT_MAX_AGE_MS).toBe(24 * HOUR);
    expect(DEFAULT_MAX_ENTRIES).toBe(200);
  });

  it('lets each bound be overridden independently', () => {
    expect(resolveRetention({ maxAgeMs: 5 })).toEqual({
      maxAgeMs: 5,
      maxEntries: DEFAULT_MAX_ENTRIES,
    });
    expect(resolveRetention({ maxEntries: 3 })).toEqual({
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      maxEntries: 3,
    });
  });
});

describe('applyRetention', () => {
  const bounds = { maxAgeMs: HOUR, maxEntries: 3 };

  it('keeps everything inside both bounds', () => {
    const entries = [entry('a', 1000), entry('b', 2000)];

    const split = applyRetention(entries, 3000, bounds);

    expect(split.kept).toEqual(entries);
    expect(split.expired).toEqual([]);
    expect(split.evicted).toEqual([]);
  });

  it('expires entries strictly older than maxAgeMs', () => {
    const split = applyRetention([entry('old', 0), entry('fresh', HOUR)], 2 * HOUR, bounds);

    expect(split.expired.map((e) => e.id)).toEqual(['old']);
    expect(split.kept.map((e) => e.id)).toEqual(['fresh']);
  });

  it('treats an entry exactly at the age bound as still alive', () => {
    // The comparison is `>`, not `>=` — an entry that has just reached the
    // limit has not yet outlived it.
    const split = applyRetention([entry('edge', 0)], HOUR, bounds);

    expect(split.expired).toEqual([]);
    expect(split.kept.map((e) => e.id)).toEqual(['edge']);
  });

  it('evicts the oldest to fit maxEntries', () => {
    const entries = [
      entry('m1', 100),
      entry('m2', 200),
      entry('m3', 300),
      entry('m4', 400),
      entry('m5', 500),
    ];

    const split = applyRetention(entries, 600, bounds);

    expect(split.evicted.map((e) => e.id)).toEqual(['m1', 'm2']);
    expect(split.kept.map((e) => e.id)).toEqual(['m3', 'm4', 'm5']);
  });

  it('applies age before size, so a doomed entry does not evict a healthy one', () => {
    // Ordering matters: expiring first frees room, so nothing fresh has to be
    // evicted to make space for an entry that was about to be discarded.
    const entries = [
      entry('ancient', 0),
      entry('f1', 2 * HOUR),
      entry('f2', 2 * HOUR),
      entry('f3', 2 * HOUR),
    ];

    const split = applyRetention(entries, 2 * HOUR, bounds);

    expect(split.expired.map((e) => e.id)).toEqual(['ancient']);
    expect(split.evicted).toEqual([]);
    expect(split.kept.map((e) => e.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('preserves per-session order while evicting globally oldest', () => {
    // §9.2: FIFO is per session. Removing the globally-oldest entries must
    // leave the relative order within every session untouched.
    const entries = [
      entry('a1', 100, 'sess-a'),
      entry('b1', 200, 'sess-b'),
      entry('a2', 300, 'sess-a'),
      entry('b2', 400, 'sess-b'),
      entry('a3', 500, 'sess-a'),
    ];

    const split = applyRetention(entries, 600, bounds);

    const idsFor = (session: string): string[] =>
      split.kept.filter((e) => e.sessionId === session).map((e) => e.id);

    expect(split.evicted.map((e) => e.id)).toEqual(['a1', 'b1']);
    expect(idsFor('sess-a')).toEqual(['a2', 'a3']);
    expect(idsFor('sess-b')).toEqual(['b2']);
  });

  it('accounts for every input entry exactly once', () => {
    const entries = [entry('x', 0), entry('y', 2 * HOUR), entry('z', 2 * HOUR)];

    const split = applyRetention(entries, 2 * HOUR, { maxAgeMs: HOUR, maxEntries: 1 });

    const all = [...split.expired, ...split.evicted, ...split.kept].map((e) => e.id).sort();
    expect(all).toEqual(['x', 'y', 'z']);
  });

  it('handles an empty queue', () => {
    expect(applyRetention([], 0, bounds)).toEqual({ kept: [], expired: [], evicted: [] });
  });

  it('does not mutate the input', () => {
    const entries = [entry('a', 0), entry('b', 100)];
    const before = [...entries];

    applyRetention(entries, 5 * HOUR, bounds);

    expect(entries).toEqual(before);
  });
});
