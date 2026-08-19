// @dhaam-ccrm/core — framework-agnostic chat SDK core.
//
// Hard invariant: this package has ZERO framework, UI, and DOM-document
// dependencies. It may reference the `WebSocket` global; it may not reference
// `window` or `document` outside an explicitly isolated platform adapter.
// See docs/spec/chat-sdk-v2-prd.md §4 and §15.
//
// `createChatClient` (task T13) is the one public entry point (PRD §6) —
// every binding (and a headless consumer) builds on this and nothing else.
// The individual modules behind it (protocol/, state/, transport/,
// connection/, auth/, queue/, messages/, presence/) are also exported for
// advanced/headless use and for bindings that need the lower-level types,
// but `createChatClient` is the supported way to use this package.

export { createChatClient, type ChatClient, type ChatClientConfig } from './client.js';

export { CORE_PROTOCOL_VERSION } from './protocol/index.js';

export {
  type ChatError,
  type ChatEventMap,
  type ChatMessage,
  type ChatProfile,
  type ChatReplyPreview,
  type ChatSession,
  type ChatSessionSummary,
  type ChatState,
  type ChatTicket,
  type ConnectionState,
  type PaginationState,
  type TypingState,
  type Unsubscribe,
  ChatStateStore,
  ChatEventEmitter,
  createInitialChatState,
} from './state/index.js';

export type { GetToken } from './auth/index.js';
export type { SendAttachmentOptions, SendMessageOptions } from './messages/index.js';
export type { StorageAdapter } from './storage/index.js';
export { MemoryStorageAdapter } from './storage/index.js';
