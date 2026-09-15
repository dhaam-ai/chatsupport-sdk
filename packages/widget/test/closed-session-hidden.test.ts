// @vitest-environment jsdom
//
// A CLOSED conversation is not offered back to the customer.
//
// RESOLVED and CLOSED are two different states and this file is the guard on
// that distinction: a RESOLVED conversation is finished but still the
// customer's to reopen (picking it reactivates it server-side — see
// ui/session-picker.ts's header), while a CLOSED one has been taken off the
// table by the merchant and must not appear in the customer's lists at all.
//
// Asserted at the DOM the widget actually renders, not at a view factory's
// own `render(sessions)` contract: the views still render exactly what they
// are given (session-picker.ts's "never a second guest heuristic" rule), and
// WHICH sessions they are given is widget.ts's decision — so widget.ts is the
// only place the rule can be proven. The harness below is the same one
// session-picker-mount.test.ts uses, trimmed to what these cases need.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
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
  if (element === null) throw new Error('widget host not found');
  const root = element.shadowRoot;
  if (root === null) throw new Error('shadow root not found');
  return root;
}

const query = <T extends Element>(selector: string): T => {
  const found = shadow().querySelector<T>(selector);
  if (found === null) throw new Error(`not found: ${selector}`);
  return found;
};

const visible = (node: HTMLElement): boolean => !node.hidden && node.style.display !== 'none';
/** On screen INCLUDING ancestors — Home hides the SECTION around its recent row, not the row. */
const reallyVisible = (node: Element): boolean => {
  let current: Element | null = node;
  while (current !== null) {
    if (current instanceof HTMLElement && !visible(current)) return false;
    current = current.parentElement;
  }
  return true;
};

const messagesPane = (): HTMLElement => query<HTMLElement>('.dh-messages');
const messagesRows = (): HTMLButtonElement[] => [
  ...messagesPane().querySelectorAll<HTMLButtonElement>('.dh-messages-row'),
];
const messagesStatuses = (): string[] =>
  [...messagesPane().querySelectorAll<HTMLElement>('.dh-messages-status')].map(
    (node) => node.textContent ?? '',
  );

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

async function openedWidget(): Promise<{ widget: ChatWidget; socket: FakeWebSocket }> {
  const widget = mount(config());
  await settle();
  const socket = await driveHandshakes();
  // Opening the panel is what triggers the first session-list fetch.
  widget.open();
  await settle();
  return { widget, socket };
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

describe('Messages — a CLOSED conversation is not listed', () => {
  it('renders no row for a CLOSED past conversation', async () => {
    sessionRows = [summaryRow({ id: 'sess_closed', status: 'CLOSED' })];
    await openedWidget();
    await goToMessages();

    expect(messagesRows()).toHaveLength(0);
    expect(messagesPane().querySelector('.dh-messages-empty')?.textContent).toBe(
      'No conversations yet.',
    );
  });

  // The guard on the distinction, and the reason the rule is written
  // `=== 'CLOSED'` rather than "hide the finished ones": a later edit that
  // quietly swept RESOLVED in with CLOSED would take away the customer's own
  // route back into a conversation they are still allowed to reopen.
  it('still renders a RESOLVED past conversation', async () => {
    sessionRows = [summaryRow({ id: 'sess_resolved', status: 'RESOLVED' })];
    await openedWidget();
    await goToMessages();

    expect(messagesRows()).toHaveLength(1);
    expect(messagesStatuses()).toEqual(['Resolved']);
  });

  it('hides only the CLOSED row out of a mixed list, leaving every other status', async () => {
    sessionRows = [
      summaryRow({ id: 'sess_open', status: 'OPEN', closedAt: null }),
      summaryRow({ id: 'sess_resolved', status: 'RESOLVED' }),
      summaryRow({ id: 'sess_closed', status: 'CLOSED' }),
      summaryRow({ id: 'sess_hold', status: 'ON_HOLD', closedAt: null }),
    ];
    await openedWidget();
    await goToMessages();

    expect(messagesStatuses()).toEqual(['Open', 'Resolved', 'On hold']);
  });
});

// ── R1: it must not vanish from under the customer reading it ─────────────
//
// The list re-renders on `session.closed` (widget.ts's refresh), so without
// an exception the ONE conversation the customer is currently in would
// disappear from the list they are looking at, mid-read. The exception is
// deliberately as narrow as the risk: the joined session only, dropped like
// any other closed one as soon as they leave it.
describe('the conversation the customer is currently in', () => {
  it('stays listed when it is closed while they are looking at it', async () => {
    sessionRows = [summaryRow({ id: 'sess_current', status: 'ASSIGNED', closedAt: null })];
    const { socket } = await openedWidget();
    await goToMessages();
    expect(messagesStatuses()).toEqual(['With an agent']);

    // The agent ends it. The refreshed page comes back CLOSED.
    sessionRows = [summaryRow({ id: 'sess_current', status: 'CLOSED' })];
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();

    expect(messagesStatuses()).toEqual(['Closed']);
    expect(messagesRows()[0]?.getAttribute('aria-current')).toBe('true');
  });

  it('does not extend that exception to anybody else\'s closed conversation', async () => {
    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'ASSIGNED', closedAt: null }),
      summaryRow({ id: 'sess_other', status: 'CLOSED' }),
    ];
    await openedWidget();
    await goToMessages();

    expect(messagesStatuses()).toEqual(['With an agent']);
  });
});

// ── Home's "Recent conversation" row ──────────────────────────────────────
//
// Home shows the one newest conversation, and only while it is still OPEN
// (ui/home-screen.ts's SHOWN_IN_RECENT) — so a CLOSED one was never rendered
// there. What changes here is which conversation Home is HANDED: a closed
// newest one no longer speaks for the customer's history and hides an open
// conversation behind it.
describe("Home's recent conversation", () => {
  const homeRecentRow = (): HTMLElement | null =>
    query<HTMLElement>('.dh-home').querySelector<HTMLElement>('.dh-home-recent-row');
  const homeRecentShown = (): boolean => {
    const row = homeRecentRow();
    return row !== null && reallyVisible(row);
  };

  it('skips a closed newest conversation and offers the open one behind it', async () => {
    sessionRows = [
      summaryRow({
        id: 'sess_closed',
        status: 'CLOSED',
        lastMessageAt: '2026-08-19T11:00:00.000Z',
        lastMessagePreview: 'Closed thread',
      }),
      summaryRow({
        id: 'sess_open',
        status: 'OPEN',
        closedAt: null,
        lastMessageAt: '2026-08-19T10:00:00.000Z',
        lastMessagePreview: 'Still going',
      }),
    ];
    await openedWidget();

    expect(homeRecentShown()).toBe(true);
    expect(homeRecentRow()?.querySelector('.dh-home-recent-preview')?.textContent).toBe(
      'Still going',
    );
  });

  it('offers no recent row when the only conversation is closed', async () => {
    sessionRows = [summaryRow({ id: 'sess_closed', status: 'CLOSED' })];
    await openedWidget();

    expect(homeRecentShown()).toBe(false);
  });
});
