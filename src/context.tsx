



// // // import React, {
// // //   createContext, useContext, useReducer, useEffect, useCallback, useRef,
// // // } from 'react';
// // // import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, MessageType } from './types';
// // // import { ChatWebSocketClient } from './client';

// // // type EventCallback = (...args: unknown[]) => void;

// // // // ─── State / Actions ──────────────────────────────────────────────────────────

// // // type ChatAction =
// // //   | { type: 'INIT_START' }
// // //   | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
// // //   | { type: 'INIT_ERROR'; error: Error }
// // //   | { type: 'SET_CONNECTED'; connected: boolean }
// // //   | { type: 'ADD_MESSAGE'; message: ChatMessage }
// // //   | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
// // //   | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
// // //   | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
// // //   | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
// // //   | { type: 'SET_ERROR'; error: Error | null };

// // // const initialState: ChatSDKState = {
// // //   initialized: false,
// // //   connected:   false,
// // //   loading:     true,
// // //   session:     null,
// // //   messages:    [],
// // //   isTyping:    false,
// // //   typingUser:  undefined,
// // //   error:       null,
// // // };

// // // function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
// // //   switch (action.type) {
// // //     case 'INIT_START':
// // //       return { ...state, loading: true, error: null };

// // //     case 'INIT_SUCCESS':
// // //       return { ...state, initialized: true, connected: true, loading: false, session: action.session };

// // //     case 'INIT_ERROR':
// // //       return { ...state, loading: false, error: action.error };

// // //     case 'SET_CONNECTED':
// // //       return { ...state, connected: action.connected };

// // //     case 'ADD_MESSAGE': {
// // //       if (state.messages.some(m => m.id === action.message.id)) return state;
// // //       return { ...state, messages: [...state.messages, action.message] };
// // //     }

// // //     case 'SET_MESSAGES':
// // //       return { ...state, messages: action.messages };

// // //     case 'REPLACE_TEMP': {
// // //       const idx = state.messages.findIndex(m => m.id === action.tempId);
// // //       if (idx === -1) {
// // //         if (state.messages.some(m => m.id === action.message.id)) return state;
// // //         return { ...state, messages: [...state.messages, action.message] };
// // //       }
// // //       const updated = [...state.messages];
// // //       updated[idx]  = action.message;
// // //       return { ...state, messages: updated };
// // //     }

// // //     case 'SET_TYPING':
// // //       return { ...state, isTyping: action.isTyping, typingUser: action.typingUser };

// // //     case 'UPDATE_SESSION':
// // //       return { ...state, session: state.session ? { ...state.session, ...action.session } : null };

// // //     case 'SET_ERROR':
// // //       return { ...state, error: action.error };

// // //     default:
// // //       return state;
// // //   }
// // // }

// // // // ─── Context ──────────────────────────────────────────────────────────────────
// // // interface ChatContextValue {
// // //   state:   ChatSDKState;
// // //   actions: ChatSDKActions;
// // //   config:  ChatSDKConfig | null;
// // // }
// // // const ChatContext = createContext<ChatContextValue | null>(null);

// // // // Prevent double-init in React StrictMode
// // // const _activeConnections = new Map<string, boolean>();

// // // // ─── Provider ─────────────────────────────────────────────────────────────────
// // // export function ChatProvider({ config, children }: {
// // //   config:   ChatSDKConfig;
// // //   children: React.ReactNode;
// // // }): JSX.Element {
// // //   const [state, dispatch] = useReducer(chatReducer, initialState);
// // //   const clientRef         = useRef<ChatWebSocketClient | null>(null);
// // //   const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
// // //   const connectionKey     = `${config.appId}:${config.user?.id}`;
// // //   const configRef         = useRef<ChatSDKConfig>(config);
// // //   useEffect(() => { configRef.current = config; });

// // //   const pendingReplaces = useRef<Map<string, string>>(new Map());

// // //   // FIX BUG 2: dedup ref — suppresses the TYPING_INDICATOR + TYPING double-fire
// // //   const lastTypingRef = useRef<{ isTyping: boolean; time: number } | null>(null);

// // //   // ── Initialize once ───────────────────────────────────────────────────────
// // //   useEffect(() => {
// // //     if (_activeConnections.get(connectionKey)) return;
// // //     _activeConnections.set(connectionKey, true);

// // //     const initChat = async () => {
// // //       dispatch({ type: 'INIT_START' });
// // //       try {
// // //         const cfg    = configRef.current;
// // //         const client = new ChatWebSocketClient(cfg);
// // //         clientRef.current = client;

// // //         // ── Message handler ──────────────────────────────────────────────
// // //         client.on('message', (msg: unknown) => {
// // //           const message = msg as ChatMessage;

// // //           if (
// // //             message.senderType === 'CUSTOMER' &&
// // //             !message.id.startsWith('temp-') &&
// // //             pendingReplaces.current.has(message.content)
// // //           ) {
// // //             console.log('[Chat] Skipping echo — replaceOptimistic will handle:', message.id);
// // //             return;
// // //           }

// // //           console.log('[Chat] ADD_MESSAGE:', message.id, message.senderType, message.content.slice(0, 40));
// // //           dispatch({ type: 'ADD_MESSAGE', message });
// // //         });

// // //         // ── Typing handler — FIXED ───────────────────────────────────────
// // //         client.on('typing', ((rawData: any) => {
// // //           const isTyping   = rawData?.isTyping   ?? false;
// // //           const senderId   = rawData?.senderId   ?? '';
// // //           const senderType = rawData?.senderType ?? 'AGENT';

// // //           console.log(
// // //             `%c[Chat:TYPING] 🖊 Received typing event`,
// // //             'color:#f59e0b;font-weight:bold',
// // //             { isTyping, senderId, senderType }
// // //           );

// // //           // FIX BUG 1: Only show the typing bubble for AGENT events.
// // //           // Server echoes CUSTOMER typing back to all room members including
// // //           // the customer — without this guard they'd see their own bubble.
// // //           if (senderType !== 'AGENT') {
// // //             console.log('[Chat:TYPING] Ignoring non-agent event, senderType:', senderType);
// // //             return;
// // //           }

// // //           // FIX BUG 2: Suppress duplicate events within 150ms.
// // //           // Server emits both TYPING_INDICATOR and TYPING for every action,
// // //           // and client.ts listens on both — so this fires twice per keystroke.
// // //           const now = Date.now();
// // //           if (
// // //             lastTypingRef.current &&
// // //             lastTypingRef.current.isTyping === isTyping &&
// // //             (now - lastTypingRef.current.time) < 150
// // //           ) {
// // //             console.log('[Chat:TYPING] Duplicate suppressed within 150ms');
// // //             return;
// // //           }
// // //           lastTypingRef.current = { isTyping, time: now };

// // //           // FIX BUG 3: Null the ref before reassigning to prevent stale timer
// // //           if (typingTimerRef.current) {
// // //             clearTimeout(typingTimerRef.current);
// // //             typingTimerRef.current = null;
// // //           }

// // //           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
// // //           console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

// // //           if (isTyping) {
// // //             typingTimerRef.current = setTimeout(() => {
// // //               console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
// // //               dispatch({ type: 'SET_TYPING', isTyping: false });
// // //               typingTimerRef.current = null;
// // //               lastTypingRef.current  = null;
// // //             }, 4000);
// // //           }
// // //         }) as EventCallback);

// // //         // ── Other handlers ───────────────────────────────────────────────
// // //         client.on('statusChange', ((data: any) => {
// // //           dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
// // //         }) as EventCallback);

// // //         client.on('agentJoined', ((data: any) => {
// // //           dispatch({
// // //             type: 'UPDATE_SESSION',
// // //             session: {
// // //               assignedAgentId:   data.agentId,
// // //               assignedAgentName: data.agentName,
// // //               mode:   'HUMAN',
// // //               status: 'ASSIGNED',
// // //             },
// // //           });
// // //         }) as EventCallback);

// // //         client.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', connected: false }));
// // //         client.on('reconnect',  () => dispatch({ type: 'SET_CONNECTED', connected: true }));
// // //         client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));

// // //         let session = await client.connect();

