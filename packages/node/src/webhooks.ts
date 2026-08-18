// Webhook signature verification — the `X-ChatSDK-Signature` contract.
//
// This function is the ONLY thing standing between a customer's backend and
// forged events. Anyone can POST to a public webhook URL; the signature is the
// entire proof that a delivery came from us. Everything below is written for
// that threat model rather than for elegance.
//
// ── The contract (OpenAPI `WebhookSignatureHeader`) ──────────────────────
//
//   X-ChatSDK-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256>
//
// The signed payload is `${t}.${rawRequestBody}`, HMAC-SHA256'd with the
// tenant's secret key. Verify by recomputing over the RAW, UNPARSED body and
// comparing in constant time; reject if `t` is more than five minutes from the
// receiver's clock.
//
// ── Why the timestamp is inside the signature ────────────────────────────
//
// Signing `${t}.${body}` rather than just `${body}` is what makes the replay
// window enforceable. If `t` were merely a header alongside an
// over-the-body-only signature, an attacker replaying a captured delivery
// could rewrite `t` to "now" and the signature would still verify — the
// timestamp would be decorative. Because it is inside the MAC, changing it
// invalidates the signature, so a captured delivery is only replayable for as
// long as its original `t` stays inside the tolerance.
//
// ── Why the RAW body, not a re-serialized object ─────────────────────────
//
// `JSON.stringify(JSON.parse(body))` is not `body`. Key order, unicode escapes,
// and number formatting all differ between our serializer and the receiver's,
// so verifying against a re-serialized object fails for valid deliveries and,
// worse, tempts a maintainer into "fixing" it by relaxing the comparison.
// This module therefore refuses an already-parsed object outright rather than
// stringifying one on the caller's behalf — see `readPayloadBytes`.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, type WebhookVerificationFailure } from './errors.js';
import type { SecretKey } from './keys.js';
import { parseSecretKey } from './keys.js';
import type { ChatMessage, ChatSession, CloseReason, Ticket } from './types.js';

/**
 * Default replay tolerance: five minutes either side of the receiver's clock.
 *
 * The value is the one the OpenAPI contract states, and both the number and
 * the "either side" matter.
 *
 * FIVE MINUTES is a compromise between two real failure modes. Too tight and
 * legitimate deliveries are rejected by ordinary clock skew: a receiver whose
 * NTP has drifted, or a delivery that sat in a retry queue, fails verification
 * and the customer sees dropped events they cannot explain. Too loose and a
 * captured delivery stays replayable for the length of the window — an
 * attacker who observes one signed request (a leaked proxy log, a misrouted
 * mirror) can resend it verbatim until it expires.
 *
 * EITHER SIDE, not just "not too old". Rejecting only past timestamps leaves a
 * delivery bearing a far-FUTURE `t` valid indefinitely, which converts a
 * single captured request into a permanent forgery. Since `t` is inside the
 * MAC an attacker cannot mint that themselves — but a receiver with a badly
 * wrong clock can produce one, and a bound that only holds when clocks are
 * correct is not a bound.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** The signature scheme version this module understands. */
const SCHEME = 'v1';

/**
 * Constant-time string comparison.
 *
 * BOTH OPERANDS ARE DIGESTED FIRST, and that is not incidental.
 * `timingSafeEqual` THROWS on a length mismatch, and that throw is itself a
 * length oracle — an attacker learns the expected signature length by
 * observing which inputs produce an exception instead of a `false`. Hashing
 * makes both sides a fixed 32 bytes, so the comparison is unconditional and
 * the function is total for any input.
 *
 * A naive `===` here would be worse still: string equality short-circuits at
 * the first differing byte, leaking the length of the matching prefix and
 * letting an attacker recover a valid signature byte by byte.
 *
 * This mirrors the server's own `constantTimeEquals`
 * (`src/infrastructure/auth/api-key.ts`) deliberately, for the same reason
 * stated there.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

/** The raw bytes of the request body, exactly as received. */
export type WebhookPayload = string | Uint8Array;

/**
 * Coerce the payload to bytes, refusing anything that has already been parsed.
 *
 * The refusal is the point. The single most common way to get webhook
 * verification wrong is to hand it `req.body` from a framework whose JSON
 * middleware has already run, then paper over the resulting mismatch. Failing
 * loudly here — with an error that names the fix — is the difference between
 * a five-minute integration and a customer disabling verification "because it
 * never works".
 */
