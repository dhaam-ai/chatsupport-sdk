// @vitest-environment jsdom
//
// The PORTAL (staff) half of the closed-session rule that
// `closed-session-hidden.test.ts` holds for the customer half: a conversation
// the merchant has CLOSED is off the staff queue too, and a RESOLVED one is
// NOT — "resolved and closed are 2 different states" (user, 2026-09-14).
//
// Mounts the REAL widget in portal-admin mode against a stubbed
// `GET /agent/queue`, so every row here travels the real path:
//
//   fetch → listPortalQueue → readQueueRow → readQueueStatus (the NUMERIC
//   code chat-service actually puts on the wire: OPEN=1, WAITING_FOR_AGENT=2,
//   ASSIGNED=3, CLOSED=4, RESOLVED=5, ON_HOLD=6) → portalQueueRowToSummary →
//   createPortalMessagesScreen.render → the rendered DOM.
//
// Fixtures deliberately carry the integer, never `status: 'CLOSED'`: a
// hand-built summary string would prove the filter works on a shape the queue
// never actually produces, which is exactly the hole this file exists to
// close.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

/** Assembled at runtime — a contiguous literal trips secret scanners. */
const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

/** Opens nothing and reports nothing; portal mode never connects this socket. */
class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

/** chat-service's `ChatStatus` DB integers, as `/agent/queue` leaks them. */
const CODE = {
  OPEN: 1,
  WAITING_FOR_AGENT: 2,
  ASSIGNED: 3,
  CLOSED: 4,
  RESOLVED: 5,
  ON_HOLD: 6,
} as const;

let queueRows: readonly unknown[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
      if (url.includes('/agent/queue')) {
        return new Response(JSON.stringify({ data: queueRows }), {
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
    // Swallowed: the customer-flow client still exists in portal mode and its
    // own failures are expected here, not the subject of this file.
    onError: () => undefined,
    ...overrides,
  } as WidgetConfig;
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null || element.shadowRoot === null) throw new Error('widget shadow root not found');
  return element.shadowRoot;
}

/** The names on the rows a staff member can actually SEE in the open tab. */
function visibleRowNames(): readonly string[] {
  return [...shadow().querySelectorAll<HTMLElement>('.dh-mrow-item')]
    .filter((row) => !row.hidden)
    .map((row) => row.querySelector('.dh-mrow-name')?.textContent ?? '');
}

/** The two portal tab badges, in DOM order: Customers, then Merchants. */
function tabCounts(): { readonly customers: string; readonly merchants: string } {
  const badges = [...shadow().querySelectorAll('.dh-mtab-count')].map((b) => b.textContent ?? '');
  return { customers: badges[0] ?? '', merchants: badges[1] ?? '' };
}

/** Clicks the second tab — Merchants for an admin viewer. */
function openMerchantsTab(): void {
  const tabs = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-mtab')];
  const merchants = tabs[1];
  if (merchants === undefined) throw new Error('merchants tab not found');
  merchants.click();
}

/** Clicks the queue row whose name reads `name`. */
function clickRow(name: string): void {
  const row = [...shadow().querySelectorAll<HTMLElement>('.dh-mrow-item')].find(
    (candidate) => candidate.querySelector('.dh-mrow-name')?.textContent === name,
  );
  const button = row?.querySelector<HTMLButtonElement>('.dh-mrow-btn');
  if (button === undefined || button === null) throw new Error(`no queue row named ${name}`);
  button.click();
}

/** The header's Back control — the way out of an open conversation. */
function clickBack(): void {
  const back = shadow().querySelector<HTMLButtonElement>('.dh-back');
  if (back === null) throw new Error('back button not found');
  back.click();
}

/** Waits for the first `/agent/queue` poll to land and paint. */
async function queueRendered(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(shadow().querySelector('.dh-mrow-item')).not.toBeNull();
    },
    // Generous, because this waits on a real `fetch` promise chain on a
    // machine that may be loaded — not because anything here is slow.
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
});

