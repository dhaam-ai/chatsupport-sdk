import { describe, it, expect } from 'vitest';
import {
  isTerminalStatus,
  shouldShowSessionPicker,
  partitionSessions,
  sortByRecency,
  normalizeSessionSummary,
  handledByLabel,
  SESSION_PICKER_LIMIT,
} from './sessionHistory';
import type { ChatSessionSummary } from './types';

function summary(over: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: 's1',
    status: 'CLOSED',
    mode: 'BOT',
    createdAt: '2026-08-01T10:00:00Z',
    closedAt: '2026-08-01T11:00:00Z',
    lastMessageAt: '2026-08-01T10:59:00Z',
    unreadCount: 0,
    ...over,
  };
}

describe('guest vs logged-in gating', () => {
  // The backend applies the guest rule and returns [] for a caller it has not
  // identified. One check covers both "is a guest" and "has no history",
  // because both are the same UI — and a second client-side heuristic would be
  // a second source of truth that can disagree with the first.
  it('renders no picker for an empty list — which is what a guest gets', () => {
    expect(shouldShowSessionPicker([])).toBe(false);
  });

  it('renders no picker when the fetch never populated the list', () => {
    expect(shouldShowSessionPicker(undefined)).toBe(false);
    expect(shouldShowSessionPicker(null)).toBe(false);
  });

  it('renders the picker as soon as the backend returns any session', () => {
    expect(shouldShowSessionPicker([summary()])).toBe(true);
  });
});

describe('isTerminalStatus', () => {
  it('treats RESOLVED as terminal, not just CLOSED', () => {
    // The old panel filtered on `status !== 'CLOSED'`, so a RESOLVED session
    // was listed as if it were still live.
    expect(isTerminalStatus('CLOSED')).toBe(true);
    expect(isTerminalStatus('RESOLVED')).toBe(true);
  });

  it('treats every live status as non-terminal', () => {
    for (const s of ['OPEN', 'WAITING_FOR_AGENT', 'ASSIGNED', 'ON_HOLD']) {
      expect(isTerminalStatus(s), s).toBe(false);
    }
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});

describe('partitionSessions', () => {
  it('separates live from terminal and caps the terminal list at five', () => {
    const sessions = [
      summary({ id: 'live', status: 'ASSIGNED', lastMessageAt: '2026-08-10T10:00:00Z' }),
      ...Array.from({ length: 7 }, (_, i) =>
        summary({ id: `c${i}`, status: 'CLOSED', lastMessageAt: `2026-08-0${i + 1}T10:00:00Z` })),
    ];
    const { active, terminal } = partitionSessions(sessions);
    expect(active.map(s => s.id)).toEqual(['live']);
    expect(terminal).toHaveLength(SESSION_PICKER_LIMIT);
    // Most recent first, so the five kept are the five newest.
    expect(terminal.map(s => s.id)).toEqual(['c6', 'c5', 'c4', 'c3', 'c2']);
  });

  it('puts a RESOLVED session in the terminal group', () => {
    const { active, terminal } = partitionSessions([summary({ id: 'r', status: 'RESOLVED' })]);
    expect(active).toEqual([]);
    expect(terminal.map(s => s.id)).toEqual(['r']);
  });
});

describe('sortByRecency', () => {
  it('orders by last activity, not creation', () => {
    const old = summary({ id: 'old', createdAt: '2026-08-09T10:00:00Z', lastMessageAt: '2026-08-01T10:00:00Z' });
    const recent = summary({ id: 'recent', createdAt: '2026-08-01T10:00:00Z', lastMessageAt: '2026-08-10T10:00:00Z' });
    expect(sortByRecency([old, recent]).map(s => s.id)).toEqual(['recent', 'old']);
  });

  it('falls back to closedAt then createdAt when there is no last message', () => {
    const a = summary({ id: 'a', lastMessageAt: null, closedAt: '2026-08-05T10:00:00Z' });
    const b = summary({ id: 'b', lastMessageAt: null, closedAt: null, createdAt: '2026-08-09T10:00:00Z' });
    expect(sortByRecency([a, b]).map(s => s.id)).toEqual(['b', 'a']);
  });

  it('does not mutate its input', () => {
    const input = [summary({ id: 'a', lastMessageAt: '2026-08-01T10:00:00Z' }), summary({ id: 'b', lastMessageAt: '2026-08-09T10:00:00Z' })];
    sortByRecency(input);
    expect(input.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('survives an unparseable timestamp instead of producing NaN order', () => {
    const bad = summary({ id: 'bad', lastMessageAt: 'not-a-date' });
    const good = summary({ id: 'good', lastMessageAt: '2026-08-09T10:00:00Z' });
    expect(sortByRecency([bad, good]).map(s => s.id)).toEqual(['good', 'bad']);
  });
});

describe('normalizeSessionSummary', () => {
  it('maps the T3 wire shape', () => {
    const wire = {
      id: 'abc',
      status: 'RESOLVED',
      mode: 'HUMAN',
      createdAt: '2026-08-01T10:00:00Z',
      closedAt: '2026-08-01T11:00:00Z',
      lastMessageAt: '2026-08-01T10:59:00Z',
      lastMessagePreview: 'thanks!',
      unreadCount: 3,
      handledBy: { kind: 'AGENT', id: 'a1', displayName: 'Priya Nair' },
    };
    expect(normalizeSessionSummary(wire, 'RESOLVED', 'HUMAN')).toEqual({
      id: 'abc',
      status: 'RESOLVED',
      mode: 'HUMAN',
      createdAt: '2026-08-01T10:00:00Z',
      closedAt: '2026-08-01T11:00:00Z',
      lastMessageAt: '2026-08-01T10:59:00Z',
      lastMessagePreview: 'thanks!',
      unreadCount: 3,
      handledBy: { kind: 'AGENT', id: 'a1', displayName: 'Priya Nair' },
    });
  });

  it('omits the preview rather than inventing an empty string', () => {
    // The endpoint documents preview as absent — never '' — when there is no
    // public message, so "no preview" stays distinguishable from "empty".
    const out = normalizeSessionSummary(
      { id: 'abc', createdAt: null, closedAt: null, lastMessageAt: null, unreadCount: 0 },
      'OPEN', 'BOT',
    );
    expect('lastMessagePreview' in out).toBe(false);
    expect(out.lastMessageAt).toBeNull();
  });

  it('still reads the pre-T3 nested lastMessage an older deployment sends', () => {
    const out = normalizeSessionSummary(
      { id: 'abc', lastMessage: { content: 'legacy', createdAt: '2026-08-01T10:00:00Z' } },
      'CLOSED', 'BOT',
    );
    expect(out.lastMessagePreview).toBe('legacy');
    expect(out.lastMessageAt).toBe('2026-08-01T10:00:00Z');
  });

  it('defaults unreadCount to 0 and drops a malformed handledBy', () => {
    const out = normalizeSessionSummary({ id: 'abc', handledBy: { kind: 'NOPE' } }, 'OPEN', 'BOT');
    expect(out.unreadCount).toBe(0);
    expect(out.handledBy).toBeUndefined();
  });
});

describe('handledByLabel', () => {
  it('names the agent or the bot', () => {
    expect(handledByLabel(summary({ handledBy: { kind: 'AGENT', id: 'a1', displayName: 'Priya Nair' } })))
      .toBe('Priya Nair');
    expect(handledByLabel(summary({ handledBy: { kind: 'BOT', id: 'bot', displayName: 'AI Assistant' } })))
      .toBe('AI Assistant');
  });

  it('says nothing when nobody has picked the session up', () => {
    expect(handledByLabel(summary())).toBeNull();
  });
});
