// @dhaam-ccrm/vue — the public barrel. PRD §4: "composables/provide-inject
// wrapping one core client instance; mapping core's observable store to Vue's
// reactivity" and nothing else. Every composable below is a thin selector over
// `ChatClient.getState()`/`subscribe()` (§6.4) plus, at most, a bag of one-line
// delegations to `ChatClient` methods (§6.2/6.3) — no reconnect, backoff,
// dedup, ordering, queueing, token refresh, or watermark logic lives here; all
// of it is core's (packages/core), tested there.
//
// Every domain type below (`ChatState`, `ChatMessage`, `MessageTickState`, ...)
// is imported from `@dhaam-ccrm/core`'s public barrel and never re-declared
// here (PRD §15). This package consumes that barrel and nothing else — no deep
// imports into core's internals.
//
// The reactive shape: every state value is a `Readonly<ShallowRef<T>>`, every
// action is a plain function. See use-chat-selector.ts for why `shallowRef`
// rather than `ref` or `computed`, use-channel.ts for why one ref per field
// rather than one ref per composable, and scope.ts for why `onScopeDispose`
// rather than `onUnmounted`.
//
// Minimum Vue: 3.3. `shallowRef`/`effectScope`/`onScopeDispose` are all 3.2,
// but `toValue`/`MaybeRefOrGetter` (useMessageTicks) and `app.runWithContext()`
// — the supported way to run an injecting composable outside a `setup()`, which
// this package's docs point Pinia/Nuxt-plugin callers at — both landed in 3.3.

// ---------------------------------------------------------------------------
// Providing the client.
// ---------------------------------------------------------------------------
export { chatClientKey, createChatPlugin, provideChatClient, useChatClient } from './context.js';
export type { ChatClientSource, ChatPlugin } from './context.js';

// ---------------------------------------------------------------------------
// The selector primitive everything else is built on.
// ---------------------------------------------------------------------------
export { defaultIsEqual, shallowEqual, useChatSelector } from './use-chat-selector.js';

export { useChatState } from './use-chat-state.js';

// ---------------------------------------------------------------------------
// Domain composables.
// ---------------------------------------------------------------------------
export { useChannel } from './use-channel.js';
export type { UseChannelResult } from './use-channel.js';

export { useMessages } from './use-messages.js';
export type { UseMessagesResult } from './use-messages.js';

export { useTypingIndicator } from './use-typing-indicator.js';
export type { UseTypingIndicatorResult } from './use-typing-indicator.js';

export { useUnreadCount } from './use-unread-count.js';
export type { UseUnreadCountResult } from './use-unread-count.js';

export { useChatError } from './use-chat-error.js';

export { useMessageTicks } from './use-message-ticks.js';
export type { MessageTicks } from './use-message-ticks.js';

// ---------------------------------------------------------------------------
// Events (§6.5). No React counterpart — see use-chat-event.ts's header.
// ---------------------------------------------------------------------------
export { useChatEvent } from './use-chat-event.js';