// // //         // ── CLOSED session guard ─────────────────────────────────────────────
// // //         // If the backend returns a CLOSED session (e.g. customer previously
// // //         // ended chat and "Start New Chat" remounted the provider), create a
// // //         // fresh session via REST and switch the WS socket to its room.
// // //         if (session.status === 'CLOSED') {
// // //           console.log('[Chat] Got CLOSED session — creating fresh session via REST');
// // //           try {
// // //             const cfg = configRef.current;
// // //             const res = await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions`, {
// // //               method:  'POST',
// // //               headers: {
// // //                 'Authorization': `Bearer ${cfg.token}`,
// // //                 'X-Tenant-ID':   cfg.tenantId,
// // //                 'X-App-ID':      cfg.appId,
// // //                 'Content-Type':  'application/json',
// // //               },
// // //               body: JSON.stringify({
// // //                 appId:         cfg.appId,
// // //                 customerId:    cfg.user.id,
// // //                 customerName:  cfg.user.name,
// // //                 customerEmail: cfg.user.email,
// // //               }),
// // //             });
// // //             if (res.ok) {
// // //               const json = await res.json();
// // //               const newId     = json.data?.sessionId ?? json.data?.id;
// // //               const newMode   = json.data?.mode   ?? 'BOT';
// // //               const newStatus = json.data?.status ?? 'OPEN';
// // //               if (newId) {
// // //                 client.joinSession(newId);
// // //                 session = { id: newId, mode: newMode, status: newStatus };
// // //                 console.log('[Chat] Switched to fresh session:', newId);
// // //               }
// // //             }
// // //           } catch (e) {
// // //             console.warn('[Chat] Could not create fresh session:', e);
// // //           }
// // //         }
// // //         // ─────────────────────────────────────────────────────────────────────

// // //         await fetchMessages(configRef.current, session.id, dispatch);
// // //         dispatch({ type: 'INIT_SUCCESS', session });
// // //         configRef.current.callbacks?.onConnected?.(session.id);

// // //       } catch (error) {
// // //         _activeConnections.delete(connectionKey);
// // //         dispatch({ type: 'INIT_ERROR', error: error as Error });
// // //         configRef.current.callbacks?.onError?.(error as Error);
// // //       }
// // //     };

// // //     initChat();

// // //     return () => {
// // //       _activeConnections.delete(connectionKey);
// // //       pendingReplaces.current.clear();
// // //       if (typingTimerRef.current) {
// // //         clearTimeout(typingTimerRef.current);
// // //         typingTimerRef.current = null;
// // //       }
// // //       if (clientRef.current) {
// // //         clientRef.current.disconnect();
// // //         clientRef.current = null;
// // //       }
// // //     };
// // //   }, [connectionKey, config.serviceUrl, config.token]);

// // //   // ── Actions ───────────────────────────────────────────────────────────────
// // //   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
// // //     if (!clientRef.current || !state.session) throw new Error('Chat not initialized');

// // //     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
// // //     const optimistic: ChatMessage = {
// // //       id:            tempId,
// // //       chatSessionId: state.session.id,
// // //       senderType:    'CUSTOMER',
// // //       senderId:      configRef.current.user.id,
// // //       senderName:    configRef.current.user.name,
// // //       content,
// // //       messageType:   type,
// // //       timestamp:     new Date(),
// // //     };

// // //     pendingReplaces.current.set(content, tempId);
// // //     dispatch({ type: 'ADD_MESSAGE', message: optimistic });
// // //     clientRef.current.sendMessage(content, type);

// // //     const replaceOptimistic: EventCallback = (raw: unknown) => {
// // //       const msg = raw as ChatMessage;
// // //       if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
// // //         dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
// // //         pendingReplaces.current.delete(content);
// // //         clientRef.current?.off?.('message', replaceOptimistic);
// // //       }
// // //     };
// // //     clientRef.current.on('message', replaceOptimistic);

// // //     setTimeout(() => {
// // //       clientRef.current?.off?.('message', replaceOptimistic);
// // //       pendingReplaces.current.delete(content);
// // //     }, 10_000);
// // //   }, [state.session]);

// // //   const startTyping = useCallback(() => {
// // //     console.log('[Chat:TYPING] startTyping() called');
// // //     clientRef.current?.startTyping?.();
// // //   }, []);

// // //   const stopTyping = useCallback(() => {
// // //     console.log('[Chat:TYPING] stopTyping() called');
// // //     clientRef.current?.stopTyping?.();
// // //   }, []);

// // //   const requestAgent = useCallback(async (reason?: string) => {
// // //     clientRef.current?.requestAgent?.(reason);
// // //   }, []);

// // //   const closeSession = useCallback(async () => {
// // //     if (!state.session) return;
// // //     const cfg = configRef.current;
// // //     try {
// // //       await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`, {
// // //         method: 'POST',
// // //         headers: {
// // //           'Authorization': `Bearer ${cfg.token}`,
// // //           'X-Tenant-ID':   cfg.tenantId,
// // //           'X-App-ID':      cfg.appId,
// // //           'Content-Type':  'application/json',
// // //         },
// // //       });
// // //       dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
// // //     } catch (error) {
// // //       dispatch({ type: 'SET_ERROR', error: error as Error });
// // //     }
// // //   }, [state.session]);

// // //   const reconnect = useCallback(async () => {
// // //     if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
// // //     _activeConnections.delete(connectionKey);
// // //     pendingReplaces.current.clear();
// // //     dispatch({ type: 'INIT_START' });
// // //     try {
// // //       const client  = new ChatWebSocketClient(configRef.current);
// // //       clientRef.current = client;
// // //       const session = await client.connect();
// // //       dispatch({ type: 'INIT_SUCCESS', session });
// // //     } catch (error) {
// // //       dispatch({ type: 'INIT_ERROR', error: error as Error });
// // //     }
// // //   }, [connectionKey]);

// // //   const actions: ChatSDKActions = {
// // //     sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect,
// // //   };

// // //   return (
// // //     <ChatContext.Provider value={{ state, actions, config }}>
// // //       {children}
// // //     </ChatContext.Provider>
// // //   );
// // // }

// // // // ─── Hooks ────────────────────────────────────────────────────────────────────
// // // export function useChat() {
// // //   const ctx = useContext(ChatContext);
// // //   if (!ctx) throw new Error('useChat must be used within a ChatProvider');
// // //   return ctx;
// // // }
// // // export const useChatMessages = () => useChat().state.messages;
// // // export const useChatSession  = () => useChat().state.session;
// // // export const useChatActions  = () => useChat().actions;
// // // export const useChatState    = () => useChat().state;

// // // // ─── fetchMessages ────────────────────────────────────────────────────────────
// // // async function fetchMessages(
// // //   config:    ChatSDKConfig,
// // //   sessionId: string,
// // //   dispatch:  React.Dispatch<ChatAction>,
// // // ): Promise<void> {
// // //   try {
// // //     const res = await fetch(
// // //       `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
// // //       {
// // //         headers: {
// // //           'Authorization': `Bearer ${config.token}`,
// // //           'X-Tenant-ID':   config.tenantId,
// // //           'X-App-ID':      config.appId,
// // //         },
// // //       },
// // //     );
// // //     if (!res.ok) return;
// // //     const data = await res.json();
// // //     if (!data.success || !data.data?.messages) return;

// // //     const messages: ChatMessage[] = data.data.messages.map((m: any) => {
// // //       const d = new Date(m.createdAt ?? m.timestamp);
// // //       return {
// // //         id:            m.id,
// // //         chatSessionId: m.chatSessionId,
// // //         senderType:    m.senderType,
// // //         senderId:      m.senderId,
// // //         senderName:    m.senderName,
// // //         content:       m.content,
// // //         messageType:   m.messageType ?? 'TEXT',
// // //         timestamp:     isNaN(d.getTime()) ? new Date() : d,
// // //         metadata:      m.metadata,
// // //       };
// // //     });

// // //     dispatch({ type: 'SET_MESSAGES', messages });
// // //   } catch (e) {
// // //     console.error('[Chat] fetchMessages failed:', e);
// // //   }
// // // }



