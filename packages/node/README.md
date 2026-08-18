# `@dhaam-ccrm/node`

**This package holds your secret key. It runs on your own server and must never be bundled into a browser, a mobile app, or any client you ship.**

Your `dhsk_live_…` / `dhsk_test_…` secret key mints access tokens for *any* of your users. Anyone who obtains it can impersonate every customer in your tenant. If it reaches a client bundle it is in your users' browsers, your source maps, and your CDN — and the only remedy is rotation.

If you are looking for the SDK that runs in a browser, you want **`@dhaam-ccrm/core`**. It takes a *publishable* key (`dhpk_live_…`), which identifies a tenant and grants nothing on its own.

| | `@dhaam-ccrm/core` | `@dhaam-ccrm/node` |
|---|---|---|
| Runs in | the browser | your server |
| Credential | `dhpk_…` publishable | `dhsk_…` secret |
| Safe to ship to users | yes | **no** |

There is **no dependency edge between these two packages, in either direction.** That is deliberate: such an edge is exactly how a secret key ends up in a bundle. A few type declarations are duplicated instead.

## Install

```sh
npm install @dhaam-ccrm/node
```

Node 18 or newer. Zero runtime dependencies — `fetch` and `crypto.timingSafeEqual` are both built in.

## Minting a token

The browser never calls chat-service's token endpoint. It calls **an endpoint of your own**, which authenticates the user however you already do, then mints a token and relays only that back.

```ts
import { ChatServerClient } from '@dhaam-ccrm/node';

const chat = new ChatServerClient({
  apiUrl: process.env.CHAT_API_URL!,      // origin only, e.g. https://chat.example.com
  secretKey: process.env.CHAT_SECRET_KEY!, // dhsk_live_… — from the environment, never source
});

app.post('/token', requireLogin, async (req, res) => {
  const { accessToken, expiresIn } = await chat.mintToken({
    // Your session decides who this is. NEVER req.body.userId.
    userId: req.user.id,
    name: req.user.name,
    claims: { planTier: req.user.plan },
  });
  res.json({ accessToken, expiresIn });
});
```

> **The one mistake that matters here.** `userId` is taken on trust — it becomes the token's subject. An endpoint that forwards a browser-supplied `userId` unchecked lets any visitor mint a token for any user and read their conversations. Establish identity from your own session before calling `mintToken`.

Retrying after a timeout is always safe: minting has no persisted side effect, and each call produces a fresh, independent token.

## Verifying webhooks

Anyone can POST to a public webhook URL. The signature is the *entire* proof that a delivery came from us, so verify every one.

```ts
import express from 'express';
import { isKnownWebhookEvent } from '@dhaam-ccrm/node';

app.post('/webhooks/chat',
  express.raw({ type: 'application/json' }),  // ← the RAW body, not express.json()
  (req, res) => {
    let event;
    try {
      event = chat.constructWebhookEvent({
        payload: req.body,                                   // Buffer of raw bytes
        signatureHeader: req.header('X-ChatSDK-Signature')!,
      });
    } catch {
      return res.sendStatus(400);
    }

    // Delivery is AT-LEAST-ONCE. Dedupe on event.id before doing anything
    // that writes to your systems.
    if (!isKnownWebhookEvent(event)) return res.sendStatus(204);

    switch (event.type) {
      case 'message.created':
        console.log(event.data.content);  // narrowed to ChatMessage
        break;
      case 'session.closed':
        console.log(event.data.closeReason);
        break;
    }
    res.sendStatus(204);
  });
```

**You must pass the raw body.** `JSON.stringify(JSON.parse(body))` is not `body` — key order, escaping and number formatting all differ — so verification against a re-parsed object cannot succeed. This SDK refuses an already-parsed object with an error naming the fix rather than appearing to work.

### The contract

```
X-ChatSDK-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256>
```

The signed payload is `${t}.${rawBody}`, HMAC-SHA256'd with your secret key.

**Replay tolerance: 300 seconds (5 minutes), applied in both directions** — a delivery is rejected if `t` is more than five minutes *before or after* the receiving host's clock. Override with `toleranceSeconds`.

Both halves of that are load-bearing:

- **Five minutes** balances two real failures. Tighter, and ordinary NTP drift or a delivery that sat in a retry queue gets rejected as forged. Looser, and a captured delivery stays replayable for the length of the window.
- **Both directions.** Rejecting only *stale* timestamps would leave a far-future delivery valid indefinitely, turning one captured request into a permanent forgery.

The window is enforceable at all only because `t` is *inside* the MAC. If the body alone were signed, an attacker could rewrite `t` to "now" and the signature would still verify — the timestamp would be decorative.

Comparison is constant-time, with no exceptions. Both operands are SHA-256 digested before `timingSafeEqual`, because that function **throws on a length mismatch and the throw is itself a length oracle**. Digesting makes both sides a fixed 32 bytes so the comparison is unconditional and total for any input. (A naive `===` would be worse still: it short-circuits at the first differing byte, letting an attacker recover a valid signature one byte at a time.)

Your clock matters. A host drifted more than five minutes will reject every legitimate delivery.

## Paginating history

`for await` over the cursor shapes, rather than hand-rolling `before`/`hasMore`:

