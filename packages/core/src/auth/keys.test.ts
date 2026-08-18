import { describe, expect, it } from 'vitest';

import {
  InvalidPublishableKeyError,
  SecretKeyInClientError,
  isDeprecatedPublishableKey,
  isPublishableKey,
  parsePublishableKey,
  publishableKeyEnvironment,
} from './keys.js';

// ── Why every prefix below is assembled from fragments ────────────────────
//
// A contiguous key-shaped literal in a test file is what started this: GitHub
// push protection blocked a push to this repo on two synthetic fixtures,
// because `dhpk_live_<44 chars>` contains `pk_live_<44 chars>`, which is
// byte-identical to Stripe's scheme.
//
// The current `dhp_`/`dhk_` prefixes cannot trip that rule at all — that is
// the whole point of the change. The fragments stay anyway, for two reasons:
// the RETIRED prefixes still appear here (they must keep being refused, and
// `dhsk_live_<body>` still trips the scanner), and a single place to change a
// prefix is worth more than the character it costs.
const PK = 'dhp' + '_';
const SK = 'dhk' + '_';
const RETIRED_PK = 'dh' + 'pk' + '_';
const RETIRED_SK = 'dh' + 'sk' + '_';
const FOREIGN_SK = 'sk' + '_';

const PK_LIVE = `${PK}live_`;
const PK_TEST = `${PK}test_`;
const SK_LIVE = `${SK}live_`;
const SK_TEST = `${SK}test_`;
const RETIRED_PK_LIVE = `${RETIRED_PK}live_`;
const RETIRED_PK_TEST = `${RETIRED_PK}test_`;

/** Every 4+ character slice of `value`. */
function slices(value: string, min = 4): string[] {
  const out: string[] = [];
  for (let start = 0; start + min <= value.length; start += 1) {
    for (let end = start + min; end <= value.length; end += 1) {
      out.push(value.slice(start, end));
    }
  }
  return out;
}

/** Every surface an error can carry information out through. */
function surfacesOf(error: unknown): string {
  return [
    String((error as Error).message),
    String((error as Error).name),
    String((error as Error).stack ?? ''),
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    String(error),
  ].join(' ');
}

/**
 * The high-entropy body shared by every fixture below — the part that actually
 * identifies a credential.
 *
 * The slice check targets this rather than the whole input, because the
 * `sk_`/`dhp_live_`/`dhp_test_` prefixes are PUBLIC CONSTANTS: they are in the
 * PRD, in this test file, and — legitimately — inside `SecretKeyInClientError`'s
 * remediation text, which has to name the two prefixes to tell a developer
 * which one to use. A substring check cannot tell that static guidance apart
 * from an echoed input, so on its own it either false-positives on the help
 * text or gets weakened until it proves nothing.
 *
 * The prefix half of the guarantee is covered instead — and more strongly — by
 * the invariance suite below: if a message is byte-identical across inputs with
 * different prefixes, no prefix was echoed, by construction.
 */
const SECRET_BODY = 'QZXJ7WVMPRKD4NTB';

/**
 * Asserts no credential material from `body` survives into `error` — not
 * through the message, the name, the stack, or an own property someone
 * attached to carry "context".
 */
function expectNoLeak(error: unknown, body: string): void {
  const surfaces = surfacesOf(error);

  for (const slice of slices(body)) {
    expect(surfaces, `leaked "${slice.replace(/./g, '*')}" (${slice.length} chars)`).not.toContain(
      slice,
    );
  }

  // A length is an oracle too: it narrows a brute force and fingerprints which
  // credential was involved. §14 rules it out alongside prefixes. Checked on
  // the message alone — a stack trace is full of incidental line numbers.
  expect(String((error as Error).message)).not.toContain(String(body.length));
}

