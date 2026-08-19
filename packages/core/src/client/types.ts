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
import type { SendQueueRetention } from '../queue/index.js';
import type {
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatSession,
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
  joinSession(sessionId: string): void;
  leaveSession(): void;
  requestAgent(reason?: string): void;
  /** REST-only (§6.2, §12.5). Throws {@link ChatClientConfigError} if `config.sessionActions` was not supplied. */
  reopenSession(sessionId: string): Promise<ChatSession>;
  /** REST-only (§6.2). Throws {@link ChatClientConfigError} if `config.sessionActions` was not supplied. */
  closeSession(): Promise<void>;

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
  markRead(): void;
  startTyping(): void;
  stopTyping(): void;
  /** §6.3 names this `loadOlderMessages`; `MessageController` (messages/) implements it as `loadMore` — this is the public name. */
  loadOlderMessages(): Promise<void>;

  // ---- presence operations (§7.3's `presence.set`/`presence.query`; not named as ChatClient methods anywhere in §6.3's table, added for parity with the "presence/typing/read operations" every binding needs — see the T13 report) ----
  setPresence(status: PresenceStatus): void;
  queryPresence(participantIds?: readonly string[]): void;
}
