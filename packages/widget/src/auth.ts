// The §14 key split, enforced at the one place a browser could break it.
//
// ── What "structurally impossible" means here ────────────────────────────
//
// Three independent things have to hold, and each is a different kind of
// mechanism so that no single mistake defeats all three:
//
//   1. TYPE. `WidgetConfig` has no secret-key field (config.ts). A bundle
//      cannot transmit a credential it has no slot to receive.
//   2. VALUE. Whatever lands in the publishable slot goes through core's
//      `parsePublishableKey`, which throws `SecretKeyInClientError` on
//      `dhk_`/`dhsk_`/`sk_`. A paste into the wrong field fails at boot,
//      loudly, before a socket is opened.
//   3. SWEEP. Every other string a `<script>` tag can carry is checked with
//      the SAME predicate, because the realistic accident is not
//      `data-publishable-key="dhk_live_…"` — it is someone adding
//      `data-secret-key` or `data-api-key` because it seemed symmetrical.
//      An unknown attribute holding a secret must fail as hard as a known
//      one, so the sweep does not care which attribute it was.
//
// The sweep asks core, rather than keeping its own prefix list. core's
// keys.ts is the authority on what a secret looks like — it has been through
// two prefix renames already (`pk_`/`sk_` → `dhpk_`/`dhsk_` → `dhp_`/`dhk_`),
// and a second copy of that table in this package would have silently gone
// stale at each one, in the direction that lets a secret through.
//
// ── What this module deliberately does NOT do ────────────────────────────
//
// It never logs, reports, or embeds a token or a key in an error message,
// including a prefix or a length — same rule and same reasoning as
// core/auth/keys.ts. Errors here reach `ChatState.lastError` and the host's
// error tracker.

import { SecretKeyInClientError, createTokenProvider, parsePublishableKey } from '@dhaam-ccrm/core';
import type { PublishableKey, TokenProvider, TokenResponse } from '@dhaam-ccrm/core';

import { WidgetConfigError } from './config.js';
import type { ResolvedConfig } from './config.js';

/**
 * Whether `value` is a secret key, decided by core.
 *
 * Implemented as "ask the parser and look at which error it threw" rather
 * than as a prefix comparison, so this package has no opinion of its own to
 * drift. `parsePublishableKey` throws `SecretKeyInClientError` for exactly
 * the secret prefixes and a plain `InvalidPublishableKeyError` for everything
 * else that is merely malformed — which is the distinction wanted here: a
 * user id that is not a key at all must not trip the sweep.
 */
export function looksLikeSecretKey(value: string): boolean {
  try {
    parsePublishableKey(value);
    return false;
  } catch (error) {
    return error instanceof SecretKeyInClientError;
  }
}

/**
 * Refuses to boot if any host-supplied string is a secret key.
 *
 * Takes the values without their attribute names on purpose — the name is not
 * consulted, so a `data-whatever` carrying a secret fails identically to a
 * `data-secret-key`. The thrown error names nothing it was given.
 */
export function assertNoSecretKeys(values: Iterable<string>): void {
  for (const value of values) {
    if (looksLikeSecretKey(value)) throw new SecretKeyInClientError();
  }
}

/**
 * Both halves of the credential the SDK needs, from one source of truth.
 *
 * Core's `getToken` and `@dhaam-ccrm/rest`'s `getAccessToken` each need the
 * current token, and core never exposes the one it is using — so
 * `examples/demo` has to keep its own `TokenStore` and hand it to both, which
 * its own comments call "the single most awkward thing about wiring the SDK
 * up". A widget that made every integrator re-solve that would not be a
 * drop-in. This type is that store, owned by the widget instead.
 */
export interface TokenSource {
  /** For `ChatClientConfig.getToken`. Core decides when to call it (§10.4). */
  readonly getToken: TokenProvider;
  /** For `RestClientOptions.getAccessToken`. Reuses whatever core last minted. */
  readonly getAccessToken: () => Promise<string>;
}

/**
 * Validates the publishable key and builds the token plumbing behind it.
 *
 * @throws {SecretKeyInClientError} if the publishable slot holds a secret key.
 * @throws {WidgetConfigError} if neither a token endpoint nor a `getToken` was given.
 */
export function createTokenSource(config: ResolvedConfig): {
  readonly publishableKey: PublishableKey;
  readonly tokens: TokenSource;
} {
  // Check 2. Throws before anything below it can run, so a secret key never
  // reaches a fetch, a socket, or a log line.
  const publishableKey = parsePublishableKey(config.auth.publishableKey);

  const mint = buildMint(config);

  let accessToken: string | null = null;
  let inFlight: Promise<string> | null = null;

  /**
   * Wraps `mint` so that every successful mint updates the cached token.
   *
   * Only ever WRITTEN on success, and never read by `mint` itself: core owns
   * refresh, and a mint that returned the cached value would reinstall the
   * same expiring credential forever (the exact bug examples/demo's TokenStore
   * documents).
   */
  const mintAndCache = async (): Promise<TokenResponse> => {
    const response = await mint();
    accessToken = readAccessToken(response);
    return response;
  };

  const getAccessToken = async (): Promise<string> => {
    if (accessToken !== null) return accessToken;
    // Collapsed rather than raced: a first paint fires a history fetch and a
    // connect at the same time, and two parallel mints would have the second
    // overwrite the first's token while core is already using it.
    inFlight ??= mintAndCache()
      .then(() => {
        if (accessToken === null) throw new Error('token endpoint returned no access token');
        return accessToken;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    publishableKey,
    tokens: {
      // `createTokenProvider` rather than a hand-rolled adapter: §10.3's
      // endpoint reports `expiresIn` in SECONDS and core's native field is
      // `expiresInMs`, and the obvious one-line adapter turns a 3600-second
      // token into a 3600ms one and refreshes every ~2.9 seconds forever.
      getToken: createTokenProvider(mintAndCache),
      getAccessToken,
    },
  };
}

/** Pulls the token string out of whatever shape the host's endpoint returned. */
function readAccessToken(response: TokenResponse): string | null {
  if (typeof response === 'string') return response === '' ? null : response;
  if (typeof response !== 'object' || response === null) return null;
  const source = response as unknown as Record<string, unknown>;
  // `token` last: it is core's own `AuthToken` field name, and the two §10.3
  // spellings should win over it if a backend somehow returns both.
  for (const field of ['accessToken', 'access_token', 'token'] as const) {
    const value = source[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function buildMint(config: ResolvedConfig): () => Promise<TokenResponse> {
  const { getToken, tokenEndpoint } = config.auth;

  if (getToken !== undefined) {
    return async () => getToken();
  }

  if (tokenEndpoint === undefined) {
    throw new WidgetConfigError('auth needs either a tokenEndpoint or a getToken function');
  }

  return async () => {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      // The host's own session cookie is what authenticates the end user to
      // the host's own endpoint. `same-origin` rather than `include`: an
      // absolute cross-origin tokenEndpoint should have to opt into sending
      // cookies through its own CORS setup, not get it silently from us.
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      // The status, never the body. The body is attacker-influencable and
      // this message reaches `ChatState.lastError` and the host's tracker.
      throw new Error(`token endpoint returned ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  };
}
