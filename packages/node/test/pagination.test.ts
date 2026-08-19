import { describe, expect, it } from 'vitest';
import { ChatServerClient } from '../src/client.js';
import { paginate, type Page } from '../src/pagination.js';
import type { ChatMessage } from '../src/types.js';
import { PUBLISHABLE_KEY_LIVE, SECRET_KEY_LIVE } from './fixtures.js';
import { stubFetch } from './stub-fetch.js';

const API_URL = 'https://chat.example.com';
const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.body.sig';
const SESSION = 'sess_1';

/**
 * A RAW row, exactly as `chat.routes.ts` sends it.
 *
 * Integer enums, the column name `chatSessionId`, no projection. These fixtures
 * previously carried already-decoded string enums, which is how the package
 * shipped a page reader that could never have parsed a real response.
 */
function row(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    chatSessionId: SESSION,
    senderType: 1,
    senderId: 'user_1',
    content: `body ${id}`,
    messageType: 1,
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Pages are ASCENDING (oldest first) and walk BACKWARD through history.
 *
 * Wrapped in the `{ success, data }` envelope every `/chat/...` route sends
 * (`chat.routes.ts:270-276`).
 */
function page(ids: readonly string[], hasMore: boolean) {
  return { body: { success: true, data: { messages: ids.map((id) => row(id)), hasMore } } };
}

function userClient(fetch: typeof globalThis.fetch) {
  return new ChatServerClient({
    apiUrl: API_URL,
    secretKey: SECRET_KEY_LIVE,
    publishableKey: PUBLISHABLE_KEY_LIVE,
    fetch,
  }).asUser(ACCESS_TOKEN);
}

describe('message pagination', () => {
  it('iterates multiple pages and terminates on hasMore: false', async () => {
    const stub = stubFetch([
      page(['m3', 'm4'], true),
      page(['m1', 'm2'], false),
    ]);

    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION)) pages.push(p);

    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.items.map((m) => m.id))).toEqual([
      ['m3', 'm4'],
      ['m1', 'm2'],
    ]);
    // Exactly two requests. The stub throws when exhausted, so a third
    // request would fail loudly rather than silently looping.
    expect(stub.requests).toHaveLength(2);
  });

  it('takes the next cursor from the OLDEST message, since pages are ascending', async () => {
    const stub = stubFetch([page(['m3', 'm4'], true), page(['m1', 'm2'], false)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION)) pages.push(p);

    // The classic bug: taking items[items.length - 1] walks FORWARD into the
    // page just returned and never terminates. The cursor must be 'm3', the
    // first (oldest) element of the ascending page — not 'm4'.
    expect(stub.requests[0]?.url).not.toContain('before=');
    expect(new URL(stub.requests[1]!.url).searchParams.get('before')).toBe('m3');
  });

  it('flattens to individual messages in page order', async () => {
    const stub = stubFetch([page(['m3', 'm4'], true), page(['m1', 'm2'], false)]);
    const ids: string[] = [];
    for await (const m of userClient(stub.fetch).messages(SESSION)) ids.push(m.id);
    expect(ids).toEqual(['m3', 'm4', 'm1', 'm2']);
  });

  it('stops after one page when hasMore is false immediately', async () => {
    const stub = stubFetch([page(['m1'], false)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION)) pages.push(p);
    expect(pages).toHaveLength(1);
    expect(stub.requests).toHaveLength(1);
  });

  it('handles an empty first page without requesting a second', async () => {
    const stub = stubFetch([page([], false)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION)) pages.push(p);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.items).toEqual([]);
  });

  it('terminates on an empty page even when the server insists hasMore is true', async () => {
    // A server bug — but one that has shipped in real APIs — and without a
    // guard it becomes an infinite request loop inside a customer's backend.
    //
    // NOTE this end-to-end case is carried by the CURSOR guard, not the
    // empty-page guard: an empty page yields no `items[0].id`, so the derived
    // cursor is undefined and the loop stops there first. The empty-page guard
    // is exercised directly against `paginate` below, where a cursor that keeps
    // advancing leaves it as the only thing that can terminate the loop.
    const stub = stubFetch([page([], true)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION)) pages.push(p);
    expect(pages).toHaveLength(1);
    expect(stub.requests).toHaveLength(1);
  });

  it('rejects a row with no usable id rather than looping on a stuck cursor', async () => {
    // A row without an id cannot BE a cursor, so tolerating it used to mean
    // re-requesting the same page forever; the loop's cursor guard caught that.
    // Projection now rejects the row outright, one layer earlier and with a
    // message that names the missing field. The cursor guard is still the
    // backstop and is exercised directly against `paginate` below.
    const stub = stubFetch([
      { body: { success: true, data: { messages: [row('m1', { id: undefined })], hasMore: true } } },
    ]);
    await expect(async () => {
      for await (const _p of userClient(stub.fetch).messagePages(SESSION)) break;
    }).rejects.toThrow(/missing message\.id/);
    expect(stub.requests).toHaveLength(1);
  });

  it('honours maxPages', async () => {
    const stub = stubFetch([page(['m5', 'm6'], true), page(['m3', 'm4'], true)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION, { maxPages: 2 })) {
      pages.push(p);
    }
    expect(pages).toHaveLength(2);
    expect(stub.requests).toHaveLength(2);
  });

  it('stops requesting when the consumer breaks out of the loop', async () => {
    // A generator that kept fetching after `break` would waste a round trip
    // per abandoned iteration — and on a large history, many.
    const stub = stubFetch([page(['m3', 'm4'], true), page(['m1', 'm2'], false)]);
    for await (const _p of userClient(stub.fetch).messagePages(SESSION)) break;
    expect(stub.requests).toHaveLength(1);
  });

  it('passes limit and a caller-supplied starting cursor through to the query', async () => {
    const stub = stubFetch([page(['m1'], false)]);
    const pages: Array<Page<ChatMessage>> = [];
    for await (const p of userClient(stub.fetch).messagePages(SESSION, { limit: 50, before: 'm9' })) {
      pages.push(p);
    }
    const url = new URL(stub.lastRequest().url);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('before')).toBe('m9');
  });

  it('URL-encodes the session id', async () => {
    const stub = stubFetch([page(['m1'], false)]);
    for await (const _p of userClient(stub.fetch).messagePages('a/../b')) break;
    // Path traversal in an opaque identifier must not escape the route.
    expect(stub.lastRequest().url).toContain('/chat/sessions/a%2F..%2Fb/messages');
  });

  it('rejects an out-of-range limit locally', () => {
    const stub = stubFetch([]);
    const user = userClient(stub.fetch);
    expect(() => user.messagePages(SESSION, { limit: 0 })).toThrow(/between 1 and 100/);
    expect(() => user.messagePages(SESSION, { limit: 101 })).toThrow(/between 1 and 100/);
    expect(() => user.messagePages(SESSION, { limit: 1.5 })).toThrow(/between 1 and 100/);
  });

  it('raises on a BARE page body, the shape no route actually sends', async () => {
    // The inverse of what this test used to assert. The package was built
    // against the OpenAPI document's bare `{ messages, hasMore }` and treated
    // the service's real `{ success, data }` reply as the drift. It is the
    // other way round: `chat.routes.ts:270-276` envelopes every response, and
    // a bare body now means something is answering that is not this route.
    const stub = stubFetch([{ body: { messages: [], hasMore: false } }]);
    await expect(async () => {
      for await (const _p of userClient(stub.fetch).messagePages(SESSION)) break;
    }).rejects.toThrow(/did not return a \{ success: true, data \} envelope/);
  });

  it('decodes integer enums and lifts the attachment out of a paged row', async () => {
    // End-to-end proof that history survives the round trip. Asserted on the
    // iterator, not just on the projection, because these two were wired up
    // separately and the wiring is what was missing.
    const attachment = {
      url: 'https://s3.example.com/images/cat.png',
      fileName: 'cat.png',
      mimeType: 'image/png',
      size: 2048,
      mediaType: 'images',
    };
    const stub = stubFetch([
      {
        body: {
          success: true,
          data: {
            messages: [row('m1', { senderType: 2, messageType: 4, metadata: { attachment } })],
            hasMore: false,
          },
        },
      },
    ]);

    const messages: ChatMessage[] = [];
    for await (const m of userClient(stub.fetch).messages(SESSION)) messages.push(m);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderType).toBe('AGENT');
    expect(messages[0]?.messageType).toBe('IMAGE');
    // The failure this guards: without the lift the attachment stays nested in
    // `metadata` and every reloaded image silently loses its file.
    expect(messages[0]?.attachment?.url).toBe(attachment.url);
    expect(messages[0]?.attachment?.mediaType).toBe('IMAGE');
    expect(messages[0]?.metadata).toBeUndefined();
  });

  it('calls the route the service actually serves', async () => {
    // Pinned as a literal. The package built `/sessions/{id}/messages` — the
    // path the OpenAPI document declares and `chat.routes.ts` does not serve —
    // so history 404'd against every real deployment.
    const stub = stubFetch([page(['m1'], false)]);
    for await (const _p of userClient(stub.fetch).messagePages(SESSION)) break;
    expect(new URL(stub.lastRequest().url).pathname).toBe(
      '/chat-services/api/v1/chat/sessions/sess_1/messages',
    );
  });
});

