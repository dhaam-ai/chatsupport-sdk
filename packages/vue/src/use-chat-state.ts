// useChatState — the escape hatch: the whole `ChatState`, updating on every
// change. Prefer a domain composable (useChannel/useMessages/
// useTypingIndicator/useUnreadCount/useChatError) or useChatSelector with your
// own selector where you can — this is for the rare component that genuinely
// needs everything, or for reaching a field none of the domain composables
// expose yet (`presence`, `readWatermarks`).

import type { ChatState } from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatSelector } from './use-chat-selector.js';

function identity(state: ChatState): ChatState {
  return state;
}

export function useChatState(): Readonly<ShallowRef<ChatState>> {
  return useChatSelector(identity);
}
