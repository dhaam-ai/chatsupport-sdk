// @vitest-environment jsdom
//
// The offline bar, end to end through the real widget: it appears when the
// network goes, it names what is being held, the composer stays usable
// underneath it, and the held messages go out by themselves when the network
// comes back.
//
// ── What this file is actually pinning ────────────────────────────────────
//
// connecting-state.test.ts already established that the widget must not run a
// retry loop of its own — `connect()` either no-ops (its promise is still
// pending) or resets core's backoff to attempt 0, and a button wired to it was
// therefore either silent or harmful. That ruling stands and is not revisited
// here.
//
// What was still missing after it was the OTHER direction. Core retries
// correctly and indefinitely (§8.2), but its full-jitter delay climbs to a
// 30-second cap — the right behaviour for a restarting server with a thousand
// clients on it, and the wrong one for one phone coming out of a tunnel. The
// customer's signal returns and, for up to half a minute, nothing happens.
//
// So two things are pinned below and neither is a second retry loop:
//
//   `retryNow()` — new in core — abandons an armed backoff and attempts now.
//   It acts ONLY in `reconnecting` (no socket open, a timer counting down), so
//   it can never supersede a live attempt or race the state machine. The
//   window `online` event drives it, and a 3-second cadence caps any armed
//   delay at three seconds.
//
//   The bar itself, which says the thing the status line could not: not that
//   the connection is down, but that what you have typed is safe.

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
  /** The retryable kind of drop — what losing signal looks like. */
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
  /** Acks whatever `message.send` this socket last received. */
  ackLastSend(seq = 1): void {
    const frames = this.sent.map((raw) => JSON.parse(raw) as { t: string; id: string });
    const send = [...frames].reverse().find((frame) => frame.t === 'message.send');
    if (send === undefined) throw new Error('no message.send was written to this socket');
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'ack',
        id: `01ARZ3NDEKTSV4RRFFQ69G5FB${seq}`,
        ref: send.id,
        ts: Date.now(),
        // `ok: true` is not optional garnish — the ack envelope is a
        // discriminated union on it, so an ack without it is a malformed frame
        // the transport drops, and the queue then never releases the next
        // entry.
        d: { ok: true, seq },
      }),
    });
  }
  /** Every `message.send` this socket received. */
  get sends(): Array<{ t: string; d: { content?: string } }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { t: string; d: { content?: string } })
      .filter((frame) => frame.t === 'message.send');
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

const banner = (): HTMLElement => {
  const found = shadow().querySelector<HTMLElement>('.dh-offline-banner');
  if (found === null) throw new Error('the offline banner is not in the tree at all');
  return found;
};

const bannerText = (): string =>
  banner().hidden ? '' : (banner().querySelector('.dh-offline-text')?.textContent ?? '');

const composerInput = (): HTMLTextAreaElement => {
  const found = shadow().querySelector<HTMLTextAreaElement>('.dh-input');
  if (found === null) throw new Error('not found: .dh-input');
  return found;
};

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits for a rendered value to become what it should. See connecting-state.test.ts. */
async function waitForText(read: () => string, expected: string): Promise<string> {
  for (let step = 0; step < 40 && read() !== expected; step += 1) await settle();
  return read();
}

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

