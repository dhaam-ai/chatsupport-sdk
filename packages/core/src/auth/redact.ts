// Credential redaction — PRD §14.
//
// §14: "No credential (token, secret key) is ever passed to `logger` or
// included in any log line core emits — logger calls must be reviewed for this
// on every PR touching auth code."
//
// ── This is a net, not a guarantee ───────────────────────────────────────
//
// Read this before relying on anything below. There are two ways to keep a
// credential out of a log line, and they are not equally good:
//
//   1. STRUCTURAL — never read the field. `transport/logger.ts` does this:
//      `frameLogContext` is an allowlist of four envelope fields, so there is
//      no code path that can log `d.token` because there is no code path that
//      reads it. This is a guarantee, and it is the one to reach for.
//
//   2. PATTERN-BASED — take a string that may already contain a credential and
//      remove what looks like one. That is this module. It is a BACKSTOP for
//      strings core did not construct and cannot restructure.
//
// (2) is strictly weaker than (1): it recognizes the credential formats this
// system issues, and a format it does not recognize passes through untouched.
// Do not use it to justify putting a credential into a string in the first
// place. It exists for the case where a string of unknown provenance is
// already in hand.
//
// The motivating case is concrete. `ConnectionController` reports a failed
// `getToken()` as ``getToken() failed: ${errorMessage(error)}``, where
// `errorMessage` returns the HOST APP'S error message verbatim. Core does not
// author that string, and HTTP clients routinely build error messages that
// embed the request — so a customer whose token endpoint returns 401 can hand
// core an error whose message contains a live token. Core then writes it to
// `ChatState.lastError` and emits it as the §6.5 `error` event.

/** What a redacted value is replaced with. A fixed marker, carrying nothing. */
export const REDACTED = '[redacted]';

/**
 * Replaces any value with {@link REDACTED}.
 *
 * For call sites that must include a credential-bearing field in a shape they
 * are logging or serializing. The argument is accepted and discarded — the
 * point is that `redact(token)` reads as intent at the call site and cannot
 * ever return anything derived from its input.
 *
 * §14 rules out the tempting middle grounds: no prefix (it correlates a
 * credential across log lines), no length (it fingerprints which one), no hash
 * (it is a stable identifier for the secret, and a cheap one to attack when
 * the input space is a known token format).
 */
export function redact(_value: unknown): string {
  return REDACTED;
}

/**
 * Patterns for the credential formats this system issues.
 *
 * Deliberately narrow. A rule broad enough to catch "any long random-looking
 * string" would also catch ULIDs, session ids, and URL path segments — and a
 * redactor that scrubs the identifiers you need to debug with gets switched
 * off, which is worse than one that admits its limits.
 *
 * Order matters: `Bearer <token>` runs first so it consumes the scheme along
 * with the credential, rather than leaving a bare `Bearer [redacted]` behind
 * a partial match.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // `Authorization: Bearer <token>` in any casing.
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,

  // A JWT. A JWT header is JSON starting `{"`, which base64url-encodes to
  // `eyJ` — so every JWT this system mints begins that way (§10.3 access
  // tokens, and anything a customer's identity provider issues).
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g,

  // Publishable and secret keys (§10.1). Matched without a leading word
  // boundary so a key concatenated onto another word is still caught —
  // over-redacting is the safe direction here.
  //
  // The `dh` is optional so this catches both our namespaced `dhpk_`/`dhsk_`
  // keys and a foreign-vendor `pk_`/`sk_` (Stripe's scheme, which ours
  // deliberately no longer collides with). Without the optional group the
  // pattern would still fire on the `pk_` inside `dhpk_…` but leave a
  // dangling `dh` in the output — redacting a credential *almost* entirely is
  // not redaction.
  /(?:dh)?[sp]k_[A-Za-z0-9_-]+/gi,
];

/**
 * Removes recognizable credential material from `text`.
 *
 * Intended for strings of unknown provenance that are about to be logged,
 * stored, or emitted to the host app — above all, error messages authored
 * outside core. See the module note: this is a backstop, not a guarantee, and
 * it is not a licence to put a credential into a string.
 *
 * Returns `text` unchanged when nothing matches, so it is safe to apply
 * broadly. Non-string input is coerced, so it can be dropped in front of an
 * `unknown` without a type guard.
 */
export function scrubCredentials(text: string): string {
  let scrubbed = typeof text === 'string' ? text : String(text);

  for (const pattern of CREDENTIAL_PATTERNS) {
    // Each literal is its own object, but `String.prototype.replace` with a
    // `/g` regex resets `lastIndex` itself, so these are safe to reuse.
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }

  return scrubbed;
}

/**
 * True when `text` still contains recognizable credential material.
 *
 * The assertion form of {@link scrubCredentials}, for tests and for a
 * defensive check before handing a string to a host-supplied `logger` (§6.1).
 * Subject to the same limit: it detects the formats above and no others, so a
 * `false` is evidence rather than proof.
 */
export function containsCredentialMaterial(text: string): boolean {
  return scrubCredentials(text) !== text;
}
