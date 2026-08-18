// Secret-key hygiene — the mirror image of core's `auth/keys.ts`.
//
// Core validates a PUBLISHABLE key and refuses a secret one, because it runs
// in a browser. This module validates a SECRET key and refuses a publishable
// one, because it runs on the customer's server. Same technique — a branded
// type only a validator can produce — pointed the other way, so that a
// function demanding a `SecretKey` cannot be handed a raw string that has not
// been through the check.
//
// The two modules are deliberately NOT shared. Extracting the common half into
// something both import would create a package edge from this file to a
// browser-targeted package, and that edge is exactly how a secret key ends up
// in a client bundle (§14). A few duplicated lines are the cheaper mistake.
//
// ── Why no input value ever appears in an error message ──────────────────
//
// This module runs on unvalidated input, and on this side of the wire the
// input is usually the real secret key. Every error here is thrown inside the
// customer's process, where it will be caught by a framework and posted to an
// error tracker. So: no substring, no prefix, no length, no digest, no
// character count. §14 rules out prefixes and lengths for tokens — a prefix
// correlates a credential across systems, a length fingerprints it — and the
// reasoning binds with more force here than anywhere else in the SDK.

import { InvalidSecretKeyError, PublishableKeyAsSecretError } from './errors.js';

/** Brand carrier. Not exported: only this module can produce a {@link SecretKey}. */
declare const secretKeyBrand: unique symbol;

/**
 * A string validated as a secret key (§10.1).
 *
 * Assignable to `string`, so it flows into `createHmac` and an `Authorization`
 * header with no unwrapping. The reverse does not hold, which is the point:
 * {@link verifyWebhookSignature} and the token minter take a `SecretKey`, so
 * neither can be called with a publishable key, an access token, or an empty
 * string read out of a missing environment variable.
 */
export type SecretKey = string & { readonly [secretKeyBrand]: true };

/** Which environment a secret key addresses (§10.1). */
export type SecretKeyEnvironment = 'live' | 'test';

// Namespaced with `dh` deliberately. A bare `pk_`/`sk_` scheme is
// byte-identical to Stripe's, so GitHub's secret scanner attributes our keys
// to Stripe — it blocked a push to this repo on two synthetic test fixtures.
// The operational cost is worse than the annoyance: a customer committing one
// of our keys gets their own push blocked and blames the SDK, and a genuine
// leak of ours is triaged as a Stripe incident and routed to the wrong vendor.
const SECRET_LIVE_PREFIX = 'dhsk_live_';
const SECRET_TEST_PREFIX = 'dhsk_test_';

/** The publishable prefixes, recognised only so they can be refused precisely. */
const PUBLISHABLE_PREFIX = 'dhpk_';

/**
 * Body charset and length, mirroring the SERVER's anchored regex
 * (`src/infrastructure/auth/api-key.ts`, `KEY_PATTERN`).
 *
 * The server is the authority on what it will accept, so matching it here
 * means a key this module admits is a key the server can actually verify — a
 * malformed one fails in the customer's own process with a specific diagnosis
 * instead of at `POST /tokens`, which returns one deliberately uninformative
 * 401 for every authentication failure and so cannot tell them what is wrong.
 *
 * NOTE this is a deliberate divergence from core's `parsePublishableKey`,
 * which constrains the charset but says nothing about length. That asymmetry
 * is intentional, not an oversight: core cannot see the server's regex, and a
 * browser rejecting a key the server would have accepted is a self-inflicted
 * outage in someone else's bundle. Here the floor is the same process
 * boundary the server enforces, so matching it is free.
 *
 * The anchoring matters as much as the charset. `startsWith` would accept a
 * value with a trailing newline — the classic shape of a key read from a file
 * or a shell `$(cat …)` — which would then be sent as an `Authorization`
 * header value and rejected for a reason no one could see.
 */
const SECRET_KEY_PATTERN = /^dhsk_(?:live|test)_[A-Za-z0-9_-]{32,64}$/;

/**
 * True when `value` looks like a publishable key.
 *
 * Case-insensitive and whitespace-tolerant, matching the same predicate in
 * core. A real key is lowercase and untrimmed input is rejected anyway, but
 * this guards the "a publishable key must never be mistaken for a secret one"
 * invariant, and a guard that can be stepped around by a stray space or a
 * capital letter is not a guard.
 */
function looksLikePublishableKey(value: string): boolean {
  return value.trim().toLowerCase().startsWith(PUBLISHABLE_PREFIX);
}

