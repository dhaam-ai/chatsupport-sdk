// Token minting — `POST /chat-services/api/v1/tokens`.
//
// The reason this package exists. Without it a customer cannot mint a token,
// which means they cannot authenticate a single end user.
//
// ── The flow this sits in the middle of ──────────────────────────────────
//
//   browser ──▶ the customer's OWN endpoint (commonly "/token")
//                     │  runs on their server, session-authenticated by
//                     │  whatever they already use
//                     ▼
//               mintAccessToken()  ── Authorization: Bearer dhsk_… ──▶ chat-service
//                     │
//                     ◀── { accessToken, expiresIn } ──
//                     │
//               relay ONLY accessToken back to the browser
//                     ▼
//   browser ──▶ getToken() ──▶ @dhaam-ccrm/core
//
// The customer's endpoint must decide WHO IS ASKING before calling this. This
// function takes `userId` on trust — it is the caller's own session that
// establishes identity, and an endpoint that forwards a browser-supplied
// `userId` unchecked lets any visitor mint a token for any user. That is the
// single most consequential mistake available in this integration, which is
// why it is stated here, in the README, and nowhere else diluted.

import type { HttpClient } from './http.js';
import type { MintTokenRequest, MintTokenResponse } from './types.js';

/**
 * Claim names the SERVER rejects with `400 VALIDATION_FAILED`.
 *
 * Mirrored from the service's own `RESERVED_CLAIMS`
 * (`src/infrastructure/auth/access-token.ts`) rather than from the OpenAPI
 * document, which lists only six of these — see the README's drift notes. The
 * service is the authority on what it will refuse, and checking here turns a
 * network round trip into an immediate, specific error naming the offending
 * claim, which the server's response deliberately does not.
 *
 * Screening locally does not make the server's check redundant: a customer on
 * an older SDK version, or calling the endpoint directly, still needs it.
 * This is an ergonomics layer over a boundary that stays enforced.
 */
const RESERVED_CLAIMS: ReadonlySet<string> = new Set([
  'sub',
  'iss',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'tenantId',
  'env',
  'roles',
  'roleId',
  'userId',
  'userName',
  'scope',
]);

/** Bounds the server also enforces. Checked here so the failure is local and named. */
const MAX_CUSTOM_CLAIMS = 20;

/**
 * Thrown when a mint request is malformed before it leaves this process.
 *
 * Carries the offending CLAIM NAMES, which are chosen by the customer's own
 * code and are not credential material. It never carries claim VALUES — those
 * are end-user attributes (a plan tier, an account region, an email) and an
 * error that ends up in a tracker should not carry them.
 */
export class InvalidMintRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMintRequestError';
  }
}

/**
 * Flatten the ergonomic request into the wire shape.
 *
 * The wire format is flat — custom claims sit alongside `userId` as
 * `additionalProperties`. The SDK type keeps them in a nested `claims` bag
 * because a flat input type cannot distinguish `userId` from a custom claim
 * named `userId`, and would silently accept a typo'd `usrId` as a custom
 * claim while minting a token whose `sub` is not the user the caller meant.
 */
export function buildMintTokenBody(request: MintTokenRequest): Record<string, unknown> {
  if (typeof request?.userId !== 'string' || request.userId === '') {
    throw new InvalidMintRequestError(
      'userId is required — it becomes the token\'s subject and the session\'s customer identity',
    );
  }

  const claims = request.claims ?? {};
  const names = Object.keys(claims);

  const reserved = names.filter((name) => RESERVED_CLAIMS.has(name));
  if (reserved.length > 0) {
    throw new InvalidMintRequestError(
      `these claim names are reserved and may not be set: ${reserved.join(', ')}. ` +
        'A customer may describe their user; the token\'s scope, lifetime, issuer and ' +
        'privileges are decided by the service. Use `name` and `email` for profile fields.',
    );
  }

  if (names.length > MAX_CUSTOM_CLAIMS) {
    throw new InvalidMintRequestError(
      `at most ${MAX_CUSTOM_CLAIMS} custom claims are allowed, received ${names.length}`,
    );
  }

  return {
    userId: request.userId,
    // Spread rather than assigning undefined: an explicit `"name": null` on
    // the wire is a different request from an absent field, and the server
    // validates `name` as a string when present.
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.email === undefined ? {} : { email: request.email }),
    ...claims,
  };
}

/**
 * Mint a short-lived, scoped user access token.
 *
 * Retrying after a timeout is always safe: minting has no persisted side
 * effect to de-duplicate, and each call mints a fresh, independent token.
 * There is deliberately no `Idempotency-Key` on this route for that reason.
 *
 * @throws {InvalidMintRequestError} if the request is malformed locally.
 * @throws {ChatApiError} if the server rejects it — including `401
 *   AUTH_INVALID` for an unknown, revoked, or wrong-type key. That response is
 *   intentionally identical for every authentication failure, so it cannot
 *   tell you WHICH check failed; there is no oracle to enumerate against.
 * @throws {ChatTransportError} if the request never reached the server.
 */
export async function mintAccessToken(
  http: HttpClient,
  request: MintTokenRequest,
): Promise<MintTokenResponse> {
  const body = buildMintTokenBody(request);
  const response = await http.request<unknown>('POST', '/tokens', { body });

  // Narrowed rather than cast. A gateway returning an HTML error page with a
  // 201, or a proxy stripping the body, would otherwise hand the caller
  // `undefined.accessToken` at the point where they relay it to a browser —
  // a failure that surfaces as a confusing client-side auth error rather than
  // as a server-side one.
  if (
    typeof response !== 'object' ||
    response === null ||
    typeof (response as MintTokenResponse).accessToken !== 'string' ||
    typeof (response as MintTokenResponse).expiresIn !== 'number'
  ) {
    // The malformed body is NOT included. It came from the token endpoint, so
    // on a partially-successful response it may contain a real access token.
    throw new Error(
      'the token endpoint returned a response without a valid { accessToken, expiresIn } — ' +
        'check that apiUrl points at chat-service and not at a proxy or error page. ' +
        'The response body is deliberately omitted from this message.',
    );
  }

  const { accessToken, expiresIn } = response as MintTokenResponse;
  return { accessToken, expiresIn };
}
