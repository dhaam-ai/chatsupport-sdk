# PRD: Chat SDK v2 — Framework-Agnostic Multi-Platform Chat SDK

**Status:** Approved — protocol decisions D1–D4 locked (§0.5)
**Branch:** `feat/framework-agnostic-core`
**Package scope:** `@dhaam-ccrm/*`
**Author:** Product Analyst (agent-assisted), grounded in `src/` (v1, being replaced)
**Date:** 2026-08-17

---

## 0. How to read this document

This PRD defines *what* the v2 chat SDK must do and the contracts (wire protocol, public API, state shape) that make "framework-agnostic core + thin bindings" actually work. It does not prescribe internal implementation (data structures, class layout, file organization) — that is the tech-lead-planner's job in the next phase.

Section 12 ("Grounded in v1 Reality") is load-bearing: every wire-protocol and lifecycle decision in this doc is checked against what `src/client.ts`, `src/context.tsx`, `src/types.ts`, and `src/shared/enums.ts` reveal about how the *real* backend actually behaves today, not how it's supposed to behave on paper. Treat that section as the evidence base for the rest of the spec.

---

## 0.5 Decisions Log

Resolved 2026-08-17 by the product owner. These close Open Questions 1–4 (§18) and are **binding constraints** on the plan and implementation, not proposals. Backend implementation work is required for all four and must be tracked as backend-side tasks.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **The client-generated ULID IS the permanent message id.** The server validates ULID format, enforces per-session uniqueness, and stores it as the canonical id. It does not mint its own. | Core has **no optimistic-id-swap code path**. A message's identity never changes after creation. Replay of a queued frame after reconnect dedupes structurally on the same `id`. Both v1 dedup mechanisms (§12.9 — the `clientMessageId` ack mapping *and* the 10-second content-matching echo suppressor) are deleted, not ported. Bindings get stable list keys for free. |
| **D2** | **Backend tracks a monotonic per-session sequence number.** `connection.hello.d.resumeFrom` carries the last applied `seq`; `connection.ack` replays missed frames inline. | Resume is **one WS round trip**, no REST fallback in the happy path. `seq` — never `ts` — is core's ordering key and gap-detection signal (a `seq` jump means refetch). §8.3's ambiguity is closed in favor of the inline-replay design. |
| **D3** | **In-place `connection.reauth` is supported on an open socket.** | Token refresh never tears down the connection. Avoids correlated-expiry reconnect storms when many clients' tokens lapse on the same hour boundary. §10.5's reconnect fallback becomes a defensive path, not the primary one. The offline queue does not engage during a normal refresh. |
| **D4** | **One wire format: string-name enums, camelCase keys, ISO-8601 timestamps, one canonical name per concept.** | The frame schemas in §7.2 are the **literal** source of truth with no compatibility shim. Core ships **zero** enum/key coercion — every `normalize*` function in §12.2 is deleted, not ported. Future Swift/Kotlin/Dart clients implement from spec alone with no undocumented rules. The full six-value `ChatStatus` (§12.1) is modeled, closing v1's missing `RESOLVED`/`ON_HOLD` gap. |

---

## 1. Problem Statement

The existing chat SDK (`src/`, ~13k lines) is a single React package hard-wired to `socket.io-client`, with a static Cognito token baked into its config and React state management baked into its transport layer. This creates three compounding problems:

1. **No path to other platforms.** Every framework binding (Vue, Angular, vanilla JS) and every future mobile target (React Native, Flutter, Kotlin Multiplatform) would have to either depend on React or re-implement the entire WebSocket/reconnect/state-sync stack from scratch. Native platforms (Swift/Kotlin/Flutter) cannot depend on a socket.io port at all without inheriting its reconnect-semantics divergence.
2. **No real auth model.** A long-lived, static Cognito token is passed by value into config. There is no refresh, no scoping, no key-rotation story, and no way for a customer to safely ship a client bundle without also shipping a credential that can act as that specific end user indefinitely.
3. **Undocumented, drifted wire behavior.** The backend has, over time, emitted the same concepts as both integers and strings, both camelCase and snake_case, and under multiple event names for the same semantic action (see §12). The v1 client survives this only through defensive coercion scattered across `client.ts` and `context.tsx`. This is not a client bug to fix — it is evidence that nothing has ever forced the wire contract to be a single source of truth.

v2 replaces the transport and state layer with a framework-agnostic core in plain TypeScript, a versioned JSON frame protocol over raw WebSocket, and a publishable-key/secret-key auth model — so that every future binding (web or native) is a thin, mechanical mapping onto one well-specified core, and the wire protocol itself is implementable from this spec alone.

### Target users (SDK consumers, not end chatters)

- **Frontend engineers at customer companies** integrating chat into a React/Vue/Angular/vanilla web app — want a few lines of setup, framework-native ergonomics, and to never think about WebSocket reconnect logic.
- **Backend engineers at customer companies** who mint scoped tokens for their own end users via the node/Python/Go backend SDK — want a secret key that never leaves their server and a simple token-minting call.
- **Our own team** building the React binding + demo app, then subsequent bindings — needs the core to be complete and correct enough that binding work is genuinely "a few hundred lines mapping events to a reactivity system," not a second place business logic gets rewritten.
- **(Future, deferred) Mobile engineers** — not building against this SDK yet, but the wire protocol must not foreclose React Native (JSI reuse of core) or Kotlin Multiplatform paths.

### Success criteria

- A Swift/Kotlin/Flutter engineer with no access to the TypeScript source could implement a conformant client purely from the wire-protocol section of this spec (§7) and the OpenAPI spec.
- `@dhaam-ccrm/core` has zero imports of React, Vue, Angular, `socket.io-client`, or any DOM-only global (`window`, `document`) at the module level — it runs in a browser, a Node test harness, and (later) a React Native JS engine unmodified.
- `@dhaam-ccrm/react` (and each subsequent binding) is reviewably "thin" — it contains no reconnect, dedup, queueing, or auth-refresh logic of its own; 100% of that lives in core and is exercised by shared conformance tests (§9).
- The demo app built in ship-order step 2 imports only published `@dhaam-ccrm/core` and `@dhaam-ccrm/react` packages — it dogfoods the real public API, not an internal shortcut.
- No static long-lived token ever appears in a client config object; `getToken()` is the only credential-supplying mechanism accepted by core.

---

## 2. Goals

