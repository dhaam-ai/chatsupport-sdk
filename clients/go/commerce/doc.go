// Package commerce is the hand-written ergonomic layer over the generated
// chatapi client's commerce-event ingestion — the Go counterpart of what
// @dhaam-ccrm/node (packages/node/src/commerce.ts) is for TypeScript.
//
// It exists because assembling ogen's oneOf union by hand is where
// integrators go wrong. chatapi models CommerceEvent as a struct carrying
// all six variants at once plus a Type discriminator: nothing stops a
// caller from setting Type to "cart.updated" and filling in
// OrderPlacedEvent, and nothing tells them they got it wrong until the
// server answers 400. Here, each variant is its own struct, the required
// fields are ordinary non-optional fields on it, and the only way to
// reach the wire is through [Client.RecordCommerceEvent].
//
// A [Client] wraps one generated chatapi.Client and supplies the
// chatapi.SecuritySource internally, so sending one event does not cost a
// caller four hand-written credential methods.
//
//	c, err := commerce.New("https://chat.example.com", os.Getenv("CHAT_SECRET_KEY"))
//	if err != nil {
//		return err
//	}
//	result, err := c.RecordCommerceEvent(ctx, commerce.OrderCompleted{
//		EventID:    "evt_order_9f2a1e",
//		OccurredAt: time.Now().UTC(),
//		CustomerID: "cust_8f2a1e",
//		OrderID:    "ord_5591",
//		Value:      84.50,
//	})
//
// # Release-on-reject: after a rejection, retry the SAME event id
//
// This is the single most expensive thing to get wrong here, and it costs
// a production incident.
//
// A REJECTED event — 404 CART_NOT_FOUND or 422 INVALID_CART_TRANSITION —
// does NOT consume its EventID. The whole transaction, including the
// idempotency insert, rolls back, so re-sending the identical EventID
// later is processed as a completely fresh attempt, never short-circuited
// as a replay.
//
// That is the intended recovery path for out-of-order arrival. A
// cart.abandoned that races ahead of the cart.updated which would have
// created its cart gets a 404 immediately; the caller retries THAT SAME
// EventID once the earlier event lands, and it succeeds. Minting a new id
// on rejection is always wrong: it buys nothing, and it destroys the
// idempotency key that makes the retry safe.
//
//	if _, err := c.RecordCommerceEvent(ctx, event); err != nil {
//		if commerce.IsRetryableContactsError(err) {
//			queueRetry(event) // the same event, the same EventID
//		} else {
//			deadLetter(event, err) // needs a code or config fix first
//		}
//	}
//
// Only an ACCEPTED event (200, Applied true) makes an EventID inert going
// forward. Re-sending that one returns 200 with Applied false and the
// original outcome, re-read from the stored row rather than recomputed;
// the mutation is never re-applied.
//
// # 422 INVALID_CART_TRANSITION covers every illegal cart move
//
// Including a terminal one. A CONVERTED cart is terminal, and a
// cart.updated or cart.abandoned aimed at it is refused with
// 422 INVALID_CART_TRANSITION — the same code as any other illegal move.
//
// There is no 409 on this route and there is no CART_ALREADY_CONVERTED
// code. Do not branch looking for one. A 422 says only "you asked for a
// move the cart cannot make"; the usual cause is ordering, so check
// whether a cart.converted overtook the cart.updated that should have
// preceded it, and retry the same EventID once it has.
//
// # The secret key: two routes, and never a log line
//
// The tenant secret key is a valid Authorization: Bearer credential on
// exactly two routes — POST /tokens and POST /contacts/commerce-events —
// and on nothing else. It is not a general server-to-server admin
// credential.
//
// In particular it grants NOTHING on the five Contacts CRM routes
// (GET /contacts, GET /contacts/{id}, POST /contacts, GET /contacts/cities,
// GET /contacts/tags). Those accept only a staff Cognito token, and the
// commerce/cart admin routes additionally require that verified identity
// to carry the admin role. A secret key presented there is rejected
// exactly as any other malformed Authorization header is.
//
// Never log it. This package never puts it in an error message, never
// echoes a prefix, a length or a digest of it, and redacts it from every
// fmt verb applied to a [Client]. Errors from here name the CATEGORY of a
// failure, which is what a developer needs, and never the credential
// material, which is what an error tracker must not receive.
//
// # averageOrderValue is derived, never sent
//
// Callers never send averageOrderValue. The server derives it as
// totalSpend / completedOrders across a contact's order.completed events,
// alongside every other Contact aggregate (totalOrders, completedOrders,
// totalSpend, itemsInCart, cartValue, lastOrderMerchant, lastOrderCategory,
// lastOrderAt). There is no field for it on any event in this package, and
// its absence is the contract, not an omission.
//
// # Machine path only
//
// This package speaks POST /contacts/commerce-events, the secret-key
// machine path where CustomerID resolves-or-creates the contact. The
// staff-token admin path (POST /contacts/{id}/commerce-events, and
// chatapi's *Admin event twins) needs a credential this package does not
// hold, so it has no counterpart here — by scope, not by oversight.
package commerce
