// @vitest-environment jsdom
//
// CHARACTERIZATION (not RED). Brownfield: this file records what the customer
// path through the Messages list does TODAY, before the type-signature repair
// on `MessagesScreenCallbacks.onOpenConversation`, so that the repair can be
// shown to have changed types and nothing else. Every assertion below was
// written against, and observed passing on, the UNCHANGED source.
//
// The boundary is the one the dispatch named: opening a conversation from the
// customer Messages list — what `selectSession` is handed, and what the
// conversation header shows once it has run.
//
// Two halves, because the boundary has two ends:
//
//   1. `createMessagesScreen` (the exported UI module): the CUSTOMER variant
//      calls `onOpenConversation` with the session id ALONE. `displayName`
//      and `subtitle` are not passed — a customer row has no name of its own
//      to offer, only an id (`createCustomerMessageRow`'s `onSelect` takes
//      exactly `(sessionId: string)`).
//   2. `mount()` (the whole widget, real socket handshake, real REST stubs):
//      the header the customer then reads is NOT blank and NOT a placeholder.
//      `selectSession` resolves the missing name itself out of `pastSessions`
//      via `getCustomerConversationTitle`, and leaves the status subtitle
//      exactly as it found it because `subtitleText` is `undefined`.
//
// Half 2 is the load-bearing one: it is the evidence that the customer path
// passing fewer arguments is a DESIGNED fallback rather than a user-visible
// hole. Were the fallback absent, this test would show an empty or
// placeholder title and the right answer would have been a behaviour fix, not
// a type fix.
//
// The socket/fetch harness is the one session-switch.test.ts established, cut
// down to what a single row-click needs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { mount, unmount } from '../src/index.js';
import { createMessagesScreen } from '../src/ui/messages-screen.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

const CURRENT = 'sess_current';
const PAST = 'sess_past';

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
  ack(sessionId = CURRENT, status = 'ASSIGNED'): void {
    this.push('connection.ack', {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId,
        status,
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: '2026-08-19T09:00:00.000Z',
      },
    });
  }
}

function summaryRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
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
    apiUrl: API_URL,
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

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let handshaked = new WeakSet<FakeWebSocket>();

async function driveHandshakes(resolved = CURRENT): Promise<void> {
  for (const instance of FakeWebSocket.instances) {
    if (handshaked.has(instance)) continue;
    handshaked.add(instance);
    instance.open();
    instance.ack(resolved);
    await settle();
  }
}

async function boot(overrides: Partial<WidgetConfig> = {}): Promise<void> {
  const widget = mount(config(overrides));
  await settle();
  await driveHandshakes();
  widget.open();
  await settle();
}

async function goToMessages(): Promise<void> {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-nav-tab')].find(
    (candidate) => candidate.querySelector('.dh-nav-label')?.textContent === 'Messages',
  );
  if (tab === undefined) throw new Error('Messages tab not found');
  tab.click();
  await settle();
}

/** The row for `sessionId`, found the way a customer finds it: by what it says. */
function rowFor(displayName: string): HTMLButtonElement {
  const rows = [...query('.dh-messages').querySelectorAll<HTMLButtonElement>('.dh-messages-row')];
  const row = rows.find((candidate) => candidate.querySelector('.dh-messages-title')?.textContent === displayName);
  if (row === undefined) {
    throw new Error(`no row titled ${displayName}; saw: ${rows.map((r) => r.querySelector('.dh-messages-title')?.textContent).join(' | ')}`);
  }
  return row;
}

