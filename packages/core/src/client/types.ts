// The public client contract — PRD §6.1-§6.5, assembled here because no
// single T7-T12 module owns the whole surface. See create-chat-client.ts for
// the wiring and the T13 report (delivered as this task's final response) for
// every judgment call this file embodies.
//
// ── Where this file's shape diverges from §6.1's literal text, and why ──
//
// §6.1's `ChatClientConfig` lists six fields: `publishableKey`, `getToken`,
// `apiUrl?`, `wsUrl?`, `storage?`, `logger?`, `protocolVersion?`. Building the
// client surfaced seams none of those six can satisfy:
//
//   - `localSender` (required). `ChatSession` carries both a `customer` and
//     an `assignedAgent` (state/types.ts), and nothing in §6.1's config lets
//     core tell which one this process is. Guessing CUSTOMER would mislabel
//     every message an agent-side embed sends (see messages/types.ts's
//     `LocalSender` doc). Required, not optional — a silently-wrong sender
//     label is worse than a construction-time type error.
//   - `history` (required). `MessageController` needs a `MessageHistorySource`
//     (messages/types.ts) and core does no HTTP itself (§4: network
//     *implementations* are explicitly NOT core's to own — only the
//     interface is). Pagination is core enough to nearly every integration
//     that an unconfigured default would just move the failure to the first
//     `loadOlderMessages()` call instead of to construction.
//   - `uploader` (optional). Same reasoning, but `sendAttachment()` is not
//     every integration's concern, so this is optional — omitting it costs
//     nothing until `sendAttachment()` is actually called, at which point it
//     rejects loudly. That check runs at the `ChatClient` boundary rather
//     than only inside the uploader stub passed to `MessageController`:
//     `MessageController#sendAttachment` never rejects on an upload failure
//     at all (it reports through `lastError`/the `error` event, §6.4), so a
//     stub alone would make "no uploader configured" indistinguishable from
//     a real runtime upload failure.
//   - `sessionActions` (optional). `reopenSession`/`closeSession` (§6.2) have
//     no WebSocket frame type in §7.3's catalog at all — confirmed by
//     openapi/chat-api.yaml's `/sessions/{id}/reopen` and `/sessions/{id}/close`
//     paths, both REST-only "same as v1". No T7-T12 module defines a seam for
//     them, so this file adds one, following the exact shape of `history`/
//     `uploader`: an interface core does not implement, only calls.
//   - `sessionSummarySource` (optional, T10). Backs `listSessions()` — the
//     session-picker's data source. Same shape of seam as `sessionActions`:
//     `GET /chat/sessions/customer` is REST-only, core does no HTTP, so this
//     is an interface core calls, never implements.
//   - `webSocketFactory`, `schedule`, `now` (all optional, advanced). Needed
//     to construct a deterministic, network-free end-to-end test through the
//     public API — and, not incidentally, to run on a React Native JS engine
//     whose `WebSocket` global (§11) may need a non-default factory. Every
//     T7-T12 module already injects its clock/scheduler/socket rather than
//     reading a global; these three fields are the only way `createChatClient`
//     can pass a caller's override down through construction.
//   - `pageSize`, `queueRetention` (optional). Direct pass-throughs to
//     documented override points `messages/types.ts` (`DEFAULT_PAGE_SIZE`)
//     and `queue/types.ts` (`SendQueueRetention`, "Open Question 9 ... ship
//     with a documented default rather than blocking on it") already declare
//     as intentionally tunable, not architectural.
//
// `apiUrl` is kept for §6.1 conformance even though core never reads it: with
// every REST seam injected (`history`, `uploader`, `sessionActions`), core
// itself makes zero HTTP calls, so there is nothing here for `apiUrl` to
// parameterize. It is accepted so a consumer can keep one config object and
// hand `apiUrl` to their own adapter construction; see the T13 report for the
// full "inject vs. default" reasoning, which cites openapi/chat-api.yaml's
// `servers` block (`{apiUrl}/chat-services/api/v1` — corrected mid-build from
// `{apiUrl}/v1`) as a concrete reason not to bake a REST base path into core.

