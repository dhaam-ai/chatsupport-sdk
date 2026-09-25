// @vitest-environment jsdom
//
// The counterparty presence line, for a PORTAL mount opening a Merchants-tab
// row — the gap `presence-line.test.ts` does not cover. That file proves
// presence for a widget mounted DIRECTLY at `config.target` (OutletChatModal
// / "Message Admin"); an admin's general portal mount opens many
// conversations from one Messages-tab list without ever setting `target`, so
// `presenceTargetId` there is permanently `undefined` and the mechanism this
// file exercises — `portalPresenceTargetId`, resolved per-conversation in
// `openPortalConversation` and queried over `portalClient.queryPresence` —
// is what actually lights the line up for that flow.

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
  ackFor(refId: string, d: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t: 'ack', id: frameId(), ref: refId, ts: Date.now(), d }) });
  }
  frames(type: string): Array<{ id: string; d: Record<string, unknown> }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { t: string; id: string; d: Record<string, unknown> })
      .filter((frame) => frame.t === type);
  }
}

let partnerRows: readonly unknown[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
      if (url.includes('/party/conversations')) {
        return new Response(JSON.stringify({ data: { conversations: partnerRows } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/agent/queue')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
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

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function merchantsTab(): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')][1];
  if (tab === undefined) throw new Error('merchants tab not found');
  return tab;
}

async function merchantsRendered(): Promise<void> {
  await vi.waitFor(() => {
    const badges = [...shadow().querySelectorAll('.dh-mtab-count')].map((b) => b.textContent ?? '');
    expect(badges[1]).toBe('1');
  }, { timeout: 5000, interval: 20 });
}

beforeEach(() => {
  frameCounter = 0;
  FakeWebSocket.instances = [];
  localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  partnerRows = [];
});

describe('the counterparty presence line, for a portal-opened Merchants-tab conversation', () => {
  it('queries presence for the row\'s outlet once opened, and renders the answer — a live push updates it', async () => {
    partnerRows = [
      {
        sessionId: 'sess_1',
        customerId: 'admin_1',
        status: 1,
        targetRole: 'merchant',
        targetId: 'outlet_9',
        storeName: 'Acme Outlet',
        conversationType: 4,
        direction: 'outgoing',
      },
    ];

    mount(config());
    await merchantsRendered();

    // The portal socket is lazy — `ensurePortalClient()` first runs inside
    // `openPortalConversation`, i.e. on this very click. Nothing to drive
    // before it.
    merchantsTab().click();
    shadow().querySelector<HTMLButtonElement>('.dh-mrow-btn')!.click();
    await settle();

    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket opened');
    socket.open();
    socket.push('connection.ack', { protocolVersion: 1 });
    await settle();

    const join = socket.frames('session.join')[0];
    expect(join).toBeDefined();
    socket.ackFor(join!.id, { ok: true, seq: 0 });
    socket.push('session.updated', {
      session: {
        sessionId: 'sess_1',
        status: 'OPEN',
        mode: 'HUMAN',
        participants: [{ participantId: 'outlet_9', type: 'AGENT', displayName: 'Outlet 9' }],
        createdAt: '2026-09-19T10:00:00.000Z',
      },
    });
    await settle();

    const query = socket.frames('presence.query')[0];
    expect(query?.d).toEqual({ participantIds: ['outlet_9'] });
    socket.ackFor(query!.id, { ok: true, presences: [{ participantId: 'outlet_9', status: 'ONLINE' }] });
    await settle();

    const line = shadow().querySelector<HTMLElement>('.dh-presence-line');
    const dot = shadow().querySelector<HTMLElement>('.dh-presence-dot');
    const text = shadow().querySelector<HTMLElement>('.dh-presence-text');
    expect(line?.hidden).toBe(false);
    expect(dot?.getAttribute('data-online')).toBe('true');
    expect(text?.textContent).toBe('Online');

    // A live push, independent of another query.
    socket.push('presence.update', { participantId: 'outlet_9', status: 'OFFLINE' });
    await settle();
    const dot2 = shadow().querySelector<HTMLElement>('.dh-presence-dot');
    const text2 = shadow().querySelector<HTMLElement>('.dh-presence-text');
    expect(dot2?.getAttribute('data-online')).toBe('false');
    expect(text2?.textContent).toBe('Offline');
  });

  it('stays hidden for a plain customer-DM row — no PARTNER counterparty to show', async () => {
    partnerRows = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
        if (url.includes('/agent/queue')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'sess_cust', status: 1, customer: { displayName: 'Jane Doe' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/party/conversations')) {
          return new Response(JSON.stringify({ data: { conversations: [] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    mount(config());
    await vi.waitFor(() => {
      expect(shadow().querySelector('.dh-mrow-item')).not.toBeNull();
    }, { timeout: 5000, interval: 20 });

    shadow().querySelector<HTMLButtonElement>('.dh-mrow-btn')!.click();
    await settle();

    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket opened');
    socket.open();
    socket.push('connection.ack', { protocolVersion: 1 });
    await settle();

    const join = socket.frames('session.join')[0];
    if (join !== undefined) {
      socket.ackFor(join.id, { ok: true, seq: 0 });
      socket.push('session.updated', {
        session: {
          sessionId: 'sess_cust',
          status: 'OPEN',
          mode: 'HUMAN',
          participants: [{ participantId: 'cus_1', type: 'CUSTOMER', displayName: 'Jane Doe' }],
          createdAt: '2026-09-19T10:00:00.000Z',
        },
      });
      await settle();
    }

    expect(socket.frames('presence.query')).toEqual([]);
    expect(shadow().querySelector<HTMLElement>('.dh-presence-line')?.hidden).toBe(true);
  });
});
