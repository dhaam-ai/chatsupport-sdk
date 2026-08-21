// `createIdentitySync` against the frozen wire contract
// (`chat-service-node/docs/CONTACT_IDENTIFY_CONTRACT.md`).
//
// Written from that document, not against a running backend — the route (T8)
// does not exist yet. Every assertion below names the section it is derived
// from, so a drift between the two tracks reads as a contract violation rather
// than as a mystery.

import { describe, expect, it, vi } from 'vitest';

import { createIdentitySync } from './adapters.js';
import { RestClient } from './client.js';
import { RestApiError, RestTransportError } from './errors.js';

/**
 * Split across concatenation so the checkout holds no contiguous literal for
 * CI's `credential-scan` job to match — same reason and same spelling as
 * `client.test.ts:12`.
 */
const KEY = 'dhp' + '_test_' + 'A'.repeat(43);

/** The factory's own parameter type, which the package deliberately does not export. */
type Profile = Parameters<ReturnType<typeof createIdentitySync>['sync']>[0];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The success body from §1.6, verbatim. */
function identifyResponse(dataOverrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      contactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      externalId: 'usr_9f2',
      lastLoginAt: '2026-08-21T09:14:03.512Z',
      ...dataOverrides,
    },
  };
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

/** Reads back what was actually put on the wire. */
function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('identify request', () => {
  it('POSTs to the identify route under the service prefix', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));

    await createIdentitySync(h.client).sync({ name: 'Jordan Rivera' });

    // Literal, deliberately NOT `${BASE_PATH}/identify`: asserting against the
    // same constant the code uses is tautological — it passes even when the
    // constant is wrong (client.test.ts:57-60). §1.1 pins this path.
    expect(h.calls[0]?.url.pathname).toBe('/chat-services/api/v1/identify');
    expect(h.calls[0]?.init.method).toBe('POST');
    // No query string: identity comes from the headers, never the URL (§1.2).
    expect(h.calls[0]?.url.search).toBe('');
    expect(h.calls).toHaveLength(1);
  });

  it('sends both credentials and a JSON content type (§1.2)', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));

    await createIdentitySync(h.client).sync({ email: 'jordan@example.com' });

    const headers = h.calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
    expect(headers['X-Publishable-Key']).toBe(KEY);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('puts the full profile on the wire unchanged (§1.4)', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));

    await createIdentitySync(h.client).sync({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
      phone: '+919820011223',
      city: 'Mumbai',
      country: 'IN',
      tags: ['vip', 'not-a-real-tag'],
      device: { deviceId: 'web-9f2c-4b1a', deviceToken: 'tkn-1', platform: 'web' },
    });

    expect(sentBody(h.calls[0]?.init)).toEqual({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
      phone: '+919820011223',
      city: 'Mumbai',
      country: 'IN',
      tags: ['vip', 'not-a-real-tag'],
      device: { deviceId: 'web-9f2c-4b1a', deviceToken: 'tkn-1', platform: 'web' },
    });
  });

  it('omits an unsupplied optional entirely rather than sending a JSON null', async () => {
    // The load-bearing serialization assertion. Both the body and `device` are
    // `.strict()` (§2), so an unexpected key is a 400 — and §4's write matrix
    // distinguishes "not present" from a value, so `phone: null` and no `phone`
    // must not be conflated on this side.
    const h = harness(() => jsonResponse(identifyResponse()));

    await createIdentitySync(h.client).sync({
      name: 'Jordan Rivera',
      device: { deviceId: 'web-9f2c-4b1a' },
    });

    const sent = sentBody(h.calls[0]?.init);
    expect(sent).toEqual({ name: 'Jordan Rivera', device: { deviceId: 'web-9f2c-4b1a' } });
    // Asserted as absence, not as `undefined`: `toEqual` treats the two alike
    // and this test exists precisely to tell them apart.
    for (const key of ['email', 'phone', 'city', 'country', 'tags']) {
      expect(Object.keys(sent)).not.toContain(key);
    }
    expect(Object.keys(sent['device'] as object)).toEqual(['deviceId']);
  });

  it('drops an explicitly-undefined optional rather than sending it as null', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));
    // `exactOptionalPropertyTypes` stops this being written as a literal, but a
    // host assembling a profile from optional data produces exactly this object
    // at runtime — so the cast probes a real path, not a hypothetical one.
    const assembled = { name: 'Jordan Rivera', phone: undefined } as unknown as Profile;

    await createIdentitySync(h.client).sync(assembled);

    expect(sentBody(h.calls[0]?.init)).toEqual({ name: 'Jordan Rivera' });
    expect(String(h.calls[0]?.init.body)).not.toContain('null');
  });

  it('sends an empty object for an empty profile, which the route accepts (§1.3)', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));

    await createIdentitySync(h.client).sync({});

    expect(String(h.calls[0]?.init.body)).toBe('{}');
    expect((h.calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });
});

