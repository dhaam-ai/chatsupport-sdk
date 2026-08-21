// @vitest-environment jsdom
//
// An agent starting a conversation with a customer who has no open session,
// end to end through the real widget.
//
// The server creates the session, moves this customer's connection into it,
// and pushes the EXISTING `session.updated` frame with the new snapshot — no
// new wire frame type, because the server-push catalog is closed. Core swaps
// the conversation and emits `conversationStarted`; this file covers the only
// part the widget owns, which is whether the customer ever finds out.
//
// Opening is opt-in (`openOnAgentInitiated`, default false) because a panel
// that opens itself covers the page the customer is actually using. Left off,
// the launcher has to carry it instead — so "does not open" and "surfaces
// nothing" are two different outcomes and both are pinned here.
//
// Same hand-run fake socket as session-closed.test.ts, so the real
// `connection.hello` -> `connection.ack` handshake runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWidget, mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;
function ulid(): string {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
}

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

  #session(sessionId: string, status: string) {
    return {
      sessionId,
      status,
      mode: 'HUMAN',
      participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
      createdAt: new Date().toISOString(),
    };
  }

  ack(sessionId: string, status = 'ASSIGNED'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: ulid(),
        ts: Date.now(),
        d: { protocolVersion: 1, seq: 0, session: this.#session(sessionId, status) },
      }),
    });
  }

  /** What the staff-tier session-create endpoint makes the server push. */
  sessionUpdated(sessionId: string, status = 'ASSIGNED'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.updated',
        id: ulid(),
        ts: Date.now(),
        d: { session: this.#session(sessionId, status) },
      }),
    });
  }
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

const panelOpen = (): boolean => query<HTMLElement>('.dh-panel').getAttribute('data-open') === 'true';
const badge = (): HTMLElement => query<HTMLElement>('.dh-badge');
const launcher = (): HTMLElement => query<HTMLElement>('.dh-launcher');

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(overrides: Partial<WidgetConfig> = {}): Promise<FakeWebSocket> {
  mount(config(overrides));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1');
  await settle();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
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

describe('openOnAgentInitiated: true', () => {
  it('opens the panel when the server moves the customer into a new session', async () => {
    const socket = await connected({ openOnAgentInitiated: true });
    expect(panelOpen()).toBe(false);

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(panelOpen()).toBe(true);
  });

  it('opens onto the NEW conversation, not the one it replaced', async () => {
    // Core commits the session before emitting, so the panel this opens is
    // already showing the conversation the agent started. Opening onto the
    // previous transcript would be worse than not opening at all.
    const socket = await connected({ openOnAgentInitiated: true });
    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(getWidget()?.store.getState().session?.id).toBe('sess_agent_started');
    expect(panelOpen()).toBe(true);
  });

  it('does nothing extra when session.updated names the session already on screen', async () => {
    // The ordinary refresh — a status change on the current session. Opening
    // the panel for that would fire on routine traffic.
    const socket = await connected({ openOnAgentInitiated: true });

    socket.sessionUpdated('sess_1', 'RESOLVED');
    await settle();

    expect(panelOpen()).toBe(false);
  });

  it('leaves an already-open panel open rather than fighting it', async () => {
    const socket = await connected({ openOnAgentInitiated: true });
    launcher().click();
    await settle();
    expect(panelOpen()).toBe(true);

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(panelOpen()).toBe(true);
  });
});

describe('openOnAgentInitiated: false (the default)', () => {
  it('does NOT open the panel', async () => {
    const socket = await connected();

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(panelOpen()).toBe(false);
  });

  it('is the default when the host says nothing at all', async () => {
    // Pinned explicitly: a flag that silently defaulted to true would make
    // every existing integration start opening itself on upgrade.
    const socket = await connected();
    expect(config().openOnAgentInitiated).toBeUndefined();

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(panelOpen()).toBe(false);
  });

  it('still surfaces it — the launcher badge appears', async () => {
    // The half that makes default-off honest. `session.updated` is not a
    // message, so `unreadCount` has not moved; without this the launcher
    // would look exactly like an idle one and the conversation would be
    // invisible until the customer happened to open the panel.
    const socket = await connected();
    expect(badge().hidden).toBe(true);

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(badge().hidden).toBe(false);
  });

  it('says so in the launcher accessible name, not only in colour', async () => {
    // The panel is `aria-hidden` while closed, so its live region cannot
    // speak here. This attribute is the only accessible surface a closed
    // widget has, which makes a bare red dot inadequate on its own.
    const socket = await connected();

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(launcher().getAttribute('aria-label')).toBe(
      'Open chat, a new conversation is waiting',
    );
  });

  it('shows a dot rather than the literal "0"', async () => {
    const socket = await connected();
    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(badge().textContent).toBe('');
  });

  it('clears the badge once the customer opens the panel', async () => {
    const socket = await connected();
    socket.sessionUpdated('sess_agent_started');
    await settle();
    expect(badge().hidden).toBe(false);

    launcher().click();
    await settle();
    expect(panelOpen()).toBe(true);
    expect(badge().hidden).toBe(true);

    // And stays cleared when they close it again — seeing it is what
    // answers the mark, not the panel being open.
    launcher().click();
    await settle();
    expect(panelOpen()).toBe(false);
    expect(badge().hidden).toBe(true);
    expect(launcher().getAttribute('aria-label')).toBe('Open chat');
  });

  it('does not mark the launcher for a same-session refresh', async () => {
    const socket = await connected();

    socket.sessionUpdated('sess_1', 'RESOLVED');
    await settle();

    expect(badge().hidden).toBe(true);
    expect(launcher().getAttribute('aria-label')).toBe('Open chat');
  });
});