// // import React, {
// //   createContext, useContext, useReducer, useEffect, useCallback, useRef,
// // } from 'react';
// // import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, MessageType } from './types';
// // import { ChatWebSocketClient } from './client';

// // type EventCallback = (...args: unknown[]) => void;

// // // ─── State / Actions ──────────────────────────────────────────────────────────

// // type ChatAction =
// //   | { type: 'INIT_START' }
// //   | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
// //   | { type: 'INIT_ERROR'; error: Error }
// //   | { type: 'SET_CONNECTED'; connected: boolean }
// //   | { type: 'ADD_MESSAGE'; message: ChatMessage }
// //   | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
// //   | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
// //   | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
// //   | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
// //   | { type: 'SET_ERROR'; error: Error | null };

// // const initialState: ChatSDKState = {
// //   initialized: false,
// //   connected:   false,
// //   loading:     true,
// //   session:     null,
// //   messages:    [],
// //   isTyping:    false,
// //   typingUser:  undefined,
// //   error:       null,
// // };

// // function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
// //   switch (action.type) {
// //     case 'INIT_START':
// //       return { ...state, loading: true, error: null };

// //     case 'INIT_SUCCESS':
// //       return { ...state, initialized: true, connected: true, loading: false, session: action.session };

// //     case 'INIT_ERROR':
// //       return { ...state, loading: false, error: action.error };

// //     case 'SET_CONNECTED':
// //       return { ...state, connected: action.connected };

// //     case 'ADD_MESSAGE': {
// //       if (state.messages.some(m => m.id === action.message.id)) return state;
// //       return { ...state, messages: [...state.messages, action.message] };
// //     }

// //     case 'SET_MESSAGES':
// //       return { ...state, messages: action.messages };

// //     case 'REPLACE_TEMP': {
// //       const idx = state.messages.findIndex(m => m.id === action.tempId);
// //       if (idx === -1) {
// //         if (state.messages.some(m => m.id === action.message.id)) return state;
// //         return { ...state, messages: [...state.messages, action.message] };
// //       }
// //       const updated = [...state.messages];
// //       updated[idx]  = action.message;
// //       return { ...state, messages: updated };
// //     }

// //     case 'SET_TYPING':
// //       return { ...state, isTyping: action.isTyping, typingUser: action.typingUser };

// //     case 'UPDATE_SESSION':
// //       return { ...state, session: state.session ? { ...state.session, ...action.session } : null };

// //     case 'SET_ERROR':
// //       return { ...state, error: action.error };

// //     default:
// //       return state;
// //   }
// // }

// // // ─── Context ──────────────────────────────────────────────────────────────────
// // interface ChatContextValue {
// //   state:   ChatSDKState;
// //   actions: ChatSDKActions;
// //   config:  ChatSDKConfig | null;
// // }
// // const ChatContext = createContext<ChatContextValue | null>(null);

// // // Prevent double-init in React StrictMode
// // const _activeConnections = new Map<string, boolean>();

// // // ─── Provider ─────────────────────────────────────────────────────────────────
// // export function ChatProvider({ config, children }: {
// //   config:   ChatSDKConfig;
// //   children: React.ReactNode;
// // }): JSX.Element {
// //   const [state, dispatch] = useReducer(chatReducer, initialState);
// //   const clientRef         = useRef<ChatWebSocketClient | null>(null);
// //   const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
// //   const connectionKey     = `${config.tenantId}:${config.user?.id}`;
// //   const configRef         = useRef<ChatSDKConfig>(config);
// //   useEffect(() => { configRef.current = config; });

// //   const pendingReplaces = useRef<Map<string, string>>(new Map());

// //   // FIX BUG 2: dedup ref — suppresses the TYPING_INDICATOR + TYPING double-fire
// //   const lastTypingRef = useRef<{ isTyping: boolean; time: number } | null>(null);

// //   // ── Initialize once ───────────────────────────────────────────────────────
// //   useEffect(() => {
// //     if (_activeConnections.get(connectionKey)) return;
// //     _activeConnections.set(connectionKey, true);

// //     const initChat = async () => {
// //       dispatch({ type: 'INIT_START' });
// //       try {
// //         const cfg    = configRef.current;
// //         const client = new ChatWebSocketClient(cfg);
// //         clientRef.current = client;

// //         // ── Message handler ──────────────────────────────────────────────
// //         client.on('message', (msg: unknown) => {
// //           const message = msg as ChatMessage;

// //           if (
// //             message.senderType === 'CUSTOMER' &&
// //             !message.id.startsWith('temp-') &&
// //             pendingReplaces.current.has(message.content)
// //           ) {
// //             console.log('[Chat] Skipping echo — replaceOptimistic will handle:', message.id);
// //             return;
// //           }

// //           console.log('[Chat] ADD_MESSAGE:', message.id, message.senderType, message.content.slice(0, 40));
// //           dispatch({ type: 'ADD_MESSAGE', message });
// //         });

// //         // ── Typing handler — FIXED ───────────────────────────────────────
// //         client.on('typing', ((rawData: any) => {
// //           const isTyping   = rawData?.isTyping   ?? false;
// //           const senderId   = rawData?.senderId   ?? '';
// //           const senderType = rawData?.senderType ?? 'AGENT';

// //           console.log(
// //             `%c[Chat:TYPING] 🖊 Received typing event`,
// //             'color:#f59e0b;font-weight:bold',
// //             { isTyping, senderId, senderType }
// //           );

// //           // FIX BUG 1: Only show the typing bubble for AGENT events.
// //           // Server echoes CUSTOMER typing back to all room members including
// //           // the customer — without this guard they'd see their own bubble.
// //           if (senderType !== 'AGENT') {
// //             console.log('[Chat:TYPING] Ignoring non-agent event, senderType:', senderType);
// //             return;
// //           }

// //           // FIX BUG 2: Suppress duplicate events within 150ms.
// //           // Server emits both TYPING_INDICATOR and TYPING for every action,
// //           // and client.ts listens on both — so this fires twice per keystroke.
// //           const now = Date.now();
// //           if (
// //             lastTypingRef.current &&
// //             lastTypingRef.current.isTyping === isTyping &&
// //             (now - lastTypingRef.current.time) < 150
// //           ) {
// //             console.log('[Chat:TYPING] Duplicate suppressed within 150ms');
// //             return;
// //           }
// //           lastTypingRef.current = { isTyping, time: now };

// //           // FIX BUG 3: Null the ref before reassigning to prevent stale timer
// //           if (typingTimerRef.current) {
// //             clearTimeout(typingTimerRef.current);
// //             typingTimerRef.current = null;
// //           }

// //           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
// //           console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

// //           if (isTyping) {
// //             typingTimerRef.current = setTimeout(() => {
// //               console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
// //               dispatch({ type: 'SET_TYPING', isTyping: false });
// //               typingTimerRef.current = null;
// //               lastTypingRef.current  = null;
// //             }, 4000);
// //           }
// //         }) as EventCallback);

// //         // ── Other handlers ───────────────────────────────────────────────
// //         client.on('statusChange', ((data: any) => {
// //           dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
// //         }) as EventCallback);

// //         client.on('agentJoined', ((data: any) => {
// //           dispatch({
// //             type: 'UPDATE_SESSION',
// //             session: {
// //               assignedAgentId:   data.agentId,
// //               assignedAgentName: data.agentName,
// //               mode:   'HUMAN',
// //               status: 'ASSIGNED',
// //             },
// //           });
// //         }) as EventCallback);

// //         client.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', connected: false }));
// //         client.on('reconnect',  () => dispatch({ type: 'SET_CONNECTED', connected: true }));
// //         client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));

// //         let session = await client.connect();

