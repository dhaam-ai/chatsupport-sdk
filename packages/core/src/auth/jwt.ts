// Reads JWT claims without verifying the signature — core never needs to
// verify a token it didn't issue, only to read `exp` (§10.4, proactive
// refresh) and `sub` (the sender id for optimistic messages/typing/reads).
//
// Uses the global `atob`, not Node's `Buffer` — available in every browser
// and in Node (global since Node 16) alike, keeping this portable to the
// same set of environments the rest of core targets (PRD §4).

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Returns the token's decoded payload claims, or `undefined` if the token
 * isn't a parseable JWT. Never throws — `getToken()` can return any string
 * in principle.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  const payloadSegment = parts[1];
  if (parts.length < 2 || payloadSegment === undefined) return undefined;

  try {
    const payload: unknown = JSON.parse(base64UrlDecode(payloadSegment));
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `exp` claim as epoch-milliseconds, or `undefined` if unparseable or
 * absent. An unparseable token just means proactive refresh can't be
 * scheduled (reactive `AUTH_EXPIRED` handling still applies).
 */
export function decodeJwtExpiryMs(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
}

/** The `sub` claim (the authenticated user's id), or `undefined` if unparseable or absent. */
export function decodeJwtSubject(token: string): string | undefined {
  const sub = decodeJwtPayload(token)?.['sub'];
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
}
