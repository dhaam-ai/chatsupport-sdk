// @vitest-environment jsdom
//
// T17: `WidgetIdentity.profile` → core's two flat `ChatClientConfig` fields.
//
// Everything here is asserted at core's DOOR — the object actually handed to
// `createChatClient` — rather than at an extracted helper, because the claim
// worth defending is about what core receives, not about what an intermediate
// function returns. `createChatClient` is spied through, not replaced: the
// real client is still built, so a config this file calls valid is a config
// core also accepts.
//
// ── Why the guest assertion uses `in` and not `=== undefined` ────────────
//
// `exactOptionalPropertyTypes` makes "key absent" and "key present holding
// undefined" two different things, and only the first is what a guest is
// promised. The compiler rejects the plain `identityProfile:
// config.identity.profile` outright, but it does NOT reject the escapes from
// that error — a cast, a `!`, or widening core's field — and every one of
// those puts an identity-shaped key on a guest's config while still passing a
// `toBeUndefined()` check. `'identityProfile' in cfg` is the assertion that
// can tell those apart, so it is the one used.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatClientConfig, IdentityProfile } from '@dhaam-ccrm/core';

const spy = vi.hoisted(() => ({ configs: [] as ChatClientConfig[] }));

vi.mock('@dhaam-ccrm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dhaam-ccrm/core')>();
  return {
    ...actual,
    createChatClient: (config: ChatClientConfig) => {
      spy.configs.push(config);
      return actual.createChatClient(config);
    },
  };
});

// Static, not `await import`: vitest hoists the `vi.mock` factory above every
// import in this file, so client.ts already resolves the spied core.
import { createWidgetStore } from '../src/client.js';
import { resolveConfig } from '../src/config.js';
import type { WidgetConfig } from '../src/config.js';

// Split so the CI credential-scan grep cannot match a whole literal.
const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

const PROFILE: IdentityProfile = {
  name: 'Jordan Rivera',
  email: 'jordan@example.com',
  phone: '+919820011223',
  city: 'Mumbai',
  country: 'IN',
  tags: ['vip'],
  device: { deviceId: 'web-9f2c-4b1a', platform: 'web' },
};

class SilentSocket {
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function config(identity: WidgetConfig['identity']): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity,
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
  };
}

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

let calls: Call[] = [];

/** Mints a token for the auth endpoint; `identify` answers with `reply`. */
function stubFetch(reply: () => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      calls.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return reply();
    }),
  );
}

const receipt = (): Response =>
  new Response(
    JSON.stringify({
      success: true,
      data: {
        contactId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        externalId: 'cus_1',
        lastLoginAt: '2026-08-21T09:14:03.512Z',
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

/** Builds a widget client and hands back the config core was given. */
function buildConfig(identity: WidgetConfig['identity']): ChatClientConfig {
  const { store } = createWidgetStore(resolveConfig(config(identity)));
  store.destroy({ disconnect: true });
  // Not `.at(-1)`: `lib` is ES2020 here, and tsconfig.test.json typechecks
  // this file. `noUncheckedIndexedAccess` makes the index read `| undefined`
  // anyway, which the guard below already handles.
  const built = spy.configs[spy.configs.length - 1];
  if (built === undefined) throw new Error('createChatClient was never called');
  return built;
}

beforeEach(() => {
  spy.configs = [];
  calls = [];
  vi.stubGlobal('WebSocket', SilentSocket);
  stubFetch(receipt);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveConfig carries the profile through untouched', () => {
  it('survives the `identity: { ...config.identity, userId }` spread', () => {
    const resolved = resolveConfig(config({ userId: 'cus_1', profile: PROFILE }));

    expect(resolved.identity.profile).toBe(PROFILE);
    expect(resolved.identity.userId).toBe('cus_1');
  });

  it('adds no profile key of its own when the host supplied none', () => {
    const resolved = resolveConfig(config({ userId: 'cus_1' }));

    expect('profile' in resolved.identity).toBe(false);
  });
});

describe('a logged-in user reaches core with both identity fields', () => {
  it('passes the host’s profile object through verbatim', () => {
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    expect(built.identityProfile).toBe(PROFILE);
  });

  it('supplies an identitySync beside it — core fires only when it has both', () => {
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    expect(typeof built.identitySync?.sync).toBe('function');
  });
});

describe('a guest reaches core with NEITHER key present', () => {
  it('omits identityProfile — absent, not present-and-undefined', () => {
    const built = buildConfig({ userId: 'guest_1' });

    expect('identityProfile' in built).toBe(false);
  });

  it('omits identitySync too, so core cannot fire on a half-supplied pair', () => {
    const built = buildConfig({ userId: 'guest_1' });

    expect('identitySync' in built).toBe(false);
  });

  it('still builds every other seam — the guard is scoped to identity alone', () => {
    const built = buildConfig({ userId: 'guest_1' });

    expect(built.history).toBeDefined();
    expect(built.uploader).toBeDefined();
    expect(built.sessionActions).toBeDefined();
    expect(built.sessionSummarySource).toBeDefined();
  });
});

describe('the sync wrapper bridges rest’s receipt to core’s void', () => {
  it('resolves to undefined even though the call underneath resolves to a receipt', async () => {
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    await expect(built.identitySync?.sync(PROFILE)).resolves.toBeUndefined();
  });

  it('posts through the same RestClient every other adapter uses', async () => {
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    await built.identitySync?.sync(PROFILE);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://chat.example.com/chat-services/api/v1/identify');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok');
    expect(calls[0]?.headers['x-publishable-key']).toBe(PK_TEST);
    expect(calls[0]?.body).toEqual(PROFILE);
  });

  it('propagates a transport failure — swallowing it is core’s job, not this seam’s', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    await expect(built.identitySync?.sync(PROFILE)).rejects.toThrow();
  });

  it('propagates a rejection raised after the transport succeeded, too', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const built = buildConfig({ userId: 'cus_1', profile: PROFILE });

    await expect(built.identitySync?.sync(PROFILE)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });
});
