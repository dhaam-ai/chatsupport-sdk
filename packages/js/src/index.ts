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
// Re-exported from @dhaam-ccrm/core so a consumer never needs a second
// import specifier (or a hand-copied shape) just to type a variable as
// `ChatState`/`ChatMessage`/etc. PRD §15 requires the binding-exposed
// `ChatState` to be byte-for-byte core's, enforced by a shared TypeScript
// import rather than by prose — this block is that import, re-exported one
// level further so it survives being re-exported at all. Mirrors the same
// block in @dhaam-ccrm/react's barrel.
// ---------------------------------------------------------------------------
export { createChatClient } from '@dhaam-ccrm/core';
export { ChatClientConfigError, ConnectionAbortedError, ConnectionSuspendedError } from '@dhaam-ccrm/core';
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
  MessageDelivery,
  SendAttachmentOptions,
  SendFailureReason,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';
