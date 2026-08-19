# `@dhaam-ccrm/node`

**This package holds your secret key. It runs on your own server and must never be bundled into a browser, a mobile app, or any client you ship.**

Your `dhk_live_…` / `dhk_test_…` secret key mints access tokens for *any* of your users. Anyone who obtains it can impersonate every customer in your tenant. If it reaches a client bundle it is in your users' browsers, your source maps, and your CDN — and the only remedy is rotation.

If you are looking for the SDK that runs in a browser, you want **`@dhaam-ccrm/core`**. It takes a *publishable* key (`dhp_live_…`), which identifies a tenant and grants nothing on its own.

| | `@dhaam-ccrm/core` | `@dhaam-ccrm/node` |
|---|---|---|
| Runs in | the browser | your server |
| Credential | `dhp_…` publishable | `dhk_…` secret |
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
  secretKey: process.env.CHAT_SECRET_KEY!, // dhk_live_… — from the environment, never source
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

The route answers with `{ success: true, data: { messages, hasMore } }` wrapped around **raw database rows** — integer enums, and the attachment still nested inside `metadata`. You never see that. The SDK takes the envelope off, decodes `senderType`/`messageType` into their names, and lifts `metadata.attachment` to `message.attachment`, which is the one canonical place this package documents it. A row it cannot decode raises `ChatApiError` with code `MALFORMED_RESPONSE` rather than yielding a half-built message: an unmapped `senderType` would otherwise attribute an agent's reply to the customer reading it.

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
| `toMessagePage`, `toChatMessage`, `unwrapEnvelope`, `normalizeMediaType` | The wire seam — for calling a chat route this package does not wrap. |

### Errors

`ChatApiError` means the server evaluated your request and said no — retrying it unchanged is usually pointless. `ChatTransportError` means the request never produced a verdict (DNS, connection refused, TLS, abort) and retrying is exactly right. They are separate types because collapsing them is how a client retries a rejected request forever, or gives up on a transient blip.

**No error raised by this package contains credential material** — not a secret key, an access token, a signature, nor any prefix, length or digest of one. This package is the one place where an `Error` reaching your error tracker would be a credential-exfiltration path with a stack trace attached. `ChatServerClient` also redacts its key from `JSON.stringify` and `console.log`, so logging your config object at startup does not write the key to disk.

Note that a `401` from `POST /tokens` is deliberately uninformative: the service returns the **same** status, code and message for an unknown key, a revoked key, a wrong-type key, and a malformed one, so there is no oracle to enumerate against. It cannot tell you which check failed. That is why this SDK validates the key's format locally, at construction, where a specific diagnosis is possible.

---

## Spec vs. implementation drift

Checked against `openapi/chat-api.yaml` and the running service at `chat-service-node`. Reported rather than silently resolved — this project has already shipped two bugs that were green on both sides of a disagreement.

**They agree on everything this package depends on:** the `POST /chat-services/api/v1/tokens` route and its prefix, the `Bearer dhk_…` credential, the `201 { accessToken, expiresIn }` body, the `{ error: { code, message, retryable } }` failure shape, and the `dhp_`/`dhk_` key format with its 32–64 character body.

Four disagreements found. Two of them — 2 and 3 — were live defects in this package and are now fixed here; the remaining two are open, and neither blocks use.

1. **The webhook surface is specified but not implemented.** The spec defines four webhook events, the `X-ChatSDK-Signature` contract, and three companion headers. The service contains **no webhook implementation at all** — no `createHmac` call, no file matching `webhook`, nothing. This package implements the receiver's half exactly as specified, but nothing currently sends a delivery for it to verify. *Whoever implements the sender must match `${t}.${rawBody}` byte-for-byte;* the tests here include an independently computed HMAC that pins the scheme.

2. **Session and message routes sit at a different path than the spec declares.** *(Fixed in this package.)* The spec declares `/sessions`, `/sessions/{id}/messages`, `/sessions/{id}/close`. The service serves `/chat/sessions`, `/chat/sessions/:id/messages` — with a `/chat` segment the spec does not have. This is the same class of defect as the already-fixed `{apiUrl}/v1` base path: an OpenAPI path no route serves.

   This package used to build the **spec** path, so every call to `messages()` or `messagePages()` 404'd against a real deployment. It now builds `GET /chat-services/api/v1/chat/sessions/{sessionId}/messages` — the route the service actually serves — pinned as a literal string in `test/pagination.test.ts`. The spec is still wrong and still needs correcting; this package no longer waits on it. Token minting was never affected.

3. **Those routes also return a different envelope, around raw rows.** *(Fixed in this package.)* The spec's `MessagePage` is a bare `{ messages, hasMore }` of projected messages; the service returns `{ success: true, data: { messages, hasMore } }` — v1's envelope, which `token.routes.ts` explicitly opted out of for v2 — wrapped around raw Prisma rows.

   Raw is the part that mattered more than the envelope. The WebSocket path projects its payloads; the REST path does not, so a row arrives with `senderType: 1` instead of `'CUSTOMER'` and with its attachment still at `metadata.attachment`, which is where the socket's own projection lifts it from. This package declared the lifted, decoded shape and had nothing producing it, so history would have come back undecoded and **every reloaded image would have silently lost its attachment**. `src/wire.ts` now unwraps, decodes and lifts; see *Paginating history* above.

4. **The reserved-claim list is longer than the spec says.** The spec names six reserved claims (`sub`, `iat`, `exp`, `iss`, `aud`, `tenantId`). The service enforces fifteen, adding `nbf`, `jti`, `env`, `roles`, `roleId`, `userId`, `userName`, `scope`. A customer trusting the document who sends `roles` or `scope` gets a `400`. This package mirrors the **service's** list so the rejection is local and names the offending claim.

Items 2 and 3 were resolved on this side, in favour of the running service — it is the authority on what it serves, and a spec no route implements cannot be the thing a client is built against. Both still need fixing in `openapi/chat-api.yaml`, which is what generates the Python and Go clients; until that happens those clients carry the same two defects this package just shed. Item 1 blocks nothing (there is simply nothing sending webhooks yet) and item 4 is already handled locally.

**On duplication with `@dhaam-ccrm/rest`.** That package solved the same envelope, the same integer enums and the same attachment lift for the browser, and this package deliberately does not import them: the dependency edge from the secret-key holder to a package that ships in a client bundle is the mechanism this whole split exists to prevent, and `test/packaging.test.ts` fails the build if one appears in `dependencies`, `peerDependencies`, `devDependencies`, or any import specifier under `src/`. The projection would not have been reusable as-is regardless — rest's targets `@dhaam-ccrm/core`'s vocabulary, renaming `chatSessionId`/`messageType` and dropping `replyToMessage`, all three of which this package's public `ChatMessage` declares differently.

The genuinely shared part is the integer enum tables. Both packages mirror one upstream file, `chat-service-node/src/shared/constants/enums.ts`, rather than each other, and every entry is pinned as a literal in `test/wire.test.ts`. That is what keeps two copies honest without an edge between them — but it is two copies, and a renumbered enum has to land in both.
