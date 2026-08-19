// Default `ChatState` — PRD §8.1's `idle` connection state, before
// `client.connect()` has ever been called.

import type { ChatState } from './types.js';

/**
 * Builds a fresh `idle` `ChatState`. A function, not a shared constant — so
 * that every `ChatStateStore` instance (and every test) gets its own
 * `messages`/`pastSessions` arrays and `readWatermarks` object, never a
 * reference shared across instances.
 */
export function createInitialChatState(): ChatState {
  return {
    connectionState: 'idle',
    session: null,
    messages: [],
    typing: { isTyping: false },
    unreadCount: 0,
    pagination: { hasMore: true, loadingMore: false },
    uploading: false,
    pastSessions: [],
    readWatermarks: {},
    lastError: null,
  };
}