function readPayloadBytes(payload: WebhookPayload): Buffer {
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  throw new TypeError(
    'webhook payload must be the raw request body as a string or Buffer. ' +
      'It looks like an already-parsed object was supplied: re-serializing it ' +
      'produces different bytes than were signed (key order and escaping differ), ' +
      'so verification cannot succeed. Configure your framework to expose the raw ' +
      'body — e.g. express.raw({ type: "application/json" }) — and pass that.',
  );
}

/** A parsed `X-ChatSDK-Signature` header. */
interface ParsedSignatureHeader {
  readonly timestamp: number;
  /**
   * Every `v1=` value present.
   *
   * Plural because a signature header may legitimately carry more than one
   * during a secret-key rotation: the sender signs with both the outgoing and
   * incoming key so receivers can migrate without a flag day. Accepting a
   * delivery when ANY of them matches is what makes rotation non-breaking.
   * (The current server sends exactly one — see the README's drift notes.)
   */
  readonly signatures: readonly string[];
}

/**
 * Parse `t=<unix-seconds>,v1=<hex>` into its parts.
 *
 * Returns `null` rather than throwing so the caller decides the failure shape,
 * and so no parse detail escapes into a message.
 */
function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  if (typeof (header as unknown) !== 'string' || header === '') return null;

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    // Split on the FIRST '=' only. A hex signature contains none, but
    // splitting on all of them would silently drop data from any future
    // scheme whose value is base64 (which uses '=' as padding) — a trap worth
    // not laying for whoever adds `v2`.
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    if (name === 't') {
      // Strict digits. `Number('12 ')` is 12 and `parseInt('12abc')` is 12;
      // both would accept a header we should reject, and a timestamp is the
      // input the replay window depends on.
      if (!/^\d+$/.test(value)) return null;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) return null;
      timestamp = parsed;
    } else if (name === SCHEME) {
      // Lower-cased so a sender emitting upper-case hex is not rejected for a
      // difference that carries no meaning. Length is not checked here: the
      // constant-time comparison is total for any input, so a wrong-length
      // value simply fails to match, and checking it here would reintroduce
      // the length oracle that digesting exists to remove.
      if (value !== '') signatures.push(value.toLowerCase());
    }
    // Unknown fields are ignored, not rejected — that is what lets the sender
    // add a `v2=` alongside `v1=` without breaking every deployed receiver.
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** Compute the expected signature for a payload at a given timestamp. */
function computeSignature(secretKey: SecretKey, timestamp: number, body: Buffer): string {
  // `${t}.${body}` assembled as BYTES, not by string interpolation. A body
  // containing invalid UTF-8 (a truncated multi-byte sequence, or genuinely
  // binary content) would be corrupted by a round trip through a JS string —
  // every unpaired surrogate becomes U+FFFD — and the MAC would be computed
  // over different bytes than the sender signed.
  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  return createHmac('sha256', secretKey).update(signedPayload).digest('hex');
}

/** Options shared by {@link verifyWebhookSignature} and {@link constructWebhookEvent}. */
export interface WebhookVerifyOptions {
  /** The raw, unparsed request body — a string or Buffer, never a parsed object. */
  readonly payload: WebhookPayload;
  /** The `X-ChatSDK-Signature` header value. */
  readonly signatureHeader: string;
  /**
   * The tenant's secret key. Accepts a raw string for ergonomics and validates
   * it here, so a caller who never touched {@link parseSecretKey} still cannot
   * verify against an empty string read from an unset environment variable —
   * which would otherwise "work" against an attacker who signed with the same
   * empty string.
   */
  readonly secretKey: SecretKey | string;
  /** Replay window in seconds, either side of `now`. Defaults to {@link DEFAULT_TOLERANCE_SECONDS}. */
  readonly toleranceSeconds?: number;
  /** Current time in unix SECONDS. Injectable for tests; defaults to the system clock. */
  readonly now?: number;
}

/**
 * Verify a webhook delivery, throwing {@link WebhookVerificationError} on any
 * failure.
 *
 * Prefer {@link constructWebhookEvent}, which additionally hands back the
 * typed event and so makes it impossible to read an event you have not
 * verified. Use this form only when the body is not JSON or you have already
 * parsed it elsewhere.
 *
 * @throws {WebhookVerificationError} on a malformed header, a timestamp
 *   outside tolerance, or a signature mismatch. Never carries the signature,
 *   the key, or the body.
 */
