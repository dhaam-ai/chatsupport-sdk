// @vitest-environment jsdom
//
// T11 built the two picker surfaces; this proves the widget mounts them, gates
// them on the one rule that is allowed to gate them, and routes their two
// actions to the two DIFFERENT core operations they mean.
//
// ── The gate ──────────────────────────────────────────────────────────────
//
// `sessions.length > 0`, and nothing else. `GET /chat/sessions/customer`
// answers a guest with `200 { sessions: [] }` rather than a 403, so an empty
// page IS the guest signal — a second "is this a guest" check anywhere would
// be a second source of truth for a fact the wire already states once. There
// is deliberately no widget flag either: emptiness already gates the rollout
// in both directions.
//
// ── The two actions are not interchangeable ───────────────────────────────
//
// `switchSession` is `session.join` under the hood and deliberately does NOT
// mint a session; `startNewSession` does. Wiring "start a new conversation" to
// the former would drop the customer into whichever conversation the server
// picked instead of the fresh one they asked for, which is why there is an
// explicit test below that they stay distinct.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatClientConfigError } from '@dhaam-ccrm/js';

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

  frames(type: string): Array<{ id: string; d: Record<string, unknown> }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { t: string; id: string; d: Record<string, unknown> })
      .filter((frame) => frame.t === type);
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
const preChatPane = (): HTMLElement => query<HTMLElement>('.dh-prechat');
const switcherPane = (): HTMLElement => query<HTMLElement>('.dh-switcher');
const rows = (root: ParentNode): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('.dh-session-row'),
];

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openedWidget(
  overrides: Partial<WidgetConfig> = {},
): Promise<{ widget: ChatWidget; socket: FakeWebSocket }> {
  const widget = mount(config(overrides));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack();
  await settle();
  widget.open();
  await settle();
  return { widget, socket };
}