beforeEach(() => {
  frameCounter = 0;
  sessionRows = [];
  FakeWebSocket.instances = [];
  handshaked = new WeakSet<FakeWebSocket>();
  localStorage.clear();
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
      if (/\/chat\/sessions\/[^/?]+\/messages/.test(url)) {
        return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  unmount();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('characterization — what the customer Messages row hands the widget', () => {
  it('calls onOpenConversation with the session id ALONE: no displayName, no subtitle', () => {
    const onOpenConversation = vi.fn();
    const screen = createMessagesScreen({ onOpenConversation, onStartNew: () => undefined });
    document.body.appendChild(screen.node);

    const summary: ChatSessionSummary = {
      id: 'sess_42',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-19T09:00:00.000Z',
      closedAt: null,
      lastMessageAt: '2026-08-19T09:30:00.000Z',
      lastMessagePreview: 'Where is my order?',
      unreadCount: 0,
    };
    screen.render([summary], null);

    screen.node.querySelector<HTMLButtonElement>('.dh-messages-row')!.click();

    // The exact call SHAPE, not `toHaveBeenCalledWith` — arity is the whole
    // subject here. `toHaveBeenCalledWith('sess_42')` does, in fact, reject a
    // call padded with `undefined`s under this repo's pinned vitest (2.1.9),
    // so that is not the reason to prefer this form. The reason is what each
    // form tests: `toHaveBeenCalledWith` rejects the padded call because of
    // the matcher's own argument-length comparison — a property of the
    // matcher's implementation, not of the call itself. Asserting
    // `.mock.calls` directly pins arity as a fact about the call, independent
    // of which matcher-internal semantics happen to reject padding.
    expect(onOpenConversation.mock.calls).toHaveLength(1);
    expect(onOpenConversation.mock.calls[0]).toEqual(['sess_42']);
    expect(onOpenConversation.mock.calls[0]).toHaveLength(1);
  });
});

describe('characterization — what the customer then reads in the header', () => {
  it('resolves the missing display name from pastSessions rather than showing a blank or placeholder header', async () => {
    sessionRows = [summaryRow(PAST, { storeName: 'Ocean Lamps', lastMessagePreview: 'Where is my order?' })];
    await boot();
    await goToMessages();

    const subtitleBefore = query('.dh-status-text').textContent;
    expect(subtitleBefore).not.toBe('');

    rowFor('Ocean Lamps').click();

    // Read BEFORE awaiting, deliberately. `selectSession` sets the title and
    // decides the subtitle synchronously and only then awaits
    // `whenHistorySettles()`, so this is the state the row-click itself
    // produced, with nothing else yet mixed in.
    //
    // Handed no name at all, the widget still names the conversation — the
    // fallback in `selectSession` reads `pastSessions` itself.
    expect(query('.dh-title').textContent).toBe('Ocean Lamps');
    // `subtitleText` arrives `undefined`, and undefined means LEAVE IT, not
    // "blank it": the status line the customer was already reading survives
    // the click untouched.
    expect(query('.dh-status-text').textContent).toBe(subtitleBefore);

    await settle();

    // Still named after the round trips. The subtitle DOES move here, to
    // 'Connecting…' — but that is the connection-state writer talking (a
    // switch tears the socket down and opens another, and this harness
    // deliberately leaves that second socket un-handshaked), not the
    // `subtitleText` argument, which never had a value to write. Asserted as
    // "not blank" rather than pinned to a connection string, so this
    // characterization stays about the argument and not about socket timing.
    expect(query('.dh-title').textContent).toBe('Ocean Lamps');
    expect(query('.dh-status-text').textContent).not.toBe('');
  });

  it('falls back to the configured title when the summary carries no name of any kind', async () => {
    sessionRows = [summaryRow(PAST, { lastMessagePreview: 'Where is my order?' })];
    await boot({ title: 'Acme Support' });
    await goToMessages();

    // The row is titled 'Support' — `getCustomerConversationTitle`'s
    // `fallbackTitle = 'Support'` default, taken because the Messages list
    // calls it with no fallback argument (both in messages-screen.ts) —
    // while the assertion below expects the header to read the configured
    // 'Acme Support', because `selectSession` in widget.ts passes
    // `config.title` in. This test pins that pre-existing label divergence
    // rather than asserting the row and header agree; it is out of scope
    // here and already tracked on the backlog as T0-R4.
    rowFor('Support').click();
    await settle();

    expect(query('.dh-title').textContent).toBe('Acme Support');
  });

  // The real shape `GET /chat/sessions/customer` actually sends: no
  // `storeName`, no `merchantName`, no `targetName` — those are portal
  // enrichment fields this same session list never carries. `subject` is
  // what IS present for a store-targeted chat (a mint's `subject` defaults
  // to its `title`, and a store-targeted mount's title is the outlet's own
  // name — see getCustomerConversationTitle's doc), so it is the one real
  // signal available here for "which outlet is this". Before this test both
  // the row and the header read the generic 'Support' fallback regardless.
  it('names the row and the header after the session\'s own subject when nothing else is offered', async () => {
    sessionRows = [summaryRow(PAST, { subject: 'outlet tests', lastMessagePreview: 'Hi 👋 Ask us anything' })];
    await boot({ title: 'Chat with us' });
    await goToMessages();

    rowFor('outlet tests').click();
    await settle();

    expect(query('.dh-title').textContent).toBe('outlet tests');
  });
});