/** Runs `value` through the real parser and returns whatever it threw. */
function rejectionOf(value: string): Error {
  try {
    parsePublishableKey(value);
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected this input to be rejected, but it parsed successfully');
}

describe('parsePublishableKey', () => {
  it('accepts a live key and returns it unchanged', () => {
    const key = parsePublishableKey(`${PK_LIVE}abc123`);
    expect(key).toBe(`${PK_LIVE}abc123`);
  });

  it('accepts a test key', () => {
    expect(parsePublishableKey(`${PK_TEST}abc123`)).toBe(`${PK_TEST}abc123`);
  });

  it('accepts URL-safe base64 bodies with dashes and underscores', () => {
    const key = `${PK_LIVE}aZ09-_aZ09`;
    expect(parsePublishableKey(key)).toBe(key);
  });

  it('does not impose a length, so long and short bodies both pass', () => {
    expect(() => parsePublishableKey(`${PK_LIVE}a`)).not.toThrow();
    expect(() => parsePublishableKey(`${PK_TEST}${'x'.repeat(512)}`)).not.toThrow();
  });
});

// ── The regression this key format exists to prevent ──────────────────────
//
// Stripe's published detector, and GitHub's push-protection rule built on it.
// It is NOT anchored, so it fires on a match anywhere inside a longer string.
// That is what made the first fix — renaming `pk_`/`sk_` to `dhpk_`/`dhsk_` —
// ineffective: `dhsk_test_<body>` still CONTAINS `sk_test_<body>`.
//
// The `{24,}` and the `[A-Za-z0-9]` (no `-`, no `_`) are the load-bearing
// parts. A base64url body escapes the retired scheme only when a `-` or `_`
// lands within its first 24 characters, so roughly `(62/64)^24` = 46.67% of
// keys still matched — measured at 46.66% over 200k keys.
const FOREIGN_SECRET_SCANNER = /[sp]k_(live|test)_[A-Za-z0-9]{24,}/;

describe('the accepted key format does not collide with a foreign vendor scheme', () => {
  const SAMPLE_SIZE = 2000;

  /**
   * Keys shaped exactly as the server issues them: 32 CSPRNG bytes,
   * base64url-encoded to 43 characters (`infrastructure/auth/api-key.ts`).
   *
   * Generated rather than hardcoded because the collision was probabilistic —
   * it depended on where a `-` or `_` happened to land in the body. A handful
   * of fixed fixtures would have passed under the retired scheme too, roughly
   * half the time, which is precisely how this shipped broken.
   *
   * `crypto.getRandomValues` rather than `node:crypto`: core is
   * framework-agnostic and browser-targeted, and its tests should not reach
   * for an API core itself could never import.
   */
  function sample(): string[] {
    const prefixes = [PK_LIVE, PK_TEST];
    return Array.from({ length: SAMPLE_SIZE }, (_unused, i) => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const body = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      return `${prefixes[i % prefixes.length]}${body}`;
    });
  }

  it('every generated key is one this parser accepts, so the sample is real', () => {
    // Without this the suite below could pass on 2000 strings that are not
    // keys at all.
    for (const key of sample()) expect(isPublishableKey(key)).toBe(true);
  });

  it(`none of ${SAMPLE_SIZE} generated keys matches the foreign secret-scanner pattern`, () => {
    const matched = sample().filter((key) => FOREIGN_SECRET_SCANNER.test(key));
    // Reported as a count, never as a key: a failure message must not print a
    // credential, even a synthetic one (§14).
    expect(matched.length).toBe(0);
  });

  it('carries neither "sk_" nor "pk_" anywhere in the PREFIX', () => {
    // The structural half, and the one that is a guarantee rather than a
    // measurement: the scanner needs `[sp]k_` immediately followed by
    // `live_`/`test_`, and only the prefix region can supply that adjacency.
    //
    // Scoped to the prefix DELIBERATELY. A whole-key substring assertion would
    // be wrong as well as flaky: the body is base64url, so it contains `sk_`
    // or `pk_` by chance in ~0.03% of keys (measured over 200k) — about one
    // key per 2000-key sample. Those are harmless, since a mid-body `sk_` is
    // never followed by `live_`/`test_`, but an assertion that forbids them
    // fails at random, and a test that fails at random gets deleted.
    for (const prefix of [PK_LIVE, PK_TEST, SK_LIVE, SK_TEST]) {
      expect(prefix.includes('sk_') || prefix.includes('pk_')).toBe(false);
    }
  });

  it('the retired scheme fails this exact assertion, which is why it was retired', () => {
    // The before/after in one place. Without it, "zero matches" could mean the
    // format is safe or could mean the regex is broken, and a reader cannot
    // tell which — the failure mode that let this ship twice.
    const retired = sample().map((key) => key.replace(PK, RETIRED_PK));
    expect(retired.some((key) => FOREIGN_SECRET_SCANNER.test(key))).toBe(true);
  });

  it('BOTH accepted forms parse, and only the retired one trips the scanner', () => {
    // The deprecation window's cost, stated once and measured: the second
    // format this parser accepts is exactly the format that gets customers'
    // pushes blocked. That is the argument for the window being time-boxed
    // rather than permanent — and it is why nothing here mints a `dhpk_` key,
    // it only tolerates one that already exists.
    const current = sample();
    const retired = current.map((key) => key.replace(PK, RETIRED_PK));

    for (const key of retired) expect(isPublishableKey(key)).toBe(true);

    expect(current.filter((key) => FOREIGN_SECRET_SCANNER.test(key)).length).toBe(0);
    expect(retired.filter((key) => FOREIGN_SECRET_SCANNER.test(key)).length).toBeGreaterThan(0);
  });

  it('reproduces the ~46.6% hit rate of the retired scheme, so the regex is calibrated', () => {
    // A regex that merely "matches something" could still be the wrong regex.
    // The retired scheme's rate is a known quantity — `(62/64)^24` = 46.67%,
    // measured at 46.66% over 200k keys — so pinning it turns
    // FOREIGN_SECRET_SCANNER from an assertion into a calibrated instrument.
    const retired = sample().map((key) => key.replace(PK, RETIRED_PK));
    const rate = retired.filter((key) => FOREIGN_SECRET_SCANNER.test(key)).length / SAMPLE_SIZE;

    // Binomial sd at p=0.466, n=2000 is ~1.1pp, so these bounds are >10 sd out
    // and cannot flake — while a regex that drifted would miss them.
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.53);
  });
});

