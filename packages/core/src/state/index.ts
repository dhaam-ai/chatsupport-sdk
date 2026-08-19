// Public surface of the state module — PRD §6.4 (observable state store)
// and §6.5 (discrete event catalog). Task T3.

export {
  CONNECTION_STATE_VALUES,
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
} from './types.js';

export { createInitialChatState } from './initial-state.js';
export { ChatStateStore } from './store.js';
export { ChatEventEmitter } from './event-emitter.js';
