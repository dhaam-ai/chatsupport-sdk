// ==========================================
// Chat SDK - Reducer
// ==========================================
// Lifted verbatim out of context.tsx so the state transitions can be tested
// on their own: context.tsx pulls in React and client.ts (socket.io-client),
// neither of which is installed at the repo root, so nothing that imports it
// is reachable from a test. This module imports types only.
// ==========================================

import type { ChatSDKState, ChatMessage, ChatSessionSummary, SendFailure } from './types';

export type ChatAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
  | { type: 'INIT_ERROR'; error: Error }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[]; hasMore?: boolean }
  | { type: 'PREPEND_MESSAGES'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'SET_LOADING_MORE'; loading: boolean }
  | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
  | { type: 'MARK_SENDING'; tempId: string }
  | { type: 'MARK_SEND_FAILED'; tempId: string; failure: SendFailure }
  | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
  | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
  | { type: 'SET_ERROR'; error: Error | null }
  | { type: 'TOKEN_EXPIRED' }
  | { type: 'SET_WIDGET_OPEN'; open: boolean }
  | { type: 'SET_UPLOADING'; uploading: boolean }
  | { type: 'SET_PAST_SESSIONS'; sessions: ChatSessionSummary[] }
  | { type: 'UPDATE_PAST_SESSION'; sessionId: string; updates: Partial<ChatSessionSummary> }
  | { type: 'SET_AGENT_READ_AT'; readAt: Date }
  | { type: 'SET_CLOSE_REASON'; reason: string | null };

export const initialState: ChatSDKState = {
  initialized:  false,
  connected:    false,
  loading:      true,
  session:      null,
  messages:     [],
  isTyping:     false,
  typingUser:   undefined,
  error:        null,
  tokenExpired: false,
  isWidgetOpen: false,
  unreadCount:  0,
  hasMore:      true,
  loadingMore:  false,
  uploading:    false,
  pastSessions: [],
  agentReadAt:  null,
  closeReason:  null,
};

export function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, loading: true, error: null };

    case 'INIT_SUCCESS':
      return { ...state, initialized: true, connected: true, loading: false, session: action.session };

    case 'INIT_ERROR':
      return { ...state, loading: false, error: action.error };

    case 'SET_CONNECTED':
      return { ...state, connected: action.connected };

    case 'ADD_MESSAGE': {
      if (state.messages.some(m => m.id === action.message.id)) return state;
      const isFromAgentOrBot = action.message.senderType === 'AGENT' || action.message.senderType === 'BOT';
      const shouldIncrement  = !state.isWidgetOpen && isFromAgentOrBot;
      return {
        ...state,
        messages:    [...state.messages, action.message],
        unreadCount: shouldIncrement ? state.unreadCount + 1 : state.unreadCount,
      };
    }

    case 'SET_MESSAGES': {
      const seen = new Set<string>();
      const deduped = action.messages.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      return { ...state, messages: deduped, hasMore: action.hasMore ?? true };
    }

    case 'PREPEND_MESSAGES': {
      if (!action.messages.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
      const existingIds = new Set(state.messages.map(m => m.id));
      const newMsgs = action.messages.filter(m => !existingIds.has(m.id));
      if (!newMsgs.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
      return {
        ...state,
        messages:    [...newMsgs, ...state.messages],
        hasMore:     action.hasMore,
        loadingMore: false,
      };
    }

    case 'SET_LOADING_MORE':
      return { ...state, loadingMore: action.loading };

    case 'REPLACE_TEMP': {
      const idx = state.messages.findIndex(m => m.id === action.tempId);
      if (idx === -1) {
        if (state.messages.some(m => m.id === action.message.id)) return state;
        return { ...state, messages: [...state.messages, action.message] };
      }
      const updated = [...state.messages];
      // Preserve the temp message's identity as the React list key so the
      // message subtree (and any in-progress media playback) isn't remounted
      // just because the server-confirmed `id` differs from the temp id.
      // The server confirming it is what ends the send: clear any prior
      // failure so a retried message stops rendering as failed.
      updated[idx]  = {
        ...action.message,
        clientKey:       state.messages[idx].clientKey ?? action.tempId,
        clientMessageId: action.message.clientMessageId ?? state.messages[idx].clientMessageId,
        sendStatus:      'sent',
        sendFailure:     undefined,
      };
      return { ...state, messages: updated };
    }

    // ── MARK_SENDING ────────────────────────────────────────────────────────
    // Both the first attempt and every retry land here. A retry deliberately
    // mutates the EXISTING message rather than appending a new one — appending
    // is what made a retry look like a duplicate.
    case 'MARK_SENDING': {
      const idx = state.messages.findIndex(m => m.id === action.tempId);
      if (idx === -1) return state;
      const updated = [...state.messages];
      updated[idx]  = { ...updated[idx], sendStatus: 'sending', sendFailure: undefined };
      return { ...state, messages: updated };
    }

    // ── MARK_SEND_FAILED ────────────────────────────────────────────────────
    // Ends the "stuck sending forever" state: every optimistic message either
    // gets acked or lands here.
    case 'MARK_SEND_FAILED': {
      const idx = state.messages.findIndex(m => m.id === action.tempId);
      if (idx === -1) return state;
      // Already confirmed by the server — a late error must not un-send it.
      if (state.messages[idx].sendStatus === 'sent') return state;
      const updated = [...state.messages];
      updated[idx]  = { ...updated[idx], sendStatus: 'failed', sendFailure: action.failure };
      return { ...state, messages: updated };
    }

    case 'SET_TYPING':
      return { ...state, isTyping: action.isTyping, typingUser: action.typingUser };

    case 'UPDATE_SESSION':
      return { ...state, session: state.session ? { ...state.session, ...action.session } : null };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'TOKEN_EXPIRED':
      return { ...state, tokenExpired: true, connected: false, error: new Error('Your session has expired. Please refresh to continue.') };

    case 'SET_WIDGET_OPEN':
      return {
        ...state,
        isWidgetOpen: action.open,
        unreadCount:  action.open ? 0 : state.unreadCount,
      };

    case 'SET_UPLOADING':
      return { ...state, uploading: action.uploading };

    case 'SET_PAST_SESSIONS':
      return { ...state, pastSessions: action.sessions };

    case 'UPDATE_PAST_SESSION':
      return {
        ...state,
        pastSessions: state.pastSessions.map(s =>
          s.id === action.sessionId ? { ...s, ...action.updates } : s
        ),
      };

    // ── SET_AGENT_READ_AT ─────────────────────────────────────────────────
    // No forward-only guard here. The participants restore on load gives us
    // the real backend timestamp. Real-time WS events will naturally be newer.
    // Removing the guard prevents the "seed to NOW" race from blocking the
    // accurate participants timestamp.
    case 'SET_AGENT_READ_AT':
      return { ...state, agentReadAt: action.readAt };

    case 'SET_CLOSE_REASON':
      return { ...state, closeReason: action.reason };

    default:
      return state;
  }
}
