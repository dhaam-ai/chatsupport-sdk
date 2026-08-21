// Public-surface pins for `@dhaam-ccrm/node`.
//
// `commerce.test.ts` (T25) already covers `buildCommerceEventBody`'s
// validation, the three caps, `.strict()` behaviour, `recordCommerceEvent`'s
// send/unwrap, and `isRetryableContactsError`'s classification — in full,
// and this file does not repeat any of it.
//
// What that file cannot cover, because it is about BEHAVIOUR rather than
// SHAPE: a refactor can leave every one of those unit tests green while
// silently widening the package's exported surface (an internal helper
// re-exported by accident), narrowing it (an export quietly dropped), or
// moving a secret-key-only method onto the client that was deliberately
// built to never hold one. This file pins the shape itself, the same way
// `packages/core/test/invariants/public-barrel-surface.test.ts` pins core's.

import { describe, expect, it } from 'vitest';

import * as nodeSdk from '../src/index.js';
import { ChatServerClient, HttpClient, UserScopedClient } from '../src/index.js';
import { PUBLISHABLE_KEY_LIVE, SECRET_KEY_LIVE } from './fixtures.js';

// `ContactCartRow` / `ContactCartStatus` are deliberately NOT part of the
// public surface. `GET /contacts/carts` is a staff-token-only read this
// package's secret key cannot authenticate, so no method here returns
// either shape — see `index.ts`'s own comment for the full reasoning.
//
// This import is expected to FAIL to compile as written. If either type is
// ever added to `index.ts`'s export list, the import starts resolving, the
// `@ts-expect-error` below has no error left to suppress, and
// `tsc --noEmit -p tsconfig.test.json` fails with "Unused '@ts-expect-error'
// directive" — which is the point: whoever re-adds the export has to come
// here and delete this guard on purpose, rather than the surface widening
// silently.
// @ts-expect-error — ContactCartRow/ContactCartStatus must not be exported.
import type { ContactCartRow, ContactCartStatus } from '../src/index.js';

const API_URL = 'https://chat.example.com';

// ── The exact runtime export surface ───────────────────────────────────────

const PUBLIC_SURFACE: readonly string[] = [
  // client.ts
  'ChatServerClient',
  'UserScopedClient',
  // errors.ts
  'ChatApiError',
  'ChatTransportError',
  'InvalidSecretKeyError',
  'PublishableKeyAsSecretError',
  'WebhookVerificationError',
  'isRetryableContactsError',
  // keys.ts
  'isSecretKey',
  'maskSecretKey',
  'parseSecretKey',
  'secretKeyEnvironment',
  // http.ts
  'BASE_PATH',
  'HttpClient',
  // tokens.ts
  'InvalidMintRequestError',
  'buildMintTokenBody',
  'mintAccessToken',
  // commerce.ts — the addition this file exists to pin.
  'InvalidCommerceEventError',
  'buildCommerceEventBody',
  'recordCommerceEvent',
  // webhooks.ts
  'DEFAULT_TOLERANCE_SECONDS',
  'assertWebhookSignature',
  'constructWebhookEvent',
  'isKnownWebhookEvent',
  'signWebhookPayload',
  'verifyWebhookSignature',
  // wire.ts
  'normalizeMediaType',
  'toChatMessage',
  'toMessagePage',
  'unwrapEnvelope',
  // pagination.ts
  'flatten',
  'listMessagePages',
  'listMessages',
  'paginate',
];

describe('the public barrel (packages/node/src/index.ts) exports exactly the reviewed surface', () => {
  const actual = Object.keys(nodeSdk).sort();
  const expected = [...PUBLIC_SURFACE].sort();

  it('exports nothing that is not on the reviewed list', () => {
    // The half a denylist cannot do: catches an export nobody predicted —
    // a new internal helper re-exported for convenience, an `export *`
    // added to index.ts, a type promoted to a runtime value.
    const unexpected = actual.filter((name) => !expected.includes(name));
    expect(unexpected).toEqual([]);
  });

  it('still exports everything on the reviewed list', () => {
    // The other direction, so an accidental deletion is a test failure
    // rather than a silent breaking change for every consumer.
    const missing = expected.filter((name) => !actual.includes(name));
    expect(missing).toEqual([]);
  });

  it('sanity: the barrel really was imported and really has exports', () => {
    // Guards the whole describe block against passing because `nodeSdk`
    // resolved to an empty module, in which case both assertions above
    // would hold vacuously.
    expect(actual.length).toBeGreaterThan(20);
    expect(typeof nodeSdk.ChatServerClient).toBe('function');
  });

  it('the reviewed list has no duplicates, which would mask a missing export', () => {
    expect(new Set(PUBLIC_SURFACE).size).toBe(PUBLIC_SURFACE.length);
  });
});

