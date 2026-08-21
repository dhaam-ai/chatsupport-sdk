// @vitest-environment jsdom
//
// The two symptoms a customer actually reported, asserted on the DOM the
// customer actually looks at:
//
//   1. "click on prev session — it does not load the session messages"
//   2. "reload the app — it does not load messages of the current session"
//
// Both were one defect: the widget had no idea which conversation the customer
// had CHOSEN. Picking a row sent `session.join` and revealed the conversation
// pane, but nothing cleared the rendered transcript and nothing fetched the
// new session's history — so the header moved to the new conversation while
// the old conversation's bubbles stayed on screen underneath it. And nothing
// remembered the choice across a reload, so the next page load took whatever
// session `connection.ack` happened to name.
//
// Core owns the repair (per-session reset, join, snapshot wait, seed, and a
// durable record of the choice). What this file proves is the part that is
// this package's job: that the widget routes the picker into that operation,
// that the rendered `.dh-msg` rows really do swap, and that the widget hands
// core a storage adapter that survives a reload — with `MemoryStorageAdapter`
// (core's default) the second test below cannot pass, because there is nothing
// left to read after the tab is closed.
//
// Driven through the real socket handshake with a hand-rolled fake, exactly as
// history-on-connect.test.ts and session-picker-mount.test.ts do: the ordering
// between the join ack, the `session.updated` snapshot and the history fetch
// is the whole subject, so a mocked `switchSession` would assert nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

const CURRENT = 'sess_current';
const PAST = 'sess_past';

/** What each session's history endpoint answers with, keyed by session id. */
const TRANSCRIPT: Record<string, string> = {
  [CURRENT]: 'the conversation I am in',
  [PAST]: 'the conversation I had last week',
};

let frameCounter = 0;
const frameId = (): string => `01ARZ3NDEKTSV4RRFFQ69G5F${String(frameCounter++ % 10)}0`;

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

  /** `{ ok: true }` — `session.join`'s ack is `EmptyAckData` and carries no snapshot. */
  ackFrame(ref: string): void {
    this.onmessage?.({
      data: JSON.stringify({ v: 1, t: 'ack', id: frameId(), ref, ts: Date.now(), d: { ok: true } }),
    });
  }

  ack(sessionId = CURRENT, status = 'ASSIGNED'): void {
    this.push('connection.ack', { protocolVersion: 1, seq: 0, session: snapshot(sessionId, status) });
  }
}

function snapshot(sessionId: string, status = 'ASSIGNED'): Record<string, unknown> {
  return {
    sessionId,
    status,
    mode: 'HUMAN',
    participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
    createdAt: '2026-08-19T09:00:00.000Z',
  };
}

/** A raw Prisma history row — integer enums, `chatSessionId` (see rest/projection.ts). */
function historyRow(sessionId: string): Record<string, unknown> {
  return {
    id: `msg_${sessionId}`,
    chatSessionId: sessionId,
    senderId: 'cus_1',
    senderType: 1,
    messageType: 1,
    content: TRANSCRIPT[sessionId] ?? 'unknown session',
    createdAt: '2026-08-19T09:30:00.000Z',
    seq: 1,
  };
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
let historyCalls: string[] = [];

/**
 * Parks the NEXT history response until `releaseHistory()` is called, so a
 * test can decide where core's connect-time page-one load lands relative to a
 * switch. Real networks make that choice for us and make it differently every
 * time; this is the only way to pin one ordering down.
 */
let holdNextHistory = false;
let releaseHistory: () => void = () => undefined;

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

/** What the customer can actually read in the transcript. */
const transcript = (): string[] =>
  [...query('.dh-log').querySelectorAll('.dh-msg-body')].map((node) => node.textContent ?? '');

const pickerRows = (root: ParentNode): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('.dh-session-row'),
];

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Sockets whose `connection.hello` has already been answered. */
let handshaked = new WeakSet<FakeWebSocket>();

/**
 * Completes the handshake on every socket the client has opened but nobody has
 * driven yet, and returns the newest one.
 *
 * `switchSession()` is a TEARDOWN and a re-establish (see `switchToSession` in
 * core's create-chat-client.ts), so picking a row drops the socket the widget
 * booted on and opens another. The ack deliberately names `resolved` — the
 * session the SERVER resolves for a hello, which carries no session id — which
 * is exactly why an explicit `session.join` follows it.
 */
