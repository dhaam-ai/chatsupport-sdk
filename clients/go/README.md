# `chatapi` — generated Go client

Generated from [`openapi/chat-api.yaml`](../../openapi/chat-api.yaml) by
[ogen](https://github.com/ogen-go/ogen). **Do not edit `chatapi/` by hand** —
`clients/scripts/generate.sh` deletes and recreates it, and
`clients/scripts/check-drift.sh` fails if it does not match the spec.

See [`../README.md`](../README.md) for why the clients are generated, why this
generator, and what the generated clients deliberately leave out.

## Install

```bash
go get github.com/dhaamai/chat-sdk/clients/go
```

Requires Go 1.25+ — ogen's runtime packages set that floor, not this module.

## The one thing you have to write: a `SecuritySource`

The generated client declares `chatapi.SecuritySource` and never implements
it. ogen calls the right method per operation according to the spec's
`security` blocks: `SecretKey` for `POST /tokens`, and **both** `AccessToken`
and `PublishableKey` for every session, message and attachment endpoint.

```go
type creds struct {
	secretKey      string
	accessToken    string
	publishableKey string
}

func (c creds) SecretKey(context.Context, chatapi.OperationName) (chatapi.SecretKey, error) {
	return chatapi.SecretKey{Token: c.secretKey}, nil
}

func (c creds) AccessToken(ctx context.Context, _ chatapi.OperationName) (chatapi.AccessToken, error) {
	// Return a *fresh* token here. This is called per request, which is the
	// hook for refreshing an expired one -- see AUTH_EXPIRED in the spec.
	return chatapi.AccessToken{Token: c.accessToken}, nil
}

func (c creds) PublishableKey(context.Context, chatapi.OperationName) (chatapi.PublishableKey, error) {
	return chatapi.PublishableKey{APIKey: c.publishableKey}, nil
}
```

## Mint a token

```go
client, err := chatapi.NewClient(
	// ResolveBaseURL appends /chat-services/api/v1. Pass the *origin*.
	chatapi.ResolveBaseURL("https://chat.example.com"),
	creds{secretKey: os.Getenv("CHAT_SECRET_KEY")},
)
if err != nil {
	return err
}

res, err := client.MintToken(ctx, &chatapi.MintTokenRequest{UserID: "cust_8f2a1e"})
if err != nil {
	return err
}

switch v := res.(type) {
case *chatapi.MintTokenResponse:
	fmt.Println(v.AccessToken, v.ExpiresIn)
case *chatapi.UnauthorizedHeaders:
	// v.Response.Error.Code is the same ErrorCode enum the WebSocket uses:
	// AUTH_INVALID (bad key) or AUTH_EXPIRED (refresh and retry).
	return fmt.Errorf("mint refused: %s: %s", v.Response.Error.Code, v.Response.Error.Message)
default:
	return fmt.Errorf("mint failed: %T", res)
}
```

The server URL is the one thing that is easy to get wrong. `ResolveBaseURL` is
generated from the spec's `servers` block; hand-writing the path is how you
end up 404ing on every call while the code looks correct.

## Responses are sum types, not `(value, error)`

Every operation returns an interface (`MintTokenRes`, `ListSessionsRes`, …)
whose implementations are the documented success body *and* one type per
documented error status: `*BadRequestHeaders`, `*UnauthorizedHeaders`,
`*NotFoundHeaders`, `*ConflictHeaders`, `*TooManyRequestsHeaders`,
`*InternalErrorHeaders`. The names come from the reusable responses in the
spec's `components/responses`; each wraps the same `Error` body plus the
`X-Request-Id` header you quote in a support ticket.

That means there is no single error case to match. A `default:` arm that
returns `fmt.Errorf("%T", res)` is the difference between a readable failure
and silently treating a 429 as success.

A non-nil `error`, separately, means the call did not complete at all —
transport failure, or a status the spec does not document.

## Optional and nullable are different types

The spec distinguishes "absent" from "explicitly null", and so does the
generated code: `OptString` is absent-or-present, `OptNilString` is
absent-or-null-or-present. `v.SenderID.Get()` returns `(value, ok)`; for
`OptNil*`, check `.Null` too.

## Recording commerce events

Your backend posts order and cart state to the chat service via `RecordCommerceEvent`, which populates a contact's commerce data for CRM features — knowing the customer's order history, cart state, and average order value shapes how an agent responds to them.

**The secret key is valid on exactly two routes: `POST /tokens` and `POST /contacts/commerce-events`. It cannot authenticate any browser-facing endpoint.**

### Overview

Use the `commerce` package — a hand-written ergonomic layer that wraps the generated client and eliminates the pitfalls of assembling a discriminated union by hand.

```go
import "github.com/dhaamai/chat-sdk/clients/go/commerce"

client, err := commerce.New("https://chat.example.com", os.Getenv("CHAT_SECRET_KEY"))
if err != nil {
  return err
}

result, err := client.RecordCommerceEvent(ctx, commerce.OrderCompleted{
  EventID:    "evt_order_9f2a1f",
  OccurredAt: time.Now().UTC(),
  CustomerID: "cust_5847",
  OrderID:    "ord_5591",
  Value:      84.50,  // Drives totalSpend
  Merchant:   "Nike",
  Category:   "Footwear",
})
if err != nil {
  if commerce.IsRetryableContactsError(err) {
    // Safe to retry with the same EventID
  } else {
    // Fatal; needs code or config fix
  }
  return err
}
```

The `commerce` package provides six event types forming two independent lifecycles: **orders** (`OrderPlaced`, `OrderCompleted`, `OrderCancelled`) and **carts** (`CartUpdated`, `CartAbandoned`, `CartConverted`). Each variant is its own struct with required fields as non-optional fields — no null-checking after construction.

### Idempotency and Release-on-Reject

Every event carries an `EventID` — your idempotency key. When an event is **accepted** (`200`, `Applied: true`), retrying it returns `200` with `Applied: false` and the original outcome; the mutation is never re-applied.

When an event is **rejected** (`404 CART_NOT_FOUND` or `422 INVALID_CART_TRANSITION`), the `EventID` is **not** consumed. The entire transaction rolls back, so retrying the **same** `EventID` later is processed as a completely fresh attempt.

This is the intended recovery path for out-of-order arrival. If a `CartAbandoned` event races ahead of the `CartUpdated` that would have created the cart, the abandoned event will be rejected with a `404`. Retry the SAME `EventID` once the earlier event lands — the second attempt will succeed.

```go
if _, err := client.RecordCommerceEvent(ctx, event); err != nil {
  if commerce.IsRetryableContactsError(err) {
    queueRetry(event) // the same event, the same EventID
  } else {
    deadLetter(event, err) // needs a code or config fix first
  }
}
```

Only an ACCEPTED event makes its EventID inert going forward. See the full guide for the race condition scenario and why never minting a new id on rejection is load-bearing.

### Error Types

- `*InvalidEventError` — refused locally; nothing was sent (e.g., missing required field)
- `*APIError` — the server evaluated it and said no (e.g., `404 CART_NOT_FOUND`)
- `*TransportError` — no server verdict was reached (DNS, connection refused, etc.)

Use `IsRetryableContactsError` to decide whether a retry is worthwhile:

```go
switch err := err.(type) {
case *commerce.InvalidEventError:
  // Local validation failed; fix your code
  log.Printf("Invalid event: %s %s", err.Field, err.Reason)
case *commerce.APIError:
  // Server rejected it
  log.Printf("API error: %d %s", err.Status, err.Code)
  if commerce.IsRetryableContactsError(err) {
    queueRetry(event)
  } else {
    deadLetter(event)
  }
case *commerce.TransportError:
  // Network failure; always retryable
  queueRetry(event)
}
```

### Caps and Constraints

Client-side caps, enforced locally:

- `items` in `CartUpdated`: at most 500 entries
- Each item's `Name`: at most 300 characters
- Each item's `SKU`: at most 64 characters

Every other field constraint (max lengths, finite numbers, value ranges) is validated server-side only. The commerce package validates required fields and these three explicit caps; the server stays the authority on the rest.

```go
const (
  MaxItems          = 500
  MaxItemNameLength = 300
  MaxItemSKULength  = 64
)
```

### Full Guide

See [`../../docs/commerce-events-guide.md`](../../docs/commerce-events-guide.md) for:

- Complete business context (what commerce events solve)
- Eight properties and what moves each one
- Order and cart state machines with examples
- Worked lifecycle example (cart → abandoned → order → completed)
- Error codes and retryability matrix
- API reference for both TypeScript and Go

## Tests

```bash
cd clients/go && go test ./...
```

They check what the generator cannot: that requests actually leave for
`/chat-services/api/v1/...`, and that browser-facing endpoints carry both
credentials. Set `CHAT_LIVE_API_URL` and `CHAT_LIVE_SECRET_KEY` to also mint
against a real backend.
