// useChatError — the last protocol- or transport-level error (§6.4, §6.5),
// standalone so a global error banner can subscribe to only this field.

import type { ChatError, ChatState } from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatSelector } from './use-chat-selector.js';

const selectLastError = (state: ChatState): ChatError | null => state.lastError;

export function useChatError(): Readonly<ShallowRef<ChatError | null>> {
  return useChatSelector(selectLastError);
}
