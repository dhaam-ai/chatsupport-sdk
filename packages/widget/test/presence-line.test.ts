// @vitest-environment jsdom
//
// The counterparty's Online/Offline line, for a TARGETED mount only
// (OutletChatModal / "Message Admin") — `presenceTargetId` in widget.ts.

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

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, getToken: async () => 'admin-token' },
    identity: { userId: 'admin_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    userRole: 'admin',
    target: { role: 'merchant', id: 'outlet_9' },
    onError: () => undefined,
    ...overrides,
  } as WidgetConfig;
}

/** A plain customer mount — built from scratch, not via `config()`'s
 * overrides: `target`/`userRole` are absent keys here, not `undefined`
 * values, which is what `exactOptionalPropertyTypes` demands. */
function customerConfig(): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, getToken: async () => 'admin-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
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

beforeEach(() => {
  frameCounter = 0;
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/** Drives connect + hello ack, with a real session snapshot — `connect()` needs one to resolve for a targeted mount. */
async function driveConnected(): Promise<FakeWebSocket> {
  await settle();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket opened');
  socket.open();
  socket.push('connection.ack', {
    protocolVersion: 1,
    seq: 0,
    session: {
      sessionId: 'sess_1',
      status: 'OPEN',
      mode: 'HUMAN',
      participants: [{ participantId: 'outlet_9', type: 'AGENT', displayName: 'Outlet 9' }],
      createdAt: '2026-09-19T10:00:00.000Z',
    },
  });
  await settle();
  return socket;
}

describe('the counterparty presence line (targeted mount only)', () => {
  it('queries presence for config.target.id once connected, and renders the ONLINE answer', async () => {
    mount(config());
    const socket = await driveConnected();

    const query = socket.frames('presence.query')[0];
    expect(query?.d).toEqual({ participantIds: ['outlet_9'] });

    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'ack',
        id: frameId(),
        ref: query!.id,
        ts: Date.now(),
        d: { ok: true, presences: [{ participantId: 'outlet_9', status: 'ONLINE' }] },
      }),
    });
    await settle();

    const line = shadow().querySelector<HTMLElement>('.dh-presence-line');
    const dot = shadow().querySelector<HTMLElement>('.dh-presence-dot');
    const text = shadow().querySelector<HTMLElement>('.dh-presence-text');
    expect(line?.hidden).toBe(false);
    expect(dot?.getAttribute('data-online')).toBe('true');
    expect(text?.textContent).toBe('Online');
  });

  it('renders OFFLINE the same way for AWAY/DND/OFFLINE, and updates live on a presence.update push', async () => {
    mount(config());
    const socket = await driveConnected();
    const query = socket.frames('presence.query')[0];
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'ack',
        id: frameId(),
        ref: query!.id,
        ts: Date.now(),
        d: { ok: true, presences: [{ participantId: 'outlet_9', status: 'AWAY' }] },
      }),
    });
    await settle();

    const dot = shadow().querySelector<HTMLElement>('.dh-presence-dot');
    const text = shadow().querySelector<HTMLElement>('.dh-presence-text');
    expect(dot?.getAttribute('data-online')).toBe('false');
    expect(text?.textContent).toBe('Offline');

    // Live push, independent of another query.
    socket.push('presence.update', { participantId: 'outlet_9', status: 'ONLINE' });
    await settle();
    expect(dot?.getAttribute('data-online')).toBe('true');
    expect(text?.textContent).toBe('Online');
  });

  it('stays hidden for a plain customer mount — no presenceTargetId to query', async () => {
    mount(customerConfig());
    await driveConnected();

    const line = shadow().querySelector<HTMLElement>('.dh-presence-line');
    expect(line?.hidden).toBe(true);
    expect(FakeWebSocket.instances[0]?.frames('presence.query')).toEqual([]);
  });
});