// //         // ── CLOSED session guard ─────────────────────────────────────────────
// //         // If the backend returns a CLOSED session (e.g. customer previously
// //         // ended chat and "Start New Chat" remounted the provider), create a
// //         // fresh session via REST and switch the WS socket to its room.
// //         if (session.status === 'CLOSED') {
// //           console.log('[Chat] Got CLOSED session — creating fresh session via REST');
// //           try {
// //             const cfg = configRef.current;
// //             const res = await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions`, {
// //               method:  'POST',
// //               headers: {
// //                 'Authorization': `Bearer ${cfg.token}`,
// //                 'X-Tenant-ID':   cfg.tenantId,
// //                 'Content-Type':  'application/json',
// //               },
// //               body: JSON.stringify({
// //                 tenantId:      cfg.tenantId,
// //                 customerId:    cfg.user.id,
// //                 customerName:  cfg.user.name,
// //                 customerEmail: cfg.user.email,
// //               }),
// //             });
// //             if (res.ok) {
// //               const json = await res.json();
// //               const newId     = json.data?.sessionId ?? json.data?.id;
// //               const newMode   = json.data?.mode   ?? 'BOT';
// //               const newStatus = json.data?.status ?? 'OPEN';
// //               if (newId) {
// //                 client.joinSession(newId);
// //                 session = { id: newId, mode: newMode, status: newStatus };
// //                 console.log('[Chat] Switched to fresh session:', newId);
// //               }
// //             }
// //           } catch (e) {
// //             console.warn('[Chat] Could not create fresh session:', e);
// //           }
// //         }
// //         // ─────────────────────────────────────────────────────────────────────

// //         await fetchMessages(configRef.current, session.id, dispatch);
// //         dispatch({ type: 'INIT_SUCCESS', session });
// //         configRef.current.callbacks?.onConnected?.(session.id);

// //       } catch (error) {
// //         _activeConnections.delete(connectionKey);
// //         dispatch({ type: 'INIT_ERROR', error: error as Error });
// //         configRef.current.callbacks?.onError?.(error as Error);
// //       }
// //     };

// //     initChat();

// //     return () => {
// //       _activeConnections.delete(connectionKey);
// //       pendingReplaces.current.clear();
// //       if (typingTimerRef.current) {
// //         clearTimeout(typingTimerRef.current);
// //         typingTimerRef.current = null;
// //       }
// //       if (clientRef.current) {
// //         clientRef.current.disconnect();
// //         clientRef.current = null;
// //       }
// //     };
// //   }, [connectionKey, config.serviceUrl, config.token]);

// //   // ── Actions ───────────────────────────────────────────────────────────────
// //   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
// //     if (!clientRef.current || !state.session) throw new Error('Chat not initialized');

// //     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
// //     const optimistic: ChatMessage = {
// //       id:            tempId,
// //       chatSessionId: state.session.id,
// //       senderType:    'CUSTOMER',
// //       senderId:      configRef.current.user.id,
// //       senderName:    configRef.current.user.name,
// //       content,
// //       messageType:   type,
// //       timestamp:     new Date(),
// //     };

// //     pendingReplaces.current.set(content, tempId);
// //     dispatch({ type: 'ADD_MESSAGE', message: optimistic });
// //     clientRef.current.sendMessage(content, type);

// //     const replaceOptimistic: EventCallback = (raw: unknown) => {
// //       const msg = raw as ChatMessage;
// //       if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
// //         dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
// //         pendingReplaces.current.delete(content);
// //         clientRef.current?.off?.('message', replaceOptimistic);
// //       }
// //     };
// //     clientRef.current.on('message', replaceOptimistic);

// //     setTimeout(() => {
// //       clientRef.current?.off?.('message', replaceOptimistic);
// //       pendingReplaces.current.delete(content);
// //     }, 10_000);
// //   }, [state.session]);

// //   const startTyping = useCallback(() => {
// //     console.log('[Chat:TYPING] startTyping() called');
// //     clientRef.current?.startTyping?.();
// //   }, []);

// //   const stopTyping = useCallback(() => {
// //     console.log('[Chat:TYPING] stopTyping() called');
// //     clientRef.current?.stopTyping?.();
// //   }, []);

// //   const requestAgent = useCallback(async (reason?: string) => {
// //     clientRef.current?.requestAgent?.(reason);
// //   }, []);

// //   const closeSession = useCallback(async () => {
// //     if (!state.session) return;
// //     const cfg = configRef.current;
// //     try {
// //       await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`, {
// //         method: 'POST',
// //         headers: {
// //           'Authorization': `Bearer ${cfg.token}`,
// //           'X-Tenant-ID':   cfg.tenantId,
// //           'Content-Type':  'application/json',
// //         },
// //       });
// //       dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
// //     } catch (error) {
// //       dispatch({ type: 'SET_ERROR', error: error as Error });
// //     }
// //   }, [state.session]);

// //   const reconnect = useCallback(async () => {
// //     if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
// //     _activeConnections.delete(connectionKey);
// //     pendingReplaces.current.clear();
// //     dispatch({ type: 'INIT_START' });
// //     try {
// //       const client  = new ChatWebSocketClient(configRef.current);
// //       clientRef.current = client;
// //       const session = await client.connect();
// //       dispatch({ type: 'INIT_SUCCESS', session });
// //     } catch (error) {
// //       dispatch({ type: 'INIT_ERROR', error: error as Error });
// //     }
// //   }, [connectionKey]);

// //   const actions: ChatSDKActions = {
// //     sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect,
// //   };

// //   return (
// //     <ChatContext.Provider value={{ state, actions, config }}>
// //       {children}
// //     </ChatContext.Provider>
// //   );
// // }

// // // ─── Hooks ────────────────────────────────────────────────────────────────────
// // export function useChat() {
// //   const ctx = useContext(ChatContext);
// //   if (!ctx) throw new Error('useChat must be used within a ChatProvider');
// //   return ctx;
// // }
// // export const useChatMessages = () => useChat().state.messages;
// // export const useChatSession  = () => useChat().state.session;
// // export const useChatActions  = () => useChat().actions;
// // export const useChatState    = () => useChat().state;

// // // ─── fetchMessages ────────────────────────────────────────────────────────────
// // async function fetchMessages(
// //   config:    ChatSDKConfig,
// //   sessionId: string,
// //   dispatch:  React.Dispatch<ChatAction>,
// // ): Promise<void> {
// //   try {
// //     const res = await fetch(
// //       `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
// //       {
// //         headers: {
// //           'Authorization': `Bearer ${config.token}`,
// //           'X-Tenant-ID':   config.tenantId,
// //         },
// //       },
// //     );
// //     if (!res.ok) return;
// //     const data = await res.json();
// //     if (!data.success || !data.data?.messages) return;

// //     const messages: ChatMessage[] = data.data.messages.map((m: any) => {
// //       const d = new Date(m.createdAt ?? m.timestamp);
// //       return {
// //         id:            m.id,
// //         chatSessionId: m.chatSessionId,
// //         senderType:    m.senderType,
// //         senderId:      m.senderId,
// //         senderName:    m.senderName,
// //         content:       m.content,
// //         messageType:   m.messageType ?? 'TEXT',
// //         timestamp:     isNaN(d.getTime()) ? new Date() : d,
// //         metadata:      m.metadata,
// //       };
// //     });

// //     dispatch({ type: 'SET_MESSAGES', messages });
// //   } catch (e) {
// //     console.error('[Chat] fetchMessages failed:', e);
// //   }
// // }



// import React, {
//   createContext, useContext, useReducer, useEffect, useCallback, useRef,
// } from 'react';
// import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, MessageType } from './types';
// import { ChatWebSocketClient } from './client';

// type EventCallback = (...args: unknown[]) => void;

// // ─── State / Actions ──────────────────────────────────────────────────────────

// type ChatAction =
//   | { type: 'INIT_START' }
//   | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
//   | { type: 'INIT_ERROR'; error: Error }
//   | { type: 'SET_CONNECTED'; connected: boolean }
//   | { type: 'ADD_MESSAGE'; message: ChatMessage }
//   | { type: 'SET_MESSAGES'; messages: ChatMessage[]; hasMore?: boolean }
//   | { type: 'PREPEND_MESSAGES'; messages: ChatMessage[]; hasMore: boolean }
//   | { type: 'SET_LOADING_MORE'; loading: boolean }
//   | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
//   | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
//   | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
//   | { type: 'SET_ERROR'; error: Error | null }
//   | { type: 'TOKEN_EXPIRED' }
//   | { type: 'SET_WIDGET_OPEN'; open: boolean };

