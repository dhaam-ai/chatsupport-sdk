import { describe, expect, it, vi } from 'vitest';

import { RestClient, RestError } from './rest-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Typed wrapper around `vi.fn` — an inline `vi.fn(async () => ...)` infers a
 * zero-parameter mock, which makes `.mock.calls[0]` a zero-length tuple
 * (`noUncheckedIndexedAccess` then rejects indexing into it at all). Typing
 * the implementation parameter as `typeof fetch` fixes the inferred call
 * shape regardless of how many params the inline lambda actually declares.
 */
function fetchMock(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return vi.fn(impl);
}

describe('RestClient', () => {
  describe('listMessages', () => {
    it('calls GET /sessions/{id}/messages with limit and before as query params', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, { messages: [], hasMore: false }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.listMessages('sess1', { token: 'tok' }, { limit: 20, before: 'msg1' });

      const [url] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/messages?limit=20&before=msg1');
    });

    it('omits query params entirely when not provided', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, { messages: [], hasMore: false }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.listMessages('sess1', { token: 'tok' });

      const [url] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/messages');
    });

    it('sends Authorization + X-Publishable-Key when authenticated', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, { messages: [], hasMore: false }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.listMessages('sess1', { token: 'tok-1' });

      const [, init] = fetchImpl.mock.calls[0] ?? [];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok-1');
      expect(headers['X-Publishable-Key']).toBe('pk1');
      expect(headers['X-Guest-Id']).toBeUndefined();
    });

    it('sends X-Guest-Id instead of Authorization for a guest caller', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, { messages: [], hasMore: false }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.listMessages('sess1', { guestId: 'guest_abc' });

      const [, init] = fetchImpl.mock.calls[0] ?? [];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['X-Guest-Id']).toBe('guest_abc');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('returns the parsed page on success', async () => {
      const page = { messages: [{ id: 'm1' }], hasMore: true };
      const fetchImpl = fetchMock(async () => jsonResponse(200, page));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      const result = await client.listMessages('sess1', { token: 'tok' });

      expect(result).toEqual(page);
    });

    it('throws a RestError carrying the status on a non-2xx response', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(404, { message: 'session not found' }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await expect(client.listMessages('sess1', { token: 'tok' })).rejects.toThrow(RestError);
      await expect(client.listMessages('sess1', { token: 'tok' })).rejects.toMatchObject({ status: 404, message: 'session not found' });
    });

    it('falls back to a generic message if the error body is not JSON', async () => {
      const fetchImpl = fetchMock(async () => new Response('not json', { status: 500 }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await expect(client.listMessages('sess1', { token: 'tok' })).rejects.toMatchObject({ status: 500 });
    });

    it('strips a trailing slash from apiUrl', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, { messages: [], hasMore: false }));
      const client = new RestClient({ apiUrl: 'https://api.example.com/', publishableKey: 'pk1', fetchImpl });

      await client.listMessages('sess1', { token: 'tok' });

      const [url] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/messages');
    });
  });

  describe('uploadAttachment', () => {
    it('POSTs multipart form data to /sessions/{id}/attachments', async () => {
      const attachment = { url: 'https://x/y.png', fileName: 'y.png', mimeType: 'image/png', size: 3, mediaType: 'image' };
      const fetchImpl = fetchMock(async () => jsonResponse(201, attachment));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });
      const file = new Blob(['abc'], { type: 'image/png' });

      const result = await client.uploadAttachment('sess1', { token: 'tok' }, file, 'y.png');

      expect(result).toEqual(attachment);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/attachments');
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).body).toBeInstanceOf(FormData);
    });

    it('does not set a Content-Type header itself (would break the multipart boundary)', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(201, {}));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.uploadAttachment('sess1', { token: 'tok' }, new Blob(['x']));

      const [, init] = fetchImpl.mock.calls[0] ?? [];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('throws a RestError on failure', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(413, { message: 'too large' }));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await expect(client.uploadAttachment('sess1', { token: 'tok' }, new Blob(['x']))).rejects.toMatchObject({
        status: 413,
        message: 'too large',
      });
    });
  });

  describe('closeSession', () => {
    it('POSTs to /sessions/{id}/close with a JSON reason body', async () => {
      const session = { id: 'sess1', status: 'CLOSED' };
      const fetchImpl = fetchMock(async () => jsonResponse(200, session));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      const result = await client.closeSession('sess1', { token: 'tok' }, 'MANUAL');

      expect(result).toEqual(session);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/close');
      expect((init as RequestInit).method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'MANUAL' });
    });

    it('sends an empty body when no reason is given', async () => {
      const fetchImpl = fetchMock(async () => jsonResponse(200, {}));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      await client.closeSession('sess1', { token: 'tok' });

      const [, init] = fetchImpl.mock.calls[0] ?? [];
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
    });
  });

  describe('reopenSession', () => {
    it('POSTs to /sessions/{id}/reopen', async () => {
      const session = { id: 'sess1', status: 'WAITING_FOR_AGENT' };
      const fetchImpl = fetchMock(async () => jsonResponse(200, session));
      const client = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

      const result = await client.reopenSession('sess1', { token: 'tok' });

      expect(result).toEqual(session);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://api.example.com/sessions/sess1/reopen');
      expect((init as RequestInit).method).toBe('POST');
    });
  });
});