/**
 * Validates `value` as a secret key (§10.1).
 *
 * Call this as early as the key enters the process — at client construction,
 * straight off `process.env`. A malformed secret key is an unrecoverable
 * configuration error, and failing at construction beats failing after a
 * network round trip that returns a generic 401.
 *
 * @throws {PublishableKeyAsSecretError} if `value` is a publishable key.
 * @throws {InvalidSecretKeyError} if `value` is otherwise malformed.
 *   Neither error contains any part of `value`.
 */
export function parseSecretKey(value: string): SecretKey {
  // `value` is typed `string`, but this is a boundary: the key arrives from
  // `process.env`, which is `string | undefined`, and from plain-JS config
  // objects that TypeScript never saw. Checking costs one comparison and
  // turns a `TypeError` thrown from `.trim()` — whose message is not ours to
  // control, and which reads as an SDK bug — into our own diagnosis.
  if (typeof (value as unknown) !== 'string') {
    throw new InvalidSecretKeyError('expected a string');
  }

  // Ordered so the credential-confusion answer wins. A publishable key is
  // also not a well-formed secret key, and reporting it as a mere format
  // error would bury the one finding that should send someone to check
  // whether the secret key went the other way, into their client bundle.
  if (looksLikePublishableKey(value)) throw new PublishableKeyAsSecretError();

  if (value === '') {
    // The overwhelmingly common cause, named explicitly: an unset environment
    // variable that coerced to '' somewhere between the shell and here.
    throw new InvalidSecretKeyError('it is empty (is the environment variable set?)');
  }

  if (value !== value.trim()) {
    // Not trimmed-and-accepted. Silently repairing input hides the config bug
    // that produced it, and the next value it "repairs" may be a real key
    // concatenated with something else.
    throw new InvalidSecretKeyError('it has leading or trailing whitespace');
  }

  if (!SECRET_KEY_PATTERN.test(value)) {
    throw new InvalidSecretKeyError(
      'it must be "dhsk_live_" or "dhsk_test_" followed by 32-64 characters ' +
        'from the set [A-Za-z0-9_-]',
    );
  }

  return value as SecretKey;
}

/** Non-throwing form of {@link parseSecretKey}, for callers offering their own diagnostics. */
export function isSecretKey(value: string): value is SecretKey {
  try {
    parseSecretKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which environment a validated key addresses (§10.1).
 *
 * Takes a {@link SecretKey} rather than a `string` so the question cannot be
 * asked of unvalidated input — there is no meaningful environment for a value
 * that has not been proven to be a secret key at all.
 */
export function secretKeyEnvironment(key: SecretKey): SecretKeyEnvironment {
  return key.startsWith(SECRET_LIVE_PREFIX) ? 'live' : 'test';
}

/**
 * The ONLY representation of a secret key that may appear in a log line.
 *
 * Prefix plus last 4, random component elided — matching the server's
 * `maskApiKey` so an operator correlating "which key is this?" across the SDK
 * and the service sees the same string on both sides.
 *
 * This is provided reluctantly and is used NOWHERE inside this package: no
 * error, no log line, and no serialization here emits even a masked key. It
 * exists because customers WILL want to print which key a process loaded, and
 * the realistic alternative to giving them a correct helper is that they write
 * `key.slice(0, 12)` themselves — which on a `dhsk_test_` key leaks two
 * characters of the random component, and on the day the prefix length
 * changes leaks more.
 *
 * Unparseable input collapses to a fixed placeholder rather than echoing what
 * was presented: echoing it would put an attacker-controlled — and possibly
 * nearly-correct — secret into the logs.
 *
 * The last 4 characters of a 43-character CSPRNG string reconstruct nothing;
 * this is the same trade the server already makes by persisting `last4`.
 */
export function maskSecretKey(value: unknown): string {
  if (typeof value !== 'string' || !isSecretKey(value)) return '<invalid-key>';
  // Second underscore, found by walking rather than by a magic offset. The
  // server carried an `indexOf('_', 3)` tuned for a 3-character `sk_`; with
  // the 5-character `dhsk_` it landed on the FIRST underscore and masked the
  // environment away too. Walking cannot drift when a prefix changes length.
  const firstUnderscore = value.indexOf('_');
  const prefixEnd = value.indexOf('_', firstUnderscore + 1) + 1;
  return `${value.slice(0, prefixEnd)}…${value.slice(-4)}`;
}

export { SECRET_LIVE_PREFIX, SECRET_TEST_PREFIX };