// ── The four commerce exports, pinned by identity rather than by behaviour ──

describe('the commerce exports are present and are what they claim to be', () => {
  it('recordCommerceEvent is exported as a function', () => {
    expect(typeof nodeSdk.recordCommerceEvent).toBe('function');
  });

  it('buildCommerceEventBody is exported as a function', () => {
    expect(typeof nodeSdk.buildCommerceEventBody).toBe('function');
  });

  it('InvalidCommerceEventError is exported as a constructor, and constructs an Error subclass', () => {
    expect(typeof nodeSdk.InvalidCommerceEventError).toBe('function');
    expect(new nodeSdk.InvalidCommerceEventError('x')).toBeInstanceOf(Error);
  });

  it('isRetryableContactsError is exported as a function', () => {
    expect(typeof nodeSdk.isRetryableContactsError).toBe('function');
  });
});

// ── ContactCartRow / ContactCartStatus stay off the surface ────────────────

describe('ContactCartRow / ContactCartStatus are absent by design', () => {
  it('the type-level guard at the top of this file is the real assertion — a type is erased at runtime, so nothing here can name either type directly the way the checks above name recordCommerceEvent', () => {
    // What IS checkable at runtime: the module's complete value surface
    // (already fully enumerated above, in both directions) contains no
    // runtime trace of either name — no factory, guard, or constant for a
    // cart or a cart status anywhere in the reviewed list.
    expect(PUBLIC_SURFACE).not.toContain('ContactCartRow');
    expect(PUBLIC_SURFACE).not.toContain('ContactCartStatus');
    expect(PUBLIC_SURFACE.some((name) => name.toLowerCase().includes('cart'))).toBe(false);
  });
});

// ── recordCommerceEvent lives on ChatServerClient, never on UserScopedClient ──
//
// This is the file's central credential argument: the secret key is valid on
// a small, closed set of server-to-server routes, and a client that holds an
// access token/publishable key pair (what a browser could also hold) must
// never be able to reach a secret-key-only route. Pinned by test, not by
// review, per the reasoning in client.ts's own module header.

describe('recordCommerceEvent is on ChatServerClient, not on UserScopedClient', () => {
  it('ChatServerClient.prototype declares recordCommerceEvent', () => {
    expect(typeof ChatServerClient.prototype.recordCommerceEvent).toBe('function');
  });

  it('UserScopedClient.prototype does NOT declare recordCommerceEvent', () => {
    expect(Object.getOwnPropertyNames(UserScopedClient.prototype)).not.toContain(
      'recordCommerceEvent',
    );
    expect(
      (UserScopedClient.prototype as unknown as Record<string, unknown>)['recordCommerceEvent'],
    ).toBeUndefined();
  });

  it('a UserScopedClient obtained the documented way — ChatServerClient.asUser() — has no recordCommerceEvent', () => {
    // `asUser()` is the only way a consumer is meant to obtain one: it holds
    // only the access token and publishable key a browser would also hold,
    // and deliberately never sees the secret key `recordCommerceEvent`
    // requires.
    const chat = new ChatServerClient({
      apiUrl: API_URL,
      secretKey: SECRET_KEY_LIVE,
      publishableKey: PUBLISHABLE_KEY_LIVE,
    });
    const user = chat.asUser('tok_test_1');

    expect(user).toBeInstanceOf(UserScopedClient);
    expect('recordCommerceEvent' in user).toBe(false);

    // @ts-expect-error — recordCommerceEvent must not exist on UserScopedClient.
    // If it is ever added, this property access starts compiling, the
    // directive above has nothing left to suppress, and
    // `tsc --noEmit -p tsconfig.test.json` fails.
    void user.recordCommerceEvent;
  });

  it('constructing a UserScopedClient directly with a secret-key-authenticated HttpClient still exposes no recordCommerceEvent — the class itself has no such method to reach, regardless of what credential the HttpClient it is handed carries', () => {
    const http = new HttpClient({
      apiUrl: API_URL,
      authHeaders: () => ({ Authorization: `Bearer ${SECRET_KEY_LIVE}` }),
    });
    const user = new UserScopedClient(http);
    expect('recordCommerceEvent' in user).toBe(false);
  });
});
