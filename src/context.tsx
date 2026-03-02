// // ==========================================
// // Chat SDK - React Context — TYPING FIX (DEFINITIVE)
// //
// // BUGS FIXED IN THIS VERSION:
// //
// // BUG 1 [TYPING STATE]: context.tsx's typing handler was correct structurally,
// //   but had a subtle race condition: clearTimeout was called on typingTimer.current
// //   but then immediately reassigned. If multiple typing events arrived fast,
// //   the old timer reference was lost and the indicator could get stuck on.
// //   FIX: always clear before setting, and null out the ref after clearing.
// //
// // BUG 2 [TYPING DISPLAY]: The typing indicator in ChatWidget is gated on:
// //   {(showTyping || state.isTyping) && <TypingIndicator />}
// //   showTyping = local bot "thinking" animation
// //   state.isTyping = agent typing from WS
// //   This is CORRECT as long as SET_TYPING dispatches properly.
// //   Added full console logs to confirm the dispatch path works end-to-end.
// //
// // LOGGING: Full trace from WS 'typing' event → dispatch → render.
// // ==========================================

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
//   | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
//   | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
//   | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
//   | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
//   | { type: 'SET_ERROR'; error: Error | null };

// const initialState: ChatSDKState = {
//   initialized: false,
//   connected:   false,
//   loading:     true,
//   session:     null,
//   messages:    [],
//   isTyping:    false,
//   typingUser:  undefined,
//   error:       null,
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
//       return { ...state, messages: [...state.messages, action.message] };
//     }

//     case 'SET_MESSAGES':
//       return { ...state, messages: action.messages };

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
//   const connectionKey     = `${config.appId}:${config.user?.id}`;
//   const configRef         = useRef<ChatSDKConfig>(config);
//   useEffect(() => { configRef.current = config; });

//   // Track pending optimistic replaces to prevent duplicate ADD_MESSAGE
//   const pendingReplaces = useRef<Map<string, string>>(new Map());

//   // ── Initialize once ─────────────────────────────────────────────────────────
//   useEffect(() => {
//     if (_activeConnections.get(connectionKey)) return;
//     _activeConnections.set(connectionKey, true);

//     const initChat = async () => {
//       dispatch({ type: 'INIT_START' });
//       try {
//         const cfg    = configRef.current;
//         const client = new ChatWebSocketClient(cfg);
//         clientRef.current = client;

//         // ── Message handler ────────────────────────────────────────────────
//         client.on('message', (msg: unknown) => {
//           const message = msg as ChatMessage;

//           // Skip customer echoes that have a pending replaceOptimistic listener
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

//         // ── Typing handler — with full debug logging ────────────────────────
//         client.on('typing', ((rawData: any) => {
//           const isTyping   = rawData?.isTyping   ?? false;
//           const senderId   = rawData?.senderId   ?? '';
//           const senderType = rawData?.senderType ?? 'unknown';

//           console.log(
//             `%c[Chat:TYPING] 🖊 Received typing event → dispatching SET_TYPING`,
//             'color:#f59e0b;font-weight:bold',
//             { isTyping, senderId, senderType }
//           );

//           // FIX: clear timer properly before reassigning
//           if (typingTimerRef.current) {
//             clearTimeout(typingTimerRef.current);
//             typingTimerRef.current = null;
//           }

//           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
//           console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

//           if (isTyping) {
//             // Auto-clear after 4s if no stop event arrives
//             typingTimerRef.current = setTimeout(() => {
//               console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
//               dispatch({ type: 'SET_TYPING', isTyping: false });
//               typingTimerRef.current = null;
//             }, 4000);
//           }
//         }) as EventCallback);

//         // ── Other handlers ─────────────────────────────────────────────────
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

//         const session = await client.connect();
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
//       if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
//       if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
//     };
//   }, [connectionKey, config.serviceUrl, config.token]);

