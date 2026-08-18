// Publishable-key hygiene — PRD §10.1, §10.2, §10.7, §14.
//
// §14 requires that `dhsk_live_...` be "structurally impossible to reference
// from any browser-targeted package". A lint rule or a code review cannot
// deliver that; a type can. `PublishableKey` is a branded string that only
// {@link parsePublishableKey} can produce, so a function demanding one cannot
// be handed a raw string — secret, publishable, or otherwise — without going
// through the check that rejects secrets.
//
// ── Why no input value ever appears in an error message ──────────────────
//
// These functions run on UNVALIDATED input. Until the check passes, the value
// might be a secret key, a user JWT, or a password someone pasted into the
// wrong config field. An `Error` is thrown, caught by a host framework, and
// posted to an error tracker — so an error carrying the input is a credential
// exfiltration path with a stack trace attached.
//
// The rule is therefore absolute and uniform: no substring, no prefix, no
// length, no hash, no character count. §14 rules out prefixes and lengths for
// tokens (a prefix correlates a credential, a length fingerprints it), and the
// same reasoning applies here with more force, because the whole point of this
// module is that it is sometimes handed the secret key.
//
// Diagnosability is preserved by naming the CATEGORY of failure precisely —
// "empty", "must start with dhpk_live_ or dhpk_test_", "contains characters that
// are not allowed" — which tells a developer what to fix without echoing what
// they typed. `SecretKeyInClientError` is its own class for the same reason:
// the actionable fact is "you pasted a secret key into a browser config", and
// that is carried by the error's identity, not by its data.

/** Brand carrier. Not exported: only this module can produce a {@link PublishableKey}. */
declare const publishableKeyBrand: unique symbol;

/**
 * A string validated as a publishable key (§10.1).
 *
 * Assignable to `string`, so it flows into anything taking a plain string
 * (`ConnectionControllerOptions.publishableKey`, `connection.hello.d`) with no
 * unwrapping. The reverse does not hold, which is the entire point.
 *
 * ── Rotation (§10.7) ──
 *
 * Rotating a publishable key REQUIRES A CLIENT BUNDLE REDEPLOY. It is baked in
 * at build/config time and ships to every browser, so there is no way to swap
 * it without shipping new client code.
 *
 * This is the opposite of the secret key (`dhsk_live_...`), which rotates with a
 * change on the customer's own backend and no client release at all, because
 * it never ships client-side — see {@link SecretKeyInClientError}. Customers
 * routinely assume both keys rotate the same way; they do not.
 */
export type PublishableKey = string & { readonly [publishableKeyBrand]: true };

/** Which environment a publishable key addresses (§10.1). */
export type PublishableKeyEnvironment = 'live' | 'test';

// Namespaced with `dh` deliberately. A bare `dhpk_live_`/`dhsk_live_` scheme is
// byte-identical to Stripe's, so GitHub's secret scanner reports our keys as
// Stripe keys — it blocked a push to this repo on two synthetic test fixtures.
// Worse than the inconvenience: a customer committing one of our keys gets
// their own push blocked and blames the SDK, and a genuine leak of ours is
// triaged as a Stripe incident and routed to the wrong vendor.
const LIVE_PREFIX = 'dhpk_live_';
const TEST_PREFIX = 'dhpk_test_';

/** Our own secret-key prefix. */
const OUR_SECRET_PREFIX = 'dhsk_';

/**
 * Foreign secret-key prefixes we also refuse.
 *
 * `sk_` is Stripe's (and several others' by convention). Someone pasting a
 * Stripe secret key into this slot has made the same mistake with the same
 * consequences, and telling them "must start with dhpk_live_" would send them
 * hunting for a formatting error instead of rotating an exposed credential.
 */
const FOREIGN_SECRET_PREFIXES = ['sk_'] as const;

/**
 * Body charset: URL-safe base64 characters.
 *
 * Deliberately says nothing about length — the PRD fixes the prefixes (§10.1)
 * and not the body, so inventing a minimum would reject valid keys the day the
 * issuer changes format, which is a self-inflicted outage.
 *
 * It does exclude `.`, whitespace, and quotes, which is what makes it useful:
 * a JWT (dot-separated) or a shell-quoted value pasted into the key field
 * fails here instead of reaching the wire.
 */
const KEY_BODY = /^[A-Za-z0-9_-]+$/;

/** Thrown when a value is not a well-formed publishable key. Never carries the value. */
export class InvalidPublishableKeyError extends Error {
  constructor(reason: string) {
    super(`publishableKey is not a valid publishable key: ${reason}`);
    this.name = 'InvalidPublishableKeyError';
  }
}

