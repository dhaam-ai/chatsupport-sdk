// ==========================================
// Chat SDK - React Context & Provider
// Clean implementation with proper state management
// ==========================================

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { ChatWebSocketClient } from './client';
import type {
  ChatSDKConfig,
  ChatSDKState,
  ChatSDKActions,
  ChatSDKContextValue,
  ChatMessage,
  ChatSession,
  MessageType,
  SenderType,
} from './types.clean';

// ==========================================
// Initial State
// ==========================================

const initialState: ChatSDKState = {
  initialized: false,
  connected: false,
  loading: false,
  session: null,
  messages: [],
  isTyping: false,
  typingUser: undefined,
  error: null,
  unreadCount: 0,
};

// ==========================================
// Action Types
// ==========================================

type ChatAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_INITIALIZED'; payload: boolean }
  | { type: 'SET_SESSION'; payload: ChatSession | null }
  | { type: 'SET_MESSAGES'; payload: ChatMessage[] }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_TYPING'; payload: { isTyping: boolean; user?: string } }
  | { type: 'SET_ERROR'; payload: Error | null }
  | { type: 'UPDATE_STATUS'; payload: { mode?: ChatSession['mode']; status?: ChatSession['status'] } }
  | { type: 'SET_AGENT'; payload: { agentId: string; agentName: string } }
  | { type: 'CLEAR_AGENT' }
  | { type: 'INCREMENT_UNREAD' }
  | { type: 'CLEAR_UNREAD' }
  | { type: 'RESET' };

// ==========================================
// Reducer
// ==========================================

function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };

    case 'SET_INITIALIZED':
      return { ...state, initialized: action.payload };

    case 'SET_SESSION':
      return { ...state, session: action.payload };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'ADD_MESSAGE':
      // Avoid duplicates
      if (state.messages.some((m) => m.id === action.payload.id)) {
        return state;
      }
      return { ...state, messages: [...state.messages, action.payload] };

    case 'SET_TYPING':
      return {
        ...state,
        isTyping: action.payload.isTyping,
        typingUser: action.payload.user,
      };

    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };

    case 'UPDATE_STATUS':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          ...(action.payload.mode && { mode: action.payload.mode }),
          ...(action.payload.status && { status: action.payload.status }),
        },
      };

    case 'SET_AGENT':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          assignedAgentId: action.payload.agentId,
          assignedAgentName: action.payload.agentName,
        },
      };

    case 'CLEAR_AGENT':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          assignedAgentId: undefined,
          assignedAgentName: undefined,
        },
      };

    case 'INCREMENT_UNREAD':
      return { ...state, unreadCount: state.unreadCount + 1 };

    case 'CLEAR_UNREAD':
      return { ...state, unreadCount: 0 };

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}

// ==========================================
// Context
// ==========================================

const ChatSDKContext = createContext<ChatSDKContextValue | null>(null);

// ==========================================
// Provider Props
// ==========================================

interface ChatProviderProps {
  config: ChatSDKConfig;
  children: React.ReactNode;
}

// ==========================================
// Provider Component
// ==========================================

