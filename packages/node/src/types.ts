// Domain shapes, transcribed from `openapi/chat-api.yaml`.
//
// ── Why these are duplicated rather than imported ────────────────────────
//
// `@dhaam-ccrm/core` already declares most of these. Importing them from
// there would create a dependency edge from the package that HOLDS THE SECRET
// KEY to the package that ships in a browser bundle — and edges are followed
// in both directions by bundlers, by `npm ls`, and by anyone reading the
// dependency graph to decide what is safe to include client-side. That edge is
// exactly the mechanism by which a secret key ends up in a bundle (§14), so
// the duplication is the deliberate, cheaper mistake.
//
// These are structural types with no runtime footprint: they disappear at
// compile time, so the duplication costs nothing at run time and cannot drift
// into divergent BEHAVIOUR — only into divergent documentation, which the
// shared OpenAPI document is the cure for. T19 generates Python and Go clients
// from that same document; this file is the hand-written TypeScript analogue.

/** PRD §12.1, D4. The full six-value set — v1 modeled only four. */
export type ChatStatus =
  | 'OPEN'
  | 'WAITING_FOR_AGENT'
  | 'ASSIGNED'
  | 'CLOSED'
  | 'RESOLVED'
  | 'ON_HOLD';

export type ChatMode = 'BOT' | 'HUMAN';

export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';

/**
 * The full seven-value set, matching the service's `MessageType` enum exactly
 * (`shared/constants/enums.ts:36-44`) — and `@dhaam-ccrm/core`'s union, which
 * also carries all seven.
 *
 * `TYPING` is in the enum but is never persisted: it exists for the WebSocket's
 * ephemeral typing frame, and no code path writes it to a message row. It is
 * listed anyway so this union and the integer table in `wire.ts` mirror the one
 * upstream file entry-for-entry. A table with a hole in it is how the two drift.
 */
export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TYPING';

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

/** Why a session entered CLOSED (PRD §12.5). */
export type CloseReason = 'MANUAL' | 'SWITCHED';

export interface Attachment {
  readonly url: string;
  readonly fileName: string;
  readonly mimeType: string;
  /** Size in bytes. */
  readonly size: number;
  readonly mediaType: MediaType;
}

