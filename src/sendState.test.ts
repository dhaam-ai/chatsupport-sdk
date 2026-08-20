import { describe, it, expect } from 'vitest';
import {
  isRetryableSendCode,
  classifySendError,
  toSendFailure,
  attributeServerError,
  LOCAL_CODES,
} from './sendState';

describe('isRetryableSendCode', () => {
  it('offers no retry for a permanently-refused send', () => {
    // Retrying these replays the identical payload into the identical refusal.
    for (const code of [
      'VALIDATION_ERROR', 'VALIDATION_FAILED', 'UNAUTHORIZED',
      'FORBIDDEN', 'TOKEN_EXPIRED', 'SESSION_CLOSED', 'NOT_IN_SESSION',
    ]) {
      expect(isRetryableSendCode(code), `${code} must not be retryable`).toBe(false);
    }
  });

  it('offers a retry for a transient failure', () => {
    for (const code of [
      'MESSAGE_ERROR', 'RATE_LIMITED', 'SESSION_ERROR',
      LOCAL_CODES.NOT_CONNECTED, LOCAL_CODES.ACK_TIMEOUT,
    ]) {
      expect(isRetryableSendCode(code), `${code} must be retryable`).toBe(true);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isRetryableSendCode('  validation_error ')).toBe(false);
    expect(isRetryableSendCode('rate_limited')).toBe(true);
  });

  it('defaults an unknown code to retryable', () => {
    // One wasted click beats a message the user can never get out. There is no
    // auto-retry loop, so a wrong `true` cannot spin.
    expect(isRetryableSendCode('SOME_NEW_SERVER_CODE')).toBe(true);
  });
});

describe('classifySendError', () => {
  it("reads the server's code off a chat.error payload", () => {
    // client.ts used to collapse this to new Error(message), throwing the code
    // away — which is exactly why every failure looked equally retryable.
    expect(classifySendError({ code: 'RATE_LIMITED', message: 'Too many messages — slow down' }))
      .toEqual({
        code: 'RATE_LIMITED',
        message: "You're sending messages too quickly.",
        retryable: true,
      });
  });

  it('marks a validation refusal non-retryable, with the server text', () => {
    const f = classifySendError({ code: 'VALIDATION_ERROR', message: 'content too long' });
    expect(f.retryable).toBe(false);
    expect(f.message).toBe('content too long');
  });

  it('recognises the two throws client.sendMessage can produce', () => {
    expect(classifySendError(new Error('TOKEN_EXPIRED'))).toMatchObject({
      code: 'TOKEN_EXPIRED', retryable: false,
    });
    expect(classifySendError(new Error('Not connected'))).toMatchObject({
      code: 'NOT_CONNECTED', retryable: true,
    });
  });

  it('never produces an empty code or a bare code as the user-facing message', () => {
    const f = classifySendError(undefined);
    expect(f.code).toBe('MESSAGE_ERROR');
    expect(f.message).toBe("This message wasn't sent.");
  });
});

describe('toSendFailure', () => {
  it('always fills a human-readable message', () => {
    expect(toSendFailure(LOCAL_CODES.ACK_TIMEOUT).message)
      .toBe("Couldn't reach the server — this message wasn't sent.");
  });
});

describe('attributeServerError', () => {
  // v1's chat.error carries no clientMessageId, so a server error can only be
  // pinned on a specific bubble when there is exactly one candidate.
  it('blames the single in-flight send', () => {
    expect(attributeServerError(['temp-1'])).toBe('temp-1');
  });

  it('refuses to guess when several sends are in flight', () => {
    expect(attributeServerError(['temp-1', 'temp-2'])).toBeNull();
  });

  it('blames nothing when no send is in flight', () => {
    expect(attributeServerError([])).toBeNull();
  });
});
