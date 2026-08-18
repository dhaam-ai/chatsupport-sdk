import { describe, expect, it } from 'vitest';

import { MissingTokenError, resolveToken } from '../connection/index.js';
import {
  InvalidTokenResponseError,
  createTokenProvider,
  toAuthToken,
  type AccessTokenResponse,
} from './token-source.js';

/** A distinctive, high-entropy token body — see the §14 suite at the bottom. */
const SECRET = 'QZXJ7WVMPRKD4NTB';

describe('the gap this module closes', () => {
  it("resolveToken rejects §10.3's response shape, so a host cannot pipe it straight through", () => {
    // Pins the premise against the real T8 code path. If a future change makes
    // `resolveToken` understand `accessToken` directly, this fails and this
    // module should shrink accordingly.
    const response = { accessToken: 'abc', expiresIn: 3600 };

    return expect(resolveToken(() => response as never)).rejects.toThrow(MissingTokenError);
  });

  it('accepts that same response once adapted', async () => {
    const provider = createTokenProvider(() => ({ accessToken: 'abc', expiresIn: 3600 }));

    await expect(resolveToken(provider)).resolves.toEqual({
      token: 'abc',
      expiresInMs: 3_600_000,
    });
  });
});

describe('toAuthToken — token field', () => {
  it('accepts §10.3 accessToken', () => {
    expect(toAuthToken({ accessToken: 'abc' })).toEqual({ token: 'abc' });
  });

  it('accepts RFC 6749 access_token', () => {
    expect(toAuthToken({ access_token: 'abc' })).toEqual({ token: 'abc' });
  });

  it('accepts the core-native token field unchanged', () => {
    expect(toAuthToken({ token: 'abc', expiresInMs: 5000 })).toEqual({
      token: 'abc',
      expiresInMs: 5000,
    });
  });

  it('passes a bare string through, so §6.1 getToken() needs no adapter', () => {
    expect(toAuthToken('abc')).toEqual({ token: 'abc' });
  });
});

describe('toAuthToken — lifetime units', () => {
  it('converts §10.3 expiresIn from seconds to milliseconds', () => {
    // The headline case. A hand-written adapter assigning expiresIn straight
    // to expiresInMs yields 3600 here, and a refresh every 2.88 seconds.
    expect(toAuthToken({ accessToken: 'abc', expiresIn: 3600 })).toEqual({
      token: 'abc',
      expiresInMs: 3_600_000,
    });
  });

  it('converts RFC 6749 expires_in from seconds to milliseconds', () => {
    expect(toAuthToken({ access_token: 'abc', expires_in: 900 })).toEqual({
      token: 'abc',
      expiresInMs: 900_000,
    });
  });

  it('treats expiresInMs as already-milliseconds', () => {
    expect(toAuthToken({ token: 'abc', expiresInMs: 3600 })).toEqual({
      token: 'abc',
      expiresInMs: 3600,
    });
  });

  it('resolves the token and the lifetime independently, so mixed shapes work', () => {
    expect(toAuthToken({ accessToken: 'abc', expires_in: 60 } as never)).toEqual({
      token: 'abc',
      expiresInMs: 60_000,
    });
  });

  it('accepts a numeric string, which some backends serialize', () => {
    expect(toAuthToken({ accessToken: 'abc', expiresIn: '3600' })).toEqual({
      token: 'abc',
      expiresInMs: 3_600_000,
    });
  });

  it('handles fractional seconds', () => {
    expect(toAuthToken({ accessToken: 'abc', expiresIn: 1.5 })).toEqual({
      token: 'abc',
      expiresInMs: 1500,
    });
  });
});

describe('toAuthToken — unusable lifetimes degrade to reactive refresh (§10.4)', () => {
  const unusable: ReadonlyArray<readonly [name: string, value: unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -3600],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a non-numeric string', 'soon'],
    ['an object', {}],
    ['a boolean', true],
  ];

  for (const [name, value] of unusable) {
    it(`omits expiresInMs when the lifetime is ${name}`, () => {
      const result = toAuthToken({ accessToken: 'abc', expiresIn: value } as never);

      expect(result).toEqual({ token: 'abc' });
      // Must be ABSENT, not present-and-undefined: `exactOptionalPropertyTypes`
      // distinguishes them, and so does the controller, which reads
      // `token.expiresInMs ?? null` to decide whether to arm a timer.
      expect('expiresInMs' in result).toBe(false);
    });
  }

  it('does not throw over a malformed lifetime, since the token is still usable', () => {
    expect(() => toAuthToken({ accessToken: 'abc', expiresIn: 'nonsense' })).not.toThrow();
  });
});

describe('toAuthToken — absurd lifetimes cannot become an instant timer', () => {
  // A delay above 2^31-1 wraps in setTimeout and fires immediately, turning
  // "refresh in 100 years" into a refresh loop against the customer's own
  // token endpoint.
  const MAX = 2_147_483_647;

  it('clamps a lifetime beyond the 32-bit timer range', () => {
    const result = toAuthToken({ accessToken: 'abc', expiresIn: 3.15e9 });
    expect(result.expiresInMs).toBe(MAX);
  });

  it('clamps rather than dropping, so proactive refresh still happens', () => {
    const result = toAuthToken({ accessToken: 'abc', expiresIn: 1e15 });
    expect(result.expiresInMs).toBe(MAX);
    expect(result.expiresInMs).toBeGreaterThan(0);
  });

  it('clamps the millisecond field too', () => {
    expect(toAuthToken({ token: 'abc', expiresInMs: 1e30 }).expiresInMs).toBe(MAX);
  });

  it('leaves a long-but-representable lifetime alone', () => {
    // 24 hours, comfortably inside the range.
    expect(toAuthToken({ accessToken: 'abc', expiresIn: 86_400 }).expiresInMs).toBe(86_400_000);
  });

  it('survives the controller multiplying by its refresh fraction', () => {
    const { expiresInMs } = toAuthToken({ accessToken: 'abc', expiresIn: 1e15 });
    expect((expiresInMs ?? 0) * 0.8).toBeLessThanOrEqual(MAX);
  });
});