export function assertWebhookSignature(options: WebhookVerifyOptions): void {
  // Validated first, and eagerly. An unset `WEBHOOK_SECRET` arriving as '' is
  // the classic misconfiguration, and an HMAC keyed on '' verifies perfectly
  // against a forgery signed with '' — verification that always succeeds is
  // worse than no verification, because it is believed.
  const secretKey = parseSecretKey(options.secretKey);

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError('toleranceSeconds must be a non-negative, finite number of seconds');
  }

  const parsed = parseSignatureHeader(options.signatureHeader);
  if (parsed === null) {
    throw fail(
      'malformed_header',
      `the X-ChatSDK-Signature header is missing or not in the form "t=<unix-seconds>,${SCHEME}=<hex>"`,
    );
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  // Absolute difference — see DEFAULT_TOLERANCE_SECONDS for why a future
  // timestamp is rejected as firmly as a stale one.
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    throw fail(
      'timestamp_out_of_tolerance',
      `the signature timestamp is outside the ${tolerance}s replay window ` +
        '(check this host\'s clock, then whether the delivery is a replay)',
    );
  }

  const body = readPayloadBytes(options.payload);
  const expected = computeSignature(secretKey, parsed.timestamp, body);

  // Every candidate is compared even after one matches. Returning early on the
  // first match would make the number of comparisons depend on which key
  // signed the delivery — a timing signal about the sender's rotation state.
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (constantTimeEquals(candidate, expected)) matched = true;
  }

  if (!matched) {
    // A tampered body and a wrong signing key are reported identically. See
    // WebhookVerificationFailure for why that collapse is deliberate.
    throw fail(
      'signature_mismatch',
      'the computed HMAC does not match the signature (the body was modified in transit, ' +
        'the wrong secret key was used, or the raw body was not preserved byte-for-byte)',
    );
  }
}

/**
 * Non-throwing form of {@link assertWebhookSignature}.
 *
 * Returns `true` only for a delivery that passed every check.
 *
 * Note that a boolean is easy to ignore — `verifyWebhookSignature(...)` on its
 * own line silently does nothing — which is why the throwing forms are the
 * documented path. Configuration errors (an invalid secret key, a negative
 * tolerance) still throw here rather than returning `false`: they mean the
 * receiver is broken, not that the delivery is forged, and reporting them as
 * "invalid signature" would send someone hunting an attacker who does not
 * exist.
 */
export function verifyWebhookSignature(options: WebhookVerifyOptions): boolean {
  try {
    assertWebhookSignature(options);
    return true;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return false;
    throw error;
  }
}

function fail(reason: WebhookVerificationFailure, detail: string): WebhookVerificationError {
  return new WebhookVerificationError(reason, detail);
}

// ── Event catalog ─────────────────────────────────────────────────────────

/** Fields shared by every webhook event (OpenAPI "Webhook delivery contract"). */
interface WebhookEventBase<TType extends string, TData> {
  /**
   * Unique per event, and also sent as `X-ChatSDK-Webhook-Id`.
   *
   * Delivery is AT-LEAST-ONCE: retries reuse this id. A receiver that does not
   * dedupe on it will double-process events, which for anything that writes to
   * a CRM or charges a customer is the expensive kind of bug.
   */
  readonly id: string;
  readonly type: TType;
  readonly createdAt: string;
  /**
   * The raw tenant identifier.
   *
   * Present here but deliberately withheld from browser-facing payloads, which
   * identify a tenant only via the opaque publishable key. A webhook is a
   * server-to-server channel to the customer's own trusted backend, so
   * exposing it is appropriate.
   */
  readonly tenantId: string;
  readonly data: TData;
}

export type WebhookMessageCreatedEvent = WebhookEventBase<'message.created', ChatMessage>;

export type WebhookSessionUpdatedEvent = WebhookEventBase<'session.updated', ChatSession>;

export type WebhookSessionClosedEvent = WebhookEventBase<
  'session.closed',
  { readonly session: ChatSession; readonly closeReason: CloseReason }
>;

export type WebhookTicketLinkedEvent = WebhookEventBase<
  'ticket.linked',
  { readonly sessionId: string; readonly ticket: Ticket }
>;

/**
 * Every event this SDK version knows about.
 *
 * A discriminated union on `type`, so a `switch` narrows `data` to the right
 * shape. New event types are additive and never remove or repurpose an
 * existing one — so a receiver should tolerate a `type` it does not recognise
 * rather than treating it as an error (see {@link constructWebhookEvent}).
 */
export type WebhookEvent =
  | WebhookMessageCreatedEvent
  | WebhookSessionUpdatedEvent
  | WebhookSessionClosedEvent
  | WebhookTicketLinkedEvent;

