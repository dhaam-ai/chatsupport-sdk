package tests

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
)

// TestLiveMintToken talks to a real chat-service. It is skipped unless both
// env vars are set, because CI has no backend and a test that needs one would
// either be permanently red or quietly deleted.
//
// Run it against the demo backend with:
//
//	set -a; . examples/demo/.env; set +a
//	CHAT_LIVE_API_URL="$CHAT_API_URL" CHAT_LIVE_SECRET_KEY="$CHAT_SECRET_KEY" \
//	  go test ./tests/... -run TestLiveMintToken -v
//
// CHAT_LIVE_API_URL is the *origin* (http://localhost:3000). If you paste a
// URL that already includes /chat-services/api/v1 the request goes to
// /chat-services/api/v1/chat-services/api/v1/tokens and 404s -- which is the
// same class of mistake ResolveBaseURL exists to prevent, and why this test
// asserts on the minted token rather than merely on "no error".
func TestLiveMintToken(t *testing.T) {
	apiURL := os.Getenv("CHAT_LIVE_API_URL")
	secret := os.Getenv("CHAT_LIVE_SECRET_KEY")
	if apiURL == "" || secret == "" {
		t.Skip("set CHAT_LIVE_API_URL and CHAT_LIVE_SECRET_KEY to run the live check")
	}

	client, err := chatapi.NewClient(
		chatapi.ResolveBaseURL(apiURL),
		staticCredentials{secretKey: secret},
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	res, err := client.MintToken(context.Background(), &chatapi.MintTokenRequest{
		UserID: "t19-live-check",
	})
	if err != nil {
		t.Fatalf("MintToken against %s: %v", chatapi.ResolveBaseURL(apiURL), err)
	}

	minted, ok := res.(*chatapi.MintTokenResponse)
	if !ok {
		// An *ErrorStatusCode here means the server answered but rejected us;
		// its ErrorCode says which of the spec's failure modes it was.
		t.Fatalf("MintToken returned %T, want *chatapi.MintTokenResponse: %+v", res, res)
	}

	// A JWT, not just a non-empty string: the spec says this is the token the
	// browser SDK hands to getToken(), and "" would satisfy a length check.
	if parts := strings.Split(minted.AccessToken, "."); len(parts) != 3 {
		t.Errorf("accessToken has %d dot-separated parts, want 3 (a JWT)", len(parts))
	}
	if minted.ExpiresIn <= 0 {
		t.Errorf("expiresIn = %d, want a positive lifetime", minted.ExpiresIn)
	}
	t.Logf("minted a %d-second token from %s", minted.ExpiresIn, chatapi.ResolveBaseURL(apiURL))
}