describe('credentials on the read surface', () => {
  it('sends the access token and publishable key, and never the secret key', async () => {
    const stub = stubFetch([page(['m1'], false)]);
    for await (const _p of userClient(stub.fetch).messagePages(SESSION)) break;

    const request = stub.lastRequest();
    expect(request.headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(request.headers['x-publishable-key']).toBe(PUBLISHABLE_KEY_LIVE);
    // The secret key is valid ONLY on POST /tokens, never on a route a
    // browser also calls.
    expect(JSON.stringify(request)).not.toContain(SECRET_KEY_LIVE);
  });

  it('refuses to build a read surface without a publishable key', () => {
    const client = new ChatServerClient({
      apiUrl: API_URL,
      secretKey: SECRET_KEY_LIVE,
      fetch: stubFetch([]).fetch,
    });
    expect(() => client.asUser(ACCESS_TOKEN)).toThrow(/publishableKey is required/);
  });

  it('refuses an empty access token without echoing it', () => {
    const client = new ChatServerClient({
      apiUrl: API_URL,
      secretKey: SECRET_KEY_LIVE,
      publishableKey: PUBLISHABLE_KEY_LIVE,
      fetch: stubFetch([]).fetch,
    });
    expect(() => client.asUser('')).toThrow(/access token is required/);
  });
});

describe('paginate — the generic loop', () => {
  it('terminates on hasMore false', async () => {
    const seen: number[][] = [];
    const fetchPage = async (cursor: string | undefined): Promise<Page<number>> =>
      cursor === undefined ? { items: [1, 2], hasMore: true } : { items: [3], hasMore: false };

    for await (const p of paginate(fetchPage, (p) => String(p.items[0]))) seen.push([...p.items]);
    expect(seen).toEqual([[1, 2], [3]]);
  });

  it('terminates on an empty page even when the cursor keeps advancing', async () => {
    // Isolates the empty-page guard. `cursorOf` returns a FRESH cursor every
    // time, so neither the hasMore guard nor the cursor-did-not-change guard
    // can fire — the empty-page check is the only thing standing between this
    // and an infinite request loop.
    //
    // The fetcher throws rather than looping forever so that removing the
    // guard produces a red test with a readable message instead of a hung
    // suite that someone eventually kills without reading.
    let calls = 0;
    const fetchPage = async (): Promise<Page<number>> => {
      calls += 1;
      if (calls > 5) throw new Error('paginate did not terminate on an empty page');
      return { items: [], hasMore: true };
    };

    const seen: Array<Page<number>> = [];
    for await (const p of paginate(fetchPage, () => `cursor-${calls}`)) seen.push(p);

    expect(seen).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('returns nothing when maxPages is below one', async () => {
    let called = 0;
    const fetchPage = async (): Promise<Page<number>> => {
      called += 1;
      return { items: [1], hasMore: true };
    };
    const seen: unknown[] = [];
    for await (const p of paginate(fetchPage, () => 'x', { maxPages: 0 })) seen.push(p);
    expect(seen).toHaveLength(0);
    expect(called).toBe(0);
  });
});
