package commerce_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
	"github.com/dhaamai/chat-sdk/clients/go/commerce"
)

// testSecretKey is split so that a secret scanner sweeping this repo does not
// flag it, matching what clients/go/tests/path_test.go already does.
var testSecretKey = "dhk_" + "test_" + "not-a-real-key"

// capture records what actually left the client. Asserting on it is the only
// way to know the request was addressed and credentialed correctly -- a mock
// that just returns 200 would pass either way.
type capture struct {
	method string
	path   string
	auth   string
	body   []byte
}

// newServer starts a test server running handler and returns a client aimed
// at it, plus the capture the handler's requests land in.
func newServer(t *testing.T, handler http.HandlerFunc) (*commerce.Client, *capture) {
	t.Helper()

	got := &capture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.path = r.URL.Path
		got.auth = r.Header.Get("Authorization")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("reading request body: %v", err)
		}
		got.body = body
		// Hand the body back to the handler -- reading it here consumed it.
		r.Body = io.NopCloser(bytes.NewReader(body))
		handler(w, r)
	}))
	t.Cleanup(srv.Close)

	client, err := commerce.New(srv.URL, testSecretKey)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return client, got
}

// okHandler replies with the documented success envelope, echoing back the
// eventId and type it was sent so a caller can tell one call from another.
func okHandler(applied bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var sent struct {
			EventID string `json:"eventId"`
			Type    string `json:"type"`
		}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &sent)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"data": map[string]any{
				"eventId":   sent.EventID,
				"type":      sent.Type,
				"contactId": "ct_7f31",
				"applied":   applied,
			},
		})
	}
}

// TestRecordCommerceEventAddressesAndCredentialsTheRequest is the check this
// package's whole SecuritySource story rests on. The generated client declares
// four credential methods and implements none; if the one this operation needs
// were wired wrong, every test that only inspects a decoded response would
// still pass.
func TestRecordCommerceEventAddressesAndCredentialsTheRequest(t *testing.T) {
	client, got := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true,"data":{"eventId":"evt_1","type":"order.cancelled","contactId":"ct_7f31","applied":true}}`))
	})

	result, err := client.RecordCommerceEvent(context.Background(), commerce.OrderCancelled{
		EventID:    "evt_1",
		OccurredAt: time.Date(2026, 8, 21, 10, 15, 0, 0, time.UTC),
		CustomerID: "cust_8f2a1e",
		OrderID:    "ord_5591",
	})
	if err != nil {
		t.Fatalf("RecordCommerceEvent: %v", err)
	}

	if got.method != http.MethodPost {
		t.Errorf("request method = %q, want %q", got.method, http.MethodPost)
	}
	const wantPath = "/chat-services/api/v1/contacts/commerce-events"
	if got.path != wantPath {
		t.Errorf("request path = %q, want %q\n"+
			"Every route on chat-service is mounted under %s. A client that drops it\n"+
			"404s on every call while looking correct.", got.path, wantPath, chatapi.BasePath)
	}
	if want := "Bearer " + testSecretKey; got.auth != want {
		t.Errorf("Authorization header = %q, want the secret key as a bearer credential", got.auth)
	}

	want := commerce.Result{EventID: "evt_1", Type: commerce.EventTypeOrderCancelled, ContactID: "ct_7f31", Applied: true}
	if result != want {
		t.Errorf("RecordCommerceEvent(...) = %+v, want %+v", result, want)
	}
}

// TestRecordCommerceEventReplay covers the other half of the idempotency
// contract: a replayed eventId comes back applied:false with the original
// outcome, and that is a success, not an error.
func TestRecordCommerceEventReplay(t *testing.T) {
	client, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true,"data":{"eventId":"evt_replay","type":"cart.updated","contactId":"ct_7f31","applied":false}}`))
	})

	result, err := client.RecordCommerceEvent(context.Background(), commerce.CartUpdated{
		EventID:    "evt_replay",
		OccurredAt: time.Date(2026, 8, 21, 10, 15, 0, 0, time.UTC),
		CustomerID: "cust_8f2a1e",
		CartID:     "cart_77",
	})
	if err != nil {
		t.Fatalf("RecordCommerceEvent: %v", err)
	}
	if result.Applied {
		t.Error("Applied = true, want false for a replayed eventId")
	}
	if result.EventID != "evt_replay" {
		t.Errorf("EventID = %q, want %q", result.EventID, "evt_replay")
	}
}