import { ConnectionAbortedError, ConnectionSuspendedError } from '../connection/index.js';
import type { AuthToken, TokenProvider } from '../connection/index.js';
import type {
  AttachmentUploader,
  LocalSender,
  MessageHistorySource,
  SendAttachmentOptions,
  SendMessageOptions,
} from '../messages/index.js';
import type { PresenceStatus } from '../protocol/index.js';
import type { RetryOutcome, SendQueueRetention } from '../queue/index.js';
import type {
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  Unsubscribe,
} from '../state/index.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Clock, ScheduleTimer } from '../presence/index.js';
import type { WebSocketFactory } from '../transport/index.js';

export { ConnectionAbortedError, ConnectionSuspendedError };
export type { AuthToken, TokenProvider };
export type { LocalSender, AttachmentUploader, MessageHistorySource, SendAttachmentOptions, SendMessageOptions };

/**
 * Backs `client.reopenSession()`/`client.closeSession()` (§6.2).
 *
 * Both are REST-only (`POST /chat-services/api/v1/chat/sessions/{id}/reopen`
 * and `/close`) — "There is no WebSocket frame type for this action in the T1
 * catalog" per the spec's own description of each route. The unprefixed
 * `/sessions/{id}/…` paths this comment used to name are served by nothing;
 * corrected in the spec and in `@dhaam-ccrm/rest`, and noted here only so the
 * comment stops pointing at dead routes.
 * Core does no HTTP (§4), so — exactly like `MessageHistorySource` and
 * `AttachmentUploader` — this is an interface core calls, never implements.
 *
 * Both methods return the REST `ChatSession` shape (openapi `ChatSession`
 * schema), which is field-for-field state/types.ts's `ChatSession` and,
 * unlike the WebSocket `SessionSnapshot` (protocol/domain.ts), carries full
 * `Profile` objects (`displayName`/`email`/`avatarUrl`) — so a configured
 * `sessionActions` also happens to be the one path that gives
 * `ChatState.session` fully-accurate participant profiles, rather than the
 * best-effort placeholders `session.ts`'s WS-only mapping produces.
 *
 * ── Reporting a change the server applied but could not confirm ──
 *
 * An implementation may need more than one round trip to produce the full
 * `ChatSession` (the REST adapter does: a mutating POST, then a read of the
 * full session). If the mutation lands and the follow-up fails, rejecting
 * plainly tells core the action did not happen, when in fact it did — and
 * `ChatState.session` is then quietly wrong.
 *
 * An implementation in that position should reject with an error carrying
 * `sessionMutationApplied: true`. Core checks for that property structurally,
 * imports nothing to do so, and responds by surfacing a `ChatError` through
 * `lastError` and the `error` event before re-throwing, so the staleness is at
 * least visible. Anything without the flag is passed through untouched.
 *
 * An implementation that retries such a failure must retry only the read, never
 * the mutation: `closeSession` is not idempotent on this service.
 */
export interface SessionActions {
  reopenSession(sessionId: string): Promise<ChatSession>;
  closeSession(sessionId: string): Promise<ChatSession>;
}

/**
 * Backs `client.listSessions()` (T10) — the customer's own recent sessions,
 * for the SDK's session-picker.
 *
 * REST-only, same reasoning as `SessionActions`: `GET
 * /chat/sessions/customer` (openapi's `listSessions` operation) has no
 * WebSocket frame counterpart, core does no HTTP (§4), so this is an
 * interface core calls, never implements.
 * `@dhaam-ccrm/rest`'s `createSessionSummarySource<ChatSessionSummary>(client)`
 * satisfies this structurally — same pattern as `history`/`uploader`/
 * `sessionActions`, so a divergence between the two packages fails to
 * typecheck at the consumer's `createChatClient(...)` call, not here.
 *
 * **A guest gets `200` with `[]`, never a 403/404** (see the `listSessions`
 * operation's own description) — `client.listSessions()` passes that
 * straight through as a normal, successful empty result. Do not treat
 * emptiness as absence of configuration or as a reason to retry; the picker
 * uses an empty array to decide not to render at all.
 */