// const initialState: ChatSDKState = {
//   initialized:  false,
//   connected:    false,
//   loading:      true,
//   session:      null,
//   messages:     [],
//   isTyping:     false,
//   typingUser:   undefined,
//   error:        null,
//   tokenExpired: false,
//   isWidgetOpen: false,
//   unreadCount:  0,
//   hasMore:      true,
//   loadingMore:  false,
// };

// function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
//   switch (action.type) {
//     case 'INIT_START':
//       return { ...state, loading: true, error: null };

//     case 'INIT_SUCCESS':
//       return { ...state, initialized: true, connected: true, loading: false, session: action.session };

//     case 'INIT_ERROR':
//       return { ...state, loading: false, error: action.error };

//     case 'SET_CONNECTED':
//       return { ...state, connected: action.connected };

//     case 'ADD_MESSAGE': {
//       if (state.messages.some(m => m.id === action.message.id)) return state;
//       // Mirror agent dashboard: only increment unread when widget is NOT visible
//       // and the message is from AGENT or BOT (from customer's perspective).
//       const isFromAgentOrBot = action.message.senderType === 'AGENT' || action.message.senderType === 'BOT';
//       const shouldIncrement  = !state.isWidgetOpen && isFromAgentOrBot;
//       return {
//         ...state,
//         messages:    [...state.messages, action.message],
//         unreadCount: shouldIncrement ? state.unreadCount + 1 : state.unreadCount,
//       };
//     }

//     case 'SET_MESSAGES':
//       return { ...state, messages: action.messages, hasMore: action.hasMore ?? true };

//     // Mirror agent dashboard PREPEND_MESSAGES: older messages loaded via scroll-up
//     case 'PREPEND_MESSAGES': {
//       if (!action.messages.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
//       const existingIds = new Set(state.messages.map(m => m.id));
//       const newMsgs = action.messages.filter(m => !existingIds.has(m.id));
//       if (!newMsgs.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
//       return {
//         ...state,
//         messages:    [...newMsgs, ...state.messages],
//         hasMore:     action.hasMore,
//         loadingMore: false,
//       };
//     }

//     case 'SET_LOADING_MORE':
//       return { ...state, loadingMore: action.loading };

//     case 'REPLACE_TEMP': {
//       const idx = state.messages.findIndex(m => m.id === action.tempId);
//       if (idx === -1) {
//         if (state.messages.some(m => m.id === action.message.id)) return state;
//         return { ...state, messages: [...state.messages, action.message] };
//       }
//       const updated = [...state.messages];
//       updated[idx]  = action.message;
//       return { ...state, messages: updated };
//     }

//     case 'SET_TYPING':
//       return { ...state, isTyping: action.isTyping, typingUser: action.typingUser };

//     case 'UPDATE_SESSION':
//       return { ...state, session: state.session ? { ...state.session, ...action.session } : null };

//     case 'SET_ERROR':
//       return { ...state, error: action.error };

//     case 'TOKEN_EXPIRED':
//       return { ...state, tokenExpired: true, connected: false, error: new Error('Your session has expired. Please refresh to continue.') };

//     // Mirror agent dashboard SELECT_SESSION → unread: 0
//     // When widget opens, zero the unread count atomically (same tick as state update).
//     case 'SET_WIDGET_OPEN':
//       return {
//         ...state,
//         isWidgetOpen: action.open,
//         unreadCount:  action.open ? 0 : state.unreadCount,
//       };

//     default:
//       return state;
//   }
// }

// // ─── Context ──────────────────────────────────────────────────────────────────
// interface ChatContextValue {
//   state:   ChatSDKState;
//   actions: ChatSDKActions;
//   config:  ChatSDKConfig | null;
// }
// const ChatContext = createContext<ChatContextValue | null>(null);

// // Prevent double-init in React StrictMode
// const _activeConnections = new Map<string, boolean>();

// // ─── Provider ─────────────────────────────────────────────────────────────────
// export function ChatProvider({ config, children }: {
//   config:   ChatSDKConfig;
//   children: React.ReactNode;
// }): JSX.Element {
//   const [state, dispatch] = useReducer(chatReducer, initialState);
//   const clientRef         = useRef<ChatWebSocketClient | null>(null);
//   const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const connectionKey     = `${config.tenantId}:${config.user?.id}`;
//   const configRef         = useRef<ChatSDKConfig>(config);
//   useEffect(() => { configRef.current = config; }, [config]);

//   const pendingReplaces = useRef<Map<string, string>>(new Map());

//   // FIX BUG 2: dedup ref — suppresses the TYPING_INDICATOR + TYPING double-fire
//   const lastTypingRef = useRef<{ isTyping: boolean; time: number } | null>(null);

//   // ── Initialize once ───────────────────────────────────────────────────────
//   useEffect(() => {
//     if (_activeConnections.get(connectionKey)) return;
//     _activeConnections.set(connectionKey, true);

//     const initChat = async () => {
//       dispatch({ type: 'INIT_START' });
//       try {
//         const cfg    = configRef.current;
//         const client = new ChatWebSocketClient(cfg);
//         clientRef.current = client;

//         // ── Message handler ──────────────────────────────────────────────
//         client.on('message', (msg: unknown) => {
//           const message = msg as ChatMessage;

//           if (
//             message.senderType === 'CUSTOMER' &&
//             !message.id.startsWith('temp-') &&
//             pendingReplaces.current.has(message.content)
//           ) {
//             console.log('[Chat] Skipping echo — replaceOptimistic will handle:', message.id);
//             return;
//           }

//           console.log('[Chat] ADD_MESSAGE:', message.id, message.senderType, message.content.slice(0, 40));
//           dispatch({ type: 'ADD_MESSAGE', message });
//         });

//         // ── Typing handler — FIXED ───────────────────────────────────────
//         client.on('typing', ((rawData: any) => {
//           const isTyping   = rawData?.isTyping   ?? false;
//           const senderId   = rawData?.senderId   ?? '';
//           const senderType = rawData?.senderType ?? 'AGENT';

//           console.log(
//             `%c[Chat:TYPING] 🖊 Received typing event`,
//             'color:#f59e0b;font-weight:bold',
//             { isTyping, senderId, senderType }
//           );

//           // FIX BUG 1: Only show the typing bubble for AGENT events.
//           // Server echoes CUSTOMER typing back to all room members including
//           // the customer — without this guard they'd see their own bubble.
//           if (senderType !== 'AGENT') {
//             console.log('[Chat:TYPING] Ignoring non-agent event, senderType:', senderType);
//             return;
//           }

//           // FIX BUG 2: Suppress duplicate events within 150ms.
//           // Server emits both TYPING_INDICATOR and TYPING for every action,
//           // and client.ts listens on both — so this fires twice per keystroke.
//           const now = Date.now();
//           if (
//             lastTypingRef.current &&
//             lastTypingRef.current.isTyping === isTyping &&
//             (now - lastTypingRef.current.time) < 150
//           ) {
//             console.log('[Chat:TYPING] Duplicate suppressed within 150ms');
//             return;
//           }
//           lastTypingRef.current = { isTyping, time: now };

//           // FIX BUG 3: Null the ref before reassigning to prevent stale timer
//           if (typingTimerRef.current) {
//             clearTimeout(typingTimerRef.current);
//             typingTimerRef.current = null;
//           }

//           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
//           console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

//           if (isTyping) {
//             typingTimerRef.current = setTimeout(() => {
//               console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
//               dispatch({ type: 'SET_TYPING', isTyping: false });
//               typingTimerRef.current = null;
//               lastTypingRef.current  = null;
//             }, 4000);
//           }
//         }) as EventCallback);

//         // ── Other handlers ───────────────────────────────────────────────
//         client.on('statusChange', ((data: any) => {
//           dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
//         }) as EventCallback);

//         client.on('agentJoined', ((data: any) => {
//           dispatch({
//             type: 'UPDATE_SESSION',
//             session: {
//               assignedAgentId:   data.agentId,
//               assignedAgentName: data.agentName,
//               mode:   'HUMAN',
//               status: 'ASSIGNED',
//             },
//           });
//         }) as EventCallback);

