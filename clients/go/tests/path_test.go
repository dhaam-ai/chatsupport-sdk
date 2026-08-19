// Package tests holds the checks that the *generated* Go client is wired the
// way the spec says. It is deliberately outside clients/go/chatapi, which
// generate.sh deletes and recreates wholesale on every run.
package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
)

// staticCredentials is the SecuritySource every consumer has to write for
// themselves -- the generated client declares the interface and never
// implements it. It lives in the test rather than in the shipped package on
// purpose: see clients/README.md, "What you still have to write".
type staticCredentials struct {
	secretKey      string
	accessToken    string
	publishableKey string
}

func (c staticCredentials) SecretKey(context.Context, chatapi.OperationName) (chatapi.SecretKey, error) {
	return chatapi.SecretKey{Token: c.secretKey}, nil
}

func (c staticCredentials) AccessToken(context.Context, chatapi.OperationName) (chatapi.AccessToken, error) {
	return chatapi.AccessToken{Token: c.accessToken}, nil
}

func (c staticCredentials) PublishableKey(context.Context, chatapi.OperationName) (chatapi.PublishableKey, error) {
	return chatapi.PublishableKey{APIKey: c.publishableKey}, nil
}

// TestMintTokenHitsSpecBasePath is the check this whole package exists for.
//
// ogen's NewClient takes a server URL and does not consult the spec's
// `servers` block at all, so nothing in the generated code guarantees a
// request lands under /chat-services/api/v1. The spec used to say
// `{apiUrl}/v1` -- a path chat-service does not serve -- and a client
// generated from it would have compiled, type-checked and 404'd on every
// call. This asserts the literal path that leaves the client.
func TestMintTokenHitsSpecBasePath(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"accessToken":"header.body.signature","expiresIn":3600}`))
	}))
	defer srv.Close()

	client, err := chatapi.NewClient(
		chatapi.ResolveBaseURL(srv.URL),
		staticCredentials{secretKey: "dhk_" + "test_" + "not-a-real-key"},
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	res, err := client.MintToken(context.Background(), &chatapi.MintTokenRequest{UserID: "u_1"})
	if err != nil {
		t.Fatalf("MintToken: %v", err)
	}
	minted, ok := res.(*chatapi.MintTokenResponse)
	if !ok {
		t.Fatalf("MintToken returned %T, want *chatapi.MintTokenResponse", res)
	}
	if minted.ExpiresIn != 3600 {
		t.Errorf("ExpiresIn = %d, want 3600", minted.ExpiresIn)
	}

	const wantPath = "/chat-services/api/v1/tokens"
	if gotPath != wantPath {
		t.Errorf("request path = %q, want %q\n"+
			"Every route on chat-service is mounted under %s. A client that\n"+
			"drops it 404s on every call while looking correct.",
			gotPath, wantPath, chatapi.BasePath)
	}

	// The spec makes the secret key the credential on POST /tokens and only
	// there. If ogen ever stopped wiring securitySecretKey into this
	// operation the call above would still "work" against a mock, so check
	// the header actually went out.
	if !strings.HasPrefix(gotAuth, "Bearer ") || len(gotAuth) <= len("Bearer ") {
		t.Errorf("Authorization header = %q, want a non-empty Bearer credential", gotAuth)
	}
}

// TestSessionEndpointsSendBothCredentials pins the auth model the spec spends
// a page on: every browser-facing endpoint needs the access token *and* the
// publishable key, never either alone (PRD 10.1). ogen wires both from the
// per-operation `security` block; nothing else in this repo would notice if
// that regressed to one.
func TestSessionEndpointsSendBothCredentials(t *testing.T) {
	var gotPath, gotAuth, gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotKey = r.Header.Get("X-Publishable-Key")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"sessions":[],"hasMore":false}`))
	}))
	defer srv.Close()

	client, err := chatapi.NewClient(
		chatapi.ResolveBaseURL(srv.URL),
		staticCredentials{
			accessToken:    "header.body.signature",
			publishableKey: "dhp_" + "test_" + "not-a-real-key",
		},
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	if _, err := client.ListSessions(context.Background(), chatapi.ListSessionsParams{}); err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	if want := "/chat-services/api/v1/sessions"; gotPath != want {
		t.Errorf("request path = %q, want %q", gotPath, want)
	}
	if gotAuth != "Bearer header.body.signature" {
		t.Errorf("Authorization = %q, want the access token", gotAuth)
	}
	if gotKey == "" {
		t.Error("X-Publishable-Key was not sent; the spec requires it alongside the access token on every browser-facing endpoint")
	}
}

func TestResolveBaseURL(t *testing.T) {
	for _, tc := range []struct {
		name   string
		apiURL string
		want   string
	}{
		{"origin", "https://chat.example.com", "https://chat.example.com/chat-services/api/v1"},
		{"trailing slash", "https://chat.example.com/", "https://chat.example.com/chat-services/api/v1"},
		{"explicit port", "http://localhost:3000", "http://localhost:3000/chat-services/api/v1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := chatapi.ResolveBaseURL(tc.apiURL); got != tc.want {
				t.Errorf("ResolveBaseURL(%q) = %q, want %q", tc.apiURL, got, tc.want)
			}
		})
	}
}
