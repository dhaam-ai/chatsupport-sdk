import { describe, expect, it } from 'vitest';
import { ChatServerClient } from '../src/client.js';
import { ChatApiError, ChatTransportError, PublishableKeyAsSecretError } from '../src/errors.js';
import { InvalidMintRequestError } from '../src/tokens.js';
import { ALL_CREDENTIALS, PUBLISHABLE_KEY_LIVE, SECRET_KEY_LIVE } from './fixtures.js';
import { stubFetch, unreachableFetch } from './stub-fetch.js';

const API_URL = 'https://chat.example.com';
const MINTED = { accessToken: 'eyJhbGciOiJSUzI1NiJ9.body.sig', expiresIn: 3600 };

function clientWith(fetch: typeof globalThis.fetch): ChatServerClient {
  return new ChatServerClient({ apiUrl: API_URL, secretKey: SECRET_KEY_LIVE, fetch });
}

describe('mintToken', () => {
  it('POSTs to the /chat-services/api/v1/tokens path the service actually serves', async () => {
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    await clientWith(stub.fetch).mintToken({ userId: 'cust_8f2a1e' });

    // The full path, asserted literally. The OpenAPI servers block once
    // resolved to `{apiUrl}/v1` — a path no route served — and that defect
    // shipped green because both sides tested their own assumption.
    expect(stub.lastRequest().url).toBe(`${API_URL}/chat-services/api/v1/tokens`);
    expect(stub.lastRequest().method).toBe('POST');
  });

  it('sends the secret key as a bearer token and nowhere else', async () => {
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    await clientWith(stub.fetch).mintToken({ userId: 'u1' });

    const request = stub.lastRequest();
    expect(request.headers['authorization']).toBe(`Bearer ${SECRET_KEY_LIVE}`);
    // Never in the URL. A credential in a query string lands in every proxy
    // access log and every Referer header on the path (§14).
    expect(request.url).not.toContain(SECRET_KEY_LIVE);
    expect(request.body ?? '').not.toContain(SECRET_KEY_LIVE);
  });

  it('returns the minted token and lifetime', async () => {
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    const result = await clientWith(stub.fetch).mintToken({ userId: 'u1' });
    expect(result).toEqual(MINTED);
  });

  it('flattens custom claims alongside userId, matching the wire contract', async () => {
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    await clientWith(stub.fetch).mintToken({
      userId: 'u1',
      name: 'Priya Shah',
      email: 'priya@example.com',
      claims: { planTier: 'enterprise' },
    });

    expect(JSON.parse(stub.lastRequest().body as string)).toEqual({
      userId: 'u1',
      name: 'Priya Shah',
      email: 'priya@example.com',
      planTier: 'enterprise',
    });
  });

  it('omits absent optional fields rather than sending explicit nulls', async () => {
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    await clientWith(stub.fetch).mintToken({ userId: 'u1' });

    const body = JSON.parse(stub.lastRequest().body as string) as Record<string, unknown>;
    expect(body).toEqual({ userId: 'u1' });
    // An explicit `"name": null` is a different request; the server validates
    // `name` as a string when the key is present.
    expect('name' in body).toBe(false);
    expect('email' in body).toBe(false);
  });
});

describe('mintToken — local validation', () => {
  it('rejects a missing userId before making a request', async () => {
    const stub = stubFetch([]);
    await expect(
      clientWith(stub.fetch).mintToken({ userId: '' }),
    ).rejects.toThrow(InvalidMintRequestError);
    // Nothing was sent — the check is local.
    expect(stub.requests).toHaveLength(0);
  });

  it('rejects reserved claim names, naming them', async () => {
    const stub = stubFetch([]);
    await expect(
      clientWith(stub.fetch).mintToken({ userId: 'u1', claims: { sub: 'other', scope: 'admin' } }),
    ).rejects.toThrow(/sub, scope/);
    expect(stub.requests).toHaveLength(0);
  });

  it('rejects the reserved names the OpenAPI document omits but the server enforces', async () => {
    // Drift guard: the spec lists six reserved names, the service enforces
    // fifteen. A customer trusting the document would send `roles` and get an
    // opaque 400; this turns that into a local, named error.
    const stub = stubFetch([]);
    for (const name of ['nbf', 'jti', 'env', 'roles', 'roleId', 'userName', 'scope']) {
      await expect(
        clientWith(stub.fetch).mintToken({ userId: 'u1', claims: { [name]: 'x' } }),
      ).rejects.toThrow(InvalidMintRequestError);
    }
    expect(stub.requests).toHaveLength(0);
  });

  it('rejects more than 20 custom claims', async () => {
    const claims = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`claim${i}`, i]),
    );
    const stub = stubFetch([]);
    await expect(
      clientWith(stub.fetch).mintToken({ userId: 'u1', claims }),
    ).rejects.toThrow(/at most 20/);
  });

  it('accepts exactly 20 custom claims', async () => {
    const claims = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`claim${i}`, i]));
    const stub = stubFetch([{ status: 201, body: MINTED }]);
    await expect(
      clientWith(stub.fetch).mintToken({ userId: 'u1', claims }),
    ).resolves.toEqual(MINTED);
  });
});

