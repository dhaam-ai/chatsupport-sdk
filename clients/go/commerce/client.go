package commerce

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
)

// Configuration failures from [New]. They are sentinels rather than a typed
// error because there is nothing to carry: naming which check failed is the
// whole diagnosis, and anything more would mean echoing the offending value.
var (
	// ErrMissingAPIURL is returned when apiURL is empty.
	ErrMissingAPIURL = errors.New("commerce: apiURL is required (the chat-service origin, scheme and host only)")

	// ErrMissingSecretKey is returned when secretKey is empty.
	ErrMissingSecretKey = errors.New("commerce: secretKey is required")

	// ErrPublishableKeyAsSecret is returned when a publishable key is supplied
	// where a secret key belongs.
	//
	// Its own sentinel, because the mix-up runs in BOTH directions and the
	// other direction is an incident: whatever put the publishable key on the
	// server may well have put the secret key in a client bundle. It also
	// simply cannot work — a publishable key grants nothing on its own, and
	// this route accepts only a secret key, so the request would fail at the
	// server with a deliberately uninformative 401. Failing here, in the
	// caller's own process, is the only place a specific diagnosis can be
	// given at all.
	ErrPublishableKeyAsSecret = errors.New("commerce: a publishable key (dhp_live_.../dhp_test_...) was supplied where a secret key (dhk_live_.../dhk_test_...) is required; " +
		"if the two were swapped, check whether the secret key was also shipped to a client bundle, and rotate it if so. " +
		"The offending value is deliberately omitted from this message")

	// ErrInvalidBasePath is returned when [WithBasePath] is given a path that
	// does not start with a slash. It is refused rather than repaired: the
	// base path is the one thing that is easy to get wrong and silent about
	// it, since a client that drops it 404s on every call while looking
	// correct.
	ErrInvalidBasePath = errors.New("commerce: base path must start with \"/\"")

	// errWrongCredential is what the internally-supplied SecuritySource
	// answers for the three credentials this package does not hold. It is
	// unreachable through [Client.RecordCommerceEvent], whose one operation
	// needs only the secret key; it exists so that a future operation wired to
	// the wrong credential fails loudly here rather than sending an empty
	// header and reading the server's generic 401.
	errWrongCredential = errors.New("commerce: this client holds only a tenant secret key")
)

// A Doer sends an HTTP request and returns its response. [*http.Client]
// satisfies it, and so does any wrapper adding retries, tracing or rate
// limiting around one.
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// An Option configures a [Client]. See [WithHTTPClient] and [WithBasePath].
type Option interface {
	apply(*options)
}

type options struct {
	doer     Doer
	basePath string
}

type httpClientOption struct{ doer Doer }

func (o httpClientOption) apply(opts *options) { opts.doer = o.doer }

// WithHTTPClient sets the HTTP client used for every request. Defaults to
// [http.DefaultClient].
//
// This is the seam for everything this package deliberately does not do:
// retries and backoff, connect and request timeouts, tracing, metrics,
// per-host connection limits. Wrap an [*http.Client] or supply your own
// [Doer]. A nil Doer is ignored, leaving the default in place.
//
//	commerce.WithHTTPClient(&http.Client{Timeout: 10 * time.Second})
func WithHTTPClient(doer Doer) Option { return httpClientOption{doer: doer} }

type basePathOption string

func (o basePathOption) apply(opts *options) { opts.basePath = string(o) }

// WithBasePath overrides the path every route is mounted under. Defaults to
// [chatapi.BasePath], which is emitted from the spec's servers block during
// generation — the same value [chatapi.ResolveBaseURL] appends.
//
// Only for a gateway that fronts chat-service somewhere other than where the
// spec says it lives. Supplying a base path the deployment does not serve
// 404s every call, so this is not a knob to turn speculatively. It must start
// with a slash; anything else is [ErrInvalidBasePath].
func WithBasePath(basePath string) Option { return basePathOption(basePath) }

// redactedSecret is a string that refuses to print itself. Struct printing walks
// exported fields with the verb it was given, so a plain string field here
// would put a live credential into any %v of a value that reaches it.
type redactedSecret string

// String reports a fixed placeholder. It never derives anything from the key
// — not a prefix, not a length, not a digest.
func (redactedSecret) String() string { return "[REDACTED]" }

// GoString reports the same placeholder for %#v.
func (redactedSecret) GoString() string { return `"[REDACTED]"` }

