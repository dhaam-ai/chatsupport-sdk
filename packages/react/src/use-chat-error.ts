// useChatError — the last protocol- or transport-level error (§6.4, §6.5),
// standalone so a global error banner can subscribe to only this field.

import type { ChatError, ChatState } from '@dhaam-ccrm/core';

import { useChatSelector } from './use-chat-selector.js';

function selectLastError(state: ChatState): ChatError | null {
  return state.lastError;
}

export function useChatError(): ChatError | null {
  return useChatSelector(selectLastError);
}
