// The session picker: two surfaces built on one row-rendering family — a
// pre-chat screen (recent conversations + "start new") shown on open, and an
// in-chat header switcher so a customer already inside one conversation is
// never stuck in it with no way back.
//
// ── The guest-gating rule lives OUTSIDE this file ─────────────────────────
//
// "A guest gets an empty list" is decided server-side; the client rule is
// exactly `sessions.length > 0` ⇒ show the picker. Both view factories below
// render whatever `sessions` array they are given — an empty one renders an
// empty-state row, not a hidden component — because DECIDING whether to
// mount/reveal a surface at all is a screen-flow choice (does the panel open
// on the pre-chat screen or straight into the conversation?), which belongs
// to whichever module owns that flow. Re-deriving "is this a guest" a second
// time in here, from anything other than the same `sessions.length > 0`
// check, is precisely the two-sources-of-truth bug this was scoped to avoid
// — so this module does not attempt a guest heuristic of its own at all.
//
// ── Terminal sessions are not disabled ────────────────────────────────────
//
// CLOSED/RESOLVED is real information, shown via the status label like every
// other status — but the row underneath is the same enabled, keyboard- and
// pointer-clickable `<button>` regardless of status. Picking one and typing
// reactivates it server-side, so nothing here may render it as inert: no
// `disabled`, no dimmed-archive styling distinct from a live row.
//
// ── Accessible name, built once ───────────────────────────────────────────
//
// Each row carries an explicit `aria-label` composed from the same summary
// fields the visible spans render from — never from the rendered strings
// themselves — so the spoken and the visual account of one row can disagree
// in wording but never in the underlying facts. Same split message-list.ts
// uses for a tick's glyph vs its `.dh-sr` text.

import type { ChatStatus, HandledBy } from '@dhaam-ccrm/core';
import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { ICONS, el, icon } from './dom.js';

export interface SessionPickerCallbacks {
  /** The customer picked a row — including a terminal one, which reactivates it server-side. */
  readonly onSelect: (sessionId: string) => void;
  /** The customer asked for a fresh conversation instead of any listed one. */
  readonly onStartNew: () => void;
}

const STATUS_LABEL: Record<ChatStatus, string> = {
  OPEN: 'Open',
  WAITING_FOR_AGENT: 'Waiting for an agent',
  ASSIGNED: 'Assigned',
  CLOSED: 'Closed',
  RESOLVED: 'Resolved',
  ON_HOLD: 'On hold',
};

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * A short, human relative time ("2 hours ago"), or `''` for an unparsable
 * timestamp — never a thrown exception, since this runs inside a list render
 * over data a REST/wire boundary supplied.
 *
 * `now` is a parameter, not a fresh `Date.now()` read buried in the
 * function, purely so this stays a pure function a table test can assert
 * against exactly — the same reasoning `presentation.ts`'s
 * `resolvePresentation` gives for taking `Viewport` as data instead of
 * reading `window` itself.
 */
export function relativeTimeLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return 'Just now';

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (abs >= unitMs) return rtf.format(Math.round(diffMs / unitMs), unit);
  }
  return 'Just now';
}

function handledByText(handledBy: HandledBy | undefined): string {
  return handledBy === undefined ? '' : `with ${handledBy.displayName}`;
}

/** The one spoken account of a row — see the module header on why this is never derived from the visible spans. */
function describeRow(summary: ChatSessionSummary, isCurrent: boolean): string {
  const parts = [STATUS_LABEL[summary.status]];
  if (isCurrent) parts.push('current conversation');
  const whenIso = summary.lastMessageAt ?? summary.createdAt;
  const relative = relativeTimeLabel(whenIso);
  if (relative !== '') parts.push(relative);
  if (summary.handledBy !== undefined) parts.push(handledByText(summary.handledBy));
  if (summary.lastMessagePreview !== undefined && summary.lastMessagePreview !== '') {
    parts.push(summary.lastMessagePreview);
  }
  if (summary.unreadCount > 0) {
    parts.push(`${summary.unreadCount} unread ${summary.unreadCount === 1 ? 'message' : 'messages'}`);
  }
  return parts.join(', ');
}

interface SessionRow {
  readonly node: HTMLLIElement;
  update(summary: ChatSessionSummary, isCurrent: boolean): void;
}

