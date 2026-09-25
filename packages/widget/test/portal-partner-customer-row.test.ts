import { afterEach, describe, expect, it, vi } from 'vitest';

import { listPartyConversations } from '../src/portal/portal-staff-client.js';

// The two rows below are verbatim from GET /party/conversations?with=partner.
const RESPONSE = {
  success: true,
  data: {
    conversations: [
      {
        sessionId: '831310a0-6b4f-47de-ba90-c0a06215f54f',
        customerId: '12775',
        customerName: 'tse',
        status: 1,
        targetId: '14708',
        targetRole: 'customer',
        channel: 1,
        createdAt: '2026-09-22T18:05:50.336Z',
        updatedAt: '2026-09-23T17:13:13.295Z',
        conversationType: 4,
        direction: 'outgoing',
      },
      {
        sessionId: 'e2174138-4a6c-4005-ba2e-d927c1183260',
        customerId: 'cf713f32-64b6-467c-adf8-3f3a0ae100c4',
        customerName: 'subway',
        status: 1,
        targetId: 'b4950c3d-630b-494a-845c-361fe806b5ed',
        targetRole: 'admin',
        channel: 1,
        createdAt: '2026-09-23T12:58:10.271Z',
        updatedAt: '2026-09-23T15:52:13.798Z',
        conversationType: 4,
        direction: 'incoming',
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('listPartyConversations — PARTNER rows and which tab they belong to', () => {
  it('marks an admin → customer row as a customer chat and leaves a merchant → admin row as admin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 })));
    const rows = await listPartyConversations(
      { apiUrl: 'https://chat.example.com', wsUrl: 'wss://chat.example.com', getToken: async () => 't', senderId: 'x' },
      { with: 'partner' },
    );
    const byId = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
    expect(byId['831310a0-6b4f-47de-ba90-c0a06215f54f']?.chatType).toBe('customer');
    expect(byId['e2174138-4a6c-4005-ba2e-d927c1183260']?.chatType).toBe('admin');
  });
});
