// @vitest-environment jsdom
//
// `DhaamChat.on(...)` — the host-page subscription that makes the documented
// agent-initiated integration possible without reaching into internals:
//
//     DhaamChat.on('conversationStarted', () => DhaamChat.open());
//
// The case worth testing hardest is the one a host will actually write: a
// script tag, then an inline `<script>` that subscribes. That inline script
// runs BEFORE `DOMContentLoaded` mounts anything, so a naive
// `widget()?.store.on(...)` would drop the subscription on the floor and the
// panel would simply never open — silently, and only in production, where the
// document is still parsing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWidget, mount, unmount } from '../src/index.js';
import type { DhaamChatGlobal } from '../src/embed.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

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

  #session(sessionId: string) {
    return {
      sessionId,
      status: 'ASSIGNED',
      mode: 'HUMAN',
      participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
      createdAt: new Date().toISOString(),
    };
  }

  ack(sessionId: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: ulid(),
        ts: Date.now(),
        d: { protocolVersion: 1, seq: 0, session: this.#session(sessionId) },
      }),
    });
  }

  sessionUpdated(sessionId: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.updated',
        id: ulid(),
        ts: Date.now(),
        d: { session: this.#session(sessionId) },
      }),
    });
  }
}

function config(): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Loads embed.ts fresh, so `install()` runs against this test's window. */
async function loadEmbed(): Promise<DhaamChatGlobal> {
  vi.resetModules();
  await import('../src/embed.js');
  const api = (window as unknown as Record<string, unknown>)['DhaamChat'];
  if (api === undefined) throw new Error('DhaamChat was not installed');
  return api as DhaamChatGlobal;
}

async function connect(): Promise<FakeWebSocket> {
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1');
  await settle();
  return socket;
}

const panelOpen = (): boolean => {
  const root = document.querySelector<HTMLElement>('dh-chat-widget')?.shadowRoot;
  return root?.querySelector('.dh-panel')?.getAttribute('data-open') === 'true';
};

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  delete (window as unknown as Record<string, unknown>)['DhaamChat'];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/chat-token')) {
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

describe('DhaamChat.on', () => {
  it('is installed on the global alongside open/close/mount', async () => {
    const api = await loadEmbed();
    expect(typeof api.on).toBe('function');
    expect(typeof api.open).toBe('function');
  });

  it('runs the documented integration: subscribe, then open on conversationStarted', async () => {
    const api = await loadEmbed();
    api.mount(config());
    const socket = await connect();

    api.on('conversationStarted', () => api.open());
    expect(panelOpen()).toBe(false);

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(panelOpen()).toBe(true);
  });

  it('honours a subscription registered BEFORE anything is mounted', async () => {
    // The whole reason `on` buffers. A script tag mounts on DOMContentLoaded,
    // so the inline script a host writes next to it runs first.
    const api = await loadEmbed();
    const started = vi.fn();
    api.on('conversationStarted', started);
    expect(getWidget()).toBeNull();

    api.mount(config());
    const socket = await connect();
    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(started).toHaveBeenCalledTimes(1);
  });

  it('passes the event payload straight through', async () => {
    const api = await loadEmbed();
    const started = vi.fn();
    api.on('conversationStarted', started);
    api.mount(config());
    const socket = await connect();

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(started.mock.calls[0]?.[0]).toMatchObject({
      previousSessionId: 'sess_1',
      session: { id: 'sess_agent_started' },
    });
  });

  it('stops calling the handler once unsubscribed', async () => {
    const api = await loadEmbed();
    api.mount(config());
    const socket = await connect();

    const started = vi.fn();
    const off = api.on('conversationStarted', started);
    off();

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(started).not.toHaveBeenCalled();
  });

  it('survives destroy and remount without the host re-subscribing', async () => {
    // A subscription that silently died on remount would push a host straight
    // back to `widget().store.on(...)`, which is what this method replaces.
    const api = await loadEmbed();
    const started = vi.fn();
    api.on('conversationStarted', started);

    api.mount(config());
    await connect();
    api.destroy();

    FakeWebSocket.instances = [];
    api.mount(config());
    const socket = await connect();
    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(started).toHaveBeenCalledTimes(1);
  });

  it('re-binds to a widget mounted through the module export, not only through the API', async () => {
    // `mount()` from the package index bypasses `DhaamChat.mount`, so the
    // registrations must notice the new widget by identity rather than
    // assuming they were told about it.
    const api = await loadEmbed();
    const started = vi.fn();
    api.on('conversationStarted', started);

    mount(config());
    const socket = await connect();
    // Nothing has gone through `mountAndAttach`, so this is the identity
    // check doing the work at subscribe/attach time.
    api.on('conversationStarted', started);

    socket.sessionUpdated('sess_agent_started');
    await settle();

    expect(started).toHaveBeenCalled();
  });

  it('does not fire for a same-session session.updated', async () => {
    const api = await loadEmbed();
    const started = vi.fn();
    api.on('conversationStarted', started);
    api.mount(config());
    const socket = await connect();

    socket.sessionUpdated('sess_1');
    await settle();

    expect(started).not.toHaveBeenCalled();
  });

  it('forwards the rest of the catalog too, not just conversationStarted', async () => {
    // The method is generic over §6.5 on purpose — one method, whole catalog,
    // so it never needs extending for the next event.
    const api = await loadEmbed();
    const connected = vi.fn();
    api.on('connected', connected);
    api.mount(config());
    await connect();

    expect(connected).toHaveBeenCalled();
  });
});
