// @dhaam-ccrm/js — the framework-free binding. PRD §4/§6.4: map core's
// observable store onto notifications a consumer can act on, and nothing
// else. No reconnect, backoff, dedup, ordering, queueing, token refresh,
// watermark or tick logic lives in this package; all of it is core's.
//
// Three constraints shaped every export below, and they are worth stating
// because they are the reason this package looks smaller than the other
// bindings rather than larger:
//
//   Zero runtime dependencies, matching core. `dependencies` lists exactly
//   one workspace package (`@dhaam-ccrm/core`) and it is `external` in the
//   build, so a page carries one copy of core no matter how many bindings sit
//   on it.
//
//   No DOM anywhere. `tsconfig.json` drops the `DOM` lib, so a `window`,
//   `document`, or `HTMLElement` reference in src/ is a compile error rather
//   than a review comment — this package imports cleanly in Node, under SSR,
//   and in a worker. Rendering belongs to the widget layer built on top of
//   this, not here.
//
//   Nothing at module scope but function declarations. Importing this package
//   registers no listener, reads no global, and starts no timer; every side
//   effect a consumer gets is one they asked for by calling something.
//   (`"sideEffects": false` in package.json is the bundler-facing half of the
//   same claim.)

// ---------------------------------------------------------------------------
// The store — this package's entire reason to exist.
// ---------------------------------------------------------------------------
export { createChatStore } from './store.js';
export { createChat } from './create.js';
export type {
  ChatStore,
  ChatStoreOptions,
  DestroyOptions,
  SelectOptions,
  StateListener,
  SubscribeOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Equality — the piece no framework provides here. See equality.ts.
// ---------------------------------------------------------------------------
export { shallowEqual, strictEqual } from './equality.js';

// ---------------------------------------------------------------------------
// Core's tick derivation, re-exported unchanged.
//
// `ChatStore.tick(id, localParticipantId)` is the convenience; these are the
// primitives it delegates to, and they are what a list render should call —
// once per message you are already iterating, rather than once per id lookup.
// Re-exported (not reimplemented, and not merely documented as "import them
// from core") so that a widget has exactly one import specifier and there is
// no local derivation for this binding's tick to drift away from core's:
// v1 rendered the double-grey tick from presence, and one canonical
// implementation is what stops that recurring per framework.
// ---------------------------------------------------------------------------
export { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState } from '@dhaam-ccrm/core';
export type { MessageTickState } from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// Core's `handledBy` staleness derivation, re-exported for exactly the reason
// the tick block above is.
//
// "Connected to Ada" is a claim about a *current* handler, and `handledBy`
// alone cannot support it: a reactivated session keeps the name of whoever
// last held it while `status` goes back to WAITING_FOR_AGENT. That rule lives
// in core (`isHandledByCurrent`) so every binding gates the same copy on the
// same condition. It was reachable from React but not from here, which is why
// the widget — this package's own first consumer — imports it straight from
// core today (packages/widget/src/ui/identity-header.ts).
// ---------------------------------------------------------------------------
export { isHandledByCurrent } from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// Re-exported from @dhaam-ccrm/core so a consumer never needs a second
// import specifier (or a hand-copied shape) just to type a variable as
// `ChatState`/`ChatMessage`/etc. PRD §15 requires the binding-exposed
// `ChatState` to be byte-for-byte core's, enforced by a shared TypeScript
// import rather than by prose — this block is that import, re-exported one
// level further so it survives being re-exported at all. Mirrors the same
// block in @dhaam-ccrm/react's barrel.
// ---------------------------------------------------------------------------
export { createChatClient } from '@dhaam-ccrm/core';
export {
  ChatClientConfigError,
  ConnectionAbortedError,
  ConnectionSuspendedError,
  // What `store.client.switchSession()` rejects with. A value, not just a
  // type, because the only useful thing to do with it is `instanceof` it and
  // read `.sessionId`/`.cause` — and a consumer who had to add
  // `@dhaam-ccrm/core` as a second dependency to do that would instead branch
  // on `error.name`, which is a string comparison against a field nothing
  // stops a bundler from mangling.
  SessionSwitchError,
} from '@dhaam-ccrm/core';
export type {
  ChatClient,
  ChatClientConfig,
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
  IdentityProfile,
  IdentitySync,
  MessageDelivery,
  SendAttachmentOptions,
  SendFailureReason,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// The rest of `ChatState`'s shape.
//
// The block above re-exported the top-level types and stopped, which left the
// §15 claim it is written to satisfy — a consumer never needs a second import
// specifier to name what this binding hands them — true of `ChatMessage` and
// false of `ChatMessage.attachment`. The widget hit that and worked around it
// in its own source rather than here (`packages/widget/src/ui/message-list.ts`
// on `AttachmentMetadata`/`CloseReason`, `session-picker.ts` and
// `identity-header.ts` on `ChatStatus`/`HandledBy`). Every name below is a
// type of a field reachable from a `ChatState` this store hands out, or from
// a §6.5 event payload `store.on` delivers:
//
//   ChatMessage.attachment               AttachmentMetadata
//   ChatMessage.metadata                 MessageMetadata
//   ChatMessage.senderType               SenderType
//   ChatMessage.type                     MessageType
//   ChatSession.status                   ChatStatus    (and ChatSessionSummary)
//   ChatSession.mode                     ChatMode      (and ChatSessionSummary)
//   ChatSession.handledBy                HandledBy     (and ChatSessionSummary)
//   ChatState.presence[participantId]    PresenceEntry -> PresenceStatus
//   ChatState.lastError.code             ErrorCode
//   ChatEventMap['sessionClosed']        CloseReason
//   ParticipantSnapshot.type             ParticipantType
//
// Type-only, so this whole block costs nothing at runtime and nothing in the
// bundle. The runtime guards that live beside these in core (`isChatStatus`,
// `isParkedCloseReason`, ...) are deliberately NOT forwarded: they exist to
// validate untrusted input off the wire, which is core's job on the way in,
// not a binding consumer's on the way out.
// ---------------------------------------------------------------------------
export type {
  AttachmentMetadata,
  ChatMode,
  ChatStatus,
  CloseReason,
  ErrorCode,
  HandledBy,
  MessageMetadata,
  MessageType,
  ParticipantType,
  PresenceEntry,
  PresenceStatus,
  SenderType,
} from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// What `store.client.retryMessage(id)` resolves to.
//
// `RetryOutcome` is `{ status: 'retried'; entry: QueuedSend }` or
// `{ status: 'refused'; reason: 'not-found' | 'not-retryable' }` — a union a
// caller must narrow to decide whether to keep the retry affordance on screen.
// Without both names it cannot annotate the result at all, and core's single
// "." exports entry blocks any deep-import workaround.
// ---------------------------------------------------------------------------
export type { QueuedSend, RetryOutcome } from '@dhaam-ccrm/core';