export const ChatProvider: React.FC<ChatProviderProps> = ({ config, children }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const clientRef = useRef<ChatWebSocketClient | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const configRef = useRef(config);

  // Keep config ref updated
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Debug logging
  const log = useCallback(
    (message: string, data?: unknown) => {
      if (configRef.current.debug) {
        console.log(`[ChatSDK] ${message}`, data || '');
      }
    },
    []
  );

  // Initialize WebSocket client
  useEffect(() => {
    const initializeClient = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        log('Initializing WebSocket client...');

        // Create client
        const client = new ChatWebSocketClient(config);
        clientRef.current = client;

        // Set up event handlers
        client.on('message', (message: ChatMessage) => {
          log('Message received', message);
          dispatch({ type: 'ADD_MESSAGE', payload: message });
          dispatch({ type: 'SET_TYPING', payload: { isTyping: false } });

          // Increment unread if not from customer
          if (message.senderType !== 'CUSTOMER') {
            dispatch({ type: 'INCREMENT_UNREAD' });
          }

          config.callbacks?.onMessage?.(message);
        });

        client.on('typing', (data: { senderType: SenderType; senderId?: string; isTyping: boolean }) => {
          log('Typing indicator', data);
          if (data.senderType !== 'CUSTOMER') {
            dispatch({
              type: 'SET_TYPING',
              payload: {
                isTyping: data.isTyping,
                user: data.senderType === 'BOT' ? 'AI Assistant' : 'Agent',
              },
            });
          }
        });

        client.on('agentJoined', (data: { agentId: string; agentName: string }) => {
          log('Agent joined', data);
          dispatch({ type: 'SET_AGENT', payload: data });
          dispatch({ type: 'UPDATE_STATUS', payload: { mode: 'HUMAN', status: 'ASSIGNED' } });
          config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
        });

        client.on('agentLeft', (data: { agentId: string }) => {
          log('Agent left', data);
          config.callbacks?.onAgentLeft?.(data.agentId);
        });

        client.on('statusChange', (data: { mode: string; status: string }) => {
          log('Status changed', data);
          dispatch({
            type: 'UPDATE_STATUS',
            payload: {
              mode: data.mode as ChatSession['mode'],
              status: data.status as ChatSession['status'],
            },
          });
          config.callbacks?.onStatusChange?.(
            data.status as ChatSession['status'],
            data.mode as ChatSession['mode']
          );
        });

        client.on('sessionClosed', () => {
          log('Session closed');
          dispatch({ type: 'UPDATE_STATUS', payload: { status: 'CLOSED' } });
          config.callbacks?.onSessionClosed?.();
        });

        client.on('error', (error: Error) => {
          log('Error', error);
          dispatch({ type: 'SET_ERROR', payload: error });
          config.callbacks?.onError?.(error);
        });

        client.on('disconnect', () => {
          log('Disconnected');
          dispatch({ type: 'SET_CONNECTED', payload: false });
          config.callbacks?.onDisconnected?.('disconnected');
        });

        client.on('reconnect', () => {
          log('Reconnected');
          dispatch({ type: 'SET_CONNECTED', payload: true });
          config.callbacks?.onReconnected?.();
        });

        // Connect
        const session = await client.connect();
        
        log('Connected', session);
        dispatch({ type: 'SET_SESSION', payload: session });
        dispatch({ type: 'SET_CONNECTED', payload: true });
        dispatch({ type: 'SET_INITIALIZED', payload: true });
        dispatch({ type: 'SET_LOADING', payload: false });

        config.callbacks?.onConnected?.(session.id);
      } catch (error) {
        log('Failed to initialize', error);
        dispatch({ type: 'SET_ERROR', payload: error as Error });
        dispatch({ type: 'SET_LOADING', payload: false });
        config.callbacks?.onError?.(error as Error);
      }
    };

    initializeClient();

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [config.serviceUrl, config.appId, config.token, config.user.id]);

  // ==========================================
  // Actions
  // ==========================================

  const sendMessage = useCallback(
    async (content: string, type: MessageType = 'TEXT') => {
      const client = clientRef.current;
      if (!client || !state.session) {
        dispatch({ type: 'SET_ERROR', payload: new Error('Not connected') });
        return;
      }

      try {
        dispatch({ type: 'SET_LOADING', payload: true });

        // Create optimistic message
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

        dispatch({ type: 'ADD_MESSAGE', payload: optimisticMessage });

        // Send via WebSocket
        await client.sendMessage(content, type);

        dispatch({ type: 'SET_LOADING', payload: false });
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error as Error });
      }
    },
    [state.session]
  );

  const startTyping = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    client.startTyping();

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Auto-stop after 3 seconds
    typingTimeoutRef.current = setTimeout(() => {
      client.stopTyping();
    }, 3000);
  }, []);

  const stopTyping = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    client.stopTyping();
  }, []);

  const closeSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      await client.closeSession();
      dispatch({ type: 'UPDATE_STATUS', payload: { status: 'CLOSED' } });
      dispatch({ type: 'SET_LOADING', payload: false });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error as Error });
    }
  }, []);

  const requestAgent = useCallback(
    async (reason?: string) => {
      const client = clientRef.current;
      if (!client) return;

      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        await client.requestAgent(reason);
        dispatch({ type: 'UPDATE_STATUS', payload: { status: 'WAITING_FOR_AGENT' } });
        dispatch({ type: 'SET_LOADING', payload: false });
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error as Error });
      }
    },
    []
  );

  const reconnect = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });
      
      const session = await client.connect();
      
      dispatch({ type: 'SET_SESSION', payload: session });
      dispatch({ type: 'SET_CONNECTED', payload: true });
      dispatch({ type: 'SET_LOADING', payload: false });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error as Error });
    }
  }, []);

  const markAsRead = useCallback(() => {
    dispatch({ type: 'CLEAR_UNREAD' });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: null });
  }, []);

  // ==========================================
  // Context Value
  // ==========================================

  const actions: ChatSDKActions = {
    sendMessage,
    startTyping,
    stopTyping,
    closeSession,
    requestAgent,
    reconnect,
    markAsRead,
    clearError,
  };

  const contextValue: ChatSDKContextValue = {
    state,
    actions,
    config,
  };

  return (
    <ChatSDKContext.Provider value={contextValue}>
      {children}
    </ChatSDKContext.Provider>
  );
};

// ==========================================
// Hook
// ==========================================

/**
 * Hook to access chat SDK state and actions
 * Must be used within ChatProvider
 */
export function useChat(): ChatSDKContextValue {
  const context = useContext(ChatSDKContext);

  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }

  return context;
}

/**
 * Hook to access just the chat state
 */
export function useChatState(): ChatSDKState {
  return useChat().state;
}

/**
 * Hook to access just the chat actions
 */
export function useChatActions(): ChatSDKActions {
  return useChat().actions;
}

export default ChatProvider;
