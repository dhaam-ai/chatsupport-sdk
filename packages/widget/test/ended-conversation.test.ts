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
// for a terminal session reached by ACK with a non-empty transcript. Reaching
// that through this same harness needs a validator-correct `message.new`
// frame (core's `protocol/validate.ts` checks far more of that payload's
// shape than is worth hand-assembling here), so that precedence is verified
// by inspection instead: `syncScreens`'s `csatDue` expression in widget.ts is
// copied verbatim from `syncProductSurfaces`'s own CSAT-due condition a few
// lines above it, and the empty-thread case below already proves the footer
// defers correctly to "no CSAT due" — the same predicate, the other branch.
//
// ── "End conversation" from the ⋯ menu ────────────────────────────────────
//
// The widget-level half of ui/end-conversation.ts lives here too, because it
// ends in exactly the state the rest of this file is about: the customer's
// own close is one more way a session reaches CLOSED, and what follows it —
// the ended footer for an empty thread, the CSAT survey for one with
// messages — has to be the SAME thing an agent-side close produces. The
// non-empty transcript that last case needs comes from the history page
// (`GET .../messages` answering with a row, the route csat-submit.test.ts
// already takes), which sidesteps the `message.new` problem above.

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

  /**
   * A `session.updated` push naming a new status for the SAME session — what
   * an agent closing it from their side produces. Applied wholesale by core,
   * so `state.session.status` genuinely changes under whatever is on screen.
   */
  updateStatus(sessionId: string, status: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.updated',
        id: ulid(),
        ts: Date.now(),
        d: {
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
/** Same switch for `/close` — the "close rejects" test. */
let closeShouldFail = false;
/**
 * Holds the `/close` response until `releaseClose` is called — the window in
 * which "Ending…" is on the button and the rest of the panel is still live.
 */
let holdClose = false;
let releaseClose: (() => void) | null = null;
/**
 * The integer status `GET .../full` answers with: 3 (ASSIGNED) until a close
 * lands, 4 (CLOSED) after. The read-back is what puts the CLOSED session into
 * the store — `@dhaam-ccrm/rest`'s adapter reads the session back after the
 * POST and core's `closeSession` commits what comes back — so the stub has to
 * remember that the close happened.
 */
let fullStatus = 3;
/** Rows the history page answers with — one row here is what makes CSAT due. */
let historyRows: unknown[] = [];

/** One raw history row — the shape `GET /chat/sessions/{id}/messages` returns, unprojected. */
function messageRow(): Record<string, unknown> {
  return {
    id: 'm1',
    chatSessionId: 'sess_1',
    senderId: 'agent-9',
    senderType: 2,
    messageType: 4,
    content: 'Anything else I can help with?',
    metadata: null,
    replyToMessageId: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    seq: 1,
  };
}

/** A full-session row `GET .../full` can answer with — status 3 decodes to ASSIGNED (live), 4 to CLOSED. */
function fullSessionResponse(sessionId: string, status: number): Response {
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
          status,
          priority: 2,
          closedAt: status === 4 ? '2026-08-19T09:45:00.000Z' : null,
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
  closeShouldFail = false;
  holdClose = false;
  releaseClose = null;
  fullStatus = 3;
  historyRows = [];
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
        fullStatus = 3;
        return new Response(
          JSON.stringify({ success: true, data: { sessionId: 'sess_1', status: 'ASSIGNED', mode: 'HUMAN' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/close')) {
        if (closeShouldFail) return new Response('', { status: 500 });
        if (holdClose) {
          await new Promise<void>((resolve) => {
            releaseClose = resolve;
          });
        }
        fullStatus = 4;
        // The receipt and nothing more — chat.routes.ts's own shape, which is
        // why the adapter follows it with the `/full` read.
        return new Response(
          JSON.stringify({
            success: true,
            data: { sessionId: 'sess_1', status: 'CLOSED', closedAt: '2026-08-19T09:45:00.000Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/full')) {
        return fullSessionResponse('sess_1', fullStatus);
      }
      // The history page — empty by default, so CSAT never becomes due and
      // the footer is the only thing standing between the customer and the
      // (absent) composer once the session is terminal. `historyRows` seeds
      // it for the one test that needs a rateable thread.
      return new Response(JSON.stringify({ success: true, data: { messages: historyRows, hasMore: false } }), {
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
let widget: ReturnType<typeof mount>;

async function connectedTo(status: string, sessionId = 'sess_1'): Promise<FakeWebSocket> {
  widget = mount(config({ sessionId }));
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
      // Scoped to the footer: the composer's link popover carries a
      // `.dh-form-error` of its own, earlier in DOM order and hidden.
      expect(query<HTMLElement>('.dh-ended-footer .dh-form-error').hidden).toBe(false);
    });
  });
});

/**
 * Opens the ⋯ menu and presses its "End conversation" item.
 *
 * Through the real menu rather than a direct call: the item is hidden unless
 * `syncHeaderMenu` judged the session live, so a click that lands here also
 * proves the menu offered it.
 */
function pressEndConversation(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = query<HTMLButtonElement>('.dh-hmenu-danger');
  expect(item.hidden).toBe(false);
  item.click();
}

const closeRequestsFor = (sessionId: string) =>
  requests.filter((r) => r.method === 'POST' && r.url.includes(`/chat/sessions/${sessionId}/close`));
const closeRequests = () => closeRequestsFor('sess_1');

describe('"End conversation" from the ⋯ menu', () => {
  it("asks inside the widget — never through the browser's confirm() — and closes nothing yet", async () => {
    const browserConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', browserConfirm);
    await connectedTo('ASSIGNED');

    pressEndConversation();
    await settle();

    expect(query<HTMLElement>('.dh-confirm-end .dh-form-heading').textContent).toBe('End this conversation?');
    // Stands in for the transcript and composer, like every other surface.
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
    // The question is the whole of what happened so far.
    expect(browserConfirm).not.toHaveBeenCalled();
    expect(closeRequests()).toHaveLength(0);
  });

  it('"Keep chatting" puts the conversation back with nothing sent', async () => {
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();

    query<HTMLButtonElement>('.dh-confirm-end-keep').click();
    await settle();

    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    expect(closeRequests()).toHaveLength(0);
  });

  it('confirming closes over the real endpoint, reads the session back, and the footer follows an empty thread', async () => {
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();

    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    // The same POST-then-GET round trip "Reopen" above is held to.
    expect(closeRequests()).toHaveLength(1);
    expect(requests.some((r) => r.method === 'GET' && r.url.includes('/chat/sessions/sess_1/full'))).toBe(true);
    // The question is gone and, with nothing to rate, the footer is what is
    // left — reached through `releaseSurface`'s re-sync, not a later tick.
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
  });

  it('confirming a thread with messages hands over to the CSAT survey — the path an agent-side close already takes', async () => {
    historyRows = [messageRow()];
    await connectedTo('ASSIGNED');
    // Sanity: live, rateable, and not yet asked anything.
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    expect(tryQuery('.dh-csat-card')).toBeNull();

    pressEndConversation();
    await settle();
    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(tryQuery('.dh-csat-card')).not.toBeNull();
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(true);
  });

  it('a close the server refuses keeps the question up with a reason, and a retry is a fresh request', async () => {
    closeShouldFail = true;
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();

    const end = query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit');
    end.click();
    await settle();

    // Still asking — with the failure line and the button re-armed, and the
    // conversation still parked behind the question rather than half-closed.
    expect(tryQuery('.dh-confirm-end')).not.toBeNull();
    expect(query<HTMLElement>('.dh-confirm-end .dh-form-error').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-confirm-end .dh-form-error').textContent).toBe(
      "We couldn't end this conversation. Please try again.",
    );
    expect(end.disabled).toBe(false);
    expect(end.textContent).toBe('End conversation');
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);

    // `endingConversation` released by the failure: the retry issues a real
    // second POST rather than being swallowed by a latch left set.
    const before = closeRequests().length;
    closeShouldFail = false;
    end.click();
    await settle();

    expect(closeRequests().length).toBeGreaterThan(before);
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
  });
});

/** The ⋯ menu's "Start new conversation" item. */
function pressStartNew(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-hmenu-item')].find((button) =>
    button.textContent?.includes('Start new conversation'),
  );
  if (item === undefined) throw new Error('no "Start new conversation" item');
  item.click();
}

describe('"End conversation" when the conversation moved on under the question', () => {
  // The surface is not modal, unlike the `confirm()` it replaced: state keeps
  // flowing while it is up, and `syncProductSurfaces` deliberately leaves it
  // alone (its non-preemption rule). So the button checks, at press time,
  // that what it was asked about is still there to close — chat-service's
  // close is not idempotent, and it closes the CURRENT session, whichever
  // that has become.

  it('an agent ended it first: no second POST, and the footer follows', async () => {
    const socket = await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();

    socket.updateStatus('sess_1', 'CLOSED');
    await settle();
    // Still asking — a status tick does not preempt the customer's question.
    expect(tryQuery('.dh-confirm-end')).not.toBeNull();

    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    // A POST here would re-run the close and file a second "closed" system
    // message (see @dhaam-ccrm/rest's adapter).
    expect(closeRequests()).toHaveLength(0);
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
  });

  it('an agent ended a thread with messages first: no POST, and the CSAT survey follows', async () => {
    historyRows = [messageRow()];
    const socket = await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();
    socket.updateStatus('sess_1', 'CLOSED');
    await settle();

    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    expect(closeRequests()).toHaveLength(0);
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(tryQuery('.dh-csat-card')).not.toBeNull();
  });

  it('a different session underneath: the button closes nothing rather than the wrong conversation', async () => {
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();

    // Another route mints a session while the question is up — what another
    // tab's new conversation (this one SWITCHED) or an agent-initiated
    // session does to `state.session` from this tab's point of view.
    void widget.store.client.startNewSession({ subject: 'elsewhere' });
    await settle();
    const next = FakeWebSocket.instances[1];
    if (next === undefined) throw new Error('no second socket was opened');
    next.open();
    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();
    expect(widget.store.getState().session?.id).toBe('sess_2');
    expect(tryQuery('.dh-confirm-end')).not.toBeNull();

    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    // Neither the session asked about nor the one that replaced it.
    expect(requests.filter((r) => r.method === 'POST' && r.url.includes('/close'))).toHaveLength(0);
    expect(widget.store.getState().session?.status).toBe('WAITING_FOR_AGENT');
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });

  // The other half of the test above. Standing down is right for the question
  // the customer already answered; it must not become the answer to the NEXT
  // one. `openSurface` is idempotent by kind so a store tick cannot rebuild a
  // half-answered surface — but the confirm's `build()` closes over the
  // session it is asking about, so answering the second ask with the first
  // ask's view handed back a closure aimed at a conversation that no longer
  // exists, and the customer pressed the irreversible, danger-coloured button
  // twice while nothing at all was closed and nothing said so.
  it('asked again after the session changed, it closes the conversation now on screen', async () => {
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();
    const stale = query<HTMLElement>('.dh-confirm-end');

    void widget.store.client.startNewSession({ subject: 'elsewhere' });
    await settle();
    const next = FakeWebSocket.instances[1];
    if (next === undefined) throw new Error('no second socket was opened');
    next.open();
    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();
    expect(widget.store.getState().session?.id).toBe('sess_2');

    // The ⋯ menu lives in the always-visible header, so it is still reachable
    // with the question up — and the customer means the conversation they can
    // see now.
    pressEndConversation();
    await settle();
    const fresh = query<HTMLElement>('.dh-confirm-end');
    expect(fresh).not.toBe(stale);

    query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit').click();
    await settle();

    expect(closeRequestsFor('sess_2')).toHaveLength(1);
    expect(closeRequestsFor('sess_1')).toHaveLength(0);
    expect(tryQuery('.dh-confirm-end')).toBeNull();
  });

  it('a form opened while "Ending…" is in flight survives the close landing, text and all', async () => {
    holdClose = true;
    await connectedTo('ASSIGNED');
    pressEndConversation();
    await settle();
    const end = query<HTMLButtonElement>('.dh-confirm-end .dh-form-submit');
    end.click();
    await settle();
    expect(end.textContent).toBe('Ending…');

    // The header stays live across the round trip, and the customer moves on.
    pressStartNew();
    await settle();
    expect(tryQuery('.dh-confirm-end')).toBeNull();
    const form = query<HTMLElement>('.dh-newconvo-form');
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'Half typed while the close was in flight';

    releaseClose?.();
    await settle();

    // The close landed — and released only the surface that asked for it.
    expect(closeRequests()).toHaveLength(1);
    expect(tryQuery('.dh-newconvo-form')).toBe(form);
    expect(query<HTMLTextAreaElement>('.dh-newconvo-message').value).toBe('Half typed while the close was in flight');
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(true);
    // The ended footer waits its turn behind the customer's form.
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(true);
  });
});