//         client.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', connected: false }));
//         client.on('reconnect',  () => dispatch({ type: 'SET_CONNECTED', connected: true }));
//         client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));
//         client.on('tokenExpired', () => {
//           console.warn('[Chat] Token expired — blocking further messages');
//           dispatch({ type: 'TOKEN_EXPIRED' });
//         });

//         let session = await client.connect();

//         // ── CLOSED session guard ─────────────────────────────────────────────
//         // If the backend returns a CLOSED session (e.g. customer previously
//         // ended chat and "Start New Chat" remounted the provider), create a
//         // fresh session via REST and switch the WS socket to its room.
//         if (session.status === 'CLOSED') {
//           console.log('[Chat] Got CLOSED session — creating fresh session via REST');
//           try {
//             const cfg = configRef.current;
//             const res = await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions`, {
//               method:  'POST',
//               headers: {
//                 'Authorization': `Bearer ${cfg.token}`,
//                 'X-Tenant-ID':   cfg.tenantId,
//                 'Content-Type':  'application/json',
//               },
//               body: JSON.stringify({
//                 tenantId:      cfg.tenantId,
//                 customerId:    cfg.user.id,
//                 customerName:  cfg.user.name,
//                 customerEmail: cfg.user.email,
//               }),
//             });
//             if (res.ok) {
//               const json = await res.json();
//               const newId     = json.data?.sessionId ?? json.data?.id;
//               const newMode   = json.data?.mode   ?? 'BOT';
//               const newStatus = json.data?.status ?? 'OPEN';
//               if (newId) {
//                 client.joinSession(newId);
//                 session = { id: newId, mode: newMode, status: newStatus };
//                 console.log('[Chat] Switched to fresh session:', newId);
//               }
//             }
//           } catch (e) {
//             console.warn('[Chat] Could not create fresh session:', e);
//           }
//         }
//         // ─────────────────────────────────────────────────────────────────────

//         await fetchMessages(configRef.current, session.id, dispatch);
//         dispatch({ type: 'INIT_SUCCESS', session });
//         configRef.current.callbacks?.onConnected?.(session.id);

//       } catch (error) {
//         _activeConnections.delete(connectionKey);
//         dispatch({ type: 'INIT_ERROR', error: error as Error });
//         configRef.current.callbacks?.onError?.(error as Error);
//       }
//     };

//     initChat();

//     return () => {
//       _activeConnections.delete(connectionKey);
//       pendingReplaces.current.clear();
//       if (typingTimerRef.current) {
//         clearTimeout(typingTimerRef.current);
//         typingTimerRef.current = null;
//       }
//       if (clientRef.current) {
//         clientRef.current.disconnect();
//         clientRef.current = null;
//       }
//     };
//   }, [connectionKey, config.serviceUrl, config.token]);

//   // ── Actions ───────────────────────────────────────────────────────────────
//   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
//     if (!clientRef.current || !state.session) throw new Error('Chat not initialized');
//     if (clientRef.current.tokenExpired || state.tokenExpired) {
//       throw new Error('TOKEN_EXPIRED');
//     }

//     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
//     const optimistic: ChatMessage = {
//       id:            tempId,
//       chatSessionId: state.session.id,
//       senderType:    'CUSTOMER',
//       senderId:      configRef.current.user.id,
//       senderName:    configRef.current.user.name,
//       content,
//       messageType:   type,
//       timestamp:     new Date(),
//     };

//     pendingReplaces.current.set(content, tempId);
//     dispatch({ type: 'ADD_MESSAGE', message: optimistic });
//     clientRef.current.sendMessage(content, type);

//     const replaceOptimistic: EventCallback = (raw: unknown) => {
//       const msg = raw as ChatMessage;
//       if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
//         dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
//         pendingReplaces.current.delete(content);
//         clientRef.current?.off?.('message', replaceOptimistic);
//       }
//     };
//     clientRef.current.on('message', replaceOptimistic);

//     setTimeout(() => {
//       clientRef.current?.off?.('message', replaceOptimistic);
//       pendingReplaces.current.delete(content);
//     }, 10_000);
//   }, [state.session, state.tokenExpired]);

//   const startTyping = useCallback(() => {
//     console.log('[Chat:TYPING] startTyping() called');
//     clientRef.current?.startTyping?.();
//   }, []);

//   const stopTyping = useCallback(() => {
//     console.log('[Chat:TYPING] stopTyping() called');
//     clientRef.current?.stopTyping?.();
//   }, []);

//   const requestAgent = useCallback(async (reason?: string) => {
//     clientRef.current?.requestAgent?.(reason);
//   }, []);

//   const closeSession = useCallback(async () => {
//     if (!state.session) return;
//     const cfg = configRef.current;
//     try {
//       await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`, {
//         method: 'POST',
//         headers: {
//           'Authorization': `Bearer ${cfg.token}`,
//           'X-Tenant-ID':   cfg.tenantId,
//           'Content-Type':  'application/json',
//         },
//       });
//       dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
//     } catch (error) {
//       dispatch({ type: 'SET_ERROR', error: error as Error });
//     }
//   }, [state.session]);

//   const reconnect = useCallback(async () => {
//     if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
//     _activeConnections.delete(connectionKey);
//     pendingReplaces.current.clear();
//     dispatch({ type: 'INIT_START' });
//     try {
//       const client  = new ChatWebSocketClient(configRef.current);
//       clientRef.current = client;
//       const session = await client.connect();
//       dispatch({ type: 'INIT_SUCCESS', session });
//     } catch (error) {
//       dispatch({ type: 'INIT_ERROR', error: error as Error });
//     }
//   }, [connectionKey]);

//   const setWidgetOpen = useCallback((open: boolean) => {
//     dispatch({ type: 'SET_WIDGET_OPEN', open });
//   }, []);

//   // ── Scroll-up pagination: load older messages ─────────────────────────────
//   // Mirror agent dashboard loadOlderMessages: uses oldest message ID as cursor
//   const loadOlderMessages = useCallback(async () => {
//     const s = state;
//     if (!s.session || s.loadingMore || !s.hasMore) return;
//     const oldest = s.messages[0];
//     if (!oldest) return;

//     dispatch({ type: 'SET_LOADING_MORE', loading: true });
//     try {
//       const cfg = configRef.current;
//       const url = `${cfg.serviceUrl}/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
//       const res = await fetch(url, {
//         headers: {
//           'Authorization': `Bearer ${cfg.token}`,
//           'X-Tenant-ID':   cfg.tenantId,
//         },
//       });
//       if (!res.ok) {
//         dispatch({ type: 'SET_LOADING_MORE', loading: false });
//         return;
//       }
//       const json = await res.json();
//       const data = json.data ?? {};
//       const messages: ChatMessage[] = (data.messages ?? []).map((m: any) => {
//         const d = new Date(m.createdAt ?? m.timestamp);
//         return {
//           id:            m.id,
//           chatSessionId: m.chatSessionId,
//           senderType:    m.senderType,
//           senderId:      m.senderId,
//           senderName:    m.senderName,
//           content:       m.content,
//           messageType:   m.messageType ?? 'TEXT',
//           timestamp:     isNaN(d.getTime()) ? new Date() : d,
//           metadata:      m.metadata,
//         };
//       });
//       dispatch({ type: 'PREPEND_MESSAGES', messages, hasMore: data.hasMore ?? false });
//     } catch (err) {
//       console.error('[Chat] loadOlderMessages failed:', err);
//       dispatch({ type: 'SET_LOADING_MORE', loading: false });
//     }
//   }, [state.session, state.loadingMore, state.hasMore, state.messages]);

//   const actions: ChatSDKActions = {
//     sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect, setWidgetOpen, loadOlderMessages,
//   };

//   return (
//     <ChatContext.Provider value={{ state, actions, config }}>
//       {children}
//     </ChatContext.Provider>
//   );
// }

