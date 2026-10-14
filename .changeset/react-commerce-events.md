---
"@dhaam-ccrm/react": minor
---

Add `useCommerceEvents()` to record `order.placed`, `cart.updated`, `cart.abandoned` and `cart.converted` from the browser.

It posts to `POST /contacts/commerce-events` with the publishable key and the customer's access token; the server binds
the event to the token's customer and accepts only these four types. Needs no `ChatProvider`, and is also
available as `@dhaam-ccrm/react/commerce`, a standalone entry that works without the widget or core installed.
Retry any failure with the same `eventId`.
