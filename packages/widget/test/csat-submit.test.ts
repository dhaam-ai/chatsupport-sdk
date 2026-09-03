// @vitest-environment jsdom
//
// The CSAT survey's `onSubmit`, end to end through the real widget — and the
// one guard that stops it firing for a session that was merely PARKED.
//
// ── Problem A: the rating used to travel as a fake chat message ────────────
// Before this change `syncProductSurfaces`'s `onSubmit` called
// `store.client.sendMessage('Rating: 4/5 — …')`: chat-service had no CSAT
// route, so the rating was a plain transcript line with a `metadata.kind:
// 'csat'` tag and nothing structured ever read it back. chat-service now has
// `POST /chat/sessions/{id}/csat` (`csat.service.ts`'s `submitCsat`, which
// also rolls the rating up onto the session's linked support ticket when it
// has one), and core exposes it as `ChatClient.submitCsat` — this file proves
// the widget actually calls THAT, not `sendMessage`.
//
// ── Problem B: a SWITCHED-parked session must never look "ended" ───────────
// `session.status` reading CLOSED/RESOLVED is necessary but not sufficient
// for "genuinely over" — a session this tab watched get SWITCHED-closed
// (§12.5: the customer, or another of their own tabs/devices, started a
// different conversation) is parked, not ended, and must not be offered a
// CSAT survey or a Reopen/Start-new footer either. `widget.ts`'s
// `parkedSessionId` is what tracks that; this file drives a live
// `session.closed(SWITCHED)` for the on-screen session and then a status
// snapshot that reads terminal, and asserts neither surface appears.
//
// Same hand-run fake socket `session-closed.test.ts` and
// `ended-conversation.test.ts` both use, for the same reason: a real
// `connection.hello` -> `connection.ack` handshake, so `state.session` and
// `state.messages` carry genuine values rather than ones poked in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';
const SESSION_ID = 'sess_1';

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

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  open(): void {
    this.onopen?.();
  }

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

  /** A `session.updated` push naming a new status for the SAME session id. */
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

  closeSession(sessionId: string, closeReason: 'RESOLVED' | 'MANUAL' | 'SWITCHED'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.closed',
        id: ulid(),
        ts: Date.now(),
        d: { sessionId, closeReason },
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
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** One raw history row — the shape `GET /chat/sessions/{id}/messages` returns, unprojected. */
function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    chatSessionId: SESSION_ID,
    senderId: 'agent-9',
    senderType: 2,
    messageType: 4,
    content: 'Anything else I can help with?',
    metadata: null,
    replyToMessageId: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    seq: 1,
    ...overrides,
  };
}

let requests: Array<{ method: string; url: string; body: unknown }>;
/**
 * What `GET /chat/sessions/{id}/csat` answers with.
 *
 * A `let` the stub reads at CALL time for the reason ended-conversation.test.ts
 * spells out: `RestClient` binds `globalThis.fetch` once, in its constructor,
 * so restubbing the global after `mount()` reaches nothing.
 */
let csatOnFile: Record<string, unknown> = { rated: false };
/**
 * Makes `GET /chat/sessions/{id}/csat` fail, for the "the lookup cannot be
 * answered" case. Same `let`-read-at-call-time reason as `csatOnFile`.
 *
 *   `'5xx'`      — a transient fault. The lookup is unanswerable, so the
 *                  survey is withheld rather than risk overwriting a rating.
 *   `'no-route'` — this chat-service has no CSAT read route at all (a staged
 *                  rollout, a lagging tenant, a rollback). Fastify's own
 *                  route-not-found body, which carries no `error.code`, so
 *                  `RestApiError.code` falls back to `HTTP_404`.
 *   `'not-mine'` — the route EXISTS and says this session is not this
 *                  customer's. Same status, structured code — and the
 *                  opposite verdict.
 */