- Ship a framework-agnostic `@dhaam-ccrm/core` that owns 100% of WebSocket lifecycle, reconnect/backoff, token refresh, message dedup, optimistic sends, pagination, presence, offline queueing, local persistence, and read-state sync, exposed through one observable state surface + one event surface.
- Define and document a versioned JSON frame protocol over raw WebSocket that any language/platform can implement from spec.
- Ship a publishable-key + secret-key auth model that replaces static tokens, with the node backend SDK as the (non-optional) way customers mint scoped user tokens.
- Ship an OpenAPI spec as the source of truth for all REST surface, with backend SDKs (node hand-written ergonomic layer + generated Python/Go) generated/derived from it.
- Ship a React binding and a demo app that together prove the public-package-only integration story end to end, before any other binding is built.
- Define a binding conformance contract precise enough that React/Vue/Angular/vanilla behave identically for every observable state transition and action.
- Fix, at the protocol level, the specific classes of drift the v1 backend exhibits today (integer/string enum ambiguity, camelCase/snake_case key drift, asymmetric connect-vs-reconnect handshake) rather than re-implementing defensive coercion in v2.

## Non-Goals

- Porting any v1 code. v1 is reference-only for backend behavior, not a migration source.
- Building `@dhaam-ccrm/ui` (prebuilt components) — explicitly deferred, possibly indefinitely (§13).
- Building any mobile SDK now. Mobile is deferred to decision criteria only (§11).
- Redesigning the support/ticketing/agent-side product surface — this SDK is the *customer/end-user-facing* chat client contract; agent-console behavior is out of scope except where it affects the wire contract (e.g., `agent.joined`).
- Achieving full backward compatibility with v1's WS event names or REST payload shapes. v2 is a breaking protocol change by design (decision #3).

---

## 3. Users & Use Cases

| Persona | Top scenario |
|---|---|
| Frontend engineer (React) | Installs `@dhaam-ccrm/core` + `@dhaam-ccrm/react`, wraps app in a provider with `publishableKey` + `getToken`, renders chat state via hooks, ships. |
| Frontend engineer (Vue/Angular/vanilla) | Same shape of integration in ship-order steps 5–6, using the binding-conformance contract to know the behavior will match React's. |
| Backend engineer | Uses `@dhaam-ccrm/node` (or a generated Python/Go SDK) with a `dhsk_live_...` secret key to mint short-lived scoped JWTs from their own auth session, exposes a `/token` endpoint their frontend calls before initializing the SDK. |
| End user (chatter, not an SDK consumer but the reason the SDK exists) | Opens a support widget, sends messages, goes offline momentarily (tunnel, tab sleep), comes back, and sees no duplicated or lost messages, with typing/presence/read-state behaving consistently regardless of which framework binding renders the UI. |
| Our own team (dogfooding) | Builds the ship-order-2 demo app against only published packages, surfacing any core/binding gap before external customers do. |

---

## 4. Package Boundary Table

> **Hard invariant: `@dhaam-ccrm/core` has zero UI/framework dependencies.** No React, Vue, Angular, JSX, or DOM-only global at module scope. Core must run unmodified in a browser tab, a Node test process, and (later) a React Native JS engine. Any code that touches `window`, `document`, or a framework's reactivity primitives does not belong in core — it belongs in a binding.

| Package | Owns | Explicitly excluded (must not own) |
|---|---|---|
| `@dhaam-ccrm/core` | WS connection lifecycle & state machine (§8); frame envelope encode/decode (§7); reconnect + backoff + jitter (§8); token refresh orchestration via `getToken()` (§10); message dedup via client ULID (§9); optimistic send + replace semantics; cursor pagination; presence; offline send queue + durable storage *interface* (concrete adapters are platform-provided); read-state watermark sync (§9); the observable state store + event emitter (§6) | Any rendering, DOM manipulation, JSX, framework reactivity, UI theming, storage/network *implementations* (core defines interfaces; platform code implements them) |
| `@dhaam-ccrm/react` | Hooks/context/provider wrapping one core client instance; mapping core's observable store to React re-renders (`useSyncExternalStore`-style) | WS/REST calls, reconnect logic, dedup logic, business rules of any kind |
| `@dhaam-ccrm/vue` | Composables (reactive refs) wrapping core, same mapping duty as React binding | Same exclusions as above |
| `@dhaam-ccrm/angular` | Injectable service exposing signals/observables wrapping core | Same exclusions as above |
| `@dhaam-ccrm/js` | Vanilla/UMD convenience wrapper (DOM-`EventTarget`-shaped) over core, for non-framework sites | Same exclusions as above |
| `@dhaam-ccrm/node` | Secret-key token minting (`POST /v1/tokens` client), webhook signature verification, pagination iterators, thin ergonomic wrapper around the generated REST client | Client-side reconnect/WS/offline-queue logic (server SDK is request/response, not a realtime client — see Open Question 6 for the one case that might need this to change) |
| OpenAPI spec (source of truth) + generated Python/Go SDKs | Pure generated REST clients from the OpenAPI document | Hand-written business logic beyond what the generator produces |
| `@dhaam-ccrm/ui` | **Deferred, possibly indefinitely.** Not scoped by this PRD beyond this note (§13). | — |

---

## 5. Ship Order (constraint, not a plan)

This PRD does not sequence implementation tasks (that's the tech-lead-planner's job), but the following ship order is a fixed constraint this spec must not violate or silently reorder:

1. `@dhaam-ccrm/core` + OpenAPI spec
2. `@dhaam-ccrm/react` binding + demo app (dogfoods public packages only)
3. `@dhaam-ccrm/node` backend SDK (non-optional — needed for token minting)
4. Generated Python and Go backend SDKs
5. `@dhaam-ccrm/vue`
6. `@dhaam-ccrm/angular` + `@dhaam-ccrm/js` (vanilla)
7. One mobile target, chosen from actual customer signal (§11 — decision criteria only, not a build)

Every functional requirement below is written so it can be delivered in this order without rework: the core (§6–§10) is fully specified before any binding contract (§9) is finalized, and the binding contract itself is designed to be identical whether the second binding built is Vue or Angular.

---

## 6. Core Public API Surface

### 6.1 Client construction

```ts
function createChatClient(config: ChatClientConfig): ChatClient

interface ChatClientConfig {
  publishableKey: string;              // dhpk_live_... / dhpk_test_...  — tenant identification only
  getToken: () => Promise<string>;     // async, core owns when/how often it's called (§10)
  apiUrl?: string;                     // REST base — explicit, no port-swap heuristics (§12.7)
  wsUrl?: string;                      // WS base — explicit, no port-swap heuristics (§12.7)
  storage?: StorageAdapter;            // durable KV interface; defaults to in-memory (§9.1)
  logger?: (level: 'debug'|'info'|'warn'|'error', msg: string, meta?: Record<string, unknown>) => void;
  protocolVersion?: number;            // override; defaults to the latest core supports (§7.5)
}
```

`getToken` replaces v1's static `token: string` field entirely. A static token string is an explicitly rejected design (decision, not up for re-litigation) — core's type signature must make it structurally impossible to pass one in place of a callback.

### 6.2 Session / channel operations

