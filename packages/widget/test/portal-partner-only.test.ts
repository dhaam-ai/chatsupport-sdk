// @vitest-environment jsdom
//
// WidgetConfig.partnerOnly: dh-store-react is an outlet management console,
// not the tenant's support console — an admin login there should be able to
// talk to outlets (Merchants tab) but never read or reply to a real
// end-customer conversation. The tab itself stays visible and clickable (the
// user explicitly asked NOT to hide it) — it just never gets real customer
// rows, same as an ordinary empty queue.
//
// Mounts the real widget against a stubbed `/agent/queue` (customer rows)
// and `/party/conversations?with=partner` (merchant rows), so this proves
// the fetch itself is skipped, not just that nothing happens to render.

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

let queueRows: readonly unknown[] = [];
let partnerRows: readonly unknown[] = [];
let queueFetchCount = 0;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
      if (url.includes('/agent/queue')) {
        queueFetchCount++;
        return new Response(JSON.stringify({ data: queueRows }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/party/conversations')) {
        return new Response(JSON.stringify({ data: { conversations: partnerRows } }), {
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

function customersTab(): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')][0];
  if (tab === undefined) throw new Error('customers tab not found');
  return tab;
}

function merchantsTab(): HTMLButtonElement {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')][1];
  if (tab === undefined) throw new Error('merchants tab not found');
  return tab;
}

async function merchantsRendered(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(tabCounts().merchants).toBe('1');
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
  queueRows = [];
  partnerRows = [];
  queueFetchCount = 0;
});

describe('portal partnerOnly — Customers tab stays visible, never gets real data', () => {
  it('never fetches /agent/queue and renders no customer rows, even though the server has some', async () => {
    queueRows = [{ id: 'sess_cust', status: 1, customer: { displayName: 'Jane Doe' } }];
    partnerRows = [{ id: 'sess_partner', status: 3, targetRole: 'merchant', storeName: 'Acme Store', chatType: 'admin' }];

    mount(config({ partnerOnly: true }));
    await merchantsRendered();

    expect(queueFetchCount).toBe(0);
    expect(tabCounts()).toEqual({ customers: '0', merchants: '1' });
    expect(visibleRowNames()).toEqual([]);
  });

  it('leaves the Customers tab visible and clickable, just empty', async () => {
    queueRows = [{ id: 'sess_cust', status: 1, customer: { displayName: 'Jane Doe' } }];
    partnerRows = [{ id: 'sess_partner', status: 3, targetRole: 'merchant', storeName: 'Acme Store', chatType: 'admin' }];

    mount(config({ partnerOnly: true }));
    await merchantsRendered();

    expect(customersTab().hidden).toBeFalsy();
    customersTab().click();
    expect(visibleRowNames()).toEqual([]);
    expect(shadow().querySelector('.dh-messages-empty')?.textContent).toBe('No customer conversations yet.');
  });

  it('still fetches and shows real Merchants-tab data for the same admin', async () => {
    partnerRows = [{ id: 'sess_partner', status: 3, targetRole: 'merchant', storeName: 'Acme Store', chatType: 'admin' }];

    mount(config({ partnerOnly: true }));
    await merchantsRendered();

    merchantsTab().click();
    expect(visibleRowNames()).toEqual(['Acme Store']);
  });

  it('without partnerOnly, the ordinary admin still sees real customer rows (no regression)', async () => {
    queueRows = [{ id: 'sess_cust', status: 1, customer: { displayName: 'Jane Doe' } }];

    mount(config());
    await vi.waitFor(() => {
      expect(shadow().querySelector('.dh-mrow-item')).not.toBeNull();
    }, { timeout: 5000, interval: 20 });

    expect(queueFetchCount).toBeGreaterThan(0);
    expect(visibleRowNames()).toEqual(['Jane Doe']);
  });
});
