// @vitest-environment jsdom
//
// The ended-conversation footer, end to end through the real widget — the
// gap `session-closed.test.ts` documents a sibling of: that file covers a
// session THIS tab watched close (the `sessionClosed` event, `closedSessionId`,
// the inline closure banner in the transcript). This file covers the wider
// case that gate never sees — a CLOSED/RESOLVED session reached any OTHER
// way (here, the very first `connection.ack` the customer's socket gets, the
// same shape a page reload landing back on an old conversation produces) —
// where, before this change, the composer was left fully visible and enabled
// with nowhere for a send to go.
//
// Two things this file exists to prove that a jsdom-only, no-socket test of
// ui/ended-footer.ts cannot:
//   1. `widget.ts`'s `syncScreens` actually swaps the footer in for the
//      composer at the right moment, on a REAL session object flowing
//      through the REAL store — not a hand-built ChatState.
//   2. "Reopen" reaches the real backend: a click here has to produce a real
//      `POST /chat/sessions/{id}/reopen` followed by the real
//      `GET /chat/sessions/{id}/full` read-back (`@dhaam-ccrm/rest`'s
//      `createSessionActions`), never a client-side-only re-enable.
//
// Same hand-run fake socket `session-closed.test.ts` uses and for the same
// reason: a real `connection.hello` -> `connection.ack` handshake, so
// `state.session` carries a genuine status rather than one poked in.
//
// What this file does NOT cover: the CSAT-survey-outranks-the-footer case
// for a terminal session with a non-empty transcript. Reaching that through
// this same harness needs a validator-correct `message.new` frame (core's
// `protocol/validate.ts` checks far more of that payload's shape than is
// worth hand-assembling here), so that precedence is verified by inspection
// instead: `syncScreens`'s `csatDue` expression in widget.ts is copied
// verbatim from `syncProductSurfaces`'s own CSAT-due condition a few lines
// above it, and the empty-thread case below already proves the footer defers
// correctly to "no CSAT due" — the same predicate, the other branch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
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

  /** Answers the hello with a session already in `status` — no history needed to reach it. */
  ack(sessionId: string, status = 'ASSIGNED'): void {
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
            status,
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

const tryQuery = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every request this suite's fetch stub has seen, in order — for asserting Reopen's real round trip. */
let requests: Array<{ method: string; url: string }>;

/**
 * Flips the stub's `/reopen` branch to a 500, for the "reopen rejects" test.
 *
 * A `let` the stub reads at CALL time, not a second `vi.stubGlobal('fetch', …)`
 * mid-test: `@dhaam-ccrm/rest`'s `RestClient` binds `globalThis.fetch` ONCE in
 * its constructor (`this.#fetch = (options.fetch ?? globalThis.fetch).bind(…)`),
 * before `mount()` even returns — so restubbing the global after `connectedTo`
 * has already run silently does nothing, and the ORIGINAL (success) stub keeps
 * answering every request. This flag is what actually reaches the already-built
 * client.
 */
let reopenShouldFail = false;

/** A full-session row `GET .../full` can answer with — status 3 decodes to ASSIGNED, a live session. */
function fullSessionResponse(sessionId: string): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        session: {
          id: sessionId,
          tenantId: 't1',
          customerId: 'cus_1',
          assignedAgentId: 'agent-9',
          ticketId: null,
          mode: 2,
          status: 3,
          priority: 2,
          closedAt: null,
          createdAt: '2026-08-19T09:00:00.000Z',
          updatedAt: '2026-08-19T09:30:00.000Z',
        },
        messages: [],
        participants: [],
        hasMore: false,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  requests = [];
  reopenShouldFail = false;
  // jsdom has no IntersectionObserver; ui/hero-header.ts's own scroll watcher
  // constructs one unconditionally on mount regardless of which screen or
  // session this suite is about. A minimal stub, not a workaround for
  // anything under test here.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url });

      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/reopen')) {
        if (reopenShouldFail) return new Response('', { status: 500 });
        return new Response(
          JSON.stringify({ success: true, data: { sessionId: 'sess_1', status: 'ASSIGNED', mode: 'HUMAN' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/full')) {
        return fullSessionResponse('sess_1');
      }
      // The history page — an empty thread, so CSAT never becomes due and
      // the footer is the only thing standing between the customer and the
      // (absent) composer once the session is terminal.
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

/**
 * Connects and lands directly on the conversation screen, at `sessionId`
 * with `status`.
 *
 * `config.sessionId` is what puts the screen on 'conversation' from the very
 * first render (`widget.ts`'s `initialScreenName`) — this suite is about
 * screen-level visibility (composer vs. footer), which a customer only ever
 * sees once they are actually looking at a conversation, so every test here
 * needs that regardless of how the session itself got named.
 *
 * Naming the SAME id here that the ack resolves to is deliberate, not
 * incidental: `openNamedSession` (widget.ts) awaits history settling, then
 * calls `switchSession(sessionId)`, and core's own `switchToSession` no-ops
 * when `state.session.id` already equals the target (create-chat-client.ts) —
 * so this reaches the target session without a second socket, a
 * `session.join` frame, or any of `switchSession`'s teardown/reconnect
 * machinery, none of which this suite is testing.
 */
async function connectedTo(status: string, sessionId = 'sess_1'): Promise<FakeWebSocket> {
  mount(config({ sessionId }));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack(sessionId, status);
  await settle();
  return socket;
}

describe('a terminal session with no CSAT due', () => {
  it('shows the footer instead of the composer for a RESOLVED, empty thread', async () => {
    await connectedTo('RESOLVED');

    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
  });

  it('shows the composer, not the footer, for a live session', async () => {
    await connectedTo('ASSIGNED');

    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    // Not even mounted-but-hidden by coincidence — genuinely not the branch
    // `syncScreens` took.
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(true);
  });

  it('shows the footer for CLOSED the same as RESOLVED', async () => {
    await connectedTo('CLOSED');
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
  });

  it('"New conversation" opens the one new-conversation flow every other entry point uses', async () => {
    await connectedTo('RESOLVED');

    query<HTMLButtonElement>('.dh-ended-footer .dh-ended-secondary').click();
    await settle();

    expect(tryQuery('.dh-newconvo-form')).not.toBeNull();
  });

  describe('"Reopen"', () => {
    it('calls the real reopen endpoint, then reads the session back, and the composer returns', async () => {
      await connectedTo('RESOLVED');

      query<HTMLButtonElement>('.dh-ended-footer .dh-form-submit').click();
      await settle();

      // The real round trip `create-chat-client.ts`'s `reopenSession` and
      // `@dhaam-ccrm/rest`'s `createSessionActions` document: a POST that
      // mutates, then a GET that reads the enriched session back — never a
      // client-side flip with no request at all. Matched by substring, not a
      // parsed URL — the token fetch runs through a relative path with no
      // origin for `URL` to anchor to, and this only needs to prove the two
      // real requests happened, not their full absolute form.
      const reopened = requests.some(
        (r) => r.method === 'POST' && r.url.includes('/chat/sessions/sess_1/reopen'),
      );
      const readBack = requests.some(
        (r) => r.method === 'GET' && r.url.includes('/chat/sessions/sess_1/full'),
      );
      expect(reopened).toBe(true);
      expect(readBack).toBe(true);

      // The resolved ChatSession commits through the store, which is what
      // widget.ts's own `state.session` id/status subscription reacts to —
      // no manual re-sync call needed in `reopenConversation` itself.
      expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(true);
      expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    });

    it('shows an inline error and re-arms the button when the reopen rejects', async () => {
      reopenShouldFail = true;
      await connectedTo('RESOLVED');

      const reopen = query<HTMLButtonElement>('.dh-ended-footer .dh-form-submit');
      reopen.click();
      await settle();

      // Still ended — the footer stayed up, with a reason and a way to retry.
      expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
      expect(reopen.disabled).toBe(false);
      expect(reopen.textContent).toBe('Reopen conversation');
      expect(query<HTMLElement>('.dh-form-error').hidden).toBe(false);
    });
  });
});
