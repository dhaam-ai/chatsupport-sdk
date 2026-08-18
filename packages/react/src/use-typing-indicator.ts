// useTypingIndicator — remote typing state, plus the two calls that report
// this client's own typing (§6.3, §12.8: "exactly two calls").
//
// `state.typing` is selected *directly*, with no wrapper object — this is
// the one hook in the package that does not need `shallowEqual`. Core's
// `ChatStore.setState` (packages/core/src/state/store.ts) applies a shallow
// patch: a field a given update doesn't touch keeps its old reference. A
// new message only patches `messages`, so `state.typing` is the exact same
// object across that update, and `useChatSelector`'s default `Object.is`
// already recognizes that as "unchanged" with zero extra work here. This is
// the concrete case the task's "typing must not re-render on every message"
// requirement describes.

import type { ChatState } from '@dhaam-ccrm/core';
import { useMemo } from 'react';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseTypingIndicatorResult {
  isTyping: boolean;
  /** Who is typing. Absent when `isTyping` is false (§6.4 — the state field, unlike the `typing` event, allows "nobody"). */
  participantId?: string;
  startTyping: () => void;
  stopTyping: () => void;
}

function selectTyping(state: ChatState) {
  return state.typing;
}

export function useTypingIndicator(): UseTypingIndicatorResult {
  const client = useChatClient();
  const typing = useChatSelector(selectTyping);

  const actions = useMemo(
    () => ({
      startTyping: () => client.startTyping(),
      stopTyping: () => client.stopTyping(),
    }),
    [client],
  );

  // `exactOptionalPropertyTypes` (tsconfig.base.json) forbids explicitly
  // assigning `undefined` to an optional property — spread it in only when
  // present, matching the pattern core's own `create-chat-client.ts` uses
  // for the same reason (`toChatError`'s `details` field).
  return {
    isTyping: typing.isTyping,
    ...(typing.participantId === undefined ? {} : { participantId: typing.participantId }),
    ...actions,
  };
}
