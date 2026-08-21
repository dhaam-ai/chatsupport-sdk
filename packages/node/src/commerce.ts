// Commerce event ingestion — `POST /contacts/commerce-events`.
//
// The structural sibling of `tokens.ts`: a body builder that validates
// before anything goes on the wire, throwing a LOCAL error rather than
// round-tripping to learn what the server would have said, plus a sender
// that POSTs the result and unwraps the response. A reader who has learned
// `buildMintTokenBody`/`mintAccessToken` should recognise this immediately —
// `buildCommerceEventBody`/`recordCommerceEvent` is the same shape, applied
// to a discriminated union instead of a single flat request.
//
// ── Machine path only ─────────────────────────────────────────────────────
//
// `openapi/chat-api.yaml` documents two ways to write a commerce event:
// `POST /contacts/commerce-events` (this module — secret-key, the caller's
// own commerce backend, `customerId` resolves-or-creates a `Contact`) and
// `POST /contacts/{id}/commerce-events` (staff-token, a CRM admin correcting
// one contact's history by hand). This SDK holds only the secret key, so
// only the former is reachable here — the OpenAPI operation's own
// description says as much: "`ChatServerClient` gains only the machine-path
// method." `CommerceEventAdmin` and its per-variant `*Admin` schemas have no
// counterpart in this file for that reason, not by omission.
//
// ── Release-on-reject — read this before wiring up retries ────────────────
//
// A REJECTED event (`404 CART_NOT_FOUND` or `422 INVALID_CART_TRANSITION`)
// does NOT consume its `eventId`. The whole transaction — including the
// idempotency insert — rolls back, so retrying with the IDENTICAL `eventId`
// later is processed as a completely fresh attempt, never short-circuited as
// a replay. This is the intended recovery path for out-of-order arrival: a
// `cart.abandoned` that races ahead of the `cart.updated` which would have
// created its cart gets a `404` immediately, and the caller simply retries
// that same `eventId` once the earlier event has landed. Only an ACCEPTED
// event (`200`, `applied: true`) makes an `eventId` inert going forward —
// retrying THAT one replays `applied: false` with the original outcome, and
// the mutation is never re-applied.
//
// The practical rule: after ANY rejection, reuse the same `eventId`. Never
// mint a new one. `isRetryableContactsError` (`errors.ts`) tells you which
// rejections are worth an automatic retry versus which need a caller-side
// fix first — but the `eventId` itself is never the thing to change.

import type { HttpClient } from './http.js';
import { ChatApiError } from './errors.js';
import { unwrapEnvelope } from './wire.js';
import type {
  CommerceCartItem,
  CommerceEvent,
  CommerceEventResult,
  CommerceEventType,
} from './types.js';

// ── Client-side caps ─────────────────────────────────────────────────────
//
// Published in `openapi/chat-api.yaml`'s `CommerceCartItem`/`CartUpdatedEvent`
// schemas and enforced there with "reject, not clamp — a 501st entry is
// refused outright, never silently truncated." Mirrored here so a caller
// hits the same refusal locally, before a non-ASCII product catalog worth of
// JSON makes the round trip only to be turned away.
//
// Every OTHER per-field bound the schema states (`eventId`/`customerId`/
// `orderId`/`merchant`/`category`/`cartId` max lengths, `occurredAt`'s
// 5-minute future-clock-skew tolerance, `quantity`'s 1-100000 range,
// `value`/`unitPrice`'s `>= 0` minimum) is deliberately NOT duplicated here.
// This module validates PRESENCE and TYPE for every field (a builder that
// checked nothing would not deserve the name), plus the three caps below
// that were explicitly commissioned — it does not re-implement the entire
// schema. The server remains the authority on the rest, exactly as
// `tokens.ts`'s reserved-claims screen "does not make the server's check
// redundant" for the bounds it does not cover.
const MAX_ITEMS = 500;
const MAX_ITEM_NAME_LENGTH = 300;
const MAX_ITEM_SKU_LENGTH = 64;

/** Base fields every `CommerceEvent` variant carries (`CommerceEventBase`, types.ts). */
const BASE_KEYS = ['eventId', 'type', 'occurredAt', 'customerId'] as const;

