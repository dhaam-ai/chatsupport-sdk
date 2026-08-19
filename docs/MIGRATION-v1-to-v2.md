# Migrating from v1 to v2

**Audience:** you are running the v1 React chat widget (`@chat-service/sdk`) in
production and want to move to `@dhaam-ccrm/*`.

v2 is a deliberate breaking change: a new wire protocol, a new auth model, and a new
package layout. This document tells you what changes, what disappears, and where v2 is
still incomplete — so you can decide *when* to move, not just *how*.

---

## 0. Read this first

Three things surprise almost everyone. None of them are visible from the package names.

**1. v2 ships no UI.** v1's `<ChatWidget config={…} />` rendered a complete chat bubble:
theme, header, message bubbles, file picker, quick replies, sound. **None of that exists
in v2.** `@dhaam-ccrm/react` is hooks only. `theme`, `features` and `callbacks` have no
v2 equivalent because there is nothing left to theme or toggle. A prebuilt UI package is
[deferred, possibly indefinitely](spec/chat-sdk-v2-prd.md) (PRD §13). If your integration
today is one `<ChatWidget />` tag, **budget for building the chat UI**, not for swapping
an import.

**2. You now need a server.** v1 took a token you already had. v2 requires a secret key
that never reaches a browser, which means a backend endpoint that mints tokens. A
browser-only integration is impossible by design — that is the point of the two-key model.

**3. You do not have to cut over all at once.** v1's socket.io endpoint is still running,
untouched, on its own port. v2 is a new endpoint (`/chat-services/v2/ws`) behind an opt-in
server flag. See §3.

---

## 1. The package split

One package becomes four to five.

| v1 | v2 | Notes |
|---|---|---|
| `@chat-service/sdk` | `@dhaam-ccrm/core` | Framework-agnostic. WS lifecycle, reconnect/backoff, dedup, offline queue, presence, read watermarks, token refresh, the observable state store. Zero runtime dependencies, no DOM. |
| | `@dhaam-ccrm/rest` | `fetch` adapters for the three seams core deliberately does not implement: message history, attachment upload, session reopen/close. |
| | one binding | `@dhaam-ccrm/react`, `@dhaam-ccrm/vue`, `@dhaam-ccrm/angular`, or `@dhaam-ccrm/js` (vanilla). Each is a thin mapping from core's store onto that framework's reactivity — no protocol logic of its own. |
| | `@dhaam-ccrm/node` | **Server-side.** Secret-key token minting and webhook signature verification. Holds the key that must never ship to a browser. |

Bindings are interchangeable at the behavioural level: a shared conformance suite
(`@dhaam-ccrm/binding-conformance`) asserts that every binding produces identical state
transitions for identical inputs. If React and Vue disagree, that is a bug in a binding,
not a difference you have to design around.

**A React app needs `core`, `rest`, `react` and `node`.** `@dhaam-ccrm/react` re-exports
core's *types* but not its runtime helpers, so you still need a direct `@dhaam-ccrm/core`
dependency for `createTokenProvider` (see §9).

---

## 2. Auth is the biggest change

v1 took a **static Cognito token by value** in config, and had no refresh mechanism at
all. When it expired, the client blocked sends and told the user to reload the page.

v2 splits the credential in two and gives core ownership of refresh.

- **Publishable key** — `dhp_live_…` / `dhp_test_…`. Ships in your browser bundle.
  Identifies your tenant. **Grants nothing on its own.**
- **Secret key** — `dhk_live_…` / `dhk_test_…`. **Never leaves your server.** Mints
  short-lived, scoped user tokens.

### Server side — new, you have to build this

```ts
// your-server/routes/chat-token.ts
import { ChatServerClient } from '@dhaam-ccrm/node';

const chat = new ChatServerClient({
  secretKey: process.env.CHAT_SECRET_KEY!,   // dhk_live_…  — server env only
  apiUrl: process.env.CHAT_API_URL!,         // origin only, no path
});

app.post('/api/chat-token', requireLogin, async (req, res) => {
  // Mint for the user YOUR app has already authenticated.
  // Never read the user id from the request body — that is an impersonation endpoint.
  const { accessToken, expiresIn } = await chat.mintToken({
    userId: req.session.user.id,
    name: req.session.user.name,
    email: req.session.user.email,
  });
  res.json({ accessToken, expiresIn });
});
```

Add your own CSRF protection, rate limiting and auth to that route. It is a credential
endpoint.