describe('toAuthToken — responses with no usable token are rejected', () => {
  const cases: ReadonlyArray<readonly [name: string, value: unknown]> = [
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an empty object', {}],
    ['an error envelope', { error: 'invalid_grant' }],
    ['an empty accessToken', { accessToken: '' }],
    ['an empty access_token', { access_token: '' }],
    ['a non-string token', { accessToken: 12345 }],
    ['a null token', { token: null }],
    ['a nested token', { data: { accessToken: 'abc' } }],
  ];

  for (const [name, value] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => toAuthToken(value as never)).toThrow(InvalidTokenResponseError);
    });
  }

  it('names the accepted field names so the failure is actionable', () => {
    expect(() => toAuthToken({} as never)).toThrow(/"token", "accessToken", or "access_token"/);
  });
});

describe('createTokenProvider', () => {
  it('adapts an async fetch', async () => {
    const provider = createTokenProvider(async () =>
      Promise.resolve({ accessToken: 'abc', expiresIn: 300 }),
    );

    await expect(resolveToken(provider)).resolves.toEqual({ token: 'abc', expiresInMs: 300_000 });
  });

  it('adapts a synchronous fetch', async () => {
    const provider = createTokenProvider(() => 'abc');
    await expect(resolveToken(provider)).resolves.toEqual({ token: 'abc' });
  });

  it('is called again on every invocation, as core re-invokes it per refresh', async () => {
    let issued = 0;
    const provider = createTokenProvider(() => ({
      accessToken: `token-${(issued += 1)}`,
      expiresIn: 60,
    }));

    await expect(resolveToken(provider)).resolves.toMatchObject({ token: 'token-1' });
    await expect(resolveToken(provider)).resolves.toMatchObject({ token: 'token-2' });
    expect(issued).toBe(2);
  });

  it('propagates a rejection untouched, so §10.6 escalation still sees it', async () => {
    const failure = new Error('token endpoint returned 503');
    const provider = createTokenProvider(() => Promise.reject(failure));

    await expect(resolveToken(provider)).rejects.toBe(failure);
  });

  it('propagates a synchronous throw', async () => {
    const failure = new Error('no session cookie');
    const provider = createTokenProvider(() => {
      throw failure;
    });

    await expect(resolveToken(provider)).rejects.toBe(failure);
  });

  it('surfaces a malformed response as an auth failure rather than resolving to nothing', async () => {
    const provider = createTokenProvider(() => ({ error: 'invalid_grant' }) as never);
    await expect(resolveToken(provider)).rejects.toThrow(InvalidTokenResponseError);
  });

  it('satisfies the TokenProvider seam the controller consumes', () => {
    const options: { getToken: import('../connection/index.js').TokenProvider } = {
      getToken: createTokenProvider(
        (): AccessTokenResponse => ({ accessToken: 'abc', expiresIn: 3600 }),
      ),
    };
    expect(typeof options.getToken).toBe('function');
  });
});

describe('no token material reaches any thrown error (§14)', () => {
  // The controller folds `error.message` into `ChatError.message` and emits it
  // as the `error` event, so anything here reaches a host app's logger.
  const responses: ReadonlyArray<readonly [name: string, value: unknown]> = [
    ['a token under an unrecognised field name', { jwt: SECRET }],
    ['a nested token', { data: { accessToken: SECRET } }],
    ['a token of the wrong type', { accessToken: [SECRET] }],
    ['an error envelope carrying one', { error: SECRET }],
    ['a bare non-string', Number(`1${SECRET.replace(/\D/g, '')}`)],
  ];

  for (const [name, value] of responses) {
    it(`leaks nothing when rejecting ${name}`, () => {
      let caught: unknown;
      try {
        toAuthToken(value as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(InvalidTokenResponseError);

      const surfaces = [
        (caught as Error).message,
        (caught as Error).stack ?? '',
        JSON.stringify(caught, Object.getOwnPropertyNames(caught)),
      ].join(' ');

      expect(surfaces).not.toContain(SECRET);
      for (let start = 0; start + 4 <= SECRET.length; start += 1) {
        expect(surfaces).not.toContain(SECRET.slice(start, start + 4));
      }
    });
  }

  it('leaks nothing through the provider path either', async () => {
    const provider = createTokenProvider(() => ({ jwt: SECRET }) as never);

    await expect(provider()).rejects.toSatisfy(
      (error: unknown) => !(error as Error).message.includes(SECRET.slice(0, 6)),
    );
  });

  it('does not echo the response even when it is a plain string that failed', () => {
    // The empty-string case is the only rejected string, and it has nothing to
    // echo — but a future "got: <value>" would be caught here.
    expect(() => toAuthToken('')).toThrow(/empty string/);
  });
});