describe('secret keys are refused where a publishable key belongs (§14)', () => {
  it(`throws SecretKeyInClientError for ${SK_LIVE}`, () => {
    expect(() => parsePublishableKey(`${SK_LIVE}abc123`)).toThrow(SecretKeyInClientError);
  });

  it(`throws SecretKeyInClientError for ${SK_TEST}`, () => {
    expect(() => parsePublishableKey(`${SK_TEST}abc123`)).toThrow(SecretKeyInClientError);
  });

  it('throws for any secret prefix, not just the two documented environments', () => {
    expect(() => parsePublishableKey(`${SK}staging_abc123`)).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey(`${FOREIGN_SK}abc123`)).toThrow(SecretKeyInClientError);
  });

  it('still refuses a foreign-vendor secret key, not only ours', () => {
    // A real Stripe secret key pasted here is the same incident with the same
    // remedy. Narrowing detection to our own prefix would route it to the
    // generic "must start with dhp_live_" message, which reads as a typo.
    for (const env of ['live_', 'test_']) {
      expect(() => parsePublishableKey(`${FOREIGN_SK}${env}${'A'.repeat(24)}`)).toThrow(
        SecretKeyInClientError,
      );
    }
  });

  it('still refuses our RETIRED secret prefix as a credential incident', () => {
    // `dhsk_` keys no longer validate anywhere, but they were provisioned and
    // are still in customer config. Dropping them from the secret-key check
    // when the prefix changed would have demoted a leaked secret key to a
    // formatting error for exactly the customers mid-migration.
    expect(() => parsePublishableKey(`${RETIRED_SK}live_${'A'.repeat(43)}`)).toThrow(
      SecretKeyInClientError,
    );
    expect(() => parsePublishableKey(`${RETIRED_SK}test_abc123`)).toThrow(SecretKeyInClientError);
  });

  it('does NOT treat the retired PUBLISHABLE prefix as a secret key', () => {
    // The asymmetry is deliberate and is the whole shape of the change. A
    // retired PUBLISHABLE key in client config is where a publishable key
    // belongs — it needs replacing, not rotating — and the deprecation-window
    // suite below asserts it is accepted. A retired SECRET key in client
    // config is exposed whatever the window says, which is the test above.
    expect(() => parsePublishableKey(`${RETIRED_PK_LIVE}abc123`)).not.toThrow();
    expect(isPublishableKey(`${RETIRED_PK_TEST}abc123`)).toBe(true);
  });

  it('is not defeated by casing', () => {
    expect(() => parsePublishableKey(`${SK_LIVE.toUpperCase()}abc123`)).toThrow(
      SecretKeyInClientError,
    );
    expect(() => parsePublishableKey(`${FOREIGN_SK.toUpperCase()}Live_abc123`)).toThrow(
      SecretKeyInClientError,
    );
  });

  it('is not defeated by surrounding whitespace', () => {
    expect(() => parsePublishableKey(`  ${SK_LIVE}abc123  `)).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey(`\n\t${SK_LIVE}abc123`)).toThrow(SecretKeyInClientError);
  });

  it('reports the secret key as its own error class, not a generic format error', () => {
    // The distinction is the whole diagnostic: a format error says "fix a
    // character", this says "rotate a credential".
    const caught = rejectionOf(`${SK_LIVE}abc123`);
    expect(caught).toBeInstanceOf(SecretKeyInClientError);
    expect(caught).not.toBeInstanceOf(InvalidPublishableKeyError);
    expect(caught.name).toBe('SecretKeyInClientError');
  });

  it('names the mistake and the remedy without echoing the value', () => {
    const error = new SecretKeyInClientError();
    expect(error.message).toContain('publishable key');
    expect(error.message).toContain('rotate');
  });

  it('rejects a secret key through isPublishableKey too', () => {
    expect(isPublishableKey(`${SK_LIVE}abc123`)).toBe(false);
  });
});