export interface SessionSummarySource {
  listSessions(query?: { readonly limit?: number }): Promise<readonly ChatSessionSummary[]>;
}

/** Thrown when a `ChatClient` operation needs configuration that was not supplied. */
export class ChatClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatClientConfigError';
  }
}

/**
 * §6.1, extended with the seams construction revealed — see this file's
 * header for exactly which fields are additive and why.
 */
export interface ChatClientConfig {
  /** `dhp_live_…` / `dhp_test_…`. Validated at construction (§10.1, §10.2, §14) — a secret key throws loudly rather than reaching the wire. */
  readonly publishableKey: string;

  /**
   * §6.1 types this `() => Promise<string>`. Widened here to `TokenProvider`
   * (connection/types.ts) — `Promise<string | AuthToken> | string | AuthToken`
   * — which is a strict superset: every `() => Promise<string>` already
   * satisfies it, so nothing conforming to the literal PRD signature breaks.
   * The extra room lets a host report `expiresInMs` so §10.4's proactive
   * refresh actually has something to schedule against, instead of always
   * falling back to the reactive `AUTH_EXPIRED` path. `auth/token-source.js`'s
   * `createTokenProvider` is the intended way to produce one of these from a
   * real token endpoint's response. A bare `string` config value is still a
   * type error either way — the one thing §6.1 forbids stays forbidden.
   */
  readonly getToken: TokenProvider;

  /**
   * REST base. Accepted for §6.1 conformance; core makes no HTTP calls of its
   * own (every REST seam below is injected), so nothing here reads it. Kept
   * so a consumer can build their `history`/`uploader`/`sessionActions`
   * adapters from the same config object instead of duplicating a URL.
   */
  readonly apiUrl?: string;

  /**
   * WebSocket base. §6.1 types this optional, but core has no legitimate
   * default to fall back to — §12.7 is an explicit rejection of hardcoded or
   * derived hosts ("no port-swap heuristics ... no single fixed multi-tenant
   * SaaS domain to hardcode", echoed in openapi/chat-api.yaml's `servers`
   * block). Omitting it is therefore a loud `ChatClientConfigError` at
   * `createChatClient()`, not a silent no-op or a guessed URL.
   */
  readonly wsUrl?: string;

  /** Durable KV (§9.1). Defaults to `new MemoryStorageAdapter()` — survives a network blip, not a reload. */
  readonly storage?: StorageAdapter;

  /** §14: never receives credential or message content. Routed to the transport's malformed-frame / anomaly warnings. */
  readonly logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;

  /** Overrides the highest protocol version this client advertises (§7.5). Defaults to the transport's own default. */
  readonly protocolVersion?: number;

  /**
   * Who this client sends as (§6.3's `sendMessage`, and, so that typing
   * self-echo filtering and read watermarks key the right participant,
   * presence too — see create-chat-client.ts's `resolveLocalSender`).
   *
   * Required: `ChatSession` carries both a `customer` and an `assignedAgent`,
   * and nothing else in this config tells core which one the local process
   * is. A thunk is accepted for the case identity is not known until after
   * the host's own auth completes; `createChatClient` calls it once, eagerly,
   * at construction, to seed presence/typing/watermark identity as well as
   * message labeling. See the T13 report for what happens if the thunk needs
   * data that is only available after `connect()`.
   *
   * ── Staff (agent / merchant) clients ───────────────────────────────────
   * `LocalSender.senderType` is a full `SenderType` (protocol/enums.ts), so `'AGENT'` is
   * already expressible here and an agent or merchant app needs no new field
   * to say who it is. What this value is NOT is a claim the server honours:
   * the server derives the recorded `senderType` from the connection's
   * verified token claims alone, and there is no role field on any
   * client→server frame for it to read instead. Configuring `'AGENT'` while
   * holding a customer token therefore does not make this client an agent —
   * it only mislabels the local optimistic echo, which the server corrects
   * via `senderType` on the `message.send` ack (`MessageSendAckData` in
   * protocol/frames.ts).
   *
   * So: set this to match the token the host will hand to `getToken`. It is a
   * rendering hint for the local echo, never an authorization input.
   */
  readonly localSender: LocalSender | (() => LocalSender);