// TestRecordCommerceEventStatusMapping walks every documented rejection and
// checks both what the caller gets back and how IsRetryableContactsError reads
// it -- the two facts a retry loop is built on.
func TestRecordCommerceEventStatusMapping(t *testing.T) {
	for _, tc := range []struct {
		name          string
		status        int
		headers       map[string]string
		body          string
		wantCode      chatapi.ContactsErrorCode
		wantRetryable bool
		wantRetryWait time.Duration
	}{
		{
			name:     "400 validation error",
			status:   http.StatusBadRequest,
			body:     `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"The request was invalid."}}`,
			wantCode: chatapi.ContactsErrorCodeVALIDATIONERROR,
		},
		{
			name:     "401 auth invalid",
			status:   http.StatusUnauthorized,
			body:     `{"success":false,"error":{"code":"AUTH_INVALID","message":"Authentication failed."}}`,
			wantCode: chatapi.ContactsErrorCodeAUTHINVALID,
		},
		{
			name:          "404 cart not found releases the eventId",
			status:        http.StatusNotFound,
			body:          `{"success":false,"error":{"code":"CART_NOT_FOUND","message":"No such cart."}}`,
			wantCode:      chatapi.ContactsErrorCodeCARTNOTFOUND,
			wantRetryable: true,
		},
		{
			name:          "422 invalid cart transition releases the eventId",
			status:        http.StatusUnprocessableEntity,
			body:          `{"success":false,"error":{"code":"INVALID_CART_TRANSITION","message":"The cart cannot make that move."}}`,
			wantCode:      chatapi.ContactsErrorCodeINVALIDCARTTRANSITION,
			wantRetryable: true,
		},
		{
			name:          "429 rate limited carries the server's backoff",
			status:        http.StatusTooManyRequests,
			headers:       map[string]string{"Retry-After": "30"},
			body:          `{"success":false,"error":{"code":"RATE_LIMITED","message":"Too many requests."}}`,
			wantCode:      chatapi.ContactsErrorCodeRATELIMITED,
			wantRetryable: true,
			wantRetryWait: 30 * time.Second,
		},
		{
			name:          "500 internal error",
			status:        http.StatusInternalServerError,
			body:          `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}`,
			wantCode:      chatapi.ContactsErrorCodeINTERNALERROR,
			wantRetryable: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				for k, v := range tc.headers {
					w.Header().Set(k, v)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			})

			_, err := client.RecordCommerceEvent(context.Background(), validEvent())
			if err == nil {
				t.Fatalf("RecordCommerceEvent(...) returned no error for a %d", tc.status)
			}

			var apiErr *commerce.APIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("RecordCommerceEvent(...) error is %T (%v), want *commerce.APIError", err, err)
			}
			if apiErr.Status != tc.status {
				t.Errorf("APIError.Status = %d, want %d", apiErr.Status, tc.status)
			}
			if apiErr.Code != tc.wantCode {
				t.Errorf("APIError.Code = %q, want %q", apiErr.Code, tc.wantCode)
			}
			if apiErr.Message == "" {
				t.Error("APIError.Message is empty; the server's text is worth keeping for a support ticket")
			}
			if apiErr.RetryAfter != tc.wantRetryWait {
				t.Errorf("APIError.RetryAfter = %v, want %v", apiErr.RetryAfter, tc.wantRetryWait)
			}
			if got := commerce.IsRetryableContactsError(err); got != tc.wantRetryable {
				t.Errorf("IsRetryableContactsError(%v) = %v, want %v", err, got, tc.wantRetryable)
			}
		})
	}
}