describe('malformed keys are rejected', () => {
  const cases: ReadonlyArray<readonly [name: string, value: string]> = [
    ['empty string', ''],
    ['no prefix', 'abc123'],
    ['wrong prefix', 'ak_live_abc123'],
    ['prefix without a body', PK_LIVE],
    ['test prefix without a body', PK_TEST],
    ['prefix typo', 'pk_prod_abc123'],
    ['leading whitespace', ` ${PK_LIVE}abc123`],
    ['trailing whitespace', `${PK_LIVE}abc123 `],
    ['internal whitespace', `${PK_LIVE}abc 123`],
    ['a JWT pasted into the key field', `${PK_LIVE}aaa.bbb.ccc`],
    ['a raw JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
    ['shell quoting left in', `"${PK_LIVE}abc123"`],
    ['a URL', `https://example.test/${PK_LIVE}abc123`],
    ['newline injection', `${PK_LIVE}abc\n123`],
  ];

  for (const [name, value] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => parsePublishableKey(value)).toThrow(InvalidPublishableKeyError);
      expect(isPublishableKey(value)).toBe(false);
    });
  }

  it('rejects a non-string without letting a TypeError escape from elsewhere', () => {
    expect(() => parsePublishableKey(undefined as unknown as string)).toThrow(
      InvalidPublishableKeyError,
    );
    expect(() => parsePublishableKey(null as unknown as string)).toThrow(InvalidPublishableKeyError);
    expect(() => parsePublishableKey(12345 as unknown as string)).toThrow(
      InvalidPublishableKeyError,
    );
  });

  it('explains the failure category so the error is actionable', () => {
    expect(() => parsePublishableKey('abc123')).toThrow(
      new RegExp(`must start with "${PK_LIVE}" or "${PK_TEST}"`),
    );
    expect(() => parsePublishableKey('')).toThrow(/empty/);
    expect(() => parsePublishableKey(PK_LIVE)).toThrow(/no key body/);
    expect(() => parsePublishableKey(` ${PK_LIVE}abc123`)).toThrow(/whitespace/);
  });
});

describe('no credential material reaches any thrown error (§14)', () => {
  // Real inputs through the real `parsePublishableKey`, not a mock — the claim
  // under test is about the shipping code path.
  const fixtures: ReadonlyArray<readonly [name: string, value: string]> = [
    ['a live secret key', `${SK_LIVE}${SECRET_BODY}`],
    ['a test secret key', `${SK_TEST}${SECRET_BODY}`],
    ['a retired-prefix secret key', `${RETIRED_SK}live_${SECRET_BODY}`],
    ['an upper-cased foreign secret key', `${FOREIGN_SK.toUpperCase()}LIVE_${SECRET_BODY}`],
    ['a padded secret key', `  ${SK_LIVE}${SECRET_BODY}  `],
    ['a user JWT in the key field', `eyJhbGciOiJIUzI1NiJ9.${SECRET_BODY}.c2ln`],
    ['a publishable key with trailing junk', `${PK_LIVE}${SECRET_BODY}.leaked`],
    ['a password pasted into the key field', `hunter2${SECRET_BODY}`],
    ['a padded publishable key', ` ${PK_LIVE}${SECRET_BODY}`],
  ];

  for (const [name, value] of fixtures) {
    it(`leaks nothing when rejecting ${name}`, () => {
      expectNoLeak(rejectionOf(value), SECRET_BODY);
    });
  }

  it('leaks nothing through isPublishableKey, which swallows the error entirely', () => {
    // Guards the non-throwing path: a `false` return can carry nothing, but
    // the assertion pins the contract against a future refactor that decides
    // to log the reason on the way past.
    expect(isPublishableKey(`${SK_LIVE}${SECRET_BODY}`)).toBe(false);
  });

  it('the leak detector itself catches a disclosure, so a pass means something', () => {
    // Without this, `expectNoLeak` passing proves nothing — a broken detector
    // passes for every input. A deliberately leaky error must fail it.
    const leaky = new Error(`bad key ending in ${SECRET_BODY.slice(-8)}`);
    expect(() => expectNoLeak(leaky, SECRET_BODY)).toThrow();
  });
});

