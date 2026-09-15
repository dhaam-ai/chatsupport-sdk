// @vitest-environment jsdom
//
// Where the keyboard goes when a row is pulled out from under it.
//
// 6e812c6 made a CLOSED conversation LEAVE the list rather than merely
// relabel itself. `render()` has always ended with `row.node.remove()` for
// any row that is no longer live, and that was survivable while removal only
// ever followed a user's own action. It is not survivable now: the portal
// queue re-polls every 20 seconds, so a conversation someone else closes
// deletes a row — and, if the keyboard happened to be on it, the focused
// BUTTON — with no user action at all.
//
// Removing the focused element does not move focus to a sibling. The browser
// resets the document's focus to `<body>`, which for a shadow-DOM widget
// means focus leaves the shadow root AND the widget entirely: the next Tab
// starts again from the top of the HOST page, behind the open panel, with
// nothing to say what happened. Nobody clicked anything.
//
// Asserted through the REAL widget rather than a view factory, because the
// removal is driven by widget.ts's poll → `syncSessionSurfaces` →
// `messagesScreen.render` path and only the whole path can produce the
// unattended removal that is the actual defect.
//
// `shadowRoot.activeElement`, never `document.activeElement`: the document
// reports the shadow HOST (`DH-CHAT-WIDGET`) for anything focused inside the
// tree, so it cannot tell "focused on a row" from "focused on the panel".
// Both are checked where the distinction matters.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

/** Assembled at runtime — a contiguous literal trips secret scanners. */
const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

/** Opens nothing and reports nothing; portal mode never connects this socket. */
class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

/** chat-service's `ChatStatus` DB integers, as `/agent/queue` leaks them. */
const CODE = {
  OPEN: 1,
  ASSIGNED: 3,
  CLOSED: 4,
} as const;

let queueRows: readonly unknown[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
      if (url.includes('/agent/queue')) {
        return new Response(JSON.stringify({ data: queueRows }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, getToken: async () => 'staff-token' },
    identity: { userId: 'admin_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    userRole: 'admin',
    onError: () => undefined,
    ...overrides,
  } as WidgetConfig;
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null || element.shadowRoot === null) throw new Error('widget shadow root not found');
  return element.shadowRoot;
}

/** The names on the rows a staff member can actually SEE. */
function visibleRowNames(): readonly string[] {
  return [...shadow().querySelectorAll<HTMLElement>('.dh-mrow-item')]
    .filter((row) => !row.hidden)
    .map((row) => row.querySelector('.dh-mrow-name')?.textContent ?? '');
}

/** The focusable control on the queue row whose name reads `name`. */
function rowButton(name: string): HTMLButtonElement {
  const row = [...shadow().querySelectorAll<HTMLElement>('.dh-mrow-item')].find(
    (candidate) => candidate.querySelector('.dh-mrow-name')?.textContent === name,
  );
  const button = row?.querySelector<HTMLButtonElement>('.dh-mrow-btn');
  if (button === undefined || button === null) throw new Error(`no queue row named ${name}`);
  return button;
}

/**
 * The conversation list's OWN polite live region — the LAST of the panel's
 * `.dh-sr[role="status"]` elements.
 *
 * Indexed from the end rather than matched by a class of its own, because
 * that is the honest description of what the DOM offers: `dh-sr` is this
 * widget's shared visually-hidden class and three other regions already wear
 * it (ui/message-list.ts, ui/identity-header.ts, ui/message-actions.ts), so
 * an unscoped `.dh-sr` asserts against whichever happens to come first.
 *
 * It is deliberately NOT inside `.dh-messages`: `widget.ts` mounts all of
 * these together near the end of the panel so that the FIRST one stays
 * `messageList.liveRegion`, which `session-closed.test.ts` queries unscoped.
 * See `MessagesScreenView.liveRegion`.
 */
function liveRegion(): HTMLElement {
  const regions = [...shadow().querySelectorAll<HTMLElement>('.dh-sr[role="status"]')];
  const region = regions[regions.length - 1];
  if (region === undefined) throw new Error('conversation-list live region not found');
  return region;
}

/** The list's own search box — the fallback landing place. */
function searchInput(): HTMLInputElement {
  const input = shadow().querySelector<HTMLInputElement>('.dh-messages-search-input');
  if (input === null) throw new Error('search input not found');
  return input;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', SilentSocket);
  stubFetch();
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  queueRows = [];
});

