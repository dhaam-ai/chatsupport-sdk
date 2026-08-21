// @vitest-environment jsdom
//
// The dead click.
//
// `selectSession` waits behind `whenHistorySettles()` before it switches, and
// that wait resolves on a `pagination` transition. `pagination` only ever
// moves because a connection reached `connected` and core seeded page one of
// the transcript — so on a socket that never gets there (a connect that keeps
// failing, a client core has `suspended` on purpose) there is no transition to
// wait for. Unbounded, the wait never settles: the row the customer pressed
// navigates nowhere, reports nothing, and leaves one live store subscription
// behind per press on a widget that lives as long as the tab does.
//
// What is asserted here is the promise the widget owes a customer who clicks
// something: within a bounded time, EITHER the thing happens or somebody is
// told it did not. Never silence.
//
// The socket is deliberately never opened and never acked, which is the
// cheapest honest way to hold `connectionState` off `connected` for the whole
// test — the same shape as a connect that permanently fails. Everything the
// picker itself needs is REST and lands regardless.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';
const PAST = 'sess_past';

/**
 * How long the test is willing to wait for the widget to say something.
 *
 * Deliberately NOT imported from widget.ts. The assertion is about what a
 * customer is owed, not about the number the source happens to hold, and a
 * deadline longer than this would be no better than the unbounded wait it
 * replaced — the customer has given up on the click well before ten seconds.
 * Core's own `SESSION_SNAPSHOT_TIMEOUT_MS` is 10s, so the widget's wait in
 * front of it has to be under that too.
 */
const PATIENCE_MS = 10_000;

/** A hand-driven stand-in for the browser `WebSocket` global (see socket.ts). */
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
}

function summaryRow(id: string): Record<string, unknown> {
  return {
    id,
    status: 'RESOLVED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: '2026-08-19T10:00:00.000Z',
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'Thanks!',
    unreadCount: 0,
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

/**
 * Drains microtasks and any timer already due.
 *
 * `advanceTimersByTimeAsync` awaits between callbacks, so a handful of passes
 * carries a `fetch` -> `json()` -> `setState` chain all the way through
 * without letting the clock run far enough to trip the deadline under test.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(1);
}

/** Mounts and opens the panel WITHOUT ever letting the socket connect. */
async function bootUnconnected(overrides: Partial<WidgetConfig> = {}): Promise<ChatWidget> {
  const widget = mount(config(overrides));
  await settle();
  widget.open();
  await settle();
  return widget;
}

const pickRow = (): HTMLButtonElement => {
  const row = query('.dh-prechat').querySelector<HTMLButtonElement>('.dh-session-row');
  if (row === null) throw new Error('no past-session row rendered');
  return row;
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  localStorage.clear();
  vi.useFakeTimers();
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
        return new Response(
          JSON.stringify({ success: true, data: { sessions: [summaryRow(PAST)] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('a picker click on a connection that never comes up', () => {
  it('says something within the deadline instead of dying silently', async () => {
    const errors: unknown[] = [];
    const widget = await bootUnconnected({ onError: (error) => errors.push(error) });

    // The premise: nothing has connected, so nothing will ever move
    // `pagination` and the wait has no transition coming.
    expect(widget.store.getState().connectionState).not.toBe('connected');
    expect(widget.store.getState().pagination.initialLoaded).toBe(false);
    errors.length = 0;

    pickRow().click();
    await settle();

    // Still quiet a moment after the press — the widget is allowed to wait.
    expect(errors).toEqual([]);

    await vi.advanceTimersByTimeAsync(PATIENCE_MS);
    await settle();

    // …but not forever. This is the whole bug: without a deadline the click
    // reports nothing, now or ever.
    expect(errors.length).toBeGreaterThan(0);
  });

  it('goes ahead with the switch once the deadline passes', async () => {
    const widget = await bootUnconnected();

    pickRow().click();
    await settle();
    expect(widget.store.getState().lastError).toBeNull();

    await vi.advanceTimersByTimeAsync(PATIENCE_MS);
    await settle();

    // Proof the switch actually reached core rather than being abandoned in
    // the widget.
    //
    // This used to look for core's `'socket is not open'` in `lastError`,
    // because `switchSession` wrote `session.join` onto whatever socket it had
    // and reported the failure when that socket was closed. It no longer has
    // that failure mode: `switchSession` is a teardown and a re-establish, so
    // a connection that is not up is something it OPENS rather than something
    // it complains about — a strictly better outcome for this exact scenario,
    // a customer clicking a row on a connection that never came up.
    //
    // The observable that still proves the same thing, and proves it more
    // directly, is that second socket: only core's own teardown drops the
    // widget's connection and asks for another one.
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    // ...and nothing was reported as a failure, because nothing failed.
    expect(widget.store.getState().lastError).toBeNull();
  });

  it('leaves the customer on the conversation pane, not the chooser', async () => {
    await bootUnconnected();

    pickRow().click();
    await vi.advanceTimersByTimeAsync(PATIENCE_MS);
    await settle();

    expect(query<HTMLElement>('.dh-prechat').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });
});

describe('teardown while a switch is waiting', () => {
  // Guards the deadline added above rather than the original defect: the
  // unbounded version fired nothing at all, so it could not report after
  // teardown either. A timer that outlives `destroy()` would push errors at a
  // host that removed the widget — and would keep the wait, its subscription
  // and the whole `selectSession` frame alive with it.
  it('settles the wait without reporting at a widget that is gone', async () => {
    const errors: unknown[] = [];
    const widget = await bootUnconnected({ onError: (error) => errors.push(error) });

    pickRow().click();
    await settle();
    errors.length = 0;

    widget.destroy();
    await vi.advanceTimersByTimeAsync(PATIENCE_MS);
    await settle();

    // Filtered rather than asserted empty: tearing the widget down aborts the
    // in-flight `connect()`, and reporting THAT is `createWidget`'s existing
    // and correct behaviour. What must not appear is the history wait's own
    // timeout, fired at a widget that no longer exists.
    const fromTheWait = errors.filter(
      (error) => error instanceof Error && error.message.includes('waited'),
    );
    expect(fromTheWait).toEqual([]);
  });

  it('does not switch a session out from under a destroyed widget', async () => {
    const widget = await bootUnconnected();

    pickRow().click();
    await settle();
    widget.destroy();

    await vi.advanceTimersByTimeAsync(PATIENCE_MS);
    await settle();

    // `destroy()` is documented as removing every listener and the socket. A
    // join written after it would be a frame nobody asked for on a socket
    // nobody owns.
    const socket = FakeWebSocket.instances[0];
    const joins = (socket?.sent ?? [])
      .map((raw) => JSON.parse(raw) as { t: string })
      .filter((frame) => frame.t === 'session.join');
    expect(joins).toEqual([]);
  });
});
