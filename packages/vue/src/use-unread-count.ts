// useUnreadCount — one field, so a badge component can subscribe to it without
// updating on every typing change or new message (`markRead` reads the badge;
// it does not imply a message arrived). `state.unreadCount` is a primitive, so
// the default `Object.is` in `useChatSelector` is exactly right.

import type { ChatState } from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseUnreadCountResult {
  unreadCount: Readonly<ShallowRef<number>>;
  /** Advances the local read watermark optimistically and syncs it (§6.3, §9.5). */
  markRead: () => void;
}

const selectUnreadCount = (state: ChatState): number => state.unreadCount;

export function useUnreadCount(): UseUnreadCountResult {
  const client = useChatClient();
  return {
    unreadCount: useChatSelector(selectUnreadCount),
    markRead: () => client.markRead(),
  };
}
