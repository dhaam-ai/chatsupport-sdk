import { describe, expect, it } from 'vitest';

import {
  InvalidPublishableKeyError,
  SecretKeyInClientError,
  isPublishableKey,
  parsePublishableKey,
  publishableKeyEnvironment,
} from './keys.js';

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
 * `sk_`/`dhpk_live_`/`dhpk_test_` prefixes are PUBLIC CONSTANTS: they are in the
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
    const key = parsePublishableKey('dhpk_live_abc123');
    expect(key).toBe('dhpk_live_abc123');
  });

  it('accepts a test key', () => {
    expect(parsePublishableKey('dhpk_test_abc123')).toBe('dhpk_test_abc123');
  });

  it('accepts URL-safe base64 bodies with dashes and underscores', () => {
    const key = 'dhpk_live_aZ09-_aZ09';
    expect(parsePublishableKey(key)).toBe(key);
  });

  it('does not impose a length, so long and short bodies both pass', () => {
    expect(() => parsePublishableKey('dhpk_live_a')).not.toThrow();
    expect(() => parsePublishableKey(`dhpk_test_${'x'.repeat(512)}`)).not.toThrow();
  });
});

describe('secret keys are refused where a publishable key belongs (§14)', () => {
  it('throws SecretKeyInClientError for dhsk_live_', () => {
    expect(() => parsePublishableKey('dhsk_live_abc123')).toThrow(SecretKeyInClientError);
  });

  it('throws SecretKeyInClientError for dhsk_test_', () => {
    expect(() => parsePublishableKey('dhsk_test_abc123')).toThrow(SecretKeyInClientError);
  });

  it('throws for any sk_ prefix, not just the two documented environments', () => {
    expect(() => parsePublishableKey('dhsk_staging_abc123')).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey('sk_abc123')).toThrow(SecretKeyInClientError);
  });

  it('is not defeated by casing', () => {
    expect(() => parsePublishableKey('SK_LIVE_abc123')).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey('Sk_Live_abc123')).toThrow(SecretKeyInClientError);
  });

  it('is not defeated by surrounding whitespace', () => {
    expect(() => parsePublishableKey('  dhsk_live_abc123  ')).toThrow(SecretKeyInClientError);
    expect(() => parsePublishableKey('\n\tdhsk_live_abc123')).toThrow(SecretKeyInClientError);
  });

  it('reports the secret key as its own error class, not a generic format error', () => {
    // The distinction is the whole diagnostic: a format error says "fix a
    // character", this says "rotate a credential".
    const caught = rejectionOf('dhsk_live_abc123');
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
    expect(isPublishableKey('dhsk_live_abc123')).toBe(false);
  });
});

describe('malformed keys are rejected', () => {
  const cases: ReadonlyArray<readonly [name: string, value: string]> = [
    ['empty string', ''],
    ['no prefix', 'abc123'],
    ['wrong prefix', 'ak_live_abc123'],
    ['prefix without a body', 'dhpk_live_'],
    ['test prefix without a body', 'dhpk_test_'],
    ['prefix typo', 'pk_prod_abc123'],
    ['leading whitespace', ' dhpk_live_abc123'],
    ['trailing whitespace', 'dhpk_live_abc123 '],
    ['internal whitespace', 'dhpk_live_abc 123'],
    ['a JWT pasted into the key field', 'dhpk_live_aaa.bbb.ccc'],
    ['a raw JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
    ['shell quoting left in', '"dhpk_live_abc123"'],
    ['a URL', 'https://example.test/dhpk_live_abc123'],
    ['newline injection', 'dhpk_live_abc\n123'],
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
    expect(() => parsePublishableKey('abc123')).toThrow(/must start with "dhpk_live_" or "dhpk_test_"/);
    expect(() => parsePublishableKey('')).toThrow(/empty/);
    expect(() => parsePublishableKey('dhpk_live_')).toThrow(/no key body/);
    expect(() => parsePublishableKey(' dhpk_live_abc123')).toThrow(/whitespace/);
  });
});

describe('no credential material reaches any thrown error (§14)', () => {
  // Real inputs through the real `parsePublishableKey`, not a mock — the claim
  // under test is about the shipping code path.
  const fixtures: ReadonlyArray<readonly [name: string, value: string]> = [
    ['a live secret key', `dhsk_live_${SECRET_BODY}`],
    ['a test secret key', `dhsk_test_${SECRET_BODY}`],
    ['an upper-cased secret key', `SK_LIVE_${SECRET_BODY}`],
    ['a padded secret key', `  dhsk_live_${SECRET_BODY}  `],
    ['a user JWT in the key field', `eyJhbGciOiJIUzI1NiJ9.${SECRET_BODY}.c2ln`],
    ['a publishable key with trailing junk', `dhpk_live_${SECRET_BODY}.leaked`],
    ['a password pasted into the key field', `hunter2${SECRET_BODY}`],
    ['a padded publishable key', ` dhpk_live_${SECRET_BODY}`],
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
    expect(isPublishableKey(`dhsk_live_${SECRET_BODY}`)).toBe(false);
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
      'dhsk_live_AAAAAAAA',
      `dhsk_test_${'B'.repeat(24)}`,
      'SK_LIVE_cccc',
      '   dhsk_staging_dddddddddddd   ',
      'sk_',
    ];

    const messages = new Set(inputs.map((input) => rejectionOf(input).message));
    expect(messages.size).toBe(1);
  });

  it('rejections in the same category produce an identical message', () => {
    const byCategory: ReadonlyArray<readonly string[]> = [
      // Wrong prefix.
      ['abc123', 'ak_live_QQQQ', 'https://example.test/x', 'eyJhbGciOiJIUzI1NiJ9.a.b'],
      // Prefix present, body empty.
      ['dhpk_live_', 'dhpk_test_'],
      // Disallowed characters in the body.
      ['dhpk_live_aaa.bbb', 'dhpk_live_a b', 'dhpk_test_x\ny'],
      // Padding.
      [' dhpk_live_aaaa', 'dhpk_test_bbbbbbbb  ', '\tdhpk_live_cc'],
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
      'dhpk_live_',
      'dhpk_live_a.b',
      ' dhpk_live_a',
      'dhsk_live_a',
      'ak_x',
      '"dhpk_live_a"',
    ];

    const messages = new Set(inputs.map((input) => rejectionOf(input).message));
    // Five categories exist: secret key, empty, whitespace, wrong prefix,
    // empty body, bad charset. A message that varied with its input would blow
    // this bound apart immediately.
    expect(messages.size).toBeLessThanOrEqual(6);
  });
});

describe('publishableKeyEnvironment', () => {
  it('distinguishes live from test (§10.1)', () => {
    expect(publishableKeyEnvironment(parsePublishableKey('dhpk_live_abc123'))).toBe('live');
    expect(publishableKeyEnvironment(parsePublishableKey('dhpk_test_abc123'))).toBe('test');
  });
});

describe('the branded type', () => {
  it('is assignable to string, so it flows into the connection seam unchanged', () => {
    const key = parsePublishableKey('dhpk_live_abc123');
    const asPlainString: string = key;
    expect(asPlainString).toBe('dhpk_live_abc123');
  });

  it('is produced only by parsing — a raw string is not assignable', () => {
    // @ts-expect-error a raw string must not satisfy PublishableKey; this is
    // the structural half of §14's guarantee, and the compile error IS the test.
    const bad: import('./keys.js').PublishableKey = 'dhsk_live_abc123';
    expect(typeof bad).toBe('string');
  });
});
