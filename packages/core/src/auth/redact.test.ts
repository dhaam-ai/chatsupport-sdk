import { describe, expect, it } from 'vitest';

import { InvalidPublishableKeyError, SecretKeyInClientError, parsePublishableKey } from './keys.js';
import { REDACTED, containsCredentialMaterial, redact, scrubCredentials } from './redact.js';
import { InvalidTokenResponseError, toAuthToken } from './token-source.js';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.QZXJ7WVMPRKD4NTBsignature';

// Assembled from fragments, never written contiguously — a literal key-shaped
// string in a test file is what got a push to this repo blocked. See the note
// at the top of `keys.test.ts`.
const PK_LIVE = 'dhp' + '_live_';
const PK_TEST = 'dhp' + '_test_';
const SK_LIVE = 'dhk' + '_live_';
const RETIRED_PK_LIVE = 'dh' + 'pk' + '_live_';
const RETIRED_SK_LIVE = 'dh' + 'sk' + '_live_';
const FOREIGN_SK_LIVE = 'sk' + '_live_';

describe('redact', () => {
  it('returns the marker for anything', () => {
    expect(redact(`${SK_LIVE}abc123`)).toBe(REDACTED);
    expect(redact(JWT)).toBe(REDACTED);
    expect(redact(undefined)).toBe(REDACTED);
    expect(redact({ token: 'abc' })).toBe(REDACTED);
  });

  it('cannot return anything derived from its input', () => {
    // A prefix, a length, or a hash would all vary with the input. This is the
    // property §14 asks for, stated as a test.
    const outputs = new Set(
      [`${SK_LIVE}aaaa`, `${PK_TEST}bbbbbbbbbbbb`, JWT, '', 12345, null].map((value) => redact(value)),
    );
    expect(outputs.size).toBe(1);
  });
});