describe('portal queue — focus survives a row being removed under it', () => {
  it('lands on the next surviving row when the focused row is closed elsewhere', async () => {
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(visibleRowNames()).toEqual(['Closing Chris', 'Other Ollie']);

      // A staff member tabs onto the first row and reads it. No click: this
      // is someone deciding, not someone who has already chosen.
      const focused = rowButton('Closing Chris');
      focused.focus();
      expect(shadow().activeElement).toBe(focused);

      // Somebody else closes that conversation. The next poll deletes the row.
      queueRows = [{ ...closing, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['Other Ollie']);
      expect(focused.isConnected).toBe(false);

      // The whole point. Before the fix this is `null` — focus fell through
      // the shadow boundary onto the host page's `<body>`.
      expect(shadow().activeElement).toBe(rowButton('Other Ollie'));
      expect(document.activeElement?.tagName).toBe('DH-CHAT-WIDGET');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the search box when the last row is the one removed', async () => {
    // The end of the list is the case with no good row answer, and it is the
    // one the old code handled identically to every other: focus onto
    // `<body>`. The search input is the honest landing place — it is the
    // control the emptied list belongs to, one Tab from wherever the user
    // wants to go next, and pressing Enter on it does nothing to anybody's
    // conversation.
    vi.useFakeTimers();
    try {
      const only = { id: 'sess_only', customer: { displayName: 'Only Olive' } };
      queueRows = [{ ...only, status: CODE.ASSIGNED }];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(visibleRowNames()).toEqual(['Only Olive']);

      const focused = rowButton('Only Olive');
      focused.focus();
      expect(shadow().activeElement).toBe(focused);

      queueRows = [{ ...only, status: CODE.CLOSED }];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual([]);
      expect(focused.isConnected).toBe(false);
      expect(shadow().activeElement).toBe(searchInput());
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves focus exactly where it is when the removed row is not the focused one', async () => {
    // The counterweight to the two above, and the failure mode the fix itself
    // could introduce. A queue that re-polls every 20 seconds gets a great
    // many chances to move focus; every one of them that is not a direct
    // answer to the user's own place being destroyed is focus THEFT, which is
    // the same defect pointed the other way. The rescue must be inert unless
    // the row that went away is the one holding the keyboard.
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const staying = { id: 'sess_staying', status: CODE.OPEN, customer: { displayName: 'Staying Sam' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, staying];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      const held = rowButton('Staying Sam');
      held.focus();
      expect(shadow().activeElement).toBe(held);

      queueRows = [{ ...closing, status: CODE.CLOSED }, staying];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['Staying Sam']);
      expect(shadow().activeElement).toBe(held);
      expect(held.isConnected).toBe(true);

      // And it says NOTHING. This is the `restored` outcome, and it is the
      // most frequent rescue-adjacent path there is: any poll that removes any
      // row while the reader's focus sits on a surviving one re-orders the
      // list, drops focus, and puts it straight back. Nothing happened that a
      // person would notice, so nothing should be announced.
      //
      // Pinned because the failure mode is invisible without it: add a
      // `restored` arm to `announceRescue` and a customer reading the list
      // hears an announcement on essentially every 20-second poll — the
      // announcement-on-a-timer defect this whole design exists to avoid — and
      // no other assertion in the suite would fail. Correct today; this keeps
      // it that way.
      expect(liveRegion().textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch focus at all on a poll the user is nowhere near', async () => {
    // The overwhelmingly common case: the panel repaints while the person is
    // typing into the host page behind it. Nothing in this list had focus, so
    // nothing in this list may take it.
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      const hostField = document.createElement('input');
      document.body.appendChild(hostField);
      hostField.focus();
      expect(document.activeElement).toBe(hostField);

      queueRows = [{ ...closing, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['Other Ollie']);
      expect(document.activeElement).toBe(hostField);
    } finally {
      vi.useRealTimers();
    }
  });

  it('walks BACKWARD when the row removed is the last one in the queue', async () => {
    // The end of the list has no row after it, so the forward search finds
    // nothing and the backward one has to answer. Without it the staff member
    // is thrown to the search box every time the bottom row closes — which is
    // not wrong, exactly, but it is a much bigger move than the situation
    // calls for and it costs them their place in a queue they were reading
    // down.
    //
    // Pinning the PORTAL path specifically: this is the surface with the
    // unattended 20-second poll, so it is where a row goes away without
    // anybody asking.
    vi.useFakeTimers();
    try {
      const first = { id: 'sess_first', status: CODE.OPEN, customer: { displayName: 'First Fiona' } };
      const middle = { id: 'sess_middle', status: CODE.OPEN, customer: { displayName: 'Middle Milo' } };
      const last = { id: 'sess_last', customer: { displayName: 'Last Lena' } };
      queueRows = [first, middle, { ...last, status: CODE.ASSIGNED }];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(visibleRowNames()).toEqual(['First Fiona', 'Middle Milo', 'Last Lena']);

      const focused = rowButton('Last Lena');
      focused.focus();
      expect(shadow().activeElement).toBe(focused);

      queueRows = [first, middle, { ...last, status: CODE.CLOSED }];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['First Fiona', 'Middle Milo']);
      expect(focused.isConnected).toBe(false);
      // The row immediately before it, NOT the top of the list and NOT the
      // search box.
      expect(shadow().activeElement).toBe(rowButton('Middle Milo'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a render entirely when focus is on the search box, not on a row', async () => {
    // Correct by construction — `preserveListFocus` only ever inspects the
    // ROW nodes it is handed, so focus anywhere else in the list makes it a
    // no-op. Pinned because "by construction" is exactly the kind of property
    // a later refactor breaks silently: widening the capture to "anything
    // inside the list" would start yanking a half-typed query out from under
    // somebody on every poll.
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      const search = searchInput();
      search.focus();
      search.value = 'oll';
      expect(shadow().activeElement).toBe(search);

      queueRows = [{ ...closing, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['Other Ollie']);
      expect(shadow().activeElement).toBe(search);
      expect(search.value).toBe('oll');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Saying what happened ─────────────────────────────────────────────────
//
// Moving focus is half an answer. To a screen-reader user the rescue is
// indistinguishable from their own navigation: they hear a row's accessible
// name and nothing tells them the conversation they had chosen is gone. The
// region below says the missing half, and ONLY on the rescue path.
//
// What these tests can and cannot establish: jsdom proves the element exists,
// carries the right role and attributes, and that its text changes exactly
// when a rescue happens and not otherwise. It cannot prove any assistive
// technology speaks it, nor how a polite region races the focus change
// happening in the same tick. That part is untested and is labelled as such
// in the return; do not read these as proof of announcement.
describe('portal queue — the rescue says what happened', () => {
  it('is a polite, atomic, visually-hidden status region matching the rest of the widget', async () => {
    queueRows = [{ id: 'sess_a', status: CODE.OPEN, customer: { displayName: 'Anyone Anna' } }];
    const widget = mount(config());
    widget.open();
    await vi.waitFor(() => {
      expect(shadow().querySelector('.dh-mrow-item')).not.toBeNull();
    }, { timeout: 5000, interval: 20 });

    const region = liveRegion();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.classList.contains('dh-sr')).toBe(true);
    // Outside the <ul>, so it can never be mistaken for a row or counted as
    // one, and `role="list"`'s children stay exactly the rows. Outside
    // `.dh-messages` altogether, in fact — see `liveRegion` above.
    expect(region.closest('.dh-messages-list')).toBeNull();
    expect(region.closest('.dh-messages')).toBeNull();
    // Nothing has happened yet, so it has nothing to say.
    expect(region.textContent).toBe('');
  });

  it('names where focus went when the row it was on is removed', async () => {
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      rowButton('Closing Chris').focus();
      expect(liveRegion().textContent).toBe('');

      queueRows = [{ ...closing, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(shadow().activeElement).toBe(rowButton('Other Ollie'));
      expect(liveRegion().textContent).toBe(
        'The conversation you were on is no longer listed. You are now on Other Ollie.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the list has emptied when no row survives', async () => {
    // The case with nothing to hear otherwise: focus lands on the search box,
    // whose own announcement says "Search conversations" and not one word
    // about the list the user was reading having gone.
    vi.useFakeTimers();
    try {
      const only = { id: 'sess_only', customer: { displayName: 'Only Olive' } };
      queueRows = [{ ...only, status: CODE.ASSIGNED }];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      rowButton('Only Olive').focus();

      queueRows = [{ ...only, status: CODE.CLOSED }];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(shadow().activeElement).toBe(searchInput());
      expect(liveRegion().textContent).toBe(
        'The conversation you were on is no longer listed. Your list is now empty.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays silent on a poll that removes a row nobody was focused on', async () => {
    // The whole reason this is a one-shot region on the rescue path and NOT
    // `aria-live` on the list container. `applyFilter()` rewrites every
    // in-tab row's name, status, preview and relative timestamp on every
    // render, so a container-level region would announce something every 20
    // seconds, forever, to a user who is not even looking.
    vi.useFakeTimers();
    try {
      const closing = { id: 'sess_closing', customer: { displayName: 'Closing Chris' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...closing, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);

      const hostField = document.createElement('input');
      document.body.appendChild(hostField);
      hostField.focus();

      queueRows = [{ ...closing, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);

      expect(visibleRowNames()).toEqual(['Other Ollie']);
      expect(liveRegion().textContent).toBe('');

      // And it keeps quiet across further polls that change nothing at all.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(liveRegion().textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