/**
 * Keys each event type accepts IN ADDITION to {@link BASE_KEYS} — the
 * `.strict()` allowlist mirrored client-side, one entry per member of the
 * `CommerceEvent` discriminated union.
 *
 * This is what makes an unrecognised field fail HERE, naming the offending
 * key, instead of as the server's opaque `400 VALIDATION_ERROR` (the
 * `.strict()` schema rejects it identically, but says only "the request was
 * invalid" — it does not echo which key was unexpected).
 */
const VARIANT_KEYS: Readonly<Record<CommerceEventType, readonly string[]>> = {
  'order.placed': ['orderId', 'merchant', 'category', 'cartId', 'value'],
  'order.completed': ['orderId', 'value', 'merchant', 'category'],
  'order.cancelled': ['orderId'],
  'cart.updated': ['cartId', 'items'],
  'cart.abandoned': ['cartId'],
  'cart.converted': ['cartId', 'orderId'],
};

/**
 * Thrown when a `CommerceEvent` is malformed before it leaves this process —
 * an unrecognised field, a missing or mistyped required field, or a
 * client-side cap ({@link MAX_ITEMS}/{@link MAX_ITEM_NAME_LENGTH}/
 * {@link MAX_ITEM_SKU_LENGTH}) exceeded.
 *
 * Named separately from the server's `400 VALIDATION_ERROR` — carried as a
 * `ChatApiError` with `code: 'VALIDATION_ERROR'` — on purpose: this one never
 * reached the server at all, so it is never retryable-with-the-same-eventId
 * in the sense {@link isRetryableContactsError} (`errors.ts`) means (there is
 * no `eventId` consumption question when no request was sent), and a caller
 * catching it knows immediately, without inspecting a status code, that the
 * fix is in their own code.
 *
 * Carries only FIELD NAMES, chosen by the caller's own code, never field
 * VALUES — a cart's line-item names and a shopper's `customerId` are not
 * ours to put in a message that ends up in an error tracker.
 */
export class InvalidCommerceEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommerceEventError';
  }
}