// credentials is the chatapi.SecuritySource a caller would otherwise have to
// write for themselves. The generated client declares that interface with
// four methods and never implements it, and ogen calls whichever one the
// operation's security block names — so sending a single commerce event
// costs four hand-written methods, three of which are for credentials the
// sender does not have. Supplying it here is most of the reason this package
// exists.
type credentials struct {
	key redactedSecret
}

var _ chatapi.SecuritySource = credentials{}

// SecretKey supplies the one credential POST /contacts/commerce-events takes.
func (c credentials) SecretKey(context.Context, chatapi.OperationName) (chatapi.SecretKey, error) {
	return chatapi.SecretKey{Token: string(c.key)}, nil
}

// AccessToken refuses: a customer JWT is not something this client holds, and
// the secret key is never a substitute for one.
func (c credentials) AccessToken(context.Context, chatapi.OperationName) (chatapi.AccessToken, error) {
	return chatapi.AccessToken{}, errWrongCredential
}

// PublishableKey refuses: see [credentials.AccessToken].
func (c credentials) PublishableKey(context.Context, chatapi.OperationName) (chatapi.PublishableKey, error) {
	return chatapi.PublishableKey{}, errWrongCredential
}

// StaffToken refuses. The staff-token routes — the Contacts CRM five, and the
// admin commerce path — additionally require the admin role, and no secret
// key satisfies either half.
func (c credentials) StaffToken(context.Context, chatapi.OperationName) (chatapi.StaffToken, error) {
	return chatapi.StaffToken{}, errWrongCredential
}

// A Client records commerce events against one tenant.
//
// It is safe for concurrent use by multiple goroutines, holds no per-request
// state, and is meant to be built once and shared. Build it with [New].
type Client struct {
	api       *chatapi.Client
	serverURL string
}

// New returns a [Client] for one tenant.
//
// apiURL is the chat-service ORIGIN — scheme and host, as configured for
// every other SDK in this repo. The base path is appended for you; do not
// include it, and do not pass an already-resolved server URL.
//
// secretKey is the tenant secret key. It must never leave the caller's own
// backend: it is valid on POST /tokens and POST /contacts/commerce-events,
// it is the HMAC key for webhook signature verification, and it is
// catastrophic in a browser bundle. This package never logs it, never puts
// it in an error, and redacts it from every fmt verb applied to the returned
// Client.
//
// New performs no I/O and contacts nothing; a bad credential surfaces as
// 401 AUTH_INVALID on the first call.
//
// It returns [ErrMissingAPIURL], [ErrMissingSecretKey],
// [ErrPublishableKeyAsSecret] or [ErrInvalidBasePath] for a configuration
// mistake it can catch locally.
func New(apiURL, secretKey string, opts ...Option) (*Client, error) {
	if apiURL == "" {
		return nil, ErrMissingAPIURL
	}
	if secretKey == "" {
		return nil, ErrMissingSecretKey
	}
	if strings.HasPrefix(secretKey, "dhp_") {
		return nil, ErrPublishableKeyAsSecret
	}

	o := options{basePath: chatapi.BasePath}
	for _, opt := range opts {
		opt.apply(&o)
	}
	if !strings.HasPrefix(o.basePath, "/") {
		return nil, ErrInvalidBasePath
	}

	// The default reproduces chatapi.ResolveBaseURL exactly. A trailing slash
	// on the origin is tolerated; a path segment on it is not stripped,
	// because silently discarding a path someone deliberately supplied hides
	// their mistake rather than surfacing it.
	serverURL := strings.TrimRight(apiURL, "/") + o.basePath

	var clientOpts []chatapi.ClientOption
	if o.doer != nil {
		clientOpts = append(clientOpts, chatapi.WithClient(o.doer))
	}

	api, err := chatapi.NewClient(serverURL, credentials{key: redactedSecret(secretKey)}, clientOpts...)
	if err != nil {
		return nil, fmt.Errorf("commerce: building the API client: %w", err)
	}
	return &Client{api: api, serverURL: serverURL}, nil
}

// String reports the client without its credential. Defined so that no fmt
// verb applied to a Client can walk into the security source holding the
// secret key.
//
// The receiver is a value, not a pointer, so that fmt.Sprintf("%v", *client)
// is redacted too — a pointer receiver would leave the dereferenced form
// printing its fields structurally.
func (c Client) String() string {
	return "commerce.Client{serverURL: " + c.serverURL + ", secretKey: [REDACTED]}"
}

// GoString reports the same redacted form for %#v.
func (c Client) GoString() string { return c.String() }

