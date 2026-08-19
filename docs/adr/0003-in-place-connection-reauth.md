# ADR-0003 — Token refresh happens in place, on the open socket

- **Status:** Accepted 2026-08-17. Implemented in `@dhaam-ccrm/core`
  (`connection/controller.ts`, `connection/refresh.ts`) with transparent reconnect
  retained as the fallback path.
- **Decision record:** PRD §0.5 **D3**. Closes Open Question 3 (§18).
- **Supersedes:** v1's static token and its page-reload recovery.

## Context

v1's auth was a static token passed into config by value, and it had no refresh
mechanism at all. The evidence:

**The token was sent three redundant ways, then a fourth.** On WebSocket connect it went
in the `auth` object *and* in `query` string params, and then again in the payload of
**every** `message.send` (PRD §12.6). One credential, four placements, no single
authority over which one the server actually reads.

**Expiry was detected by string-matching prose.** `src/client.ts:372`:

```ts
if (msg === 'TOKEN_EXPIRED' || msg.toLowerCase().includes('expired')) {
```

Any error message containing the substring "expired" — including one about an expired
*session*, or a backend phrasing change — took the token-expiry branch.

**Recovery was a page reload.** On expiry the client set `tokenExpired`, blocked further
sends (`src/client.ts:426, :470`), and emitted a message reading "Please refresh to
continue." There was no other path back: the token was a config value, and config values
do not refresh themselves.

**The transports disagreed with each other.** REST used `Authorization: Bearer` plus an
`X-Tenant-ID` header; WS used a `tenantId` **query param**; the file-upload endpoint used
Bearer with **no** tenant header at all (PRD §12.6, §12.10). Three conventions in one SDK.

The operational failure mode this sets up is worth naming: tokens minted by the same auth
system tend to expire on the same boundary. Under v1, every affected tab must be reloaded
by a human. Under a naive fix — "reconnect to refresh" — every affected client
reconnects within the same second, which is a self-inflicted thundering herd against the
chat service.

## Decision

**Core owns token lifecycle, and refreshes the credential without tearing down the
connection.**

- `getToken()` — an async callback — is the **only** credential-supplying mechanism core
  accepts. A static token string is structurally rejected by the type signature.
- Core calls it **proactively**, by default at 80% of the token's `expiresIn`, so the
  happy path never involves a rejected request.
- Core calls it **reactively** on a server `error` with `code: 'AUTH_EXPIRED'`, as a
  fallback for clock skew and unexpectedly short-lived tokens.
- The refreshed credential is delivered by **`connection.reauth` on the same open
  socket**. The connection is not torn down.
- If in-place reauth is unavailable, core falls back to a **transparent reconnect** with
  the same resume semantics as ADR-0002. **The public API contract does not change based
  on which path ran** — the host app calls nothing and observes nothing different.
- Auth failure is bounded: `getToken()` throwing, resolving falsy, or three consecutive
  freshly-minted tokens being rejected moves the client to `suspended` (`reason: 'auth'`),
  not into a retry loop.
- Errors carry structured codes (`AUTH_INVALID` / `AUTH_EXPIRED`), so no host ever
  string-matches prose again.

## Consequences

### What this buys

- **No correlated-expiry reconnect storm.** A refresh is a frame, not a socket teardown,
  so a thousand clients whose tokens lapse on the same hour boundary produce a thousand
  frames rather than a thousand reconnects.
- **The offline queue does not engage during a normal refresh.** The socket never
  dropped, so nothing is queued, replayed, or re-deduped for a routine credential roll.
- **Recovery from expiry stops involving the user.** No reload, no "please refresh"
  banner in the default path.
- **A broken token endpoint produces a stopped client, not a hot loop.** `suspended` is a
  state the host can render and act on.

### What it costs — stated honestly

- **This is net-new backend work with zero v1 precedent.** v1's token is static for the
  socket's entire lifetime. The transparent-reconnect fallback exists precisely because
  the primary path can be absent or regress on a given deployment — and when it is,
  clients silently take the more expensive path.
- **A bare `string` from `getToken()` disables proactive refresh.** Core's native field
  is `expiresInMs`; a host returning just a token string gives core nothing to schedule
  against, so it degrades to reactive-only refresh — correct, but one failed round trip
  per expiry. This degradation is silent.
- **The seconds-vs-milliseconds trap is real and it typechecks.** Token endpoints return
  `expiresIn` in **seconds** (RFC 6749); core's field is `expiresInMs`. The obvious
  hand-written adapter turns a 3600-second token into a 3600-millisecond one and
  refreshes **every ~2.9 seconds, forever**, against your own token endpoint. It compiles
  cleanly. `createTokenProvider()` exists to make that error unwritable — but nothing
  forces anyone to use it, so it has to be the first thing the integration docs show.
- **Core never exposes the token it currently holds.** A REST client needs the same
  credential per request and has no seam to ask core for it, so every integrator keeps
  their own copy and hands it to both sides. The reference demo had to invent a
  `TokenStore` for exactly this, and that copy can lag a token core has already
  refreshed. This is the single most-cited friction point in the SDK today and it is a
  direct consequence of core owning refresh privately.
