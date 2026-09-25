// @vitest-environment jsdom
//
// Regression: a merchant/manager's GENERAL (untargeted) mount — every plain
// outlet login before it opens a specific store chat — needs `store.client`
// live so a host can `switchSession()` into a partner conversation an admin
// started (see dh-store-react's `switchToIncomingPartnerChat`). `isPortalStaff`
// used to skip `store.client.connect()` for every staff/party identity,
// admin included, which left a merchant/manager with NO live connection at
// all while untargeted — `switchSession` had nothing to switch. Admin keeps
// skipping it: their live channel for that mode is the separate
// `portalClient` connection, and connecting `store.client` too would only
// mint a spurious SUPPORT session nothing reads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    // A real host (dh-store-react's ChatWidgetMount.tsx) always supplies
    // `getToken` directly — never bare `tokenEndpoint` — for a portal
    // identity. `isPortalStaff` (widget.ts) checks `auth.getToken !==
    // undefined` specifically, so a `tokenEndpoint`-only config here would
    // leave it false for every userRole and this suite would pass for the
    // wrong reason.
    auth: { publishableKey: PK_TEST, getToken: async () => 'tok' },
    identity: { userId: 'outlet_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
    ...overrides,
  } as WidgetConfig;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  FakeWebSocket.instances = [];
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
      if (url.includes('/party/conversations') || url.includes('/agent/queue')) {
        return new Response(JSON.stringify({ success: true, data: { conversations: [], rows: [] } }), {
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
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('store.client.connect() on a general (untargeted) portal mount', () => {
  it('connects for userRole: merchant — the only live channel that mount has', async () => {
    mount(config({ userRole: 'merchant' } as Partial<WidgetConfig>));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('connects for userRole: manager, same reasoning as merchant', async () => {
    mount(config({ userRole: 'manager' } as Partial<WidgetConfig>));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('still skips it for userRole: admin — portalClient is their live channel instead', async () => {
    mount(config({ userRole: 'admin' } as Partial<WidgetConfig>));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('connects for a plain customer mount, unchanged', async () => {
    mount(config());
    await settle();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('connects for a merchant mount that names a target, unchanged (isPortalStaff is already false there)', async () => {
    mount(config({ userRole: 'merchant', target: { role: 'admin', id: 'admin_1' } } as Partial<WidgetConfig>));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('connects for an admin mount that names a target (targeted partner/customer chat)', async () => {
    mount(config({ userRole: 'admin', target: { role: 'customer', id: '14735' } } as Partial<WidgetConfig>));
    await settle();
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