/**
 * Thrown when a secret key is supplied where a publishable key belongs.
 *
 * Its own class, not a variant of {@link InvalidPublishableKeyError}, because
 * this is not a typo — it is a credential-handling incident. A secret key that
 * reached client config has been in a bundler's memory, probably in a source
 * map, and possibly in a deployed asset. The fix is to rotate it, not to
 * correct a character.
 */
export class SecretKeyInClientError extends Error {
  constructor() {
    super(
      'A secret key was supplied where a publishable key (dhpk_live_.../dhpk_test_...) ' +
        'is required. Secret keys must never reach client-side code: they mint user tokens. ' +
        'Use the publishable key here, keep the secret key on your own backend (PRD §10.1), ' +
        'and rotate the exposed secret key now. ' +
        'The offending value is deliberately omitted from this message.',
    );
    this.name = 'SecretKeyInClientError';
  }
}

/**
 * True when `value` looks like a secret key.
 *
 * Case-insensitive and whitespace-tolerant on purpose. A real key is lowercase
 * and untrimmed input is rejected anyway, but this predicate guards the
 * `sk_`-must-never-pass invariant, and a guard that can be stepped around by
 * a stray space or a capital letter is not a guard. Over-detecting costs a
 * developer one clear error; under-detecting costs a leaked secret key.
 */
function looksLikeSecretKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith(OUR_SECRET_PREFIX)) return true;
  // Checked as well as ours, not instead: narrowing this to our own prefix
  // would let a real Stripe secret key fall through to the generic
  // "must start with dhpk_live_" error, which reads as a typo rather than as
  // the credential incident it is.
  return FOREIGN_SECRET_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Validates `value` as a publishable key (§10.1, §10.2).
 *
 * Call this at construction — as early as a key enters the process. §10.2 has
 * the server resolve tenant identity from this key before evaluating anything
 * else, so a malformed one is an unrecoverable config error, and failing at
 * construction beats failing after a socket, a token fetch, and a round trip.
 *
 * @throws {SecretKeyInClientError} if `value` is a secret key.
 * @throws {InvalidPublishableKeyError} if `value` is otherwise malformed.
 *   Neither error contains any part of `value`.
 */
export function parsePublishableKey(value: string): PublishableKey {
  // `value` is typed `string`, but this module is a boundary: the key arrives
  // from host config that may be plain JS, JSON, or an env var read as
  // `undefined`. Checking costs one comparison and turns a `TypeError` thrown
  // from `.trim()` — whose message is not ours to control — into our own.
  if (typeof (value as unknown) !== 'string') {
    throw new InvalidPublishableKeyError('expected a string');
  }

  // Ordered so the security-relevant answer wins. A secret key is also not a
  // valid publishable key, and reporting it as a mere format error would bury
  // the one finding that requires the customer to rotate a credential.
  if (looksLikeSecretKey(value)) throw new SecretKeyInClientError();

  if (value === '') throw new InvalidPublishableKeyError('it is empty');

  if (value !== value.trim()) {
    // Not trimmed-and-accepted: silently repairing input hides the config bug
    // that produced it, and the next value it "repairs" may be a real key
    // concatenated with something else.
    throw new InvalidPublishableKeyError('it has leading or trailing whitespace');
  }

  const prefix = value.startsWith(LIVE_PREFIX)
    ? LIVE_PREFIX
    : value.startsWith(TEST_PREFIX)
      ? TEST_PREFIX
      : null;

  if (prefix === null) {
    throw new InvalidPublishableKeyError(`it must start with "${LIVE_PREFIX}" or "${TEST_PREFIX}"`);
  }

  const body = value.slice(prefix.length);
  if (body === '') throw new InvalidPublishableKeyError('it has a prefix but no key body');
  if (!KEY_BODY.test(body)) {
    throw new InvalidPublishableKeyError(
      'its key body contains characters that are not allowed (expected letters, digits, "-" and "_")',
    );
  }

  return value as PublishableKey;
}

/** Non-throwing form of {@link parsePublishableKey}, for callers offering their own diagnostics. */
export function isPublishableKey(value: string): value is PublishableKey {
  try {
    parsePublishableKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which environment a validated key addresses (§10.1).
 *
 * Takes a {@link PublishableKey} rather than a `string` so the answer cannot be
 * asked of unvalidated input — there is no meaningful environment for a value
 * that has not been proven to be a publishable key at all.
 */
export function publishableKeyEnvironment(key: PublishableKey): PublishableKeyEnvironment {
  return key.startsWith(LIVE_PREFIX) ? 'live' : 'test';
}
