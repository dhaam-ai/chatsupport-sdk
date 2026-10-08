import { describe, expect, it } from 'vitest';
import type { ChatSessionSummary } from '@dhaam-ccrm/core';
import { orderByLatestActivity } from '../src/ui/session-order.js';

const row = (id: string, lastMessageAt: string | null, createdAt = '2026-10-01T00:00:00.000Z'): ChatSessionSummary =>
  ({ id, status: 'OPEN', mode: 'BOT', createdAt, closedAt: null, lastMessageAt, unreadCount: 0 }) as ChatSessionSummary;

const ids = (list: readonly ChatSessionSummary[]) => list.map((s) => s.id);

describe('orderByLatestActivity', () => {
  it('puts the conversation with the newest message first, whatever order the server sent', () => {
    const list = [row('old', '2026-10-07T07:00:00.000Z'), row('mid', '2026-10-07T09:38:00.000Z'), row('new', '2026-10-07T09:55:00.000Z')];
    expect(ids(orderByLatestActivity(list))).toEqual(['new', 'mid', 'old']);
  });

  it('uses the creation time for a conversation with no message, and keeps the server order for a tie', () => {
    const list = [row('a', null, '2026-10-07T08:00:00.000Z'), row('b', '2026-10-07T08:00:00.000Z'), row('c', '2026-10-07T09:00:00.000Z')];
    expect(ids(orderByLatestActivity(list))).toEqual(['c', 'a', 'b']);
  });

  it('counts the open conversation at its newest message in memory, which the fetched page does not have yet', () => {
    const list = [row('x', '2026-10-07T09:50:00.000Z'), row('open', '2026-10-07T07:00:00.000Z')];
    const ordered = orderByLatestActivity(list, { sessionId: 'open', at: '2026-10-07T09:59:00.000Z' });
    expect(ids(ordered)).toEqual(['open', 'x']);
    expect(ordered[0]!.lastMessageAt).toBe('2026-10-07T09:59:00.000Z');
  });

  it('never moves the open conversation backwards, and does not touch the input', () => {
    const list = [row('open', '2026-10-07T09:59:00.000Z'), row('x', '2026-10-07T09:50:00.000Z')];
    const copy = JSON.stringify(list);
    expect(ids(orderByLatestActivity(list, { sessionId: 'open', at: '2026-10-07T07:00:00.000Z' }))).toEqual(['open', 'x']);
    expect(JSON.stringify(list)).toBe(copy);
  });
});
