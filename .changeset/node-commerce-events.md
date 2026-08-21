---
"@dhaam-ccrm/node": minor
---

Add commerce event recording to the server SDK.

`ChatServerClient.recordCommerceEvent()` posts order and cart events — order
lifecycle (`placed`, `completed`, `cancelled`) and cart lifecycle (`updated`,
`abandoned`, `converted`) — to the backend, where they populate a contact's
commerce data and drive CRM features. The method is idempotent on `eventId` for
accepted events, and the supplied `eventId` is never consumed by a rejection,
making it safe and correct to retry after a `404 CART_NOT_FOUND` or `422
INVALID_CART_TRANSITION` with the identical event.

New exports:

- `ChatServerClient.recordCommerceEvent(event)` — POST an event to
  `/contacts/commerce-events`, authenticated with the secret key
- `buildCommerceEventBody(event)` — validate and flatten a `CommerceEvent` before
  sending (used by `recordCommerceEvent`; exported for custom routing)
- `InvalidCommerceEventError` — thrown when an event is malformed locally
  (unrecognised field, missing required field, client-side cap exceeded), never
  reaching the server
- `isRetryableContactsError(error)` — the decisive call an integrator must make
  — whether an error from `recordCommerceEvent()` is worth retrying with the
  same `eventId` or is fatal and needs a code fix. This is **not** the same
  decision `ChatApiError.retryable` makes elsewhere: this route's envelope
  never carries a `retryable` flag, and `http.ts` coerces its absence to
  `false`, so a `500 INTERNAL_ERROR` — which IS worth retrying — arrives with
  `.retryable === false`

Type-only exports: `CommerceEvent` (the discriminated union), `CommerceEventType`,
`CommerceEventResult`, `CommerceCartItem`, `ContactsErrorCode`, and the six
event-type variants (`OrderPlacedEvent`, `OrderCompletedEvent`,
`OrderCancelledEvent`, `CartUpdatedEvent`, `CartAbandonedEvent`,
`CartConvertedEvent`).

Two types are deliberately NOT exported: `ContactCartRow`, `ContactCartStatus`.
They belong to `GET /contacts/carts`, a staff-token-only read this package's
secret key cannot authenticate, so no method here returns them.
