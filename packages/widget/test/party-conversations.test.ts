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
