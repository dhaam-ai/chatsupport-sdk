// ==========================================
// Chat SDK - React Context
// ==========================================

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import type {
  ChatSDKConfig,
  ChatSDKState,
  ChatSDKActions,
  ChatMessage,
  MessageType,
} from './types';
import { ChatWebSocketClient } from './client';

type EventCallback = (...args: unknown[]) => void;

// ==========================================
// State Management
// ==========================================

type ChatAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
  | { type: 'INIT_ERROR'; error: Error }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
  | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
  | { type: 'SET_ERROR'; error: Error | null };

const initialState: ChatSDKState = {
  initialized: false,
  connected: false,
  loading: true,
  session: null,
  messages: [],
  isTyping: false,
  typingUser: undefined,
  error: null,
};

function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, loading: true, error: null };

    case 'INIT_SUCCESS':
      return {
        ...state,
        initialized: true,
        connected: true,
        loading: false,
        session: action.session,
      };

    case 'INIT_ERROR':
      return {
        ...state,
        loading: false,
        error: action.error,
      };

    case 'SET_CONNECTED':
      return { ...state, connected: action.connected };

    case 'ADD_MESSAGE': {
      const exists = state.messages.some((m) => m.id === action.message.id);
      if (exists) return state;
      return {
        ...state,
        messages: [...state.messages, action.message],
      };
    }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };

    case 'SET_TYPING':
      return {
        ...state,
        isTyping: action.isTyping,
        typingUser: action.typingUser,
      };

    case 'UPDATE_SESSION':
      return {
        ...state,
        session: state.session ? { ...state.session, ...action.session } : null,
      };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    default:
      return state;
  }
}

// ==========================================
// Context
// ==========================================

interface ChatContextValue {
  state: ChatSDKState;
  actions: ChatSDKActions;
  config: ChatSDKConfig | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ==========================================
// Provider
// ==========================================

interface ChatProviderProps {
  config: ChatSDKConfig;
  children: React.ReactNode;
}

// ─── Module-level guard — survives React 19 StrictMode ref resets.
// Keyed by appId+userId so multiple widget instances work independently.
const _activeConnections = new Map<string, boolean>();

export function ChatProvider({ config, children }: ChatProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const clientRef = useRef<ChatWebSocketClient | null>(null);
  // connectionKey uniquely identifies this widget instance
  const connectionKey = `${config.appId}:${config.user?.id}`;

  // ─── Store config in a ref so the effect never re-fires due to
  // config object identity changes (new object ref on every parent render).
  const configRef = useRef<ChatSDKConfig>(config);
  useEffect(() => {
    configRef.current = config;
  });

  // ─── Initialize once — stable primitive deps only
  useEffect(() => {
    // Guard against React 19 StrictMode double-invoke.
    // Module-level map survives ref resets between mount/unmount cycles.
    if (_activeConnections.get(connectionKey)) return;
    _activeConnections.set(connectionKey, true);

    const initChat = async () => {
      dispatch({ type: 'INIT_START' });

      try {
        const cfg = configRef.current;
        const client = new ChatWebSocketClient(cfg);
        clientRef.current = client;

        // ── Event subscriptions
        client.on('message', (message) => {
          dispatch({ type: 'ADD_MESSAGE', message: message as ChatMessage });
        });

        client.on('typing', ((data: any) => {
          dispatch({
            type: 'SET_TYPING',
            isTyping: data.isTyping,
            typingUser: data.senderId,
          });
        }) as EventCallback);

        client.on('statusChange', ((data: any) => {
          dispatch({
            type: 'UPDATE_SESSION',
            session: {
              status: data.status as NonNullable<ChatSDKState['session']>['status'],
              mode: data.mode as 'BOT' | 'HUMAN',
            },
          });
        }) as EventCallback);

        client.on('disconnect', () => {
          dispatch({ type: 'SET_CONNECTED', connected: false });
        });

        client.on('reconnect', () => {
          dispatch({ type: 'SET_CONNECTED', connected: true });
        });

        client.on('error', (error) => {
          dispatch({ type: 'SET_ERROR', error: error as Error });
        });

        // ── Connect
        const session = await client.connect();

        // ── Fetch existing messages
        await fetchMessages(configRef.current, session.id, dispatch);

        dispatch({ type: 'INIT_SUCCESS', session });
        configRef.current.callbacks?.onConnected?.(session.id);

      } catch (error) {
        _activeConnections.delete(connectionKey); // allow retry on real error
        dispatch({ type: 'INIT_ERROR', error: error as Error });
        configRef.current.callbacks?.onError?.(error as Error);
      }
    };

    initChat();

    // ── Cleanup: only runs on REAL unmount
    return () => {
      _activeConnections.delete(connectionKey);
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };

  // ─── CRITICAL: use primitive values as deps, NOT the config object.
  // This means the effect only re-runs if the user actually changes their
  // account or a different widget is mounted — not on every parent render.
  }, [
    connectionKey,
    config.serviceUrl,
    config.token,
  ]);

  // ==========================================
  // Actions
  // ==========================================

  const sendMessage = useCallback(async (
    content: string,
    type: MessageType = 'TEXT',
  ) => {
    if (!clientRef.current || !state.session) {
      throw new Error('Chat not initialized');
    }

    // Optimistic update
    const optimisticMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      chatSessionId: state.session.id,
      senderType: 'CUSTOMER',
      senderId: configRef.current.user.id,
      senderName: configRef.current.user.name,
      content,
      messageType: type,
      timestamp: new Date(),
    };

    dispatch({ type: 'ADD_MESSAGE', message: optimisticMessage });
    clientRef.current.sendMessage(content, type);
  }, [state.session]); // no longer depends on `config` object

