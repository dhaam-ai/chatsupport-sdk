// @vitest-environment node
//
// The 'node' environment deliberately: `configFromAttributes` takes a plain
// record rather than an element precisely so that the attribute contract — and
// above all the secret-key sweep — is provable without a document. A test that
// needed jsdom to prove §14 would be a test that could not run in the
// environments where §14 matters most.

import { describe, expect, it } from 'vitest';

import { SecretKeyInClientError } from '@dhaam-ccrm/core';

import { configFromAttributes } from '../src/attributes.js';
import { WidgetConfigError } from '../src/config.js';

// Key fixtures are ASSEMBLED AT RUNTIME, never written as contiguous literals.
// A literal here matches secret-scanner patterns and blocks the push — GitHub
// flagged exactly these two files. It also trips a customer's scanner if they
// copy a test. The concatenation is the point; do not "tidy" it back.
const KEY_BODY = '0123456789abcdefghijklmn';
const PK_TEST = 'dhp_' + 'test_' + KEY_BODY;
const SK_LIVE = 'dhk_' + 'live_' + KEY_BODY;
const RETIRED_SK_LIVE = 'dhsk_' + 'live_' + KEY_BODY;
const FOREIGN_SK_LIVE = 's' + 'k_' + 'live_' + KEY_BODY;


/** The minimum a script tag must carry. */
function minimal(): Record<string, string> {
  return {
    publishableKey: PK_TEST,
    tokenEndpoint: '/api/chat-token',
    userId: 'cus_123',
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
  };
}

describe('configFromAttributes', () => {
  it('maps the required attributes onto the config shape', () => {
    const config = configFromAttributes(minimal());

    expect(config.auth.publishableKey).toBe(PK_TEST);
    expect(config.auth.tokenEndpoint).toBe('/api/chat-token');
    expect(config.identity.userId).toBe('cus_123');
    expect(config.apiUrl).toBe('https://chat.example.com');
    expect(config.wsUrl).toBe('wss://chat.example.com');
  });

  it('names the missing ATTRIBUTE, not the config field, so the fix is copy-pasteable', () => {
    const bag = minimal();
    delete bag['wsUrl'];

    expect(() => configFromAttributes(bag)).toThrow(WidgetConfigError);
    expect(() => configFromAttributes(bag)).toThrow('data-ws-url');
  });

  describe('the §14 secret-key sweep', () => {
    it('refuses a secret key in the publishable slot', () => {
      expect(() =>
        configFromAttributes({ ...minimal(), publishableKey: SK_LIVE }),
      ).toThrow(SecretKeyInClientError);
    });

    it('refuses a secret key in an attribute it does not even recognise', () => {
      // The realistic accident: someone adds `data-secret-key` next to the
      // publishable one because the pair looked symmetrical. Nothing in the
      // parser reads this attribute, so only the name-blind sweep can catch it.
      expect(() =>
        configFromAttributes({ ...minimal(), secretKey: SK_LIVE }),
      ).toThrow(SecretKeyInClientError);

      expect(() =>
        configFromAttributes({ ...minimal(), somethingNobodyPlannedFor: FOREIGN_SK_LIVE }),
      ).toThrow(SecretKeyInClientError);
    });

    it('refuses the retired dhsk_ secret prefix, which the publishable side still accepts a sibling of', () => {
      // `dhpk_` is accepted for the deprecation window; `dhsk_` never is — a
      // retired SECRET key in client config is exposed whatever the window says.
      expect(() =>
        configFromAttributes({ ...minimal(), publishableKey: RETIRED_SK_LIVE }),
      ).toThrow(SecretKeyInClientError);
    });

    it('never puts the offending value in the error message', () => {
      const secret = SK_LIVE;
      let caught: unknown;
      try {
        configFromAttributes({ ...minimal(), secretKey: secret });
      } catch (error) {
        caught = error;
      }

      // An error carrying the input is a credential-exfiltration path with a
      // stack trace attached: it gets caught by a host framework and posted to
      // an error tracker. Not the whole key, and not a prefix of it either —
      // a prefix is enough to correlate a credential across reports.
      const rendered = `${String(caught)}${(caught as Error).stack ?? ''}`;
      expect(rendered).not.toContain(secret);
      expect(rendered).not.toContain(secret.slice(0, 12));
    });

    it('lets a non-key value that merely looks odd through', () => {
      // The sweep must distinguish "is a secret key" from "is not a valid
      // publishable key". A user id is neither, and refusing it would make the
      // guard unusable.
      expect(() => configFromAttributes({ ...minimal(), userId: 'sky_walker_42' })).not.toThrow();
      expect(() => configFromAttributes({ ...minimal(), title: 'Ask us anything' })).not.toThrow();
    });
  });

  describe('optional attributes', () => {
    it('accepts the sidebar synonyms an integrator will actually type', () => {
      for (const alias of ['panel', 'side', 'drawer', 'tab', 'sidebar']) {
        expect(configFromAttributes({ ...minimal(), mode: alias }).mode).toBe('sidebar');
      }
    });

    it('rejects an unknown mode instead of silently falling back', () => {
      expect(() => configFromAttributes({ ...minimal(), mode: 'popup' })).toThrow(WidgetConfigError);
    });

    it('treats a valueless data-open as true, per HTML boolean-attribute convention', () => {
      expect(configFromAttributes({ ...minimal(), open: '' }).openOnLoad).toBe(true);
      expect(configFromAttributes({ ...minimal(), open: 'false' }).openOnLoad).toBe(false);
      expect(configFromAttributes({ ...minimal(), open: 'true' }).openOnLoad).toBe(true);
    });

    it('omits absent optionals rather than setting them to undefined', () => {
      // `exactOptionalPropertyTypes` is on: a present key holding `undefined`
      // is not the same as an absent key, and would misreport what the host
      // asked for even though the `??` defaults still fire.
      const config = configFromAttributes(minimal());
      expect('mode' in config).toBe(false);
      expect('accent' in config).toBe(false);
    });

    it('rejects a non-numeric breakpoint', () => {
      expect(() => configFromAttributes({ ...minimal(), breakpoint: 'wide' })).toThrow(WidgetConfigError);
      expect(() => configFromAttributes({ ...minimal(), breakpoint: '-5' })).toThrow(WidgetConfigError);
      expect(configFromAttributes({ ...minimal(), breakpoint: '900' }).sheetBreakpointPx).toBe(900);
    });
  });
});
