package commerce_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
	"github.com/dhaamai/chat-sdk/clients/go/commerce"
)

// TestIsRetryableContactsError pins the split the whole retry story rests on.
// Getting a row of this table backwards is either an infinite retry loop or a
// dropped event, so every code in chatapi's ContactsErrorCode vocabulary is
// named explicitly rather than left to a default arm.
func TestIsRetryableContactsError(t *testing.T) {
	apiErr := func(status int, code chatapi.ContactsErrorCode) error {
		return &commerce.APIError{Status: status, Code: code, Message: "refused"}
	}

	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		// Release-on-reject: the transaction rolled back, so the EventID was
		// never consumed and the same one is the correct thing to resend.
		{"cart not found", apiErr(404, chatapi.ContactsErrorCodeCARTNOTFOUND), true},
		{"invalid cart transition", apiErr(422, chatapi.ContactsErrorCodeINVALIDCARTTRANSITION), true},
		// Never reached the transaction.
		{"rate limited", apiErr(429, chatapi.ContactsErrorCodeRATELIMITED), true},
		// Ambiguous, but the idempotency contract makes a resend safe either way.
		{"internal error", apiErr(500, chatapi.ContactsErrorCodeINTERNALERROR), true},

		// Fatal: resending the identical request changes nothing.
		{"validation error", apiErr(400, chatapi.ContactsErrorCodeVALIDATIONERROR), false},
		{"auth invalid", apiErr(401, chatapi.ContactsErrorCodeAUTHINVALID), false},
		{"contact not found", apiErr(404, chatapi.ContactsErrorCodeCONTACTNOTFOUND), false},
		{"unauthorized", apiErr(403, chatapi.ContactsErrorCodeUNAUTHORIZED), false},

		// Transport: nobody rendered a verdict, so the same event is exactly
		// as safe to send as it was the first time.
		{"transport", &commerce.TransportError{Err: errors.New("connection refused")}, true},
		{"transport wrapping a net error", &commerce.TransportError{Err: &net.OpError{Op: "dial"}}, true},
		{"transport wrapping a cancelled context", &commerce.TransportError{Err: context.Canceled}, true},

		// Local refusals and everything else.
		{"invalid event", &commerce.InvalidEventError{Field: "cartId", Reason: "is required"}, false},
		{"unrelated error", errors.New("something else"), false},
		{"nil", nil, false},

		// errors.As must see through a caller's own wrapping, in both
		// directions -- this is why the helper does not type-assert.
		{"wrapped retryable", fmt.Errorf("recording event: %w", apiErr(422, chatapi.ContactsErrorCodeINVALIDCARTTRANSITION)), true},
		{"wrapped fatal", fmt.Errorf("recording event: %w", apiErr(400, chatapi.ContactsErrorCodeVALIDATIONERROR)), false},
		{"wrapped transport", fmt.Errorf("recording event: %w", &commerce.TransportError{Err: errors.New("eof")}), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := commerce.IsRetryableContactsError(tc.err); got != tc.want {
				t.Errorf("IsRetryableContactsError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestIsRetryableContactsErrorIsTotalOverTheVocabulary fails if the spec grows
// a ContactsErrorCode that the table above does not name, so a new code cannot
// silently inherit the fatal default arm.
func TestIsRetryableContactsErrorIsTotalOverTheVocabulary(t *testing.T) {
	covered := map[chatapi.ContactsErrorCode]bool{
		chatapi.ContactsErrorCodeCARTNOTFOUND:          true,
		chatapi.ContactsErrorCodeINVALIDCARTTRANSITION: true,
		chatapi.ContactsErrorCodeRATELIMITED:           true,
		chatapi.ContactsErrorCodeINTERNALERROR:         true,
		chatapi.ContactsErrorCodeVALIDATIONERROR:       false,
		chatapi.ContactsErrorCodeAUTHINVALID:           false,
		chatapi.ContactsErrorCodeCONTACTNOTFOUND:       false,
		chatapi.ContactsErrorCodeUNAUTHORIZED:          false,
	}

	for _, code := range (chatapi.ContactsErrorCode("")).AllValues() {
		want, named := covered[code]
		if !named {
			t.Errorf("chatapi.ContactsErrorCode %q is not classified by this test; "+
				"decide whether resending the same eventId can ever succeed for it "+
				"and add it to IsRetryableContactsError and this table", code)
			continue
		}
		got := commerce.IsRetryableContactsError(&commerce.APIError{Code: code})
		if got != want {
			t.Errorf("IsRetryableContactsError(&APIError{Code: %q}) = %v, want %v", code, got, want)
		}
	}
}

// TestErrorStringsHoldTheirCause covers the rule the package doc states: a
// cause is held, never interpolated. fetch-style transport errors routinely
// embed the request URL, and a URL on this service has historically carried a
// token in its query string.
func TestErrorStringsHoldTheirCause(t *testing.T) {
	const leaky = "https://chat.example.com/x?token=dhk_live_should_never_be_printed"

	transport := &commerce.TransportError{Err: errors.New(`Get "` + leaky + `": dial tcp: refused`)}
	if got := transport.Error(); got != "commerce: the request did not reach a server verdict" {
		t.Errorf("TransportError.Error() = %q, want the fixed message with no cause interpolated", got)
	}
	if !errors.Is(transport, transport.Err) {
		t.Error("errors.Is could not reach the held cause; TransportError must implement Unwrap")
	}

	// Unwrapping is how a caller gets the detail -- and how errors.Is sees
	// through to a sentinel like context.DeadlineExceeded.
	deadline := &commerce.TransportError{Err: context.DeadlineExceeded}
	if !errors.Is(deadline, context.DeadlineExceeded) {
		t.Error("errors.Is(TransportError{context.DeadlineExceeded}, context.DeadlineExceeded) = false, want true")
	}
}

func TestAPIErrorMessage(t *testing.T) {
	err := &commerce.APIError{
		Status:     429,
		Code:       chatapi.ContactsErrorCodeRATELIMITED,
		Message:    "Too many requests.",
		RetryAfter: 30 * time.Second,
	}
	const want = "commerce: 429 RATE_LIMITED: Too many requests."
	if got := err.Error(); got != want {
		t.Errorf("APIError.Error() = %q, want %q", got, want)
	}
}

func TestInvalidEventErrorMessage(t *testing.T) {
	err := &commerce.InvalidEventError{Field: "items[3].name", Reason: "is required and must not be empty"}
	const want = "commerce: invalid event: items[3].name is required and must not be empty"
	if got := err.Error(); got != want {
		t.Errorf("InvalidEventError.Error() = %q, want %q", got, want)
	}
}