//   // ── Actions ──────────────────────────────────────────────────────────────────
//   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
//     if (!clientRef.current || !state.session) throw new Error('Chat not initialized');

//     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
//     const optimistic: ChatMessage = {
//       id: tempId,
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

//     // One-shot listener: replaces optimistic when server echo arrives
//     const replaceOptimistic: EventCallback = (raw: unknown) => {
//       const msg = raw as ChatMessage;
//       if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
//         dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
//         pendingReplaces.current.delete(content);
//         clientRef.current?.off?.('message', replaceOptimistic);
//       }
//     };
//     clientRef.current.on('message', replaceOptimistic);

//     // Safety cleanup after 10s
//     setTimeout(() => {
//       clientRef.current?.off?.('message', replaceOptimistic);
//       pendingReplaces.current.delete(content);
//     }, 10_000);
//   }, [state.session]);

//   const startTyping  = useCallback(() => {
//     console.log('[Chat:TYPING] startTyping() called');
//     clientRef.current?.startTyping?.();
//   }, []);

//   const stopTyping   = useCallback(() => {
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
//           'X-Tenant-ID': cfg.tenantId,
//           'X-App-ID': cfg.appId,
//           'Content-Type': 'application/json',
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

//   const actions: ChatSDKActions = { sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect };

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
//   config:   ChatSDKConfig,
//   sessionId: string,
//   dispatch: React.Dispatch<ChatAction>,
// ): Promise<void> {
//   try {
//     const res = await fetch(
//       `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
//       {
//         headers: {
//           'Authorization': `Bearer ${config.token}`,
//           'X-Tenant-ID': config.tenantId,
//           'X-App-ID':    config.appId,
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

//     dispatch({ type: 'SET_MESSAGES', messages });
//   } catch (e) {
//     console.error('[Chat] fetchMessages failed:', e);
//   }
// }



// ==========================================
// Chat SDK - React Context — TYPING FIX (DEFINITIVE v2)
//
// BUGS FIXED IN THIS VERSION:
//
// BUG 1 [CUSTOMER SEES OWN ECHO]: The server broadcasts TYPING events to the
//   entire room including the sender. So when the customer types, they receive
//   their own typing event back as isTyping=true — causing the customer to see
//   the typing bubble for themselves.
//   FIX: Filter events — only show typing indicator when senderType === 'AGENT'.
//
// BUG 2 [DOUBLE EVENTS]: client.ts listens on both 'TYPING_INDICATOR' and 'TYPING'
//   event names. The server emits both for every typing action. This means every
//   single keystroke fires the typing handler twice, causing the 4s auto-clear
//   timer to reset twice and creating subtle state flicker.
//   FIX: Deduplicate events within a 150ms window using a ref.
//
// BUG 3 [TIMER RACE]: Original code cleared typingTimerRef.current and then
//   immediately set it. Under fast event bursts this could leave a stale timer.
//   FIX: Null out the ref after clearing, always before setting.
// ==========================================







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
//   | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
//   | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
//   | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
//   | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
//   | { type: 'SET_ERROR'; error: Error | null };

// const initialState: ChatSDKState = {
//   initialized: false,
//   connected:   false,
//   loading:     true,
//   session:     null,
//   messages:    [],
//   isTyping:    false,
//   typingUser:  undefined,
//   error:       null,
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
//       return { ...state, messages: [...state.messages, action.message] };
//     }

//     case 'SET_MESSAGES':
//       return { ...state, messages: action.messages };

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
//   const connectionKey     = `${config.appId}:${config.user?.id}`;
//   const configRef         = useRef<ChatSDKConfig>(config);
//   useEffect(() => { configRef.current = config; });

//   // Track pending optimistic replaces to prevent duplicate ADD_MESSAGE
//   const pendingReplaces = useRef<Map<string, string>>(new Map());

