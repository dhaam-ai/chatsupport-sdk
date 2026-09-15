// @vitest-environment jsdom
//
// The CUSTOMER half of `messages-focus-rescue.test.ts`.
//
// The two conversation lists are separate implementations —
// `createCustomerMessagesScreen` and `createPortalMessagesScreen` in
// ui/messages-screen.ts — with a `row.node.remove()` loop each. They do NOT
// share the removal path, so proving the portal queue keeps hold of the
// keyboard proves nothing whatsoever about the customer's own list, and this
// file exists so that a fix applied to one and forgotten on the other fails
// here rather than in someone's hands.
//
// The customer list is refreshed by `session.closed`, not by a 20s poll, so
// the trigger differs; what happens to the user's PLACE when a row is
// deleted under them does not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

let frameCounter = 0;
const frameId = (): string => `01ARZ3NDEKTSV4RRFFQ69G5F${String(frameCounter++ % 10)}0`;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open(): void {
    this.onopen?.();
  }
  push(t: string, d: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id: frameId(), ts: Date.now(), d }) });
  }
  ack(sessionId = 'sess_current', status = 'ASSIGNED'): void {
    this.push('connection.ack', {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId,
        status,
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: new Date().toISOString(),
      },
    });
  }
}

function summaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sess_past',
    status: 'RESOLVED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: '2026-08-19T10:00:00.000Z',
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'Thanks!',
    unreadCount: 0,
    ...overrides,
  };
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
    ...overrides,
  };
}

let sessionRows: unknown[] = [];

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null || element.shadowRoot === null) throw new Error('widget shadow root not found');
  return element.shadowRoot;
}

const messagesPane = (): HTMLElement => {
  const pane = shadow().querySelector<HTMLElement>('.dh-messages');
  if (pane === null) throw new Error('messages pane not found');
  return pane;
};

const messagesRows = (): HTMLButtonElement[] => [
  ...messagesPane().querySelectorAll<HTMLButtonElement>('.dh-messages-row'),
];

const messagesTitles = (): string[] =>
  messagesRows().map((row) => row.querySelector('.dh-messages-title')?.textContent ?? '');

/** The row button whose title reads `title`. */
function rowButton(title: string): HTMLButtonElement {
  const button = messagesRows().find(
    (candidate) => candidate.querySelector('.dh-messages-title')?.textContent === title,
  );
  if (button === undefined) throw new Error(`no customer row titled ${title}`);
  return button;
}

/**
 * The conversation list's OWN polite region: the LAST `.dh-sr[role="status"]`
 * in the panel. `dh-sr` is shared by three other regions and this one is
 * mounted by `widget.ts`, not by the list — see `MessagesScreenView.liveRegion`.
 */
function liveRegion(): HTMLElement {
  const regions = [...shadow().querySelectorAll<HTMLElement>('.dh-sr[role="status"]')];
  const region = regions[regions.length - 1];
  if (region === undefined) throw new Error('conversation-list live region not found');
  return region;
}

function searchInput(): HTMLInputElement {
  const input = messagesPane().querySelector<HTMLInputElement>('.dh-messages-search-input');
  if (input === null) throw new Error('search input not found');
  return input;
}

function navTab(label: 'Home' | 'Messages'): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-nav-tab')].find(
    (candidate) => candidate.querySelector('.dh-nav-label')?.textContent === label,
  );
  if (tab === undefined) throw new Error(`${label} tab not found`);
  return tab;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function goToMessages(): Promise<void> {
  navTab('Messages').click();
  await settle();
}

let handshaked = new WeakSet<FakeWebSocket>();