| Method | Behavior |
|---|---|
| `client.connect(): Promise<void>` | Opens the WS connection and drives it to `connected` (§8). Resolves once `connection.ack` is received; rejects on unrecoverable auth failure. |
| `client.disconnect(): void` | User-initiated, terminal (§8) — no auto-reconnect follows. |
| `client.joinSession(sessionId: string): void` | Explicit join, mirroring the v1 handshake reality (§12.3) — kept as an explicit step rather than assumed, pending Open Question 2 on whether `connection.ack` should fold this in. |
| `client.leaveSession(): void` | — |
| `client.requestAgent(reason?: string): void` | — |
| `client.reopenSession(sessionId: string): Promise<ChatSession>` | Mirrors v1's reopen-bypasses-bot semantics (§12.5). |
| `client.closeSession(): Promise<void>` | — |

### 6.3 Message operations

| Method | Behavior |
|---|---|
| `client.sendMessage(content: string, opts?: { type?: MessageType; replyToMessageId?: string }): Promise<void>` | Generates a client-side ULID, applies it optimistically to the observable state, queues/sends the frame (§7, §9). Never throws for "offline" — offline is a queued state, not an error. |
| `client.sendAttachment(file: Blob, opts?: { fileName?: string }): Promise<void>` | Upload-then-announce flow, generalized from v1 (§12.9); exact transport TBD (Open Question 7). |
| `client.markRead(): void` | Advances the local read watermark optimistically and syncs it (§9.4). |
| `client.startTyping(): void` / `client.stopTyping(): void` | Exactly two calls — collapses v1's four redundant typing event names (§12.8) into one canonical pair. |
| `client.loadOlderMessages(): Promise<void>` | Cursor-based (`before: messageId`), matches v1's proven pagination shape (§12.10). |

### 6.4 The observable state surface (hard requirement — specified precisely)

Decision #2 requires the core's state to be **observable**, not callback-per-operation. Core exposes exactly two subscription primitives — a **state store** for continuous/derived state, and an **event emitter** for discrete occurrences that are not naturally "current state" (e.g., a one-shot ticket-linked notification). Bindings must use these two primitives and nothing else to build their framework-native reactivity; they may not reach into WS/REST/storage directly (§9, binding contract).

```ts
interface ChatClient {
  getState(): ChatState;                                   // synchronous snapshot
  subscribe(listener: (state: ChatState) => void): Unsubscribe; // called on every state change, always with the FULL new state
  on<E extends keyof ChatEventMap>(event: E, handler: (payload: ChatEventMap[E]) => void): Unsubscribe;
  // ...operations from 6.1–6.3
}
```

```ts
interface ChatState {
  connectionState: ConnectionState;         // see §8.1 — idle|connecting|authenticating|connected|reconnecting|suspended|closed
  session: ChatSession | null;
  messages: ChatMessage[];
  typing: { isTyping: boolean; participantId?: string };
  unreadCount: number;
  pagination: { hasMore: boolean; loadingMore: boolean };
  uploading: boolean;
  pastSessions: ChatSessionSummary[];
  readWatermarks: Record<string /* participantId */, string /* ISO-8601 */>; // generalized from v1's single agentReadAt field
  presence: Record<string /* participantId */, PresenceEntry>;                // AMENDED — see below
  lastError: ChatError | null;
}
```

**Amendment (2026-08-18, during B12):** the key prefixes are namespaced — `dhpk_live_`/`dhpk_test_` and `dhsk_live_`/`dhsk_test_`, not `pk_`/`sk_`. A bare `sk_live_` scheme is byte-identical to Stripe's, and GitHub's secret scanner blocked a push to this repo having detected two synthetic test fixtures as Stripe keys. The operational costs are the real reason: a customer committing one of our keys gets their own push blocked and concludes the SDK is broken, and a genuine leak of ours is triaged as a Stripe incident and routed to the wrong vendor. Core still rejects a bare `sk_` **in addition to** `dhsk_`, so someone pasting a real Stripe secret key into the publishable slot gets a credential-incident error rather than a formatting error.

**Amendment (2026-08-18, during T10):** `ChatMessage` gained `delivery?: MessageDelivery`, and §6.5 gained a `sendFailed` event. As originally written the model had no way to express a send that will never arrive: `seq` is absent both for a message still in flight and for one the queue has permanently given up on, so a binding could not tell a spinner from a retry affordance. `MessageDelivery` is a union (`{state:'queued'}` | `{state:'failed', reason}`) so a reason cannot exist without a failure and a failure cannot exist without a reason. `SendFailureReason` is defined in `state/` and imported by `queue/`, rather than duplicated — a second copy of the union is exactly the drift D4 exists to prevent.

**Amendment (2026-08-18, during T12):** `presence` was added as an eleventh field. As originally written this section specified ten fields with no home for presence, while the only presence-shaped field in the model — `isOnline` on the participant profile — sat on a type with no id, so a `presence.update` frame (keyed by `participantId`) could not be correlated to anyone. `ChatParticipantProfile` now carries `participantId`, and `isOnline` is removed: presence has exactly one canonical location (D4), rather than the two-locations-for-one-fact mistake v1 made with attachments (§12.2). A participant absent from the map has *unknown* presence, which is not the same as offline.

`subscribe` fires synchronously (microtask-batched, not per-internal-mutation) on any change to any field of `ChatState`. Bindings are responsible for their framework's fine-grained-vs-coarse re-render tradeoff (e.g., React may want `useSyncExternalStore` with a selector) — core only guarantees the full, consistent snapshot is available on every notification; it does not do field-level diffing itself.

### 6.5 Event catalog (discrete, not state)

| Event | Payload | When |
|---|---|---|
| `connected` | `{ session: ChatSession }` | `connection.ack` received (fresh connect or reconnect — symmetric per §12.3) |
| `reconnecting` | `{ attempt: number, delayMs: number }` | Backoff timer scheduled (§8.2) |
| `suspended` | `{ reason: 'auth' \| 'maxAttempts' }` | Core stops auto-retrying (§8.1) |
| `disconnected` | `{ reason: string }` | Transport dropped |
| `message` | `ChatMessage` | New message applied to state (optimistic or server-confirmed) |
| `messageAck` | `{ id: string, seq?: number }` | Server confirmed a client-sent message (§9.3) |
| `typing` | `{ isTyping: boolean, participantId: string }` | Remote typing state changed |
| `agentJoined` / `agentLeft` | `{ agentId: string, agentName?: string }` | — |
| `statusChange` | `{ status: ChatStatus, mode: ChatMode }` | — |
| `sessionClosed` | `{ closeReason: CloseReason }` | — |
| `presenceUpdate` | `{ participantId: string, status: PresenceStatus, lastSeen?: string }` | — |
| `ticketLinked` | `{ ticketId: string, ticketUrl?: string }` | — |
| `tokenRefreshed` | `{}` | `getToken()` successfully re-invoked (§10.3) |
| `error` | `ChatError` | Any protocol- or transport-level error (§7.4) |

---

## 7. Wire Protocol

### 7.1 Transport

