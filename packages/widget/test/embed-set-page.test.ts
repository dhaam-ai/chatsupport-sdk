// @vitest-environment jsdom
//
// `DhaamChat.setPage(...)` — the script-tag form of "where the visitor is".
// Like `DhaamChat.on`, it must work when called BEFORE the widget exists: a tag
// mounts on DOMContentLoaded, and the obvious host code (our tag, then an
// inline script that names the page) runs first.

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

const helloContext = (): Record<string, unknown> | undefined => {
  for (const socket of FakeWebSocket.instances) {
    for (const raw of socket.sent) {
      const frame = JSON.parse(raw) as { t: string; d: Record<string, unknown> };
      if (frame.t === 'connection.hello') return frame.d['context'] as Record<string, unknown> | undefined;
    }
  }
  return undefined;
};

describe('DhaamChat.setPage', () => {
  it('is installed on the global', async () => {
    const api = await loadEmbed();
    expect(typeof api.setPage).toBe('function');
  });

  it('is honoured when called BEFORE anything is mounted', async () => {
    const api = await loadEmbed();
    api.setPage({ label: 'checkout' });
    api.mount(config());
    await connect();
    expect(helloContext()).toMatchObject({ label: 'checkout' });
  });

  it('the latest value wins when called several times before mount', async () => {
    const api = await loadEmbed();
    api.setPage({ label: 'cart' });
    api.setPage({ label: 'checkout' });
    api.mount(config());
    await connect();
    expect(helloContext()).toMatchObject({ label: 'checkout' });
  });

  it('does not override the page the host put in mount()', async () => {
    const api = await loadEmbed();
    api.mount({ ...config(), page: { label: 'home' } });
    await connect();
    expect(helloContext()).toMatchObject({ label: 'home' });
  });

  it('passes through to the widget once it exists, and never throws with nothing mounted', async () => {
    const api = await loadEmbed();
    expect(() => api.setPage({ label: 'cart' })).not.toThrow();
    api.destroy();
    expect(() => api.setPage({ label: 'cart' })).not.toThrow();
  });
});
