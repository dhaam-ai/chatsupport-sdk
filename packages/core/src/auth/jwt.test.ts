import { describe, expect, it } from 'vitest';

import { decodeJwtExpiryMs, decodeJwtSubject } from './jwt.js';

function base64UrlEncode(json: unknown): string {
  const base64 = btoa(JSON.stringify(json));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode({ alg: 'none', typ: 'JWT' });
  const body = base64UrlEncode(payload);
  return `${header}.${body}.fakesignature`;
}

describe('decodeJwtExpiryMs', () => {
  it('reads exp (seconds) and converts to epoch-milliseconds', () => {
    const token = makeJwt({ exp: 1_700_000_000, sub: 'user-1' });

    expect(decodeJwtExpiryMs(token)).toBe(1_700_000_000_000);
  });

  it('handles a base64url payload that needs padding restored', () => {
    // Deliberately picks payloads whose base64 length isn't a multiple of 4
    // once padding is stripped, exercising the padding-restoration path.
    const token = makeJwt({ exp: 1, a: 'x' });

    expect(decodeJwtExpiryMs(token)).toBe(1000);
  });

  it('returns undefined for a token with no exp claim', () => {
    const token = makeJwt({ sub: 'user-1' });

    expect(decodeJwtExpiryMs(token)).toBeUndefined();
  });

  it('returns undefined for a non-numeric exp claim', () => {
    const token = makeJwt({ exp: 'soon' });

    expect(decodeJwtExpiryMs(token)).toBeUndefined();
  });

  it('returns undefined for a string with fewer than two dot-separated segments', () => {
    expect(decodeJwtExpiryMs('not-a-jwt')).toBeUndefined();
    expect(decodeJwtExpiryMs('')).toBeUndefined();
  });

  it('returns undefined for a payload segment that is not valid base64', () => {
    expect(decodeJwtExpiryMs('header.###notbase64###.sig')).toBeUndefined();
  });

  it('returns undefined for a payload segment that decodes to non-JSON', () => {
    const notJson = btoa('this is not json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeJwtExpiryMs(`header.${notJson}.sig`)).toBeUndefined();
  });

  it('returns undefined for a payload that decodes to JSON but not an object', () => {
    const arrayPayload = base64UrlEncode([1, 2, 3]);
    expect(decodeJwtExpiryMs(`header.${arrayPayload}.sig`)).toBeUndefined();
  });

  it('never throws, regardless of input', () => {
    expect(() => decodeJwtExpiryMs('....')).not.toThrow();
    expect(() => decodeJwtExpiryMs('a.b')).not.toThrow();
  });
});

describe('decodeJwtSubject', () => {
  it('reads the sub claim', () => {
    const token = makeJwt({ sub: 'user-42' });

    expect(decodeJwtSubject(token)).toBe('user-42');
  });

  it('returns undefined when sub is absent', () => {
    expect(decodeJwtSubject(makeJwt({ exp: 1 }))).toBeUndefined();
  });

  it('returns undefined for an empty sub', () => {
    expect(decodeJwtSubject(makeJwt({ sub: '' }))).toBeUndefined();
  });

  it('returns undefined for a non-string sub', () => {
    expect(decodeJwtSubject(makeJwt({ sub: 42 }))).toBeUndefined();
  });

  it('never throws on malformed input', () => {
    expect(() => decodeJwtSubject('not-a-jwt')).not.toThrow();
  });
});
