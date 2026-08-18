// useUnreadCount — a standalone hook for exactly one field so a badge
// component can subscribe to it without re-rendering on every typing change
// or new message (`markRead` reads the badge, it doesn't imply a message
// arrived). `state.unreadCount` is a primitive number, so the default
// `Object.is` equality in `useChatSelector` is exactly right with no
// wrapper object to worry about.

import type { ChatState } from '@dhaam-ccrm/core';
import { useCallback } from 'react';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseUnreadCountResult {
  unreadCount: number;
  /** Advances the local read watermark optimistically and syncs it (§6.3, §9.5). */
  markRead: () => void;
}

function selectUnreadCount(state: ChatState): number {
  return state.unreadCount;
}

export function useUnreadCount(): UseUnreadCountResult {
  const client = useChatClient();
  const unreadCount = useChatSelector(selectUnreadCount);
  const markRead = useCallback(() => client.markRead(), [client]);
  return { unreadCount, markRead };
}
