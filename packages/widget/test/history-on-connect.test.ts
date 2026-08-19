// @vitest-environment jsdom
//
// Regression test for the "no history on load" symptom: the widget connects
// fine and can send/receive live messages, but `ChatState.messages` never
// gets seeded from `GET /chat/sessions/{id}/messages` because nothing ever
// calls `client.loadOlderMessages()`. The "Load older" button in
// ui/message-list.ts is wired to call it, but that button stays
// `hidden = !state.pagination.hasMore`, and `pagination.hasMore` starts
// `false` (state/types.ts) and is never flipped by anything else — so the
// one thing that could trigger the fetch is a control the user can never see
// or click. `MessageController.loadMore()` (core/src/messages/controller.ts)
// is explicitly written to special-case an empty message list past that
// guard, which is exactly what makes it safe to call unconditionally once,
// on connect — this test proves the widget actually does that now.
//
// Uses a hand-driven fake WebSocket (mirroring
// `@dhaam-ccrm/core`'s transport/stub-socket.ts, which is not part of this
// package's dependency graph) to walk the connection through the real
// `connection.hello` -> `connection.ack` handshake, then asserts the widget
// requests message history over REST exactly once the connection reaches
// `connected`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';
const SESSION_ID = 'sess_1';

/** A hand-driven stand-in for the browser `WebSocket` global — see socket.ts:
 *  the transport only ever touches `send`/`close`/`on*` properties. */
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

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw));
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/chat-token')) {
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes(`/chat/sessions/${SESSION_ID}/messages`)) {
      return new Response(
        JSON.stringify({ success: true, data: { messages: [], hasMore: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);

  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('history on connect', () => {
  it('requests message history exactly once the connection reaches "connected"', async () => {
    mount(config());

    // Let connect()'s token fetch and the WebSocket construction settle —
    // a real `fetch()` round trip through jsdom needs a macrotask, not just
    // a couple of microtask hops.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    // Transport writes `connection.hello` synchronously from `onopen`.
    socket!.onopen?.();
    const hello = socket!.sentFrames().find((f) => f['t'] === 'connection.hello');
    expect(hello).toBeDefined();

    // Server answers with `connection.ack` — the real shape core's validator
    // requires (protocol/validate.ts's validateConnectionAck).
    socket!.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: Date.now(),
        d: {
          protocolVersion: 1,
          seq: 0,
          session: {
            sessionId: SESSION_ID,
            status: 'OPEN',
            mode: 'BOT',
            participants: [],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    });

    // Let the connection-state transition and the widget's `connected`
    // handler (which calls `loadOlderMessages()`) run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const historyCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/chat/sessions/${SESSION_ID}/messages`),
    );
    expect(historyCalls).toHaveLength(1);
  });
});
