// useMessages — the message list, pagination, and the actions that mutate
// it (§6.3). Deliberately does not include `unreadCount`/`markRead` (see
// useUnreadCount) or typing (see useTypingIndicator) — a component that only
// renders an unread badge, or only the typing dots, has no reason to
// re-render every time a new message arrives, and folding those fields in
// here would force exactly that.

import type { ChatMessage, ChatState, RetryOutcome, SendAttachmentOptions, SendMessageOptions } from '@dhaam-ccrm/core';
import { useMemo } from 'react';

import { useChatClient } from './context.js';
import { shallowEqual, useChatSelector } from './use-chat-selector.js';

export interface UseMessagesResult {
  /** In server order (D2's `seq`), optimistic sends appended per core's own ordering — never re-sorted here (§6.4). */
  messages: ChatMessage[];
  /**
   * Core's `ChatState.pagination`, by reference.
   *
   * `initialLoaded` is the field that separates "no history has been loaded
   * for this session yet" from "this session genuinely has no messages" —
   * `messages.length === 0` cannot tell those apart, and reading it as
   * "empty conversation" is what makes a session switch and a page reload
   * both flash an empty state before the transcript arrives. Cleared on
   * every session replacement; set only by a history load that SUCCEEDED.
   * {@link UseMessagesResult.historyLoading} is the negation, named for the
   * decision you are actually making with it.
   */
  pagination: { hasMore: boolean; loadingMore: boolean; initialLoaded: boolean };
  /** True while an attachment upload is in flight (§6.4). */
  uploading: boolean;

  /**
   * `true` until the CURRENT session's first history page is on screen —
   * from mount, and again for the whole of every `switchSession()`.
   *
   * Render a skeleton off this, not an "no messages yet" placeholder: core
   * clears `messages` the instant a switch begins and only refills it once
   * page one lands, so an empty list during that window means "not yet",
   * not "nothing". This is the React-side answer to both reported symptoms —
   * picking a previous session, and reloading the app — where the transcript
   * is legitimately absent for a moment and the UI must say so rather than
   * lie about the conversation being empty.
   *
   * A history load that FAILED leaves this `true`, deliberately: core does
   * not latch `initialLoaded` on failure, so a retry still refetches. Pair
   * it with `useChatError()` and offer a retry rather than an endless
   * spinner — a spinner that never resolves is the one wrong reading of
   * this flag.
   */
  historyLoading: boolean;

  /** Optimistic send; queues/sends the frame, never throws for "offline" (§6.3). */
  sendMessage: (content: string, opts?: SendMessageOptions) => Promise<void>;
  /** Rejects with `ChatClientConfigError` if the client wasn't configured with an `uploader` (§6.3, client/types.ts). */
  sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => Promise<void>;
  /** Cursor-based backward page fetch (§6.3, §12.10). */
  loadOlderMessages: () => Promise<void>;

  /**
   * Retries a permanently-failed send — replays the ORIGINAL message id
   * (client/types.ts: "the SAME one `ChatMessage.id`/`sendFailed.id` already
   * carry"), never mints a new one. Use this for a Retry button, never
   * `sendMessage(content)` again: re-sending the content through
   * `sendMessage` mints a fresh id, which is the exact bug this method
   * exists to fix — the old widget's re-send approach left the original
   * failed bubble on screen and grew a second, independently-failing one
   * next to it on every click.
   *
   * Check the failed message's own `delivery.retryable` (on the matching
   * entry in `messages` above) BEFORE rendering the Retry affordance in the
   * first place — this method is what runs when the user presses it, not
   * what decides whether to show it. Resolves to a {@link RetryOutcome} to
   * branch on directly (`status: 'retried' | 'refused'`, with a typed
   * `reason` on the refusal), never a thrown error or a bare boolean, so a
   * refusal never needs string-matching to handle.
   */
  retryMessage: (id: string) => Promise<RetryOutcome>;
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

  // Derived here rather than inside the selector so `pagination` stays the
  // very object core put in the store — `shallowEqual` compares it by
  // reference, and cloning it to fold a field in would re-render this hook
  // on every unrelated state write.
  const historyLoading = !slice.pagination.initialLoaded;

  const actions = useMemo(
    () => ({
      sendMessage: (content: string, opts?: SendMessageOptions) => client.sendMessage(content, opts),
      sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => client.sendAttachment(file, opts),
      loadOlderMessages: () => client.loadOlderMessages(),
      retryMessage: (id: string) => client.retryMessage(id),
    }),
    [client],
  );

  return { ...slice, historyLoading, ...actions };
}