### Client side — `getToken`, not `token`

```ts
import { createTokenProvider } from '@dhaam-ccrm/core';

const getToken = createTokenProvider(async () => {
  const res = await fetch('/api/chat-token', { method: 'POST' });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  return res.json();            // { accessToken, expiresIn }
});
```

Core decides *when* to call it: before the first connect, before each reconnect,
proactively at 80% of the token's lifetime, and reactively if the server reports
`AUTH_EXPIRED`. Your callback's only job is to always return a **fresh** token — never a
cached one, or core reinstalls the same expiring credential forever.

> **Use `createTokenProvider`. Do not hand-roll the adapter.** Token endpoints return
> `expiresIn` in **seconds** (RFC 6749); core's native field is `expiresInMs`. The
> obvious hand-written version turns a 3600-second token into a 3600-millisecond one and
> hammers your token endpoint **every ~2.9 seconds, forever**. It typechecks. The helper
> makes that error unwritable.

### Rotation is asymmetric — and this is the operational payoff

Rotating a **secret** key is a server-side change: no client redeploy, because the secret
never shipped. Rotating a **publishable** key requires rebuilding and redeploying every
client bundle, because it is baked in at build time — including bundles already sitting
in a browser cache. Plan accordingly, and prefer rotating the secret.

Full rationale: [ADR-0003](adr/0003-in-place-connection-reauth.md).

---

## 3. What changed on the wire — and why migration is safe

**v2 speaks raw WebSocket at `/chat-services/v2/ws`. It is not socket.io.** The frame
protocol is a versioned JSON envelope (`{v, t, id, ts, d}`) designed so a Dart, Swift or
Kotlin client can implement it from spec, without inheriting a JS library's reconnect
semantics.

**v1's socket.io endpoint still runs, untouched, on its own port.** v2 is a *different
endpoint on a different port*, enabled by an opt-in server flag (`WS_V2_ENABLED=true`)
that fails closed without a provisioned publishable key. Nothing about deploying the v2
path changes v1's behaviour.

**So migration is per-client, not a flag day.** You can move one app, one route, or one
percentage of traffic at a time; run v1 and v2 clients against the same backend
simultaneously; and roll back a v2 client by redeploying the v1 bundle, with no server
change and no coordinated cutover window. There is no shared kill switch to get wrong,
because there is no shared switch. This is the property that makes the whole migration
low-risk, and it is worth using: **do not plan a big-bang cutover you do not need.**

Note the port: the v2 WebSocket is on the API port (`3000` by default), **not** the legacy
socket.io port (`3001`).

### Event-name mapping

| v1 event | v2 frame |
|---|---|
| `chat.connection.ack` | `connection.ack` — now sent after **every** hello, connect *and* reconnect |
| `chat.session.join` / `.leave` | `session.join` / `session.leave` |
| `chat.message.send` | `message.send` — the envelope `id` **is** the message id |
| `chat.message.receive` | `message.new` |
| `chat.message.ack` | generic `ack` (with `ref` pointing at the frame acknowledged) |
| `chat.message.read` / `.markRead` | `message.read` / `message.markRead` |
| `chat.status.changed` | `session.updated` |
| `chat.session.closed` | `session.closed` — with a structured `closeReason` |
| `chat.typing.start` / `.stop` / `chat.typing` / `chat.typing.indicator` | `typing.start` / `typing.stop` — **four names collapse to two**, used identically in both directions |
| `chat.presence.*` | `presence.set` / `presence.query` / `presence.update` |
| `chat.heartbeat` | see below |
| `chat.error` (prose) | `error` with a structured `code` |
| `chat.notification.new_message` | **no v2 frame.** Its purpose was not recoverable from v1; omitted rather than carried forward as dead weight. |

Two things to know that the frame catalog does not yet say:

- **Liveness is RFC 6455 ping/pong on a 25 s interval, not the `system.heartbeat` frame.**
  A WebSocket library that does not auto-pong will be dropped every 50 s while dutifully
  sending heartbeats. Browsers auto-pong; a non-browser client may not.
- `message.markDelivered` / `message.delivered` (delivery watermarks) exist server-side
  and are not in the published catalog.

---

## 4. Before / after config

### Before (v1)

