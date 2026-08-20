// @vitest-environment jsdom
//
// Bug: the widget's recovery controls were dead in the state that matters.
//
// Both the Reconnect button and the `online` listener were gated on the
// connection being `suspended` or `closed`. `connecting` is neither — and
// `connecting` (cycling through `reconnecting` and back) is exactly where a
// client parks when the server is down or the network dropped. The customer
// got an indefinite "Connecting…" with no further signal, and two recovery
// affordances that silently did nothing.
//
// ── The ruling this file encodes ──────────────────────────────────────────
//
// While core is still working, "Reconnect" is DISABLED with honest copy — it
// never forces an attempt. Two independent reasons, both readable in
// connection/controller.ts:
//
//   1. It cannot work. `connect()` returns the in-flight promise whenever one
//      is pending, and that promise settles only on `connection.ack`,
//      `disconnect()`, or `#suspend` — never on a retryable close. In the
//      reported scenario (server down from the first load) it stays pending
//      for the entire retry loop, so every `connect()` opens no socket at all.
//      Enabling the button would turn a silent no-op into a loud one.
//
//   2. Where it could work, it would compete. After a successful connect and a
//      later drop the promise is settled, so `connect()` would cancel core's
//      armed backoff timer AND reset its attempt counter to zero. A customer
//      tapping the button would hold exponential backoff at attempt 0
//      indefinitely — the second retry mechanism this must not become.
//
// So the fix is the SIGNAL, not the button: the status line tells the truth in
// every state, and the button appears — visibly inert — only once something
// has demonstrably gone wrong, becoming pressable the moment core parks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

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
  /** The retryable kind of drop — what a server going away looks like. */
  drop(): void {
    this.onclose?.({ code: 1006, reason: '', wasClean: false });
  }
  ack(sessionId = 'sess_1'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
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

const statusText = (): string => query<HTMLElement>('.dh-status-text').textContent ?? '';
const reconnectControl = (): HTMLButtonElement => query<HTMLButtonElement>('.dh-reconnect');
const composerInput = (): HTMLTextAreaElement => query<HTMLTextAreaElement>('.dh-input');

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

/** The newest socket, which is the one core is currently attempting on. */
function latest(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

/**
 * Drops the live attempt `times` times, waiting after each drop until core's
 * backoff timer has actually opened the replacement socket.
 *
 * Waiting for the socket COUNT to grow, rather than advancing a fixed span, is
 * what keeps this deterministic: core's backoff is full-jitter so the delay is
 * unknown, and over-advancing would run past the replacement's own 10s connect
 * deadline and abandon it — leaving `latest()` pointing at a socket whose
 * callbacks core has already stopped listening to.
 */
async function failAttempts(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const before = FakeWebSocket.instances.length;
    latest().drop();
    await settle();
    for (let step = 0; step < 60 && FakeWebSocket.instances.length === before; step += 1) {
      await vi.advanceTimersByTimeAsync(250);
      await settle();
    }
  }
}

/**
 * Completes the attempt in flight, waiting out any pending backoff first.
 *
 * The wait is the load-bearing part. Immediately after a drop the state is
 * `reconnecting` — a timer is armed and no replacement socket exists yet — so
 * `latest()` still points at the socket core has already abandoned, and
 * open/ack on it does nothing at all.
 */
async function succeed(widget: ChatWidget, sessionId: string): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (widget.store.getState().connectionState !== 'reconnecting') break;
    await vi.advanceTimersByTimeAsync(250);
    await settle();
  }
  if (widget.store.getState().connectionState === 'reconnecting') {
    throw new Error('core never started the next attempt');
  }

  latest().open();
  latest().ack(sessionId);
  await settle();
}

