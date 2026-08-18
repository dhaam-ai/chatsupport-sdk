// Adapting a real token endpoint's response to core's `TokenProvider` — PRD
// §10.3, §10.4.
//
// T8 fixed the seam as `string | { token, expiresInMs }` and declined to decode
// a JWT `exp` claim inside a state machine. That was right. But it leaves a gap
// at the edge: §10.3's endpoint returns `{ accessToken, expiresIn }`, and
// `resolveToken` rejects that outright — it requires a `token` field, so a
// customer piping their own backend's response straight through gets
// `MissingTokenError` on the first connect.
//
// The gap that matters more is the one that does NOT fail loudly. `expiresIn`
// is SECONDS:
//
//   "The lifetime in seconds of the access token. For example, the value
//    '3600' denotes that the access token will expire in one hour."
//   — RFC 6749 §4.2.2, https://www.rfc-editor.org/rfc/rfc6749#section-4.2.2
//
// `expiresInMs` is milliseconds. The obvious hand-written adapter --
// `{ token: r.accessToken, expiresInMs: r.expiresIn }` -- type-checks, passes
// review, and turns a 3600-second token into a 3600ms one. The controller then
// refreshes at 80% of that: every 2.88 seconds, forever, against the customer's
// own token endpoint. A unit error that reads correctly is exactly the kind
// this module exists to make unwritable.
//
// §14: nothing here puts a token in an error message. `InvalidTokenResponseError`
// describes the SHAPE of what came back, never its contents — and it must,
// because the controller folds `error.message` into `ChatError.message`
// (`getToken() failed: ...`), which reaches `lastError` state and the `error`
// event that a host app is likely to log.

import type { AuthToken, TokenProvider } from '../connection/index.js';

/**
 * §10.3's response: `POST /v1/tokens` → `{ accessToken, expiresIn }`.
 *
 * `expiresIn` is in SECONDS, following RFC 6749. Optional because a backend
 * that does not report a lifetime is supported — core falls back to the
 * reactive `AUTH_EXPIRED` path (§10.4).
 */
export interface AccessTokenResponse {
  readonly accessToken: string;

  /** Token lifetime in **seconds**. */
  readonly expiresIn?: number | string;
}

/**
 * The RFC 6749 wire shape, snake_case.
 *
 * Supported because a customer whose backend proxies an OAuth 2.0 identity
 * provider forwards this verbatim — it is the second real shape, not a
 * hypothetical one.
 */
export interface OAuthTokenResponse {
  readonly access_token: string;

  /** Token lifetime in **seconds**. */
  readonly expires_in?: number | string;
}

/** Any token-endpoint shape {@link toAuthToken} understands. */
export type TokenResponse = string | AccessTokenResponse | OAuthTokenResponse | AuthToken;

/**
 * Thrown when a token response carried no usable token.
 *
 * Never carries the response. See the §14 note at the top of this file: this
 * message is surfaced to the host app through `ChatError.message`.
 */
export class InvalidTokenResponseError extends Error {
  constructor(detail: string) {
    super(`token response did not contain a usable token (${detail})`);
    this.name = 'InvalidTokenResponseError';
  }
}

/**
 * Largest lifetime accepted, in ms (2^31 - 1, ~24.8 days).
 *
 * Not cosmetic. `setTimeout` stores its delay in a signed 32-bit int; a larger
 * delay wraps and fires almost immediately. The controller schedules the
 * proactive refresh at `expiresInMs * refreshAtFraction`, so an absurd
 * lifetime — a misconfigured backend reporting years, or seconds mistaken for
 * milliseconds in the other direction — would not produce a long timer, it
 * would produce an instant one, and the refresh would loop as fast as the
 * event loop allows against the customer's own token endpoint.
 *
 * Clamping rather than dropping keeps proactive refresh working for genuinely
 * long-lived tokens: they refresh at ~24.8 days instead of never, which is
 * harmless. Dropping would silently disable the §10.4 behaviour instead.
 */
const MAX_EXPIRES_IN_MS = 2_147_483_647;