/**
 * An event whose `type` this SDK version does not know.
 *
 * Returned rather than thrown, because the contract says new event types are
 * additive: a receiver upgraded later than the sender must not start rejecting
 * deliveries it cannot yet name. `data` stays `unknown` so nothing can be read
 * off it without a deliberate narrowing.
 */
export interface UnknownWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: string;
  readonly tenantId: string;
  readonly data: unknown;
}

/** Anything {@link constructWebhookEvent} can hand back. */
export type ReceivedWebhookEvent = WebhookEvent | UnknownWebhookEvent;

/** The event types this SDK version knows, as a runtime set. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<WebhookEvent['type']>([
  'message.created',
  'session.updated',
  'session.closed',
  'ticket.linked',
]);

/**
 * Narrow a received event to the known catalog.
 *
 * Needed because `UnknownWebhookEvent['type']` is `string`, which overlaps
 * every literal in {@link WebhookEvent} — so a bare `switch (event.type)` on
 * the raw union narrows `data` to `unknown` and nothing useful can be read
 * off it. TypeScript cannot express "a string that is none of these literals",
 * so the discrimination has to happen through a guard.
 *
 * The two-step is not an inconvenience to route around; it is the contract
 * made visible. New event types are additive, so a receiver WILL one day be
 * handed a type it does not know, and code that forgot to consider that would
 * otherwise fall through a `switch` into whatever the default branch does.
 *
 * ```ts
 * const event = chat.constructWebhookEvent({ payload, signatureHeader });
 * if (!isKnownWebhookEvent(event)) return res.sendStatus(204); // ack and ignore
 * switch (event.type) {
 *   case 'message.created':
 *     console.log(event.data.content); // narrowed to ChatMessage
 *     break;
 * }
 * ```
 */
export function isKnownWebhookEvent(event: ReceivedWebhookEvent): event is WebhookEvent {
  return KNOWN_EVENT_TYPES.has(event.type);
}

/**
 * Verify a delivery and return its parsed event.
 *
 * The primary entry point, and the shape to reach for: there is no way to
 * obtain the event without the verification having passed, so the failure mode
 * where someone parses the body first and checks the signature "later"
 * (or never) is not expressible.
 *
 * @throws {WebhookVerificationError} on any verification failure, or if the
 *   verified bytes are not a JSON object carrying the four contract fields.
 */
export function constructWebhookEvent(options: WebhookVerifyOptions): ReceivedWebhookEvent {
  // Verification happens BEFORE parsing, deliberately. Parsing first would run
  // a JSON parser — and then whatever the caller does next — over bytes whose
  // provenance is still unproven.
  assertWebhookSignature(options);

  const text =
    typeof options.payload === 'string'
      ? options.payload
      : Buffer.from(options.payload).toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's own message can quote the offending input, which is the
    // verified body — not a credential, but not ours to spray into a log line
    // either. Replaced with a fixed description.
    throw new WebhookVerificationError('invalid_payload', 'the body is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WebhookVerificationError('invalid_payload', 'the body is not a JSON object');
  }

  const event = parsed as Record<string, unknown>;
  if (
    typeof event['id'] !== 'string' ||
    typeof event['type'] !== 'string' ||
    typeof event['createdAt'] !== 'string' ||
    typeof event['tenantId'] !== 'string'
  ) {
    throw new WebhookVerificationError(
      'invalid_payload',
      'the body is missing one of the required fields id, type, createdAt, tenantId',
    );
  }

  return parsed as ReceivedWebhookEvent;
}

/**
 * Produce a signature header for a payload — the sender's half of the contract.
 *
 * Exported so a customer can write a test for their own webhook handler
 * without reimplementing the scheme (and getting it subtly wrong, which is how
 * a handler ends up "tested" against a signature format the server never
 * sends). It is also what this package's own tests sign with.
 *
 * This is NOT a way to authenticate yourself to anything: the receiver of a
 * webhook is the customer, and this signs with their own key.
 */
export function signWebhookPayload(input: {
  readonly payload: WebhookPayload;
  readonly secretKey: SecretKey | string;
  /** Unix SECONDS. Defaults to now. */
  readonly timestamp?: number;
}): string {
  const secretKey = parseSecretKey(input.secretKey);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = computeSignature(secretKey, timestamp, readPayloadBytes(input.payload));
  return `t=${timestamp},${SCHEME}=${signature}`;
}