async function connected(): Promise<ChatWidget> {
  const widget = mount(config());
  await settle();
  const socket = latest();
  socket.open();
  socket.ack();
  await settle();
  return widget;
}

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.instances = [];
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the status line tells the truth in every state', () => {
  it('says Connecting… only while the first attempt is genuinely in flight', async () => {
    mount(config());
    await settle();

    expect(statusText()).toBe('Connecting…');
    expect(reconnectControl().hidden).toBe(true);
  });

  it('says Online once connected', async () => {
    await connected();
    expect(statusText()).toBe('Online');
    expect(reconnectControl().hidden).toBe(true);
  });

  it('still says Reconnecting… for an ordinary blip', async () => {
    await connected();
    latest().drop();
    await settle();

    // One failure is a wifi blip and core fixes it in under a second. Escalated
    // copy and a visible control here would be noise on the commonest event
    // the transport has.
    expect(statusText()).toBe('Reconnecting…');
    expect(reconnectControl().hidden).toBe(true);
  });

  it('escalates once attempts keep failing — the indefinite Connecting… is the reported bug', async () => {
    await connected();
    await failAttempts(2);

    // The state is still `connecting`/`reconnecting`, but the copy no longer
    // pretends this is a first attempt going well.
    expect(statusText()).toBe('Can’t reach chat — still trying');
  });

  it('names the network when the browser says there is none', async () => {
    await connected();
    latest().drop();
    await settle();
    setOnline(false);
    await settle();

    // More specific than "still trying", and it names something the customer
    // can actually act on.
    expect(statusText()).toBe('No internet connection — we’ll reconnect when it’s back');
  });

  it('keeps naming the terminal states after the control that fixes them', async () => {
    const widget = await connected();
    widget.store.client.disconnect();
    await settle();

    expect(statusText()).toBe('Disconnected — use Reconnect to try again');
  });
});

describe('the Reconnect control while core is still working', () => {
  it('appears, visibly inert, once something has demonstrably gone wrong', async () => {
    await connected();
    await failAttempts(2);

    const control = reconnectControl();
    expect(control.hidden).toBe(false);
    // Disabled rather than absent: the customer can see that a recovery
    // control exists and that pressing it is not the missing step.
    expect(control.disabled).toBe(true);
  });

  it('opens no socket when pressed — it must not race core’s backoff', async () => {
    await connected();
    await failAttempts(2);

    const before = FakeWebSocket.instances.length;
    reconnectControl().click();
    await settle();

    // Forcing `connect()` here would cancel core's armed backoff timer and
    // reset its attempt counter to zero.
    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it('becomes pressable the moment core actually parks', async () => {
    const widget = await connected();
    await failAttempts(2);
    expect(reconnectControl().disabled).toBe(true);

    widget.store.client.disconnect();
    await settle();

    const control = reconnectControl();
    expect(control.hidden).toBe(false);
    expect(control.disabled).toBe(false);

    const before = FakeWebSocket.instances.length;
    control.click();
    await settle();
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });
});

describe('the online listener is no longer a silent no-op', () => {
  it('changes what the customer is told, in a state it used to ignore entirely', async () => {
    await connected();
    latest().drop();
    await settle();

    setOnline(false);
    await settle();
    const offlineLabel = statusText();
    expect(offlineLabel).toContain('No internet connection');

    setOnline(true);
    await settle();

    // The whole point: `online` did something observable while the connection
    // was mid-retry, which is the state the old gate excluded.
    expect(statusText()).not.toBe(offlineLabel);
  });

  it('does not start a competing attempt while core is mid-retry', async () => {
    await connected();
    await failAttempts(2);

    const before = FakeWebSocket.instances.length;
    setOnline(false);
    await settle();
    setOnline(true);
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it('still forces an attempt once core has parked', async () => {
    const widget = await connected();
    widget.store.client.disconnect();
    await settle();

    const before = FakeWebSocket.instances.length;
    setOnline(true);
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });
});

describe('the composer keeps its side of the bargain', () => {
  it('stays usable while offline — core queues sends durably', async () => {
    await connected();
    latest().drop();
    await settle();
    setOnline(false);
    await settle();

    // A customer in a lift must still be able to type their question.
    expect(composerInput().disabled).toBe(false);
  });

  it('says what will happen to what they type', async () => {
    await connected();
    const normal = composerInput().placeholder;

    latest().drop();
    await settle();
    setOnline(false);
    await settle();

    expect(composerInput().placeholder).not.toBe(normal);
    expect(composerInput().placeholder).toContain('when you’re back online');
  });

  it('puts the ordinary prompt back once connected', async () => {
    const widget = await connected();
    const normal = composerInput().placeholder;

    latest().drop();
    await settle();
    setOnline(false);
    await settle();
    setOnline(true);
    await settle();
    await succeed(widget, 'sess_2');

    expect(statusText()).toBe('Online');
    expect(composerInput().placeholder).toBe(normal);
  });
});

describe('recovering resets the escalation', () => {
  it('a later blip reads as a blip again, not as a continuing outage', async () => {
    const widget = await connected();
    await failAttempts(2);
    expect(statusText()).toBe('Can’t reach chat — still trying');

    await succeed(widget, 'sess_2');
    expect(statusText()).toBe('Online');

    latest().drop();
    await settle();
    expect(statusText()).toBe('Reconnecting…');
    expect(reconnectControl().hidden).toBe(true);
  });
});