async function driveHandshakes(resolved = CURRENT): Promise<FakeWebSocket> {
  for (const instance of FakeWebSocket.instances) {
    if (handshaked.has(instance)) continue;
    handshaked.add(instance);
    instance.open();
    instance.ack(resolved);
    await settle();
  }
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

/** Mounts, walks the handshake, and opens the panel. */
async function boot(
  overrides: Partial<WidgetConfig> = {},
  ackSession = CURRENT,
): Promise<{ socket: FakeWebSocket }> {
  const widget = mount(config(overrides));
  await settle();
  const socket = await driveHandshakes(ackSession);
  widget.open();
  await settle();
  return { socket };
}

/**
 * Answers the join the way the server does: the handshake on whatever socket
 * the switch opened, then the ack (which proves nothing about state), then the
 * `session.updated` snapshot the server volunteers afterwards
 * (v2/handlers.ts) — which is what core actually waits on.
 *
 * Resolves with the socket it answered on, which is not necessarily the one
 * passed in: a switch tears the old connection down.
 */
async function serverAcceptsJoin(_socket: FakeWebSocket, sessionId: string): Promise<FakeWebSocket> {
  const socket = await driveHandshakes();
  const joins = socket.frames('session.join');
  const join = joins[joins.length - 1];
  if (join === undefined) throw new Error('no session.join frame was sent');
  expect(join.d['sessionId']).toBe(sessionId);
  socket.ackFrame(join.id);
  await settle();
  socket.push('session.updated', { session: snapshot(sessionId, 'WAITING_FOR_AGENT') });
  await settle();
  return socket;
}

beforeEach(() => {
  frameCounter = 0;
  sessionRows = [];
  historyCalls = [];
  holdNextHistory = false;
  releaseHistory = () => undefined;
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
      const history = /\/chat\/sessions\/([^/?]+)\/messages/.exec(url);
      if (history !== null) {
        const sessionId = decodeURIComponent(history[1] ?? '');
        historyCalls.push(sessionId);
        if (holdNextHistory) {
          holdNextHistory = false;
          await new Promise<void>((resolve) => {
            releaseHistory = resolve;
          });
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: { messages: [historyRow(sessionId)], hasMore: false },
          }),
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
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('bug 1 — picking a previous session', () => {
  it('replaces the rendered transcript with THAT session’s messages', async () => {
    sessionRows = [summaryRow(PAST), summaryRow(CURRENT, { status: 'ASSIGNED', closedAt: null })];
    const { socket } = await boot();

    // Where the customer starts: the conversation the ack named.
    expect(transcript()).toEqual([TRANSCRIPT[CURRENT]]);

    const row = pickerRows(query('.dh-prechat')).find(
      (candidate) => candidate.closest('.dh-session-item')?.getAttribute('data-status') === 'RESOLVED',
    );
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();

    await serverAcceptsJoin(socket, PAST);

    // The reported symptom, inverted: the OLD session's bubble is gone and the
    // chosen session's is on screen.
    expect(transcript()).toEqual([TRANSCRIPT[PAST]]);
    expect(historyCalls).toContain(PAST);
  });

  it('fetches page one for the chosen session, with no cursor from the old one', async () => {
    sessionRows = [summaryRow(PAST)];
    const { socket } = await boot();
    historyCalls = [];

    const row = pickerRows(query('.dh-prechat'))[0];
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();
    await serverAcceptsJoin(socket, PAST);

    // Exactly one fetch, for the new session. A `before` cursor here would be
    // the OLD session's oldest message id — a cursor that does not exist in
    // the session being read.
    expect(historyCalls).toEqual([PAST]);
    const fetched = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes(`/chat/sessions/${PAST}/messages`));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).not.toContain('before=');
  });

  it('still swaps the transcript when page one lands mid-switch', async () => {
    // The window that makes this bug intermittent rather than constant: core
    // seeds page one of the ack's session on `connected`, and its answer can
    // arrive at any point — including in the middle of the join round trip a
    // click has already started. `MessageController.loadMore` refuses to run
    // once a page has landed (`initialLoaded && !hasMore`), so a switch that
    // overlaps the seed fetches nothing and the customer is left reading the
    // conversation they just navigated away from.
    holdNextHistory = true;
    sessionRows = [summaryRow(PAST)];
    const { socket } = await boot();

    const row = pickerRows(query('.dh-prechat'))[0];
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();

    // The seed answers now, mid-click.
    releaseHistory();
    await settle();

    await serverAcceptsJoin(socket, PAST);

    expect(transcript()).toEqual([TRANSCRIPT[PAST]]);
  });

  it('puts the conversation pane back on screen straight away', async () => {
    sessionRows = [summaryRow(PAST)];
    const { socket } = await boot();

    const row = pickerRows(query('.dh-prechat'))[0];
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();

    // Before the round trip finishes: the chooser must not sit there looking
    // like a dead click while the switch is in flight.
    expect(query<HTMLElement>('.dh-prechat').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);

    await serverAcceptsJoin(socket, PAST);
    expect(query<HTMLElement>('.dh-log').hidden).toBe(false);
  });

  it('reports a refused switch instead of leaking an unhandled rejection', async () => {
    const errors: unknown[] = [];
    sessionRows = [summaryRow(PAST)];
    const { socket } = await boot({ onError: (error) => errors.push(error) });
    errors.length = 0;

    const row = pickerRows(query('.dh-prechat'))[0];
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();

    const live = await driveHandshakes();
    const joins = live.frames('session.join');
    const join = joins[joins.length - 1];
    if (join === undefined) throw new Error('no session.join frame was sent');
    live.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'ack',
        id: frameId(),
        ref: join.id,
        ts: Date.now(),
        d: { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'not yours', retryable: false } },
      }),
    });
    await settle();

    expect(errors.length).toBeGreaterThan(0);
    // And the customer is not left staring at a blank pane for the session
    // they never actually left.
    expect(transcript()).toEqual([TRANSCRIPT[CURRENT]]);
  });
});