function fail(message: string): never {
  throw new InvalidCommerceEventError(message);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(`${field} is required and must be a non-empty string`);
  }
  return value as string;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} is required and must be a finite number`);
  }
  return value as number;
}

/**
 * One `CommerceCartItem` → a validated, freshly-built item.
 *
 * `index` is for the error message only — it lets a caller with a 500-entry
 * cart find the one malformed line without a debugger.
 *
 * Deliberately does NOT reject unknown keys, unlike {@link buildCommerceEventBody}
 * itself. `CommerceCartItem` in `openapi/chat-api.yaml` has no
 * `additionalProperties: false` — unlike every `CommerceEvent` variant
 * schema, it is not `.strict()`. Rejecting an extra key here would be
 * STRICTER than the contract this function enforces, not merely an
 * ergonomic head start on it.
 */
function validateItem(item: unknown, index: number): CommerceCartItem {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    fail(`items[${index}] must be an object`);
  }
  const record = item as Record<string, unknown>;

  const name = requireNonEmptyString(record['name'], `items[${index}].name`);
  if (name.length > MAX_ITEM_NAME_LENGTH) {
    fail(
      `items[${index}].name must be at most ${MAX_ITEM_NAME_LENGTH} characters, received ${name.length}`,
    );
  }

  const quantity = requireFiniteNumber(record['quantity'], `items[${index}].quantity`);
  const unitPrice = requireFiniteNumber(record['unitPrice'], `items[${index}].unitPrice`);

  // `sku` has no `minLength` in the schema — unlike every other string field
  // in this file, an empty string is a legal (if useless) sku, so this
  // cannot reuse `requireNonEmptyString`.
  let sku: string | undefined;
  const rawSku = record['sku'];
  if (rawSku !== undefined) {
    if (typeof rawSku !== 'string') {
      fail(`items[${index}].sku must be a string`);
    }
    sku = rawSku;
    if (sku.length > MAX_ITEM_SKU_LENGTH) {
      fail(
        `items[${index}].sku must be at most ${MAX_ITEM_SKU_LENGTH} characters, received ${sku.length}`,
      );
    }
  }

  return {
    ...(sku === undefined ? {} : { sku }),
    name,
    quantity,
    unitPrice,
  };
}

function validateItems(value: unknown): readonly CommerceCartItem[] {
  if (!Array.isArray(value)) {
    fail('items is required and must be an array (use [] for an emptied-but-still-open cart)');
  }
  if (value.length > MAX_ITEMS) {
    fail(`items may contain at most ${MAX_ITEMS} entries, received ${value.length}`);
  }
  return value.map((item, index) => validateItem(item, index));
}

/**
 * Validate a {@link CommerceEvent} and flatten it into the wire body for
 * `POST /contacts/commerce-events`.
 *
 * Rebuilds the body field by field, mirroring `buildMintTokenBody`
 * (`tokens.ts`), rather than passing the input through: only fields this
 * function has itself validated ever reach the wire, so a value that merely
 * happened to survive the unknown-key check by coincidence cannot ride
 * along unexamined.
 *
 * @throws {InvalidCommerceEventError} if the event is malformed — see the
 *   class doc for exactly what that covers and does not.
 */
export function buildCommerceEventBody(event: CommerceEvent): Record<string, unknown> {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    fail('a commerce event object is required');
  }
  // Through `unknown` first: `CommerceEvent`'s member interfaces have no
  // index signature, so none of them is directly comparable to
  // `Record<string, unknown>` — the whole point of this cast is to read a
  // value the compiler otherwise guarantees is well-formed but that, at
  // runtime, has not actually been checked yet.
  const body = event as unknown as Record<string, unknown>;

  const rawType = body['type'];
  if (typeof rawType !== 'string' || !Object.prototype.hasOwnProperty.call(VARIANT_KEYS, rawType)) {
    fail(
      `type must be one of ${Object.keys(VARIANT_KEYS).join(', ')}, received ${JSON.stringify(rawType)}`,
    );
  }
  const type = rawType as CommerceEventType;

  // Strict, mirroring the server's `.strict()` schema for this variant — see
  // VARIANT_KEYS. Checked before any field is read, so a typo'd key is
  // reported on its own rather than buried under an unrelated "missing
  // field" from a required key the typo silently failed to satisfy.
  const allowedKeys = new Set<string>([...BASE_KEYS, ...VARIANT_KEYS[type]]);
  const unknownKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    fail(
      `unrecognised field(s) for a "${type}" event: ${unknownKeys.join(', ')}. ` +
        'The server schema for this event type is .strict() and rejects these the same way; ' +
        "catching it here names the offending field, which the server's 400 does not.",
    );
  }

  const eventId = requireNonEmptyString(body['eventId'], 'eventId');
  const occurredAt = requireNonEmptyString(body['occurredAt'], 'occurredAt');
  const customerId = requireNonEmptyString(body['customerId'], 'customerId');

  const out: Record<string, unknown> = { eventId, type, occurredAt, customerId };

  switch (type) {
    case 'order.placed': {
      out['orderId'] = requireNonEmptyString(body['orderId'], 'orderId');
      if (body['merchant'] !== undefined) {
        out['merchant'] = requireNonEmptyString(body['merchant'], 'merchant');
      }
      if (body['category'] !== undefined) {
        out['category'] = requireNonEmptyString(body['category'], 'category');
      }
      if (body['cartId'] !== undefined) {
        out['cartId'] = requireNonEmptyString(body['cartId'], 'cartId');
      }
      if (body['value'] !== undefined) {
        out['value'] = requireFiniteNumber(body['value'], 'value');
      }
      break;
    }
    case 'order.completed': {
      out['orderId'] = requireNonEmptyString(body['orderId'], 'orderId');
      out['value'] = requireFiniteNumber(body['value'], 'value');
      if (body['merchant'] !== undefined) {
        out['merchant'] = requireNonEmptyString(body['merchant'], 'merchant');
      }
      if (body['category'] !== undefined) {
        out['category'] = requireNonEmptyString(body['category'], 'category');
      }
      break;
    }
    case 'order.cancelled': {
      out['orderId'] = requireNonEmptyString(body['orderId'], 'orderId');
      break;
    }
    case 'cart.updated': {
      out['cartId'] = requireNonEmptyString(body['cartId'], 'cartId');
      out['items'] = validateItems(body['items']);
      break;
    }
    case 'cart.abandoned': {
      out['cartId'] = requireNonEmptyString(body['cartId'], 'cartId');
      break;
    }
    case 'cart.converted': {
      out['cartId'] = requireNonEmptyString(body['cartId'], 'cartId');
      if (body['orderId'] !== undefined) {
        out['orderId'] = requireNonEmptyString(body['orderId'], 'orderId');
      }
      break;
    }
  }

  return out;
}

/** The six event-type literals, as a runtime set — for validating a decoded response. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<CommerceEventType>([
  'order.placed',
  'order.completed',
  'order.cancelled',
  'cart.updated',
  'cart.abandoned',
  'cart.converted',
]);

const ROUTE = 'POST /contacts/commerce-events';

/**
 * `status: 200` is honest — the transport succeeded and the server reported
 * no error, the body just is not the documented shape. Mirrors `wire.ts`'s
 * own `malformed()` byte for byte (same code, status, and `retryable:
 * false`); not imported from there because it is not exported, and this
 * module's scope does not extend to changing that.
 */
function malformedResponse(detail: string): ChatApiError {
  return new ChatApiError({
    code: 'MALFORMED_RESPONSE',
    // Nothing from the body is interpolated — see wire.ts's identical note.
    message: `unexpected response shape: ${detail}`,
    status: 200,
    retryable: false,
  });
}

/**
 * The `{ success: true, data }` envelope's `data` → a validated
 * {@link CommerceEventResult}.
 *
 * Narrowed field by field rather than cast, matching `mintAccessToken`'s own
 * reasoning (`tokens.ts`): a proxy or gateway returning a 200 with an
 * unexpected body must not hand the caller a `CommerceEventResult` with
 * `undefined` where `contactId` should be — that surfaces as a confusing
 * failure far from its cause instead of a clear one here.
 */
function toCommerceEventResult(body: unknown): CommerceEventResult {
  const data = unwrapEnvelope<{
    eventId?: unknown;
    type?: unknown;
    contactId?: unknown;
    applied?: unknown;
  }>(body, ROUTE);

  const { eventId, type, contactId, applied } = data;

  if (typeof eventId !== 'string' || eventId === '') {
    throw malformedResponse(`${ROUTE} returned a result without a valid eventId`);
  }
  if (typeof type !== 'string' || !KNOWN_EVENT_TYPES.has(type)) {
    throw malformedResponse(`${ROUTE} returned a result with an unrecognised type`);
  }
  if (typeof contactId !== 'string' || contactId === '') {
    throw malformedResponse(`${ROUTE} returned a result without a valid contactId`);
  }
  if (typeof applied !== 'boolean') {
    throw malformedResponse(`${ROUTE} returned a result without a valid applied flag`);
  }

  return { eventId, type: type as CommerceEventType, contactId, applied };
}

/**
 * Record one order or cart event — `POST /contacts/commerce-events`.
 *
 * **Read the release-on-reject note at the top of this file before wiring up
 * retry logic.** In short: after a `404`/`422` rejection, retry with the
 * SAME `eventId` — it was never consumed. Never mint a new one.
 *
 * Idempotent on `eventId` for an ACCEPTED event: calling this again with the
 * same `eventId` after a `200`/`applied: true` returns `200`/`applied: false`
 * with the original outcome, re-read rather than recomputed — the mutation
 * is never re-applied.
 *
 * @throws {InvalidCommerceEventError} if `event` is malformed locally.
 *   Nothing is sent to the server.
 * @throws {ChatApiError} if the server rejects it. Branch on `.code` — a
 *   {@link ContactsErrorCode} (`errors.ts`) — or call
 *   {@link isRetryableContactsError} on the caught error to decide whether
 *   this is worth an automatic retry with the same `eventId` or needs a
 *   caller-side fix first.
 * @throws {ChatTransportError} if the request never reached the server.
 *   Always safe — and correct — to retry with the same `eventId`; nothing
 *   was applied.
 */
export async function recordCommerceEvent(
  http: HttpClient,
  event: CommerceEvent,
): Promise<CommerceEventResult> {
  const body = buildCommerceEventBody(event);
  const response = await http.request<unknown>('POST', '/contacts/commerce-events', { body });
  return toCommerceEventResult(response);
}