// TestRecordCommerceEventTransportFailure covers the arm where nobody rendered
// a verdict. It must be retryable, and it must not name the URL it failed to
// reach.
func TestRecordCommerceEventTransportFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing is listening now

	client, err := commerce.New(url, testSecretKey)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	_, err = client.RecordCommerceEvent(context.Background(), validEvent())
	if err == nil {
		t.Fatal("RecordCommerceEvent(...) against a closed server returned no error")
	}

	var transport *commerce.TransportError
	if !errors.As(err, &transport) {
		t.Fatalf("RecordCommerceEvent(...) error is %T (%v), want *commerce.TransportError", err, err)
	}
	if !commerce.IsRetryableContactsError(err) {
		t.Error("IsRetryableContactsError(transport failure) = false, want true; nothing was applied")
	}
	if strings.Contains(err.Error(), url) {
		t.Errorf("TransportError.Error() = %q; it must hold its cause, not interpolate it -- "+
			"a URL on this service has historically carried a token in its query string", err.Error())
	}
	if transport.Err == nil {
		t.Error("TransportError.Err is nil; the cause must still be reachable")
	}
}

// TestRecordCommerceEventCancelledContext pins that ctx cancellation arrives as
// a transport failure a caller can match through with errors.Is.
func TestRecordCommerceEventCancelledContext(t *testing.T) {
	client, _ := newServer(t, okHandler(true))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.RecordCommerceEvent(ctx, validEvent())
	if err == nil {
		t.Fatal("RecordCommerceEvent(cancelled ctx) returned no error")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("errors.Is(err, context.Canceled) = false for %v; Unwrap must reach the cause", err)
	}
}

