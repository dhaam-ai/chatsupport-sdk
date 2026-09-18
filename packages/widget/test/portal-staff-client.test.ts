// node, vi.stubGlobal('fetch', …). The one non-trivial piece of logic
// `./portal/portal-staff-client.ts` adds is `readQueueRow`'s defensive
// parsing of GET /agent/queue's rows — this exercises that, plus the
// PortalApiError status mapping, so a malformed or missing field never
// silently produces a Customers-tab row that can't be opened.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStaffHistorySource, listPortalQueue, PortalApiError } from '../src/portal/portal-staff-client.js';

const OPTIONS = {
  apiUrl: 'https://chat.example.com',
  wsUrl: 'wss://chat.example.com',
  getToken: async () => 'test-token',
  senderId: 'admin_1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('listPortalQueue — GET /agent/queue row parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('projects well-formed rows, pulling nested customer/lastMessage fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 'sess_1',
              status: 'OPEN',
              customer: { displayName: 'Jane Doe' },
              lastMessage: { content: 'Where is my order?' },
            },
          ],
        }),
      ),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows).toEqual([
      {
        sessionId: 'sess_1',
        status: 'OPEN',
        customerName: 'Jane Doe',
        customerEmail: null,
        lastMessage: 'Where is my order?',
        hasMessage: true,
        chatType: 'customer',
        targetRole: null,
        targetId: null,
        storeName: null,
        merchantName: null,
        merchantEmail: null,
        subject: null,
        topic: null,
      },
    ]);
  });

  it('drops rows with no string id instead of throwing or fabricating one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { id: 'sess_1', status: 'OPEN' },
            { status: 'OPEN' }, // no id — must be dropped
            null, // not an object — must be dropped
          ],
        }),
      ),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows.map((r) => r.sessionId)).toEqual(['sess_1']);
  });

  it('falls back to null customerName/lastMessage when those fields are absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'sess_2', status: 'WAITING_FOR_AGENT' }] })),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows).toEqual([
      {
        sessionId: 'sess_2',
        status: 'WAITING_FOR_AGENT',
        customerName: null,
        customerEmail: null,
        lastMessage: null,
        hasMessage: true,
        chatType: 'customer',
        targetRole: null,
        targetId: null,
        storeName: null,
        merchantName: null,
        merchantEmail: null,
        subject: null,
        topic: null,
      },
    ]);
  });

  it('flags hasMessage: false when lastMessage is explicitly null (ghost session)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 'sess_ghost',
              status: 'OPEN',
              customer: { displayName: 'amit83', email: 'amit83@gmail.com' },
              lastMessage: null,
              unreadCount: 0,
            },
          ],
        }),
      ),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows).toEqual([
      {
        sessionId: 'sess_ghost',
        status: 'OPEN',
        customerName: 'amit83',
        customerEmail: 'amit83@gmail.com',
        lastMessage: null,
        hasMessage: false,
        chatType: 'customer',
        targetRole: null,
        targetId: null,
        storeName: null,
        merchantName: null,
        merchantEmail: null,
        subject: null,
        topic: null,
      },
    ]);
  });

  it('maps the live /agent/queue endpoint\'s numeric status code to the SDK\'s string name', async () => {
    // The real endpoint leaks chat-service's raw ChatStatus DB integer
    // (enums.ts: OPEN=1, WAITING_FOR_AGENT=2, ASSIGNED=3, CLOSED=4,
    // RESOLVED=5, ON_HOLD=6) rather than the canonical string name — see
    // readQueueStatus's own comment for why leaving this unmapped crashes
    // ui/session-status.ts's SESSION_STATUS_WORDS lookup on every row.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'sess_3', status: 3 }] })),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows[0]?.status).toBe('ASSIGNED');
  });

  it('falls back to OPEN for a status code/name it does not recognize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'sess_4', status: 99 }] })),
    );

    const rows = await listPortalQueue(OPTIONS);
    expect(rows[0]?.status).toBe('OPEN');
  });

  it('treats a non-array "data" as an empty queue rather than crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: null })));
    const rows = await listPortalQueue(OPTIONS);
    expect(rows).toEqual([]);
  });

  it('raises PortalApiError with the HTTP status on a non-2xx response — same identical-401 contract examples/admin-panel documents (bad token / expired token / non-staff role all answer the same)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(listPortalQueue(OPTIONS)).rejects.toMatchObject(
      expect.objectContaining({ status: 401 }) as Partial<PortalApiError>,
    );
  });

  it('reports a network/CORS failure as PortalApiError status 0 rather than an unhandled TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listPortalQueue(OPTIONS)).rejects.toMatchObject(
      expect.objectContaining({ status: 0 }) as Partial<PortalApiError>,
    );
  });
});

describe('createStaffHistorySource — routes by identity, same envelope shape either way', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls /agent/sessions/{id}/messages for admin/manager (isMerchantPortal unset)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { messages: [], hasMore: false } }));
    vi.stubGlobal('fetch', fetchMock);

    const source = createStaffHistorySource(OPTIONS);
    await source.listMessages({ sessionId: 'sess_1', limit: 30 });

    const calledUrl = new URL((fetchMock.mock.calls[0] as [string | URL])[0] as string);
    expect(calledUrl.pathname).toBe('/chat-services/api/v1/agent/sessions/sess_1/messages');
    expect(calledUrl.searchParams.has('outletId')).toBe(false);
  });

  it('calls /party/sessions/{id}/messages for a merchant/outlet identity, with outletId when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { messages: [], hasMore: false } }));
    vi.stubGlobal('fetch', fetchMock);

    const source = createStaffHistorySource({ ...OPTIONS, isMerchantPortal: true, outletId: 'outlet_42' });
    await source.listMessages({ sessionId: 'sess_1', limit: 30 });

    const calledUrl = new URL((fetchMock.mock.calls[0] as [string | URL])[0] as string);
    expect(calledUrl.pathname).toBe('/chat-services/api/v1/party/sessions/sess_1/messages');
    expect(calledUrl.searchParams.get('outletId')).toBe('outlet_42');
  });

  it('omits outletId from /party/sessions/{id}/messages when none is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { messages: [], hasMore: false } }));
    vi.stubGlobal('fetch', fetchMock);

    const source = createStaffHistorySource({ ...OPTIONS, isMerchantPortal: true });
    await source.listMessages({ sessionId: 'sess_1', limit: 30 });

    const calledUrl = new URL((fetchMock.mock.calls[0] as [string | URL])[0] as string);
    expect(calledUrl.searchParams.has('outletId')).toBe(false);
  });

  it('still degrades to an empty page on 401/403, defense in depth for an unrouted role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    const source = createStaffHistorySource({ ...OPTIONS, isMerchantPortal: true });
    await expect(source.listMessages({ sessionId: 'sess_1', limit: 30 })).resolves.toEqual({
      messages: [],
      hasMore: false,
    });
  });
});
