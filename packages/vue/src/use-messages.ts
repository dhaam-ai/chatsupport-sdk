// useMessages — the message list, pagination, and the actions that mutate it
// (§6.3). Deliberately does not include `unreadCount`/`markRead` (see
// useUnreadCount) or typing (see useTypingIndicator): a component that renders
// only an unread badge, or only the typing dots, has no reason to re-render
// when a message arrives, and folding those fields in here would force exactly
// that.
//
// See use-channel.ts's header for why each field is its own ref.

import type { ChatMessage, ChatState, SendAttachmentOptions, SendMessageOptions } from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseMessagesResult {
  /** In server order (D2's `seq`), optimistic sends appended per core's own ordering — never re-sorted here (§6.4). */
  messages: Readonly<ShallowRef<ChatMessage[]>>;
  pagination: Readonly<ShallowRef<{ hasMore: boolean; loadingMore: boolean; initialLoaded: boolean }>>;
  /** True while an attachment upload is in flight (§6.4). */
  uploading: Readonly<ShallowRef<boolean>>;

  /** Optimistic send; queues/sends the frame, never throws for "offline" (§6.3). */
  sendMessage: (content: string, opts?: SendMessageOptions) => Promise<void>;
  /** Rejects with `ChatClientConfigError` if the client was not configured with an `uploader` (§6.3, client/types.ts). */
  sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => Promise<void>;
  /** Cursor-based backward page fetch (§6.3, §12.10). */
  loadOlderMessages: () => Promise<void>;
}

const selectMessages = (state: ChatState): ChatMessage[] => state.messages;
const selectPagination = (state: ChatState): { hasMore: boolean; loadingMore: boolean; initialLoaded: boolean } => state.pagination;
const selectUploading = (state: ChatState): boolean => state.uploading;

export function useMessages(): UseMessagesResult {
  const client = useChatClient();

  return {
    messages: useChatSelector(selectMessages),
    // `state.pagination` is one object on `ChatState`, replaced wholesale by
    // core when either field changes — so the default `Object.is` is already
    // the correct equality and no `shallowEqual` is needed. Selecting the two
    // fields into a new literal here is what would need one.
    pagination: useChatSelector(selectPagination),
    uploading: useChatSelector(selectUploading),

    sendMessage: (content: string, opts?: SendMessageOptions) => client.sendMessage(content, opts),
    sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => client.sendAttachment(file, opts),
    loadOlderMessages: () => client.loadOlderMessages(),
  };
}