function createSessionRow(callbacks: SessionPickerCallbacks): SessionRow {
  const status = el('span', { attrs: { class: 'dh-session-status' } });
  const time = el('time', { attrs: { class: 'dh-session-time' } });
  const top = el('span', { attrs: { class: 'dh-session-row-top' }, children: [status, time] });
  const preview = el('span', { attrs: { class: 'dh-session-preview' } });
  const handler = el('span', { attrs: { class: 'dh-session-handler' } });
  const unread = el('span', { attrs: { class: 'dh-session-unread' } });

  const button = el('button', {
    // A real, always-enabled control — see the module header. Never
    // `disabled`, regardless of status.
    attrs: { class: 'dh-session-row', type: 'button' },
    children: [top, preview, handler, unread],
  });
  const node = el('li', { attrs: { class: 'dh-session-item' }, children: [button] });

  let current: ChatSessionSummary | null = null;
  button.addEventListener('click', () => {
    if (current !== null) callbacks.onSelect(current.id);
  });

  return {
    node,
    update(summary, isCurrent) {
      current = summary;

      node.setAttribute('data-status', summary.status);
      button.setAttribute('aria-label', describeRow(summary, isCurrent));
      if (isCurrent) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');

      status.textContent = STATUS_LABEL[summary.status];

      const whenIso = summary.lastMessageAt ?? summary.createdAt;
      if (time.getAttribute('datetime') !== whenIso) time.setAttribute('datetime', whenIso);
      time.textContent = relativeTimeLabel(whenIso);

      const hasPreview = summary.lastMessagePreview !== undefined && summary.lastMessagePreview !== '';
      preview.textContent = hasPreview ? (summary.lastMessagePreview as string) : '';
      preview.hidden = !hasPreview;

      handler.textContent = handledByText(summary.handledBy);
      handler.hidden = summary.handledBy === undefined;

      const hasUnread = summary.unreadCount > 0;
      unread.textContent = hasUnread ? `${summary.unreadCount} unread` : '';
      unread.hidden = !hasUnread;
    },
  };
}

interface SessionRowListView {
  readonly node: HTMLUListElement;
  render(sessions: readonly ChatSessionSummary[], currentSessionId: string | null): void;
  destroy(): void;
}

/** The shared "family": both exported surfaces below build their list out of this, so a row can never render two ways. */
function createSessionRowList(callbacks: SessionPickerCallbacks, listLabel: string, emptyText: string): SessionRowListView {
  const empty = el('li', { attrs: { class: 'dh-session-empty' }, text: emptyText });
  // `role="list"` restored explicitly: Safari/VoiceOver drops the implicit
  // list semantics of a `<ul>` once it is styled with `list-style: none`
  // (styles.ts), a documented engine quirk — see focus.ts's header for the
  // same "restore what CSS took away" reasoning applied to a different rule.
  const node = el('ul', { attrs: { class: 'dh-session-list', role: 'list', 'aria-label': listLabel }, children: [empty] });

  const rows = new Map<string, SessionRow>();

  function render(sessions: readonly ChatSessionSummary[], currentSessionId: string | null): void {
    empty.hidden = sessions.length > 0;

    const live = new Set<string>();
    let previous: Node = empty;

    for (const summary of sessions) {
      live.add(summary.id);
      let row = rows.get(summary.id);
      if (row === undefined) {
        row = createSessionRow(callbacks);
        rows.set(summary.id, row);
      }
      row.update(summary, summary.id === currentSessionId);

      if (previous.nextSibling !== row.node) node.insertBefore(row.node, previous.nextSibling);
      previous = row.node;
    }

    for (const [id, row] of rows) {
      if (live.has(id)) continue;
      row.node.remove();
      rows.delete(id);
    }
  }

  return {
    node,
    render,
    destroy() {
      rows.clear();
    },
  };
}

function createStartNewButton(callbacks: SessionPickerCallbacks, className: string): {
  readonly node: HTMLButtonElement;
  setBusy(busy: boolean): void;
} {
  const node = el('button', {
    attrs: { class: className, type: 'button' },
    text: 'Start a new conversation',
    on: { click: () => callbacks.onStartNew() },
  });

  return {
    node,
    setBusy(busy: boolean): void {
      node.disabled = busy;
      node.textContent = busy ? 'Starting…' : 'Start a new conversation';
    },
  };
}

// ── Surface 1: the pre-chat screen ──────────────────────────────────────

export interface PreChatScreenView {
  /** Mount in place of (or alongside, toggling visibility of) the message log + composer. */
  readonly node: HTMLElement;
  render(sessions: readonly ChatSessionSummary[]): void;
  setStartingNew(busy: boolean): void;
  /** Moves focus to the first meaningful control — the first row if any, else "Start a new conversation". Call after revealing this screen. */
  focus(): void;
  destroy(): void;
}