```ts
const user = chat.asUser(accessToken);   // needs publishableKey on the client too

for await (const message of user.messages(sessionId)) {
  console.log(message.content);
}

// or page by page
for await (const page of user.messagePages(sessionId, { limit: 50, maxPages: 10 })) {
  console.log(page.items.length, page.hasMore);
}
```

History is backward-cursored: pages walk from newest to oldest, and each page is in ascending chronological order (oldest first) so it prepends to a UI list without re-sorting. Iteration terminates on `hasMore: false`, on an empty page, and on a cursor that stops advancing — relying on `hasMore` alone means trusting a remote server to end your loop.

`asUser` requires the **publishable** key as well, because every session and message route needs both credentials. The secret key is valid on `POST /tokens` and nowhere else; `asUser` never sees it.

## Public surface

| Export | Purpose |
|---|---|
| `ChatServerClient` | Holds the secret key. Mints tokens, verifies webhooks. |
| `UserScopedClient` | Read surface for one user, via `chat.asUser(token)`. |
| `mintAccessToken`, `buildMintTokenBody` | Functional form of token minting. |
| `constructWebhookEvent` | Verify a delivery **and** return its typed event. Preferred. |
| `assertWebhookSignature` / `verifyWebhookSignature` | Throwing / boolean signature check. |
| `signWebhookPayload` | Produce a signature — for testing *your* handler. |
| `isKnownWebhookEvent` | Narrow a received event to the known catalog. |
| `DEFAULT_TOLERANCE_SECONDS` | `300`. |
| `paginate`, `flatten`, `listMessagePages`, `listMessages` | Cursor iteration. |
| `parseSecretKey`, `isSecretKey`, `secretKeyEnvironment`, `maskSecretKey` | Key handling. |
| `ChatApiError`, `ChatTransportError` | Server verdict vs. never reached the server. |
| `InvalidSecretKeyError`, `PublishableKeyAsSecretError`, `WebhookVerificationError`, `InvalidMintRequestError` | Typed failures. |
| `BASE_PATH`, `HttpClient` | `/chat-services/api/v1`, and the low-level request layer. |

### Errors

`ChatApiError` means the server evaluated your request and said no — retrying it unchanged is usually pointless. `ChatTransportError` means the request never produced a verdict (DNS, connection refused, TLS, abort) and retrying is exactly right. They are separate types because collapsing them is how a client retries a rejected request forever, or gives up on a transient blip.

**No error raised by this package contains credential material** — not a secret key, an access token, a signature, nor any prefix, length or digest of one. This package is the one place where an `Error` reaching your error tracker would be a credential-exfiltration path with a stack trace attached. `ChatServerClient` also redacts its key from `JSON.stringify` and `console.log`, so logging your config object at startup does not write the key to disk.

Note that a `401` from `POST /tokens` is deliberately uninformative: the service returns the **same** status, code and message for an unknown key, a revoked key, a wrong-type key, and a malformed one, so there is no oracle to enumerate against. It cannot tell you which check failed. That is why this SDK validates the key's format locally, at construction, where a specific diagnosis is possible.

---

## Spec vs. implementation drift

Checked against `openapi/chat-api.yaml` and the running service at `chat-service-node`. Reported rather than silently resolved — this project has already shipped two bugs that were green on both sides of a disagreement.

**They agree on everything this package depends on:** the `POST /chat-services/api/v1/tokens` route and its prefix, the `Bearer dhsk_…` credential, the `201 { accessToken, expiresIn }` body, the `{ error: { code, message, retryable } }` failure shape, and the `dhpk_`/`dhsk_` key format with its 32–64 character body.

Four disagreements found:

1. **The webhook surface is specified but not implemented.** The spec defines four webhook events, the `X-ChatSDK-Signature` contract, and three companion headers. The service contains **no webhook implementation at all** — no `createHmac` call, no file matching `webhook`, nothing. This package implements the receiver's half exactly as specified, but nothing currently sends a delivery for it to verify. *Whoever implements the sender must match `${t}.${rawBody}` byte-for-byte;* the tests here include an independently computed HMAC that pins the scheme.

2. **Session and message routes sit at a different path than the spec declares.** The spec declares `/sessions`, `/sessions/{id}/messages`, `/sessions/{id}/close`. The service serves `/chat/sessions`, `/chat/sessions/:id/messages` — with a `/chat` segment the spec does not have. This is the same class of defect as the already-fixed `{apiUrl}/v1` base path: an OpenAPI path no route serves. This package implements the **spec** path, consistent with `@dhaam-ccrm/rest`, so pagination will 404 against the current service until one side moves. Token minting is unaffected.

3. **Those routes also return a different envelope.** The spec's `MessagePage` is a bare `{ messages, hasMore }`; the service returns `{ success: true, data: { messages, hasMore } }` — v1's envelope, which `token.routes.ts` explicitly opted out of for v2. The pagination iterator raises a named error rather than yielding an empty page if it meets the v1 envelope, so this fails loudly instead of reporting a session as having no history.

4. **The reserved-claim list is longer than the spec says.** The spec names six reserved claims (`sub`, `iat`, `exp`, `iss`, `aud`, `tenantId`). The service enforces fifteen, adding `nbf`, `jti`, `env`, `roles`, `roleId`, `userId`, `userName`, `scope`. A customer trusting the document who sends `roles` or `scope` gets a `400`. This package mirrors the **service's** list so the rejection is local and names the offending claim.

Items 2 and 3 are the ones to resolve before the read surface can be used against a live deployment.
