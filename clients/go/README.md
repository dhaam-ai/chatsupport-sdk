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

## Tests

```bash
cd clients/go && go test ./...
```

They check what the generator cannot: that requests actually leave for
`/chat-services/api/v1/...`, and that browser-facing endpoints carry both
credentials. Set `CHAT_LIVE_API_URL` and `CHAT_LIVE_SECRET_KEY` to also mint
against a real backend.
