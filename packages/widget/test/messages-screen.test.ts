// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { createMessagesScreen } from '../src/ui/messages-screen.js';

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

function build() {
  const onOpenConversation = vi.fn();
  const onStartNew = vi.fn();
  const screen = createMessagesScreen({ onOpenConversation, onStartNew });
  document.body.appendChild(screen.node);
  return { screen, onOpenConversation, onStartNew };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createMessagesScreen — rendering rows', () => {
  it('renders exactly the four documented fields: status pill, preview, relative time, unread badge', () => {
    const { screen } = build();
    const NOW = new Date('2026-08-19T12:00:00.000Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    screen.render(
      [
        summary({
          id: 's1',
          status: 'WAITING_FOR_AGENT',
          lastMessagePreview: 'Where is my order?',
          lastMessageAt: new Date(NOW - 3_600_000).toISOString(),
          unreadCount: 2,
        }),
      ],
      null,
    );

    expect(screen.node.querySelector('.dh-messages-status')?.textContent).toBe('Waiting for an agent');
    expect(screen.node.querySelector('.dh-messages-preview')?.textContent).toBe('Where is my order?');
    expect(screen.node.querySelector('.dh-messages-time')?.textContent).toBe('1 hour ago');
    expect(screen.node.querySelector('.dh-messages-unread')?.textContent).toBe('2');

    vi.useRealTimers();
  });

  it('caps the unread badge at 99+', () => {
    const { screen } = build();
    screen.render([summary({ unreadCount: 140 })], null);
    expect(screen.node.querySelector('.dh-messages-unread')?.textContent).toBe('99+');
  });

  it('hides the preview and unread badge when there is nothing to show', () => {
    const { screen } = build();
    // Built directly rather than through `summary()`'s overrides:
    // `exactOptionalPropertyTypes` refuses `lastMessagePreview: undefined` —
    // the wire's own rule is that it is ABSENT, never present-and-empty.
    const noPreview: ChatSessionSummary = {
      id: 's1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-19T09:00:00.000Z',
      closedAt: null,
      lastMessageAt: '2026-08-19T09:30:00.000Z',
      unreadCount: 0,
    };
    screen.render([noPreview], null);
    expect(screen.node.querySelector<HTMLElement>('.dh-messages-preview')?.hidden).toBe(true);
    expect(screen.node.querySelector<HTMLElement>('.dh-messages-unread')?.hidden).toBe(true);
  });

  it('marks the current conversation with aria-current', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a' }), summary({ id: 'b' })], 'b');

    const rows = [...screen.node.querySelectorAll<HTMLButtonElement>('.dh-messages-row')];
    expect(rows[0]!.getAttribute('aria-current')).toBeNull();
    expect(rows[1]!.getAttribute('aria-current')).toBe('true');
  });

  it('shows "No conversations yet." when there are none at all', () => {
    const { screen } = build();
    screen.render([], null);
    expect(screen.node.querySelector<HTMLElement>('.dh-messages-empty')?.hidden).toBe(false);
    expect(screen.node.querySelector('.dh-messages-empty')?.textContent).toBe('No conversations yet.');
  });

  it('reuses the same row node across renders rather than rebuilding it', () => {
    const { screen } = build();
    screen.render([summary({ id: 's1' })], null);
    const first = screen.node.querySelector('.dh-messages-item');

    screen.render([summary({ id: 's1', unreadCount: 1 })], null);
    const second = screen.node.querySelector('.dh-messages-item');
    expect(second).toBe(first);
  });

  it('drops a row that is no longer in the list', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a' }), summary({ id: 'b' })], null);
    expect(screen.node.querySelectorAll('.dh-messages-item').length).toBe(2);

    screen.render([summary({ id: 'a' })], null);
    expect(screen.node.querySelectorAll('.dh-messages-item').length).toBe(1);
  });
});

describe('createMessagesScreen — search', () => {
  it('filters client-side over the loaded page without re-rendering rows', () => {
    const { screen } = build();
    screen.render(
      [
        summary({ id: 'a', status: 'OPEN', lastMessagePreview: 'Refund request' }),
        summary({ id: 'b', status: 'CLOSED', lastMessagePreview: 'Delivery issue' }),
      ],
      null,
    );

    const input = screen.node.querySelector<HTMLInputElement>('.dh-messages-search-input')!;
    input.value = 'refund';
    input.dispatchEvent(new Event('input'));

    const items = [...screen.node.querySelectorAll<HTMLElement>('.dh-messages-item')];
    expect(items.find((n) => n.querySelector('.dh-messages-preview')?.textContent === 'Refund request')?.hidden).toBe(false);
    expect(items.find((n) => n.querySelector('.dh-messages-preview')?.textContent === 'Delivery issue')?.hidden).toBe(true);
  });

  it('matches on status as well as preview text', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a', status: 'RESOLVED', lastMessagePreview: 'x' })], null);

    const input = screen.node.querySelector<HTMLInputElement>('.dh-messages-search-input')!;
    input.value = 'resolved';
    input.dispatchEvent(new Event('input'));

    expect(screen.node.querySelector<HTMLElement>('.dh-messages-item')?.hidden).toBe(false);
  });

  it('shows a distinct empty message when a search matches nothing, without losing the underlying rows', () => {
    const { screen } = build();
    screen.render([summary({ id: 'a', lastMessagePreview: 'Refund request' })], null);

    const input = screen.node.querySelector<HTMLInputElement>('.dh-messages-search-input')!;
    input.value = 'nothing matches this';
    input.dispatchEvent(new Event('input'));

    expect(screen.node.querySelector<HTMLElement>('.dh-messages-empty')?.hidden).toBe(false);
    expect(screen.node.querySelector('.dh-messages-empty')?.textContent).toBe('No conversations match your search.');
    // The row is hidden, not removed — clearing the query must bring it back
    // without a re-fetch.
    expect(screen.node.querySelectorAll('.dh-messages-item').length).toBe(1);

    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(screen.node.querySelector<HTMLElement>('.dh-messages-item')?.hidden).toBe(false);
    expect(screen.node.querySelector<HTMLElement>('.dh-messages-empty')?.hidden).toBe(true);
  });
});

describe('createMessagesScreen — actions', () => {
  it('opens the conversation a row was clicked for', () => {
    const { screen, onOpenConversation } = build();
    screen.render([summary({ id: 'sess_42' })], null);

    screen.node.querySelector<HTMLButtonElement>('.dh-messages-row')!.click();
    expect(onOpenConversation).toHaveBeenCalledWith('sess_42');
  });

  it('starts a new conversation from the button at the bottom', () => {
    const { screen, onStartNew } = build();
    screen.node.querySelector<HTMLButtonElement>('.dh-messages-new')!.click();
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });

  it('goes busy across the New conversation button while a start is in flight', () => {
    const { screen } = build();
    const button = screen.node.querySelector<HTMLButtonElement>('.dh-messages-new')!;

    screen.setStartingNew(true);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Starting…');

    screen.setStartingNew(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('New conversation');
  });

  it('focuses the search field', () => {
    const { screen } = build();
    screen.render([summary()], null);
    screen.focus();
    expect(document.activeElement).toBe(screen.node.querySelector('.dh-messages-search-input'));
  });
});
