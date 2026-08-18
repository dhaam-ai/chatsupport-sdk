// State module barrel.
//
// This is the whole observable surface of Decision #2: every framework
// binding (React via `useSyncExternalStore`, Vue, Angular, vanilla) is built
// on `getState` / `subscribe` / `on` and nothing else — bindings may not
// reach into WS/REST/storage directly (§6.4, §9's binding contract).
//
// `ChatStore` deliberately exposes both halves — the read surface bindings
// use, and the `setState`/`emit` mutation surface T7–T12 drive. Narrowing
// the public `ChatClient` down to the read half is T13's job in
// src/index.ts, not this file's.

export { deepFreeze } from './freeze.js';

export { rethrowListenerError } from './listener-error.js';
export type { ListenerErrorReporter } from './listener-error.js';

export { CHAT_EVENT_NAMES } from './events.js';
export type { ChatEventHandler, ChatEventMap, ChatEventName } from './events.js';

export { ChatEventEmitter } from './emitter.js';

export { ChatStore } from './store.js';
export type { ChatStateListener, ChatStoreOptions } from './store.js';

export { CONNECTION_STATE_VALUES, createInitialChatState } from './types.js';
export type {
  ChatError,
  ChatMessage,
  ChatParticipantProfile,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  ChatTicket,
  ConnectionState,
  Unsubscribe,
} from './types.js';
