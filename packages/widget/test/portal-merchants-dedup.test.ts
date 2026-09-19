// @vitest-environment jsdom
//
// Reported bug: an admin's Merchants tab listed the SAME outlet twice — once
// under the label its own account carries ("am345345it", from the row the
// OUTLET started) and once as "Store #<id>" (from a separate row the ADMIN
// started with that same outlet). Each side can independently start a
// conversation with the other before either finds the counterparty's
// existing thread, and chat-service-node's data model keeps those as two
// distinct session rows — `GET /party/conversations?with=partner` returns
// both, and nothing before this de-duplicated them into one row per
// real-world counterparty before rendering.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
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
    auth: { publishableKey: PK_TEST, getToken: async () => 'staff-token' },
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

function visibleRowNames(): readonly string[] {
  return [...shadow().querySelectorAll<HTMLElement>('.dh-mrow-item')]
    .filter((row) => !row.hidden)
    .map((row) => row.querySelector('.dh-mrow-name')?.textContent ?? '');
}

function tabCounts(): { readonly customers: string; readonly merchants: string } {
  const badges = [...shadow().querySelectorAll('.dh-mtab-count')].map((b) => b.textContent ?? '');
  return { customers: badges[0] ?? '', merchants: badges[1] ?? '' };
}

function merchantsTab(): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')][1];
  if (tab === undefined) throw new Error('merchants tab not found');
  return tab;
}

async function merchantsRendered(expectedCount: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(tabCounts().merchants).toBe(expectedCount);
    },
    { timeout: 5000, interval: 20 },
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', SilentSocket);
  stubFetch();
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  partnerRows = [];
});

describe('the Merchants tab collapses to one row per counterparty', () => {
  it('collapses an outlet-started and an admin-started session for the SAME outlet, both still OPEN, into one row', async () => {
    // The reported screenshot: "Store #14660" and "am345345it" both showing
    // "Open" side by side in the Merchants tab — the exact pairing this
    // reproduces (outlet 9 messaged admin first; admin later opened their
    // own thread with the same outlet via OutletChatModal, neither aware of
    // the other's session). A CLOSED counterpart would already be hidden by
    // `portalVisibleSessions`'s own filter regardless of this dedup, so
    // BOTH here are genuinely OPEN — the case that filter cannot help with.
    partnerRows = [
      // Newest first (as the real endpoint returns) — the outlet's own
      // opener.
      {
        sessionId: 'sess_outlet_started',
        customerId: 'outlet_9',
        customerName: 'am345345it',
        status: 1, // OPEN
        targetRole: 'admin',
        targetId: 'admin_1',
        conversationType: 4,
        direction: 'incoming',
      },
      // Older, but ALSO open — the admin's own, separate thread with the
      // same outlet.
      {
        sessionId: 'sess_admin_started',
        customerId: 'admin_1',
        status: 1, // OPEN
        targetRole: 'merchant',
        targetId: 'outlet_9',
        storeName: 'Design Mart',
        conversationType: 4,
        direction: 'outgoing',
      },
    ];

    mount(config());
    await merchantsRendered('1');

    merchantsTab().click();
    // Newest-first order (the outlet's own row arrived first) decides which
    // of the two OPEN rows for this pair is kept — not the label itself.
    expect(visibleRowNames()).toEqual(['am345345it']);
  });

  it('prefers an OPEN duplicate over an already-CLOSED one for the same counterparty, wherever it sits in the list', async () => {
    partnerRows = [
      // Newest first, but this one is the CLOSED one.
      {
        sessionId: 'sess_admin_started_old',
        customerId: 'admin_1',
        status: 4, // CLOSED
        targetRole: 'merchant',
        targetId: 'outlet_9',
        storeName: 'Design Mart',
        conversationType: 4,
        direction: 'outgoing',
      },
      // Older in the list, but the one still OPEN.
      {
        sessionId: 'sess_outlet_started_open',
        customerId: 'outlet_9',
        customerName: 'am345345it',
        status: 1, // OPEN
        targetRole: 'admin',
        targetId: 'admin_1',
        conversationType: 4,
        direction: 'incoming',
      },
    ];

    mount(config());
    await merchantsRendered('1');

    merchantsTab().click();
    expect(visibleRowNames()).toEqual(['am345345it']);
  });

  it('leaves genuinely different outlets as separate rows — dedup is per counterparty, not a blanket collapse', async () => {
    partnerRows = [
      {
        sessionId: 'sess_outlet_9',
        customerId: 'admin_1',
        status: 1,
        targetRole: 'merchant',
        targetId: 'outlet_9',
        storeName: 'Design Mart',
        conversationType: 4,
        direction: 'outgoing',
      },
      {
        sessionId: 'sess_outlet_10',
        customerId: 'admin_1',
        status: 1,
        targetRole: 'merchant',
        targetId: 'outlet_10',
        storeName: 'Acme Store',
        conversationType: 4,
        direction: 'outgoing',
      },
    ];

    mount(config());
    await merchantsRendered('2');

    merchantsTab().click();
    expect(visibleRowNames().sort()).toEqual(['Acme Store', 'Design Mart']);
  });
});