function latest(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

/** See connecting-state.test.ts — waits on the socket COUNT, never a fixed span. */
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

async function connected(): Promise<ChatWidget> {
  const widget = mount(config());
  await settle();
  latest().open();
  latest().ack();
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
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('the offline banner', () => {
  it('is not shown on a healthy connection', async () => {
    await connected();
    expect(banner().hidden).toBe(true);
  });

  it('appears the moment the browser says the network is gone', async () => {
    await connected();

    // Note the socket is still nominally OPEN here, and the bar still shows.
    // That is deliberate: a route that has gone leaves a half-open socket
    // reporting itself connected for tens of seconds on mobile, and the
    // customer is typing into it the whole time. See `resolveOfflineBanner`.
    setOnline(false);
    await settle();

    expect(banner().hidden).toBe(false);
    expect(bannerText()).toBe('You’re offline. Messages will send when you’re back online.');
    expect(banner().getAttribute('data-tone')).toBe('offline');
  });

  it('does not flash for a single blip while the network is fine', async () => {
    await connected();

    // One failure is a wifi handover or a recycled proxy socket, and core is
    // usually back inside a second. A bar for that teaches people to ignore
    // the bar.
    await failAttempts(1);
    expect(banner().hidden).toBe(true);
  });

  it('switches to the "cannot reach us" tone once the outage is real', async () => {
    await connected();

    await failAttempts(2);
    await settle();

    expect(banner().hidden).toBe(false);
    expect(banner().getAttribute('data-tone')).toBe('unreachable');
    expect(bannerText()).toBe('Can’t reach chat — still trying.');
  });

  it('prefers "you are offline" over "we are unreachable" — it is the reason', async () => {
    await connected();
    await failAttempts(2);
    setOnline(false);
    await settle();

    expect(banner().getAttribute('data-tone')).toBe('offline');
  });

  it('is announced politely rather than as an alert', async () => {
    // An alert interrupts a screen reader mid-message. Losing wifi does not
    // earn that.
    await connected();
    expect(banner().getAttribute('role')).toBe('status');
    expect(banner().getAttribute('aria-live')).toBe('polite');
  });
});

describe('what the customer types while offline', () => {
  it('leaves the composer usable, and the banner counts what is being held', async () => {
    const widget = await connected();
    latest().drop();
    setOnline(false);
    await settle();

    // The promise the bar makes is only worth making if the composer is still
    // usable underneath it. This is the assertion that makes the copy honest.
    expect(composerInput().disabled).toBe(false);

    await widget.store.client.sendMessage('my order is running really late');
    await settle();

    expect(await waitForText(bannerText, 'You’re offline. 1 message will send when you’re back online.')).toBe(
      'You’re offline. 1 message will send when you’re back online.',
    );

    await widget.store.client.sendMessage('are you there?');
    await settle();

    expect(await waitForText(bannerText, 'You’re offline. 2 messages will send when you’re back online.')).toBe(
      'You’re offline. 2 messages will send when you’re back online.',
    );
  });

  it('sends everything held, in order, once the network comes back', async () => {
    const widget = await connected();
    const socketsBefore = FakeWebSocket.instances.length;

    latest().drop();
    setOnline(false);
    await settle();

    await widget.store.client.sendMessage('first');
    await widget.store.client.sendMessage('second');
    await settle();

    // Coming back online must not wait out the armed backoff — that wait is
    // exactly the reported "it just says Connecting…".
    setOnline(true);
    await settle();
    expect(FakeWebSocket.instances.length).toBeGreaterThan(socketsBefore);

    const socket = latest();
    socket.open();
    socket.ack();
    await settle();

    // ONE at a time, in order. The queue holds a single in-flight send per
    // session on purpose (§9.2): FIFO is a claim about ARRIVAL order, and two
    // concurrent sends can arrive in either order regardless of which was
    // written first. So the second only reaches the wire once the first is
    // acked.
    expect(socket.sends.map((frame) => frame.d.content)).toEqual(['first']);

    socket.ackLastSend(1);
    await settle();
    for (let step = 0; step < 40 && socket.sends.length < 2; step += 1) await settle();

    // No duplicate of either: the queue replays each envelope under the id it
    // was minted with (§9.3), so the entries never left the queue to be
    // re-minted.
    expect(socket.sends.map((frame) => frame.d.content)).toEqual(['first', 'second']);

    socket.ackLastSend(2);
    await settle();

    // And the bar goes as soon as the connection is back.
    expect(await waitForText(bannerText, '')).toBe('');
    expect(banner().hidden).toBe(true);
  });
});

describe('the reconnect cadence', () => {
  it('retries immediately when the network returns, without waiting out the backoff', async () => {
    await connected();

    // Climb the backoff curve far enough that core's own timer is nowhere
    // near due.
    await failAttempts(4);
    latest().drop();
    setOnline(false);
    await settle();

    const before = FakeWebSocket.instances.length;
    setOnline(true);
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('caps an armed backoff at three seconds', async () => {
    // Full jitter pinned to its ceiling, so the armed delay is a known number
    // rather than a draw — otherwise "core's timer did not fire first" is a
    // probability, not an assertion. Only the reconnect loop runs inside this
    // window, so no message id depends on the pinned value.
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const widget = await connected();
    const delays: number[] = [];
    widget.store.on('reconnecting', ({ delayMs }) => delays.push(delayMs));

    // 500, 1000, 2000 — then the fourth is 4000, the first delay longer than
    // the cadence.
    await failAttempts(3);
    latest().drop();
    await settle();

    // The armed delay is the proof: core's own timer cannot fire before 4000,
    // so an attempt that starts inside a 3-second advance is the cadence's.
    expect(delays[delays.length - 1]).toBe(4000);
    const before = FakeWebSocket.instances.length;

    // One advance, with nothing awaited inside it. `shouldAdvanceTime: true`
    // also moves the fake clock by real elapsed ms, so a split advance with a
    // `settle()` between the halves would drift past 4000 and stop proving
    // which timer fired.
    await vi.advanceTimersByTimeAsync(3_050);
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('does nothing at all while the connection is healthy', async () => {
    await connected();
    const before = FakeWebSocket.instances.length;

    // Twenty seconds: six times the cadence, and still short of core's own
    // 25-second heartbeat — which this fake socket never acks, so anything
    // beyond it would be measuring the keepalive rather than the cadence.
    // The cadence is armed only while a backoff is counting down, so a
    // connected widget has no periodic work at all here.
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();

    expect(FakeWebSocket.instances.length).toBe(before);
  });
});