describe('a publishable key where a secret key belongs', () => {
  it('fails at construction, before any request', () => {
    // The headline requirement. Failing at construction means a misconfigured
    // deployment dies at boot rather than on its first user's login.
    expect(
      () =>
        new ChatServerClient({
          apiUrl: API_URL,
          secretKey: PUBLISHABLE_KEY_LIVE,
          fetch: stubFetch([]).fetch,
        }),
    ).toThrow(PublishableKeyAsSecretError);
  });

  it('says so specifically, rather than as a generic format complaint', () => {
    try {
      new ChatServerClient({ apiUrl: API_URL, secretKey: PUBLISHABLE_KEY_LIVE });
      expect.unreachable('expected a throw');
    } catch (error) {
      const message = (error as Error).message;
      // The reciprocal risk must be called out: the same mix-up that puts a
      // publishable key here puts the secret key in the client bundle.
      expect(message).toMatch(/rotate/i);
      expect(message).toMatch(/client bundle/i);
    }
  });
});

describe('error taxonomy', () => {
  it('raises ChatApiError for a server verdict, carrying code and status', async () => {
    const stub = stubFetch([
      {
        status: 401,
        body: { error: { code: 'AUTH_INVALID', message: 'Invalid or revoked secret key', retryable: false } },
        headers: { 'x-request-id': 'req_123' },
      },
    ]);

    try {
      await clientWith(stub.fetch).mintToken({ userId: 'u1' });
      expect.unreachable('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatApiError);
      const api = error as ChatApiError;
      expect(api.code).toBe('AUTH_INVALID');
      expect(api.status).toBe(401);
      expect(api.retryable).toBe(false);
      // A correlation id, not a credential — safe and useful to surface.
      expect(api.requestId).toBe('req_123');
    }
  });

  it('raises ChatTransportError when the request never reached the server', async () => {
    // The distinction that matters: a 401 means fix the credential, a
    // connection refused means try again. Collapsing them is how a client
    // retries a rejected request forever.
    const client = clientWith(unreachableFetch());
    await expect(client.mintToken({ userId: 'u1' })).rejects.toThrow(ChatTransportError);
  });

  it('holds the transport cause rather than interpolating it into the message', async () => {
    const cause = new Error(`connect ECONNREFUSED ${API_URL}?token=leaky`);
    const client = clientWith(unreachableFetch(cause));
    try {
      await client.mintToken({ userId: 'u1' });
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as ChatTransportError).cause).toBe(cause);
      // fetch's own text can embed the request URL, which on this service has
      // historically carried a token in its query string.
      expect((error as Error).message).not.toContain('leaky');
    }
  });

  it('raises rather than returning a malformed 201 body onward to the browser', async () => {
    // A proxy returning an HTML error page with a 201 would otherwise hand the
    // caller `undefined.accessToken` at the point they relay it to a browser.
    const stub = stubFetch([{ status: 201, rawBody: '<html>gateway</html>' }]);
    await expect(clientWith(stub.fetch).mintToken({ userId: 'u1' })).rejects.toThrow(
      /accessToken, expiresIn/,
    );
  });

  it('falls back to the status rather than echoing an unstructured error body', async () => {
    const stub = stubFetch([{ status: 500, rawBody: 'Internal error at /var/app?key=oops' }]);
    try {
      await clientWith(stub.fetch).mintToken({ userId: 'u1' });
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toBe('request failed with status 500');
      expect((error as Error).message).not.toContain('oops');
    }
  });
});

describe('no credential material escapes', () => {
  it('keeps the key out of every thrown message and stack', async () => {
    const thrown: Error[] = [];
    const capture = async (run: () => Promise<unknown> | unknown): Promise<void> => {
      try {
        await run();
      } catch (error) {
        thrown.push(error as Error);
      }
    };

    await capture(() => new ChatServerClient({ apiUrl: API_URL, secretKey: PUBLISHABLE_KEY_LIVE }));
    await capture(() => new ChatServerClient({ apiUrl: API_URL, secretKey: '' }));
    await capture(() => clientWith(unreachableFetch()).mintToken({ userId: 'u1' }));
    await capture(() =>
      clientWith(stubFetch([{ status: 401, body: { error: { code: 'AUTH_INVALID', message: 'no', retryable: false } } }]).fetch)
        .mintToken({ userId: 'u1' }),
    );
    await capture(() => clientWith(stubFetch([]).fetch).mintToken({ userId: '' }));

    expect(thrown.length).toBeGreaterThan(0);
    for (const error of thrown) {
      const serialized = `${error.name}: ${error.message}\n${String(error.stack ?? '')}`;
      for (const credential of ALL_CREDENTIALS) {
        expect(serialized).not.toContain(credential);
        // Not even a prefix of the random component (§14).
        expect(serialized).not.toContain(credential.slice(0, 20));
      }
      expect(serialized).not.toContain(MINTED.accessToken);
    }
  });

  it('redacts the key from JSON.stringify and console.log of the client', () => {
    const client = clientWith(stubFetch([]).fetch);

    // A customer logging their config at startup is an entirely reasonable
    // line of code that must not write the secret key to disk.
    const asJson = JSON.stringify(client);
    expect(asJson).not.toContain(SECRET_KEY_LIVE);
    expect(asJson).toContain('[redacted]');

    const inspected = (
      client as unknown as Record<symbol, () => string>
    )[Symbol.for('nodejs.util.inspect.custom')]!();
    expect(inspected).not.toContain(SECRET_KEY_LIVE);
    expect(inspected).toContain('[redacted]');
  });
});
