// @vitest-environment jsdom
//
// The "dead widget" dead end: the widget called `connect()` exactly once at
// mount (widget.ts) and never again, while disabling the composer on a
// terminal connection state — so once core stopped retrying, the customer was
// left with an inert panel and no way back.
//
// The important half of these tests is the negative one. Core retries ordinary
// transport drops indefinitely and auth failures up to a bounded budget, and a
// recovery affordance offered during either would race its backoff. So the
// widget must offer a way back in exactly the two states core parks in
// (`suspended`, `closed`) and stay out of the way everywhere else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
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

  /** An abnormal drop — the retryable kind core reconnects from on its own. */
  drop(): void {
    this.onclose?.({ code: 1006, reason: '', wasClean: false });
  }

  ack(sessionId = 'sess_1'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: ulid(),
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
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
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

const reconnectControl = (): HTMLButtonElement => query<HTMLButtonElement>('.dh-reconnect');
const statusText = (): string => query<HTMLElement>('.dh-status-text').textContent ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(): Promise<{ widget: ChatWidget; socket: FakeWebSocket }> {
  const widget = mount(config());
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack();
  await settle();
  return { widget, socket };
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
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

describe('recovering a connection core has stopped retrying', () => {
  it('stays out of the way while the connection is healthy', async () => {
    await connected();
    expect(reconnectControl().hidden).toBe(true);
    expect(statusText()).toBe('Online');
  });

  it('stays out of the way while core is still retrying on its own', async () => {
    const { socket } = await connected();

    // An abnormal drop is the retryable kind: core schedules its own jittered
    // retry and moves to `reconnecting`. A Reconnect button here would race
    // that backoff, which is the reconnect storm this must not cause.
    socket.drop();
    await settle();

    expect(statusText()).toBe('Reconnecting…');
    expect(reconnectControl().hidden).toBe(true);
  });

  it('offers a labelled, keyboard-reachable way back once core has parked', async () => {
    const { widget } = await connected();

    widget.store.client.disconnect();
    await settle();

    const control = reconnectControl();
    expect(control.hidden).toBe(false);
    expect(control.tagName).toBe('BUTTON');
    expect(control.type).toBe('button');
    expect(control.textContent).toBe('Reconnect');
    // The status must read as recoverable, not as a silent dead widget — and
    // must not promise an automatic recovery that will never come.
    expect(statusText()).toBe('Disconnected — use Reconnect to try again');
  });

  it('actually reconnects when the control is used', async () => {
    const { widget } = await connected();
    widget.store.client.disconnect();
    await settle();

    const before = FakeWebSocket.instances.length;
    reconnectControl().click();
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);

    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (next === undefined) throw new Error('no reconnect socket');
    next.open();
    next.ack('sess_2');
    await settle();

    expect(statusText()).toBe('Online');
    expect(reconnectControl().hidden).toBe(true);
  });

  it('retries automatically when the customer opens the panel', async () => {
    const { widget } = await connected();
    widget.close();
    widget.store.client.disconnect();
    await settle();

    const before = FakeWebSocket.instances.length;
    widget.open();
    await settle();

    // Opening the panel is the clearest statement of intent available, and it
    // is human-paced rather than timer-paced.
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('retries when the browser reports the network came back', async () => {
    const { widget } = await connected();
    widget.store.client.disconnect();
    await settle();

    const before = FakeWebSocket.instances.length;
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('ignores an online event while the connection is healthy', async () => {
    await connected();

    const before = FakeWebSocket.instances.length;
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it('rate-limits automatic retries that keep landing back in a terminal state', async () => {
    const { widget } = await connected();
    const client = widget.store.client;

    client.disconnect();
    await settle();

    const before = FakeWebSocket.instances.length;

    // First automatic attempt: allowed.
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(before + 1);

    // Force that attempt to fail immediately, putting us straight back into a
    // terminal state. Without the interval floor the next signal would start
    // another attempt at once, and this pair can repeat as fast as the signal
    // arrives — which is the loop the floor exists to break. (The terminal
    // guard alone does NOT cover this: it only filters while an attempt is
    // still in flight.)
    client.disconnect();
    await settle();

    window.dispatchEvent(new Event('online'));
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('stops listening for network events once destroyed', async () => {
    const { widget } = await connected();
    widget.store.client.disconnect();
    await settle();
    widget.destroy();

    const before = FakeWebSocket.instances.length;
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it('does not present a dropped connection as a resolved conversation', async () => {
    const { widget } = await connected();
    widget.store.client.disconnect();
    await settle();

    // A closed *session* is a normal, successful ending; a closed *connection*
    // is a fault. They live in different places and say different things —
    // collapsing them would tell a customer their chat was resolved because
    // their wifi dropped.
    expect(query<HTMLElement>('.dh-system').hidden).toBe(true);
    expect(reconnectControl().hidden).toBe(false);
  });
});
