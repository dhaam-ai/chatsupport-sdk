// ==========================================
// Chat SDK - Main Entry Point
// ==========================================
// A React/Next.js compatible chat widget SDK
// ==========================================

// Components
export { ChatWidget } from './ChatWidget';
export type { ChatWidgetProps } from './ChatWidget';

// Context and Hooks
export {
  ChatProvider,
  useChat,
  useChatMessages,
  useChatSession,
  useChatActions,
  useChatState,
} from './context';

// Client (for advanced usage)
export { ChatWebSocketClient } from './client';

// Types
export type {
  ChatSDKConfig,
  ChatTheme,
  ChatFeatures,
  ChatCallbacks,
  ChatMessage,
  ChatSession,
  ChatSDKState,
  ChatSDKActions,
  ChatMode,
  ChatStatus,
  SenderType,
  MessageType,
} from './types';

export { WS_EVENTS } from './types';
