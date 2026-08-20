// ==========================================
// Chat SDK - Outbound message send state
// ==========================================
// Answers two questions about a customer message that did not make it:
//   1. Is it retryable at all? (a permanently-refused send must show NO retry
//      affordance — clicking it would be refused identically every time)
//   2. What does the user see?
//
// ── Where the codes come from ──────────────────────────────────────────────
// SERVER, over `chat.error`, all emitted by chat-service's
// api/websocket/websocket-server.ts as `{ code, message }`:
//   NOT_IN_SESSION (1093), RATE_LIMITED (1101), MESSAGE_ERROR (1224),
//   VALIDATION_ERROR (275, 324), UNAUTHORIZED (1013), SESSION_ERROR (896),
//   READ_ERROR (352)
//
// KNOWN v1 PROTOCOL GAP: `chat.error` carries NO clientMessageId and no
// retryable flag. The server therefore cannot tell us WHICH in-flight message
// an error belongs to. attributeServerError below only attributes an error
// when exactly one send is in flight; otherwise the ack timeout is what marks
// a message failed. Adding clientMessageId + retryable to the v1 error frame
// is a backend follow-up.
// ==========================================

import type { SendFailure } from './types';

/** Raised locally, never by the server. */
export const LOCAL_CODES = {
  /** client.sendMessage threw because the socket was not connected. */
  NOT_CONNECTED: 'NOT_CONNECTED',
  /** No chat.message.ack came back inside ACK_TIMEOUT_MS. */
  ACK_TIMEOUT:   'ACK_TIMEOUT',
  /** Auth is gone; a retry cannot fix it without a page refresh. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** An attachment's HTTP upload failed. Not retryable by replay: the bytes
   *  never reached the server, and this stack does not hold the File after the
   *  attempt, so a "Retry" button would have nothing to resend. The user has to
   *  attach the file again — telling them so beats a button that cannot work. */
  UPLOAD_FAILED: 'UPLOAD_FAILED',
} as const;

/**
 * How long to wait for chat.message.ack before calling a send failed.
 *
 * Bounds the "stuck sending forever" bug: previously an optimistic bubble that
 * never got an ack simply sat there with no tick and no error, indefinitely.
 */
export const ACK_TIMEOUT_MS = 12_000;

/**
 * Is a send worth retrying with the identical payload?
 *
 * Explicit if-chain rather than a set lookup, matching the enum-normalisation
 * idiom this stack uses everywhere else.
 */
export function isRetryableSendCode(code: string): boolean {
  const c = String(code ?? '').toUpperCase().trim();

  // ── Permanently refused: the same payload fails the same way every time,
  // so offering a retry button is offering a button that cannot work.
  if (c === 'VALIDATION_ERROR')  return false;
  if (c === 'VALIDATION_FAILED') return false;
  if (c === 'UNAUTHORIZED')      return false;
  if (c === 'FORBIDDEN')         return false;
  if (c === 'TOKEN_EXPIRED')     return false;
  if (c === 'SESSION_CLOSED')    return false;
  // Not in a session: the socket must re-join first. Replaying the same send
  // hits the same guard, so this is a reconnect problem, not a retry problem.
  if (c === 'NOT_IN_SESSION')    return false;
  if (c === 'UPLOAD_FAILED')     return false;

  // ── Transient: the identical payload can succeed once conditions change.
  if (c === 'MESSAGE_ERROR')  return true;
  if (c === 'RATE_LIMITED')   return true;
  if (c === 'SESSION_ERROR')  return true;
  if (c === 'NOT_CONNECTED')  return true;
  if (c === 'ACK_TIMEOUT')    return true;

  // Unknown code. Default to retryable: there is no auto-retry loop here (the
  // user clicks), so the cost of a wrong "true" is one wasted click, while the
  // cost of a wrong "false" is a message the user can never get out.
  return true;
}

/** Human-readable text for a failure, so the bubble never shows a bare code. */
export function sendFailureMessage(code: string, serverMessage?: string | null): string {
  const c = String(code ?? '').toUpperCase().trim();
  if (c === 'NOT_CONNECTED')  return "You're offline — this message wasn't sent.";
  if (c === 'ACK_TIMEOUT')    return "Couldn't reach the server — this message wasn't sent.";
  if (c === 'TOKEN_EXPIRED')  return 'Your session expired. Refresh the page to continue.';
  if (c === 'RATE_LIMITED')   return "You're sending messages too quickly.";
  if (c === 'NOT_IN_SESSION') return 'This conversation is no longer active.';
  if (c === 'UNAUTHORIZED')   return "You're not allowed to post in this conversation.";
  if (c === 'UPLOAD_FAILED')  return 'Upload failed — please attach the file again.';
  if (serverMessage && serverMessage.trim()) return serverMessage.trim();
  return "This message wasn't sent.";
}

/** Build the failure record stored on the message. */
export function toSendFailure(code: string, serverMessage?: string | null): SendFailure {
  const normalized = String(code ?? '').toUpperCase().trim() || 'MESSAGE_ERROR';
  return {
    code:      normalized,
    message:   sendFailureMessage(normalized, serverMessage),
    retryable: isRetryableSendCode(normalized),
  };
}

/**
 * Turn whatever `chat.error` / a thrown Error gave us into a failure record.
 *
 * client.ts used to collapse the server's `{code, message}` into
 * `new Error(message)`, discarding the code entirely — which made "retryable"
 * unknowable and is why every failure looked the same. This reads the code back
 * off whichever shape survived.
 */
export function classifySendError(raw: unknown): SendFailure {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const code = o.code ?? (o as any).errorCode;
    if (typeof code === 'string' && code.trim()) {
      return toSendFailure(code, typeof o.message === 'string' ? o.message : null);
    }
    if (typeof o.message === 'string') {
      // A bare Error. TOKEN_EXPIRED and 'Not connected' are the two client.ts
      // throws from sendMessage; anything else is an unknown transient.
      const m = o.message;
      if (m === 'TOKEN_EXPIRED')      return toSendFailure(LOCAL_CODES.TOKEN_EXPIRED);
      if (m === 'Not connected')      return toSendFailure(LOCAL_CODES.NOT_CONNECTED);
      return toSendFailure('MESSAGE_ERROR', m);
    }
  }
  if (typeof raw === 'string' && raw.trim()) return toSendFailure(raw);
  return toSendFailure('MESSAGE_ERROR');
}

/**
 * Decide whether a `chat.error` can be blamed on a specific in-flight send.
 *
 * v1 gives no correlation id, so this is only safe when there is exactly one
 * candidate. With two or more in flight, guessing would mark the wrong bubble
 * failed — worse than waiting for that bubble's own ack timeout.
 *
 * @param inFlightTempIds temp ids of sends still awaiting an ack, oldest first
 * @returns the temp id to blame, or null to let the ack timeout decide
 */
export function attributeServerError(inFlightTempIds: readonly string[]): string | null {
  return inFlightTempIds.length === 1 ? inFlightTempIds[0] : null;
}