Raw WebSocket. No `socket.io-client`, no third-party socket.io server/port on any platform. Rationale (fixed): the frame schema must be implementable on Flutter/Swift/Kotlin from this spec alone, without inheriting a JS library's reconnect-semantics quirks (decision #3).

### 7.2 Frame envelope

```ts
interface Frame<T = unknown> {
  v: number;        // protocol version (integer, monotonically increasing)
  t: string;        // frame type — dot-namespaced, e.g. "message.send" (§7.3)
  id: string;        // ULID. Client-generated for client→server frames (dedup + idempotency key).
                      // Server-generated for server→client push frames.
  ts: number;         // sender's epoch-millis clock. Informational only — NEVER used for ordering.
  d: T;               // payload. Always camelCase keys. Same shape every time — see §12.2/§12.4 for
                       // why this line item exists.
}

interface AckFrame<T = unknown> {
  v: number;
  t: 'ack';
  id: string;          // new ULID for this ack frame
  ref: string;          // id of the frame being acknowledged
  ts: number;
  d: { ok: true } & T | { ok: false; error: ErrorPayload };
}

interface ErrorFrame {
  v: number;
  t: 'error';
  id: string;
  ref?: string;          // id of the frame that caused this error, if applicable
  ts: number;
  d: ErrorPayload;
}

interface ErrorPayload {
  code: ErrorCode;         // canonical enum, see §7.4
  message: string;         // human-readable, not for programmatic branching
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

**Non-negotiable payload rules** (directly closing the gaps found in §12): every `d` payload uses camelCase keys exclusively — no snake_case anywhere on the wire, ever. Every enum value is transmitted as its canonical string name (Open Question 4 covers backend feasibility) — no bare integers in `d`. Every timestamp field is `ISO-8601` and has exactly one canonical name per concept (no `timestamp`/`createdAt`/`created_at`/`sentAt` aliasing, per §12.2).

### 7.3 Frame type catalog

**Client → Server**

| `t` | Purpose | Replaces (v1) |
|---|---|---|
| `connection.hello` | First frame after WS open. Carries token, publishable key, protocol version, optional `resumeFrom` cursor. | implicit `auth`/`query` params (§12.6) |
| `connection.reauth` | Re-authenticate on an already-open socket (Open Question 3). | *(new — v1 has no refresh)* |
| `session.join` | — | `chat.session.join` |
| `session.leave` | — | `chat.session.leave` |
| `session.requestAgent` | — | `chat.request.agent` |
| `message.send` | `id` on the envelope *is* the message's client-generated ULID (§9.3, Open Question 1). | `chat.message.send` |
| `message.markRead` | — | `chat.message.markRead` |
| `typing.start` / `typing.stop` | Exactly two — collapses 4 v1 event names (§12.8). | `chat.typing.start` / `.stop` / `TYPING` / `TYPING_INDICATOR` |
| `presence.set` | — | `chat.presence.set` |
| `presence.query` | — | `chat.presence.query` |
| `system.heartbeat` | Client keepalive ping. | `chat.heartbeat` |

**Server → Client**

| `t` | Purpose | Replaces (v1) |
|---|---|---|
| `connection.ack` | Sent after **every** valid `connection.hello`, on both fresh connect and reconnect (§12.3 fixes the v1 asymmetry here). Carries full session snapshot. | `chat.connection.ack` |
| `session.updated` | Status/mode/assignment changes. | `chat.status.changed` |
| `session.closed` | Carries a structured `closeReason` (§12.5). | `chat.session.closed` |
| `agent.joined` / `agent.left` | — | `chat.agent.joined` / `.left` |
| `message.new` | — | `chat.message.receive` |
| `typing.start` / `typing.stop` | Server relays the same two frame types it accepts from clients — one concept, one pair of names, in both directions. | `TYPING_INDICATOR`/`TYPING`/`TYPING_START`/`TYPING_STOP` (§12.8) |
| `message.read` | Read-watermark push. | `chat.message.read` |
| `presence.update` | — | `chat.presence.update` |
| `ticket.linked` | — | `chat.ticket.linked` / `TICKET_LINKED` |
| `system.pong` | Heartbeat reply (net-new — v1 has no documented pong, §12.11). | *(new)* |
| `ack` | Generic frame-level acknowledgment (used for `message.send`, `message.markRead`, etc. per §7.2). | `chat.message.ack` (partially) |
| `error` | Structured error, see §7.4. | `chat.error` (unstructured) |

`chat.notification.new_message` / `NEW_MESSAGE_NOTIFICATION` has no v2 frame type yet — its real purpose is unclear from v1 alone (Open Question 5) and it is intentionally omitted pending that answer rather than carried forward as dead weight.

### 7.4 Error frames and canonical error codes

```ts
type ErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'INTERNAL';
```

This replaces v1's brittle `error.message === 'TOKEN_EXPIRED'` string-matching (§12.6) with a structured, versioned code every platform can branch on without parsing prose.

### 7.5 Protocol versioning & negotiation

- `v` is an integer, bumped on any breaking change to frame shapes or semantics.
- `connection.hello.d.protocolVersion` carries the highest version the client supports.
- `connection.ack.d.protocolVersion` carries the negotiated version (`min(client max, server max)`).
- If the server's minimum supported version exceeds the client's max, it responds with `error` (`PROTOCOL_VERSION_UNSUPPORTED`, `retryable: false`) and closes the socket. Core must surface this as a `suspended` state, not retry-loop against a version it cannot speak.
- Core refuses to silently downgrade behavior for older negotiated versions in v2.0 — multi-version support is out of scope until there is a second version to support.

---

## 8. Connection State Machine

### 8.1 States

| State | Meaning |
|---|---|
| `idle` | No connection attempted yet. |
| `connecting` | WS opening (TCP/TLS in flight). |
| `authenticating` | WS open; `connection.hello` sent; awaiting `connection.ack` or `error`. |
| `connected` | Ack received; session live; sends flow normally. |
| `reconnecting` | Transport dropped or ack timed out; core is auto-retrying per §8.2; queued sends buffer (§9.1). |
| `suspended` | Auto-retry stopped — either `getToken()` failed/rejected repeatedly, or the server sent a non-retryable `error`. Requires an explicit `client.connect()` call (typically after the host app fixes auth) to resume. |
| `closed` | User called `client.disconnect()`. Terminal — no auto-reconnect follows. |

### 8.2 Reconnect & backoff policy

Exponential backoff with **full jitter** (not v1's fixed 1000ms/5-attempt cap, §12.11):

```
delay = random(0, min(cap, base * 2^attempt))
```

- `base` = 500ms (default, tunable via config — exact number is an Open Question 9 tuning decision, not an architecture one)
- `cap` = 30s
- Transport-level failures (network blips, server restarts) retry **indefinitely** with this backoff — a dropped WiFi connection is not a reason to give up.
- Auth-level failures (`getToken()` throws/rejects, or server returns `AUTH_INVALID`/`AUTH_EXPIRED` after a fresh token was already tried) escalate to `suspended` after a small bounded number of consecutive attempts (default 3) — retrying against broken auth wastes the backoff budget on something backoff cannot fix.
- Every reconnect attempt emits `reconnecting` (§6.5) with the attempt number and computed delay, so bindings can show "reconnecting..." UI without reimplementing the policy.

### 8.3 Resume-on-reconnect semantics

On any transition into `authenticating` (including reconnect, not just first connect), `connection.hello.d` includes `resumeFrom`: the id/seq of the last frame the client fully applied to state. The server's `connection.ack` must, symmetrically to first-connect, always re-establish full session context (§12.3 — this is the fix for v1's asymmetric handshake, where reconnect required the client to proactively re-emit `JOIN_SESSION` to coax a second `CONNECTION_ACK` out of the server). Whether the server can *inline* the missed frames in the ack or must point the client at a REST pagination cursor is Open Question 2 — both are valid designs, but the ack's behavior must be identical in kind for connect and reconnect.

### 8.4 In-flight sends during disconnect

Any `message.send` (or other client-originated) frame that has not received an `ack` before the transport drops is moved into the durable offline queue (§9.1) automatically — never silently dropped. On reconnect, the queue flushes in FIFO order *before* any new user-initiated sends, replaying the identical envelope `id` (ULID) so that if the server had actually persisted it moments before the drop, replay is naturally deduped rather than double-sent (§9.3).

---

## 9. Offline Behavior

### 9.1 Send queue durability

Core defines an abstract `StorageAdapter` interface (`get`/`set`/`remove`, string-keyed, string-valued — deliberately minimal so any platform can implement it):

```ts
interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

