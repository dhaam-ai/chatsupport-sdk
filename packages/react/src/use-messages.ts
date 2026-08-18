// useMessages — the message list, pagination, and the actions that mutate
// it (§6.3). Deliberately does not include `unreadCount`/`markRead` (see
// useUnreadCount) or typing (see useTypingIndicator) — a component that only
// renders an unread badge, or only the typing dots, has no reason to
// re-render every time a new message arrives, and folding those fields in
// here would force exactly that.

import type { ChatMessage, ChatState, SendAttachmentOptions, SendMessageOptions } from '@dhaam-ccrm/core';
import { useMemo } from 'react';

import { useChatClient } from './context.js';
import { shallowEqual, useChatSelector } from './use-chat-selector.js';

export interface UseMessagesResult {
  /** In server order (D2's `seq`), optimistic sends appended per core's own ordering — never re-sorted here (§6.4). */
  messages: ChatMessage[];
  pagination: { hasMore: boolean; loadingMore: boolean };
  /** True while an attachment upload is in flight (§6.4). */
  uploading: boolean;

  /** Optimistic send; queues/sends the frame, never throws for "offline" (§6.3). */
  sendMessage: (content: string, opts?: SendMessageOptions) => Promise<void>;
  /** Rejects with `ChatClientConfigError` if the client wasn't configured with an `uploader` (§6.3, client/types.ts). */
  sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => Promise<void>;
  /** Cursor-based backward page fetch (§6.3, §12.10). */
  loadOlderMessages: () => Promise<void>;
}

function selectMessagesState(state: ChatState) {
  return {
    messages: state.messages,
    pagination: state.pagination,
    uploading: state.uploading,
  };
}

export function useMessages(): UseMessagesResult {
  const client = useChatClient();
  const slice = useChatSelector(selectMessagesState, shallowEqual);

  const actions = useMemo(
    () => ({
      sendMessage: (content: string, opts?: SendMessageOptions) => client.sendMessage(content, opts),
      sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => client.sendAttachment(file, opts),
      loadOlderMessages: () => client.loadOlderMessages(),
    }),
    [client],
  );

  return { ...slice, ...actions };
}