  const startTyping = useCallback(() => {
    clientRef.current?.startTyping();
  }, []);

  const stopTyping = useCallback(() => {
    clientRef.current?.stopTyping();
  }, []);

  const closeSession = useCallback(async () => {
    if (!state.session) return;
    const cfg = configRef.current;

    try {
      await fetch(
        `${cfg.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.token}`,
            'X-Tenant-ID': cfg.tenantId,
            'X-App-ID': cfg.appId,
            'Content-Type': 'application/json',
          },
        },
      );
      dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', error: error as Error });
    }
  }, [state.session]); // no longer depends on `config` object

  const requestAgent = useCallback(async (reason?: string) => {
    clientRef.current?.requestAgent(reason);
  }, []);

  const reconnect = useCallback(async () => {
    // Disconnect existing socket
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    // Reset guard so init can run again
    _activeConnections.delete(connectionKey);
    dispatch({ type: 'INIT_START' });

    try {
      const cfg = configRef.current;
      const client = new ChatWebSocketClient(cfg);
      clientRef.current = client;
      const session = await client.connect();
      dispatch({ type: 'INIT_SUCCESS', session });
    } catch (error) {
      dispatch({ type: 'INIT_ERROR', error: error as Error });
    }
  }, []);

  const actions: ChatSDKActions = {
    sendMessage,
    startTyping,
    stopTyping,
    closeSession,
    requestAgent,
    reconnect,
  };

  const value: ChatContextValue = {
    state,
    actions,
    config,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// ==========================================
// Hooks
// ==========================================

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

export function useChatMessages(): ChatMessage[] {
  const { state } = useChat();
  return state.messages;
}

export function useChatSession(): ChatSDKState['session'] {
  const { state } = useChat();
  return state.session;
}

export function useChatActions(): ChatSDKActions {
  const { actions } = useChat();
  return actions;
}

export function useChatState(): ChatSDKState {
  const { state } = useChat();
  return state;
}

// ==========================================
// Helpers
// ==========================================

async function fetchMessages(
  config: ChatSDKConfig,
  sessionId: string,
  dispatch: React.Dispatch<ChatAction>,
): Promise<void> {
  try {
    const response = await fetch(
      `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Tenant-ID': config.tenantId,
          'X-App-ID': config.appId,
        },
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data?.messages) {
        const messages: ChatMessage[] = data.data.messages.map(
          (m: Record<string, unknown>) => ({
            id: m.id,
            chatSessionId: m.chatSessionId,
            senderType: m.senderType,
            senderId: m.senderId,
            content: m.content,
            messageType: m.messageType,
            timestamp: new Date(m.createdAt as string),
            metadata: m.metadata,
          }),
        );
        dispatch({ type: 'SET_MESSAGES', messages });
      }
    }
  } catch (error) {
    console.error('Failed to fetch messages:', error);
  }
}