// A Result is what the server made of one recorded event, for both a first
// acceptance and a replay.
type Result struct {
	// EventID echoes the EventID that was sent.
	EventID string
	// Type echoes the event's wire tag.
	Type EventType
	// ContactID is the resolved contact's opaque id — the same identifier
	// GET /contacts/{id} returns as id. It is the server's id for the shopper,
	// not the CustomerID that was sent.
	ContactID string
	// Applied is false only when this EventID had already been accepted and
	// processed before — a replay, whose fields are read back from the stored
	// event rather than recomputed, with the mutation never re-applied.
	//
	// It is true on first acceptance AND on an accepted no-op, such as a
	// cart.abandoned repeated against an already-ABANDONED cart or a stale
	// out-of-order cart.updated. So Applied answers "have I seen this EventID
	// before", not "did this event change any state".
	Applied bool
}

// RecordCommerceEvent records one order or cart event.
//
// event is one of the six types in this package; see [Event]. It is validated
// locally first — the same pass [Validate] runs — so a malformed event costs
// no round trip and returns an [*InvalidEventError] naming the offending
// field rather than the server's opaque 400.
//
// # Retries
//
// Read the release-on-reject section of the package doc before wiring up
// retry logic. In short: after a 404 or 422 rejection, resend the SAME event,
// EventID included. It was never consumed. Never mint a new one.
//
// For an ACCEPTED event this call is idempotent on EventID: calling it again
// after a success returns Applied false with the original outcome, and the
// mutation is never re-applied.
//
// # Errors
//
//   - [*InvalidEventError] — refused locally; nothing was sent.
//   - [*APIError] — the server evaluated it and said no. Branch on Code, or
//     pass the error to [IsRetryableContactsError].
//   - [*TransportError] — no server verdict was reached. Always safe, and
//     correct, to retry with the same EventID.
//
// [IsRetryableContactsError] classifies all three, so an error path rarely
// needs to tell them apart itself.
func (c *Client) RecordCommerceEvent(ctx context.Context, event Event) (Result, error) {
	if event == nil {
		return Result{}, &InvalidEventError{Field: "event", Reason: "is required"}
	}
	// This is what Validate does; calling it through the same seam keeps the
	// two from ever disagreeing, and does the work once rather than twice.
	body, err := event.commerceEvent()
	if err != nil {
		return Result{}, err
	}

	res, err := c.api.RecordCommerceEvent(ctx, body)
	if err != nil {
		// Everything ogen reports as an error here is a call that produced no
		// decoded verdict: the request never landed, the context ended, or the
		// reply did not decode. The cause is held, never interpolated -- it
		// can carry a URL.
		return Result{}, &TransportError{Err: err}
	}

	switch v := res.(type) {
	case *chatapi.RecordCommerceEventOK:
		return Result{
			EventID:   v.Data.EventID,
			Type:      EventType(v.Data.Type),
			ContactID: v.Data.ContactID,
			Applied:   v.Data.Applied,
		}, nil
	case *chatapi.RecordCommerceEventBadRequest:
		return Result{}, apiError(http.StatusBadRequest, chatapi.ContactsError(*v), 0)
	case *chatapi.RecordCommerceEventUnauthorized:
		return Result{}, apiError(http.StatusUnauthorized, chatapi.ContactsError(*v), 0)
	case *chatapi.RecordCommerceEventNotFound:
		return Result{}, apiError(http.StatusNotFound, chatapi.ContactsError(*v), 0)
	case *chatapi.RecordCommerceEventUnprocessableEntity:
		return Result{}, apiError(http.StatusUnprocessableEntity, chatapi.ContactsError(*v), 0)
	case *chatapi.ContactsTooManyRequestsHeaders:
		var retryAfter time.Duration
		if seconds, ok := v.RetryAfter.Get(); ok {
			retryAfter = time.Duration(seconds) * time.Second
		}
		return Result{}, apiError(http.StatusTooManyRequests, v.Response, retryAfter)
	case *chatapi.RecordCommerceEventInternalServerError:
		return Result{}, apiError(http.StatusInternalServerError, chatapi.ContactsError(*v), 0)
	default:
		// Only reachable if the spec grows a response arm this switch predates.
		// Deliberately neither an APIError nor a TransportError, so
		// IsRetryableContactsError calls it fatal: an unrecognised outcome is
		// not something to loop on.
		return Result{}, fmt.Errorf("commerce: unrecognised response %T from POST /contacts/commerce-events", res)
	}
}

func apiError(status int, body chatapi.ContactsError, retryAfter time.Duration) *APIError {
	details, _ := body.Error.Details.Get()
	return &APIError{
		Status:     status,
		Code:       body.Error.Code,
		Message:    body.Error.Message,
		RetryAfter: retryAfter,
		Details:    details,
	}
}
