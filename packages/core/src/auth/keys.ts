// Publishable-key hygiene — PRD §10.1, §10.2, §10.7, §14.
//
// §14 requires that `dhk_live_...` be "structurally impossible to reference
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
// "empty", "must start with dhp_live_ or dhp_test_", "contains characters that
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
 * This is the opposite of the secret key (`dhk_live_...`), which rotates with a
 * change on the customer's own backend and no client release at all, because
 * it never ships client-side — see {@link SecretKeyInClientError}. Customers
 * routinely assume both keys rotate the same way; they do not.
 */
export type PublishableKey = string & { readonly [publishableKeyBrand]: true };

/** Which environment a publishable key addresses (§10.1). */
export type PublishableKeyEnvironment = 'live' | 'test';

// ── Why `dhp_`/`dhk_` and not `pk_`/`sk_`, nor `dhpk_`/`dhsk_` ───────────
//
// A bare `pk_`/`sk_` scheme is byte-identical to Stripe's, so GitHub's secret
// scanner reports our keys as Stripe keys — it blocked a push to this repo on
// two synthetic test fixtures.
//
// The first fix namespaced them to `dhpk_`/`dhsk_`, which addressed the
// symptom and not the cause. Stripe's detector is NOT anchored, and
// `dhsk_test_X` still CONTAINS `sk_test_X`. Measured over 200k generated keys,
// 46.66% of namespaced keys still matched
// `/[sp]k_(live|test)_[A-Za-z0-9]{24,}/`: a base64url body draws from
// `[A-Za-z0-9_-]`, so the match breaks only when a `-` or `_` lands inside the
// first 24 characters — `(62/64)^24` = 46.67% of the time.
//
// `dhp_`/`dhk_` contain neither `pk_` nor `sk_` at any offset, so the
// collision is structural rather than probabilistic. `keys.test.ts` proves it
// empirically over 2000 keys; that test is what stops this regressing a third
// time.
//
// The stakes are operational, not cosmetic: a customer committing one of our
// keys gets their own push blocked and blames the SDK, a genuine leak of ours
// is triaged as a Stripe incident and routed to the wrong vendor, and no
// scanner can attribute a key to us.
//
// ── Why `dhpk_` is still ACCEPTED, though never recommended ──────────────
//
// The rename first shipped recognising `dhp_` and nothing else. A publishable
// key is baked into a browser bundle at build time and ships to every visitor
// (§10.7), so the bundles that would start throwing at construction are
// precisely the ones nobody can redeploy on our schedule — including bundles
// already sitting in a browser cache. Refusing `dhpk_` here does not protect
// anyone: the key is already in the wild, and the only thing the refusal
// changes is whether the widget loads.
//
// So `dhpk_` is accepted for the length of the server-side deprecation window
// and reported as deprecated, while the error text still names only the
// current prefixes — nobody should be told to go and get a `dhpk_` key.
//
// `dhsk_` is NOT here. A retired SECRET key is a credential incident whatever
// the window says; see FOREIGN_SECRET_PREFIXES below.
const LIVE_PREFIX = 'dhp_live_';
const TEST_PREFIX = 'dhp_test_';

const DEPRECATED_LIVE_PREFIX = 'dhpk_live_';
const DEPRECATED_TEST_PREFIX = 'dhpk_test_';

/**
 * Every publishable-key prefix this module accepts, with what it implies.
 *
 * ONE table, read by both `parsePublishableKey` and
 * `publishableKeyEnvironment`. They were two separate `startsWith` chains, and
 * that is exactly the shape that broke on the last rename: the environment
 * check was `key.startsWith(LIVE_PREFIX) ? 'live' : 'test'`, so anything the
 * parser accepted that was not byte-identical to `dhp_live_` silently reported
 * itself as a TEST key. Adding `dhpk_live_` to one chain and not the other
 * would have pointed a live customer at a test environment.
 */
interface AcceptedPrefix {
  readonly prefix: string;
  readonly environment: PublishableKeyEnvironment;
  readonly deprecated: boolean;
}

