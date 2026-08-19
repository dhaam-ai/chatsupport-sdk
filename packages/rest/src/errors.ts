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

  /**
   * The server's own explanation, verbatim. **Untrusted — treat as opaque.**
   *
   * Kept off `message` deliberately. `message` is what a host application's
   * error reporter records by default, and this service's upload route returns
   * the raw caught AWS SDK error text on its 500 branch
   * (`upload.routes.ts:197-203`), which can name the bucket, key, region, or
   * endpoint. Anything a server controls that ends up in `message` ends up in
   * Sentry.
   *
   * Read it for a diagnostic surface a human is already looking at. Do not log
   * it by default, do not render it to an end user, and never branch on it —
   * branch on `code` (§12.6).
   */
  readonly serverMessage: string | undefined;

  constructor(input: {
    code: RestErrorCode | string;
    /** Fixed, caller-authored text. Never the server's — see `serverMessage`. */
    message: string;
    status: number;
    retryable: boolean;
    serverMessage?: string;
  }) {
    super(input.message);
    this.name = 'RestApiError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.serverMessage = input.serverMessage;
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

/**
 * The mutation was applied, but the follow-up read failed.
 *
 * `closeSession`/`reopenSession` are two round trips — a POST that changes the
 * session, then a GET that reads back the full session core's contract requires
 * (see `createSessionActions`). This error means the FIRST one succeeded: the
 * server has already closed or reopened the session, and only the second call
 * failed. That is a materially different situation from "the action failed",
 * and collapsing the two is how a caller ends up either believing a session is
 * still open when it is not, or retrying a mutation that already ran.
 *
 * Retrying the whole action is specifically wrong here.
 * `chatSessionService.closeSession` is not idempotent: a second call re-runs
 * the status update, re-marks participants as having left, and emits both a
 * fresh "chat closed" SYSTEM message and a new Kafka domain event. The caller
 * would see duplicates in the transcript. The adapter therefore retries only
 * the read-back, and reports this once the read is genuinely out of attempts.
 *
 * `sessionMutationApplied` is a plain boolean rather than something requiring
 * `instanceof`, so a consumer that never imports this package — core, which
 * deliberately depends on nothing — can still recognize the condition
 * structurally.
 */
export class RestSessionReadBackError extends Error {
  /** Always `true`. The structural marker described above. */
  readonly sessionMutationApplied = true;

  /** The session the mutation settled on — the one that could not be read. */
  readonly sessionId: string;

  /**
   * The read-back failure. Held rather than interpolated: it can be a
   * `RestApiError` whose message came from the server (§14).
   */
  readonly cause: unknown;

  constructor(input: { sessionId: string; cause: unknown }) {
    super('the session was changed, but the updated session could not be read back');
    this.name = 'RestSessionReadBackError';
    this.sessionId = input.sessionId;
    this.cause = input.cause;
  }
}
