// Structured errors for the REST surface.
//
// The API returns one shape on every failure (`{ error: { code, message,
// retryable } }`, OpenAPI `Error` schema, reusing the §7.4 `ErrorCode` enum so
// REST and WebSocket share one taxonomy). This module turns that into a typed
// error instead of letting a raw `Response` escape, because a caller cannot
// branch on a `Response` without re-reading its body — which is already
// consumed by the time it is thrown.

/** §7.4's codes, as returned by the REST surface. */
export type RestErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/**
 * A request that reached the server and came back a failure.
 *
 * Distinct from {@link RestTransportError} on purpose: this one means the
 * server evaluated the request and said no, so retrying the same request
 * unchanged is usually pointless. `AUTH_EXPIRED` is the exception, and
 * `retryable` carries the server's own answer rather than a guess.
 */
export class RestApiError extends Error {
  readonly code: RestErrorCode | string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: {
    code: RestErrorCode | string;
    message: string;
    status: number;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = 'RestApiError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
  }
}

/**
 * The request never produced a server verdict — DNS failure, connection
 * refused, TLS error, abort.
 *
 * Kept separate from {@link RestApiError} because the two demand opposite
 * responses: a 401 means fix the credential, a connection refused means try
 * again later. Collapsing them into one error type is how a client ends up
 * retrying a rejected request forever, or giving up on a transient blip.
 *
 * The cause is held rather than interpolated: `fetch`'s own error text can
 * embed the request URL, and on this service the token has historically
 * travelled in the query string (§14).
 */
export class RestTransportError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('the request did not reach the server');
    this.name = 'RestTransportError';
    this.cause = cause;
  }
}
