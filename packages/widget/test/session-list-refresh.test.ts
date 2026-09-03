// @vitest-environment jsdom
//
// Defect 4, second half: "each conversation's status must be visible in the
// widget's conversation list AND on Home's recent conversation."
//
// ── Why a whole file for one fetch ────────────────────────────────────────
//
// The list is a page from `GET /chat/sessions/customer`, not a live
// projection, and it used to be fetched exactly once — on the first panel
// open — and never again. Every status on both screens was therefore frozen
// at whatever it was that moment: a conversation ended two minutes ago went
// on reading "With an agent" until the visitor reloaded the page. Nothing in
// the suite counted that request, so a refactor that quietly dropped a
// refresh call would put the reported bug straight back with a green run.
//
// ── The three things that are easy to get wrong ───────────────────────────
//
// 1. WHEN it refetches. The socket's `sessionClosed` event is necessary and
//    NOT sufficient: core emits it only for the session currently in state,
//    and a customer may now hold several open conversations at once (starting
//    one no longer closes the last), so an agent closing one they are not
//    looking at reaches this widget through no event at all. Hence the panel
//    open and the two status-rendering screens.
// 2. That two fetches never OVERLAP. `listSessions` writes `pastSessions` by
//    wholesale replace, so two concurrent GETs are two writers with no
//    ordering between them — let the first-open fetch race a close-driven one
//    and the older page can land last and reinstate the stale statuses.
// 3. That a refresh asked for during a flight is not DROPPED. End a
//    conversation and immediately start another and the second ask used to be
//    discarded, leaving the list settled on a page fetched before the new
//    conversation existed.
//
// Same hand-driven fake socket the other mount tests use, so the assertions
// are made against the real store, the real screens and the real fetch stack.

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
    id: 'sess_current',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: null,
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'On it now',
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

/** What the next `GET /chat/sessions/customer` answers with. */
let sessionRows: unknown[] = [];
/** Every such GET, counted — the whole point of this file. */
let sessionsCalls = 0;
/**
 * Holds every list response open, so a second caller genuinely arrives while
 * the first is in flight.
 */
let holdSessions = false;
/** The held responses, oldest first — released one at a time. */
let pendingSessions: Array<() => void> = [];

/** Lets the OLDEST held response through, leaving the hold in place. */
function releaseOneSession(): void {
  pendingSessions.shift()?.();
}

function releaseAllSessions(): void {
  holdSessions = false;
  const waiting = pendingSessions;
  pendingSessions = [];
  for (const release of waiting) release();
}

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

const homeStatus = (): string => query<HTMLElement>('.dh-home-recent-status').textContent ?? '';
const messagesStatuses = (): string[] => [
  ...shadow().querySelectorAll<HTMLElement>('.dh-messages-status'),
].map((node) => node.textContent ?? '');

async function openedWidget(): Promise<{ widget: ChatWidget; socket: FakeWebSocket }> {
  const widget = mount(config());
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_current', 'ASSIGNED');
  await settle();
  widget.open();
  await settle();
  return { widget, socket };
}

beforeEach(() => {
  localStorage.clear();
  frameCounter = 0;
  sessionRows = [summaryRow()];
  sessionsCalls = 0;
  holdSessions = false;
  pendingSessions = [];
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/api/chat-token')) return json({ accessToken: 'tok', expiresIn: 3600 });
      if (url.includes('/chat/sessions/customer')) {
        sessionsCalls += 1;
        if (holdSessions) {
          await new Promise<void>((resolve) => pendingSessions.push(resolve));
        }
        // Read AFTER the wait, so a test can change the answer while the
        // request is held open — which is how "the older page lands last" is
        // made observable at all.
        return json({ success: true, data: { sessions: sessionRows } });
      }
      if (url.includes('/csat')) return json({ success: true, data: { rated: false } });
      return json({ success: true, data: { messages: [], hasMore: false } });
    }),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  releaseAllSessions();
  unmount();
  vi.unstubAllGlobals();
});