beforeEach(() => {
  localStorage.clear();
  frameCounter = 0;
  sessionRows = [];
  FakeWebSocket.instances = [];
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

describe('the gate is exactly sessions.length > 0', () => {
  it('shows neither surface for an empty page — which is what a guest gets', async () => {
    sessionRows = [];
    await openedWidget();

    expect(visible(preChatPane())).toBe(false);
    expect(visible(switcherPane())).toBe(false);
    // ...and the conversation is what is on screen instead.
    expect(visible(query<HTMLElement>('.dh-log'))).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });

  it('shows both surfaces as soon as there is one session to offer', async () => {
    sessionRows = [summaryRow()];
    await openedWidget();

    expect(visible(switcherPane())).toBe(true);
    expect(visible(preChatPane())).toBe(true);
    // The chooser replaces the conversation rather than stacking on it.
    expect(visible(query<HTMLElement>('.dh-log'))).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
  });

  it('renders one row per session, in both surfaces', async () => {
    sessionRows = [summaryRow({ id: 'a' }), summaryRow({ id: 'b' })];
    await openedWidget();

    expect(rows(preChatPane())).toHaveLength(2);
    expect(rows(switcherPane())).toHaveLength(2);
  });

  it('keeps a terminal session pickable — reactivation is a real path back', async () => {
    sessionRows = [summaryRow({ id: 'closed_one', status: 'CLOSED' })];
    await openedWidget();

    const row = rows(preChatPane())[0];
    if (row === undefined) throw new Error('no row rendered');
    expect(row.disabled).toBe(false);
    expect(row.closest('.dh-session-item')?.getAttribute('data-status')).toBe('CLOSED');
  });
});

describe('picking a conversation', () => {
  it('joins the chosen session and puts the conversation back on screen', async () => {
    sessionRows = [summaryRow({ id: 'sess_past' })];
    const { socket } = await openedWidget();

    const row = rows(preChatPane())[0];
    if (row === undefined) throw new Error('no row rendered');
    row.click();
    await settle();

    const joins = socket.frames('session.join');
    expect(joins).toHaveLength(1);
    expect(joins[0]?.d['sessionId']).toBe('sess_past');

    expect(visible(preChatPane())).toBe(false);
    expect(visible(query<HTMLElement>('.dh-log'))).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });

  it('does not optimistically flip a terminal session to open', async () => {
    sessionRows = [summaryRow({ id: 'sess_past', status: 'CLOSED' })];
    const { widget } = await openedWidget();

    const before = widget.store.getState().session;
    const row = rows(preChatPane())[0];
    if (row === undefined) throw new Error('no row rendered');
    row.click();
    await settle();

    // The server reactivates on the customer's next message, behind a flag
    // that defaults to OFF. Guessing locally would show a live conversation
    // on a deployment where reactivation never happens.
    expect(widget.store.getState().session).toBe(before);
  });

  it('marks the current conversation in the switcher', async () => {
    sessionRows = [summaryRow({ id: 'sess_current', status: 'ASSIGNED', closedAt: null }), summaryRow({ id: 'other' })];
    await openedWidget();

    const current = rows(switcherPane()).find((row) => row.getAttribute('aria-current') === 'true');
    expect(current).toBeDefined();
    expect(current?.getAttribute('aria-label')).toContain('current conversation');
  });
});

describe('starting a new conversation', () => {
  it('mints a session rather than joining one', async () => {
    sessionRows = [summaryRow()];
    const { widget, socket } = await openedWidget();

    const startNew = vi.spyOn(widget.store.client, 'startNewSession').mockResolvedValue();
    const switchTo = vi.spyOn(widget.store.client, 'switchSession');

    query<HTMLButtonElement>('.dh-prechat-start').click();
    await settle();

    expect(startNew).toHaveBeenCalledTimes(1);
    // The distinction that matters: `switchSession` is `session.join` and
    // deliberately does not mint a session.
    expect(switchTo).not.toHaveBeenCalled();
    expect(socket.frames('session.join')).toHaveLength(0);
  });

  it('leaves the chooser for the conversation once the new session lands', async () => {
    sessionRows = [summaryRow()];
    const { widget } = await openedWidget();
    vi.spyOn(widget.store.client, 'startNewSession').mockResolvedValue();

    query<HTMLButtonElement>('.dh-prechat-start').click();
    await settle();

    expect(visible(preChatPane())).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });

  it('goes busy on every surface at once, so one round trip cannot mint two sessions', async () => {
    sessionRows = [summaryRow()];
    const { widget } = await openedWidget();

    let release = (): void => undefined;
    vi.spyOn(widget.store.client, 'startNewSession').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    query<HTMLButtonElement>('.dh-prechat-start').click();
    await settle();

    expect(query<HTMLButtonElement>('.dh-prechat-start').disabled).toBe(true);
    expect(query<HTMLButtonElement>('.dh-switcher-start').disabled).toBe(true);

    release();
    await settle();
    expect(query<HTMLButtonElement>('.dh-switcher-start').disabled).toBe(false);
  });

  it('stays on the chooser when the new session could not be opened', async () => {
    sessionRows = [summaryRow()];
    const { widget } = await openedWidget();
    vi.spyOn(widget.store.client, 'startNewSession').mockRejectedValue(new Error('nope'));

    query<HTMLButtonElement>('.dh-prechat-start').click();
    await settle();

    // Dropping the customer onto an empty transcript would hide the fact that
    // nothing actually happened.
    expect(visible(preChatPane())).toBe(true);
  });
});

describe('the SWITCHED-close pairing', () => {
  it('does not close the conversation the customer just switched INTO', async () => {
    sessionRows = [summaryRow({ id: 'sess_past', status: 'CLOSED' })];
    const { widget, socket } = await openedWidget();

    const row = rows(preChatPane())[0];
    if (row === undefined) throw new Error('no row rendered');
    row.click();
    await settle();

    // The server acks the switch...
    socket.push('session.updated', {
      session: {
        sessionId: 'sess_past',
        status: 'WAITING_FOR_AGENT',
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: '2026-08-19T09:00:00.000Z',
      },
    });
    await settle();

    // ...and, in either order, closes the OTHER session the customer left
    // behind. One customer, one live conversation.
    socket.push('session.closed', { sessionId: 'sess_current', closeReason: 'SWITCHED' });
    await settle();

    // The session just switched into must survive both halves of that pair.
    expect(widget.store.getState().session?.id).toBe('sess_past');
    expect(query<HTMLElement>('.dh-system').hidden).toBe(true);
    expect(query<HTMLTextAreaElement>('.dh-input').disabled).toBe(false);
  });
});

describe('an embed whose client has no session summary source', () => {
  it('mounts, connects and chats exactly as before — with no picker and no error', async () => {
    const errors: unknown[] = [];
    const widget = mount(config({ onError: (error) => errors.push(error) }));
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket');
    socket.open();
    socket.ack();
    await settle();

    vi.spyOn(widget.store.client, 'listSessions').mockRejectedValue(
      new ChatClientConfigError('listSessions() requires config.sessionSummarySource'),
    );

    widget.open();
    await settle();

    expect(visible(preChatPane())).toBe(false);
    expect(visible(switcherPane())).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    // A configuration fact, not a fault: reporting it would fire on every page
    // load of an embed that simply has no session list.
    expect(errors).toHaveLength(0);
  });

  it('still reports a genuine failure to load the list', async () => {
    const errors: unknown[] = [];
    const widget = mount(config({ onError: (error) => errors.push(error) }));
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket');
    socket.open();
    socket.ack();
    await settle();
    errors.length = 0;

    vi.spyOn(widget.store.client, 'listSessions').mockRejectedValue(new Error('503'));

    widget.open();
    await settle();

    expect(errors).toHaveLength(1);
    expect(visible(preChatPane())).toBe(false);
  });
});

describe('a host that named the session it wants', () => {
  it('mounts the switcher but never opens onto the chooser', async () => {
    sessionRows = [summaryRow()];
    await openedWidget({ sessionId: 'sess_named' });

    // Being pointed at one conversation is not the same as being locked into
    // it, so the switcher still mounts.
    expect(visible(switcherPane())).toBe(true);
    expect(visible(preChatPane())).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });
});

describe('teardown', () => {
  it('releases the switcher’s document-level listener', async () => {
    sessionRows = [summaryRow()];
    const removed: string[] = [];
    const original = document.removeEventListener.bind(document);
    vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (original as (...args: never[]) => void)(type as never, ...(rest as never[]));
    }) as typeof document.removeEventListener);

    const { widget } = await openedWidget();
    widget.destroy();

    expect(removed).toContain('pointerdown');
  });
});
