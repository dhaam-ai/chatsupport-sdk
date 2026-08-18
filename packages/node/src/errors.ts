// Structured errors for the server SDK.
//
// The taxonomy deliberately mirrors `@dhaam-ccrm/rest` (`RestApiError` vs
// `RestTransportError`) rather than inventing a second vocabulary: a server
// verdict and a failure to reach the server demand OPPOSITE responses, and a
// caller who has learned that distinction in one package should not have to
// relearn it here. The names are re-declared rather than imported because this
// package must not take a dependency edge on a browser package (see README).
//
// ── The rule that governs every message in this file ────────────────────
//
// No error thrown from this package may carry credential material: not a
// secret key, not an access token, not a signature, not a prefix, not a
// length, not a digest, not a character count. This package exists to hold
// the secret key, so it is the one place where an `Error` reaching an error
// tracker is a credential-exfiltration path with a stack trace attached.
//
// Diagnosability is preserved by naming the CATEGORY of failure precisely
// ("empty", "wrong key type", "timestamp outside tolerance") — which tells a
// developer what to fix without echoing what they supplied.

/** §7.4's codes, as returned by the REST surface. Shared with `@dhaam-ccrm/rest`. */
export type ChatErrorCode =
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
 * Distinct from {@link ChatTransportError} on purpose: this one means the
 * server evaluated the request and said no, so retrying it unchanged is
 * usually pointless. `retryable` carries the server's own answer rather than
 * a guess.
 */
export class ChatApiError extends Error {
  readonly code: ChatErrorCode | string;
  readonly status: number;
  readonly retryable: boolean;
  /** `X-Request-Id`, when the server sent one. Safe to log — it is a correlation id, not a credential. */
  readonly requestId: string | undefined;

  constructor(input: {
    code: ChatErrorCode | string;
    message: string;
    status: number;
    retryable: boolean;
    requestId?: string | undefined;
  }) {
    super(input.message);
    this.name = 'ChatApiError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.requestId = input.requestId;
  }
}

/**
 * The request never produced a server verdict — DNS failure, connection
 * refused, TLS error, abort.
 *
 * Kept separate from {@link ChatApiError} because the two demand opposite
 * responses: a 401 means fix the credential, a connection refused means try
 * again later. Collapsing them is how a client ends up retrying a rejected
 * request forever, or giving up on a transient blip.
 *
 * The cause is HELD, never interpolated into the message. `fetch`'s own error
 * text can embed the request URL, and a URL on this service has historically
 * carried a token in its query string (§14) — so stringifying a transport
 * cause into a message is a credential leak waiting for the right deployment.
 */
export class ChatTransportError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('the request did not reach the server');
    this.name = 'ChatTransportError';
    this.cause = cause;
  }
}

/**
 * A configuration value is not a well-formed secret key.
 *
 * Never carries the offending value — see the file header. The `reason` is a
 * fixed category string chosen from a closed set, never derived from input.
 */
export class InvalidSecretKeyError extends Error {
  constructor(reason: string) {
    super(`secretKey is not a valid secret key: ${reason}`);
    this.name = 'InvalidSecretKeyError';
  }
}

/**
 * A PUBLISHABLE key was supplied where a SECRET key belongs.
 *
 * Its own class, not a `reason` on {@link InvalidSecretKeyError}, because the
 * two failures have different fixes and different urgency. A malformed key is
 * a typo. A publishable key here means the caller has mixed up the two
 * credentials, and the mix-up runs in BOTH directions: the same confusion that
 * puts a publishable key on the server puts the secret key in the browser
 * bundle, which is the incident core's `SecretKeyInClientError` exists to
 * catch. Saying so explicitly is what prompts someone to go and check.
 *
 * A publishable key also simply cannot work here: it grants nothing on its own
 * (§10.1) and `POST /tokens` accepts only a secret key, so the request would
 * fail at the server with a deliberately uninformative generic 401 — the token
 * route returns ONE message for every auth failure so there is no oracle to
 * enumerate against. Failing here, in the customer's own process, is the only
 * place a specific diagnosis can be given at all.
 */
export class PublishableKeyAsSecretError extends Error {
  constructor() {
    super(
      'A publishable key (dhp_live_.../dhp_test_...) was supplied where a secret key ' +
        '(dhk_live_.../dhk_test_...) is required. The publishable key identifies a tenant ' +
        'and grants nothing on its own; only the secret key can mint user tokens. ' +
        'If these two were swapped, check whether the secret key was also shipped to your ' +
        'client bundle — if so, rotate it now. ' +
        'The offending value is deliberately omitted from this message.',
    );
    this.name = 'PublishableKeyAsSecretError';
  }
}

/**
 * A webhook delivery failed verification, for any reason.
 *
 * ONE class with a coarse {@link WebhookVerificationFailure} discriminator,
 * rather than a class per failure mode, and the discriminator is deliberately
 * coarse. A receiver's only correct response to any of these is the same —
 * reject the delivery — and a caller who branches on a fine-grained reason is
 * usually building exactly the oracle this package is trying not to be.
 *
 * The reason is safe to log: it names which CHECK failed, never any value
 * involved in the check.
 */
export class WebhookVerificationError extends Error {
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, detail: string) {
    super(`webhook signature verification failed: ${detail}`);
    this.name = 'WebhookVerificationError';
    this.reason = reason;
  }
}

/**
 * Why a webhook failed verification.
 *
 * - `malformed_header` — the `X-ChatSDK-Signature` header is absent or does
 *   not parse as `t=<unix-seconds>,v1=<hex>`.
 * - `timestamp_out_of_tolerance` — `t` is further from the receiver's clock
 *   than the configured window allows. This is the replay defense.
 * - `signature_mismatch` — the HMAC did not match. A tampered body and a
 *   wrong signing key are BOTH reported as this, and that collapse is
 *   intentional: distinguishing them would tell an attacker probing an
 *   endpoint whether they have guessed the right key, which is precisely the
 *   signal the constant-time comparison exists to withhold.
 * - `invalid_payload` — the verified bytes are not the JSON event shape the
 *   contract promises. Only reachable from `constructWebhookEvent`.
 */
export type WebhookVerificationFailure =
  | 'malformed_header'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch'
  | 'invalid_payload';
