// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStatus, HandledBy } from '@dhaam-ccrm/core';
import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import {
  createPreChatScreen,
  createSessionSwitcher,
  relativeTimeLabel,
} from '../src/ui/session-picker.js';

function summary(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: 's1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: null,
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'Where is my order?',
    unreadCount: 0,
    ...overrides,
  };
}

const AGENT: HandledBy = { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('relativeTimeLabel', () => {
  const NOW = new Date('2026-08-19T12:00:00.000Z').getTime();

  it('renders a table of offsets, and never throws on unparsable input', () => {
    const cases: Array<[string, string]> = [
      [new Date(NOW - 10_000).toISOString(), 'Just now'],
      [new Date(NOW - 5 * 60_000).toISOString(), '5 minutes ago'],
      [new Date(NOW - 2 * 3_600_000).toISOString(), '2 hours ago'],
      [new Date(NOW - 3 * 86_400_000).toISOString(), '3 days ago'],
      ['not-a-date', ''],
      ['', ''],
    ];

    for (const [iso, expected] of cases) {
      expect(relativeTimeLabel(iso, NOW)).toBe(expected);
    }
  });

  it('is a pure function of its two arguments — no ambient Date.now() read', () => {
    // Same instant expressed two different ways must produce the same label
    // regardless of when the test actually runs.
    const iso = new Date(NOW - 3_600_000).toISOString();
    expect(relativeTimeLabel(iso, NOW)).toBe(relativeTimeLabel(iso, NOW));
    expect(relativeTimeLabel(iso, NOW)).toBe('1 hour ago');
  });
});

describe('status labels — every real backend status renders distinctly', () => {
  // The named regression: an earlier version treated anything that was not
  // CLOSED as "live", which showed RESOLVED sessions as active.
  const cases: Array<[ChatStatus, string]> = [
    ['OPEN', 'Open'],
    ['WAITING_FOR_AGENT', 'Waiting for an agent'],
    // NOT "Assigned": that is a queue fact about which agent owns the row,
    // not something the customer can act on. See ui/session-status.ts, which
    // now owns this vocabulary for the picker, the Messages list AND Home's
    // pill so the three cannot drift.
    ['ASSIGNED', 'With an agent'],
    ['CLOSED', 'Closed'],
    ['RESOLVED', 'Resolved'],
    ['ON_HOLD', 'On hold'],
  ];

  for (const [status, label] of cases) {
    it(`renders "${label}" for ${status}`, () => {
      const screen = createPreChatScreen({ onSelect: vi.fn(), onStartNew: vi.fn() });
      screen.render([summary({ status })]);
      expect(screen.node.querySelector('.dh-session-status')?.textContent).toBe(label);
    });
  }
});

describe('createPreChatScreen', () => {
  function build() {
    const onSelect = vi.fn();
    const onStartNew = vi.fn();
    const screen = createPreChatScreen({ onSelect, onStartNew });
    document.body.appendChild(screen.node);
    return { screen, onSelect, onStartNew };
  }

  it('labels itself and its list for a screen reader', () => {
    const { screen } = build();
    expect(screen.node.getAttribute('aria-labelledby')).toBe('dh-prechat-heading');
    expect(screen.node.querySelector('#dh-prechat-heading')?.textContent).toBe('Recent conversations');
    expect(screen.node.querySelector('.dh-session-list')?.getAttribute('role')).toBe('list');
  });

  it('shows an empty state, not an error, when there are no sessions', () => {
    const { screen } = build();
    screen.render([]);
    const empty = screen.node.querySelector<HTMLElement>('.dh-session-empty');
    expect(empty?.hidden).toBe(false);
    expect(screen.node.querySelectorAll('.dh-session-row')).toHaveLength(0);
  });

  it('renders status, time, preview, handledBy, and unreadCount per row', () => {
    const { screen } = build();
    screen.render([
      summary({ handledBy: AGENT, unreadCount: 3, lastMessagePreview: 'Where is my order?' }),
    ]);

    const row = screen.node.querySelector<HTMLButtonElement>('.dh-session-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.dh-session-status')?.textContent).toBe('With an agent');
    expect(row?.querySelector('.dh-session-preview')?.textContent).toBe('Where is my order?');
    expect(row?.querySelector('.dh-session-handler')?.textContent).toBe('with Ada');
    expect(row?.querySelector('.dh-session-unread')?.textContent).toBe('3 unread');
    // The accessible name is built from the same fields, independently of
    // the visible spans' exact wording — see session-picker.ts's header.
    const label = row?.getAttribute('aria-label') ?? '';
    expect(label).toContain('With an agent');
    expect(label).toContain('with Ada');
    expect(label).toContain('Where is my order?');
    expect(label).toContain('3 unread messages');
  });

  it('hides the handledBy and unread fragments when absent, rather than rendering empty labels', () => {
    const { screen } = build();
    // `summary()`'s own default already omits `handledBy` — deliberately not
    // passed as `undefined` here, since `exactOptionalPropertyTypes` makes
    // "omitted" and "explicitly undefined" two different things on this
    // interface (same distinction `applyAgentLeft` in core documents for the
    // same field).
    screen.render([summary({ unreadCount: 0 })]);

    const row = screen.node.querySelector<HTMLButtonElement>('.dh-session-row');
    expect(row?.querySelector<HTMLElement>('.dh-session-handler')?.hidden).toBe(true);
    expect(row?.querySelector<HTMLElement>('.dh-session-unread')?.hidden).toBe(true);
  });

  it('is never a second guest heuristic — it renders exactly what it is given', () => {
    // This module does not decide "is this a guest"; it renders whatever
    // `sessions` array it receives, empty or not. The one client-side rule
    // (`sessions.length > 0` ⇒ show the picker) is enforced by whoever
    // decides to mount/reveal this screen, not by a second check in here.
    const { screen } = build();
    screen.render([summary()]);
    expect(screen.node.querySelectorAll('.dh-session-row')).toHaveLength(1);
    screen.render([]);
    expect(screen.node.querySelectorAll('.dh-session-row')).toHaveLength(0);
  });

  for (const status of ['CLOSED', 'RESOLVED'] as const) {
    it(`a terminal (${status}) row is a real, enabled control — picking it reactivates the session`, () => {
      const { screen, onSelect } = build();
      screen.render([summary({ id: 'terminal-1', status })]);

      const row = screen.node.querySelector<HTMLButtonElement>('.dh-session-row');
      expect(row?.tagName).toBe('BUTTON');
      expect(row?.disabled).toBe(false);
      expect(row?.hasAttribute('disabled')).toBe(false);

      row?.click();
      expect(onSelect).toHaveBeenCalledWith('terminal-1');
    });
  }

  it('calls onSelect with the picked session id', () => {
    const { screen, onSelect } = build();
    screen.render([summary({ id: 'sess_42' })]);
    screen.node.querySelector<HTMLButtonElement>('.dh-session-row')?.click();
    expect(onSelect).toHaveBeenCalledWith('sess_42');
  });

  it('calls onStartNew from the always-available "start a new conversation" control', () => {
    const { screen, onStartNew } = build();
    screen.node.querySelector<HTMLButtonElement>('.dh-prechat-start')?.click();
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });

  it('disables and relabels the start-new control while busy, and cannot be double-submitted', () => {
    const { screen } = build();
    const button = screen.node.querySelector<HTMLButtonElement>('.dh-prechat-start');

    screen.setStartingNew(true);
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe('Starting…');

    screen.setStartingNew(false);
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toBe('Start a new conversation');
  });

  it('reuses the same row element across renders, keyed by id', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a' })]);
    const first = screen.node.querySelector('.dh-session-row');

    screen.render([summary({ id: 'a', unreadCount: 1 })]);
    expect(screen.node.querySelector('.dh-session-row')).toBe(first);
  });

  it('drops a row for a session no longer in the list', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a' }), summary({ id: 'b' })]);
    expect(screen.node.querySelectorAll('.dh-session-row')).toHaveLength(2);

    screen.render([summary({ id: 'a' })]);
    expect(screen.node.querySelectorAll('.dh-session-row')).toHaveLength(1);
  });

  it('moves focus to the first row on open when sessions exist, else to "start new"', () => {
    const withRows = build();
    withRows.screen.render([summary({ id: 'a' })]);
    withRows.screen.focus();
    expect(document.activeElement).toBe(withRows.screen.node.querySelector('.dh-session-row'));

    const empty = build();
    empty.screen.render([]);
    empty.screen.focus();
    expect(document.activeElement).toBe(empty.screen.node.querySelector('.dh-prechat-start'));
  });
});