const ACCEPTED_PREFIXES: readonly AcceptedPrefix[] = [
  { prefix: LIVE_PREFIX, environment: 'live', deprecated: false },
  { prefix: TEST_PREFIX, environment: 'test', deprecated: false },
  { prefix: DEPRECATED_LIVE_PREFIX, environment: 'live', deprecated: true },
  { prefix: DEPRECATED_TEST_PREFIX, environment: 'test', deprecated: true },
];

/** The accepted prefix `value` carries, or `null`. */
function acceptedPrefixOf(value: string): AcceptedPrefix | null {
  return ACCEPTED_PREFIXES.find((entry) => value.startsWith(entry.prefix)) ?? null;
}

/** Our own secret-key prefix. */
const OUR_SECRET_PREFIX = 'dhk_';

/**
 * Secret-key prefixes that are not the current one but must still be refused
 * as SECRET keys rather than as format errors.
 *
 * `sk_` is Stripe's (and several others' by convention). `dhsk_` is our own
 * retired scheme — the server still accepts it during the deprecation window,
 * and keys carrying it are still sitting in customer config.
 *
 * Both belong here for the same reason. Someone pasting either into this slot
 * has put a SECRET KEY in client config; telling them "must start with
 * dhp_live_" would send them hunting for a formatting error instead of
 * rotating an exposed credential.
 *
 * Note the deliberate asymmetry with `dhpk_`, which IS accepted above. A
 * retired PUBLISHABLE key in client config is where it belongs and merely
 * needs replacing; a retired SECRET key in client config is exposed no matter
 * which scheme it uses, and the window the server grants it changes nothing
 * about that. Dropping `dhsk_` from this list would silently downgrade a
 * credential incident to a typo for exactly the population most likely to hit
 * it — the customers mid-migration.
 */
const FOREIGN_SECRET_PREFIXES = ['sk_', 'dhsk_'] as const;

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
      'A secret key was supplied where a publishable key (dhp_live_.../dhp_test_...) ' +
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
  // Checked as well as ours, not instead: narrowing this to our own current
  // prefix would let a real Stripe secret key — or one of our own retired
  // `dhsk_` keys — fall through to the generic "must start with dhp_live_"
  // error, which reads as a typo rather than as the credential incident it is.
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

  const accepted = acceptedPrefixOf(value);

  if (accepted === null) {
    // Names only the CURRENT prefixes. `dhpk_` is tolerated, not recommended,
    // and telling someone to go and obtain one would be advice to adopt a
    // scheme with a removal date. The message is also identical for every
    // unrecognised prefix — a distinct one would disclose which scheme the
    // input used, which §14 rules out.
    throw new InvalidPublishableKeyError(`it must start with "${LIVE_PREFIX}" or "${TEST_PREFIX}"`);
  }

  const body = value.slice(accepted.prefix.length);
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
  // Read from the same table `parsePublishableKey` accepted the key with, so
  // the two cannot disagree about what a prefix means. The `?? 'test'` is
  // unreachable for a branded key — only `parsePublishableKey` mints one, and
  // it only mints one for a prefix in the table — and points at the
  // non-production environment if a future cast ever makes it reachable.
  return acceptedPrefixOf(key)?.environment ?? 'test';
}

/**
 * True when `key` uses the retired `dhpk_` scheme (§10.1).
 *
 * The key still works: the server accepts it for the length of the deprecation
 * window. This exists so a host app can surface "you are on a key format with
 * a removal date" at its own log level, and so the window's population is
 * observable from the client side rather than only from the server's database.
 *
 * Takes a {@link PublishableKey} for the same reason
 * {@link publishableKeyEnvironment} does: the question is meaningless for a
 * value that has not been proven to be a publishable key at all.
 */
export function isDeprecatedPublishableKey(key: PublishableKey): boolean {
  return acceptedPrefixOf(key)?.deprecated ?? false;
}