let csatLookupFails: false | '5xx' | 'no-route' | 'not-mine' = false;

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  requests = [];
  csatOnFile = { rated: false };
  csatLookupFails = false;
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
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push({ method, url, body });

      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/csat')) {
        // GET is the lookup the widget now runs BEFORE offering the survey —
        // `rated: false` is the "nobody has rated this yet" answer that lets
        // it appear at all. POST is the submit these tests are about.
        if (method === 'GET') {
          if (csatLookupFails === '5xx') {
            return new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'nope' } }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (csatLookupFails === 'no-route') {
            // Verbatim Fastify: no envelope, so `readErrorBody` finds nothing
            // and the code becomes the literal `HTTP_404`.
            return new Response(
              JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'Route GET:/csat not found' }),
              { status: 404, headers: { 'content-type': 'application/json' } },
            );
          }
          if (csatLookupFails === 'not-mine') {
            return new Response(
              JSON.stringify({ error: { code: 'SESSION_NOT_FOUND', message: 'nope', retryable: false } }),
              { status: 404, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ success: true, data: csatOnFile }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        // The POST is an UPSERT server-side, and the GET above answers from
        // the same row — so the stub records it. That is what lets a test
        // remount the widget and find the rating still there, which is the
        // whole of defect 5: the survey used to re-arm on every reload
        // because the only memory of "already rated" died with the closure.
        csatOnFile = { rated: true, rating: body?.rating ?? 0, comment: body?.comment ?? null, submittedAt: '2026-08-19T11:00:00.000Z' };
        return new Response(
          JSON.stringify({
            success: true,
            data: { sessionId: SESSION_ID, rating: body?.rating ?? 0, comment: body?.comment ?? null, submittedAt: '2026-08-19T11:00:00.000Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/chat/sessions/${SESSION_ID}/messages`)) {
        return new Response(
          JSON.stringify({ success: true, data: { messages: [messageRow()], hasMore: false } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
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

async function connectedTo(status: string): Promise<FakeWebSocket> {
  mount(config({ sessionId: SESSION_ID }));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack(SESSION_ID, status);
  await settle();
  return socket;
}

describe('submitting a CSAT rating', () => {
  it('POSTs to /chat/sessions/{id}/csat instead of sending a chat message', async () => {
    await connectedTo('RESOLVED');
    expect(tryQuery('.dh-csat-card')).not.toBeNull();

    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(4)').click();
    query<HTMLTextAreaElement>('#dh-csat-comment').value = 'Great help, thanks!';
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();

    const csatCall = requests.find((r) => r.method === 'POST' && r.url.includes('/csat'));
    expect(csatCall).toBeDefined();
    expect(csatCall?.url).toContain(`/chat/sessions/${SESSION_ID}/csat`);
    expect(csatCall?.body).toEqual({ rating: 4, comment: 'Great help, thanks!' });

    // The one channel this rating used to travel over, now unused for it.
    const sentSendMessage = FakeWebSocket.instances[0]
      ?.sentFrames()
      .some((f) => f['t'] === 'message.send');
    expect(sentSendMessage).toBe(false);

    expect(query<HTMLElement>('.dh-csat-thanks').hidden).toBe(false);
  });

  it('omits the comment from the request body when the customer left none', async () => {
    await connectedTo('CLOSED');

    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(5)').click();
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();

    const csatCall = requests.find((r) => r.method === 'POST' && r.url.includes('/csat'));
    expect(csatCall?.body).toEqual({ rating: 5 });
  });
});

describe('a session parked by a live SWITCHED close', () => {
  it('does not offer the CSAT survey once its status reads terminal', async () => {
    const socket = await connectedTo('ASSIGNED');
    // The composer is live and the CSAT gate has not fired — the ordinary
    // pre-close state.
    expect(tryQuery('.dh-csat-card')).toBeNull();

    // This tab watches its own session get parked (another of the customer's
    // own tabs/devices started a new conversation). `applySessionClosed` now
    // moves `status` to CLOSED off this frame — it used to stamp `closedAt`
    // alone, which is what left an AGENT-closed session rendering as live —
    // so this session reads terminal by status from here on, and ONLY
    // `parkedSessionId` stands between it and a survey for a conversation
    // nobody ended.
    socket.closeSession(SESSION_ID, 'SWITCHED');
    await settle();
    expect(tryQuery('.dh-csat-card')).toBeNull();
    expect(tryQuery<HTMLElement>('.dh-ended-footer')?.hidden).not.toBe(false);

    // And a later snapshot saying the same thing changes nothing: the survey
    // and the ended footer must both still defer to the fact that THIS
    // session was parked, not resolved.
    socket.updateStatus(SESSION_ID, 'RESOLVED');
    await settle();

    expect(tryQuery('.dh-csat-card')).toBeNull();
    const footer = tryQuery<HTMLElement>('.dh-ended-footer');
    expect(footer === null || footer.hidden).toBe(true);
  });

  // `parkedSessionId` is compared against `session.id` by exact match
  // (widget.ts's `session.id !== parkedSessionId`), so the guard cannot leak
  // onto a different session's genuine resolution — verified by inspection,
  // the same way `ended-conversation.test.ts`'s own header explains it
  // verifies CSAT-outranks-the-footer: reaching a SECOND real session through
  // this hand-run socket would need `commitSession`'s replace-and-reseed path
  // (`perSessionReset` clears `state.messages`, then a fresh history fetch
  // refills it) faked out convincingly enough to be its own test of core, not
  // of this guard.
});


// ── Defect 5: a rated conversation is never offered the survey again ───────
//
// `POST /chat/sessions/{id}/csat` is an upsert, so a survey shown over an
// already-rated session does not fail — it replaces the score the customer
// gave. The widget's only memory of "already rated" used to be a closure
// variable, which a reload, a second tab or another device destroys, so the
// survey re-armed for every closed conversation and every re-submit silently
// overwrote the last one. The memory is now the server's, read back through
// `ChatClient.getCsat`.
describe('a conversation the customer already rated', () => {
  it('shows the rating filled and locked, with no way to send another', async () => {
    csatOnFile = { rated: true, rating: 4, comment: null, submittedAt: '2026-08-19T11:00:00.000Z' };
    await connectedTo('RESOLVED');

    const card = query<HTMLElement>('.dh-csat-card');
    expect(card.getAttribute('data-locked')).toBe('true');
    expect(query<HTMLElement>('.dh-form-heading').textContent).toBe('Your rating');

    // Filled: the fourth option is the checked one on a scale of five.
    const options = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-csat-option')];
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(shadow().querySelector('.dh-csat-scale')?.getAttribute('aria-readonly')).toBe('true');

    // Locked: no submit control exists at all — not a disabled one, which
    // still invites the press.
    expect(query<HTMLElement>('.dh-csat-comment').hidden).toBe(true);
    expect(tryQuery('.dh-csat-comment .dh-form-submit[disabled]')).toBeNull();

    // And pressing a different score changes nothing and sends nothing.
    options[0]?.click();
    await settle();
    expect(options[0]?.getAttribute('aria-checked')).toBe('false');
    expect(options[3]?.getAttribute('aria-checked')).toBe('true');
    expect(requests.some((r) => r.method === 'POST' && r.url.includes('/csat'))).toBe(false);
  });

  it('shows the comment they left, as text rather than back in the box', async () => {
    csatOnFile = { rated: true, rating: 5, comment: 'Sorted in a minute', submittedAt: '2026-08-19T11:00:00.000Z' };
    await connectedTo('CLOSED');

    expect(query<HTMLElement>('.dh-csat-your-comment').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-csat-your-comment').textContent).toBe('Sorted in a minute');
  });

  it('offers the survey when the server says nobody has rated it', async () => {
    csatOnFile = { rated: false };
    await connectedTo('RESOLVED');

    const card = query<HTMLElement>('.dh-csat-card');
    expect(card.hasAttribute('data-locked')).toBe(false);
    expect(query<HTMLElement>('.dh-form-heading').textContent).toBe(
      'How was your support experience?',
    );
  });

  it('stays locked for a FRESH widget instance over the same session — the reload case', async () => {
    // Rate it once, through the real card…
    await connectedTo('RESOLVED');
    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(3)').click();
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();
    expect(requests.filter((r) => r.method === 'POST' && r.url.includes('/csat'))).toHaveLength(1);

    // …then throw the widget away and build another one over the same
    // session, which is what a page reload is. `ratedSessionId` is gone with
    // the closure; only the server's answer survives.
    unmount();
    FakeWebSocket.instances = [];
    await connectedTo('RESOLVED');

    expect(query<HTMLElement>('.dh-csat-card').getAttribute('data-locked')).toBe('true');
    expect(query<HTMLElement>('.dh-form-heading').textContent).toBe('Your rating');
    // The second instance offered no way to rate again, so nothing was sent.
    expect(requests.filter((r) => r.method === 'POST' && r.url.includes('/csat'))).toHaveLength(1);
  });
});

describe('when the CSAT lookup cannot be answered', () => {
  it('withholds the survey rather than risk overwriting a rating, and leaves the ended footer', async () => {
    // The documented direction (see `csatFor` in widget.ts): the two ways to
    // be wrong are not symmetric. Showing the survey on an unknown answer
    // risks destroying a rating the customer already gave; hiding it risks
    // not collecting one. Only the first loses data.
    csatLookupFails = '5xx';
    await connectedTo('RESOLVED');

    expect(tryQuery('.dh-csat-card')).toBeNull();
    // Nobody is stranded: the ended footer's Reopen / New conversation pair
    // is what a terminal session with no card falls through to.
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
  });

  it('an ownership 404 withholds it too — that IS an answer about this session', async () => {
    csatLookupFails = 'not-mine';
    await connectedTo('RESOLVED');

    expect(tryQuery('.dh-csat-card')).toBeNull();
    expect(query<HTMLElement>('.dh-ended-footer').hidden).toBe(false);
  });
});

// ── A chat-service that has not shipped the read route yet ─────────────────
//
// A widget bundle is embedded on pages that outlive any one backend release.
// Gating the survey on a brand-new route with no fallback would mean a staged
// rollout, a lagging tenant or a rollback silently stops collecting ratings
// altogether — and, because the verdict is cached, for the whole page view
// rather than one conversation. So "this deployment has no CSAT read" falls
// back to exactly the behaviour that shipped before the route existed.
describe('a deployment with no GET /csat route', () => {
  it('still offers the survey, and still records the rating', async () => {
    csatLookupFails = 'no-route';
    await connectedTo('RESOLVED');

    const card = query<HTMLElement>('.dh-csat-card');
    expect(card.hasAttribute('data-locked')).toBe(false);

    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(5)').click();
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();

    const posted = requests.filter((r) => r.method === 'POST' && r.url.includes('/csat'));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toEqual({ rating: 5 });
  });

  it('reports nothing to the host — an older service is not a fault', async () => {
    const errors: unknown[] = [];
    csatLookupFails = 'no-route';
    mount(config({ sessionId: SESSION_ID, onError: (error) => errors.push(error) }));
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket was opened');
    socket.open();
    socket.ack(SESSION_ID, 'RESOLVED');
    await settle();

    expect(tryQuery('.dh-csat-card')).not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  it('asks the missing route ONCE, not on every repaint', async () => {
    csatLookupFails = 'no-route';
    const socket = await connectedTo('RESOLVED');
    const asked = () => requests.filter((r) => r.method === 'GET' && r.url.includes('/csat')).length;
    expect(asked()).toBe(1);

    // Any state change repaints the surfaces; the verdict is cached, so no
    // second lookup goes out.
    socket.updateStatus(SESSION_ID, 'CLOSED');
    await settle();
    expect(asked()).toBe(1);
  });
});

// ── The rating that landed somewhere else while this card was open ─────────
//
// `csatBySession` caches `unrated` for the widget's lifetime and nothing on
// the wire invalidates it — there is no CSAT frame and no store event. So a
// second tab, or the same customer's phone, can rate the conversation while
// this card sits on screen holding an answer that was true when it was
// fetched, and the POST is an upsert: submitting then replaces the score they
// already gave. The submit re-asks first.
describe('a rating that arrived from somewhere else while the card was open', () => {
  it('does not overwrite it, and shows the rating that actually stands', async () => {
    await connectedTo('RESOLVED');
    expect(query<HTMLElement>('.dh-csat-card').hasAttribute('data-locked')).toBe(false);

    // The other tab rates it 5. Nothing tells this widget.
    csatOnFile = { rated: true, rating: 5, comment: 'Perfect', submittedAt: '2026-08-19T11:00:00.000Z' };

    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(2)').click();
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();

    // Nothing was written…
    expect(requests.filter((r) => r.method === 'POST' && r.url.includes('/csat'))).toHaveLength(0);
    // …and the card repaints as the locked read-out of the rating that stands,
    // rather than claiming a 2 the server never took.
    const card = query<HTMLElement>('.dh-csat-card');
    expect(card.getAttribute('data-locked')).toBe('true');
    expect(query<HTMLElement>('.dh-csat-your-comment').textContent).toBe('Perfect');
    expect(
      [...shadow().querySelectorAll<HTMLButtonElement>('.dh-csat-option')].map((o) =>
        o.getAttribute('aria-checked'),
      ),
    ).toEqual(['false', 'false', 'false', 'false', 'true']);
  });

  it('lets the rating through when the re-check itself fails', async () => {
    // The opposite asymmetry from `csatFor`: a definite `unrated` is already
    // on file (it is why this is an ASK), and the customer has just chosen a
    // score. Refusing to send it loses a rating for certain on the strength of
    // a blip that says nothing about whether one exists.
    await connectedTo('RESOLVED');
    csatLookupFails = '5xx';

    query<HTMLButtonElement>('.dh-csat-option:nth-of-type(3)').click();
    query<HTMLButtonElement>('.dh-csat-comment .dh-form-submit').click();
    await settle();

    const posted = requests.filter((r) => r.method === 'POST' && r.url.includes('/csat'));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toEqual({ rating: 3 });
  });
});