  /** Backward-cursor history reads (§6.3, §12.10). Required — see this file's header. */
  readonly history: MessageHistorySource;

  /** Step one of the upload-then-announce flow (§6.3, §12.10). Optional — `sendAttachment()` throws {@link ChatClientConfigError} if omitted and called. */
  readonly uploader?: AttachmentUploader;

  /** Backs `reopenSession`/`closeSession` (§6.2). Optional — each throws {@link ChatClientConfigError} if omitted and called. */
  readonly sessionActions?: SessionActions;

  /** Backs `listSessions()` (T10). Optional — throws {@link ChatClientConfigError} if omitted and called. */
  readonly sessionSummarySource?: SessionSummarySource;

  /** Advanced: overrides the platform `WebSocket` global (§11 — React Native, tests). Defaults to the ambient global, probed lazily at connect time. */
  readonly webSocketFactory?: WebSocketFactory;

  /** Advanced: overrides every timer this client schedules (reconnect backoff, heartbeat, ack timeout, typing auto-clear). Defaults to real timers. */
  readonly schedule?: ScheduleTimer;

  /** Advanced: overrides the clock used for envelope timestamps and retention age checks. Defaults to `Date.now`. */
  readonly now?: Clock;

  /** Page size for `loadOlderMessages()` (§6.3, §12.10). Defaults to `DEFAULT_PAGE_SIZE` (20, v1's proven value). */
  readonly pageSize?: number;

  /** §9.6 bounds for the offline send queue. Both have documented defaults; see `queue/types.ts`. */
  readonly queueRetention?: SendQueueRetention;
}

/**
 * The full public surface — §6.2 (session ops), §6.3 (message ops), §6.4
 * (observable state), §6.5 (events, via `on`).
 */