describe('when the list is fetched at all', () => {
  it('not before the panel is opened — a widget nobody looked at costs nothing', async () => {
    const widget = mount(config());
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket was opened');
    socket.open();
    socket.ack('sess_current', 'ASSIGNED');
    await settle();

    expect(sessionsCalls).toBe(0);

    widget.open();
    await settle();
    expect(sessionsCalls).toBe(1);
  });

  it('again on a later open — a status can have moved while the panel was shut', async () => {
    const { widget } = await openedWidget();
    expect(sessionsCalls).toBe(1);

    widget.close();
    await settle();
    widget.open();
    await settle();

    expect(sessionsCalls).toBe(2);
  });

  it('again on arriving at Messages, and again on arriving back at Home', async () => {
    // The case no socket event can cover: an agent closes a conversation the
    // customer is NOT currently in, so core emits nothing (it only emits for
    // the session in state) and only a re-fetch can learn about it.
    await openedWidget();
    expect(sessionsCalls).toBe(1);

    navTab('Messages').click();
    await settle();
    expect(sessionsCalls).toBe(2);

    navTab('Home').click();
    await settle();
    expect(sessionsCalls).toBe(3);
  });

  it('NOT on the screen reset that closing the panel performs', async () => {
    // `close()` calls `screens.reset(initial)`, which runs the same navigation
    // callback — a list nobody can see is not worth a round trip, and the next
    // open fetches one anyway.
    const { widget } = await openedWidget();
    navTab('Messages').click();
    await settle();
    const before = sessionsCalls;

    widget.close();
    await settle();

    expect(sessionsCalls).toBe(before);
  });
});

describe('an agent ends the conversation while the customer is looking at the list', () => {
  it('re-fetches, and both screens show the new status', async () => {
    sessionRows = [summaryRow({ id: 'sess_current', status: 'ASSIGNED' })];
    const { socket } = await openedWidget();
    expect(sessionsCalls).toBe(1);
    expect(homeStatus()).toBe('With an agent');

    // The server's answer moves on…
    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'CLOSED', closedAt: '2026-08-19T10:00:00.000Z' }),
    ];
    // …and the only announcement is the socket frame.
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();

    expect(sessionsCalls).toBeGreaterThan(1);
    expect(homeStatus()).toBe('Closed');

    navTab('Messages').click();
    await settle();
    expect(messagesStatuses()).toEqual(['Closed']);
  });
});

describe('two fetches never overlap', () => {
  it('the first-open fetch and a close-driven one are serialised, newest answer last', async () => {
    // The race this guards: `listSessions` replaces `pastSessions` wholesale,
    // so if the panel-open GET were still open when a close-driven GET went
    // out, the pre-close page could land LAST and put every row back to the
    // status it had before.
    holdSessions = true;
    const widget = mount(config());
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket was opened');
    socket.open();
    socket.ack('sess_current', 'ASSIGNED');
    await settle();

    widget.open();
    await settle();
    expect(sessionsCalls).toBe(1);

    // A close lands while that first page is still in flight.
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();
    // Still exactly one request out — the second was collapsed, not raced.
    expect(sessionsCalls).toBe(1);

    // The held page is the STALE one, fetched before the close.
    sessionRows = [summaryRow({ id: 'sess_current', status: 'ASSIGNED' })];
    releaseOneSession();
    await settle();
    // Only now does the queued refresh go out — after the first LANDED, never
    // beside it.
    expect(sessionsCalls).toBe(2);
    expect(homeStatus()).toBe('With an agent');

    sessionRows = [
      summaryRow({ id: 'sess_current', status: 'CLOSED', closedAt: '2026-08-19T10:00:00.000Z' }),
    ];
    releaseOneSession();
    await settle();

    // The newer answer is the one left on screen, which is the whole point of
    // serialising: with both in flight at once the stale page could have
    // landed last and written this back to "With an agent".
    expect(homeStatus()).toBe('Closed');
    expect(sessionsCalls).toBe(2);
  });

  it('a burst of closes collapses to ONE re-fetch, not one per event', async () => {
    const { socket } = await openedWidget();
    expect(sessionsCalls).toBe(1);

    holdSessions = true;
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();
    expect(sessionsCalls).toBe(2);

    // Three more while #2 is still open — they share the single queued slot.
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();
    expect(sessionsCalls).toBe(2);

    releaseOneSession();
    await settle();

    // One re-issue for all three…
    expect(sessionsCalls).toBe(3);
    releaseOneSession();
    await settle();
    // …and then it stops, rather than chaining a fourth.
    expect(sessionsCalls).toBe(3);
  });

  it('a refresh asked for during a flight is re-issued, never dropped', async () => {
    // The end-then-immediately-start-another sequence: the second ask used to
    // return silently, leaving the list on a page fetched before the new
    // conversation existed.
    const { socket } = await openedWidget();
    holdSessions = true;

    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'RESOLVED' });
    await settle();
    expect(sessionsCalls).toBe(2);

    navTab('Messages').click();
    await settle();
    expect(sessionsCalls).toBe(2);

    releaseOneSession();
    await settle();

    expect(sessionsCalls).toBe(3);
  });
});