/**
 * Normalizes a lifetime to milliseconds, or `null` when unusable.
 *
 * A numeric string is accepted because some backends serialize `expires_in`
 * as one. RFC 6749 specifies a number, so this is tolerance rather than
 * contract — but the failure it prevents is silent (an unparsed lifetime means
 * no proactive refresh at all, and nothing says so), which is worth two lines.
 *
 * Anything non-positive or non-finite yields `null`: an unknown expiry is a
 * supported state, and rejecting the whole connection over a malformed *hint*
 * would turn a degraded feature into an outage. Same call `resolveToken` makes.
 */
function toMilliseconds(value: unknown, multiplier: number): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;

  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric <= 0) return null;

  return Math.min(numeric * multiplier, MAX_EXPIRES_IN_MS);
}

/** Reads a string field, or `undefined` when absent or not a non-empty string. */
function readToken(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Normalizes a token-endpoint response into core's {@link AuthToken}.
 *
 * Accepts, in this order:
 *
 * | Field         | Unit         | Source                  |
 * |---------------|--------------|-------------------------|
 * | `token`       | —            | core-native             |
 * | `accessToken` | —            | §10.3                   |
 * | `access_token`| —            | RFC 6749                |
 * | `expiresInMs` | milliseconds | core-native             |
 * | `expiresIn`   | **seconds**  | §10.3                   |
 * | `expires_in`  | **seconds**  | RFC 6749                |
 *
 * The token and the lifetime are resolved independently, so a mixed response
 * still works — each lifetime field's unit is unambiguous from its own name,
 * which is the property that makes the conversion safe to do automatically.
 *
 * A bare string is passed through, so this is a no-op for hosts already
 * satisfying §6.1's `() => Promise<string>`.
 *
 * @throws {InvalidTokenResponseError} when no usable token is present.
 *   Never contains any part of the response.
 */
export function toAuthToken(response: TokenResponse): AuthToken {
  if (typeof response === 'string') {
    if (response === '') throw new InvalidTokenResponseError('empty string');
    return { token: response };
  }

  if (response === null || response === undefined) {
    throw new InvalidTokenResponseError(String(response));
  }

  if (typeof response !== 'object') {
    throw new InvalidTokenResponseError(`expected a string or an object, got ${typeof response}`);
  }

  const source = response as unknown as Record<string, unknown>;

  const token =
    readToken(source, 'token') ??
    readToken(source, 'accessToken') ??
    readToken(source, 'access_token');

  if (token === undefined) {
    throw new InvalidTokenResponseError(
      'expected a non-empty "token", "accessToken", or "access_token" field',
    );
  }

  const expiresInMs =
    toMilliseconds(source['expiresInMs'], 1) ??
    toMilliseconds(source['expiresIn'], 1000) ??
    toMilliseconds(source['expires_in'], 1000);

  // Built conditionally rather than as `{ token, expiresInMs: undefined }`:
  // `exactOptionalPropertyTypes` treats a present-but-undefined optional as a
  // type error, and the two states genuinely differ downstream — absent means
  // "fall back to reactive refresh".
  return expiresInMs === null ? { token } : { token, expiresInMs };
}

/**
 * Wraps a function returning a token-endpoint response into a {@link TokenProvider}.
 *
 * The intended shape of a host's integration:
 *
 * ```ts
 * const getToken = createTokenProvider(async () => {
 *   const response = await fetch('/api/chat-token', { method: 'POST' });
 *   return response.json() as Promise<AccessTokenResponse>;
 * });
 * ```
 *
 * `getToken` is then passed straight to core. Core owns when it is called —
 * before the first connect, before every reconnect, and on every proactive and
 * reactive refresh (§10.4) — so `fetchToken` must be callable repeatedly and
 * must return a *fresh* token each time. Returning a cached one defeats the
 * refresh entirely: core would reinstall the same expiring credential.
 *
 * Failures propagate untouched. A rejected `fetchToken` is an auth failure
 * under §10.6 exactly like a throwing `getToken()`, and core escalates three
 * consecutive ones to `suspended` through `AuthBackoffPolicy`. Catching here
 * would convert a credential outage into an invisible retry loop.
 */
export function createTokenProvider(
  fetchToken: () => Promise<TokenResponse> | TokenResponse,
): TokenProvider {
  return async () => toAuthToken(await fetchToken());
}
