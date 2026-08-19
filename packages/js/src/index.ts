// @dhaam-ccrm/js — task T22'. The vanilla binding.
//
// This package adds no new logic over @dhaam-ccrm/core — it exists purely
// to give core a browser-loadable global build (see tsup.config.ts: an
// `iife` output attached to `window.ChatSDK`). Core itself intentionally
// ships ESM/CJS only (packages/core/tsup.config.ts), which is correct for
// bundler-based consumers (React/Vue/Next/Node) but leaves plain
// `<script src="...">` pages with nothing to load. That gap is this
// package's entire reason to exist — re-export core's public surface
// unchanged, so a widget (T25) built against `@dhaam-ccrm/js` behaves
// identically to one built against `@dhaam-ccrm/core` directly.

export { createChatClient, type ChatClient, type ChatClientConfig } from '@dhaam-ccrm/core';

export { CORE_PROTOCOL_VERSION } from '@dhaam-ccrm/core';

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
} from '@dhaam-ccrm/core';

export type { GetToken } from '@dhaam-ccrm/core';
export type { SendAttachmentOptions, SendMessageOptions } from '@dhaam-ccrm/core';
export type { StorageAdapter } from '@dhaam-ccrm/core';
export { MemoryStorageAdapter } from '@dhaam-ccrm/core';
