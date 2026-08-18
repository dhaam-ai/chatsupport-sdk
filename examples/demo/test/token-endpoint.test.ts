// The demo's only business logic is the key split, so that is what is tested.
//
// Two of these assertions are the demo's reason to exist: the secret key must
// never appear in anything the browser can see (`toRuntimeConfig`) and never
// in an error message that could be logged or rendered (`mintAccessToken`).

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS server module, deliberately unbuilt and untyped.
import { loadConfig, toRuntimeConfig, describeConfig, ConfigError } from '../server/config.mjs';
// @ts-expect-error — as above.
import { mintAccessToken, TokenMintError } from '../server/token-endpoint.mjs';

const PUBLISHABLE = `${'dhp' + '_test_'}${'a'.repeat(43)}`;
const SECRET = `${'dhk' + '_test_'}${'b'.repeat(43)}`;

const VALID_ENV = {
  CHAT_PUBLISHABLE_KEY: PUBLISHABLE,
  CHAT_SECRET_KEY: SECRET,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loadConfig', () => {
  it('accepts a matched key pair', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.publishableKey).toBe(PUBLISHABLE);
    expect(config.environment).toBe('test');
  });

  it('rejects a secret key supplied where the publishable key belongs', () => {
    expect(() =>
      loadConfig({ CHAT_PUBLISHABLE_KEY: SECRET, CHAT_SECRET_KEY: SECRET }),
    ).toThrowError(/secret key/i);
  });

  it('rejects a malformed secret key without echoing it', () => {
    try {
      loadConfig({ CHAT_PUBLISHABLE_KEY: PUBLISHABLE, CHAT_SECRET_KEY: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain('nope');
    }
  });

  it('rejects halves of two different keys:create runs', () => {
    expect(() =>
      loadConfig({
        CHAT_PUBLISHABLE_KEY: `${'dhp' + '_live_'}${'a'.repeat(43)}`,
        CHAT_SECRET_KEY: SECRET,
      }),
    ).toThrowError(/environment mismatch/i);
  });

  it('requires both keys', () => {
    expect(() => loadConfig({})).toThrowError(/CHAT_PUBLISHABLE_KEY/);
    expect(() => loadConfig({ CHAT_PUBLISHABLE_KEY: PUBLISHABLE })).toThrowError(/CHAT_SECRET_KEY/);
  });
});

describe('what reaches the browser', () => {
  it('never includes the secret key in the runtime config', () => {
    const runtime = toRuntimeConfig(loadConfig(VALID_ENV));
    expect(JSON.stringify(runtime)).not.toContain(SECRET);
    expect(JSON.stringify(runtime)).not.toContain('dhk' + '_');
    expect(runtime.publishableKey).toBe(PUBLISHABLE);
  });

  it('never prints the secret key in the boot banner', () => {
    expect(describeConfig(loadConfig(VALID_ENV))).not.toContain(SECRET);
  });
});

describe('mintAccessToken', () => {
  it('authenticates with the secret key and mints for the configured user', async () => {
    let seen: { url: string; init: RequestInit } | null = null;

    const token = await mintAccessToken({
      apiUrl: 'http://localhost:3000',
      secretKey: SECRET,
      user: { userId: 'demo-user-1', name: 'Demo User' },
      fetchImpl: async (url: string, init: RequestInit) => {
        seen = { url, init };
        return jsonResponse({ accessToken: 'jwt-value', expiresIn: 3600 }, 201);
      },
    });

    expect(seen!.url).toBe('http://localhost:3000/chat-services/api/v1/tokens');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      userId: 'demo-user-1',
      name: 'Demo User',
    });

    // Passed through verbatim so the browser's createTokenProvider can do the
    // seconds → milliseconds conversion itself.
    expect(token).toEqual({ accessToken: 'jwt-value', expiresIn: 3600 });
  });

  it('does not leak the secret key in a 401 message', async () => {
    const failing = async () =>
      jsonResponse({ error: { code: 'AUTH_INVALID', message: 'Invalid or revoked secret key' } }, 401);

    await expect(
      mintAccessToken({
        apiUrl: 'http://localhost:3000',
        secretKey: SECRET,
        user: { userId: 'demo-user-1' },
        fetchImpl: failing,
      }),
    ).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TokenMintError);
      expect(error.message).not.toContain(SECRET);
      expect(error.message).toMatch(/401/);
      return true;
    });
  });

  it('reports an unreachable service without leaking the key', async () => {
    await expect(
      mintAccessToken({
        apiUrl: 'http://localhost:3000',
        secretKey: SECRET,
        user: { userId: 'demo-user-1' },
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).rejects.toSatisfy((error: Error) => {
      expect(error.message).toMatch(/is it running/);
      expect(error.message).not.toContain(SECRET);
      return true;
    });
  });

  it('rejects a success response with no accessToken', async () => {
    await expect(
      mintAccessToken({
        apiUrl: 'http://localhost:3000',
        secretKey: SECRET,
        user: { userId: 'demo-user-1' },
        fetchImpl: async () => jsonResponse({ expiresIn: 3600 }, 201),
      }),
    ).rejects.toThrowError(/no accessToken/);
  });
});
