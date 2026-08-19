// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { SecretKeyInClientError, toAuthToken } from '@dhaam-ccrm/core';

import { createTokenSource, looksLikeSecretKey } from '../src/auth.js';
import { resolveConfig } from '../src/config.js';
import type { WidgetConfig } from '../src/config.js';

// Key fixtures are ASSEMBLED AT RUNTIME, never written as contiguous literals.
// A literal here matches secret-scanner patterns and blocks the push — GitHub
// flagged exactly these two files. It also trips a customer's scanner if they
// copy a test. The concatenation is the point; do not "tidy" it back.
const KEY_BODY = '0123456789abcdefghijklmn';
const PK_TEST = 'dhp_' + 'test_' + KEY_BODY;
const SK_LIVE = 'dhk_' + 'live_' + KEY_BODY;
const RETIRED_SK_LIVE = 'dhsk_' + 'live_' + KEY_BODY;
const FOREIGN_SK_LIVE = 's' + 'k_' + 'live_' + KEY_BODY;


const PUBLISHABLE = PK_TEST;

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    ...overrides,
  };
}

describe('looksLikeSecretKey', () => {
  it('separates "is a secret" from "is not a valid publishable key"', () => {
    // The distinction the sweep depends on. Delegated to core's parser rather
    // than to a local prefix list, so a fourth prefix rename cannot leave this
    // package quietly accepting secrets.
    expect(looksLikeSecretKey(SK_LIVE)).toBe(true);
    expect(looksLikeSecretKey(RETIRED_SK_LIVE)).toBe(true);
    expect(looksLikeSecretKey(FOREIGN_SK_LIVE)).toBe(true);

    expect(looksLikeSecretKey(PUBLISHABLE)).toBe(false);
    expect(looksLikeSecretKey('cus_12345')).toBe(false);
    expect(looksLikeSecretKey('')).toBe(false);
    expect(looksLikeSecretKey('not a key at all')).toBe(false);
  });
});

describe('createTokenSource', () => {
  it('throws before any network work if the publishable slot holds a secret', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(() =>
      createTokenSource(
        resolveConfig(config({ auth: { publishableKey: SK_LIVE, tokenEndpoint: '/t' } })),
      ),
    ).toThrow(SecretKeyInClientError);

    // The load-bearing half: not merely that it threw, but that it threw
    // BEFORE reaching the wire. A secret key that gets sent and then rejected
    // has still been sent.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('POSTs to the host endpoint with same-origin credentials and never sends the key as a bearer', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: 'tok_1', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { tokens } = createTokenSource(resolveConfig(config()));
    await expect(tokens.getAccessToken()).resolves.toBe('tok_1');

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('/api/chat-token');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    // The publishable key identifies a tenant and grants nothing; it must not
    // be presented as if it were the user's credential.
    expect(JSON.stringify(init.headers ?? {})).not.toContain(PUBLISHABLE);

    vi.unstubAllGlobals();
  });

  it('collapses concurrent first reads into ONE mint', async () => {
    // A first paint fires a history fetch and a connect at the same time. Two
    // parallel mints would have the second overwrite the first's token while
    // core was already using it.
    let resolveMint: (value: Response) => void = () => undefined;
    const fetchSpy = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveMint = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { tokens } = createTokenSource(resolveConfig(config()));
    const first = tokens.getAccessToken();
    const second = tokens.getAccessToken();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveMint(
      new Response(JSON.stringify({ accessToken: 'tok_shared', expiresIn: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(await first).toBe('tok_shared');
    expect(await second).toBe('tok_shared');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('surfaces the status but never the body of a failed token endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"code":"SEKRIT_INTERNAL_DETAIL"}}', { status: 503 })),
    );

    const { tokens } = createTokenSource(resolveConfig(config()));
    await expect(tokens.getAccessToken()).rejects.toThrow('503');
    // The body is attacker-influencable and this message reaches
    // `ChatState.lastError` and the host's error tracker.
    await expect(tokens.getAccessToken()).rejects.not.toThrow(/SEKRIT_INTERNAL_DETAIL/);

    vi.unstubAllGlobals();
  });

  it('converts expiresIn SECONDS to core-native milliseconds', async () => {
    // The bug this prevents does not fail loudly: a hand-written
    // `{ token, expiresInMs: body.expiresIn }` type-checks and works, and then
    // refreshes a 3600-second token every ~2.9 seconds forever.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ accessToken: 'tok_2', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const { tokens } = createTokenSource(resolveConfig(config()));
    const provided = await tokens.getToken();
    expect(toAuthToken(provided).expiresInMs).toBe(3_600_000);

    vi.unstubAllGlobals();
  });

  it('reuses the token core last minted for REST, rather than minting a second one', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: 'tok_3', expiresIn: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { tokens } = createTokenSource(resolveConfig(config()));

    // Core mints first (this is `ChatClientConfig.getToken`)...
    await tokens.getToken();
    // ...then the REST adapters ask, and must NOT trigger another mint.
    await expect(tokens.getAccessToken()).resolves.toBe('tok_3');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('accepts a host-supplied getToken with no endpoint at all', async () => {
    const getToken = vi.fn(async () => ({ accessToken: 'tok_host', expiresIn: 120 }));
    const { tokens } = createTokenSource(
      resolveConfig(config({ auth: { publishableKey: PUBLISHABLE, getToken } })),
    );

    await expect(tokens.getAccessToken()).resolves.toBe('tok_host');
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});