describe('createSessionSwitcher', () => {
  function build() {
    const onSelect = vi.fn();
    const onStartNew = vi.fn();
    const switcher = createSessionSwitcher({ onSelect, onStartNew });
    document.body.appendChild(switcher.node);
    return { switcher, onSelect, onStartNew };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts closed: panel hidden, toggle unexpanded', () => {
    const { switcher } = build();
    expect(switcher.isOpen()).toBe(false);
    expect(switcher.node.querySelector('.dh-switcher-panel')).toHaveProperty('hidden', true);
    expect(switcher.node.querySelector('.dh-switcher-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('the toggle names itself, announces the popup, and points at the panel it controls', () => {
    const { switcher } = build();
    const toggle = switcher.node.querySelector('.dh-switcher-toggle');
    expect(toggle?.getAttribute('aria-label')).toBe('Switch conversation');
    expect(toggle?.getAttribute('aria-haspopup')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe(
      switcher.node.querySelector('.dh-switcher-panel')?.id,
    );
  });

  it('opens on click, moving focus into the popover', () => {
    const { switcher } = build();
    switcher.render([summary({ id: 'a' })], null);

    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();

    expect(switcher.isOpen()).toBe(true);
    expect(switcher.node.querySelector('.dh-switcher-panel')).toHaveProperty('hidden', false);
    expect(switcher.node.querySelector('.dh-switcher-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(switcher.node.querySelector('.dh-session-row'));
  });

  it('marks the current session distinctly from the others', () => {
    const { switcher } = build();
    switcher.render([summary({ id: 'a' }), summary({ id: 'b' })], 'b');

    const rows = [...switcher.node.querySelectorAll<HTMLButtonElement>('.dh-session-row')];
    expect(rows[0]?.hasAttribute('aria-current')).toBe(false);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
  });

  it('closes and returns focus to the toggle on Escape', () => {
    const { switcher } = build();
    const toggle = switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle');
    toggle?.click();
    expect(switcher.isOpen()).toBe(true);

    const panel = switcher.node.querySelector<HTMLElement>('.dh-switcher-panel');
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(switcher.isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it('closes on a pointerdown outside the component', () => {
    const { switcher } = build();
    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();
    expect(switcher.isOpen()).toBe(true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(switcher.isOpen()).toBe(false);
  });

  it('does NOT close on a pointerdown inside its own panel', () => {
    const { switcher } = build();
    switcher.render([summary({ id: 'a' })], null);
    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();

    switcher.node
      .querySelector('.dh-switcher-panel')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(switcher.isOpen()).toBe(true);
  });

  it('picking a session closes the popover and calls onSelect', () => {
    const { switcher, onSelect } = build();
    switcher.render([summary({ id: 'pick-me' })], null);
    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();

    switcher.node.querySelector<HTMLButtonElement>('.dh-session-row')?.click();

    expect(onSelect).toHaveBeenCalledWith('pick-me');
    expect(switcher.isOpen()).toBe(false);
  });

  it('starting a new conversation from inside also closes the popover', () => {
    const { switcher, onStartNew } = build();
    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();

    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-start')?.click();

    expect(onStartNew).toHaveBeenCalledTimes(1);
    expect(switcher.isOpen()).toBe(false);
  });

  it('destroy() removes the outside-pointerdown listener so it no longer fires', () => {
    const { switcher } = build();
    switcher.node.querySelector<HTMLButtonElement>('.dh-switcher-toggle')?.click();
    switcher.destroy();

    // Nothing to assert on `isOpen()` post-destroy beyond "does not throw" —
    // the point is that the module-external `document` listener is gone and
    // cannot fire against a torn-down component on some OTHER widget
    // instance's future clicks.
    expect(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))).not.toThrow();
  });
});