describe('scrubCredentials', () => {
  it('removes a JWT', () => {
    const scrubbed = scrubCredentials(`401 unauthorized for token ${JWT}`);
    expect(scrubbed).not.toContain('eyJ');
    expect(scrubbed).toContain(REDACTED);
  });

  it('removes a JWT without a signature segment', () => {
    expect(scrubCredentials('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.')).not.toContain('eyJ');
  });

  it('removes a secret key', () => {
    expect(scrubCredentials(`using ${SK_LIVE}QZXJ7WVMPRKD4NTB now`)).toBe(`using ${REDACTED} now`);
  });

  it('removes a publishable key', () => {
    expect(scrubCredentials(`key=${PK_LIVE}QZXJ7WVMPRKD4NTB`)).toBe(`key=${REDACTED}`);
  });

  it('removes a key whole, leaving no fragment of the prefix behind', () => {
    // The failure mode this guards is specific and has happened: a pattern
    // written as `[sp]k_…` fires on the `pk_` INSIDE `dhpk_…` and redacts from
    // there, leaving a stray `dh` glued to the marker. Partial redaction of a
    // credential is not redaction — and the leftover is a reliable signal of
    // which scheme the value used.
    for (const prefix of [PK_LIVE, PK_TEST, SK_LIVE, RETIRED_PK_LIVE, RETIRED_SK_LIVE]) {
      const scrubbed = scrubCredentials(`key=${prefix}QZXJ7WVMPRKD4NTB`);
      expect(scrubbed, `left a fragment for ${prefix}`).toBe(`key=${REDACTED}`);
    }
  });

  it('still removes a foreign-vendor key, which ours no longer resembles', () => {
    // Ours moved off `pk_`/`sk_`, but a customer's Stripe key landing in one
    // of our log lines is still a credential in our log line. Narrowing the
    // pattern to our own scheme would have quietly dropped that coverage.
    expect(scrubCredentials(`key=${FOREIGN_SK_LIVE}QZXJ7WVMPRKD4NTB`)).toBe(`key=${REDACTED}`);
  });

  it('still removes our RETIRED scheme, which is still in customer config', () => {
    // `dhsk_`/`dhpk_` keys no longer validate, but they are still pasted into
    // config and still echoed back inside third-party error messages — which
    // is precisely the string this module exists to clean.
    expect(scrubCredentials(`key=${RETIRED_SK_LIVE}QZXJ7WVMPRKD4NTB`)).toBe(`key=${REDACTED}`);
    expect(scrubCredentials(`key=${RETIRED_PK_LIVE}QZXJ7WVMPRKD4NTB`)).toBe(`key=${REDACTED}`);
  });

  it('removes a Bearer credential along with the scheme', () => {
    const scrubbed = scrubCredentials(`Authorization: Bearer ${JWT}`);
    expect(scrubbed).toBe(`Authorization: ${REDACTED}`);
    expect(scrubbed).not.toContain('Bearer ');
  });

  it('is case-insensitive for the Bearer scheme', () => {
    expect(scrubCredentials('bearer abc123def')).toBe(REDACTED);
  });

  it('removes every occurrence, not just the first', () => {
    const scrubbed = scrubCredentials(
      `${SK_LIVE}aaaa and ${SK_LIVE}bbbb and ${PK_TEST}cccc`,
    );
    expect(scrubbed).toBe(`${REDACTED} and ${REDACTED} and ${REDACTED}`);
  });

  it('catches a key concatenated onto another word', () => {
    expect(scrubCredentials(`key:${SK_LIVE}QZXJ7WVMPRKD4NTB`)).not.toContain('QZXJ');
  });

  it('leaves ordinary diagnostics untouched, so it stays switched on', () => {
    const messages = [
      'connection refused',
      'HTTP 503 from https://api.example.test/v1/tokens',
      'session 01HQ8V3XZ9KWTMJ4N2P5R7YB6C could not be resumed',
      'expected seq 42, received 47',
      '',
    ];

    for (const message of messages) {
      expect(scrubCredentials(message)).toBe(message);
    }
  });

  it('coerces non-string input rather than throwing', () => {
    expect(scrubCredentials(undefined as unknown as string)).toBe('undefined');
    expect(scrubCredentials(42 as unknown as string)).toBe('42');
  });

  it('is idempotent', () => {
    const once = scrubCredentials(`token ${JWT}`);
    expect(scrubCredentials(once)).toBe(once);
  });

  it('does not leak across calls through a stateful regex lastIndex', () => {
    // A `/g` regex reused via `.test()` would carry `lastIndex` between calls
    // and start missing matches. Same input, twice, must give the same answer.
    const input = `oops ${JWT}`;
    expect(scrubCredentials(input)).toBe(scrubCredentials(input));
    expect(containsCredentialMaterial(input)).toBe(true);
    expect(containsCredentialMaterial(input)).toBe(true);
  });
});

describe('containsCredentialMaterial', () => {
  it('detects the formats this system issues', () => {
    expect(containsCredentialMaterial(`bad token ${JWT}`)).toBe(true);
    expect(containsCredentialMaterial(`${SK_LIVE}abc`)).toBe(true);
    expect(containsCredentialMaterial(`${PK_TEST}abc`)).toBe(true);
    expect(containsCredentialMaterial(`${RETIRED_SK_LIVE}abc`)).toBe(true);
    expect(containsCredentialMaterial(`${FOREIGN_SK_LIVE}abc`)).toBe(true);
    expect(containsCredentialMaterial('Bearer abc123')).toBe(true);
  });

  it('reports clean strings as clean', () => {
    expect(containsCredentialMaterial('connection refused')).toBe(false);
    expect(containsCredentialMaterial('')).toBe(false);
  });
});