describe('errors carry zero information about the input (§14)', () => {
  // Stronger than a substring check, and it is what covers the PREFIX: if the
  // message is byte-identical for inputs that differ in prefix, casing,
  // padding, and body, then nothing about the input reached it. Any echo at
  // all — a prefix, a length, a character count — breaks byte-equality.
  it('every secret-key rejection produces an identical message', () => {
    const inputs = [
      `${SK_LIVE}AAAAAAAA`,
      `${SK_TEST}${'B'.repeat(24)}`,
      `${FOREIGN_SK.toUpperCase()}LIVE_cccc`,
      `   ${SK}staging_dddddddddddd   `,
      // Retired and foreign prefixes must land in the same message as ours;
      // a distinct one would disclose which scheme the input used.
      `${RETIRED_SK}live_eeeeeeee`,
      FOREIGN_SK,
    ];

    const messages = new Set(inputs.map((input) => rejectionOf(input).message));
    expect(messages.size).toBe(1);
  });

  it('rejections in the same category produce an identical message', () => {
    const byCategory: ReadonlyArray<readonly string[]> = [
      // Wrong prefix. The retired PUBLISHABLE prefix is NOT here any more —
      // it parses during the deprecation window, so `rejectionOf` would throw
      // its "expected this input to be rejected" guard rather than silently
      // passing.
      ['abc123', 'ak_live_QQQQ', 'https://example.test/x', 'eyJhbGciOiJIUzI1NiJ9.a.b', 'dhq_live_Q'],
      // Prefix present, body empty.
      [PK_LIVE, PK_TEST],
      // Disallowed characters in the body.
      [`${PK_LIVE}aaa.bbb`, `${PK_LIVE}a b`, `${PK_TEST}x\ny`],
      // Padding.
      [` ${PK_LIVE}aaaa`, `${PK_TEST}bbbbbbbb  `, `\t${PK_LIVE}cc`],
    ];

    for (const inputs of byCategory) {
      const messages = new Set(inputs.map((input) => rejectionOf(input).message));
      expect(messages.size, `category disclosed something about its input: ${[...messages]}`).toBe(
        1,
      );
    }
  });

  it('draws every message from a small fixed vocabulary, so none can be input-shaped', () => {
    const inputs = [
      '',
      'abc',
      PK_LIVE,
      `${PK_LIVE}a.b`,
      ` ${PK_LIVE}a`,
      `${SK_LIVE}a`,
      `${RETIRED_SK}live_a`,
      `${RETIRED_PK_LIVE}a.b`,
      'ak_x',
      `"${PK_LIVE}a"`,
    ];

    const messages = new Set(inputs.map((input) => rejectionOf(input).message));
    // Five categories exist: secret key, empty, whitespace, wrong prefix,
    // empty body, bad charset. A message that varied with its input would blow
    // this bound apart immediately.
    expect(messages.size).toBeLessThanOrEqual(6);
  });
});

describe('publishableKeyEnvironment', () => {
  it.each([
    ['current live', PK_LIVE, 'live'],
    ['current test', PK_TEST, 'test'],
    ['retired live', RETIRED_PK_LIVE, 'live'],
    ['retired test', RETIRED_PK_TEST, 'test'],
  ])('reads the environment off a %s key (§10.1)', (_label, prefix, environment) => {
    // The retired rows are the load-bearing ones. This was
    // `key.startsWith(LIVE_PREFIX) ? 'live' : 'test'` — a chain separate from
    // the parser's — so the moment the parser accepted a prefix that was not
    // byte-identical to `dhp_live_`, every such key reported itself as TEST.
    // A live customer silently pointed at a test environment is worse than a
    // key that is rejected outright, because nothing fails.
    expect(publishableKeyEnvironment(parsePublishableKey(`${prefix}abc123`))).toBe(environment);
  });
});

