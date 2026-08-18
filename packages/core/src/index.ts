// @dhaam-ccrm/core — framework-agnostic chat SDK core.
//
// Hard invariant: this package has ZERO framework, UI, and DOM-document
// dependencies. It may reference the `WebSocket` global; it may not reference
// `window` or `document` outside an explicitly isolated platform adapter
// (storage/browser.ts). See docs/spec/chat-sdk-v2-prd.md §4 and §15.
//
// This is the front door (T13): `createChatClient` assembles the ten
// modules under src/ into the single `ChatClient` PRD §6.2-§6.5 describe.
// Everything below is a deliberate decision about what leaves the package —
// see each section for the reasoning; the full account is this task's
// final report.
//
// ── What is NOT exported, and why ──
//
//   connection/  ConnectionController, the state machine, ResumeTracker,
//                token.ts, FakeTransport — the engine `createChatClient`
//                drives. A consumer never constructs one directly; `connect`/
//                `disconnect` (below) are the only surface. The two error
//                classes a rejected `connect()` can throw ARE public — see
//                client/ below.
//   messages/    MessageController and the `EnqueueSend` wiring type — the
//                engine, not the seam. The seam types a consumer implements
//                (`MessageHistorySource`, `AttachmentUploader`, `LocalSender`)
//                ARE public — see client/ below.
//   presence/    PresenceCoordinator, TypingController, PresenceRegistry,
//                WatermarkTracker, the outbound-intent plumbing — all
//                internal engine. A consumer drives presence/typing/read
//                state through `ChatClient`'s methods and observes it
//                through `ChatState`/events, never through this module.
//   queue/       SendQueue and everything around it — internal engine with
//                no consumer-facing surface at all. `SendFailureReason` (the
//                one type from this module a consumer needs, since it is
//                part of `ChatMessage.delivery` and the `sendFailed` event)
//                is re-exported from state/ below, not from here.
//   backoff/     Pure delay computation the connection layer consumes
//                internally. Nothing here is meaningful without the state
//                machine driving it.
//   transport/   WebSocketTransport itself, frame encode/decode, the ack
//                registry, heartbeat — all internal engine. `WebSocketFactory`
//                (needed to *type* `ChatClientConfig.webSocketFactory`) is
//                the one type surfaced. Test doubles (`StubWebSocket`,
//                `StubSocketFactory`) are deliberately NOT exported — a real
//                customer's bundle has no use for a fake socket; they stay
//                available via a subpath import for anyone testing against a
//                locally-checked-out core, same as this package's own tests
//                use them.
//
// ── What IS exported ──
//
//   client/      createChatClient, ChatClient, ChatClientConfig, and every
//                seam a consumer must implement to supply one
//                (MessageHistorySource, AttachmentUploader, SessionActions,
//                LocalSender) or may want to catch (ChatClientConfigError,
//                ConnectionAbortedError, ConnectionSuspendedError).
//   state/       ChatState and everything it is built from (§6.4) — the
//                observable surface — plus the §6.5 event catalog types.
//   protocol/    The domain enums and shapes that appear inside ChatState/
//                ChatMessage/ChatSession and the seam interfaces above
//                (SenderType, MessageType, ChatStatus, ChatMode, CloseReason,
//                ParticipantType, PresenceStatus, AttachmentMetadata,
//                MessageMetadata, PresenceEntry, ErrorCode). NOT the wire
//                frame catalog itself (Frame, ClientFrame, ServerFrame, the
//                frame-type string unions) — those are transport's alphabet,
//                never a consumer's.
//   auth/        parsePublishableKey and friends, for a consumer that wants
//                to validate a key before constructing a client (e.g. in a
//                settings form), plus createTokenProvider/toAuthToken — the
//                documented adapter from a real §10.3 token endpoint's
//                response shape to `getToken`'s contract. NOT redact.ts —
//                pure internal hygiene with no consumer-facing use.
//   storage/     StorageAdapter (T4 flagged this as unexported — it wasn't;
//                fixed here) plus both shipped adapters, so a consumer can
//                configure durable storage without reaching past the barrel.
//   messages/'s  list algebra (compareBySeq/sortMessages/upsertMessage/
//                prependPage) — messages/index.ts's own barrel comment says
//                why: "ordering and dedup are protocol rules (D1, D2) that a
//                binding writing its own optimistic UI has to honour
//                identically."

export { createChatClient } from './client/index.js';
export {
  ChatClientConfigError,
  ConnectionAbortedError,
  ConnectionSuspendedError,
} from './client/index.js';
export type {
  AttachmentUploader,
  AuthToken,
  ChatClient,
  ChatClientConfig,
  LocalSender,
  MessageHistorySource,
  SendAttachmentOptions,
  SendMessageOptions,
  SessionActions,
  TokenProvider,
} from './client/index.js';