```tsx
import { ChatWidget, type ChatSDKConfig } from '@chat-service/sdk';

const config: ChatSDKConfig = {
  serviceUrl: process.env.NEXT_PUBLIC_CHAT_SERVICE_URL!,  // wsUrl derived by port-swap
  tenantId: 'acme-corp',
  token: auth.accessToken,                                // static Cognito token, no refresh
  user: { id: auth.user.id, name: auth.user.name, email: auth.user.email },
  theme: { primaryColor: '#007bff', position: 'bottom-right' },
  features: { fileUpload: true, typing: true, sound: true },
  callbacks: { onMessage: (m) => {}, onError: (e) => {} },
};

<ChatWidget config={config} />;   // renders the entire UI
```

### After (v2)

```tsx
import {
  createTokenProvider,
  type ChatClientConfig, type ChatMessage, type ChatSession, type AttachmentMetadata,
} from '@dhaam-ccrm/core';
import {
  RestClient, createHistorySource, createAttachmentUploader, createSessionActions,
} from '@dhaam-ccrm/rest';
import { ChatProvider } from '@dhaam-ccrm/react';

// One place holding the current access token. Core owns *when* to refresh; the REST
// adapters need the same token per request and core does not expose the one it holds.
// See §9 — this glue is currently yours to write.
const tokens = new TokenStore('/api/chat-token');

const rest = new RestClient({
  apiUrl: process.env.NEXT_PUBLIC_CHAT_API_URL!,   // origin only — rest appends the base path
  publishableKey: process.env.NEXT_PUBLIC_CHAT_PUBLISHABLE_KEY!,
  getAccessToken: tokens.current,
});

const config: ChatClientConfig = {
  publishableKey: process.env.NEXT_PUBLIC_CHAT_PUBLISHABLE_KEY!,   // dhp_live_…
  getToken: createTokenProvider(tokens.mint),

  apiUrl: process.env.NEXT_PUBLIC_CHAT_API_URL!,
  wsUrl: process.env.NEXT_PUBLIC_CHAT_WS_URL!,     // explicit, always. Never derived.

  // Required: a session carries both a customer and an agent, and nothing else in this
  // config says which one this browser is. A defaulted CUSTOMER would silently mislabel
  // every message an agent-side embed sends.
  localSender: { senderId: auth.user.id, senderType: 'CUSTOMER' },

  // The explicit type arguments are load-bearing — without them these infer `unknown`
  // and fail to satisfy the seam, with an error pointing at the config object.
  history: createHistorySource<ChatMessage>(rest),
  uploader: createAttachmentUploader<AttachmentMetadata>(rest),
  sessionActions: createSessionActions<ChatSession>(rest),

  logger: (level, msg, meta) => console[level === 'debug' ? 'log' : level](msg, meta),
};

// You render the UI. `ChatProvider` only puts one client in context.
<ChatProvider client={config}><YourChatUI /></ChatProvider>;
```

### Field-by-field

| v1 | v2 | |
|---|---|---|
| `serviceUrl` | `apiUrl` **and** `wsUrl` | Two independent, explicit fields. Neither is derived from the other — see §5. `apiUrl` is an **origin**; `@dhaam-ccrm/rest` appends the base path, so including it yourself produces a doubled path. |
| `wsUrl` (optional, port-swapped default) | `wsUrl` (**required in practice**) | Omitting it is a loud `ChatClientConfigError` at construction, not a guess. |
| `tenantId` | *(gone)* | Tenant is resolved server-side from the publishable key. A valid-looking token for the wrong tenant is rejected with `AUTH_INVALID`, not silently accepted. |
| `token` | `getToken` | Async callback. A static string is a type error. |
| `user: { id, name, email }` | `localSender: { senderId, senderType }` + token claims | Display identity comes from the minted token's claims (server-side). `localSender` tells core which participant this process *is*. |
| `appId` | *(gone)* | It appeared in v1's README as required but exists nowhere in v1's source or types. Nothing read it. |
| `theme` / `features` / `callbacks` | *(gone)* | No UI to theme or toggle. `callbacks` become `client.on(event, handler)` — see §6. |
| — | `history` | **Required.** Backward-cursor message history. Not optional: it is the recovery path when a reconnect gap exceeds the replay cap. |
| — | `storage` | Optional `StorageAdapter` for the durable offline queue. Defaults to in-memory, which survives a network blip but **not a page reload**. Pass `createBrowserStorageAdapter()` if you want queued sends to survive a refresh. |
| — | `queueRetention` | Offline-queue bounds. Defaults 24 h / 200 entries; past those a queued send is surfaced as permanently failed rather than retried forever. |

