// useTypingIndicator — remote typing state, plus the two calls that report this
// client's own typing (§6.3, §12.8: "exactly two calls").
//
// This is the concrete case behind "typing must not re-render on every
// message". Core's `ChatStore.setState` applies a shallow patch, so an update
// that only touches `messages` leaves `state.typing` reference-identical; the
// selectors below return fields off that object, and `useChatSelector`'s
// default `Object.is` recognizes "unchanged" with no extra work.
//
// Splitting `typing` into two refs rather than exposing the object gets one
// more thing for free that React's shape cannot: a component rendering only
// "someone is typing…" is untouched when the *identity* of the typist changes
// while `isTyping` stays true.
//
// It also sidesteps `exactOptionalPropertyTypes` (tsconfig.base.json), which
// forbids assigning `undefined` to an optional property and forces the React
// binding into a conditional spread to rebuild `{ isTyping, participantId? }`.
// A ref of `string | undefined` has no such problem: the absence is a value,
// not a missing key.

import type { ChatState } from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseTypingIndicatorResult {
  isTyping: Readonly<ShallowRef<boolean>>;
  /** Who is typing. `undefined` when nobody is (§6.4 — the state field, unlike the `typing` event, allows "nobody"). */
  participantId: Readonly<ShallowRef<string | undefined>>;
  startTyping: () => void;
  stopTyping: () => void;
}

const selectIsTyping = (state: ChatState): boolean => state.typing.isTyping;
const selectTypingParticipantId = (state: ChatState): string | undefined => state.typing.participantId;

export function useTypingIndicator(): UseTypingIndicatorResult {
  const client = useChatClient();

  return {
    isTyping: useChatSelector(selectIsTyping),
    participantId: useChatSelector(selectTypingParticipantId),
    startTyping: () => client.startTyping(),
    stopTyping: () => client.stopTyping(),
  };
}