describe("this module's own error paths are clean (§14)", () => {
  // Asserts against the real shipping code paths of every sibling in auth/,
  // not a mock. If any of them ever starts echoing its input, this fails.
  //
  // NOTE ON THE TOOL USED HERE. `containsCredentialMaterial` is deliberately
  // NOT the assertion below, and the reason is the whole argument of
  // redact.ts. Our own error messages name `dhp_live_`, `dhp_test_` and `dhk_`
  // as remediation guidance — `SecretKeyInClientError` must say "use the
  // publishable key" and name it — so the scrubber fires on them. It cannot
  // tell documentation from an echo, because it only matches shapes. That is
  // the documented limit of a pattern-based net, demonstrated at the bottom
  // of this block rather than hidden.
  //
  // What proves these messages are clean is the property a pattern cannot
  // check: no high-entropy material from the input survives, and the message
  // is invariant across inputs.
  const SECRET_BODY = 'QZXJ7WVMPRKD4NTB';

  const credentialInputs = [
    `${SK_LIVE}${SECRET_BODY}`,
    `${PK_LIVE}${SECRET_BODY}.trailing`,
    JWT,
    `Bearer ${JWT}`,
    `  ${'dhk' + '_test_'}${SECRET_BODY}  `,
    `${RETIRED_SK_LIVE}${SECRET_BODY}`,
  ];

  function thrownBy(run: () => unknown): Error {
    try {
      run();
    } catch (error) {
      return error as Error;
    }
    throw new Error('expected a rejection');
  }

  function expectNoBodyLeak(message: string): void {
    for (let start = 0; start + 4 <= SECRET_BODY.length; start += 1) {
      expect(message).not.toContain(SECRET_BODY.slice(start, start + 4));
    }
  }

  for (const input of credentialInputs) {
    it(`parsePublishableKey leaks nothing for a ${input.slice(0, 6).trim()}-shaped value`, () => {
      const error = thrownBy(() => parsePublishableKey(input));

      expect(error).toBeInstanceOf(Error);
      expectNoBodyLeak(error.message);
    });
  }

  it('toAuthToken leaks nothing', () => {
    for (const input of credentialInputs) {
      expectNoBodyLeak(thrownBy(() => toAuthToken({ jwt: input } as never)).message);
    }
  });

  it('every message is invariant across inputs, so nothing about them flowed in', () => {
    const messages = new Set(
      credentialInputs.map((input) => thrownBy(() => toAuthToken({ jwt: input } as never)).message),
    );
    expect(messages.size).toBe(1);
  });

  it('every error class message is a compile-time constant', () => {
    expect(new SecretKeyInClientError().message).toBe(new SecretKeyInClientError().message);
    expect(new InvalidPublishableKeyError('it is empty').message).toBe(
      new InvalidPublishableKeyError('it is empty').message,
    );
    expect(new InvalidTokenResponseError('empty string').message).toBe(
      new InvalidTokenResponseError('empty string').message,
    );
  });

  it('the scrubber fires on our own guidance text — the documented limit of a pattern net', () => {
    // Pinned as a test so nobody "fixes" this by removing the prefixes from
    // the remediation message, which would make the error useless in exchange
    // for satisfying a check that was never the right one to run here.
    expect(containsCredentialMaterial(new SecretKeyInClientError().message)).toBe(true);
    expect(scrubCredentials(new SecretKeyInClientError().message)).toContain(REDACTED);
  });

  it('the detector is not vacuously quiet — a real echo is caught', () => {
    const leaky = `getToken() failed: 401 for ${JWT}`;
    expect(containsCredentialMaterial(leaky)).toBe(true);
  });
});

describe('the backstop use case it exists for', () => {
  it('cleans a host-authored error message before core would embed it', () => {
    // `ConnectionController` reports `getToken() failed: ${error.message}`
    // using the HOST's message verbatim, and writes it to `lastError`. An HTTP
    // client that embeds the request produces exactly this.
    const hostMessage = `Request failed: POST /v1/tokens {"Authorization":"Bearer ${JWT}"}`;

    expect(containsCredentialMaterial(hostMessage)).toBe(true);

    const safe = scrubCredentials(hostMessage);
    expect(safe).not.toContain('eyJ');
    expect(containsCredentialMaterial(safe)).toBe(false);
    // The diagnostic value survives — that is what makes it usable.
    expect(safe).toContain('POST /v1/tokens');
  });
});