export function createPreChatScreen(callbacks: SessionPickerCallbacks): PreChatScreenView {
  const heading = el('h3', { attrs: { class: 'dh-prechat-heading', id: 'dh-prechat-heading' }, text: 'Recent conversations' });
  const list = createSessionRowList(callbacks, 'Recent conversations', 'No previous conversations yet.');
  const startNew = createStartNewButton(callbacks, 'dh-prechat-start');

  const node = el('div', {
    attrs: { class: 'dh-prechat', 'aria-labelledby': 'dh-prechat-heading' },
    children: [heading, list.node, startNew.node],
  });

  return {
    node,
    render(sessions) {
      list.render(sessions, null);
    },
    setStartingNew(busy) {
      startNew.setBusy(busy);
    },
    focus() {
      const firstRow = list.node.querySelector<HTMLButtonElement>('.dh-session-row');
      (firstRow ?? startNew.node).focus({ preventScroll: true });
    },
    destroy() {
      list.destroy();
    },
  };
}

// ── Surface 2: the in-chat header switcher ──────────────────────────────

export interface SessionSwitcherView {
  /**
   * The one node to mount in the header — a self-contained
   * `position: relative` wrapper around the toggle button and its popover,
   * so it renders correctly wherever T12 places it without depending on an
   * ancestor establishing a positioning context.
   */
  readonly node: HTMLElement;
  render(sessions: readonly ChatSessionSummary[], currentSessionId: string | null): void;
  setStartingNew(busy: boolean): void;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
}

export function createSessionSwitcher(callbacks: SessionPickerCallbacks): SessionSwitcherView {
  // Wrapped so picking a row (or asking to start fresh) from inside an OPEN
  // popover also closes it — a customer who just switched conversations
  // should see the switch, not the menu they picked it from still hanging
  // open over the top of it. `close()` is called before delegating so the
  // callback's own effects (which may re-render this component with a new
  // `currentSessionId`) never race the popover's own close.
  const closingCallbacks: SessionPickerCallbacks = {
    onSelect: (sessionId) => {
      close();
      callbacks.onSelect(sessionId);
    },
    onStartNew: () => {
      close();
      callbacks.onStartNew();
    },
  };

  const list = createSessionRowList(closingCallbacks, 'Your conversations', 'No other conversations yet.');
  const startNew = createStartNewButton(closingCallbacks, 'dh-switcher-start');

  const panel = el('div', {
    attrs: {
      class: 'dh-switcher-panel',
      id: 'dh-switcher-panel',
      hidden: true,
      role: 'group',
      'aria-label': 'Your conversations',
    },
    children: [list.node, startNew.node],
    on: {
      keydown: (event) => {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        event.stopPropagation();
        closeAndRefocus();
      },
    },
  });

  const toggle = el('button', {
    attrs: {
      class: 'dh-icon-button dh-switcher-toggle',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-controls': 'dh-switcher-panel',
      'aria-label': 'Switch conversation',
    },
    children: [icon(ICONS.list, 18)],
    on: {
      click: () => {
        if (open) closeAndRefocus();
        else openPanel();
      },
    },
  });

  const node = el('div', { attrs: { class: 'dh-switcher' }, children: [toggle, panel] });

  let open = false;

  // A pointerdown outside this component closes it, same as any ordinary
  // disclosure menu. `composedPath()` is what makes this work across the
  // shadow boundary — a plain `event.target` inside a shadow tree reports
  // the shadow HOST to a listener outside it (see focus.ts's header on the
  // same retargeting behaviour for `activeElement`).
  const onOutsidePointerDown = (event: PointerEvent): void => {
    if (!open) return;
    const path = event.composedPath();
    if (path.includes(node)) return;
    close();
  };

  function openPanel(): void {
    if (open) return;
    open = true;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutsidePointerDown, true);

    const firstRow = list.node.querySelector<HTMLButtonElement>('.dh-session-row');
    (firstRow ?? startNew.node).focus({ preventScroll: true });
  }

  function close(): void {
    if (!open) return;
    open = false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
  }

  function closeAndRefocus(): void {
    close();
    toggle.focus({ preventScroll: true });
  }

  return {
    node,
    render(sessions, currentSessionId) {
      list.render(sessions, currentSessionId);
    },
    setStartingNew(busy) {
      startNew.setBusy(busy);
    },
    isOpen: () => open,
    close,
    destroy() {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      list.destroy();
    },
  };
}
