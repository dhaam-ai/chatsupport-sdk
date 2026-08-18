// @dhaam-ccrm/react — the public barrel. PRD §4: "Hooks/context/provider
// wrapping one core client instance; mapping core's observable store to
// React re-renders" and nothing else. Every hook below is a thin selector
// over `ChatClient.getState()`/`subscribe()` (§6.4) plus, at most, a
// `useMemo`'d bag of one-line delegations to `ChatClient` methods (§6.2/6.3)
// — no reconnect, backoff, dedup, ordering, queueing, token refresh, or
// watermark logic lives here; all of it is core's (packages/core), tested
// there.
//
// `ChatState` and every other type below is a type-only re-export from
// `@dhaam-ccrm/core` (see each hook file) — never a hand-copied shape (PRD
// §15).

export { ChatProvider, useChatClient } from './context.js';
export type { ChatProviderProps } from './context.js';

export { defaultIsEqual, shallowEqual, useChatSelector } from './use-chat-selector.js';

export { useChatState } from './use-chat-state.js';

export { useChannel } from './use-channel.js';
export type { UseChannelResult } from './use-channel.js';

export { useMessages } from './use-messages.js';
export type { UseMessagesResult } from './use-messages.js';

export { useTypingIndicator } from './use-typing-indicator.js';
export type { UseTypingIndicatorResult } from './use-typing-indicator.js';

export { useUnreadCount } from './use-unread-count.js';
export type { UseUnreadCountResult } from './use-unread-count.js';

export { useChatError } from './use-chat-error.js';

// ---------------------------------------------------------------------------
// Re-exported from @dhaam-ccrm/core so a consumer never needs a second
// `dependencies` entry (or a deep import) just to type a prop as
// `ChatState`/`ChatMessage`/etc. — the same shapes this package's own hooks
// return. PRD §15: "The React binding's exposed ChatState shape is
// byte-for-byte identical to core's ChatState — enforced by a shared
// TypeScript type import, not hand-copied." This block is that import,
// re-exported one level further so it survives being re-exported at all.
// ---------------------------------------------------------------------------

export type {
  ChatClient,
  ChatClientConfig,
  ChatError,
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
export { ChatClientConfigError, ConnectionAbortedError, ConnectionSuspendedError } from '@dhaam-ccrm/core';
