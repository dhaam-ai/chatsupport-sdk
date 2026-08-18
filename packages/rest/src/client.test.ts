import { describe, expect, it, vi } from 'vitest';

import { createAttachmentUploader, createHistorySource, createSessionActions } from './adapters.js';
import { BASE_PATH, RestClient } from './client.js';
import { RestApiError, RestTransportError } from './errors.js';

const KEY = 'dhp' + '_test_' + 'A'.repeat(43);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(responder: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  });
  const client = new RestClient({
    apiUrl: 'https://chat.example.test',
    publishableKey: KEY,
    getAccessToken: () => 'tok_abc',
    fetch: fetchStub as unknown as typeof globalThis.fetch,
  });
  return { client, calls, fetchStub };
}

describe('RestClient paths and credentials', () => {
  it('pins the base path to what the service mounts', () => {
    expect(BASE_PATH).toBe('/chat-services/api/v1');
  });

  it('builds URLs under the prefix the service actually mounts', async () => {
    // The spec's servers block originally resolved to {apiUrl}/v1, which no
    // route serves. This asserts the corrected base rather than trusting it.
    const h = harness(() => jsonResponse({ messages: [], hasMore: false }));

    await createHistorySource(h.client).listMessages({ sessionId: 's1', limit: 20 });

    // Literal, deliberately NOT `${BASE_PATH}/...`: asserting against the same
    // constant the code uses is tautological — it passes even when the constant
    // is wrong, which is exactly the defect this test exists to catch.
    expect(h.calls[0]?.url.pathname).toBe('/chat-services/api/v1/sessions/s1/messages');
  });

  it('sends both credentials on every request', async () => {
    const h = harness(() => jsonResponse({ messages: [], hasMore: false }));

    await createHistorySource(h.client).listMessages({ sessionId: 's1', limit: 20 });

    const headers = h.calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
    expect(headers['X-Publishable-Key']).toBe(KEY);
  });

  it('reads the token per request, so a refreshed token is picked up', async () => {
    let token = 'first';
    // Parameters declared so `mock.calls` is a typed tuple; `vi.fn(async () => …)`
    // infers `[]` and nothing can be read out of it.
    const fetchStub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ messages: [], hasMore: false }),
    );
    const client = new RestClient({
      apiUrl: 'https://chat.example.test',
      publishableKey: KEY,
      getAccessToken: () => token,
      fetch: fetchStub as unknown as typeof globalThis.fetch,
    });
    const history = createHistorySource(client);

    await history.listMessages({ sessionId: 's1', limit: 20 });
    token = 'second';
    await history.listMessages({ sessionId: 's1', limit: 20 });

    const seen = fetchStub.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Authorization'],
    );
    expect(seen).toEqual(['Bearer first', 'Bearer second']);
  });

  it('does not double the slash when apiUrl has a trailing one', async () => {
    const fetchStub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ messages: [], hasMore: false }),
    );
    const client = new RestClient({
      apiUrl: 'https://chat.example.test/',
      publishableKey: KEY,
      getAccessToken: () => 'tok',
      fetch: fetchStub as unknown as typeof globalThis.fetch,
    });

    await createHistorySource(client).listMessages({ sessionId: 's1', limit: 20 });

    const [input] = fetchStub.mock.calls[0] ?? [];
    expect(input).toBeInstanceOf(URL);
    expect((input as URL).pathname).not.toContain('//');
  });
});

describe('history pagination', () => {
  it('passes the cursor and limit through as query params', async () => {
    const h = harness(() => jsonResponse({ messages: [], hasMore: true }));

    await createHistorySource(h.client).listMessages({ sessionId: 's1', before: 'm9', limit: 30 });

    expect(h.calls[0]?.url.searchParams.get('before')).toBe('m9');
    expect(h.calls[0]?.url.searchParams.get('limit')).toBe('30');
  });

  it('omits the cursor entirely when asking for the newest page', async () => {
    const h = harness(() => jsonResponse({ messages: [], hasMore: false }));

    await createHistorySource(h.client).listMessages({ sessionId: 's1', limit: 20 });

    expect(h.calls[0]?.url.searchParams.has('before')).toBe(false);
  });

  it('normalizes a malformed page rather than passing it into state', async () => {
    const h = harness(() => jsonResponse({}));

    const page = await createHistorySource(h.client).listMessages({ sessionId: 's1', limit: 20 });

    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe('error taxonomy', () => {
  it('surfaces a structured API error as a typed error, not a raw throw', async () => {
    const h = harness(() =>
      jsonResponse({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found', retryable: false } }, 404),
    );

    await expect(
      createHistorySource(h.client).listMessages({ sessionId: 'nope', limit: 20 }),
    ).rejects.toMatchObject({ name: 'RestApiError', code: 'SESSION_NOT_FOUND', status: 404, retryable: false });
  });

  it('distinguishes a 401 from a network failure', async () => {
    // These demand opposite responses — fix the credential vs retry later — so
    // collapsing them into one error type is a real bug, not a style choice.
    const unauthorized = harness(() =>
      jsonResponse({ error: { code: 'AUTH_INVALID', message: 'bad key', retryable: false } }, 401),
    );
    const offline = harness(() => {
      throw new TypeError('fetch failed');
    });

    await expect(
      createHistorySource(unauthorized.client).listMessages({ sessionId: 's1', limit: 20 }),
    ).rejects.toBeInstanceOf(RestApiError);
    await expect(
      createHistorySource(offline.client).listMessages({ sessionId: 's1', limit: 20 }),
    ).rejects.toBeInstanceOf(RestTransportError);
  });

  it('treats a 5xx without a structured body as retryable', async () => {
    const h = harness(() => new Response('gateway exploded', { status: 502 }));

    await expect(
      createHistorySource(h.client).listMessages({ sessionId: 's1', limit: 20 }),
    ).rejects.toMatchObject({ retryable: true, status: 502 });
  });

  it('never puts the raw error body into the message', async () => {
    // An error body is attacker-influencable and may echo request detail (§14).
    const h = harness(() => new Response(`token=${'dhk' + '_live_'}LEAKED`, { status: 400 }));

    const error: unknown = await createHistorySource(h.client)
      .listMessages({ sessionId: 's1', limit: 20 })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RestApiError);
    expect((error as RestApiError).message).not.toContain('LEAKED');
  });
});

describe('attachments and session actions', () => {
  it('uploads multipart without setting Content-Type by hand', async () => {
    // Setting it manually omits the boundary, and the server cannot parse the body.
    const h = harness(() => jsonResponse({ url: 'https://cdn/x.png' }));

    await createAttachmentUploader(h.client).upload({
      sessionId: 's1',
      file: new Blob(['x'], { type: 'image/png' }),
      fileName: 'x.png',
    });

    const headers = h.calls[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(h.calls[0]?.init.body).toBeInstanceOf(FormData);
  });

  it('posts reopen and close to their REST-only routes', async () => {
    const h = harness(() => jsonResponse({ id: 's1' }));
    const actions = createSessionActions(h.client);

    await actions.reopenSession('s1');
    await actions.closeSession('s1');

    expect(h.calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual([
      'POST /chat-services/api/v1/sessions/s1/reopen',
      'POST /chat-services/api/v1/sessions/s1/close',
    ]);
  });
});