// // ─── Hooks ────────────────────────────────────────────────────────────────────
// export function useChat() {
//   const ctx = useContext(ChatContext);
//   if (!ctx) throw new Error('useChat must be used within a ChatProvider');
//   return ctx;
// }
// export const useChatMessages = () => useChat().state.messages;
// export const useChatSession  = () => useChat().state.session;
// export const useChatActions  = () => useChat().actions;
// export const useChatState    = () => useChat().state;

// // ─── fetchMessages ────────────────────────────────────────────────────────────
// async function fetchMessages(
//   config:    ChatSDKConfig,
//   sessionId: string,
//   dispatch:  React.Dispatch<ChatAction>,
// ): Promise<void> {
//   try {
//     const res = await fetch(
//       `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
//       {
//         headers: {
//           'Authorization': `Bearer ${config.token}`,
//           'X-Tenant-ID':   config.tenantId,
//         },
//       },
//     );
//     if (!res.ok) return;
//     const data = await res.json();
//     if (!data.success || !data.data?.messages) return;

//     const messages: ChatMessage[] = data.data.messages.map((m: any) => {
//       const d = new Date(m.createdAt ?? m.timestamp);
//       return {
//         id:            m.id,
//         chatSessionId: m.chatSessionId,
//         senderType:    m.senderType,
//         senderId:      m.senderId,
//         senderName:    m.senderName,
//         content:       m.content,
//         messageType:   m.messageType ?? 'TEXT',
//         timestamp:     isNaN(d.getTime()) ? new Date() : d,
//         metadata:      m.metadata,
//       };
//     });

//     const hasMore = data.data.hasMore ?? false;
//     dispatch({ type: 'SET_MESSAGES', messages, hasMore });
//   } catch (e) {
//     console.error('[Chat] fetchMessages failed:', e);
//   }
// }



import React, {
  createContext, useContext, useReducer, useEffect, useCallback, useRef,
} from 'react';
import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, MessageType } from './types';
import { ChatWebSocketClient } from './client';

type EventCallback = (...args: unknown[]) => void;

// ─── State / Actions ──────────────────────────────────────────────────────────

type ChatAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; session: ChatSDKState['session'] }
  | { type: 'INIT_ERROR'; error: Error }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[]; hasMore?: boolean }
  | { type: 'PREPEND_MESSAGES'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'SET_LOADING_MORE'; loading: boolean }
  | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
  | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
  | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
  | { type: 'SET_ERROR'; error: Error | null }
  | { type: 'TOKEN_EXPIRED' }
  | { type: 'SET_WIDGET_OPEN'; open: boolean };

const initialState: ChatSDKState = {
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
};

function chatReducer(state: ChatSDKState, action: ChatAction): ChatSDKState {
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
      // Mirror agent dashboard: only increment unread when widget is NOT visible
      // and the message is from AGENT or BOT (from customer's perspective).
      const isFromAgentOrBot = action.message.senderType === 'AGENT' || action.message.senderType === 'BOT';
      const shouldIncrement  = !state.isWidgetOpen && isFromAgentOrBot;
      return {
        ...state,
        messages:    [...state.messages, action.message],
        unreadCount: shouldIncrement ? state.unreadCount + 1 : state.unreadCount,
      };
    }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages, hasMore: action.hasMore ?? true };

    // Mirror agent dashboard PREPEND_MESSAGES: older messages loaded via scroll-up
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
      updated[idx]  = action.message;
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

    // Mirror agent dashboard SELECT_SESSION → unread: 0
    // When widget opens, zero the unread count atomically (same tick as state update).
    case 'SET_WIDGET_OPEN':
      return {
        ...state,
        isWidgetOpen: action.open,
        unreadCount:  action.open ? 0 : state.unreadCount,
      };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface ChatContextValue {
  state:   ChatSDKState;
  actions: ChatSDKActions;
  config:  ChatSDKConfig | null;
}
const ChatContext = createContext<ChatContextValue | null>(null);