// TestSecretKeyNeverAppearsInOutput is the rule the package doc commits to:
// this package holds the one credential whose leak is an incident, so nothing
// it prints may carry it.
func TestSecretKeyNeverAppearsInOutput(t *testing.T) {
	// A rejection whose message would tempt an implementation to echo config.
	client, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"AUTH_INVALID","message":"Authentication failed."}}`))
	})

	_, apiErr := client.RecordCommerceEvent(context.Background(), validEvent())
	if apiErr == nil {
		t.Fatal("RecordCommerceEvent(...) returned no error for a 401")
	}

	_, localErr := client.RecordCommerceEvent(context.Background(), commerce.CartAbandoned{})
	if localErr == nil {
		t.Fatal("RecordCommerceEvent(...) returned no error for an empty event")
	}

	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	deadClient, err := commerce.New(closedURL, testSecretKey)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, transportErr := deadClient.RecordCommerceEvent(context.Background(), validEvent())
	if transportErr == nil {
		t.Fatal("RecordCommerceEvent(...) against a closed server returned no error")
	}

	for _, tc := range []struct {
		name string
		got  string
	}{
		{"APIError.Error", apiErr.Error()},
		{"InvalidEventError.Error", localErr.Error()},
		{"TransportError.Error", transportErr.Error()},
		{"TransportError unwrapped", fmt.Sprintf("%v", errors.Unwrap(transportErr))},
		{"Client %v", fmt.Sprintf("%v", client)},
		{"Client %+v", fmt.Sprintf("%+v", client)},
		{"Client %#v", fmt.Sprintf("%#v", client)},
		{"Client %s", fmt.Sprintf("%s", client)},
		{"Client dereferenced %v", fmt.Sprintf("%v", *client)},
		{"Client dereferenced %+v", fmt.Sprintf("%+v", *client)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if strings.Contains(tc.got, testSecretKey) {
				t.Errorf("%s = %q, which contains the secret key", tc.name, tc.got)
			}
			// Not even a fragment of it. A prefix or a length is still a
			// credential oracle.
			if strings.Contains(tc.got, "not-a-real-key") {
				t.Errorf("%s = %q, which contains part of the secret key", tc.name, tc.got)
			}
		})
	}
}

func TestNew(t *testing.T) {
	for _, tc := range []struct {
		name      string
		apiURL    string
		secretKey string
		opts      []commerce.Option
		wantErr   error
	}{
		{name: "origin and secret key", apiURL: "https://chat.example.com", secretKey: testSecretKey},
		{name: "trailing slash tolerated", apiURL: "https://chat.example.com/", secretKey: testSecretKey},
		{name: "empty apiURL", secretKey: testSecretKey, wantErr: commerce.ErrMissingAPIURL},
		{name: "empty secret key", apiURL: "https://chat.example.com", wantErr: commerce.ErrMissingSecretKey},
		{
			name:      "publishable key where a secret key belongs",
			apiURL:    "https://chat.example.com",
			secretKey: "dhp_" + "live_" + "not-a-real-key",
			wantErr:   commerce.ErrPublishableKeyAsSecret,
		},
		{
			name:      "base path without a leading slash",
			apiURL:    "https://chat.example.com",
			secretKey: testSecretKey,
			opts:      []commerce.Option{commerce.WithBasePath("chat-services/api/v1")},
			wantErr:   commerce.ErrInvalidBasePath,
		},
		{
			name:      "custom base path",
			apiURL:    "https://gateway.example.com",
			secretKey: testSecretKey,
			opts:      []commerce.Option{commerce.WithBasePath("/chat/v1")},
		},
		{
			name:      "nil http client falls back to the default",
			apiURL:    "https://chat.example.com",
			secretKey: testSecretKey,
			opts:      []commerce.Option{commerce.WithHTTPClient(nil)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, err := commerce.New(tc.apiURL, tc.secretKey, tc.opts...)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("New(%q, ...) error = %v, want %v", tc.apiURL, err, tc.wantErr)
			}
			if tc.wantErr == nil && client == nil {
				t.Error("New(...) returned a nil client and a nil error")
			}
			if tc.wantErr != nil && client != nil {
				t.Error("New(...) returned a client alongside an error")
			}
		})
	}
}

// TestWithBasePath proves the option reaches the wire, since a base path that
// compiles but is never applied 404s every call while looking correct.
func TestWithBasePath(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true,"data":{"eventId":"evt_1","type":"order.cancelled","contactId":"ct_1","applied":true}}`))
	}))
	defer srv.Close()

	client, err := commerce.New(srv.URL, testSecretKey, commerce.WithBasePath("/gateway/chat"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := client.RecordCommerceEvent(context.Background(), validEvent()); err != nil {
		t.Fatalf("RecordCommerceEvent: %v", err)
	}
	const want = "/gateway/chat/contacts/commerce-events"
	if gotPath != want {
		t.Errorf("request path = %q, want %q", gotPath, want)
	}
}

// TestWithHTTPClient proves the supplied Doer is the one that sends, which is
// the seam retries, tracing and timeouts hang off.
func TestWithHTTPClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true,"data":{"eventId":"evt_1","type":"order.cancelled","contactId":"ct_1","applied":true}}`))
	}))
	defer srv.Close()

	counter := &countingDoer{inner: http.DefaultClient}
	client, err := commerce.New(srv.URL, testSecretKey, commerce.WithHTTPClient(counter))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := client.RecordCommerceEvent(context.Background(), validEvent()); err != nil {
		t.Fatalf("RecordCommerceEvent: %v", err)
	}
	if counter.calls != 1 {
		t.Errorf("supplied Doer saw %d requests, want 1", counter.calls)
	}
}

type countingDoer struct {
	inner *http.Client
	calls int
}

func (d *countingDoer) Do(req *http.Request) (*http.Response, error) {
	d.calls++
	return d.inner.Do(req)
}

// TestRecordCommerceEventRejectsNilEvent covers the nil interface, which would
// otherwise panic on the first method call.
func TestRecordCommerceEventRejectsNilEvent(t *testing.T) {
	client, got := newServer(t, okHandler(true))

	_, err := client.RecordCommerceEvent(context.Background(), nil)
	var invalid *commerce.InvalidEventError
	if !errors.As(err, &invalid) {
		t.Fatalf("RecordCommerceEvent(ctx, nil) error = %T (%v), want *commerce.InvalidEventError", err, err)
	}
	if got.body != nil {
		t.Error("a nil event still reached the wire; local validation must run first")
	}
}

// validEvent is an event that passes every client-side check, for tests whose
// subject is the response rather than the request.
func validEvent() commerce.Event {
	return commerce.OrderCancelled{
		EventID:    "evt_order_9f2a1e",
		OccurredAt: time.Date(2026, 8, 21, 10, 15, 0, 0, time.UTC),
		CustomerID: "cust_8f2a1e",
		OrderID:    "ord_5591",
	}
}
