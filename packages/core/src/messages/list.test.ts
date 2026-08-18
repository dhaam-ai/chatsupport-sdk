import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../state/index.js';
import { compareBySeq, prependPage, sortMessages, upsertMessage } from './list.js';

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  const { seq, delivery, ...rest } = overrides;
  return {
    sessionId: 'sess-1',
    senderId: 'cust-1',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-08-18T10:00:00.000Z',
    ...rest,
    ...(seq === undefined ? {} : { seq }),
    ...(delivery === undefined ? {} : { delivery }),
  };
}

const ids = (messages: readonly ChatMessage[]): string[] => messages.map((m) => m.id);

describe('compareBySeq — §9.2/D2 ordering', () => {
  it('orders confirmed messages by seq ascending', () => {
    const sorted = sortMessages([
      message({ id: 'c', seq: 3 }),
      message({ id: 'a', seq: 1 }),
      message({ id: 'b', seq: 2 }),
    ]);

    expect(ids(sorted)).toEqual(['a', 'b', 'c']);
  });

  it('orders by seq even when createdAt disagrees — ts is never the key (D2)', () => {
    // Deliberately inverted timestamps: the message the server sequenced
    // FIRST claims the LATEST createdAt. If any code path reached for a
    // timestamp instead of `seq`, this list would come back reversed.
    const sorted = sortMessages([
      message({ id: 'second', seq: 2, createdAt: '2020-01-01T00:00:00.000Z' }),
      message({ id: 'first', seq: 1, createdAt: '2099-12-31T23:59:59.000Z' }),
    ]);

    expect(ids(sorted)).toEqual(['first', 'second']);
  });

  it('sorts unconfirmed messages after every confirmed one', () => {
    const sorted = sortMessages([
      message({ id: 'pending', delivery: { state: 'queued' } }),
      message({ id: 'confirmed', seq: 9 }),
    ]);

    expect(ids(sorted)).toEqual(['confirmed', 'pending']);
  });

  it('keeps unconfirmed messages in FIFO order (§9.2, stable sort)', () => {
    const sorted = sortMessages([
      message({ id: 'confirmed', seq: 1 }),
      message({ id: 'q1', delivery: { state: 'queued' } }),
      message({ id: 'q2', delivery: { state: 'queued' } }),
      message({ id: 'q3', delivery: { state: 'queued' } }),
    ]);

    expect(ids(sorted)).toEqual(['confirmed', 'q1', 'q2', 'q3']);
  });

  it('treats two unconfirmed messages as equal', () => {
    expect(compareBySeq(message({ id: 'a' }), message({ id: 'b' }))).toBe(0);
  });

  it('does not mutate the input array', () => {
    const input = [message({ id: 'b', seq: 2 }), message({ id: 'a', seq: 1 })];
    sortMessages(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('upsertMessage — §9.3 structural dedup on the ULID', () => {
  it('appends a message whose id is new', () => {
    const next = upsertMessage([message({ id: 'a', seq: 1 })], message({ id: 'b', seq: 2 }));
    expect(ids(next)).toEqual(['a', 'b']);
  });

  it('yields one entry when the same message arrives twice', () => {
    const arriving = message({ id: 'dup', seq: 5, content: 'only once' });

    const once = upsertMessage([message({ id: 'a', seq: 1 })], arriving);
    const twice = upsertMessage(once, arriving);

    expect(ids(twice)).toEqual(['a', 'dup']);
    expect(twice.filter((m) => m.id === 'dup')).toHaveLength(1);
  });

  it('dedups on id alone — identical content under a different id is a different message', () => {
    // The inverse of v1's content-matching echo suppressor (§12.9): two
    // genuinely distinct sends of the same text must both survive.
    const next = upsertMessage(
      [message({ id: 'ulid-1', seq: 1, content: 'ok' })],
      message({ id: 'ulid-2', seq: 2, content: 'ok' }),
    );

    expect(ids(next)).toEqual(['ulid-1', 'ulid-2']);
  });

  it('replaces in place and re-sorts when the replacement gains a seq', () => {
    const list = [
      message({ id: 'a', seq: 1 }),
      message({ id: 'pending', delivery: { state: 'queued' } }),
    ];

    const next = upsertMessage(list, message({ id: 'pending', seq: 2 }));

    expect(ids(next)).toEqual(['a', 'pending']);
    expect(next[1]?.seq).toBe(2);
    expect(next[1]?.delivery).toBeUndefined();
  });

  it('does not mutate the input array', () => {
    const input = [message({ id: 'a', seq: 1 })];
    upsertMessage(input, message({ id: 'b', seq: 2 }));
    expect(input).toHaveLength(1);
  });
});

describe('prependPage — §6.3/§12.10 backward pagination', () => {
  it('prepends an older page ahead of the existing list', () => {
    const existing = [message({ id: 'c', seq: 3 }), message({ id: 'd', seq: 4 })];
    const page = [message({ id: 'a', seq: 1 }), message({ id: 'b', seq: 2 })];

    expect(ids(prependPage(existing, page))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not reorder the existing list', () => {
    const existing = [
      message({ id: 'c', seq: 3 }),
      message({ id: 'd', seq: 4 }),
      message({ id: 'pending', delivery: { state: 'queued' } }),
    ];

    const next = prependPage(existing, [message({ id: 'b', seq: 2 })]);

    expect(ids(next)).toEqual(['b', 'c', 'd', 'pending']);
  });

  it('preserves object identity of messages already loaded', () => {
    const kept = message({ id: 'c', seq: 3 });
    const next = prependPage([kept], [message({ id: 'a', seq: 1 })]);

    // Not just equal — the SAME object, so a binding's list keys and
    // memoized rows survive a loadMore.
    expect(next[1]).toBe(kept);
  });

  it('skips overlapping ids rather than replacing them', () => {
    const kept = message({ id: 'overlap', seq: 2, content: 'live copy' });
    const next = prependPage(
      [kept],
      [message({ id: 'a', seq: 1 }), message({ id: 'overlap', seq: 2, content: 'page copy' })],
    );

    expect(ids(next)).toEqual(['a', 'overlap']);
    expect(next[1]).toBe(kept);
    expect(next[1]?.content).toBe('live copy');
  });

  it('returns the same array reference when the page adds nothing', () => {
    const existing = [message({ id: 'a', seq: 1 })];
    expect(prependPage(existing, [message({ id: 'a', seq: 1 })])).toBe(existing);
    expect(prependPage(existing, [])).toBe(existing);
  });
});
