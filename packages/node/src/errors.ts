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

// ── Contacts / commerce-events errors ───────────────────────────────────
//
// `POST /contacts/commerce-events` does NOT reply through the vocabulary
// `ChatErrorCode` above describes. That bare-envelope `{error:{...}}` shape,
// with its `retryable` flag, belongs to `POST /tokens` and the
// session/message routes. Commerce events go through the global Fastify
// error handler's LEGACY envelope instead — `{success:false,error:{code,
// message,details?}}` — a different code set, and (per `openapi/chat-api.yaml`,
// "Contacts / commerce-events surface") NEVER a `retryable` field. `code`
// still lands on `ChatApiError.code` (`http.ts`'s `readErrorBody` reads
// `error.code` generically, regardless of which envelope it came from) —
// only the vocabulary it is drawn from differs, which is why that vocabulary
// gets its own named type rather than widening `ChatErrorCode`.

/**
 * The code vocabulary `POST /contacts/commerce-events` actually emits —
 * `openapi/chat-api.yaml`'s `ContactsErrorCode` schema, restricted to what
 * the SECRET-KEY (machine) path can return.
 *
 * The full schema also lists `UNAUTHORIZED`, but that is the staff-token
 * routes' code (a Cognito failure, or a verified-but-wrong-role rejection on
 * `POST /contacts/{id}/commerce-events`) — this package calls only the
 * machine path (`recordCommerceEvent()`, `commerce.ts`), which authenticates
 * with the secret key and reports every credential failure as `AUTH_INVALID`
 * instead. `UNAUTHORIZED` is omitted here because this package can never
 * receive it; if that ever changes, it changes alongside the method that
 * would newly produce it.
 *
 * `CONTACT_NOT_FOUND` is included for completeness even though the machine
 * path cannot produce it either — `customerId` always resolves-or-creates a
 * contact, so a `404` naming a missing contact is exclusively an admin-path
 * (`POST /contacts/{id}/commerce-events`) failure. Kept in the union anyway:
 * this is the taxonomy the wire actually defines, and a caller pattern-
 * matching `ChatApiError.code` against it should be able to name every code
 * the schema documents, not just the subset one method is expected to hit.
 */
export type ContactsErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_INVALID'
  | 'CONTACT_NOT_FOUND'
  | 'CART_NOT_FOUND'
  | 'INVALID_CART_TRANSITION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/**
 * The {@link ContactsErrorCode} values naming a rejection that did NOT
 * consume the event's `eventId` — where retrying the identical request,
 * unchanged, `eventId` included, is the documented recovery path rather than
 * a caller error to fix first.
 *
 * This is the split {@link isRetryableContactsError} exists to teach, and it
 * is not the same split `ChatApiError.retryable` draws elsewhere in this
 * package (§"Two vocabularies", `openapi/chat-api.yaml`): this route never
 * sends a `retryable` flag at all, and even where it did, generic
 * HTTP-retryability is the wrong axis here. The axis that matters for
 * `recordCommerceEvent()` is whether the SAME `eventId` is worth resending:
 *
 * - `CART_NOT_FOUND` (404) and `INVALID_CART_TRANSITION` (422) — the
 *   RELEASE-ON-REJECT codes. Each rolls back its entire transaction,
 *   including the idempotency insert, so the `eventId` was never consumed;
 *   resending it later — once the missing cart exists, or once whatever
 *   raced ahead of it lands — is processed as a fresh attempt, not bounced
 *   again for the same reason forever. This is the intended recovery path
 *   for out-of-order arrival (a `cart.abandoned` racing its own
 *   `cart.updated`), and it is why this package's docs say: after a `404`
 *   or `422`, reuse the SAME `eventId` — never mint a new one.
 * - `RATE_LIMITED` (429) — never reaches the transaction at all, so the
 *   `eventId` is equally untouched; the fix is a backoff, not a code change.
 * - `INTERNAL_ERROR` (500) — the one genuinely ambiguous case (unclear
 *   whether the transaction committed before the fault), but the idempotency
 *   contract makes resending safe regardless: an already-applied `eventId`
 *   replays as `applied: false` with the original outcome rather than
 *   re-running the mutation, and an unapplied one is processed fresh. There
 *   is no outcome where resending the same id after a `500` does the wrong
 *   thing.
 *
 * Deliberately EXCLUDED — these need a caller-side fix before any retry can
 * ever succeed, same `eventId` or not:
 *
 * - `VALIDATION_ERROR` (400) and `AUTH_INVALID` (401) — happen before any
 *   transaction opens, so the `eventId` is technically just as free to
 *   reuse, but blindly resending the identical, still-malformed request
 *   changes nothing. These name a bug in the caller's own code or config.
 * - `CONTACT_NOT_FOUND` — unreachable from the machine path this package
 *   wraps (see {@link ContactsErrorCode}); included only so this function
 *   stays total over the whole code union rather than silently mis-handling
 *   a code introduced by a future admin-path method.
 */
const RETRYABLE_CONTACTS_ERROR_CODES: ReadonlySet<string> = new Set<ContactsErrorCode>([
  'CART_NOT_FOUND',
  'INVALID_CART_TRANSITION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

/**
 * Whether an error thrown by `recordCommerceEvent()` is worth retrying with
 * the SAME `eventId`, as opposed to fatal — a bug in the caller's own
 * request that must be fixed before any retry can succeed.
 *
 * **This is the single most important call a `recordCommerceEvent()`
 * integrator makes.** Getting it backwards in either direction has a real
 * cost: treating a fatal error (a typo'd field, a bad key) as retryable
 * spins a loop that can never succeed; treating a retryable one (a
 * `cart.abandoned` that raced ahead of its own `cart.updated`) as fatal
 * drops a legitimate event that a second attempt, same `eventId`, would
 * have accepted once the earlier one landed.
 *
 * Accepts whatever `recordCommerceEvent()` threw, unnarrowed, so this is
 * usable as the first line of a `catch` block with no `instanceof` of your
 * own:
 *
 * ```ts
 * try {
 *   await chat.recordCommerceEvent(event);
 * } catch (error) {
 *   if (isRetryableContactsError(error)) {
 *     await queueRetry(event); // same eventId — never mint a new one
 *   } else {
 *     await deadLetter(event, error); // needs a human or a code fix
 *   }
 * }
 * ```
 *
 * - {@link ChatTransportError} (the request never reached the server) is
 *   ALWAYS retryable: nothing was applied, and the same `eventId` is exactly
 *   as safe to send as it was the first time.
 * - {@link ChatApiError} is retryable exactly when its `code` is one of
 *   {@link RETRYABLE_CONTACTS_ERROR_CODES} — see that constant for the full
 *   reasoning per code, including why `500` belongs here despite being
 *   genuinely ambiguous about whether it committed.
 * - Anything else — a local `InvalidCommerceEventError` (an unrecognised
 *   field, a missing required field, an `items`/`name`/`sku` cap exceeded),
 *   or any other thrown value — is fatal. A validation failure caught before
 *   the request ever left this process will fail identically on every retry
 *   until the caller's own code changes.
 */
export function isRetryableContactsError(error: unknown): boolean {
  if (error instanceof ChatTransportError) return true;
  if (error instanceof ChatApiError) return RETRYABLE_CONTACTS_ERROR_CODES.has(error.code);
  return false;
}