export interface Profile {
  /** Correlation key — presence frames and read watermarks are both keyed by this. */
  readonly participantId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

/** A linked CRM/support ticket. */
export interface Ticket {
  readonly id: string;
  readonly url?: string | null;
}

export interface MessageReplyPreview {
  readonly id: string;
  readonly content: string;
  readonly senderType: SenderType;
}

export interface ChatMessage {
  /**
   * Opaque message identifier, and the pagination cursor. Under D1 this is
   * the client-generated ULID for customer-sent messages and never changes
   * after creation — there is no server-assigned id swapped in later, which
   * is what makes it safe to use as a `before` cursor.
   */
  readonly id: string;
  readonly chatSessionId: string;
  readonly senderType: SenderType;
  readonly senderId?: string | null;
  readonly senderName?: string | null;
  readonly content: string;
  readonly messageType: MessageType;
  /** The one canonical timestamp field (D4) — v1 aliased this across four names. */
  readonly createdAt: string;
  /** The ONE canonical location for attachment data (D4). Never `metadata.attachment`. */
  readonly attachment?: Attachment | null;
  readonly replyToMessageId?: string | null;
  readonly replyToMessage?: MessageReplyPreview | null;
  readonly metadata?: Record<string, unknown>;
}

export interface ChatSession {
  readonly id: string;
  readonly status: ChatStatus;
  readonly mode: ChatMode;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly assignedAgent: Profile | null;
  readonly customer: Profile | null;
  readonly ticket: Ticket | null;
}

export interface ChatSessionSummary {
  readonly id: string;
  readonly status: ChatStatus;
  readonly mode: ChatMode;
  readonly createdAt: string;
  readonly lastMessageAt?: string | null;
  readonly lastMessagePreview?: string;
  readonly unreadCount?: number;
}

/** `MessagePage` — the cursor-paginated shape the iterators in `pagination.ts` walk. */
export interface MessagePage {
  /** Ascending chronological order (oldest first), so a page prepends without re-sorting. */
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
}

/** `SessionSummaryPage`. See `pagination.ts` for why this one cannot actually be paged. */
export interface SessionSummaryPage {
  readonly sessions: readonly ChatSessionSummary[];
  readonly hasMore: boolean;
}

/** Request body for `POST /tokens`. */
export interface MintTokenRequest {
  /**
   * Stable identifier for the end user in the customer's own system. Becomes
   * the token's `sub` claim and the resulting session's customer identity.
   */
  readonly userId: string;
  readonly name?: string;
  readonly email?: string;
  /**
   * Arbitrary customer-defined claims embedded in the minted JWT (e.g. plan
   * tier, account region).
   *
   * Modeled as an explicit nested bag rather than as `additionalProperties`
   * spread across the top level, even though the wire format is flat. A flat
   * type would make `userId` and a claim named `userId` indistinguishable at
   * the call site, and would silently accept a typo'd `usrId` as a custom
   * claim — minting a token whose `sub` is not the user the caller meant.
   * The flattening happens once, in `tokens.ts`, where the reserved-name
   * check sits next to it.
   */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Response body for `POST /tokens`. */
export interface MintTokenResponse {
  /** Short-lived JWT. Relay to the browser and pass to the SDK via `getToken()`. */
  readonly accessToken: string;
  /** Token lifetime in seconds from the moment of minting. */
  readonly expiresIn: number;
}

// ── Commerce events (machine path — POST /contacts/commerce-events) ────────
//
// `@dhaam-ccrm/node`'s other half of the event-shaped world `WebhookEvent`
// (`webhooks.ts`) already models. `WebhookEvent` is chat-service pushing
// events TO the customer's backend; `CommerceEvent` is the customer's own
// commerce backend pushing order/cart activity INTO chat-service, via
// `ChatServerClient.recordCommerceEvent()` (`commerce.ts`). Same
// discriminated-union-on-`type` shape, deliberately — read this as a
// sibling of `WebhookEvent`, not a second dialect. Mirrors OpenAPI
// `CommerceEvent` (`openapi/chat-api.yaml`) field-for-field.
//
// Only the MACHINE path (`POST /contacts/commerce-events`, secret-key auth)
// is modeled here. The admin/CRM counterpart (`POST
// /contacts/{id}/commerce-events`, `CommerceEventAdmin` in the OpenAPI doc —
// field-for-field identical minus `customerId`) is a staff-token,
// CRM-console operation `@dhaam-ccrm/node` never calls (the OpenAPI
// operation's own description: "Not exposed via `@dhaam-ccrm/node` ...
// `ChatServerClient` gains only the machine-path method") — deliberately
// not duplicated here.

/**
 * The six-member event-type catalog `CommerceEvent` discriminates on.
 *
 * A wire STRING, not an integer enum — the one place this file departs from
 * this codebase's usual "enums are integers on the wire" rule (see
 * `packages/rest/src/projection.ts`'s integer-enum tables for that rule
 * applied elsewhere, and `ContactCartStatus` below for the same rule applied
 * correctly in this file). `type` here is an open, additive tag for "a kind
 * of thing that happened" — the same category `WebhookEvent['type']`
 * already is (`message.created`, `session.updated`, ...) — not
 * closed-cardinality STATE. New event types are additive, and nothing in
 * this SDK switches on it as a fixed-size set.
 */
export type CommerceEventType =
  | 'order.placed'
  | 'order.completed'
  | 'order.cancelled'
  | 'cart.updated'
  | 'cart.abandoned'
  | 'cart.converted';

/** Fields shared by every `CommerceEvent` variant. */
interface CommerceEventBase<TType extends CommerceEventType> {
  /**
   * Caller-supplied idempotency key for this event, 1–200 chars.
   *
   * **Release-on-reject.** A REJECTED event (`404 CART_NOT_FOUND` or
   * `422 INVALID_CART_TRANSITION`) does NOT consume this id — the entire
   * transaction, including the idempotency row, rolls back. Retry the
   * identical request with the SAME `eventId`; it is processed as a
   * completely fresh attempt, never short-circuited as a replay. This is
   * the intended recovery path for out-of-order arrival (e.g. a
   * `cart.abandoned` racing ahead of the `cart.updated` that would have
   * created its cart). Only an event that was ACCEPTED and applied
   * (`200`, `applied: true`) makes this id inert going forward — retrying
   * THAT id returns `200` again with `applied: false` and the original,
   * re-read outcome; the mutation is never re-applied. Do not mint a new
   * `eventId` after a `404`/`422` — reuse the same one once the underlying
   * condition (e.g. the missing cart) is resolved.
   */
  readonly eventId: string;
  readonly type: TType;
  /**
   * When this actually happened, ISO-8601 UTC — not when the caller calls
   * this endpoint. Rejected with `400` if more than 5 minutes in the
   * future (clock-skew tolerance). No lower bound; a backdated admin
   * correction is legitimate.
   */
  readonly occurredAt: string;
  /**
   * The caller's own identifier for the shopper — the same value passed as
   * `userId` to `mintToken()`. The server resolves-or-creates a `Contact`
   * for `(tenantId, externalId = customerId)`. The ONLY field that may bind
   * an event to a contact.
   */
  readonly customerId: string;
}

/** One line item inside a `CartUpdatedEvent` snapshot. */
export interface CommerceCartItem {
  readonly sku?: string;
  readonly name: string;
  /** 1–100000. */
  readonly quantity: number;
  /** >= 0. */
  readonly unitPrice: number;
}

/**
 * An order was submitted; fulfillment/payment outcome not yet known.
 * Increments `totalOrders`. `value`, if supplied, is audit-only — never
 * applied to `totalSpend` (only `OrderCompletedEvent.value` does that). If
 * `cartId` matches a `LIVE` cart, that cart is transitioned to `CONVERTED`
 * as a side effect, identical to an explicit `CartConvertedEvent` for the
 * same `cartId`. A `cartId` with no matching row is a silent no-op, not a
 * `404` — only a `cart.*` event 404s on an unknown `cartId`.
 */
export interface OrderPlacedEvent extends CommerceEventBase<'order.placed'> {
  readonly orderId: string;
  readonly merchant?: string;
  readonly category?: string;
  /** If this order completed a cart checkout, that cart's id — triggers the `CONVERTED` side effect above. */
  readonly cartId?: string;
  /** Audit-only. Never applied to `totalSpend`. */
  readonly value?: number;
}

/**
 * An order finished successfully (paid, fulfilled). Increments
 * `completedOrders`; adds `value` to `totalSpend`; recomputes
 * `averageOrderValue`. The only event type whose `value` moves an
 * aggregate.
 */
export interface OrderCompletedEvent extends CommerceEventBase<'order.completed'> {
  readonly orderId: string;
  /** Applied to `totalSpend` and folded into `averageOrderValue`. */
  readonly value: number;
  readonly merchant?: string;
  readonly category?: string;
}

/**
 * An order was cancelled or failed. Increments `cancelledOrders` only —
 * deliberately does NOT touch `lastOrderMerchant`/`lastOrderCategory`/
 * `lastOrderAt`, so "last order" always names a placed-or-completed order,
 * never a cancelled one.
 */
export interface OrderCancelledEvent extends CommerceEventBase<'order.cancelled'> {
  readonly orderId: string;
}

/**
 * The current, LIVE state of one cart — a FULL REPLACE of that cart's
 * contents, not a delta. `items` may be empty: an emptied-but-still-open
 * cart is a valid `LIVE` state with 0 items, distinct from `ABANDONED`. A
 * stale arrival (`occurredAt` older than the cart's current snapshot) is
 * silently ignored (`applied: true`, no state change) — not a caller
 * error.
 */
export interface CartUpdatedEvent extends CommerceEventBase<'cart.updated'> {
  /** The merchant's own cart identifier. Unique per CONTACT, not globally. */
  readonly cartId: string;
  /**
   * Full replacement of the cart's line items. 0–500 entries; a 501st is
   * rejected with `400`, never silently truncated.
   */
  readonly items: readonly CommerceCartItem[];
}

/**
 * A specific cart is no longer being actively shopped. The row must exist
 * (`404 CART_NOT_FOUND` otherwise) and be `LIVE`; transitions to
 * `ABANDONED`. Already `ABANDONED` is a no-op (`200`, `applied: true`).
 * Already `CONVERTED` is `422 INVALID_CART_TRANSITION` — `CONVERTED` is
 * terminal, and this is the only illegal-transition code; there is no
 * separate `CART_ALREADY_CONVERTED`.
 */
export interface CartAbandonedEvent extends CommerceEventBase<'cart.abandoned'> {
  readonly cartId: string;
}

/**
 * A specific cart resulted in a checkout. Also triggered as a side effect
 * of an `OrderPlacedEvent` carrying the same `cartId`. The row must exist
 * and be `LIVE` or `ABANDONED`; transitions to `CONVERTED`. Already
 * `CONVERTED` is a no-op (`200`, `applied: true`, no state change) — the
 * terminal-transition rejection above only fires on an attempt to move a
 * `CONVERTED` cart to `ABANDONED`, never on re-converting one. `404
 * CART_NOT_FOUND` if the row never existed.
 */
export interface CartConvertedEvent extends CommerceEventBase<'cart.converted'> {
  readonly cartId: string;
  /** Correlation only — never applied to any aggregate. */
  readonly orderId?: string;
}

/**
 * Discriminated union on `type`, one of the six order/cart events —
 * request body for `ChatServerClient.recordCommerceEvent()`
 * (`POST /contacts/commerce-events`, machine path, secret-key auth).
 * Mirrors OpenAPI `CommerceEvent` field-for-field.
 */
export type CommerceEvent =
  | OrderPlacedEvent
  | OrderCompletedEvent
  | OrderCancelledEvent
  | CartUpdatedEvent
  | CartAbandonedEvent
  | CartConvertedEvent;

/**
 * Response `data` for `recordCommerceEvent()` — first application and
 * replay alike (`200` in both cases; see `applied`).
 */
export interface CommerceEventResult {
  readonly eventId: string;
  readonly type: CommerceEventType;
  /**
   * The resolved contact's opaque id — the same identifier a
   * `GET /contacts/:id` response returns as `id`. Never the internal
   * database primary key.
   */
  readonly contactId: string;
  /**
   * `false` ONLY when this `eventId` had already been accepted and
   * processed before — a replay; the mutation is not re-applied, and this
   * result is read back from the original stored event. `true` on first
   * acceptance AND on an accepted no-op (e.g. `cart.abandoned` repeated
   * against an already-`ABANDONED` cart, or a stale out-of-order
   * `cart.updated`). Distinguishes "have I seen this `eventId` before,"
   * not "did this event change any state."
   */
  readonly applied: boolean;
}

// ── Cart segmentation (admin/staff-token read — GET /contacts/carts) ───────
//
// Not currently wrapped by any `ChatServerClient` method — that endpoint
// requires a staff token, not the secret key `@dhaam-ccrm/node` holds, and
// is a CRM-console read, not part of the merchant-facing SDK surface (same
// class of exclusion as the admin write path above). `ContactCartRow` is
// still declared here because it shares `CommerceCartItem` with the
// machine-path write above, and is the shape a caller decoding that
// response — or a future admin-facing package — needs.

/**
 * `ContactCartStatus`: 1=LIVE, 2=ABANDONED, 3=CONVERTED
 * (`shared/constants/enums.ts`).
 *
 * An INTEGER on the wire — unlike `CommerceEventType` above, this IS
 * genuine closed-cardinality STATE, so it follows this codebase's usual
 * "enums are integers on the wire" rule (see
 * `packages/rest/src/projection.ts`'s integer-enum tables for the same rule
 * applied to `ChatStatus`/`SenderType`/etc.).
 *
 * **Deliberately NOT the same shape as the `status` QUERY parameter** on
 * `GET /contacts/carts`, which is the lowercase string `'live' |
 * 'abandoned' | 'converted'`. This is not a bug or an inconsistency to
 * reconcile: the query parameter is a human-typed filter value, while this
 * is the established typed-enum wire contract every other Contacts CRM
 * field (`GET /contacts`'s `status`/`userType`/`channel`) already uses. A
 * caller building a request and a caller decoding a response are working
 * with two intentionally different vocabularies for the same concept — do
 * not "fix" one to match the other.
 */
export type ContactCartStatus = 1 | 2 | 3;

/**
 * One row from `GET /contacts/carts` (`contact_carts` table) — the
 * cart-segmentation read used for win-back campaigns.
 *
 * `Contact.itemsInCart`/`cartValue` (not modeled in this package) mirror
 * only the contact's single most-recently-touched `LIVE` row; a contact can
 * have more than one `LIVE` row at once (two browser tabs, a merged guest
 * cart), and this is the only shape that exposes the rest.
 */
export interface ContactCartRow {
  /** Opaque contact id — same value as `GET /contacts/:id`'s `id`. */
  readonly contactId: string;
  /** The contact's customer-facing reference. */
  readonly contactRef: string;
  /** The merchant's own cart identifier, as supplied on `cart.*` events. Unique per contact, not globally. */
  readonly cartId: string;
  readonly status: ContactCartStatus;
  /** Sum of `quantity` across the cart's line items as of the most recently applied `cart.updated`. */
  readonly itemsCount: number;
  /** Sum of `unitPrice × quantity` across the cart's line items. */
  readonly cartValue: number;
  /** Line-item snapshot as of the most recently applied `cart.updated`. */
  readonly items: readonly CommerceCartItem[];
  readonly abandonedAt: string | null;
  readonly convertedAt: string | null;
  readonly updatedAt: string;
}
