// @vitest-environment jsdom
//
// Where the visitor is (chatbot-workflows.md §9.2-9.3, §11.1), end to end
// through a mounted widget: what the hello carries, and what `setPage` sends.
// Fixtures are the ones remote-config-gating.test.ts uses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

/**
 * A socket that finishes the handshake and answers with one live, EMPTY
 * session — which is what chat-service's own `handleHello` does for EVERY
 * visitor, first-timers included: it mints or resumes a row and acks with it.
 *
 * `SilentSocket` above is right for everything in this file that only cares
 * what published config paints — but the pre-chat gate stands in front of a
 * conversation the customer has OPENED (see `syncProductSurfaces`), and
 * proving either half of that takes a real ack. Only the frames that
 * precondition needs are modelled here; pre-chat-preemption.test.ts owns the
 * full-fidelity fake for everything past it.
 */
class AckingSocket {
  static instances: AckingSocket[] = [];
  static readonly CONNECTING = 0;
  readonly readyState = 1;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    AckingSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }

  /** Opens, then answers the hello with a live session carrying no messages. */
  ack(sessionId: string): void {
    this.onopen?.();
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: Date.now(),
        d: {
          protocolVersion: 1,
          seq: 0,
          session: {
            sessionId,
            status: 'ASSIGNED',
            mode: 'HUMAN',
            participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    });
  }
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    // connect() rejects by design in this environment; a wall of expected
    // failures would hide a real one.
    onError: () => undefined,
    ...overrides,
  };
}

/** The published-config body, with only what a test cares about overridden. */
function published(data: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {},
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
      ...data,
    },
  };
}

/**
 * Serves the token mint and the config endpoint, and nothing else.
 *
 * Routed on the path rather than call order: the widget fires both during
 * mount and the order between them is not part of any contract this file
 * should be pinning.
 */
function stubFetch(configBody: unknown, { failConfig = false } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/widget/config')) {
        if (failConfig) {
          // Exactly what a blocked cross-origin read looks like from JS: a
          // bare TypeError with no detail. See WIDGET_ALLOWED_ORIGINS.
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/customer')) {
        return new Response(JSON.stringify({ success: true, data: { sessions: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/')) {
        // Every history page: empty, which is the gate's own precondition.
        return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
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

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);

/** Lets the config fetch and its promise chain land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  AckingSocket.instances = [];
  vi.stubGlobal('WebSocket', SilentSocket);
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

type Frame = { t: string; d: Record<string, unknown> };

const frames = (type: string): Frame[] =>
  AckingSocket.instances.flatMap((socket) => socket.sent.map((raw) => JSON.parse(raw) as Frame)).filter((f) => f.t === type);

async function mountAndConnect(overrides: Partial<WidgetConfig> = {}) {
  stubFetch(published());
  vi.stubGlobal('WebSocket', AckingSocket);
  const widget = mount(config(overrides));
  await settle();
  AckingSocket.instances[0]!.ack('sess_live');
  await settle();
  return widget;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the hello carries where the visitor is', () => {
  it('sends the page the host configured', async () => {
    await mountAndConnect({ page: { label: 'Checkout', url: '/checkout' } });
    expect(frames('connection.hello')[0]?.d['context']).toEqual({ label: 'checkout', url: '/checkout' });
  });

  it('sends only the URL when the host set nothing', async () => {
    await mountAndConnect();
    expect(frames('connection.hello')[0]?.d['context']).toEqual({ url: window.location.href });
  });
});

describe('setPage', () => {
  it('sends one context.update for a new page, filling in the URL the host left out', async () => {
    const widget = await mountAndConnect({ page: { label: 'cart' } });
    widget.setPage({ label: 'payment' });
    await pause(700);

    const updates = frames('context.update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.d).toEqual({ label: 'payment', url: window.location.href });
  });

  it('does not repeat an update for the page it already sent', async () => {
    const widget = await mountAndConnect({ page: { label: 'cart' } });
    widget.setPage({ label: 'payment' });
    await pause(700);
    widget.setPage({ label: 'payment' });
    await pause(700);
    expect(frames('context.update')).toHaveLength(1);
  });

  it('never throws on a value the host got wrong', async () => {
    const widget = await mountAndConnect();
    expect(() => widget.setPage(null as never)).not.toThrow();
    expect(() => widget.setPage('checkout' as never)).not.toThrow();
    await pause(700);
    expect(frames('context.update')).toEqual([]);
  });
});
