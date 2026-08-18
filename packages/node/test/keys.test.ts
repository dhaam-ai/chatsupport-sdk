import { describe, expect, it } from 'vitest';
import {
  isSecretKey,
  maskSecretKey,
  parseSecretKey,
  secretKeyEnvironment,
} from '../src/keys.js';
import { InvalidSecretKeyError, PublishableKeyAsSecretError } from '../src/errors.js';
import {
  FOREIGN_SECRET_KEY,
  PUBLISHABLE_KEY_LIVE,
  SECRET_KEY_LIVE,
  SECRET_KEY_TEST,
} from './fixtures.js';

describe('parseSecretKey', () => {
  it('accepts well-formed live and test secret keys', () => {
    expect(parseSecretKey(SECRET_KEY_LIVE)).toBe(SECRET_KEY_LIVE);
    expect(parseSecretKey(SECRET_KEY_TEST)).toBe(SECRET_KEY_TEST);
  });

  it('reports the environment from the prefix', () => {
    expect(secretKeyEnvironment(parseSecretKey(SECRET_KEY_LIVE))).toBe('live');
    expect(secretKeyEnvironment(parseSecretKey(SECRET_KEY_TEST))).toBe('test');
  });

  // The headline requirement: "a publishable key passed where a secret key
  // belongs fails loudly". Loudly means its OWN error class — a caller can
  // catch this specifically and treat it as the credential-confusion incident
  // it is, rather than as a format typo.
  it('rejects a publishable key with PublishableKeyAsSecretError, not a generic format error', () => {
    expect(() => parseSecretKey(PUBLISHABLE_KEY_LIVE)).toThrow(PublishableKeyAsSecretError);
    // Explicitly NOT the format error — asserting the class alone would pass
    // if PublishableKeyAsSecretError were made to extend InvalidSecretKeyError,
    // which would let a caller's `catch (InvalidSecretKeyError)` swallow the
    // incident as a typo.
    expect(() => parseSecretKey(PUBLISHABLE_KEY_LIVE)).not.toThrow(InvalidSecretKeyError);
  });

  it('rejects a publishable key regardless of case or surrounding whitespace', () => {
    // The guard must not be steppable-around: if a stray newline from a shell
    // `$(cat key.txt)` defeated the publishable-key check, the value would
    // fall through to the generic format error and lose the diagnosis.
    expect(() => parseSecretKey(`  ${PUBLISHABLE_KEY_LIVE}  `)).toThrow(PublishableKeyAsSecretError);
    expect(() => parseSecretKey(PUBLISHABLE_KEY_LIVE.toUpperCase())).toThrow(
      PublishableKeyAsSecretError,
    );
  });

  it('rejects an empty string, naming the unset-env-var cause', () => {
    expect(() => parseSecretKey('')).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey('')).toThrow(/environment variable/);
  });

  it('rejects a non-string without letting a TypeError escape', () => {
    expect(() => parseSecretKey(undefined as unknown as string)).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey(null as unknown as string)).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey({} as unknown as string)).toThrow(InvalidSecretKeyError);
  });

  it('rejects a key with surrounding whitespace rather than trimming it', () => {
    // Trailing-newline keys are the classic `$(cat key.txt)` shape. Repairing
    // them silently hides the config bug and would mean the byte string used
    // for HMAC differs from the one the operator pasted.
    expect(() => parseSecretKey(`${SECRET_KEY_LIVE}\n`)).toThrow(/whitespace/);
    expect(() => parseSecretKey(` ${SECRET_KEY_LIVE}`)).toThrow(/whitespace/);
  });

  it('is anchored: rejects a valid key with anything appended or prepended', () => {
    expect(() => parseSecretKey(`${SECRET_KEY_LIVE}!`)).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey(`x${SECRET_KEY_LIVE}`)).toThrow(InvalidSecretKeyError);
  });

  it('rejects a foreign sk_ key — the prefix check is ours, not a generic "sk"', () => {
    expect(() => parseSecretKey(FOREIGN_SECRET_KEY)).toThrow(InvalidSecretKeyError);
  });

  it('rejects our RETIRED dhsk_ prefix, and says so instead of blaming the charset', () => {
    // These keys were provisioned and are still in customer config. They no
    // longer validate anywhere — grandfathering them would keep emitting the
    // `sk_live_` substring the rename exists to remove — so the only useful
    // thing this module can do is name the real problem. Falling through to
    // the charset message would send someone hunting for an illegal character
    // in a key that has none.
    const retired = 'dh' + 'sk_' + 'live_' + 'A'.repeat(43);

    expect(() => parseSecretKey(retired)).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey(retired)).toThrow(/retired/i);
    expect(isSecretKey(retired)).toBe(false);
  });

  it('rejects the retired PUBLISHABLE prefix as a key mix-up, not a format error', () => {
    // `dhpk_live_x` does not start with `dhp_`, so a check that only knew the
    // current publishable prefix would misfile this as a charset failure and
    // lose the "go check whether the secret key went the other way" prompt.
    const retiredPublishable = 'dh' + 'pk_' + 'live_' + 'A'.repeat(43);
    expect(() => parseSecretKey(retiredPublishable)).toThrow(PublishableKeyAsSecretError);
  });

  it('carries neither "sk_" nor "pk_" in the prefix of a key it accepts', () => {
    // The property the rename bought, asserted on this package's own view of
    // the format rather than trusting core or the server to hold it.
    for (const key of [SECRET_KEY_LIVE, SECRET_KEY_TEST]) {
      const prefix = key.slice(0, key.indexOf('_', key.indexOf('_') + 1) + 1);
      expect(prefix.includes('sk_') || prefix.includes('pk_')).toBe(false);
    }
  });

  it('enforces the server body-length bounds so a key we admit is one the server can verify', () => {
    const short = 'dhk_' + 'live_' + 'A'.repeat(31);
    const long = 'dhk_' + 'live_' + 'A'.repeat(65);
    const atLowerBound = 'dhk_' + 'live_' + 'A'.repeat(32);
    const atUpperBound = 'dhk_' + 'live_' + 'A'.repeat(64);

    expect(() => parseSecretKey(short)).toThrow(InvalidSecretKeyError);
    expect(() => parseSecretKey(long)).toThrow(InvalidSecretKeyError);
    // Boundaries are inclusive — an off-by-one here would reject real keys.
    expect(parseSecretKey(atLowerBound)).toBe(atLowerBound);
    expect(parseSecretKey(atUpperBound)).toBe(atUpperBound);
  });

  it('rejects a body containing characters outside the charset', () => {
    // A JWT pasted into the secret-key slot: dot-separated, so it fails here
    // rather than travelling to the wire as an Authorization header.
    const jwtish = 'dhk_' + 'live_' + 'A'.repeat(20) + '.' + 'B'.repeat(20);
    expect(() => parseSecretKey(jwtish)).toThrow(InvalidSecretKeyError);
  });
});