---

## 5. What is deliberately gone

Each of these was removed because v1's version was actively wrong, not merely
old. Do not go looking for the replacement — there isn't one, by design.

**Integer-enum and snake_case coercion** ([ADR-0004](adr/0004-one-wire-format-zero-coercion-in-core.md)).
v1 shipped `normalizeSenderType` / `normalizeMessageType` / `normalizeChatStatus` /
`normalizeChatMode` **twice**, in two files, each accepting either an integer or a string,
plus per-field fallback chains (`chatSessionId ?? chat_session_id`; four aliases for one
timestamp). v2's wire format is string enums, camelCase, ISO-8601, one canonical name and
one canonical location per concept. **Core ships zero coercion, and a malformed frame is
dropped with a warning rather than partially applied.** The cost is real: the backend must
be correct or the feature stops, loudly, with no shim to switch on.

**`clientMessageId` and the echo suppressor** ([ADR-0001](adr/0001-client-ulid-is-the-permanent-message-id.md)).
v1 ran two dedup mechanisms at once — a `clientMessageId` → `temp-…` ack mapping, *and* a
separate map keyed on **message content** that suppressed echoes within a 10-second
window. The second one drops your message if you send "ok" twice in ten seconds. Both are
deleted, not ported. In v2 the client's ULID **is** the permanent message id, so replaying
a queued frame after a reconnect dedupes structurally. Message ids never change.

> Generate ULIDs, not UUIDs. Envelope ids are validated against Crockford base32
> (`^[0-9A-HJKMNP-TV-Z]{26}$` — no `I`, `L`, `O`, `U`). A UUID is **dropped silently
> before correlation**: no ack, no error, no clue.

**The redundant REST read-receipt write** (PRD §9.5). v1 fired the `chat.message.read`
WebSocket event **and** a separate `POST /sessions/{id}/read`, for the same read event,
with a comment calling the redundancy intentional. Two write paths for one fact. v2 has
exactly one: the `message.markRead` frame. `@dhaam-ccrm/rest` exposes no read endpoint at
all. The read *model* is unchanged (a `lastReadAt` watermark per participant, not
per-message receipts) — only the duplicate write is gone.

**The port-swap URL heuristic** (PRD §12.7). v1 derived the WebSocket URL from
`serviceUrl` by string surgery — `if (wsUrl.includes(':3000')) wsUrl.replace(':3000', ':3001')`
— and the upload path did the reverse swap. That assumes a local-dev port convention and
breaks behind any reverse proxy or single-origin production deployment. v2 has no
derivation: `apiUrl` and `wsUrl` are independent and explicit, and core refuses to guess a
WebSocket host from an HTTP one.

**Four typing event names.** v1 listened for `TYPING_INDICATOR`, `TYPING`, `TYPING_START`
and `TYPING_STOP`, sent typing state via two different emits, and ran a client-side 5-second
auto-clear as a safety net against a stop event that never arrived. v2 has exactly
`typing.start` / `typing.stop`, used identically in both directions.

---

## 6. API mapping

### Hooks

| v1 | v2 (`@dhaam-ccrm/react`) |
|---|---|
| `useChat()` | `useChatClient()` for the client; `useChatState()` for the full snapshot |
| `useChatState()` | `useChatState()`, or `useChatSelector(fn)` for a narrowed subscription |
| `useChatMessages()` | `useMessages()` |
| `useChatSession()` | `useChannel()` |
| `useChatActions()` | methods on `useChatClient()`; `useChannel()` / `useMessages()` also return bound actions |
| — | `useTypingIndicator()`, `useUnreadCount()`, `useChatError()` |
| — | `useReadTracker()`, `useVoiceRecorder()`, `useAudioWaveform()` — the DOM-facing pieces core cannot own |

### Actions

`sendMessage`, `sendAttachment`, `startTyping`, `stopTyping`, `requestAgent`,
`closeSession`, `reopenSession`, `loadOlderMessages` all survive with the same intent.
Changes worth knowing:

- `markMessagesRead()` → **`markRead()`**, and it is `void`, not `Promise<void>`. It
  advances the local watermark optimistically and syncs it; there is no REST call to await.
- `reconnect()` → **gone.** Core reconnects itself, with full-jitter exponential backoff
  (base 500 ms, cap 30 s, retried indefinitely for transport failures). There is no manual
  reconnect because there is no state in which you would need one. `connect()` exists to
  resume from `suspended`.
