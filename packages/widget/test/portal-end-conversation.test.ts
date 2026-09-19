// @vitest-environment jsdom
//
// Reported bug: "End conversation" never appeared in the header menu for a
// conversation opened by clicking a Merchants/Customers tab LIST row
// (`openPortalConversation`), even though the exact same session, opened by
// a fresh targeted mount (`OutletChatModal`), showed it correctly. Root
// cause: `syncHeaderMenu` always read `store.client`'s own session, but a
// list-opened conversation lives on the separate keyless `portalClient`
// instead — a client `store.client` never even connects to for an admin's
// general portal mount. See widget.ts's `syncHeaderMenu` for the fix.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

let frameCounter = 0;
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function frameId(): string {
  const suffix = ULID_ALPHABET[frameCounter++ % ULID_ALPHABET.length] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}${suffix}`;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.onclose?.({ code: 1000, reason: '', wasClean: true }); }
  open(): void { this.onopen?.(); }
  push(t: string, d: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id: frameId(), ts: Date.now(), d }) });
  }
  frames(type: string): Array<{ id: string; d: Record<string, unknown> }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { t: string; id: string; d: Record<string, unknown> })
      .filter((frame) => frame.t === type);
  }
}

let queueRows: readonly unknown[] = [];
let closeRequests: string[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
      if (url.includes('/agent/queue')) {
        return new Response(JSON.stringify({ data: queueRows }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.method === 'POST' && /\/agent\/sessions\/[^/]+\/close$/.test(url)) {
        closeRequests.push(url);
        return new Response(
          JSON.stringify({ success: true, data: { sessionId: 'sess_1', status: 'CLOSED', closedAt: new Date().toISOString() } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/party/conversations')) {
        return new Response(JSON.stringify({ data: { conversations: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, getToken: async () => 'admin-token' },
    identity: { userId: 'admin_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    userRole: 'admin',
    onError: () => undefined,
    ...overrides,
  } as WidgetConfig;
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null || element.shadowRoot === null) throw new Error('widget shadow root not found');
  return element.shadowRoot;
}

function merchantsTab(): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')][1];
  if (tab === undefined) throw new Error('merchants tab not found');
  return tab;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  frameCounter = 0;
  FakeWebSocket.instances = [];
  queueRows = [];
  closeRequests = [];
  localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/** Drives the portal (keyless) socket through connect + session.join, landing an OPEN session. */
async function driveOpenSession(sessionId: string, status = 'OPEN'): Promise<FakeWebSocket> {
  await settle();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no portal socket opened');
  socket.open();
  // Staff handshake ack: no session, no seq (core's `staffAckJson` shape).
  socket.push('connection.ack', { protocolVersion: 1 });
  await settle();

  const join = socket.frames('session.join')[0];
  if (join === undefined) throw new Error('no session.join frame sent');
  // `push()` has no `ref` param, and the ack envelope needs one to correlate
  // — built directly instead.
  socket.onmessage?.({
    data: JSON.stringify({ v: 1, t: 'ack', id: frameId(), ref: join.id, ts: Date.now(), d: { ok: true, seq: 0 } }),
  });
  socket.push('session.updated', {
    session: {
      sessionId,
      status,
      mode: 'HUMAN',
      participants: [{ participantId: 'outlet_1', type: 'AGENT', displayName: 'Design Mart' }],
      createdAt: '2026-09-19T10:00:00.000Z',
    },
  });
  await settle();
  return socket;
}

describe('End conversation for a Merchants-tab-list-opened conversation', () => {
  it('appears once the portal conversation lands OPEN, and was hidden before that', async () => {
    queueRows = [
      { id: 'sess_1', status: 3, targetRole: 'merchant', storeName: 'Design Mart', chatType: 'admin' },
    ];

    mount(config());
    await settle();
    merchantsTab().click();
    await settle();

    const row = shadow().querySelector<HTMLButtonElement>('li.dh-mrow-item button');
    if (row === null) throw new Error('no merchants row rendered');
    row.click();
    await settle();

    // Before the portal session lands, the menu must not claim a live one.
    const toggle = shadow().querySelector<HTMLButtonElement>('.dh-hmenu-toggle');
    toggle?.click();
    await settle();
    let endItem = shadow().querySelector<HTMLElement>('.dh-hmenu-danger');
    expect(endItem?.hidden).toBe(true);
    toggle?.click(); // close

    await driveOpenSession('sess_1');

    toggle?.click();
    await settle();
    endItem = shadow().querySelector<HTMLElement>('.dh-hmenu-danger');
    expect(endItem?.hidden).toBe(false);
  });

  it('End conversation -> confirm calls POST /agent/sessions/:id/close, not the customer-flow close', async () => {
    queueRows = [
      { id: 'sess_1', status: 3, targetRole: 'merchant', storeName: 'Design Mart', chatType: 'admin' },
    ];

    mount(config());
    await settle();
    merchantsTab().click();
    await settle();
    shadow().querySelector<HTMLButtonElement>('li.dh-mrow-item button')?.click();
    await settle();
    await driveOpenSession('sess_1');

    shadow().querySelector<HTMLButtonElement>('.dh-hmenu-toggle')?.click();
    await settle();
    shadow().querySelector<HTMLButtonElement>('.dh-hmenu-danger')?.click();
    await settle();

    const confirmButton = shadow().querySelector<HTMLButtonElement>('.dh-confirm-end-danger');
    if (confirmButton === null) throw new Error('confirm surface did not render');
    confirmButton.click();
    await settle();

    expect(closeRequests).toEqual(['https://chat.example.com/chat-services/api/v1/agent/sessions/sess_1/close']);
  });
});
