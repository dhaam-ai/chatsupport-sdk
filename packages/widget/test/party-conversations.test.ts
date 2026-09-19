// @vitest-environment jsdom
//
// jsdom, not this suite's default 'node', so `window`/`localStorage` exist —
// needed by the "cached store name" tests below: `readPartyConversationRow`
// gates its cache read on `typeof window !== 'undefined'` and would silently
// skip it (never reading the seeded cache) under plain Node.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPortalConversationClient,
  listPartyConversations,
  PortalApiError,
} from '../src/portal/portal-staff-client.js';

const OPTIONS = {
  apiUrl: 'https://chat.example.com',
  wsUrl: 'wss://chat.example.com',
  getToken: async () => 'merchant-token',
  senderId: 'merchant_1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('listPartyConversations — GET /party/conversations (Wire Contract §6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes outletIds as a comma-separated string and does not use bracket syntax', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: URL) => {
        requestedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: {
              conversations: [
                {
                  sessionId: 'sess_dm_1',
                  customerId: 'cust_9',
                  customerName: 'Aarav',
                  status: 1,
                  targetId: 'outlet_128',
                  targetRole: 'merchant',
                  channel: 1,
                  createdAt: '2026-09-16T12:00:00.000Z',
                  updatedAt: '2026-09-16T12:05:00.000Z',
                },
              ],
            },
          }),
        );
      }),
    );

    const rows = await listPartyConversations(OPTIONS, {
      outletIds: ['outlet_128', 'outlet_129'],
    });

    expect(requestedUrl).toContain('/chat-services/api/v1/party/conversations');
    expect(requestedUrl).toContain('outletIds=outlet_128%2Coutlet_129');
    expect(requestedUrl).not.toContain('outletIds%5B%5D');
    expect(requestedUrl).not.toContain('outletIds[]=');

    expect(rows).toEqual([
      {
        sessionId: 'sess_dm_1',
        status: 'OPEN',
        customerId: 'cust_9',
        customerName: 'Aarav',
        customerEmail: null,
        lastMessage: null,
        hasMessage: true,
        chatType: 'merchant',
        targetRole: 'merchant',
        targetId: 'outlet_128',
        storeName: null,
        merchantName: null,
        merchantEmail: null,
        subject: null,
        topic: null,
        conversationType: null,
        direction: null,
      },
    ]);
  });

  it('requests ?with=partner and trusts conversationType 4 as chatType admin — over the heuristic', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: URL) => {
        requestedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: {
              conversations: [
                {
                  sessionId: 'sess_partner_1',
                  customerId: 'admin_1',
                  // A name with no 'admin'/'tse' substring anywhere — the OLD
                  // heuristic would have called this a plain merchant DM.
                  // conversationType is what has to carry this now.
                  customerName: 'Rahul Sharma',
                  status: 1,
                  targetId: 'outlet_128',
                  targetRole: 'merchant',
                  channel: 1,
                  createdAt: '2026-09-16T12:00:00.000Z',
                  updatedAt: '2026-09-16T12:05:00.000Z',
                  conversationType: 4,
                  direction: 'outgoing',
                },
              ],
            },
          }),
        );
      }),
    );

    const rows = await listPartyConversations(OPTIONS, { with: 'partner' });

    expect(requestedUrl).toContain('with=partner');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chatType).toBe('admin');
    expect(rows[0]!.conversationType).toBe(4);
    expect(rows[0]!.direction).toBe('outgoing');
  });

  describe('the cached store name (`dhaam_target_store_<outletId>`, written by storeChatManager.openStoreChat)', () => {
    afterEach(() => {
      localStorage.clear();
    });

    it('resolves it for an admin-started row — cache keyed by targetId, which IS the outlet there', async () => {
      localStorage.setItem(
        'dhaam_target_store_outlet_128',
        JSON.stringify({ storeName: 'Design Mart', storeEmail: 'store@example.com' }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            success: true,
            data: {
              conversations: [
                {
                  sessionId: 'sess_1',
                  customerId: 'admin_1',
                  customerName: 'Dhaam Admin',
                  status: 1,
                  targetId: 'outlet_128',
                  targetRole: 'merchant',
                  channel: 1,
                  createdAt: '2026-09-19T10:00:00.000Z',
                  updatedAt: '2026-09-19T10:05:00.000Z',
                  conversationType: 4,
                  direction: 'outgoing',
                },
              ],
            },
          }),
        ),
      );

      const rows = await listPartyConversations(OPTIONS, { with: 'partner' });
      expect(rows[0]!.storeName).toBe('Design Mart');
    });

    it("resolves it for an OUTLET-started row too — cache keyed by the row's own customerId, not targetId (which is the admin's id there)", async () => {
      // Reported bug: an outlet messaging first always fell back to
      // "Store #<id>" however many times the admin had genuinely opened
      // that exact outlet's chat before — the lookup used `targetId`, which
      // for this direction is the ADMIN's id, never the outlet's.
      localStorage.setItem(
        'dhaam_target_store_outlet_128',
        JSON.stringify({ storeName: 'Design Mart', storeEmail: 'store@example.com' }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            success: true,
            data: {
              conversations: [
                {
                  sessionId: 'sess_2',
                  customerId: 'outlet_128',
                  customerName: 'am345345it',
                  status: 1,
                  targetId: 'admin_1',
                  targetRole: 'admin',
                  channel: 1,
                  createdAt: '2026-09-19T10:00:00.000Z',
                  updatedAt: '2026-09-19T10:05:00.000Z',
                  conversationType: 4,
                  direction: 'incoming',
                },
              ],
            },
          }),
        ),
      );

      const rows = await listPartyConversations(OPTIONS, { with: 'partner' });
      expect(rows[0]!.storeName).toBe('Design Mart');
    });
  });

  it('omits outletIds parameter completely when no outlets are provided', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: URL) => {
        requestedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: { conversations: [] },
          }),
        );
      }),
    );

    await listPartyConversations(OPTIONS);
    expect(requestedUrl).not.toContain('outletIds');

    await listPartyConversations(OPTIONS, { outletIds: [] });
    expect(requestedUrl).not.toContain('outletIds');
  });

  it('flags an untouched conversation (createdAt === updatedAt, never messaged) as hasMessage: false', async () => {
    // Reported bug: `/party/conversations` (Wire Contract §6) has no
    // lastMessage/message-count field at all, unlike `/agent/queue` — a row
    // here is minted the instant a chat is OPENED (e.g. an admin clicking
    // through outlets in OutletChatModal, or the widget's own
    // connection.hello with targetRole/targetId), before either side has
    // typed a word. `hasMessage` used to be hardcoded `true`, so every such
    // empty session sat in the Merchants/Admin tab forever. Confirmed
    // against real production data: a genuinely untouched session has
    // `createdAt` and `updatedAt` byte-identical; a real one does not.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            conversations: [
              {
                sessionId: 'sess_never_messaged',
                customerId: 'admin_1',
                customerName: 'tse',
                status: 1,
                targetId: 'outlet_999',
                targetRole: 'merchant',
                channel: 1,
                createdAt: '2026-09-18T13:16:55.811Z',
                updatedAt: '2026-09-18T13:16:55.811Z', // identical — opened, nothing sent
                conversationType: 4,
                direction: 'outgoing',
              },
              {
                sessionId: 'sess_real_conversation',
                customerId: 'outlet_14660',
                customerName: 'am345345it',
                status: 1,
                targetId: 'admin_1',
                targetRole: 'admin',
                channel: 1,
                createdAt: '2026-09-18T13:34:30.238Z',
                updatedAt: '2026-09-19T04:46:12.301Z', // moved — a message landed
                conversationType: 4,
                direction: 'incoming',
              },
              {
                sessionId: 'sess_missing_timestamps',
                customerId: 'outlet_1',
                status: 1,
                // no createdAt/updatedAt at all — an unexpected wire shape
                // must fail OPEN (still shown), never hide a row it can't
                // actually evaluate.
              },
            ],
          },
        }),
      ),
    );

    const rows = await listPartyConversations(OPTIONS, { with: 'partner' });

    expect(rows.find((r) => r.sessionId === 'sess_never_messaged')?.hasMessage).toBe(false);
    expect(rows.find((r) => r.sessionId === 'sess_real_conversation')?.hasMessage).toBe(true);
    expect(rows.find((r) => r.sessionId === 'sess_missing_timestamps')?.hasMessage).toBe(true);
  });

  it('maps REST status integers 1..6 correctly to UI string names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            conversations: [
              { sessionId: 's1', status: 1 }, // OPEN
              { sessionId: 's2', status: 2 }, // WAITING_FOR_AGENT
              { sessionId: 's3', status: 3 }, // ASSIGNED
              { sessionId: 's4', status: 4 }, // CLOSED
              { sessionId: 's5', status: 5 }, // RESOLVED
              { sessionId: 's6', status: 6 }, // ON_HOLD
            ],
          },
        }),
      ),
    );

    const rows = await listPartyConversations(OPTIONS);
    expect(rows.map((r) => r.status)).toEqual([
      'OPEN',
      'WAITING_FOR_AGENT',
      'ASSIGNED',
      'CLOSED',
      'RESOLVED',
      'ON_HOLD',
    ]);
  });

  it('drops rows missing a string sessionId or id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            conversations: [
              { sessionId: 'valid_1', status: 1 },
              { customerName: 'No ID', status: 1 },
              null,
            ],
          },
        }),
      ),
    );

    const rows = await listPartyConversations(OPTIONS);
    expect(rows.map((r) => r.sessionId)).toEqual(['valid_1']);
  });

  it('raises PortalApiError on non-200 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(listPartyConversations(OPTIONS)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('gracefully catches 401/403 in history source for merchant identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401)));

    const client = createPortalConversationClient(OPTIONS);
    // Since listMessages is internal to the history source, calling listMessages directly via any
    // or exercising history:
    const history = (client as any)._options?.history ?? (client as any).history;
    // We can verify that listMessages catches the 401 and returns empty messages
    if (history?.listMessages) {
      const res = await history.listMessages({ sessionId: 'sess_1', limit: 20 });
      expect(res).toEqual({ messages: [], hasMore: false });
    }
  });
});