export interface ChatClient {
  // ---- §6.4 observable state surface ----
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): Unsubscribe;
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe;

  // ---- §6.2 session / channel operations ----
  /** Opens the connection and drives it to `connected` (§8). Rejects with {@link ConnectionSuspendedError} or {@link ConnectionAbortedError}. */
  connect(): Promise<void>;
  /** User-initiated, terminal (§8.1). No auto-reconnect follows. */
  disconnect(): void;
  /**
   * Joins a session by id over the open socket (`session.join`).
   *
   * Fire-and-forget like `leaveSession`/`requestAgent`: a successful join is
   * observed through the `session.updated`/`connection.ack` snapshot that
   * follows (`ChatState.session` becomes `sessionId`), not through this
   * call's own return. A REJECTED join (the server's ownership check —
   * v2/handlers.ts — refusing a session that does not belong to this
   * customer) is surfaced through `ChatState.lastError`/the `error` event,
   * same as every other protocol-level failure (§6.4) — it does not throw
   * here and does not silently vanish either.
   *
   * `switchSession` below is this exact method under the name a session
   * picker calls it by; the two are not independent operations that could
   * drift apart — see its doc.
   */
  joinSession(sessionId: string): void;
  /**
   * Switches to a different session — the session-picker's action (T10).
   * **Literally `joinSession(sessionId)`** — same frame, same ack handling,
   * same everything; provided under this name only because "switch to this
   * past conversation" reads better at a picker call site than "join". Pick
   * whichever name reads better at your call site; nothing behaves
   * differently between them, and nothing ever will — that equivalence is
   * intentional and load-bearing, so a consumer can safely treat the two
   * names as one operation.
   *
   * `v2/handlers.ts` already ownership-checks `session.join` and already
   * accepts a TERMINAL session (`CLOSED`/`RESOLVED`) — switching to a past,
   * closed conversation is exactly that path, not a special case this SDK
   * adds. Joining a terminal session does not, by itself, reopen it and does
   * not optimistically flip `status` locally — this client never guesses at
   * a status the server has not confirmed (§9.4). Reopening only happens if
   * the customer then sends a message into it: node T1 (backend) reactivates
   * a terminal session to `WAITING_FOR_AGENT` on the next CUSTOMER message,
   * behind `FEATURE_SESSION_REACTIVATE_ON_CUSTOMER_MESSAGE` (default OFF),
   * and this client only ever learns that happened from the resulting
   * `session.updated` — never assumes it.
   *
   * ── The SWITCHED-close pairing ──
   *
   * That same reactivation may ALSO close the customer's other still-active
   * session with `closeReason: 'SWITCHED'` server-side (one customer, one
   * live conversation). This client can therefore observe one `session.closed`
   * (for the session just left) and one `session.updated`/reactivation (for
   * the session just switched into) in either order. Both are handled so
   * that pair can never corrupt the session just switched into: `SWITCHED`
   * is a parked close (§12.5) so the old session's queued sends are left
   * alone rather than failed, and — the part T10 had to add — the
   * `sessionClosed` event and `closedAt` stamp only ever apply to whichever
   * session `frame.d.sessionId` actually names, never to whatever happens to
   * be `ChatState.session` at the moment the frame arrives. A customer who
   * has already switched will not be told their NEW chat just closed because
   * their OLD one, elsewhere, did.
   */
  switchSession(sessionId: string): void;
  leaveSession(): void;

  /**
   * Abandons the current session and opens a brand-new one (§12.5).
   *
   * The recovery path out of a terminal `session.closed` — the reason a
   * closed conversation is not a dead end. An agent resolving a chat leaves
   * the client holding a session it may no longer send into, and there is no
   * other way back: `disconnect()` + `connect()` re-sends the old session's
   * `resumeFrom`, which the server refuses non-retryably ("resumeFrom is
   * ahead of this session"), landing the client in `suspended`.
   *
   * Resolves once `connection.ack` for the NEW session has been applied, so
   * `getState().session` is the new one by the time it settles. On resolution:
   *
   *   - `session.id` is new and `messages` is empty — a new conversation must
   *     not read as a continuation of the old transcript;
   *   - watermarks, presence, typing and unread are cleared, none of which
   *     mean anything across a session boundary;
   *   - any send still queued for the old session has been failed with
   *     `'sessionClosed'` rather than delivered into this one (see
   *     {@link SendFailureReason}) — `message.send` has no `sessionId` on the
   *     wire, so an entry that outlived its session would land here.
   *
   * `pastSessions` is left alone; it describes other sessions, not this one.
   *
   * Rejects with whatever `connect()` rejects with ({@link
   * ConnectionSuspendedError}, {@link ConnectionAbortedError}). The old
   * session is already abandoned if it does — this is not atomic, and a
   * caller that retries should call it again rather than assume the old
   * session is still there.
   */
  startNewSession(): Promise<void>;
  requestAgent(reason?: string): void;
  /** REST-only (§6.2, §12.5). Throws {@link ChatClientConfigError} if `config.sessionActions` was not supplied. */
  reopenSession(sessionId: string): Promise<ChatSession>;
  /** REST-only (§6.2). Throws {@link ChatClientConfigError} if `config.sessionActions` was not supplied. */
  closeSession(): Promise<void>;
  /**
   * The session-picker's data source (T10) — the customer's own recent
   * sessions, most recent first.
   *
   * Also writes the result to `ChatState.pastSessions` wholesale (§9.4-style
   * replace, not a merge), so a caller does not need a second `getState()`
   * round trip to render the picker — the returned array and
   * `getState().pastSessions` are the same data.
   *
   * REST-only. Throws {@link ChatClientConfigError} if
   * `config.sessionSummarySource` was not supplied. Otherwise rejects with
   * whatever the adapter rejects with — this does not swallow a failure into
   * `lastError` the way `loadOlderMessages` does, because a picker calling
   * this once on open needs a direct signal to show its own "couldn't load"
   * state, not a side-channel it would have to separately subscribe to.
   *
   * **An empty result (including for an unidentified/guest caller) is a
   * normal, successful resolution — `[]` — never an error and never
   * distinguished from "no sessions yet".** Do not add a check for this;
   * see {@link SessionSummarySource}'s doc for why the wire itself makes no
   * such distinction.
   */
  listSessions(query?: { readonly limit?: number }): Promise<readonly ChatSessionSummary[]>;

  // ---- §6.3 message operations ----
  sendMessage(content: string, opts?: SendMessageOptions): Promise<void>;
  /**
   * Rejects synchronously with {@link ChatClientConfigError} if `config.uploader`
   * was not supplied — checked explicitly at the `ChatClient` boundary,
   * because `MessageController#sendAttachment` (messages/) does not reject
   * on an upload failure at all: it reports through `ChatState.lastError`/
   * the `error` event instead, with a fixed generic message, so a genuine
   * runtime upload failure and a missing `config.uploader` would otherwise
   * be indistinguishable. A configured uploader's own failures still follow
   * that same lastError/`error` path unchanged, per §6.4.
   */
  sendAttachment(file: Blob, opts?: SendAttachmentOptions): Promise<void>;
  /**
   * Retries a permanently-failed send (T10, wrapping T9's `SendQueue.retry`
   * verbatim) — the id is the message's own permanent id (D1), the SAME one
   * `ChatMessage.id`/`sendFailed.id` already carry, so a Retry button on an
   * already-rendered failed bubble needs no new id to track.
   *
   * Replays the ORIGINAL envelope under its original id (the server dedupes
   * on it, §9.3) rather than minting a new message — so retrying never
   * produces a second, independently-failing copy of what the user
   * experiences as one message.
   *
   * Resolves to a {@link RetryOutcome} the caller can branch on directly,
   * never a bare boolean or a thrown error for the ordinary refusal case:
   *
   *   - `{status: 'retried', entry}` — durably re-queued and draining;
   *     `getState().messages` is updated synchronously before this resolves,
   *     so the message reads `delivery: {state: 'queued'}` again immediately
   *     (its eventual ack/failure arrives the normal way, through the
   *     `message`/`messageAck`/`sendFailed` events).
   *   - `{status: 'refused', reason: 'not-found'}` — nothing eligible under
   *     this id (already retried, already succeeded, or never failed).
   *   - `{status: 'refused', reason: 'not-retryable'}` — retrying is not
   *     worth attempting. This is also what a caller gets for an id whose
   *     failed send belonged to a session that is no longer the one
   *     currently joined (T10): `message.send` carries no `sessionId` on the
   *     wire, so replaying that id now would silently attribute it to
   *     whatever session IS current — exactly the misattribution
   *     `startNewSession`/`switchSession` already guard against on the
   *     reconnect path (see `SendFailureReason.sessionClosed`'s doc). A
   *     caller does not need to special-case this — it is folded into the
   *     ordinary `'not-retryable'` refusal, so "don't show a Retry button"
   *     is decided the same way regardless of why.
   *
   * Check `ChatMessage.delivery`'s `failed.retryable`/`failed.code` (state/
   * types.ts) BEFORE ever calling this, to decide whether to render the
   * Retry affordance in the first place — this method is what runs when the
   * user presses it, not what decides whether to show it.
   */
  retryMessage(id: string): Promise<RetryOutcome>;
  markRead(): void;
  startTyping(): void;
  stopTyping(): void;
  /** §6.3 names this `loadOlderMessages`; `MessageController` (messages/) implements it as `loadMore` — this is the public name. */
  loadOlderMessages(): Promise<void>;

  // ---- presence operations (§7.3's `presence.set`/`presence.query`; not named as ChatClient methods anywhere in §6.3's table, added for parity with the "presence/typing/read operations" every binding needs — see the T13 report) ----
  setPresence(status: PresenceStatus): void;
  queryPresence(participantIds?: readonly string[]): void;
}