//   // FIX: deduplication ref — suppresses the double-fire from TYPING_INDICATOR + TYPING
//   const lastTypingRef = useRef<{ isTyping: boolean; time: number } | null>(null);

//   // ── Initialize once ─────────────────────────────────────────────────────────
//   useEffect(() => {
//     if (_activeConnections.get(connectionKey)) return;
//     _activeConnections.set(connectionKey, true);

//     const initChat = async () => {
//       dispatch({ type: 'INIT_START' });
//       try {
//         const cfg    = configRef.current;
//         const client = new ChatWebSocketClient(cfg);
//         clientRef.current = client;

//         // ── Message handler ────────────────────────────────────────────────
//         client.on('message', (msg: unknown) => {
//           const message = msg as ChatMessage;

//           // Skip customer echoes that have a pending replaceOptimistic listener
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

//         // ── Typing handler — FIXED ─────────────────────────────────────────
//         client.on('typing', ((rawData: any) => {
//           const isTyping   = rawData?.isTyping   ?? false;
//           const senderId   = rawData?.senderId   ?? '';
//           const senderType = rawData?.senderType ?? 'AGENT';

//           console.log(
//             `%c[Chat:TYPING] 🖊 Received typing event`,
//             'color:#f59e0b;font-weight:bold',
//             { isTyping, senderId, senderType }
//           );

//           // FIX 1: Only show the typing bubble when the AGENT is typing.
//           // The server echoes typing events back to all room members including
//           // the customer themselves. Without this guard, the customer would see
//           // their own typing bubble.
//           if (senderType !== 'AGENT') {
//             console.log('[Chat:TYPING] Ignoring non-agent typing event (senderType:', senderType, ')');
//             return;
//           }

//           // FIX 2: Deduplicate — the server broadcasts both 'TYPING_INDICATOR'
//           // and 'TYPING' event names for every single typing action. client.ts
//           // listens on both so every event fires this handler twice within ~1ms.
//           // Suppress the duplicate if same state arrived within 150ms.
//           const now = Date.now();
//           if (
//             lastTypingRef.current &&
//             lastTypingRef.current.isTyping === isTyping &&
//             (now - lastTypingRef.current.time) < 150
//           ) {
//             console.log('[Chat:TYPING] Duplicate event suppressed within 150ms window');
//             return;
//           }
//           lastTypingRef.current = { isTyping, time: now };

//           // FIX 3: Clear timer properly — null out ref before reassigning
//           if (typingTimerRef.current) {
//             clearTimeout(typingTimerRef.current);
//             typingTimerRef.current = null;
//           }

//           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });
//           console.log('[Chat:TYPING] SET_TYPING dispatched, isTyping =', isTyping);

//           if (isTyping) {
//             // Auto-clear after 4s if no stop event arrives
//             typingTimerRef.current = setTimeout(() => {
//               console.log('[Chat:TYPING] Auto-clearing typing indicator (4s timeout)');
//               dispatch({ type: 'SET_TYPING', isTyping: false });
//               typingTimerRef.current = null;
//               lastTypingRef.current  = null;
//             }, 4000);
//           }
//         }) as EventCallback);

//         // ── Other handlers ─────────────────────────────────────────────────
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

//         const session = await client.connect();
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
//       if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
//       if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
//     };
//   }, [connectionKey, config.serviceUrl, config.token]);

//   // ── Actions ──────────────────────────────────────────────────────────────────
//   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
//     if (!clientRef.current || !state.session) throw new Error('Chat not initialized');

//     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
//     const optimistic: ChatMessage = {
//       id: tempId,
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

//     // One-shot listener: replaces optimistic when server echo arrives
//     const replaceOptimistic: EventCallback = (raw: unknown) => {
//       const msg = raw as ChatMessage;
//       if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
//         dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
//         pendingReplaces.current.delete(content);
//         clientRef.current?.off?.('message', replaceOptimistic);
//       }
//     };
//     clientRef.current.on('message', replaceOptimistic);

