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

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  requests = [];
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
    // own tabs/devices started a new conversation) — the exact frame
    // `session-closed.test.ts` proves produces no visible change on its own,
    // since `applySessionClosed` only stamps `closedAt`, never `status`.
    socket.closeSession(SESSION_ID, 'SWITCHED');
    await settle();
    expect(tryQuery('.dh-csat-card')).toBeNull();
    expect(tryQuery<HTMLElement>('.dh-ended-footer')?.hidden).not.toBe(false);

    // However the status eventually reads CLOSED/RESOLVED for THIS id — a
    // later snapshot is the only way it can, since core never flips `status`
    // off a bare `session.closed` frame — the survey and the ended-footer
    // must both still defer to the fact that THIS session was parked, not
    // resolved.
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
