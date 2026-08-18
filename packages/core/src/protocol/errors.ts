// Canonical wire-level error codes.
//
// Source of truth: docs/spec/chat-sdk-v2-prd.md §7.4.
//
// These replace v1's brittle `error.message === 'TOKEN_EXPIRED'` /
// `.includes('expired')` string-matching (§12.6) — every platform branches
// on `code`, never on `message`. `message` on ErrorPayload (envelope.ts) is
// human-readable prose only.

export const ERROR_CODE_VALUES = [
  'AUTH_INVALID',
  'AUTH_EXPIRED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'SESSION_NOT_FOUND',
  'SESSION_CLOSED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODE_VALUES);

/** Runtime guard — is `value` one of the canonical wire error codes? */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}
