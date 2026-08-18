// useChatState — the escape hatch: the full ChatState, re-rendering on every
// change. Prefer a domain hook (useChannel/useMessages/useTypingIndicator/
// useUnreadCount/useChatError) or useChatSelector with your own selector
// where you can — this is for the rare component that genuinely needs
// everything (or for reaching a field none of the domain hooks expose yet,
// e.g. `presence`/`readWatermarks`).

import type { ChatState } from '@dhaam-ccrm/core';

import { useChatSelector } from './use-chat-selector.js';

function identity(state: ChatState): ChatState {
  return state;
}

export function useChatState(): ChatState {
  return useChatSelector(identity);
}