- `setWidgetOpen()` / `isWidgetOpen` → **gone.** v1 counted unread messages only while the
  widget was closed. v2's `unreadCount` is **derived from the read watermark**: it counts
  what the user has not been marked as having read, regardless of what is on screen. Call
  `markRead()` when *your* UI decides the user has seen the messages. If you want v1's
  behaviour, call `markRead()` when your widget is open.
- `sendMessage()` **never throws for "offline."** Offline is a queued state, not an error;
  watch `message.delivery` (`{state:'queued'}` / `{state:'failed', reason}`) and the
  `sendFailed` event.

### State

`ChatState` is a flat snapshot of twelve fields, deeply frozen, delivered whole on every
change. `session`, `messages`, `unreadCount`, `pagination.hasMore`, `pagination.loadingMore`
and `uploading` carry over from v1's `ChatSDKState`. Renamed and new:

| v1 | v2 |
|---|---|
| `connected: boolean`, `initialized`, `loading` | `connectionState`: `idle \| connecting \| authenticating \| connected \| reconnecting \| suspended \| closed` |
| `isTyping`, `typingUser` | `typing: { isTyping, participantId? }` |
| `error: Error \| null` | `lastError: ChatError \| null` — structured `code`, not prose |
| `tokenExpired: boolean` | `connectionState === 'suspended'` (with `reason: 'auth'`) |
| `hasMore`, `loadingMore` | `pagination: { hasMore, loadingMore }` |
| single `agentReadAt` | `readWatermarks: Record<participantId, ISO-8601>` — multi-agent sessions are modelled |
| — | `deliveredWatermarks: Record<participantId, seq>` — the delivery half of the tick story (see §9) |
| — | `presence: Record<participantId, PresenceEntry>`. **Absent ≠ offline**, it means *unknown*. |

`callbacks` become `client.on(event, handler)`: `onMessage` → `'message'`,
`onStatusChange` → `'statusChange'`, `onAgentJoined`/`onAgentLeft` →
`'agentJoined'`/`'agentLeft'`, `onSessionClosed` → `'sessionClosed'`, `onError` →
`'error'`, `onConnected` → `'connected'`.

### Statuses

