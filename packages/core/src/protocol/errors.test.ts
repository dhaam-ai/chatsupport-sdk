import { describe, expect, it } from 'vitest';
import { ERROR_CODE_VALUES, isErrorCode } from './errors.js';

describe('ErrorCode', () => {
  it('accepts every canonical code from §7.4', () => {
    expect(ERROR_CODE_VALUES).toEqual([
      'AUTH_INVALID',
      'AUTH_EXPIRED',
      'PROTOCOL_VERSION_UNSUPPORTED',
      'RATE_LIMITED',
      'VALIDATION_FAILED',
      'SESSION_NOT_FOUND',
      'SESSION_CLOSED',
      'INTERNAL',
    ]);
    for (const code of ERROR_CODE_VALUES) {
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it('rejects v1-style prose matching targets and unknown codes', () => {
    expect(isErrorCode('TOKEN_EXPIRED')).toBe(false);
    expect(isErrorCode('token expired')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });
});