// Prevent double-init in React StrictMode
const _activeConnections = new Map<string, boolean>();

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ChatProvider({ config, children }: {
  config:   ChatSDKConfig;
  children: React.ReactNode;
}): JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const clientRef         = useRef<ChatWebSocketClient | null>(null);
  const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionKey     = `${config.tenantId}:${config.user?.id}`;
  const configRef         = useRef<ChatSDKConfig>(config);
  useEffect(() => { configRef.current = config; });

  const pendingReplaces = useRef<Map<string, string>>(new Map());

  // FIX BUG 2: dedup ref — suppresses the TYPING_INDICATOR + TYPING double-fire
  const lastTypingRef = useRef<{ isTyping: boolean; time: number } | null>(null);

  // ── Initialize once ───────────────────────────────────────────────────────
  useEffect(() => {
    if (_activeConnections.get(connectionKey)) return;
    _activeConnections.set(connectionKey, true);

    const initChat = async () => {
      dispatch({ type: 'INIT_START' });
      try {
        const cfg    = configRef.current;
        const client = new ChatWebSocketClient(cfg);
        clientRef.current = client;

        // ── Message handler ──────────────────────────────────────────────
        client.on('message', (msg: unknown) => {
          const message = msg as ChatMessage;

          if (
            message.senderType === 'CUSTOMER' &&
            !message.id.startsWith('temp-') &&
            pendingReplaces.current.has(message.content)
          ) {
            console.log('[Chat] Skipping echo — replaceOptimistic will handle:', message.id);
            return;
          }

          console.log('[Chat] ADD_MESSAGE:', message.id, message.senderType, message.content.slice(0, 40));
          dispatch({ type: 'ADD_MESSAGE', message });
        });

        // ── Typing handler — FIXED ───────────────────────────────────────
        client.on('typing', ((rawData: any) => {
          const isTyping   = rawData?.isTyping   ?? false;
          const senderId   = rawData?.senderId   ?? '';
          const senderType = rawData?.senderType ?? 'AGENT';

          console.log(
            `%c[Chat:TYPING] 🖊 Received typing event`,
            'color:#f59e0b;font-weight:bold',
            { isTyping, senderId, senderType }
          );

          // FIX BUG 1: Only show the typing bubble for AGENT events.
          // Server echoes CUSTOMER typing back to all room members including
          // the customer — without this guard they'd see their own bubble.
          if (senderType !== 'AGENT') {
            console.log('[Chat:TYPING] Ignoring non-agent event, senderType:', senderType);
            return;
          }

          // FIX BUG 2: Suppress duplicate events within 150ms.
          // Server emits both TYPING_INDICATOR and TYPING for every action,
          // and client.ts listens on both — so this fires twice per keystroke.
          const now = Date.now();
          if (
            lastTypingRef.current &&
            lastTypingRef.current.isTyping === isTyping &&
            (now - lastTypingRef.current.time) < 150
          ) {
            console.log('[Chat:TYPING] Duplicate suppressed within 150ms');
            return;
          }
          lastTypingRef.current = { isTyping, time: now };

          // FIX BUG 3: Null the ref before reassigning to prevent stale timer
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = null;
          }

          dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
          console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

          if (isTyping) {
            typingTimerRef.current = setTimeout(() => {
              console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
              dispatch({ type: 'SET_TYPING', isTyping: false });
              typingTimerRef.current = null;
              lastTypingRef.current  = null;
            }, 4000);
          }
        }) as EventCallback);

        // ── Other handlers ───────────────────────────────────────────────
        client.on('statusChange', ((data: any) => {
          dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
        }) as EventCallback);

        client.on('agentJoined', ((data: any) => {
          dispatch({
            type: 'UPDATE_SESSION',
            session: {
              assignedAgentId:   data.agentId,
              assignedAgentName: data.agentName,
              mode:   'HUMAN',
              status: 'ASSIGNED',
            },
          });
        }) as EventCallback);

        client.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', connected: false }));
        client.on('reconnect',  () => dispatch({ type: 'SET_CONNECTED', connected: true }));
        client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));
        client.on('tokenExpired', () => {
          console.warn('[Chat] Token expired — blocking further messages');
          dispatch({ type: 'TOKEN_EXPIRED' });
        });

        let session = await client.connect();

        // ── CLOSED session guard ─────────────────────────────────────────────
        // If the backend returns a CLOSED session (e.g. customer previously
        // ended chat and "Start New Chat" remounted the provider), create a
        // fresh session via REST and switch the WS socket to its room.
        if (session.status === 'CLOSED') {
          console.log('[Chat] Got CLOSED session — creating fresh session via REST');
          try {
            const cfg = configRef.current;
            const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions`, {
              method:  'POST',
              headers: {
                'Authorization': `Bearer ${cfg.token}`,
                'X-Tenant-ID':   cfg.tenantId,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({
                tenantId:      cfg.tenantId,
                customerId:    cfg.user.id,
                customerName:  cfg.user.name,
                customerEmail: cfg.user.email,
              }),
            });
            if (res.ok) {
              const json = await res.json();
              const newId     = json.data?.sessionId ?? json.data?.id;
              const newMode   = json.data?.mode   ?? 'BOT';
              const newStatus = json.data?.status ?? 'OPEN';
              if (newId) {
                client.joinSession(newId);
                session = { id: newId, mode: newMode, status: newStatus };
                console.log('[Chat] Switched to fresh session:', newId);
              }
            }
          } catch (e) {
            console.warn('[Chat] Could not create fresh session:', e);
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        await fetchMessages(configRef.current, session.id, dispatch);
        dispatch({ type: 'INIT_SUCCESS', session });
        configRef.current.callbacks?.onConnected?.(session.id);

      } catch (error) {
        _activeConnections.delete(connectionKey);
        dispatch({ type: 'INIT_ERROR', error: error as Error });
        configRef.current.callbacks?.onError?.(error as Error);
      }
    };

    initChat();

    return () => {
      _activeConnections.delete(connectionKey);
      pendingReplaces.current.clear();
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [connectionKey, config.serviceUrl, config.token]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT', replyToMessageId?: string) => {
    if (!clientRef.current || !state.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || state.tokenExpired) {
      throw new Error('TOKEN_EXPIRED');
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id:            tempId,
      chatSessionId: state.session.id,
      senderType:    'CUSTOMER',
      senderId:      configRef.current.user.id,
      senderName:    configRef.current.user.name,
      content,
      messageType:   type,
      timestamp:     new Date(),
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };

    pendingReplaces.current.set(content, tempId);
    dispatch({ type: 'ADD_MESSAGE', message: optimistic });
    clientRef.current.sendMessage(content, type, replyToMessageId);

    const replaceOptimistic: EventCallback = (raw: unknown) => {
      const msg = raw as ChatMessage;
      if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
        // Preserve replyToMessageId from optimistic if server WS event didn't include it
        const mergedMsg: ChatMessage = {
          ...msg,
          ...(replyToMessageId && !msg.replyToMessageId ? { replyToMessageId } : {}),
        };
        dispatch({ type: 'REPLACE_TEMP', tempId, message: mergedMsg });
        pendingReplaces.current.delete(content);
        clientRef.current?.off?.('message', replaceOptimistic);
      }
    };
    clientRef.current.on('message', replaceOptimistic);

    setTimeout(() => {
      clientRef.current?.off?.('message', replaceOptimistic);
      pendingReplaces.current.delete(content);
    }, 10_000);
  }, [state.session, state.tokenExpired]);

  const startTyping = useCallback(() => {
    console.log('[Chat:TYPING] startTyping() called');
    clientRef.current?.startTyping?.();
  }, []);

  const stopTyping = useCallback(() => {
    console.log('[Chat:TYPING] stopTyping() called');
    clientRef.current?.stopTyping?.();
  }, []);

  const requestAgent = useCallback(async (reason?: string) => {
    clientRef.current?.requestAgent?.(reason);
  }, []);

  const closeSession = useCallback(async () => {
    if (!state.session) return;
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${state.session.id}/close`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
      });
      dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', error: error as Error });
    }
  }, [state.session]);

  const reconnect = useCallback(async () => {
    if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
    _activeConnections.delete(connectionKey);
    pendingReplaces.current.clear();
    dispatch({ type: 'INIT_START' });
    try {
      const client  = new ChatWebSocketClient(configRef.current);
      clientRef.current = client;
      const session = await client.connect();
      dispatch({ type: 'INIT_SUCCESS', session });
    } catch (error) {
      dispatch({ type: 'INIT_ERROR', error: error as Error });
    }
  }, [connectionKey]);

  const setWidgetOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_WIDGET_OPEN', open });
  }, []);

  // ── Scroll-up pagination: load older messages ─────────────────────────────
  // Mirror agent dashboard loadOlderMessages: uses oldest message ID as cursor
  const loadOlderMessages = useCallback(async () => {
    const s = state;
    if (!s.session || s.loadingMore || !s.hasMore) return;
    const oldest = s.messages[0];
    if (!oldest) return;

    dispatch({ type: 'SET_LOADING_MORE', loading: true });
    try {
      const cfg = configRef.current;
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
        },
      });
      if (!res.ok) {
        dispatch({ type: 'SET_LOADING_MORE', loading: false });
        return;
      }
      const json = await res.json();
      const data = json.data ?? {};
      const messages: ChatMessage[] = (data.messages ?? []).map((m: any) => {
        const d = new Date(m.createdAt ?? m.timestamp);
        return {
          id:            m.id,
          chatSessionId: m.chatSessionId,
          senderType:    m.senderType,
          senderId:      m.senderId,
          senderName:    m.senderName,
          content:       m.content,
          messageType:   m.messageType ?? 'TEXT',
          timestamp:     isNaN(d.getTime()) ? new Date() : d,
          metadata:      m.metadata,
          attachment:     m.attachment ?? m.metadata?.attachment ?? undefined,
          replyToMessageId: m.replyToMessageId ?? undefined,
          replyToMessage:   m.replyToMessage ?? undefined,
        };
      });
      dispatch({ type: 'PREPEND_MESSAGES', messages, hasMore: data.hasMore ?? false });
    } catch (err) {
      console.error('[Chat] loadOlderMessages failed:', err);
      dispatch({ type: 'SET_LOADING_MORE', loading: false });
    }
  }, [state.session, state.loadingMore, state.hasMore, state.messages]);

  const sendAttachment = useCallback(async (file: File) => {
    if (!clientRef.current || !state.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || state.tokenExpired) {
      throw new Error('TOKEN_EXPIRED');
    }
    await clientRef.current.sendAttachment(file);
  }, [state.session, state.tokenExpired]);

  const actions: ChatSDKActions = {
    sendMessage, sendAttachment, startTyping, stopTyping, closeSession, requestAgent, reconnect, setWidgetOpen, loadOlderMessages,
  };

  return (
    <ChatContext.Provider value={{ state, actions, config }}>
      {children}
    </ChatContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
export const useChatMessages = () => useChat().state.messages;
export const useChatSession  = () => useChat().state.session;
export const useChatActions  = () => useChat().actions;
export const useChatState    = () => useChat().state;

// ─── fetchMessages ────────────────────────────────────────────────────────────
async function fetchMessages(
  config:    ChatSDKConfig,
  sessionId: string,
  dispatch:  React.Dispatch<ChatAction>,
): Promise<void> {
  try {
    const res = await fetch(
      `${config.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/full`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Tenant-ID':   config.tenantId,
        },
      },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.data?.messages) return;

    const messages: ChatMessage[] = data.data.messages.map((m: any) => {
      const d = new Date(m.createdAt ?? m.timestamp);
      return {
        id:            m.id,
        chatSessionId: m.chatSessionId,
        senderType:    m.senderType,
        senderId:      m.senderId,
        senderName:    m.senderName,
        content:       m.content,
        messageType:   m.messageType ?? 'TEXT',
        timestamp:     isNaN(d.getTime()) ? new Date() : d,
        metadata:      m.metadata,
        attachment:     m.attachment ?? m.metadata?.attachment ?? undefined,
        replyToMessageId: m.replyToMessageId ?? undefined,
        replyToMessage:   m.replyToMessage ?? undefined,
      };
    });

    const hasMore = data.data.hasMore ?? false;
    dispatch({ type: 'SET_MESSAGES', messages, hasMore });
  } catch (e) {
    console.error('[Chat] fetchMessages failed:', e);
  }
}