async function driveHandshakes(resolved = 'sess_current'): Promise<FakeWebSocket> {
  for (const instance of FakeWebSocket.instances) {
    if (handshaked.has(instance)) continue;
    handshaked.add(instance);
    instance.open();
    instance.ack(resolved);
    await settle();
  }
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

async function openedWidget(): Promise<FakeWebSocket> {
  const widget = mount(config());
  await settle();
  const socket = await driveHandshakes();
  widget.open();
  await settle();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  frameCounter = 0;
  sessionRows = [];
  FakeWebSocket.instances = [];
  handshaked = new WeakSet<FakeWebSocket>();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/customer')) {
        return new Response(JSON.stringify({ success: true, data: { sessions: sessionRows } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("the customer's own list — focus survives a row being removed under it", () => {
  it('lands on a surviving row when the focused conversation is closed by the merchant', async () => {
    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'ASSIGNED', closedAt: null, storeName: 'Joined Store' }),
      summaryRow({ id: 'sess_other', status: 'RESOLVED', storeName: 'Other Store' }),
    ];
    const socket = await openedWidget();
    await goToMessages();
    expect(messagesTitles()).toEqual(['Joined Store', 'Other Store']);

    // The customer is reading down their list with the keyboard, on the row
    // for a conversation they are NOT currently joined to.
    const focused = rowButton('Other Store');
    focused.focus();
    expect(shadow().activeElement).toBe(focused);

    // The merchant closes that other conversation. `session.closed` on the
    // joined one is what makes this list refetch and repaint — the joined row
    // survives by the reading exemption, the other one does not.
    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'CLOSED', storeName: 'Joined Store' }),
      summaryRow({ id: 'sess_other', status: 'CLOSED', storeName: 'Other Store' }),
    ];
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();

    expect(messagesTitles()).toEqual(['Joined Store']);
    expect(focused.isConnected).toBe(false);
    // Before the fix: `null` — out of the shadow root, onto the host `<body>`.
    expect(shadow().activeElement).toBe(rowButton('Joined Store'));
    expect(document.activeElement?.tagName).toBe('DH-CHAT-WIDGET');
  });

  it('falls back to the search box when no customer row survives', async () => {
    // Deliberately NOT written as "navigate away and back": arriving on
    // Messages calls `messagesScreen.focus()`, which focuses the search box
    // for its own reasons, so that version of this test passes with the
    // rescue removed entirely and proves nothing. The repaint here is driven
    // by `session.closed` alone, with the customer standing still.
    //
    // The joined session (`sess_current`, from the handshake ack) is not in
    // the list at all, so the reading exemption cannot leave a row behind
    // and the list really does empty out.
    sessionRows = [summaryRow({ id: 'sess_solo', status: 'RESOLVED', storeName: 'Solo Store' })];
    const socket = await openedWidget();
    await goToMessages();
    expect(messagesTitles()).toEqual(['Solo Store']);

    const focused = rowButton('Solo Store');
    focused.focus();
    expect(shadow().activeElement).toBe(focused);

    sessionRows = [summaryRow({ id: 'sess_solo', status: 'CLOSED', storeName: 'Solo Store' })];
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();

    expect(messagesTitles()).toEqual([]);
    expect(focused.isConnected).toBe(false);
    expect(shadow().activeElement).toBe(searchInput());
  });

  it('says what happened, in the customer list too', async () => {
    // Coverage, not a RED: the region and the announcement went into BOTH
    // screens in one edit, so this passed the first time it ran. What proves
    // it bites is a mutation — stubbing the customer screen's
    // `announceRescue` to a no-op fails exactly this test and nothing else.
    // Recorded in the return; not inferred from the green tick below.
    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'ASSIGNED', closedAt: null, storeName: 'Joined Store' }),
      summaryRow({ id: 'sess_other', status: 'RESOLVED', storeName: 'Other Store' }),
    ];
    const socket = await openedWidget();
    await goToMessages();

    const region = liveRegion();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');

    rowButton('Other Store').focus();

    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'CLOSED', storeName: 'Joined Store' }),
      summaryRow({ id: 'sess_other', status: 'CLOSED', storeName: 'Other Store' }),
    ];
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();

    expect(shadow().activeElement).toBe(rowButton('Joined Store'));
    expect(liveRegion().textContent).toBe(
      'The conversation you were on is no longer listed. You are now on Joined Store.',
    );
  });
});
