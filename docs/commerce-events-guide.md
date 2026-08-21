# Commerce Events Integration Guide

Record order and cart activity from your e-commerce backend to populate contact records with commerce data, enabling agents to provide informed customer service based on purchase history, cart status, and customer lifetime value.

## Table of Contents

1. [Overview](#overview)
2. [The Problem Commerce Events Solve](#the-problem-commerce-events-solve)
3. [Event Types](#event-types)
4. [The Eight Properties](#the-eight-properties)
5. [Setup](#setup)
6. [Order Lifecycle](#order-lifecycle)
7. [Cart Lifecycle](#cart-lifecycle)
8. [Idempotency and Release-on-Reject](#idempotency-and-release-on-reject)
9. [Error Handling](#error-handling)
10. [Caps and Constraints](#caps-and-constraints)
11. [Worked Example](#worked-example)
12. [API Reference](#api-reference)

---

## Overview

Your e-commerce backend already knows when a customer places an order, completes a purchase, or abandons their shopping cart. This knowledge — currently invisible to the chat service — shapes how agents interact: "thanks for the order" lands differently in tone if you know it was a customer's first purchase versus their tenth.

Commerce events bridge this gap. Your backend posts events to `POST /contacts/commerce-events` using your tenant's secret key. The chat service ingests them and derives eight aggregate properties on each contact: total orders, completed orders, cancelled orders, total spend, average order value, items in cart, cart value, and timestamps of last order activity.

Agents see this data in the Contacts CRM, and the contact's filter engine can segment customers by it: "cart value > $500", "completed orders ≥ 5", etc.

---

## The Problem Commerce Events Solve

The `Contact` record already carries thirteen commerce columns — `totalOrders`, `completedOrders`, `cancelledOrders`, `totalSpend`, `averageOrderValue`, `itemsInCart`, `cartValue`, `lastOrderAt`, `lastOrderMerchant`, `lastOrderCategory`, plus others. But **nothing writes these fields** today; they live at their database defaults.

The knowledge exists on your commerce backend — your order pipeline knows when a checkout completes, your cart service tracks what's in it — but there's no channel to tell chat-service. This feature opens that channel: a machine-to-machine event feed from your own backend, processed server-side to continuously update the contact record.

It also adds a capability the existing schema cannot express: **abandoned-cart data**. The `itemsInCart` and `cartValue` fields on Contact are snapshots of what the customer is holding *right now*. To build a win-back audience ("send me all customers with $200+ in abandoned carts"), you need history — which cart, when it was abandoned, what was in it. That requires a new table and a new query surface, both included here.

---

## Event Types

Six event types form two independent lifecycles: **orders** and **carts**. Each is a separate HTTP call.

### Order Events

| Type | Meaning | Mutates |
|---|---|---|
| `order.placed` | Checkout submitted (payment/fulfillment outcome unknown) | `totalOrders +1`, `lastOrderAt` / `lastOrderMerchant` / `lastOrderCategory` |
| `order.completed` | Order successfully fulfilled | `completedOrders +1`, `totalSpend +=`, `averageOrderValue` recomputed |
| `order.cancelled` | Cancelled or failed | `cancelledOrders +1` only (deliberately does NOT update `lastOrder*`) |

### Cart Events

| Type | Meaning | Mutates |
|---|---|---|
| `cart.updated` | Snapshot of cart contents (full replace, not delta) | `itemsInCart`, `cartValue` recomputed from the contact's primary live cart |
| `cart.abandoned` | Customer left without buying | Cart marked `ABANDONED` in history; `itemsInCart`/`cartValue` recomputed if this cart was the primary one |
| `cart.converted` | Checkout completed | Cart marked `CONVERTED` (terminal); side effect of `order.placed` with a matching `cartId` |

---

## The Eight Properties

The server derives these eight properties from events you send. You send events, the server computes aggregates.

| Property | Source | Computation | Notes |
|---|---|---|---|
| **Total orders** | `order.placed` | `+1` per accepted event | Independent count — a merchant can skip `order.placed` and go straight to `order.completed` |
| **Completed orders** | `order.completed` | `+1` per accepted event | The only tally that feeds `totalSpend` and `averageOrderValue` |
| **Cancelled orders** | `order.cancelled` | `+1` per accepted event | Never updates `lastOrder*` fields; cancellations aren't recorded as "last order" |
| **Total spend** | `order.completed.value` | `+=` the order's `value` field | Only `order.completed` touches this; `order.placed.value` is audit-only |
| **Average order value** | `totalSpend / completedOrders` | Recomputed in transaction | Computed as `totalSpend / completedOrders`, rounded HALF_UP to 2 decimal places. When `completedOrders = 0`, result is `0` (no error) |
| **Items in cart** | `cart.updated`, `cart.abandoned`, `cart.converted` | `∑ quantity` from contact's primary `LIVE` cart | A contact can hold multiple `LIVE` carts (two browser tabs); `itemsInCart` reflects the most-recently-touched one |
| **Cart value** | `cart.updated`, `cart.abandoned`, `cart.converted` | `∑ (unitPrice × quantity)` from primary `LIVE` cart | Updated alongside `itemsInCart` from the same cart |
| **Last order at / merchant / category** | `order.placed`, `order.completed` | Latest-wins by `occurredAt` | Set only if the event's `occurredAt` is newer than the stored `lastOrderAt` and the field was supplied in the event |

**Key rule on `lastOrder*` fields:** They are updated by both `order.placed` and `order.completed`, but only if the event's `occurredAt` timestamp is newer than the contact's current `lastOrderAt`. This means if a completed order arrives after a placed order, and the placed order happened later in time, the `lastOrderAt` stays on the placed order. Latest-wins always uses the event timestamp, never server receive-time.

---

## Setup

### TypeScript

```ts
import { ChatServerClient } from '@dhaam-ccrm/node';

const chat = new ChatServerClient({
  apiUrl: process.env.CHAT_API_URL!,      // origin only: https://chat.example.com
  secretKey: process.env.CHAT_SECRET_KEY!, // dhk_live_… or dhk_test_…
});
```

### Go

```go
import "github.com/dhaamai/chat-sdk/clients/go/commerce"

client, err := commerce.New(
  "https://chat.example.com",      // origin
  os.Getenv("CHAT_SECRET_KEY"),    // dhk_live_… or dhk_test_…
)
if err != nil {
  return err
}
```

**Never log your secret key.** Both SDKs redact it from their string representations.

---

## Order Lifecycle

Orders move through three states: **placed**, **completed**, or **cancelled**. Each is a separate event.

### TypeScript

```ts
// Step 1: order placed — checkout submitted
await chat.recordCommerceEvent({
  eventId: 'evt_order_9f2a1e',  // Your idempotency key
  type: 'order.placed',
  customerId: 'cust_5847',      // YOUR identifier for the shopper
  occurredAt: new Date().toISOString(),
  orderId: 'ord_5591',
  value: 84.50,                 // Optional, audit-only (not applied to totalSpend)
  merchant: 'Nike',             // Optional
  category: 'Footwear',         // Optional
  cartId: 'cart_abc123',        // Optional: triggers LIVE → CONVERTED for this cart
});

// Step 2: order completed — shipped and confirmed
await chat.recordCommerceEvent({
  eventId: 'evt_order_9f2a1f',
  type: 'order.completed',
  customerId: 'cust_5847',
  occurredAt: new Date().toISOString(),
  orderId: 'ord_5591',           // Same orderId as placed
  value: 84.50,                  // Required here; drives totalSpend and averageOrderValue
  merchant: 'Nike',              // Optional
  category: 'Footwear',          // Optional
});

// Step 3 (optional): order cancelled — refunded or never shipped
await chat.recordCommerceEvent({
  eventId: 'evt_order_9f2a20',
  type: 'order.cancelled',
  customerId: 'cust_5847',
  occurredAt: new Date().toISOString(),
  orderId: 'ord_5591',
});
```

### Go

```go
import (
  "context"
  "github.com/dhaamai/chat-sdk/clients/go/commerce"
)

// Step 1: order placed
result, err := client.RecordCommerceEvent(ctx, commerce.OrderPlaced{
  EventID:    "evt_order_9f2a1e",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  OrderID:    "ord_5591",
  Value:      commerce.Float64(84.50), // Optional
  Merchant:   "Nike",                  // Optional
  Category:   "Footwear",              // Optional
  CartID:     "cart_abc123",           // Optional
})
if err != nil {
  return err
}

// Step 2: order completed
result, err = client.RecordCommerceEvent(ctx, commerce.OrderCompleted{
  EventID:    "evt_order_9f2a1f",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  OrderID:    "ord_5591",
  Value:      84.50,  // Required
  Merchant:   "Nike",
  Category:   "Footwear",
})

// Step 3: order cancelled (optional)
_, err = client.RecordCommerceEvent(ctx, commerce.OrderCancelled{
  EventID:    "evt_order_9f2a20",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  OrderID:    "ord_5591",
})
```

---

## Cart Lifecycle

Carts have three states: **LIVE** (actively shopped), **ABANDONED** (left behind), and **CONVERTED** (checked out, terminal).

### TypeScript

```ts
// Step 1: cart updated — customer modified cart contents
await chat.recordCommerceEvent({
  eventId: 'evt_cart_001',
  type: 'cart.updated',
  customerId: 'cust_5847',
  occurredAt: new Date().toISOString(),
  cartId: 'cart_abc123',
  items: [
    {
      name: 'Wireless Headphones',
      quantity: 1,
      unitPrice: 79.99,
      sku: 'WH-1000XM4',        // Optional
    },
    {
      name: 'Audio Cable',
      quantity: 2,
      unitPrice: 12.99,
      // sku omitted
    },
  ],
});

// Step 2a: cart abandoned — customer left without checkout
await chat.recordCommerceEvent({
  eventId: 'evt_cart_002',
  type: 'cart.abandoned',
  customerId: 'cust_5847',
  occurredAt: new Date().toISOString(),
  cartId: 'cart_abc123',
});

// Step 2b (alternative): cart converted — customer checked out
// This can also be triggered as a side effect of order.placed with a cartId
await chat.recordCommerceEvent({
  eventId: 'evt_cart_003',
  type: 'cart.converted',
  customerId: 'cust_5847',
  occurredAt: new Date().toISOString(),
  cartId: 'cart_abc123',
  orderId: 'ord_5591',         // Optional: ties cart to resulting order
});
```

### Go

```go
// Step 1: cart updated
items := []commerce.Item{
  {
    Name:      "Wireless Headphones",
    Quantity:  1,
    UnitPrice: 79.99,
    SKU:       "WH-1000XM4",
  },
  {
    Name:      "Audio Cable",
    Quantity:  2,
    UnitPrice: 12.99,
    // SKU omitted
  },
}

_, err := client.RecordCommerceEvent(ctx, commerce.CartUpdated{
  EventID:    "evt_cart_001",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  CartID:     "cart_abc123",
  Items:      items,
})

// Step 2a: cart abandoned
_, err = client.RecordCommerceEvent(ctx, commerce.CartAbandoned{
  EventID:    "evt_cart_002",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  CartID:     "cart_abc123",
})

// Step 2b (alternative): cart converted
_, err = client.RecordCommerceEvent(ctx, commerce.CartConverted{
  EventID:    "evt_cart_003",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  CartID:     "cart_abc123",
  OrderID:    "ord_5591",  // Optional
})
```

### Cart State Machine

```
        ┌─────────────────────────────────────────┐
        │            LIVE (actively shopped)      │
        │  (created by first cart.updated)        │
        └─────────────────────────────────────────┘
               │                              │
               │ cart.abandoned               │ cart.converted
               │ (cart.updated races past)    │ (or order.placed
               │ returns 404 and needs retry  │  with this cartId)
               │                              │
               ▼                              ▼
        ┌─────────────────────┐       ┌──────────────────────┐
        │    ABANDONED        │       │    CONVERTED         │
        │ (win-back eligible) │       │ (TERMINAL — no move) │
        └─────────────────────┘       └──────────────────────┘
               │
               │ cart.converted (customer returns)
               │ (ABANDONED → CONVERTED is legal)
               │
               └──────────────────────┐
                                      ▼
                              ┌──────────────────────┐
                              │    CONVERTED         │
                              │ (TERMINAL — no move) │
                              └──────────────────────┘
```

**Important:** Once a cart is `CONVERTED`, it is terminal. Any further `cart.updated` or `cart.abandoned` for that cart will be rejected with `422 INVALID_CART_TRANSITION`. The exception is re-converting an already-converted cart, which is a no-op (`200`, `applied: true`, no state change). An `ABANDONED` cart **can** transition to `CONVERTED` (customer came back and checked out).

---

## Idempotency and Release-on-Reject

**This is the single most important section. Getting this wrong costs production incidents.**

### How Idempotency Works

Every event carries an `eventId` — your idempotency key. The server deduplicates on it: if two requests arrive with the same `eventId`, the second one never re-applies the mutation; it returns `200` with `applied: false` and the original outcome.

### Release-on-Reject: The Critical Difference

When an event is **rejected** (HTTP 404 or 422), the `eventId` is **not** consumed. The entire transaction — including the idempotency insert — rolls back. This means retrying with the same `eventId` is processed as a completely fresh attempt, never short-circuited as a replay.

This is the recovery path for out-of-order arrival.

#### The Race Condition

A merchant's `cart.abandoned` event races ahead of the `cart.updated` that would have created the cart:

1. `cart.updated` for `cart_xyz` is emitted but sits in a queue
2. `cart.abandoned` for `cart_xyz` is sent immediately → **404 CART_NOT_FOUND** (cart doesn't exist yet)
3. The queued `cart.updated` finally arrives and succeeds
4. **Retry the `cart.abandoned` with the same `eventId`** → now succeeds because the cart exists

If you had minted a new `eventId` for step 4, you'd have two issues:

- The original `eventId` is lost forever (never consumed), so if the system crashes before the retry, you'd lose track of the abandonment
- You're burning `eventId`s on retries that should use the original

**The Rule:** After **any** rejection, reuse the same `eventId`. Never mint a new one.

### TypeScript Error Handling

```ts
try {
  const result = await chat.recordCommerceEvent(cartAbandonedEvent);
  console.log(`Applied: ${result.applied}`);
} catch (error) {
  // Rejected with 404 or 422? This is normal when events race.
  // After a rejection, reuse the same eventId.
  if (isRetryableContactsError(error)) {
    // Add to retry queue with the SAME eventId
    await retryQueue.enqueue(cartAbandonedEvent); // Same eventId
  } else {
    // Validation error, auth error, etc. — needs a code or config fix.
    await deadLetter.send(cartAbandonedEvent, error);
  }
}
```

### Go Error Handling

```go
result, err := client.RecordCommerceEvent(ctx, event)
if err != nil {
  if commerce.IsRetryableContactsError(err) {
    // Add to retry queue with the SAME event
    retryQueue.Enqueue(event) // Same EventID
  } else {
    deadLetter.Send(event, err)
  }
  return err
}
```

### Only Accepted Events Make the EventID Inert

Once an event is **accepted** (`200` with `applied: true`), its `eventId` becomes inert. Retrying it again returns `200` with `applied: false` and the original outcome — the mutation is never re-applied.

---

## Error Handling

### HTTP Status Codes and Error Codes

| Status | Code | Retryable? | Meaning |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | No | Malformed event: missing field, field too long, invalid date, etc. Fix your code and resubmit. |
| 401 | `AUTH_INVALID` | No | Secret key missing, malformed, or revoked. Fix your configuration. |
| 404 | `CART_NOT_FOUND` | **Yes** | The cart doesn't exist yet. Retry the same `eventId` once the cart is created. |
| 422 | `INVALID_CART_TRANSITION` | **Yes** | Illegal cart state transition (e.g., updating a `CONVERTED` cart, or `cart.abandoned` before `cart.updated`). Retry the same `eventId` once the underlying condition resolves. |
| 429 | `RATE_LIMITED` | **Yes** | Too many requests. Retry with exponential backoff. The `Retry-After` header carries a hint. |
| 500 | `INTERNAL_ERROR` | **Yes** | Server fault. The idempotency contract makes retrying safe: an already-applied `eventId` replays as `applied: false`, an unapplied one is fresh. |

### Which Errors Are Retryable?

**Retryable with the SAME `eventId`:**
- `404 CART_NOT_FOUND` — cart doesn't exist yet; will exist after earlier event lands
- `422 INVALID_CART_TRANSITION` — cart in wrong state; will be in correct state after earlier event lands or current one times out
- `429 RATE_LIMITED` — transient; retry after backoff
- `500 INTERNAL_ERROR` — transient; idempotency contract handles both outcomes
- Transport errors (DNS failure, connection refused, etc.) — nothing was applied

**Fatal — need to fix your code or config:**
- `400 VALIDATION_ERROR` — malformed event
- `401 AUTH_INVALID` — bad credential
- Other validation failures

### The ChatApiError.retryable Trap in TypeScript

**Do not branch on `ChatApiError.retryable` for this route.** Use `isRetryableContactsError(error)` instead.

The commerce route answers with a different envelope than most of the SDK — the legacy `{success: false, error: {code, message, details}}` schema from the Fastify error handler. This envelope never includes a `retryable` field.

When the SDK's `http.ts` reads the response, it sees the absence of `retryable` and coerces it to `false`. This coercion is correct for most routes (no explicit "retry me" flag means don't retry). But for commerce events, the split is different:

- A `500 INTERNAL_ERROR` arrives with `.retryable === false`, but is genuinely retryable (idempotency contract)
- A `422 INVALID_CART_TRANSITION` arrives with `.retryable === false`, but is retryable (race condition, same `eventId`)

Trusting `.retryable` here dead-letters legitimate retries.

`isRetryableContactsError` encodes the correct split for this route only.

```ts
// ❌ Wrong
if (!error.retryable) {
  deadLetter(event);  // Oops — retried a 500 as fatal
}

// ✅ Correct
if (!isRetryableContactsError(error)) {
  deadLetter(event);
}
```

### Go Has No Equivalent Trap

Go's `commerce.IsRetryableContactsError` is proven total over the generated error-code enum. No field-coercion edge case exists here.

---

## Caps and Constraints

### Client-Side Caps (Enforced Locally)

Requests violating these are rejected locally before the SDK sends anything:

- `items` in `cart.updated`: at most **500 entries** — a 501st entry is rejected outright
- Each `items[i].name`: at most **300 characters**
- Each `items[i].sku` (optional): at most **64 characters**

```ts
// ❌ This fails locally with a clear error
await chat.recordCommerceEvent({
  type: 'cart.updated',
  // ... (other fields)
  items: new Array(501).fill({ name: 'item', quantity: 1, unitPrice: 1 }),
  // InvalidCommerceEventError: items may contain at most 500 entries, received 501
});

// ✅ This passes local checks (still validated server-side for other bounds)
await chat.recordCommerceEvent({
  type: 'cart.updated',
  // ... (other fields)
  items: [
    { name: 'A'.repeat(300), quantity: 1, unitPrice: 1, sku: 'S'.repeat(64) },
  ],
});
```

### Server-Side Bounds (Validated Only on Server)

Every other per-field constraint is validated only server-side:

- `eventId`, `customerId`, `orderId`, `merchant`, `category`, `cartId`: max lengths
- `occurredAt`: not more than 5 minutes in the future (clock-skew tolerance)
- `quantity`: 1–100,000
- `value`, `unitPrice`: >= 0 (can be 0)

### Request Size

A maximal cart is approximately 210 KiB in ASCII but ~567 KiB with CJK product names. The server's body limit is 1 MiB to accommodate these worst-case scenarios comfortably.

---

## Worked Example

This example shows a complete journey: cart filled, abandoned, order placed, order completed.

### TypeScript

```ts
const chat = new ChatServerClient({
  apiUrl: 'https://chat.example.com',
  secretKey: process.env.CHAT_SECRET_KEY!,
});

const customerId = 'cust_5847';
const now = new Date().toISOString();

// 1. Customer fills cart — cart.updated
const updateResult = await chat.recordCommerceEvent({
  eventId: 'evt_001',
  type: 'cart.updated',
  customerId,
  occurredAt: now,
  cartId: 'cart_abc',
  items: [
    { name: 'Book A', quantity: 1, unitPrice: 19.99, sku: 'BOOK-A' },
    { name: 'Book B', quantity: 2, unitPrice: 14.99, sku: 'BOOK-B' },
  ],
});
console.log(`Cart created. Contact: ${updateResult.contactId}`);
// Contact.itemsInCart = 3, Contact.cartValue = 49.97

// 2. Days pass... customer abandons cart
const abandonResult = await chat.recordCommerceEvent({
  eventId: 'evt_002',
  type: 'cart.abandoned',
  customerId,
  occurredAt: new Date().toISOString(),
  cartId: 'cart_abc',
});
console.log(`Cart abandoned. Applied: ${abandonResult.applied}`);
// Contact.itemsInCart = 0, Contact.cartValue = 0
// contact_carts row status: ABANDONED

// 3. Customer returns and places an order (new cart, new order)
const placeResult = await chat.recordCommerceEvent({
  eventId: 'evt_003',
  type: 'order.placed',
  customerId,
  occurredAt: new Date().toISOString(),
  orderId: 'ord_123',
  value: 39.99,              // Audit-only
  merchant: 'BookStore',
  category: 'Books',
  cartId: 'cart_xyz',        // Ties new order to new cart
});
console.log(`Order placed. Contact: ${placeResult.contactId}`);
// Contact.totalOrders = 1, Contact.lastOrderAt = now, Contact.lastOrderMerchant = 'BookStore'
// cart_xyz status: CONVERTED (side effect of order.placed)

// 4. Order ships and is confirmed
const completeResult = await chat.recordCommerceEvent({
  eventId: 'evt_004',
  type: 'order.completed',
  customerId,
  occurredAt: new Date().toISOString(),
  orderId: 'ord_123',
  value: 39.99,              // Drives totalSpend
  merchant: 'BookStore',
  category: 'Books',
});
console.log(`Order completed.`);
// Contact.completedOrders = 1
// Contact.totalSpend = 39.99
// Contact.averageOrderValue = 39.99 / 1 = 39.99

// Final state:
// Contact.totalOrders = 1
// Contact.completedOrders = 1
// Contact.cancelledOrders = 0
// Contact.totalSpend = 39.99
// Contact.averageOrderValue = 39.99
// Contact.itemsInCart = 0 (no active cart)
// Contact.cartValue = 0
// Contact.lastOrderAt = (the completion time)
// Contact.lastOrderMerchant = 'BookStore'
// Contact.lastOrderCategory = 'Books'
```

### Go

```go
client, err := commerce.New("https://chat.example.com", os.Getenv("CHAT_SECRET_KEY"))
if err != nil {
  return err
}

customerId := "cust_5847"
now := time.Now().UTC()

// 1. Customer fills cart — cart.updated
updateResult, err := client.RecordCommerceEvent(ctx, commerce.CartUpdated{
  EventID:    "evt_001",
  OccurredAt: now,
  CustomerID: customerId,
  CartID:     "cart_abc",
  Items: []commerce.Item{
    {Name: "Book A", Quantity: 1, UnitPrice: 19.99, SKU: "BOOK-A"},
    {Name: "Book B", Quantity: 2, UnitPrice: 14.99, SKU: "BOOK-B"},
  },
})
if err != nil {
  return err
}
log.Printf("Cart created. Contact: %s", updateResult.ContactID)
// Contact.itemsInCart = 3, Contact.cartValue = 49.97

// 2. Days pass... customer abandons cart
abandonResult, err := client.RecordCommerceEvent(ctx, commerce.CartAbandoned{
  EventID:    "evt_002",
  OccurredAt: time.Now().UTC(),
  CustomerID: customerId,
  CartID:     "cart_abc",
})
if err != nil {
  return err
}
log.Printf("Cart abandoned. Applied: %v", abandonResult.Applied)
// Contact.itemsInCart = 0, Contact.cartValue = 0
// contact_carts row status: ABANDONED

// 3. Customer returns and places an order
placeResult, err := client.RecordCommerceEvent(ctx, commerce.OrderPlaced{
  EventID:    "evt_003",
  OccurredAt: time.Now().UTC(),
  CustomerID: customerId,
  OrderID:    "ord_123",
  Value:      commerce.Float64(39.99), // Audit-only
  Merchant:   "BookStore",
  Category:   "Books",
  CartID:     "cart_xyz",
})
if err != nil {
  return err
}
log.Printf("Order placed. Contact: %s", placeResult.ContactID)
// Contact.totalOrders = 1

// 4. Order ships and is confirmed
completeResult, err := client.RecordCommerceEvent(ctx, commerce.OrderCompleted{
  EventID:    "evt_004",
  OccurredAt: time.Now().UTC(),
  CustomerID: customerId,
  OrderID:    "ord_123",
  Value:      39.99,
  Merchant:   "BookStore",
  Category:   "Books",
})
if err != nil {
  return err
}
log.Printf("Order completed")
// Contact.completedOrders = 1
// Contact.totalSpend = 39.99
// Contact.averageOrderValue = 39.99

// Final state:
// Contact.totalOrders = 1
// Contact.completedOrders = 1
// Contact.cancelledOrders = 0
// Contact.totalSpend = 39.99
// Contact.averageOrderValue = 39.99
// Contact.itemsInCart = 0
// Contact.cartValue = 0
// Contact.lastOrderMerchant = 'BookStore'
// Contact.lastOrderCategory = 'Books'
```

---

## API Reference

### TypeScript

**Import:**
```ts
import { ChatServerClient, isRetryableContactsError } from '@dhaam-ccrm/node';
```

**Methods:**
```ts
await chat.recordCommerceEvent(event: CommerceEvent): Promise<CommerceEventResult>
```

**Result:**
```ts
interface CommerceEventResult {
  eventId: string;
  type: CommerceEventType;
  contactId: string;  // The resolved contact's server id
  applied: boolean;   // true on first acceptance and accepted no-ops
}
```

**Error Handling:**
```ts
if (isRetryableContactsError(error)) {
  // Safe to retry with the same eventId
} else {
  // Fatal; needs code or config fix
}
```

### Go

**Import:**
```go
import "github.com/dhaamai/chat-sdk/clients/go/commerce"
```

**Constructor:**
```go
client, err := commerce.New(apiURL, secretKey, opts...)
```

Options:
- `WithHTTPClient(doer)` — custom HTTP client for retries, timeouts, tracing
- `WithBasePath(path)` — override the base path (default: `/chat-services/api/v1`)

**Methods:**
```go
result, err := client.RecordCommerceEvent(ctx context.Context, event Event) (Result, error)
```

**Result:**
```go
type Result struct {
  EventID   string
  Type      EventType
  ContactID string
  Applied   bool
}
```

**Error Handling:**
```go
if commerce.IsRetryableContactsError(err) {
  // Safe to retry with the same EventID
} else {
  // Fatal
}
```

**Exported Types & Functions:**
- Six event types: `OrderPlaced`, `OrderCompleted`, `OrderCancelled`, `CartUpdated`, `CartAbandoned`, `CartConverted`
- `Item` — one line in a cart snapshot
- `Float64(v)` — helper for optional `OrderPlaced.Value`
- `EventType` constants: `EventTypeOrderPlaced`, `EventTypeOrderCompleted`, etc.
- `Validate(event)` — check event locally without sending
- Caps: `MaxItems`, `MaxItemNameLength`, `MaxItemSKULength`
- Errors: `*InvalidEventError`, `*APIError`, `*TransportError`
- Functions: `IsRetryableContactsError`

---

## See Also

- For TypeScript: [`packages/node/README.md`](../packages/node/README.md#recording-commerce-events) — the original commerce reference
- For Go: [`clients/go/README.md`](../clients/go/README.md#recording-commerce-events)
- Spec: `chat-service-node` docs/specs/contact-commerce-properties.md (internal)