describe('identify success response', () => {
  it('unwraps the envelope to the receipt, leaving lastLoginAt an ISO string', async () => {
    const h = harness(() => jsonResponse(identifyResponse()));

    const result = await createIdentitySync(h.client).sync({ email: 'jordan@example.com' });

    expect(result).toEqual({
      contactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      externalId: 'usr_9f2',
      lastLoginAt: '2026-08-21T09:14:03.512Z',
    });
    // Not a Date: §3.3 pins `lastLoginAt` as the string the server sent.
    expect(typeof result.lastLoginAt).toBe('string');
  });

  it('returns only the three documented fields, not whatever else data carries', async () => {
    const h = harness(() => jsonResponse(identifyResponse({ internalNote: 'leaked' })));

    const result = await createIdentitySync(h.client).sync({});

    expect(Object.keys(result).sort()).toEqual(['contactId', 'externalId', 'lastLoginAt']);
  });
});

describe('identify failure taxonomy', () => {
  it.each([
    { label: 'no data key', body: { success: true } },
    { label: 'an array under data', body: { success: true, data: [] } },
    { label: 'data as null', body: { success: true, data: null } },
    { label: 'success: false', body: { success: false, data: { contactId: 'c1' } } },
    {
      label: 'a bare payload with no envelope at all',
      body: { contactId: 'c1', externalId: 'u1', lastLoginAt: '2026-08-21T09:14:03.512Z' },
    },
  ])('rejects $label as MALFORMED_RESPONSE', async ({ body }) => {
    // §1.5's v1 success envelope is load-bearing for this package, not
    // cosmetic: `unwrapEnvelope` accepts nothing but `{success:true, data:{}}`.
    const h = harness(() => jsonResponse(body));

    await expect(createIdentitySync(h.client).sync({})).rejects.toMatchObject({
      name: 'RestApiError',
      code: 'MALFORMED_RESPONSE',
      status: 200,
      retryable: false,
    });
  });

  it.each(['contactId', 'externalId', 'lastLoginAt'])(
    'rejects a well-formed envelope whose data is missing %s',
    async (field) => {
      // `undefined` here is dropped by JSON.stringify, so the wire body really
      // lacks the key rather than carrying a null.
      const h = harness(() => jsonResponse(identifyResponse({ [field]: undefined })));

      await expect(createIdentitySync(h.client).sync({})).rejects.toMatchObject({
        name: 'RestApiError',
        code: 'MALFORMED_RESPONSE',
        retryable: false,
      });
    },
  );

  it('surfaces the v1 400 validation envelope as a non-retryable RestApiError', async () => {
    const h = harness(() =>
      jsonResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: {
              fieldErrors: {},
              formErrors: ["Unrecognized key(s) in object: 'externalId'"],
            },
          },
        },
        400,
      ),
    );

    await expect(createIdentitySync(h.client).sync({ name: 'Jordan Rivera' })).rejects.toMatchObject(
      {
        name: 'RestApiError',
        code: 'VALIDATION_ERROR',
        status: 400,
        // The v1 shape carries no `retryable` key at all (§1.5); 400 < 500
        // makes the status fallback resolve it to false.
        retryable: false,
      },
    );
  });

  it('surfaces the v2 429 as retryable, read from the body rather than the status', async () => {
    const h = harness(() =>
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Slow down and retry after the indicated delay.',
            retryable: true,
          },
        },
        429,
      ),
    );

    const error: unknown = await createIdentitySync(h.client)
      .sync({})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RestApiError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      // The point of the assertion: 429 < 500, so the status fallback alone
      // would say false. `true` proves the server's own verdict was read.
      retryable: true,
    });
    // The server's text stays off `message`, which is what host error
    // reporters record by default.
    expect((error as RestApiError).message).toBe('request failed with status 429');
  });

  it('reports a request that never reached the server as a transport failure', async () => {
    const h = harness(() => {
      throw new TypeError('fetch failed');
    });

    const error: unknown = await createIdentitySync(h.client)
      .sync({})
      .catch((caught: unknown) => caught);

    // Opposite remedies — fix the credential vs. try again later — so these
    // must not collapse into one type.
    expect(error).toBeInstanceOf(RestTransportError);
    expect(error).not.toBeInstanceOf(RestApiError);
  });

  it('does not retry the identify call itself', async () => {
    // The retry lives in core (T14), where the jitter and timer seams are.
    // `READ_BACK_ATTEMPTS` is scoped to the session read-back and must not
    // generalize to this adapter.
    const h = harness(() => jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, 500));

    await expect(createIdentitySync(h.client).sync({})).rejects.toBeInstanceOf(RestApiError);

    expect(h.calls).toHaveLength(1);
  });
});