//     // Safety cleanup after 10s
//     setTimeout(() => {
//       clientRef.current?.off?.('message', replaceOptimistic);
//       pendingReplaces.current.delete(content);
//     }, 10_000);
//   }, [state.session]);

//   const startTyping  = useCallback(() => {
//     console.log('[Chat:TYPING] startTyping() called');
//     clientRef.current?.startTyping?.();
//   }, []);

//   const stopTyping   = useCallback(() => {
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
//           'X-Tenant-ID': cfg.tenantId,
//           'X-App-ID': cfg.appId,
//           'Content-Type': 'application/json',
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

//   const actions: ChatSDKActions = { sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect };

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
//   config:   ChatSDKConfig,
//   sessionId: string,
//   dispatch: React.Dispatch<ChatAction>,
// ): Promise<void> {
//   try {
//     const res = await fetch(
//       `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
//       {
//         headers: {
//           'Authorization': `Bearer ${config.token}`,
//           'X-Tenant-ID': config.tenantId,
//           'X-App-ID':    config.appId,
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

//     dispatch({ type: 'SET_MESSAGES', messages });
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
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'REPLACE_TEMP'; tempId: string; message: ChatMessage }
  | { type: 'SET_TYPING'; isTyping: boolean; typingUser?: string }
  | { type: 'UPDATE_SESSION'; session: Partial<ChatSDKState['session']> }
  | { type: 'SET_ERROR'; error: Error | null };

const initialState: ChatSDKState = {
  initialized: false,
  connected:   false,
  loading:     true,
  session:     null,
  messages:    [],
  isTyping:    false,
  typingUser:  undefined,
  error:       null,
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
      return { ...state, messages: [...state.messages, action.message] };
    }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };

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
  const connectionKey     = `${config.appId}:${config.user?.id}`;
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

        let session = await client.connect();

        // ── CLOSED session guard ─────────────────────────────────────────────
        // If the backend returns a CLOSED session (e.g. customer previously
        // ended chat and "Start New Chat" remounted the provider), create a
        // fresh session via REST and switch the WS socket to its room.
        if (session.status === 'CLOSED') {
          console.log('[Chat] Got CLOSED session — creating fresh session via REST');
          try {
            const cfg = configRef.current;
            const res = await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions`, {
              method:  'POST',
              headers: {
                'Authorization': `Bearer ${cfg.token}`,
                'X-Tenant-ID':   cfg.tenantId,
                'X-App-ID':      cfg.appId,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({
                appId:         cfg.appId,
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
  const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT') => {
    if (!clientRef.current || !state.session) throw new Error('Chat not initialized');

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
    };

    pendingReplaces.current.set(content, tempId);
    dispatch({ type: 'ADD_MESSAGE', message: optimistic });
    clientRef.current.sendMessage(content, type);

    const replaceOptimistic: EventCallback = (raw: unknown) => {
      const msg = raw as ChatMessage;
      if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
        dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
        pendingReplaces.current.delete(content);
        clientRef.current?.off?.('message', replaceOptimistic);
      }
    };
    clientRef.current.on('message', replaceOptimistic);

    setTimeout(() => {
      clientRef.current?.off?.('message', replaceOptimistic);
      pendingReplaces.current.delete(content);
    }, 10_000);
  }, [state.session]);

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
      await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${state.session.id}/close`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'X-App-ID':      cfg.appId,
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

  const actions: ChatSDKActions = {
    sendMessage, startTyping, stopTyping, closeSession, requestAgent, reconnect,
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
      `${config.serviceUrl}/api/v1/chat/sessions/${sessionId}/full`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Tenant-ID':   config.tenantId,
          'X-App-ID':      config.appId,
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
      };
    });

    dispatch({ type: 'SET_MESSAGES', messages });
  } catch (e) {
    console.error('[Chat] fetchMessages failed:', e);
  }
}