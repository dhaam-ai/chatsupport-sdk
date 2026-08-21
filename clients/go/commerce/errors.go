package commerce

import (
	"errors"
	"fmt"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
)

// An InvalidEventError reports an event this package refused before anything
// went on the wire: a missing required field, or one of the three client-side
// caps ([MaxItems], [MaxItemNameLength], [MaxItemSKULength]) exceeded.
//
// It is a separate type from [APIError] on purpose. This one never reached
// the server, so there is no question of an EventID being consumed and no
// version of it that a retry can fix — the fix is in the caller's own code.
// [IsRetryableContactsError] reports false for it, always.
//
// Field carries a field NAME, chosen by the caller's own code, never a field
// VALUE. A cart's line-item names and a shopper's CustomerID are not this
// package's to put in a message that ends up in an error tracker.
type InvalidEventError struct {
	// Field is the wire name of the offending field — "eventId", "cartId",
	// "items[3].name" — matching what the server's own 400 would have named.
	Field string
	// Reason says what is wrong with it, as a phrase completing the field
	// name: "is required and must not be empty".
	Reason string
}

func (e *InvalidEventError) Error() string {
	return "commerce: invalid event: " + e.Field + " " + e.Reason
}

// An APIError reports an event the server evaluated and refused.
//
// Branch on Code, never on Message — or better, call
// [IsRetryableContactsError], which encodes the only split that matters for
// this route.
//
// Code is drawn from the LEGACY error vocabulary that
// POST /contacts/commerce-events actually answers in — chatapi's
// ContactsErrorCode, produced by the global Fastify error handler — not the
// ErrorCode vocabulary POST /tokens and the session routes use. In
// particular, that envelope never carries a retryable flag; its absence
// means "unknown", not "false", which is exactly why
// [IsRetryableContactsError] exists rather than a field to read.
type APIError struct {
	// Status is the HTTP status the server replied with: 400, 401, 404, 422,
	// 429 or 500.
	Status int
	// Code is the machine-readable rejection code. This is the field to
	// branch on.
	Code chatapi.ContactsErrorCode
	// Message is the server's human-readable text. For a log line or a
	// support ticket, never for a code path.
	Message string
	// RetryAfter is the backoff the server asked for, from the Retry-After
	// header on a 429. Zero when the server sent none, which is not the same
	// as "retry immediately" — fall back to your own backoff.
	RetryAfter time.Duration
	// Details is the server's structured, error-specific context. Frequently
	// absent, and its keys are not part of any contract.
	Details chatapi.ContactsErrorPayloadDetails
}

func (e *APIError) Error() string {
	return fmt.Sprintf("commerce: %d %s: %s", e.Status, e.Code, e.Message)
}

// A TransportError reports a call that never produced a decoded server
// verdict: DNS failure, connection refused, a TLS error, a cancelled or
// expired context, or a reply that could not be decoded as any response the
// spec documents.
//
// It is kept apart from [APIError] because the two demand opposite responses.
// An [APIError] means the server evaluated the request and said no. This one
// means nobody said anything, so the same event — the same EventID — is
// exactly as safe to send as it was the first time.
// [IsRetryableContactsError] reports true for it, always.
//
// The cause is HELD, not interpolated. Error never grows a URL, a header or
// anything else the underlying stack chose to put in its own message; a
// caller who wants the detail asks for it with [errors.Unwrap], or matches
// through it with [errors.Is] — errors.Is(err, context.DeadlineExceeded)
// works as expected.
type TransportError struct {
	// Err is the underlying failure, reachable via Unwrap.
	Err error
}

func (e *TransportError) Error() string {
	return "commerce: the request did not reach a server verdict"
}

// Unwrap returns the underlying failure, so [errors.Is] and [errors.As] see
// through this wrapper.
func (e *TransportError) Unwrap() error { return e.Err }

// IsRetryableContactsError reports whether err is worth retrying with the
// SAME EventID, as opposed to fatal — a bug in the caller's own request that
// must be fixed before any retry can succeed.
//
// This is the single most important call a [Client.RecordCommerceEvent]
// integrator makes, and getting it backwards costs real money in either
// direction. Treating a fatal error as retryable spins a loop that can never
// succeed. Treating a retryable one — a cart.abandoned that raced ahead of
// its own cart.updated — as fatal drops a legitimate event that a second
// attempt, same EventID, would have accepted once the earlier one landed.
//
// It takes a plain error rather than a narrowed type, so it works as the
// first line of an error check with no type switch of the caller's own:
//
//	if _, err := c.RecordCommerceEvent(ctx, event); err != nil {
//		if commerce.IsRetryableContactsError(err) {
//			queueRetry(event) // the same event, the same EventID
//		} else {
//			deadLetter(event, err)
//		}
//	}
//
// Retryable:
//
//   - CART_NOT_FOUND (404) and INVALID_CART_TRANSITION (422) — the
//     release-on-reject codes. Each rolls back its whole transaction,
//     including the idempotency insert, so the EventID was never consumed.
//     Resending it once the missing cart exists, or once whatever raced ahead
//     of it lands, is processed as a fresh attempt.
//   - RATE_LIMITED (429) — never reached the transaction at all. The fix is a
//     backoff; see [APIError.RetryAfter].
//   - INTERNAL_ERROR (500) — the one genuinely ambiguous case, since it is
//     unclear whether the transaction committed. The idempotency contract
//     makes resending safe either way: an already-applied EventID replays as
//     Applied false with the original outcome, an unapplied one is processed
//     fresh.
//   - [*TransportError] — nothing was applied, or if it was, a resend
//     replays it. Always retryable.
//
// Fatal — each needs a caller-side fix before any retry can succeed:
//
//   - VALIDATION_ERROR (400) and AUTH_INVALID (401) — both happen before any
//     transaction opens, so the EventID is equally free to reuse, but
//     resending the identical still-malformed request changes nothing. These
//     name a bug in the caller's own code or config.
//   - CONTACT_NOT_FOUND — unreachable from the machine path this package
//     wraps, since CustomerID resolves-or-creates a contact. Named here only
//     so this function stays total over the whole vocabulary rather than
//     silently mishandling a code a future admin-path method would produce.
//   - UNAUTHORIZED — the staff-token routes' code, likewise unreachable here.
//   - [*InvalidEventError] — a local validation failure. It will fail
//     identically on every retry until the caller's own code changes.
//   - Anything else, including a nil error.
func IsRetryableContactsError(err error) bool {
	var transport *TransportError
	if errors.As(err, &transport) {
		return true
	}

	// errors.As, not a string match on err.Error(): the code is a typed value
	// the generated decoder produced, and reading it as one is what keeps
	// this correct when a message is reworded.
	var api *APIError
	if !errors.As(err, &api) {
		return false
	}
	switch api.Code {
	case chatapi.ContactsErrorCodeCARTNOTFOUND,
		chatapi.ContactsErrorCodeINVALIDCARTTRANSITION,
		chatapi.ContactsErrorCodeRATELIMITED,
		chatapi.ContactsErrorCodeINTERNALERROR:
		return true
	default:
		return false
	}
}
