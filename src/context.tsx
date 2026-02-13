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
    
    case 'ADD_MESSAGE':
      // Dedupe messages by ID
      const exists = state.messages.some((m) => m.id === action.message.id);
      if (exists) return state;
      return {
        ...state,
        messages: [...state.messages, action.message],
      };
    
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

export function ChatProvider({ config, children }: ChatProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const clientRef = useRef<ChatWebSocketClient | null>(null);
  const initializingRef = useRef(false);

  // Initialize client and connect
  useEffect(() => {
    if (initializingRef.current || state.initialized) return;
    initializingRef.current = true;

    const initChat = async () => {
      dispatch({ type: 'INIT_START' });

      try {
        // Create client
        const client = new ChatWebSocketClient(config);
        clientRef.current = client;

        // Subscribe to events
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
              status: data.status as ChatSDKState['session'] extends null ? never : NonNullable<ChatSDKState['session']>['status'],
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

        // Connect
        const session = await client.connect();

        // Fetch existing messages
        await fetchMessages(config, session.id, dispatch);

        dispatch({ type: 'INIT_SUCCESS', session });
        config.callbacks?.onConnected?.(session.id);

      } catch (error) {
        dispatch({ type: 'INIT_ERROR', error: error as Error });
        config.callbacks?.onError?.(error as Error);
      }
    };

    initChat();

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [config]);

  // Actions
  const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
    if (!clientRef.current || !state.session) {
      throw new Error('Chat not initialized');
    }

    // Optimistic update - add message immediately
    const optimisticMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      chatSessionId: state.session.id,
      senderType: 'CUSTOMER',
      senderId: config.user.id,
      senderName: config.user.name,
      content,
      messageType: type,
      timestamp: new Date(),
    };

    dispatch({ type: 'ADD_MESSAGE', message: optimisticMessage });
    clientRef.current.sendMessage(content, type);
  }, [config, state.session]);

  const startTyping = useCallback(() => {
    clientRef.current?.startTyping();
  }, []);

  const stopTyping = useCallback(() => {
    clientRef.current?.stopTyping();
  }, []);

  const closeSession = useCallback(async () => {
    if (!state.session) return;

    try {
      await fetch(`${config.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Tenant-ID': config.tenantId,
          'X-App-ID': config.appId,
          'Content-Type': 'application/json',
        },
      });

      dispatch({
        type: 'UPDATE_SESSION',
        session: { status: 'CLOSED' },
      });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', error: error as Error });
    }
  }, [config, state.session]);

  const requestAgent = useCallback(async (reason?: string) => {
    clientRef.current?.requestAgent(reason);
  }, []);

  const reconnect = useCallback(async () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
    
    initializingRef.current = false;
    dispatch({ type: 'INIT_START' });
    
    // Re-initialize will be triggered by useEffect
    const client = new ChatWebSocketClient(config);
    clientRef.current = client;
    
    const session = await client.connect();
    dispatch({ type: 'INIT_SUCCESS', session });
  }, [config]);

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
  dispatch: React.Dispatch<ChatAction>
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
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data?.messages) {
        const messages: ChatMessage[] = data.data.messages.map((m: Record<string, unknown>) => ({
          id: m.id,
          chatSessionId: m.chatSessionId,
          senderType: m.senderType,
          senderId: m.senderId,
          content: m.content,
          messageType: m.messageType,
          timestamp: new Date(m.createdAt as string),
          metadata: m.metadata,
        }));
        dispatch({ type: 'SET_MESSAGES', messages });
      }
    }
  } catch (error) {
    console.error('Failed to fetch messages:', error);
  }
}