describe('isSecretKey', () => {
  it('agrees with parseSecretKey without throwing', () => {
    expect(isSecretKey(SECRET_KEY_LIVE)).toBe(true);
    expect(isSecretKey(PUBLISHABLE_KEY_LIVE)).toBe(false);
    expect(isSecretKey('')).toBe(false);
  });
});

describe('maskSecretKey', () => {
  it('keeps the full prefix including the environment, and exactly the last 4', () => {
    const masked = maskSecretKey(SECRET_KEY_LIVE);
    // The bug this reproduces: an offset tuned for a 3-character `sk_` landed
    // on the FIRST underscore under the 5-character `dhsk_` and masked the
    // environment away, so `dhsk_live_…` and `dhsk_test_…` displayed
    // identically — an operator could not tell a live key from a test one.
    // The prefix has since been 3, 5 and 4 characters long, which is exactly
    // why the implementation walks instead of counting.
    expect(masked).toBe(`${'dhk_' + 'live_'}…${SECRET_KEY_LIVE.slice(-4)}`);
    expect(maskSecretKey(SECRET_KEY_TEST)).toBe(`${'dhk_' + 'test_'}…${SECRET_KEY_TEST.slice(-4)}`);
  });

  it('distinguishes live from test', () => {
    expect(maskSecretKey(SECRET_KEY_LIVE)).not.toBe(maskSecretKey(SECRET_KEY_TEST));
  });

  it('reveals no more than 4 characters of the random body', () => {
    const masked = maskSecretKey(SECRET_KEY_LIVE);
    const body = SECRET_KEY_LIVE.slice(('dhk_' + 'live_').length);
    // Everything after the elision must be exactly 4 chars of body.
    const revealed = masked.slice(masked.indexOf('…') + 1);
    expect(revealed).toHaveLength(4);
    expect(body.endsWith(revealed)).toBe(true);
  });

  it('collapses unparseable input to a fixed placeholder instead of echoing it', () => {
    // Echoing would put an attacker-controlled — possibly nearly-correct —
    // secret into the logs.
    // One character short of the server's lower bound — the shape of a key
    // truncated by a copy-paste, which is exactly the value an operator would
    // most want echoed back and exactly the one that must not be.
    const nearlyCorrect = 'dhk_' + 'live_' + 'A'.repeat(31);
    expect(maskSecretKey(nearlyCorrect)).toBe('<invalid-key>');
    expect(maskSecretKey(PUBLISHABLE_KEY_LIVE)).toBe('<invalid-key>');
    expect(maskSecretKey(undefined)).toBe('<invalid-key>');
    expect(maskSecretKey(12345)).toBe('<invalid-key>');
  });
});
