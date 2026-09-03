// The Messages screen — every conversation this customer has ever had, with
// search and a way to start a fresh one.
//
// ── Why this is not a third copy of the row markup ───────────────────────
//
// `ui/session-picker.ts` already renders session rows twice (the pre-chat
// screen and the in-chat switcher), both keyed off `statusLabel` and
// `relativeTimeLabel`. This screen is a fourth place that needs to agree with
// the first three about what "Waiting for an agent" or "3 hours ago" means,
// so it imports both rather than re-deriving them — the status vocabulary now
// lives in `ui/session-status.ts`, which Home's pill reads off too. It does
// NOT reuse that module's row
// FACTORY, though: this row shows a different field set (no handler line,
// see below) and is about to outlive session-picker's two screens, which the
// three-screen navigation this belongs to is replacing.
//
// ── Why the row has no "handled by" line ──────────────────────────────────
//
// The task that specifies this screen names exactly four fields — status
// pill, preview, relative time, unread badge — and home-screen.ts's own
// "Recent conversation" row already establishes the precedent of NOT
// inventing a subject/title from thin air. Dropping the handler line here
// keeps this row a strict subset of what is visible, which is also all that
// search matches against below: nothing is searchable that is not on screen,
// so a match is always explainable by looking at the row that produced it.
//
// ── Search is client-side, over the loaded page ───────────────────────────
//
// `listSessions` already fetched once (widget.ts's `requestSessions`, capped
// at `SESSION_PICKER_LIMIT`) and this screen renders exactly that page —
// same discipline session-picker.ts's row list documents for itself: this
// component draws whatever `sessions` array it is given and fetches nothing
// of its own. So a query narrows what is already on screen by hiding rows
// rather than requesting a smaller page, which keeps every row's identity
// (and a keyboard user's focus, if it happened to be on one) stable across
// keystrokes.

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { ICONS, el, icon } from './dom.js';
import { relativeTimeLabel } from './session-picker.js';
import { statusLabel } from './session-status.js';

export interface MessagesScreenCallbacks {
  /** The customer picked a row — including a terminal one, which reactivates it server-side. */
  readonly onOpenConversation: (sessionId: string) => void;
  /** "New conversation" was pressed. */
  readonly onStartNew: () => void;
}

export interface MessagesScreenView {
  readonly node: HTMLElement;
  /** @param currentSessionId the conversation on screen behind this tab, or `null`. */
  render(sessions: readonly ChatSessionSummary[], currentSessionId: string | null): void;
  setStartingNew(busy: boolean): void;
  /** Moves focus to the search field. Call after navigating to this screen. */
  focus(): void;
  destroy(): void;
}

/** Heroicons' `magnifying-glass` outline, stroked like every other glyph `icon()` draws. */
const SEARCH_ICON = ['m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z'];