describe('bug 2 — coming back to the page', () => {
  it('renders the current session’s transcript on a plain load', async () => {
    await boot();

    expect(transcript()).toEqual([TRANSCRIPT[CURRENT]]);
    expect(historyCalls).toEqual([CURRENT]);
  });

  it('comes back to the conversation the customer chose, not the one the ack named', async () => {
    sessionRows = [summaryRow(PAST), summaryRow(CURRENT, { status: 'ASSIGNED', closedAt: null })];
    const first = await boot();

    const row = pickerRows(query('.dh-prechat')).find(
      (candidate) => candidate.closest('.dh-session-item')?.getAttribute('data-status') === 'RESOLVED',
    );
    if (row === undefined) throw new Error('no past-session row rendered');
    row.click();
    await settle();
    await serverAcceptsJoin(first.socket, PAST);
    expect(transcript()).toEqual([TRANSCRIPT[PAST]]);

    // ── the reload ──
    // Everything in memory goes; only what reached `localStorage` survives.
    unmount();
    document.body.innerHTML = '';
    historyCalls = [];

    // The server still resolves the customer to whatever session is ACTIVE —
    // it has no idea which one they were reading, and the hello frame has no
    // field to tell it.
    const second = await boot({}, CURRENT);
    await serverAcceptsJoin(second.socket, PAST);

    expect(transcript()).toEqual([TRANSCRIPT[PAST]]);
    expect(historyCalls).toContain(PAST);
  });
});

describe('a host that named the session it wants', () => {
  it('opens that conversation once the socket is up, rather than racing the connect', async () => {
    const { socket } = await boot({ sessionId: PAST });

    await serverAcceptsJoin(socket, PAST);

    expect(transcript()).toEqual([TRANSCRIPT[PAST]]);
  });

  it('sends no join at all when the ack already put us there', async () => {
    const { socket } = await boot({ sessionId: CURRENT });

    expect(socket.frames('session.join')).toHaveLength(0);
    expect(transcript()).toEqual([TRANSCRIPT[CURRENT]]);
  });
});
