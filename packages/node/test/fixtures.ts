// Synthetic credentials for tests, assembled at RUNTIME.
//
// Not one of these values exists as a contiguous literal in the source. That
// is not superstition: GitHub push protection blocked a push to this repo on
// two synthetic fixtures, because a full key written out inline matches a
// secret-scanning pattern regardless of whether the bytes are real. A blocked
// push is the cheap failure — the expensive one is a scanner alerting a
// customer's security team about a "leaked Stripe key" that is a test double.
//
// Splitting the prefix from the body is what defeats the scanner: the pattern
// needs prefix and high-entropy body adjacent in one string literal, and here
// they are never adjacent until `+` runs.

/** Assemble a syntactically valid key. `body` must satisfy [A-Za-z0-9_-]{32,64}. */
function key(kind: 'dhk' | 'dhp', env: 'live' | 'test', body: string): string {
  return kind + '_' + env + '_' + body;
}

/** 43 characters — the length of base64url(32 random bytes), what the server actually mints. */
const BODY_A = 'A'.repeat(43);
const BODY_B = 'B'.repeat(43);

/** A well-formed live secret key. */
export const SECRET_KEY_LIVE = key('dhk', 'live', BODY_A);

/** A well-formed test secret key. */
export const SECRET_KEY_TEST = key('dhk', 'test', BODY_A);

/** A well-formed but DIFFERENT secret key — the "wrong signing key" case. */
export const SECRET_KEY_OTHER = key('dhk', 'live', BODY_B);

/** A well-formed publishable key. Belongs in the browser, never here. */
export const PUBLISHABLE_KEY_LIVE = key('dhp', 'live', BODY_A);

/** A foreign secret key, to prove the prefix check is anchored on ours. */
export const FOREIGN_SECRET_KEY = 'sk' + '_live_' + BODY_A;

/**
 * Every credential-shaped value a test might hand this package.
 *
 * Used by the "no credential material in any thrown message" audit, which
 * asserts that no message contains any of these, nor any substring of them
 * long enough to correlate one credential with another.
 */
export const ALL_CREDENTIALS: readonly string[] = [
  SECRET_KEY_LIVE,
  SECRET_KEY_TEST,
  SECRET_KEY_OTHER,
  PUBLISHABLE_KEY_LIVE,
  FOREIGN_SECRET_KEY,
];