/** Whether `session` should stay visible under `query` — `''` matches everything. */
function matchesQuery(session: ChatSessionSummary, query: string): boolean {
  if (query === '') return true;
  const haystack = `${statusLabel(session.status)} ${session.lastMessagePreview ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

interface MessageRow {
  readonly node: HTMLLIElement;
  update(summary: ChatSessionSummary, isCurrent: boolean): void;
}

function createMessageRow(onSelect: (sessionId: string) => void): MessageRow {
  const status = el('span', { attrs: { class: 'dh-messages-status' } });
  const time = el('time', { attrs: { class: 'dh-messages-time' } });
  const top = el('span', { attrs: { class: 'dh-messages-row-top' }, children: [status, time] });
  const preview = el('span', { attrs: { class: 'dh-messages-preview' } });
  const unread = el('span', { attrs: { class: 'dh-messages-unread' } });

  const button = el('button', {
    // Never `disabled` — see session-picker.ts's module header: a terminal
    // status is information shown via the pill, not a reason to disable the
    // row underneath it.
    attrs: { class: 'dh-messages-row', type: 'button' },
    children: [top, preview, unread],
  });
  const node = el('li', { attrs: { class: 'dh-messages-item' }, children: [button] });

  let current: ChatSessionSummary | null = null;
  button.addEventListener('click', () => {
    if (current !== null) onSelect(current.id);
  });

  return {
    node,
    update(summary, isCurrent) {
      current = summary;

      node.setAttribute('data-status', summary.status);
      if (isCurrent) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');

      status.textContent = statusLabel(summary.status);

      const whenIso = summary.lastMessageAt ?? summary.createdAt;
      if (time.getAttribute('datetime') !== whenIso) time.setAttribute('datetime', whenIso);
      time.textContent = relativeTimeLabel(whenIso);

      const hasPreview = summary.lastMessagePreview !== undefined && summary.lastMessagePreview !== '';
      preview.textContent = hasPreview ? (summary.lastMessagePreview as string) : '';
      preview.hidden = !hasPreview;

      const hasUnread = summary.unreadCount > 0;
      // Capped like the nav tab's own badge (ui/nav.ts) — a real count past
      // 99 tells the customer nothing the cap does not.
      unread.textContent = hasUnread ? (summary.unreadCount > 99 ? '99+' : String(summary.unreadCount)) : '';
      unread.hidden = !hasUnread;

      // The one spoken account of this row — never derived from the visible
      // spans themselves, same split session-picker.ts's `describeRow` uses
      // and for the same reason: the wording can drift, the underlying facts
      // must not.
      const parts = [statusLabel(summary.status)];
      if (isCurrent) parts.push('current conversation');
      const relative = relativeTimeLabel(whenIso);
      if (relative !== '') parts.push(relative);
      if (hasPreview) parts.push(summary.lastMessagePreview as string);
      if (hasUnread) {
        parts.push(`${summary.unreadCount} unread ${summary.unreadCount === 1 ? 'message' : 'messages'}`);
      }
      button.setAttribute('aria-label', parts.join(', '));
    },
  };
}

export function createMessagesScreen(callbacks: MessagesScreenCallbacks): MessagesScreenView {
  const searchInput = el('input', {
    attrs: {
      class: 'dh-messages-search-input',
      type: 'search',
      placeholder: 'Search conversations',
      'aria-label': 'Search conversations',
      autocomplete: 'off',
    },
    on: { input: () => applyFilter() },
  });
  const search = el('div', {
    attrs: { class: 'dh-messages-search' },
    children: [
      el('span', { attrs: { class: 'dh-messages-search-icon', 'aria-hidden': 'true' }, children: [icon(SEARCH_ICON, 16)] }),
      searchInput,
    ],
  });

  const empty = el('li', { attrs: { class: 'dh-messages-empty' }, text: 'No conversations yet.' });
  // `role="list"` restored explicitly — see session-picker.ts's own note on
  // Safari/VoiceOver dropping the implicit role once `list-style` is styled
  // away.
  const list = el('ul', {
    attrs: { class: 'dh-messages-list', role: 'list', 'aria-label': 'Your conversations' },
    children: [empty],
  });

  const newButtonLabel = el('span', { text: 'New conversation' });
  const newButton = el('button', {
    attrs: { class: 'dh-messages-new', type: 'button' },
    // The same speech-bubble glyph the Home screen's own CTA uses
    // (ui/home-screen.ts) — both start the same thing, so they share an icon
    // rather than introducing a second "start a conversation" symbol.
    children: [icon(ICONS.chat, 18), newButtonLabel],
    on: { click: () => callbacks.onStartNew() },
  });

  const node = el('div', { attrs: { class: 'dh-messages' }, children: [search, list, newButton] });

  const rows = new Map<string, MessageRow>();
  let allSessions: readonly ChatSessionSummary[] = [];
  let currentId: string | null = null;

  function applyFilter(): void {
    const query = searchInput.value.trim().toLowerCase();
    let anyVisible = false;
    for (const summary of allSessions) {
      const row = rows.get(summary.id);
      if (row === undefined) continue;
      const matches = matchesQuery(summary, query);
      row.node.hidden = !matches;
      if (matches) anyVisible = true;
    }

    if (allSessions.length === 0) {
      empty.textContent = 'No conversations yet.';
      empty.hidden = false;
    } else {
      empty.textContent = 'No conversations match your search.';
      empty.hidden = anyVisible;
    }
  }

  return {
    node,
    render(sessions, currentSessionId) {
      allSessions = sessions;
      currentId = currentSessionId;

      const live = new Set<string>();
      let previous: Node = empty;
      for (const summary of sessions) {
        live.add(summary.id);
        let row = rows.get(summary.id);
        if (row === undefined) {
          row = createMessageRow((sessionId) => callbacks.onOpenConversation(sessionId));
          rows.set(summary.id, row);
        }
        row.update(summary, summary.id === currentId);
        if (previous.nextSibling !== row.node) list.insertBefore(row.node, previous.nextSibling);
        previous = row.node;
      }
      for (const [id, row] of rows) {
        if (live.has(id)) continue;
        row.node.remove();
        rows.delete(id);
      }

      applyFilter();
    },
    setStartingNew(busy) {
      newButton.disabled = busy;
      newButtonLabel.textContent = busy ? 'Starting…' : 'New conversation';
    },
    focus() {
      searchInput.focus({ preventScroll: true });
    },
    destroy() {
      rows.clear();
    },
  };
}