v1's `ChatStatus` type modelled four values (`OPEN`, `WAITING_FOR_AGENT`, `ASSIGNED`,
`CLOSED`). The backend has always had **six** — `RESOLVED` and `ON_HOLD` were real states
v1's type system did not know existed. v2 models all six, so **handle `RESOLVED` and
`ON_HOLD` in your UI**; a v1-shaped `switch` will fall through on sessions it never saw
before. `closeReason` is now a first-class enum rather than a loose string, and
distinguishes a session genuinely ended from one *parked* because the customer switched
to another chat (`'SWITCHED'` — v1's overloaded `CLOSED`).

---

## 7. Key prefixes and the deprecation window

Current prefixes are **`dhp_`** (publishable) and **`dhk_`** (secret):
`dhp_live_…` / `dhp_test_…`, `dhk_live_…` / `dhk_test_…`.

The retired **`dhpk_`** and **`dhsk_`** forms still work — new keys are only minted in the
current form, but already-issued keys and shipped widget bundles keep working for the
length of the server-side deprecation window. Specifically:

- **`dhpk_` publishable keys are accepted by core**, and reported as deprecated. A
  publishable key is baked into a browser bundle and ships to every visitor, including
  bundles already in a browser cache — refusing it would break widgets nobody can redeploy
  on our schedule, and would protect no one, since the key is already public by design.
- **`dhsk_` secret keys still mint tokens server-side**, but core **rejects** a `dhsk_`
  (or a bare `sk_`) supplied where a publishable key belongs, with a *credential-incident*
  error rather than a formatting error. Pasting a real Stripe secret key into the
  publishable slot gets you the same treatment, on purpose.

**Why the rename happened**, because it affects you: a bare `pk_`/`sk_` scheme is
byte-identical to Stripe's, and GitHub's secret scanner blocked a push to this repository
after detecting two synthetic test fixtures as Stripe keys. The first fix (`dhpk_`/`dhsk_`)
addressed the symptom, not the cause — Stripe's detector is not anchored, and
`dhsk_test_X` still *contains* `sk_test_X`. Measured over 200k generated keys, **46.66%**
of namespaced keys still matched. `dhp_`/`dhk_` contain neither `pk_` nor `sk_` at any
offset, so the collision is structural rather than probabilistic. The stakes are
operational: a customer who commits one of our keys gets their own push blocked and
concludes the SDK is broken, and a genuine leak of ours is triaged as a Stripe incident and
routed to the wrong vendor.

**Action for you:** nothing is forced today. When you next rotate, you will receive
`dhp_`/`dhk_` keys. Rotate the secret first — it needs no client redeploy.

---

## 8. A migration order that works

1. **Deploy the backend with `WS_V2_ENABLED=true`.** v1 is unaffected; the v2 route fails
   closed without a provisioned publishable key.
2. **Provision one `test` key pair** and stand up your token endpoint (§2). Verify the
   secret never reaches the browser — grep your served bundle for the key *value*, not the
   prefix (the prefix legitimately appears in core's validator).
3. **Build the chat UI against `core` + a binding**, behind a flag, in one low-traffic
   surface. This is the bulk of the work (§0.1).
4. **Handle the wire differences**: six session statuses, structured `closeReason`,
   `delivery` state on messages, `markRead()` driven by your own UI rather than widget
   visibility.
5. **Ramp per-client.** Both endpoints run simultaneously; roll back by redeploying the v1
   bundle. No server change, no coordinated window.
6. **Rotate to `dhp_`/`dhk_` keys** once the v2 client is stable.

---

## 9. Gaps — know these before you commit

Migrating into a hole helps nobody. As of 2026-08-19:

**You have to write the token glue.** Core calls `getToken` and owns refresh, but **never
exposes the token it currently holds** — while `RestClient` needs that same token for every
HTTP request. There is no seam connecting them, so you must keep your own copy and hand it
to both (the reference demo invented a `TokenStore` for exactly this). It works, but the
REST side can lag a token core has already refreshed. This is the highest-value ergonomics
fix outstanding, and it is the first thing every integrator hits.

**REST adapter factories need explicit type arguments.** `createHistorySource(rest)` infers
`unknown` and then fails to satisfy `MessageHistorySource`; write
`createHistorySource<ChatMessage>(rest)`. The compiler error points at your config object,
not at the missing type argument.

**Bindings do not re-export `createChatClient` / `createTokenProvider`.** They re-export
core's *types*, so a React-only consumer still needs a direct `@dhaam-ccrm/core`
dependency.

**v2 is customer-only.** The server hardcodes `senderType: CUSTOMER` on `message.send` and
derives the recorded sender from verified token claims. There is no agent/staff role on
the v2 path, so **you cannot build an agent console on this SDK yet.** Setting
`localSender.senderType: 'AGENT'` is a *local rendering hint* only — it does not make the
client an agent, and the server corrects the label on the ack.

**WhatsApp-style features are scoped but not built.** Delivery ticks are modelled
(`DeliveryStatus`, `message_receipts`) and wired to nothing end to end; the read-tracking
and voice-recording hooks exist in `@dhaam-ccrm/react` but the delivery half of the tick
story is incomplete.

**The wire spec is not yet self-sufficient.** PRD §7.3 names the frame types but defines
no payload fields — the authoritative shapes are `packages/core/src/protocol/frames.ts`
and its runtime validator. If you are writing a client in another language, read those,
not §7 alone: a Dart client written from §7 had to recover ~40 field definitions from the
server and hit five blocking ambiguities.

**Production hardening on the v2 backend path is incomplete.** No observability (no
metrics, no lifecycle logs, no alerts) on the v2 route; rate limiting exists only on
`POST /tokens`; REST CORS is still permissive. Ask for the current status before pointing
production traffic at it.

**Build order matters in this repo.** `pnpm test` requires `pnpm -r build` first on a
clean checkout — packages resolve each other through their `exports` → `dist/`, exactly as
a customer's bundler does from npm.

---

## 10. Where the reasoning lives

- **Decisions and their costs:** [`docs/adr/`](adr/README.md) — four ADRs, one per binding
  protocol decision.
- **The full spec:** [`docs/spec/chat-sdk-v2-prd.md`](spec/chat-sdk-v2-prd.md). §12
  ("Grounded in v1 Reality") is the evidence base — every v1 behaviour cited above.
- **Current project state, verified:** [`docs/spec/STATE.md`](spec/STATE.md).
- **A runnable reference integration:** `examples/demo` — token server plus a React page,
  consuming only published package entry points.