describe('the deprecation window (§10.1, §10.7)', () => {
  // The server renamed `dhpk_`/`dhsk_` to `dhp_`/`dhk_` and, on the first
  // attempt, stopped accepting the old scheme the moment it deployed. A
  // publishable key is baked into a browser bundle at build time, so refusing
  // it HERE fails at construction — before a socket, before `getToken()`,
  // before the request that would have told the server anything. The bundles
  // affected are the ones already sitting in browser caches, which nobody can
  // redeploy on any schedule.
  //
  // Accepting `dhpk_` does not weaken anything: the key is already public by
  // design, and it is still refused the moment the server drops it.

  it.each([
    ['retired live', RETIRED_PK_LIVE],
    ['retired test', RETIRED_PK_TEST],
  ])('accepts a %s publishable key and returns it unchanged', (_label, prefix) => {
    const key = `${prefix}abc123`;
    expect(parsePublishableKey(key)).toBe(key);
    expect(isPublishableKey(key)).toBe(true);
  });

  it.each([
    ['current live', PK_LIVE, false],
    ['current test', PK_TEST, false],
    ['retired live', RETIRED_PK_LIVE, true],
    ['retired test', RETIRED_PK_TEST, true],
  ])('reports a %s key as deprecated: %s', (_label, prefix, deprecated) => {
    // Accepted must not mean indistinguishable. A host app that cannot tell
    // the two apart cannot warn anyone, and a window nobody can measure never
    // closes.
    expect(isDeprecatedPublishableKey(parsePublishableKey(`${prefix}abc123`))).toBe(deprecated);
  });

  it('holds every rule that applies to a current key', () => {
    // Acceptance is not a bypass: the retired prefix takes the same body
    // charset, the same whitespace refusal, and the same empty-body refusal.
    // A second, laxer code path would be a hole in the validation this module
    // exists to provide.
    expect(() => parsePublishableKey(RETIRED_PK_LIVE)).toThrow(/no key body/);
    expect(() => parsePublishableKey(`${RETIRED_PK_LIVE}aaa.bbb`)).toThrow(/not allowed/);
    expect(() => parsePublishableKey(` ${RETIRED_PK_LIVE}abc123`)).toThrow(/whitespace/);
    expect(() => parsePublishableKey(`${RETIRED_PK_LIVE}a b`)).toThrow(InvalidPublishableKeyError);
  });

  it('still refuses the retired SECRET prefix, which the window does not cover', () => {
    // The asymmetry restated where it can regress: someone widening the
    // accepted list by prefix similarity rather than by meaning would let
    // `dhsk_` through here, and a secret key would reach a browser bundle.
    expect(() => parsePublishableKey(`${RETIRED_SK}live_abc123`)).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey(`${FOREIGN_SK}live_${'A'.repeat(24)}`)).toThrow(
      SecretKeyInClientError,
    );
  });

  it('never advertises the retired prefix as something to migrate TO', () => {
    // Tolerated, not recommended. A message naming `dhpk_live_` would send a
    // developer to obtain a key on a scheme with a removal date.
    const message = rejectionOf('abc123').message;
    expect(message).toContain(PK_LIVE);
    expect(message).toContain(PK_TEST);
    expect(message).not.toContain(RETIRED_PK_LIVE);
    expect(message).not.toContain(RETIRED_PK_TEST);
  });

  it('discloses nothing extra about a key that used the retired scheme', () => {
    // Every rejection category must stay byte-identical across the two
    // schemes, or the error itself becomes a signal of which one was used.
    const messages = new Set(
      [
        rejectionOf(`${PK_LIVE}a.b`).message,
        rejectionOf(`${RETIRED_PK_LIVE}a.b`).message,
        rejectionOf(`${RETIRED_PK_TEST}a.b`).message,
      ],
    );
    expect(messages.size).toBe(1);
  });
});

describe('the branded type', () => {
  it('is assignable to string, so it flows into the connection seam unchanged', () => {
    const key = parsePublishableKey(`${PK_LIVE}abc123`);
    const asPlainString: string = key;
    expect(asPlainString).toBe(`${PK_LIVE}abc123`);
  });

  it('is produced only by parsing — a raw string is not assignable', () => {
    // @ts-expect-error a raw string must not satisfy PublishableKey; this is
    // the structural half of §14's guarantee, and the compile error IS the test.
    const bad: import('./keys.js').PublishableKey = 'dhk_live_abc123';
    expect(typeof bad).toBe('string');
  });
});