describe('portal queue — a CLOSED conversation is off the staff list', () => {
  it('renders the open conversation and withholds the closed one', async () => {
    queueRows = [
      { id: 'sess_open', status: CODE.OPEN, customer: { displayName: 'Jane Doe' } },
      { id: 'sess_closed', status: CODE.CLOSED, customer: { displayName: 'Closed Casey' } },
    ];

    mount(config());
    await queueRendered();

    expect(visibleRowNames()).toEqual(['Jane Doe']);
  });

  it('counts only what it renders — a closed row is out of both tab badges', async () => {
    // A badge reading "2" over one visible row is worse than either the old
    // behaviour or the new one: it tells a staff member the queue is hiding
    // work from them. The counts in `applyFilter()` and the rows come from
    // the SAME array, so the withholding has to happen upstream of both.
    queueRows = [
      { id: 'sess_open', status: CODE.OPEN, customer: { displayName: 'Jane Doe' } },
      { id: 'sess_closed', status: CODE.CLOSED, customer: { displayName: 'Closed Casey' } },
      { id: 'sess_m_live', status: CODE.ASSIGNED, targetRole: 'merchant', storeName: 'Acme Store' },
      { id: 'sess_m_closed', status: CODE.CLOSED, targetRole: 'merchant', storeName: 'Gone Goods' },
    ];

    mount(config());
    await queueRendered();

    expect(tabCounts()).toEqual({ customers: '1', merchants: '1' });
    expect(visibleRowNames()).toEqual(['Jane Doe']);

    openMerchantsTab();
    expect(visibleRowNames()).toEqual(['Acme Store']);
    expect(tabCounts()).toEqual({ customers: '1', merchants: '1' });
  });

  it('keeps a RESOLVED conversation listed, counted and labelled', async () => {
    // The user's explicit correction: "resolved and closed are 2 different
    // states, so dont show the closed session on conversation list". RESOLVED
    // is finished but still openable and still replyable — it keeps its row,
    // its place in the badge, and the word that distinguishes it. If this
    // ever fails because someone generalised the rule to "the terminal ones",
    // that is the regression, not this test.
    queueRows = [
      { id: 'sess_resolved', status: CODE.RESOLVED, customer: { displayName: 'Resolved Rita' } },
      { id: 'sess_closed', status: CODE.CLOSED, customer: { displayName: 'Closed Casey' } },
    ];

    mount(config());
    await queueRendered();

    expect(visibleRowNames()).toEqual(['Resolved Rita']);
    expect(tabCounts().customers).toBe('1');

    const pill = shadow().querySelector('.dh-mrow-item:not([hidden]) .dh-mrow-status-pill');
    expect(pill?.textContent).toBe('Resolved');
    expect(pill?.getAttribute('data-status')).toBe('RESOLVED');
  });

  it('leaves every other status alone — waiting, assigned and on-hold still queue up', async () => {
    // `=== 'CLOSED'` and not "the finished ones", so a status nobody thought
    // about here cannot be swept in by accident.
    queueRows = [
      { id: 'sess_waiting', status: CODE.WAITING_FOR_AGENT, customer: { displayName: 'Waiting Wanda' } },
      { id: 'sess_assigned', status: CODE.ASSIGNED, customer: { displayName: 'Assigned Amir' } },
      { id: 'sess_hold', status: CODE.ON_HOLD, customer: { displayName: 'Held Hana' } },
      { id: 'sess_closed', status: CODE.CLOSED, customer: { displayName: 'Closed Casey' } },
    ];

    mount(config());
    await queueRendered();

    expect(visibleRowNames()).toEqual(['Waiting Wanda', 'Assigned Amir', 'Held Hana']);
    expect(tabCounts().customers).toBe('3');
  });

  it('does not pull a closed conversation out from under the admin reading it', async () => {
    // R1. The queue re-polls every 20s, so a conversation someone else closes
    // can disappear mid-read. `currentPortalSessionId` — the thread actually
    // on screen — is the exemption, and it is cleared the moment the admin
    // navigates away, so the row survives exactly as long as they are in it.
    vi.useFakeTimers();
    try {
      const reading = { id: 'sess_reading', customer: { displayName: 'Reading Rae' } };
      const other = { id: 'sess_other', status: CODE.OPEN, customer: { displayName: 'Other Ollie' } };
      queueRows = [{ ...reading, status: CODE.ASSIGNED }, other];

      const widget = mount(config());
      widget.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(visibleRowNames()).toEqual(['Reading Rae', 'Other Ollie']);

      clickRow('Reading Rae');
      await vi.advanceTimersByTimeAsync(0);

      // Closed by the merchant while the admin is reading it.
      queueRows = [{ ...reading, status: CODE.CLOSED }, other];
      await vi.advanceTimersByTimeAsync(20_000);
      expect(visibleRowNames()).toEqual(['Reading Rae', 'Other Ollie']);

      // Backing out ends the exemption: the next poll drops it like any other.
      clickBack();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(visibleRowNames()).toEqual(['Other Ollie']);
    } finally {
      vi.useRealTimers();
    }
  });
});