// ---------------------------------------------------------------------------
// state/ — the observable surface (§6.4) and event catalog (§6.5).
// ---------------------------------------------------------------------------

export { CHAT_EVENT_NAMES, CONNECTION_STATE_VALUES, createInitialChatState } from './state/index.js';
export type {
  ChatError,
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatMessage,
  ChatParticipantProfile,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  ChatTicket,
  ConnectionState,
  Unsubscribe,
} from './state/index.js';

// `MessageDelivery` is part of `ChatMessage`'s public shape but is not
// re-exported by state/index.ts itself (unlike `SendFailureReason`, which
// queue/index.ts re-exports from the same source file). A type-only import
// straight from state/types.ts costs nothing at runtime and does not modify
// that module — see the T13 report for why this is flagged as a gap in
// state/index.ts rather than fixed there (out of this task's scope lock).
export type { MessageDelivery } from './state/types.js';

// ---------------------------------------------------------------------------
// messages/ — the seams a consumer implements, and the list algebra a
// binding writing custom optimistic UI needs to match core's own ordering.
// ---------------------------------------------------------------------------

export { compareBySeq, prependPage, sortMessages, upsertMessage } from './messages/index.js';
export { DEFAULT_PAGE_SIZE, NoActiveSessionError } from './messages/index.js';

// ---------------------------------------------------------------------------
// queue/ — SendFailureReason only; see the module header above.
// ---------------------------------------------------------------------------

export type { SendFailureReason } from './queue/index.js';

// ---------------------------------------------------------------------------
// protocol/ — domain enums and shapes reachable from ChatState/ChatMessage/
// ChatSession, and from the seam interfaces above. Not the wire frame
// catalog itself.
// ---------------------------------------------------------------------------

export {
  CHAT_MODE_VALUES,
  CHAT_STATUS_VALUES,
  CLOSE_REASON_VALUES,
  ERROR_CODE_VALUES,
  isChatMode,
  isChatStatus,
  isCloseReason,
  isErrorCode,
  isMessageType,
  isParkedCloseReason,
  isParticipantType,
  isPresenceStatus,
  isSenderType,
  MESSAGE_TYPE_VALUES,
  PARKED_CLOSE_REASONS,
  PARTICIPANT_TYPE_VALUES,
  PRESENCE_STATUS_VALUES,
  SENDER_TYPE_VALUES,
} from './protocol/index.js';
export type {
  AttachmentMetadata,
  ChatMode,
  ChatStatus,
  CloseReason,
  ErrorCode,
  MessageMetadata,
  MessageType,
  ParticipantType,
  PresenceEntry,
  PresenceStatus,
  SenderType,
} from './protocol/index.js';

// ---------------------------------------------------------------------------
// auth/ — publishable-key hygiene and the token-response adapter. NOT
// redact.ts (internal-only) or anything that could carry sk_ material.
// ---------------------------------------------------------------------------

export {
  createTokenProvider,
  InvalidPublishableKeyError,
  InvalidTokenResponseError,
  isPublishableKey,
  parsePublishableKey,
  publishableKeyEnvironment,
  SecretKeyInClientError,
  toAuthToken,
} from './auth/index.js';
export type {
  AccessTokenResponse,
  OAuthTokenResponse,
  PublishableKey,
  PublishableKeyEnvironment,
  TokenResponse,
} from './auth/index.js';

// ---------------------------------------------------------------------------
// storage/ — StorageAdapter (T4 flagged this as unexported) plus both
// shipped adapters. Each adapter module is free of module-scope side
// effects, so a consumer using only MemoryStorageAdapter does not pull the
// browser adapter's globalThis probing into their bundle (storage/index.ts's
// own header, "sideEffects": false in package.json).
// ---------------------------------------------------------------------------

export { BrowserStorageAdapter, createBrowserStorageAdapter, MemoryStorageAdapter, namespaced } from './storage/index.js';
export { isStorageError, StorageError } from './storage/index.js';
export type { StorageAdapter, StorageErrorCode, WebStorageLike } from './storage/index.js';

// ---------------------------------------------------------------------------
// transport/ — WebSocketFactory only, to type ChatClientConfig.webSocketFactory.
// The transport engine itself, and its test doubles, are not public.
// ---------------------------------------------------------------------------

export type { SocketCloseEvent, SocketMessageEvent, WebSocketFactory, WebSocketLike } from './transport/index.js';
