// Normalizing whatever `getToken()` produced into an {@link AuthToken}.
//
// §10.6 names three ways credentials can fail, and treats them identically:
// `getToken()` throws, it rejects, or it "resolves to a falsy value". A
// provider that resolves to `''`, `null`, or `undefined` has failed just as
// completely as one that threw — the difference is only that it did so
// quietly. This module erases that difference so the controller has exactly
// one auth-failure path to route through `AuthBackoffPolicy`.
//
// §14: no token value ever appears in an error message, a log line, or state.
// The thrown error below describes the *shape* of what came back, never its
// contents.

import type { AuthToken, TokenProvider } from './types.js';

/** Thrown when `getToken()` produced nothing usable. Never carries token material. */
export class MissingTokenError extends Error {
  constructor(detail: string) {
    super(`getToken() did not return a usable token (${detail})`);
    this.name = 'MissingTokenError';
  }
}

/**
 * Calls `provider` and normalizes the result.
 *
 * `await` covers both the sync and async forms — §6.1's `() => Promise<string>`
 * and a host that already has a valid token in hand.
 *
 * @throws whatever the provider threw or rejected with, or
 *   {@link MissingTokenError} when it produced a falsy or malformed value.
 */
export async function resolveToken(provider: TokenProvider): Promise<AuthToken> {
  const result: unknown = await provider();

  if (typeof result === 'string') {
    if (result === '') throw new MissingTokenError('empty string');
    return { token: result };
  }

  if (result === null || result === undefined) {
    throw new MissingTokenError(String(result));
  }

  if (typeof result !== 'object' || !('token' in result)) {
    throw new MissingTokenError(`expected a string or { token }, got ${typeof result}`);
  }

  const { token, expiresInMs } = result as { token: unknown; expiresInMs?: unknown };

  if (typeof token !== 'string' || token === '') {
    throw new MissingTokenError('token field was empty or not a string');
  }

  // A non-positive or non-finite lifetime is dropped rather than rejected: an
  // unknown expiry is a supported state (no proactive refresh, fall back to
  // the reactive `AUTH_EXPIRED` path), whereas failing the whole connection
  // over a malformed *hint* would turn a degraded feature into an outage.
  if (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0) {
    return { token };
  }

  return { token, expiresInMs };
}