The default is in-memory (survives a network blip, not a reload). Browser bindings are expected to supply a `localStorage`/IndexedDB-backed adapter; a future React Native binding supplies an AsyncStorage-equivalent one. The queue itself — and pending optimistic messages — must be *persisted* through this interface so a page reload or app restart does not silently lose a message the user believes they already sent.

### 9.2 Ordering guarantees

FIFO **per session**. Core does not reorder, coalesce, or batch queued sends. Cross-session ordering is explicitly undefined — each session's queue is independent.

### 9.3 Dedup via client-generated ULID

The `message.send` frame's envelope `id` **is** the message's client-generated ULID, and it is the same value used as the dedup/idempotency key (decision #3). This directly replaces v1's two-layer, unreliable fallback (§12.9): a `clientMessageId` sent alongside the payload *and* a separate content-string-matching echo-suppression heuristic with a 10-second window. In v2, resending an identical queued frame after a reconnect is safe by construction as long as the server dedupes by `id` — whether the server treats that same `id` as the *permanent* message id (eliminating the optimistic-id-swap pattern entirely) or mints its own id and maps it in the `ack` is the single highest-priority open question in this document (Open Question 1) because it reshapes the entire optimistic-send code path in core.

### 9.4 Conflict resolution on reconnect

There is no "edit message" concept in v1 or v2 — messages are append-only, so "conflict" reduces to two cases:

1. **Duplicate send** — resolved structurally by ULID dedup (§9.3).
2. **Stale local session state** — the client's cached `session.status`/`mode` may be behind the server's after a reconnect (e.g., the session was closed or reassigned while offline). Core must always treat the freshest `connection.ack`/`session.updated` snapshot as authoritative and overwrite local session state wholesale — never merge field-by-field against a possibly-stale local copy.

### 9.5 Read-state sync

v1's backend already implements a lightweight **watermark model** (`lastReadAt` per participant, not per-message receipts) — confirmed by the `/sessions/{id}/full` endpoint's `participants[]` array and the `chat.message.read` event's `{readBy, readAt}` shape (§12.9). v2 keeps this model (Open Question 8 asks only for confirmation, not redesign): `client.markRead()` optimistically advances the local watermark in `ChatState.readWatermarks`, and reconciles against the server's watermark on the next `session.updated`/`connection.ack` snapshot. Unlike v1 (which fires a WS event *and* a separate, redundant REST call for the same read event, §12.9), core issues exactly one write path per read action — the wire protocol's `message.markRead` frame is the single source of truth; there is no parallel REST call to keep in sync by hand.

If the client was offline when multiple messages arrived, reconnect should flush a single "read up to latest seen message" watermark update, not replay one `markRead` per message.

### 9.6 Queue retention

Queued sends should have a bounded age/size before being surfaced to the app as permanently failed rather than retried forever silently (exact numbers are Open Question 9 — a tuning decision, not an architectural one; ship with a documented default rather than blocking on it).

---

## 10. Auth Flows End to End

### 10.1 Key model (fixed)

- **Publishable key** (`dhpk_live_…` / `dhpk_test_…`) — ships in client bundles. Identifies tenant only. Grants nothing on its own.
- **Secret key** (`dhsk_live_…`) — never leaves the customer's server. Mints short-lived, scoped user JWTs.

### 10.2 Publishable key handshake

`connection.hello.d` includes `publishableKey`. The server resolves tenant identity from it before evaluating anything else — a request bearing a valid-looking but wrong-tenant token must be rejected with `AUTH_INVALID`, not silently proceed under the wrong tenant.

### 10.3 Secret-key token minting (customer's own backend, via `@dhaam-ccrm/node` or a generated backend SDK)

```
POST /v1/tokens
Authorization: Bearer dhsk_live_...
{ userId, name?, email?, ...customerDefinedClaims }
→ { accessToken, expiresIn }
```

The customer's frontend calls *their own* backend to get this token (never calls `/v1/tokens` directly with the secret key from a browser). The frontend then supplies that `accessToken` to the SDK via `getToken()`.

Whether this endpoint should also absorb v1's separate, hardcoded `mapCustomer()`-style external tenant/identity-mapping call (§12.6) — folding "who is this user in our system" fully into token minting so v2 clients make exactly one identity-related network call, not two — is Open Question 6.

### 10.4 Core's `getToken()` contract

- Core calls `getToken()` before the first `connect()`.
- Core calls it **proactively** ahead of expiry (default: at 80% of the token's `expiresIn`), not reactively after the server rejects a stale token — this is the core behavioral fix over v1, which has no refresh mechanism at all and requires a full page reload to recover from `TOKEN_EXPIRED`.
- Core calls it **reactively** if the server sends `error` with `code: 'AUTH_EXPIRED'` mid-connection, as a fallback for clock skew or unexpectedly short-lived tokens.

### 10.5 Token refresh mid-connection

After a successful `getToken()` refresh, core sends `connection.reauth` on the *same* open socket rather than tearing the connection down (Open Question 3 — this requires backend support that does not exist in v1, where the token is static for the socket's entire lifetime). If in-place re-auth turns out not to be feasible server-side, core falls back to a transparent reconnect (closed/reopened socket, same resume semantics as §8.3) — but the public API contract (`getToken()` is just called again; the app never has to think about which path was taken) must not change based on this backend decision.

### 10.6 Expiry / unrecoverable auth handling

If `getToken()` throws, resolves to a falsy value, or the server rejects three consecutive freshly-fetched tokens, core transitions to `suspended` (`reason: 'auth'`) rather than retry-looping forever against broken credentials (§8.2). The `error` event carries a structured code the host app can use to prompt re-login, replacing v1's crude `message.toLowerCase().includes('expired')` string check (§12.6).

### 10.7 Key rotation

- Rotating a **secret key** requires only a change on the customer's backend — no client redeploy, because the secret never ships client-side. This is the operational payoff of the two-key split and should be called out explicitly to customers.
- Rotating a **publishable key** requires a client bundle redeploy, since it's baked in at build/config time. Document this asymmetry so customers don't assume both keys rotate the same way.

---

## 11. Mobile — Decision Criteria Only (Explicitly Deferred)

Per the fixed decision, this PRD does **not** spec hand-written Swift + Kotlin + Flutter in parallel. It specs only the decision criteria and the two defensible paths, both of which the wire protocol in §7 is designed to keep open:

**Path A — one cross-platform target first.**
- React Native: reuse `@dhaam-ccrm/core` directly over JSI (core's zero-DOM-dependency invariant in §4 is exactly what makes this possible without a rewrite).
- Flutter: viable if design-partner signal specifically comes from Flutter shops (core would need a Dart reimplementation of the frame protocol, not a reuse — the wire spec in §7 is what makes that reimplementation tractable from spec alone).

**Path B — Kotlin Multiplatform**, sharing the state machine (§8) and dedup/queue logic (§9) natively across Android/iOS, with thin Swift/Kotlin UI layers on top — structurally the same "core + thin binding" shape as the web packages, just in a different language.

**Decision trigger:** actual customer signal (a named design partner requesting a specific platform), not internal preference. Until that signal exists, no mobile package name, timeline, or API surface should be committed to in any customer-facing material.

---

## 12. Grounded in v1 Reality — Message Model, Session Lifecycle, and Backend Quirks

This section documents what `src/client.ts`, `src/context.tsx`, `src/types.ts`, and `src/shared/enums.ts` reveal about the **real backend's** actual behavior — including its inconsistencies — because v2 must interoperate with (or deliberately fix) each of these, not guess at them.

### 12.1 Backend integer enum standard (confirmed)

`src/shared/enums.ts` documents a "§12 integer enum standard" the backend mirrors:

| Enum | Values |
|---|---|
| `SenderType` | `CUSTOMER=1, AGENT=2, BOT=3, SYSTEM=4` |
| `MessageType` | `TEXT=1, SYSTEM=2, FILE=3, IMAGE=4, VIDEO=5, AUDIO=6, TYPING=7` |
| `ChatStatus` | `OPEN=1, WAITING_FOR_AGENT=2, ASSIGNED=3, CLOSED=4, RESOLVED=5, ON_HOLD=6` |
| `ChatMode` | `BOT=1, HUMAN=2` |
| `DeliveryStatus` | `SENT=1, DELIVERED=2, READ=3` |
| `PresenceStatus` | `ONLINE=1, OFFLINE=2, AWAY=3, DND=4` |
| `MessageVisibility` | `PUBLIC=1, INTERNAL=2` |
| `ParticipantType` | `CUSTOMER=1, AGENT=2, BOT=3` |

Notably, `src/types.ts`'s `ChatStatus` string union only models **four** of the six real values (`OPEN | WAITING_FOR_AGENT | ASSIGNED | CLOSED`) — `RESOLVED` and `ON_HOLD` are real backend states the v1 *type system* doesn't even know about, even though `enums.ts` does. v2's session-status model must cover the full six-value set, plus a structured `closeReason` (v1 only has this as a loose `string | null` comment: `'SWITCHED' | 'MANUAL' | null`, used e.g. when a customer switches active sessions and the old one is parked, not truly ended).

### 12.2 Integer-vs-string and camelCase-vs-snake_case drift (confirmed, not hypothetical)

Both `client.ts` and `context.tsx` independently implement near-identical `normalizeSenderType`/`normalizeMessageType`/`normalizeChatStatus`/`normalizeChatMode` functions that accept **either** the integer enum value **or** the string name — because the backend has, across its rollout history, sent both. Separately, `normalizeMessage()` in `client.ts` reads every field defensively with fallback chains: `raw.chatSessionId ?? raw.chat_session_id`, `raw.senderId ?? raw.sender_id`, `raw.messageType ?? raw.message_type`, `raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt` (four aliases for one concept). This is direct evidence the backend has emitted both camelCase and snake_case for the same payload across different releases/endpoints.

**v2 implication:** the frame envelope (§7.2) mandates camelCase-only keys and one canonical enum wire representation (string names, recommended) precisely to make this class of defensive coercion permanently unnecessary in v2 clients — but this requires the backend to commit to a single format going forward (Open Question 4).

### 12.3 The `CONNECTION_ACK` handshake (confirmed asymmetry)

On fresh connect, the server pushes `chat.connection.ack` unprompted, containing `{ chatSessionId (or sessionIds[0]), mode, status }`. The client must then *separately* emit `chat.session.join` to actually enter the session room — the ack alone doesn't do it.

Critically, on `socket.io`'s built-in `reconnect` event, the server does **not** automatically resend `CONNECTION_ACK`. `client.ts` has an explicit workaround (`this.socket.on('reconnect', ...)`) that re-emits `JOIN_SESSION` purely to *coax* the server into sending a fresh ack, with an inline comment explaining exactly this asymmetry. v2's `connection.ack` (§7.3, §8.3) is specified to be symmetric — always sent in response to `connection.hello`, whether that hello follows a first connect or a reconnect — specifically to eliminate this workaround.

Also confirmed: if the ack's session turns out to be `CLOSED`, the v1 client falls back to creating a brand-new session via a REST POST — this is **client-orchestrated** recovery, not something the server does for you. Whether v2 keeps this client-side responsibility or moves it server-side is Open Question 2's sibling question, folded into the resume-semantics discussion in §8.3.

### 12.4 Typing-event proliferation (confirmed)

`client.ts` listens for **four** differently-named typing events (`TYPING_INDICATOR`, `TYPING`, `TYPING_START`, `TYPING_STOP`) and sends typing state via **two** different emits (`TYPING_START`/`TYPING_STOP` *and* a synthetic `TYPING_INDICATOR`) for compatibility, with a client-side 5-second auto-clear timer as a safety net against a stop event never arriving. §7.3 collapses this to exactly one pair (`typing.start`/`typing.stop`) used identically in both directions.

### 12.5 Session lifecycle & reopen semantics (confirmed)

Statuses observed in real flows: `OPEN → WAITING_FOR_AGENT → ASSIGNED → {RESOLVED | CLOSED | ON_HOLD}`, with `mode` independently `BOT | HUMAN`. `reopenSession()` deliberately **bypasses** the AI bot and jumps straight to `WAITING_FOR_AGENT`. When a customer switches to a different session while one is still open, the old one is closed with `closeReason: 'SWITCHED'` (not `'MANUAL'`) — `CLOSED` is overloaded to mean both "genuinely ended" and "parked because the customer moved to another chat." v2's `CloseReason` should be a first-class enum reflecting this real distinction rather than a loose string.

### 12.6 Auth reality being replaced (confirmed, motivates §10)

Token is sent **three redundant ways** on WS connect (`auth` object, `query` string params) plus **again** on every `message.send` payload. Token expiry is detected via `connect_error` string-matching (`error.message === 'TOKEN_EXPIRED'` or `.includes('expired')`) — no structured error code exists today. There is **no refresh mechanism**; recovering from expiry requires a full page reload to obtain a new Cognito token. REST calls use `Authorization: Bearer` + `X-Tenant-ID` header, while WS uses a `tenantId` **query param** instead — inconsistent auth conventions between the two transports in the same SDK.

Separately, `context.tsx`'s `mapCustomer()` fires a fire-and-forget POST to a **hardcoded external host** (`https://docs-dev.dhaamai.com/customers/map`, not `config.serviceUrl`) with a hardcoded `role_id: 4` and a `Number(config.user.id)` coercion (assumes numeric external user IDs) — a legacy identity-mapping bridge that exists entirely outside the chat backend's own request path. This is the concrete evidence behind Open Question 6.

### 12.7 Port-swap heuristics (confirmed anti-pattern to not repeat)

`client.ts` derives the WS URL from `serviceUrl` via string surgery: `if (wsUrl.includes(':3000')) wsUrl = wsUrl.replace(':3000', ':3001')`, and the file-upload path does the reverse swap. This assumes a specific local-dev port convention and breaks behind any reverse proxy or single-origin production deployment. §6.1's `apiUrl`/`wsUrl` are independent, explicit config fields in v2 — no string-replace derivation of one from the other.

### 12.8 (see §7.3 above — typing events; consolidated there to avoid duplication)

### 12.9 Message ack, dedup, and read-state reality (confirmed, motivates §9)

`sendMessage()` generates a `clientMessageId` (`crypto.randomUUID()`), sent alongside — not as — the message payload. The server is expected to reply with `chat.message.ack` carrying `{clientMessageId, messageId, chatSessionId, seq}`, which `context.tsx` uses to swap the optimistic "temp-" id for the real one. But `context.tsx` **also** maintains a parallel, independent fallback: a `pendingReplaces` map keyed by message *content string*, used to suppress echoed `MESSAGE_RECEIVE` events within a 10-second window, with an explicit comment that this exists because the ack path alone wasn't reliable enough historically. Two overlapping dedup mechanisms for the same problem is strong evidence the ack contract needs to be made structurally reliable in v2 (§9.3) rather than papered over with a content-matching heuristic, which itself breaks on any two identical messages sent in quick succession.

Read state: confirmed to already be a **watermark model** — `GET /sessions/{id}/full` returns `participants[]` with `lastReadAt`, used to seed the UI's read indicator on load, with the client taking the *max* `lastReadAt` across all agent participants (defending against multi-agent sessions). Real-time updates arrive via `chat.message.read` (`{readBy, readAt}`, `readBy` an integer `ParticipantType`), **and** `context.tsx` independently fires a REST `POST /sessions/{id}/read` for the same read event — two write paths for one fact, explicitly commented as intentional redundancy. §9.5 keeps the watermark *model* but collapses this to one write path.

### 12.10 File upload and pagination (confirmed, generalized in §6.3/§9)

Attachments are a two-step flow: multipart `POST /chat-services/api/v1/upload` (REST, Bearer-only, no tenant header — another auth-convention inconsistency vs. the rest of the REST surface) returns `{url, fileName, mimeType, size, mediaType}`, and the client then emits `message.send` over WS with that URL as content plus the attachment metadata. **Note this section describes v1**, which nested it at `metadata.attachment`; v2 carries a **top-level** `attachment` field per D4, because v1 read `message.attachment` and `message.metadata.attachment` interchangeably (§12.2) and one canonical location is the point. Do not read this paragraph as the v2 target shape. Pagination for message history uses an opaque-id cursor (`before={messageId}&limit=20`) with a `hasMore` boolean — no `after`/forward cursor exists because live messages arrive over WS, not by polling. Both patterns are sound enough to generalize into v2 (§6.3, §9), modulo Open Question 7 on whether upload stays proxied or moves to presigned URLs.

### 12.11 Heartbeat and reconnect policy (confirmed gap, motivates §8.2)

The client sends `chat.heartbeat` every 25 seconds on a fixed interval; there is no documented server pong in this codebase. Reconnect is entirely delegated to `socket.io`'s built-in behavior with a **fixed** 1000ms delay and a 5-attempt cap — no exponential backoff, no jitter. §8.2's full-jitter exponential backoff is a deliberate improvement over this, not a preservation of existing behavior.

---

## 13. Deferred: `@dhaam-ccrm/ui`

Prebuilt UI components (`@dhaam-ccrm/ui`) are explicitly deferred, possibly indefinitely. This PRD does not scope its API, theming model, or accessibility target. The ship-order-2 demo app (§5) is expected to hand-roll minimal UI directly against `@dhaam-ccrm/core` + `@dhaam-ccrm/react` as a dogfooding proof, not to wait on a design system that doesn't exist yet (see Open Question 10).

---

## 14. Non-Functional Requirements

- **Performance:**
  - Core module (excluding a chosen storage/logger adapter) should be reasonably lean for a client bundle; an exact gzip budget is not fixed by this PRD (Open Question 9 territory) but should be tracked from the first release so it doesn't silently balloon.
  - `connect()` → `connected` state should complete within one network round trip plus token-fetch latency under normal conditions — no artificial delays.
  - Reconnect backoff bounds are fixed at base 500ms / cap 30s / full jitter (§8.2) regardless of final tuning numbers chosen.
- **Security:**
  - No credential (token, secret key) is ever passed to `logger` or included in any log line core emits — logger calls must be reviewed for this on every PR touching auth code.
  - `dhsk_live_...` secret keys must be structurally impossible to reference from any browser-targeted package (`core`, `react`, `vue`, `angular`, `js`) — only `node` and generated backend SDKs know this key exists.
  - All inputs crossing the wire boundary (frame payloads) are validated against the schema in §7.2 before being applied to state; malformed frames are dropped with a logged warning, not applied partially.
- **Accessibility:** Not applicable to `core`/bindings directly (no UI). Deferred to `@dhaam-ccrm/ui` (§13) and to each customer's own UI built on the bindings.
- **Compatibility:**
  - `core`/web bindings target ES2020+, any environment with a native `WebSocket` global (browser main thread, and — pending §11 — a React Native JS engine).
  - `@dhaam-ccrm/node` targets Node 18+.
  - TypeScript 5.x across all packages.

---

## 15. Acceptance Criteria

- [ ] `@dhaam-ccrm/core` has no `react`, `vue`, `@angular/*`, or `socket.io-client` in its `package.json` `dependencies` or `peerDependencies`, and no reference to `window`/`document` outside a clearly isolated, optional platform-adapter file.
- [ ] The frame envelope, frame type catalog, and error codes in §7 are published (this document + OpenAPI/AsyncAPI-equivalent) before core implementation begins.
- [ ] `client.subscribe()` delivers a full, consistent `ChatState` snapshot on every state-affecting event listed in §6.5.
- [ ] A message sent while offline is queued durably (survives a simulated reload via the `StorageAdapter`), sent on reconnect in original order, and never appears twice in `ChatState.messages` even if the server had actually persisted it before the drop.
- [ ] `getToken()` is called proactively before expiry in a running integration test, with no reactive `AUTH_EXPIRED` round trip required in the happy path.
- [ ] Reconnect delay sequence in a test harness matches the full-jitter formula in §8.2 (bounded, not fixed-delay).
- [ ] The React binding's exposed `ChatState` shape is byte-for-byte identical (same field names, same types) to core's `ChatState` — enforced by a shared TypeScript type import, not hand-copied.
- [ ] The demo app (ship-order step 2) imports only `@dhaam-ccrm/core` and `@dhaam-ccrm/react` from the published package scope — verified by dependency audit, not by convention.
- [ ] No functional requirement in this document requires reading or porting any file under `src/` at implementation time — `src/` is reference-only, confirmed via a review pass before Phase 2 (Plan) begins.

---

## 16. Out of Scope

- Any code reuse or migration from `src/` (v1 is reference-only).
- `socket.io` or any socket.io-compatible transport, on any platform.
- Static/long-lived token configuration of any kind.
- `@dhaam-ccrm/ui` — prebuilt components (§13).
- Any mobile SDK build (Swift, Kotlin, Flutter, React Native, or Kotlin Multiplatform) — decision criteria only (§11).
- Agent-console / support-agent-facing product surface, except where it defines a wire event this SDK must consume (e.g. `agent.joined`).
- Backward wire-compatibility with any v1 event name or payload shape.
- Multi-protocol-version support (v2.0 targets exactly one protocol version; version negotiation exists in the frame envelope from day one, but there is only one version to negotiate to at launch).

---

## 17. Constraints & Assumptions

- The backend is fully under our control (fixed decision) — every wire-protocol change proposed here (symmetric ack, single enum format, single key casing, structured error codes, `connection.reauth`) requires backend implementation work that is not yet scoped or estimated by this PRD; it assumes that work is tracked as backend-side tasks in the downstream plan.
- ~~assumes the backend will commit to string-name enums and camelCase-only payloads~~ — **confirmed, D4 (§0.5).** §7.2's payload rules are binding.
- ~~assumes `getToken()`-driven refresh and `connection.reauth` are achievable server-side~~ — **confirmed, D3 (§0.5).** No longer a bet. v1 still has zero precedent, so this is net-new backend work, not a port.
- Package naming (`@dhaam-ccrm/*`) and the specific ship order (§5) are fixed and not subject to renegotiation in this document.

---

## 18. Open Questions (ranked by how much they block work)

1. ~~**[BLOCKING] Does the v2 backend echo the client-generated ULID back as the message's permanent id?**~~ — **RESOLVED 2026-08-17 → D1 (§0.5).** Yes. Client ULID is the permanent id; no optimistic-id-swap path in core.

2. ~~**[BLOCKING] Does the backend track a per-session sequence number for inline resume?**~~ — **RESOLVED 2026-08-17 → D2 (§0.5).** Yes. Monotonic per-session `seq`; `connection.ack` replays missed frames inline; `seq` is the ordering key.

3. ~~**[BLOCKING] Can the WS protocol support in-place re-authentication?**~~ — **RESOLVED 2026-08-17 → D3 (§0.5).** Yes. `connection.reauth` on the live socket; transparent reconnect is the defensive fallback only.

4. ~~**[HIGH] Will the backend commit to one wire format for enums and key casing?**~~ — **RESOLVED 2026-08-17 → D4 (§0.5).** Yes. String-name enums, camelCase keys, ISO-8601 timestamps. Core ships zero coercion.

**Remaining open questions (5–10) below do not block Phase 2 planning.**

5. **[MEDIUM] What is `chat.notification.new_message` actually for?** v1's own handler is a no-op with a comment saying the badge is already handled elsewhere (§7.3 note). Is it meant for cross-session notifications (a customer with multiple concurrent sessions), or is it dead weight that should simply not exist in v2? Affects whether §7.3 needs an additional frame type. *(Owner: product + backend)*

6. **[MEDIUM-HIGH] Should `POST /v1/tokens` (secret-key minting) absorb v1's separate, hardcoded `mapCustomer()` identity-mapping call (§12.6), so v2 clients make one identity-related network call instead of two?** Affects the token-minting endpoint's contract and whether §10.3 is accurately described as "one call." *(Owner: backend team)*

7. **[MEDIUM] Does attachment upload stay proxied through the chat service (as in v1), or move to direct-to-S3 presigned URLs minted via REST?** Doesn't block core/react (ship-order steps 1–2 can launch with either), but blocks the OpenAPI spec's upload endpoint shape and matters more once mobile bandwidth is a consideration (§11). *(Owner: backend team)*

8. **[LOW-MEDIUM — confirmation, not redesign] Confirm v2 keeps the watermark-based read-state model (`lastReadAt` per participant) rather than moving to per-message read receipts**, which `DeliveryStatus` in `enums.ts` hints at but v1's client never actually wires up end to end. Low risk either way but should be locked before §9.5 is implemented. *(Owner: product)*

9. **[LOW — tuning, not architecture] Exact numeric defaults:** backoff base/cap (§8.2 proposes 500ms/30s), consecutive-auth-failure threshold before `suspended` (§8.2 proposes 3), and offline-queue max age/size before a queued send is surfaced as permanently failed (§9.6). Can ship with the proposed defaults and revisit — does not block Phase 2 planning. *(Owner: product)*

10. **[LOW — scoping confirmation] Confirm the ship-order-2 demo app is expected to hand-roll its own minimal UI directly against `core`/`react` (per §13) without waiting on `@dhaam-ccrm/ui`, and that no customer-facing commitment implies a UI-package timeline.** Mostly unblocks the demo app's design effort rather than blocking core engineering. *(Owner: product)*

---

*This spec is a living document. Update it before implementation diverges from it, not after — per the project's spec-driven-development skill, the spec is the shared source of truth, not a one-time artifact.*
