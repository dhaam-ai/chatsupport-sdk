


// import React, {
//   createContext, useContext, useReducer, useEffect, useCallback, useRef,
// } from 'react';
// import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, ChatSessionSummary, MessageType } from './types';
// import { ChatWebSocketClient } from './client';

// type EventCallback = (...args: unknown[]) => void;

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
//   | { type: 'SET_WIDGET_OPEN'; open: boolean }
//   | { type: 'SET_UPLOADING'; uploading: boolean }
//   | { type: 'SET_PAST_SESSIONS'; sessions: ChatSessionSummary[] }
//   | { type: 'UPDATE_PAST_SESSION'; sessionId: string; updates: Partial<ChatSessionSummary> }
//   | { type: 'SET_AGENT_READ_AT'; readAt: Date }
//   | { type: 'SET_CLOSE_REASON'; reason: string | null };

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
//   uploading:    false,
//   pastSessions: [],
//   agentReadAt:  null,
//   closeReason:  null,
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

//     case 'SET_WIDGET_OPEN':
//       return {
//         ...state,
//         isWidgetOpen: action.open,
//         unreadCount:  action.open ? 0 : state.unreadCount,
//       };

//     case 'SET_UPLOADING':
//       return { ...state, uploading: action.uploading };

//     case 'SET_PAST_SESSIONS':
//       return { ...state, pastSessions: action.sessions };

//     case 'UPDATE_PAST_SESSION':
//       return {
//         ...state,
//         pastSessions: state.pastSessions.map(s =>
//           s.id === action.sessionId ? { ...s, ...action.updates } : s
//         ),
//       };

//     case 'SET_AGENT_READ_AT':
//       return { ...state, agentReadAt: action.readAt };

//     case 'SET_CLOSE_REASON':
//       return { ...state, closeReason: action.reason };

//     default:
//       return state;
//   }
// }

// interface ChatContextValue {
//   state:   ChatSDKState;
//   actions: ChatSDKActions;
//   config:  ChatSDKConfig | null;
// }
// const ChatContext = createContext<ChatContextValue | null>(null);

// const _activeConnections = new Map<string, boolean>();

// export function ChatProvider({ config, children }: {
//   config:   ChatSDKConfig;
//   children: React.ReactNode;
// }): JSX.Element {
//   const [state, dispatch] = useReducer(chatReducer, initialState);
//   const clientRef         = useRef<ChatWebSocketClient | null>(null);
//   const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const connectionKey     = `${config.tenantId}:${config.user?.id}`;
//   const configRef         = useRef<ChatSDKConfig>(config);
//   useEffect(() => { configRef.current = config; });

//   const pendingReplaces      = useRef<Map<string, string>>(new Map());
//   const pendingAttachTempIds = useRef<Set<string>>(new Set());

//   const stateRef = useRef(state);
//   useEffect(() => { stateRef.current = state; }, [state]);

//   const lastTypingDispatch = useRef<{ isTyping: boolean; time: number } | null>(null);

//   useEffect(() => {
//     if (_activeConnections.get(connectionKey)) return;
//     _activeConnections.set(connectionKey, true);

//     const initChat = async () => {
//       dispatch({ type: 'INIT_START' });
//       try {
//         const cfg    = configRef.current;
//         const client = new ChatWebSocketClient(cfg);
//         clientRef.current = client;

//         client.on('message', (msg: unknown) => {
//           const message = msg as ChatMessage;
//           if (message.senderType === 'CUSTOMER' && !message.id.startsWith('temp-')) {
//             if (pendingReplaces.current.has(message.content)) {
//               console.log('[Chat] Skipping text echo — replaceOptimistic will handle:', message.id);
//               return;
//             }
//             if (pendingAttachTempIds.current.size > 0) {
//               console.log('[Chat] Skipping attachment echo — replaceOptimistic will handle:', message.id);
//               return;
//             }
//           }
//           dispatch({ type: 'ADD_MESSAGE', message });
//         });

//         client.on('typing', ((rawData: any) => {
//           const isTyping   = rawData?.isTyping ?? false;
//           const senderId   = rawData?.senderId ?? '';
//           const rawSender  = rawData?.senderType ?? rawData?.sender_type ?? '';
//           const senderType = String(rawSender).toUpperCase().trim();

//           console.log(`%c[Chat:TYPING] 📨 event received`, 'color:#f59e0b;font-weight:bold',
//             { isTyping, senderId, senderType, raw: rawData?.senderType });

//           if (senderType === 'CUSTOMER') {
//             console.log('[Chat:TYPING] Skipping — explicit CUSTOMER echo');
//             return;
//           }

//           const now  = Date.now();
//           const last = lastTypingDispatch.current;
//           if (last !== null && last.isTyping === isTyping && (now - last.time) < 300) {
//             console.log(`%c[Chat:TYPING] Suppressed same-value duplicate (${isTyping}) within 300ms`, 'color:#9ca3af');
//             return;
//           }

//           lastTypingDispatch.current = { isTyping, time: now };
//           if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
//           dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });

//           if (isTyping) {
//             typingTimerRef.current = setTimeout(() => {
//               dispatch({ type: 'SET_TYPING', isTyping: false });
//               typingTimerRef.current     = null;
//               lastTypingDispatch.current = null;
//             }, 5000);
//           } else {
//             lastTypingDispatch.current = null;
//           }
//         }) as EventCallback);

//         client.on('statusChange', ((data: any) => {
//           dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
//           dispatch({
//             type:      'UPDATE_PAST_SESSION',
//             sessionId: data.chatSessionId,
//             updates:   { status: data.status, mode: data.mode, closedAt: null },
//           });
//           if (data.status === 'CLOSED' && data.closeReason) {
//             dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
//           }
//         }) as EventCallback);

//         client.on('agentJoined', ((data: any) => {
//           dispatch({
//             type: 'UPDATE_SESSION',
//             session: {
//               assignedAgentId:   data.agentId,
//               assignedAgentName: data.agentName,
//               assignedAgent: data.agentName ? {
//                 displayName: data.agentName,
//                 email:       data.agentEmail || null,
//                 avatarUrl:   data.avatarUrl  || null,
//                 isOnline:    true,
//               } : undefined,
//               mode:   'HUMAN',
//               status: 'ASSIGNED',
//             },
//           });
//         }) as EventCallback);

//         client.on('sessionClosed', ((data: any) => {
//           if (data?.closeReason) {
//             dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
//           }
//         }) as EventCallback);

//         client.on('disconnect', () => {
//           console.log('[Chat] Disconnected — disabling input until reconnect ACK');
//           dispatch({ type: 'SET_CONNECTED', connected: false });
//         });

//         // ── Reconnect: re-enable UI and recover any messages missed during the gap ──
//         // The poll has been removed. Instead we do one targeted fetch here so any
//         // messages that arrived while the socket was down are merged in immediately.
//         client.on('reconnect', () => {
//           console.log('[Chat] Transport reconnected — re-enabling input');
//           dispatch({ type: 'SET_CONNECTED', connected: true });
//           const sid = stateRef.current.session?.id;
//           if (sid && !stateRef.current.tokenExpired) {
//             console.log('[Chat] Fetching missed messages after reconnect for session:', sid);
//             fetchMessages(configRef.current, sid, dispatch, true).catch(() => {});
//           }
//         });

//         client.on('connectionAck', ((data: any) => {
//           console.log('[Chat] connectionAck received — ensuring connected=true', data);
//           dispatch({ type: 'SET_CONNECTED', connected: true });
//           if (data?.status || data?.mode) {
//             dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
//           }
//         }) as EventCallback);

//         client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));

//         client.on('tokenExpired', () => {
//           console.warn('[Chat] Token expired — blocking further messages');
//           dispatch({ type: 'TOKEN_EXPIRED' });
//         });

//         client.on('messageRead', ((data: any) => {
//           if (data?.readBy === 'AGENT' && data?.readAt) {
//             dispatch({ type: 'SET_AGENT_READ_AT', readAt: new Date(data.readAt) });
//           }
//         }) as EventCallback);

//         let session = await client.connect();

//         if (session.status === 'CLOSED') {
//           console.log('[Chat] Got CLOSED session — creating fresh session via REST');
//           try {
//             const cfg = configRef.current;
//             const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions`, {
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
//               const json      = await res.json();
//               const newId     = json.data?.sessionId ?? json.data?.id;
//               const newMode   = json.data?.mode      ?? 'BOT';
//               const newStatus = json.data?.status    ?? 'OPEN';
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

//         await fetchMessages(configRef.current, session.id, dispatch, false);
//         dispatch({ type: 'INIT_SUCCESS', session });
//         configRef.current.callbacks?.onConnected?.(session.id);

//       } catch (error) {
//         _activeConnections.delete(connectionKey);
//         dispatch({ type: 'INIT_ERROR', error: error as Error });
//         configRef.current.callbacks?.onError?.(error as Error);
//       }
//     };

//     initChat();

//     // NOTE: The 10-second fallback poll has been intentionally removed.
//     // All messages arrive via WebSocket (MESSAGE_RECEIVE → client.on('message')).
//     // Gap recovery on reconnect is handled by the fetchMessages call in the
//     // 'reconnect' handler above — one targeted fetch beats polling indefinitely.

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

//   const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT', replyToMessageId?: string) => {
//     const s = stateRef.current;
//     if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
//     if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

//     const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
//     const optimistic: ChatMessage = {
//       id:            tempId,
//       chatSessionId: s.session.id,
//       senderType:    'CUSTOMER',
//       senderId:      configRef.current.user.id,
//       senderName:    configRef.current.user.name,
//       content,
//       messageType:   type,
//       timestamp:     new Date(),
//       ...(replyToMessageId ? { replyToMessageId } : {}),
//     };

//     pendingReplaces.current.set(content, tempId);
//     dispatch({ type: 'ADD_MESSAGE', message: optimistic });
//     clientRef.current.sendMessage(content, type, replyToMessageId);

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
//   }, []); // stable — reads live state via stateRef

//   const startTyping = useCallback(() => { clientRef.current?.startTyping?.(); }, []);
//   const stopTyping  = useCallback(() => { clientRef.current?.stopTyping?.();  }, []);

//   const requestAgent = useCallback(async (reason?: string) => {
//     clientRef.current?.requestAgent?.(reason);
//   }, []);

//   const closeSession = useCallback(async () => {
//     const session = stateRef.current.session;
//     if (!session) return;
//     const cfg = configRef.current;
//     try {
//       await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${session.id}/close`, {
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
//   }, []); // stable — reads live state via stateRef

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

//   // ── loadOlderMessages ────────────────────────────────────────────────────
//   // IMPORTANT: uses stateRef (not state) so this callback has a stable identity.
//   // If it depended on state.messages / state.session directly, it would get a
//   // new reference on every message arrival → the actions object would get a new
//   // reference → any effect in ChatWidget.tsx that depends on actions would
//   // re-run → fetchMessages('/full') would be called in a tight loop.
//   const loadOlderMessages = useCallback(async () => {
//     const s = stateRef.current;
//     if (!s.session || s.loadingMore || !s.hasMore) return;
//     const oldest = s.messages[0];
//     if (!oldest) return;

//     dispatch({ type: 'SET_LOADING_MORE', loading: true });
//     try {
//       const cfg = configRef.current;
//       const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
//       const res = await fetch(url, {
//         headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
//       });
//       if (!res.ok) { dispatch({ type: 'SET_LOADING_MORE', loading: false }); return; }
//       const json = await res.json();
//       const data = json.data ?? {};
//       const messages: ChatMessage[] = (data.messages ?? []).map((m: any) => {
//         const d = new Date(m.createdAt ?? m.timestamp);
//         return {
//           id:               m.id,
//           chatSessionId:    m.chatSessionId,
//           senderType:       m.senderType,
//           senderId:         m.senderId,
//           senderName:       m.senderName,
//           content:          m.content,
//           messageType:      m.messageType ?? 'TEXT',
//           timestamp:        isNaN(d.getTime()) ? new Date() : d,
//           metadata:         m.metadata,
//           attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
//           replyToMessageId: m.replyToMessageId ?? undefined,
//           replyToMessage:   m.replyToMessage   ?? undefined,
//         };
//       });
//       dispatch({ type: 'PREPEND_MESSAGES', messages, hasMore: data.hasMore ?? false });
//     } catch (err) {
//       console.error('[Chat] loadOlderMessages failed:', err);
//       dispatch({ type: 'SET_LOADING_MORE', loading: false });
//     }
//   }, []); // stable — reads live state via stateRef, config via configRef

//   const sendAttachment = useCallback(async (file: File) => {
//     const s = stateRef.current;
//     if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
//     if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

//     let optType: MessageType = 'FILE';
//     if (file.type.startsWith('image/'))       optType = 'IMAGE';
//     else if (file.type.startsWith('video/'))  optType = 'VIDEO';
//     else if (file.type.startsWith('audio/'))  optType = 'AUDIO';

//     const tempId = `temp-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
//     const optimistic: ChatMessage = {
//       id:            tempId,
//       chatSessionId: s.session.id,
//       senderType:    'CUSTOMER',
//       senderId:      configRef.current.user.id,
//       senderName:    configRef.current.user.name,
//       content:       file.name,
//       messageType:   optType,
//       timestamp:     new Date(),
//     };

//     dispatch({ type: 'SET_UPLOADING', uploading: true });
//     dispatch({ type: 'ADD_MESSAGE', message: optimistic });
//     pendingAttachTempIds.current.add(tempId);

//     try {
//       await clientRef.current.sendAttachment(file);
//       const replaceOptimistic: EventCallback = (raw: unknown) => {
//         const msg = raw as ChatMessage;
//         if (
//           msg.senderType === 'CUSTOMER' &&
//           !msg.id.startsWith('temp-') &&
//           (msg.messageType === optType || msg.messageType === 'FILE')
//         ) {
//           dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
//           pendingAttachTempIds.current.delete(tempId);
//           clientRef.current?.off?.('message', replaceOptimistic);
//         }
//       };
//       clientRef.current.on('message', replaceOptimistic);
//       setTimeout(() => {
//         clientRef.current?.off?.('message', replaceOptimistic);
//         pendingAttachTempIds.current.delete(tempId);
//       }, 15_000);
//     } catch (err) {
//       console.error('[Chat] Attachment upload failed:', err);
//       dispatch({ type: 'SET_ERROR', error: err as Error });
//     } finally {
//       dispatch({ type: 'SET_UPLOADING', uploading: false });
//     }
//   }, []); // stable — reads live state via stateRef

//   const fetchPastSessions = useCallback(async () => {
//     const cfg = configRef.current;
//     try {
//       const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/customer?tenantId=${encodeURIComponent(cfg.tenantId)}&customerId=${encodeURIComponent(cfg.user.id)}&limit=6`;
//       const res = await fetch(url, {
//         headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
//       });
//       if (!res.ok) return;
//       const json = await res.json();
//       dispatch({ type: 'SET_PAST_SESSIONS', sessions: json.data?.sessions ?? [] });
//     } catch (e) {
//       console.warn('[Chat] fetchPastSessions failed:', e);
//     }
//   }, []);

//   const reopenSession = useCallback(async (sessionId: string) => {
//     const cfg              = configRef.current;
//     const currentSessionId = stateRef.current.session?.id;
//     const currentStatus    = stateRef.current.session?.status;

//     if (currentSessionId && currentStatus !== 'CLOSED' && currentSessionId !== sessionId) {
//       try {
//         await fetch(
//           `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${currentSessionId}/close`,
//           {
//             method:  'POST',
//             headers: {
//               'Authorization': `Bearer ${cfg.token}`,
//               'X-Tenant-ID':   cfg.tenantId,
//               'Content-Type':  'application/json',
//             },
//             body: JSON.stringify({ customerId: cfg.user.id, closeReason: 'SWITCHED' }),
//           }
//         );
//         console.log('[Chat] Previous session put on hold:', currentSessionId);
//       } catch (e) {
//         console.warn('[Chat] Could not put previous session on hold:', e);
//       }

//       dispatch({
//         type: 'ADD_MESSAGE',
//         message: {
//           id:            `system-hold-${Date.now()}`,
//           chatSessionId: currentSessionId,
//           senderType:    'SYSTEM',
//           senderId:      'system',
//           content:       '⏸ Your chat has been put on hold because you switched to another session.',
//           messageType:   'TEXT',
//           timestamp:     new Date(),
//         } as any,
//       });

//       dispatch({ type: 'SET_CLOSE_REASON', reason: 'SWITCHED' });
//     }

//     const res = await fetch(
//       `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/reopen`,
//       {
//         method:  'POST',
//         headers: {
//           'Authorization': `Bearer ${cfg.token}`,
//           'X-Tenant-ID':   cfg.tenantId,
//           'Content-Type':  'application/json',
//         },
//         body: JSON.stringify({ customerId: cfg.user.id }),
//       },
//     );
//     if (!res.ok) throw new Error('Failed to reopen session');
//     const json = await res.json();
//     const data = json.data;

//     dispatch({ type: 'SET_CLOSE_REASON', reason: null });
//     clientRef.current?.joinSession(data.sessionId ?? sessionId);
//     dispatch({
//       type:    'INIT_SUCCESS',
//       session: { id: data.sessionId ?? sessionId, mode: 'HUMAN', status: 'WAITING_FOR_AGENT' },
//     });
//     dispatch({ type: 'SET_MESSAGES', messages: [], hasMore: false });
//     await fetchMessages(cfg, data.sessionId ?? sessionId, dispatch, false);

//     return { sessionId: data.sessionId ?? sessionId, status: data.status, mode: data.mode };
//   }, []);

//   const markMessagesRead = useCallback(async () => {
//     const s   = stateRef.current;
//     const cfg = configRef.current;
//     if (!s.session) return;
//     try {
//       await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/read`, {
//         method:  'POST',
//         headers: {
//           'Authorization': `Bearer ${cfg.token}`,
//           'X-Tenant-ID':   cfg.tenantId,
//           'Content-Type':  'application/json',
//         },
//         body: JSON.stringify({ customerId: cfg.user.id }),
//       });
//     } catch (e) {
//       console.warn('[Chat] markMessagesRead failed:', e);
//     }
//   }, []);

//   const actions: ChatSDKActions = {
//     sendMessage, sendAttachment, startTyping, stopTyping,
//     closeSession, requestAgent, reconnect, setWidgetOpen, loadOlderMessages,
//     fetchPastSessions, reopenSession, markMessagesRead,
//   };

//   return (
//     <ChatContext.Provider value={{ state, actions, config }}>
//       {children}
//     </ChatContext.Provider>
//   );
// }

// export function useChat() {
//   const ctx = useContext(ChatContext);
//   if (!ctx) throw new Error('useChat must be used within a ChatProvider');
//   return ctx;
// }
// export const useChatMessages = () => useChat().state.messages;
// export const useChatSession  = () => useChat().state.session;
// export const useChatActions  = () => useChat().actions;
// export const useChatState    = () => useChat().state;

// async function fetchMessages(
//   config:    ChatSDKConfig,
//   sessionId: string,
//   dispatch:  React.Dispatch<ChatAction>,
//   mergeOnly: boolean = false,
// ): Promise<void> {
//   try {
//     const res = await fetch(
//       `${config.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/full`,
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
//       const hasMediaContent = m.content && (
//         m.content.includes('/audio/') ||
//         m.content.includes('/video/') ||
//         /\.(mp3|wav|ogg|m4a|aac|mp4|webm|mov)(\?|$)/i.test(m.content)
//       );
//       if ((m.messageType && m.messageType !== 'TEXT') || hasMediaContent || m.metadata?.attachment) {
//         console.log('[Chat] fetchMessages MEDIA message RAW:', JSON.stringify(m, null, 2));
//       }
//       return {
//         id:               m.id,
//         chatSessionId:    m.chatSessionId,
//         senderType:       m.senderType,
//         senderId:         m.senderId,
//         senderName:       m.senderName,
//         content:          m.content,
//         messageType:      m.messageType ?? 'TEXT',
//         timestamp:        isNaN(d.getTime()) ? new Date() : d,
//         metadata:         m.metadata,
//         attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
//         replyToMessageId: m.replyToMessageId ?? undefined,
//         replyToMessage:   m.replyToMessage   ?? undefined,
//       };
//     });

//     const hasMore = data.data.hasMore ?? false;

//     if (mergeOnly) {
//       for (const msg of messages) {
//         dispatch({ type: 'ADD_MESSAGE', message: msg });
//       }
//     } else {
//       dispatch({ type: 'SET_MESSAGES', messages, hasMore });
//     }

//     const sess = data.data.session;
//     if (sess) {
//       dispatch({
//         type: 'UPDATE_SESSION',
//         session: {
//           ...(sess.assignedAgentId            && { assignedAgentId:   sess.assignedAgentId }),
//           ...(sess.assignedAgent              && { assignedAgent:     sess.assignedAgent }),
//           ...(sess.assignedAgent?.displayName && { assignedAgentName: sess.assignedAgent.displayName }),
//           ...(sess.customer                   && { customer:          sess.customer }),
//         },
//       });
//     }
//   } catch (e) {
//     console.error('[Chat] fetchMessages failed:', e);
//   }
// }



import React, {
  createContext, useContext, useReducer, useEffect, useCallback, useRef,
} from 'react';
import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, ChatSessionSummary, MessageType } from './types';
import { ChatWebSocketClient } from './client';

type EventCallback = (...args: unknown[]) => void;

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
  | { type: 'SET_WIDGET_OPEN'; open: boolean }
  | { type: 'SET_UPLOADING'; uploading: boolean }
  | { type: 'SET_PAST_SESSIONS'; sessions: ChatSessionSummary[] }
  | { type: 'UPDATE_PAST_SESSION'; sessionId: string; updates: Partial<ChatSessionSummary> }
  | { type: 'SET_AGENT_READ_AT'; readAt: Date }
  | { type: 'SET_CLOSE_REASON'; reason: string | null };

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
  uploading:    false,
  pastSessions: [],
  agentReadAt:  null,
  closeReason:  null,
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

    case 'SET_AGENT_READ_AT':
      return { ...state, agentReadAt: action.readAt };

    case 'SET_CLOSE_REASON':
      return { ...state, closeReason: action.reason };

    default:
      return state;
  }
}

interface ChatContextValue {
  state:   ChatSDKState;
  actions: ChatSDKActions;
  config:  ChatSDKConfig | null;
}
const ChatContext = createContext<ChatContextValue | null>(null);

const _activeConnections = new Map<string, boolean>();

// ── Map customer on first SDK init ────────────────────────────────────────────
// Registers or updates the customer on the ticketing platform (upsert).
// Fire-and-forget — any failure is logged as a warning and never blocks the chat.
async function mapCustomer(config: ChatSDKConfig): Promise<void> {
  try {
    console.log('%c[Chat] 🗺  mapCustomer → calling /customers/map', 'color:#7c3aed;font-weight:bold', {
      app_id:           config.tenantId,
      external_user_id: Number(config.user.id),
      username:         config.user.name,
      email:            config.user.email ?? '',
    });

    const res = await fetch('https://docs-dev.dhaamai.com/customers/map', {
      method: 'POST',
      headers: {
        'accept':        'application/json',
        'Authorization': `Bearer ${config.token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        app_id:           config.tenantId,
        external_user_id: Number(config.user.id),
        username:         config.user.name,
        email:            config.user.email ?? '',
        role_id:          4,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[Chat] mapCustomer failed:', res.status, body);
      return;
    }

    const data = await res.json();
    console.log('%c[Chat] ✅ mapCustomer success', 'color:#16a34a;font-weight:bold', data);
  } catch (e) {
    console.warn('[Chat] mapCustomer error (non-blocking):', e);
  }
}

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

  const pendingReplaces      = useRef<Map<string, string>>(new Map());
  const pendingAttachTempIds = useRef<Set<string>>(new Set());

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const lastTypingDispatch = useRef<{ isTyping: boolean; time: number } | null>(null);

  useEffect(() => {
    if (_activeConnections.get(connectionKey)) return;
    _activeConnections.set(connectionKey, true);

    const initChat = async () => {
      dispatch({ type: 'INIT_START' });
      try {
        const cfg    = configRef.current;
        const client = new ChatWebSocketClient(cfg);
        clientRef.current = client;

        client.on('message', (msg: unknown) => {
          const message = msg as ChatMessage;
          if (message.senderType === 'CUSTOMER' && !message.id.startsWith('temp-')) {
            if (pendingReplaces.current.has(message.content)) {
              console.log('[Chat] Skipping text echo — replaceOptimistic will handle:', message.id);
              return;
            }
            if (pendingAttachTempIds.current.size > 0) {
              console.log('[Chat] Skipping attachment echo — replaceOptimistic will handle:', message.id);
              return;
            }
          }
          dispatch({ type: 'ADD_MESSAGE', message });
        });

        client.on('typing', ((rawData: any) => {
          const isTyping   = rawData?.isTyping ?? false;
          const senderId   = rawData?.senderId ?? '';
          const rawSender  = rawData?.senderType ?? rawData?.sender_type ?? '';
          const senderType = String(rawSender).toUpperCase().trim();

          console.log(`%c[Chat:TYPING] 📨 event received`, 'color:#f59e0b;font-weight:bold',
            { isTyping, senderId, senderType, raw: rawData?.senderType });

          if (senderType === 'CUSTOMER') {
            console.log('[Chat:TYPING] Skipping — explicit CUSTOMER echo');
            return;
          }

          const now  = Date.now();
          const last = lastTypingDispatch.current;
          if (last !== null && last.isTyping === isTyping && (now - last.time) < 300) {
            console.log(`%c[Chat:TYPING] Suppressed same-value duplicate (${isTyping}) within 300ms`, 'color:#9ca3af');
            return;
          }

          lastTypingDispatch.current = { isTyping, time: now };
          if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
          dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });

          if (isTyping) {
            typingTimerRef.current = setTimeout(() => {
              dispatch({ type: 'SET_TYPING', isTyping: false });
              typingTimerRef.current     = null;
              lastTypingDispatch.current = null;
            }, 5000);
          } else {
            lastTypingDispatch.current = null;
          }
        }) as EventCallback);

        client.on('statusChange', ((data: any) => {
          dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
          dispatch({
            type:      'UPDATE_PAST_SESSION',
            sessionId: data.chatSessionId,
            updates:   { status: data.status, mode: data.mode, closedAt: null },
          });
          if (data.status === 'CLOSED' && data.closeReason) {
            dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
          }
        }) as EventCallback);

        client.on('agentJoined', ((data: any) => {
          dispatch({
            type: 'UPDATE_SESSION',
            session: {
              assignedAgentId:   data.agentId,
              assignedAgentName: data.agentName,
              assignedAgent: data.agentName ? {
                displayName: data.agentName,
                email:       data.agentEmail || null,
                avatarUrl:   data.avatarUrl  || null,
                isOnline:    true,
              } : undefined,
              mode:   'HUMAN',
              status: 'ASSIGNED',
            },
          });
        }) as EventCallback);

        client.on('sessionClosed', ((data: any) => {
          if (data?.closeReason) {
            dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
          }
        }) as EventCallback);

        client.on('disconnect', () => {
          console.log('[Chat] Disconnected — disabling input until reconnect ACK');
          dispatch({ type: 'SET_CONNECTED', connected: false });
        });

        client.on('reconnect', () => {
          console.log('[Chat] Transport reconnected — re-enabling input');
          dispatch({ type: 'SET_CONNECTED', connected: true });
          const sid = stateRef.current.session?.id;
          if (sid && !stateRef.current.tokenExpired) {
            console.log('[Chat] Fetching missed messages after reconnect for session:', sid);
            fetchMessages(configRef.current, sid, dispatch, true).catch(() => {});
          }
        });

        client.on('connectionAck', ((data: any) => {
          console.log('[Chat] connectionAck received — ensuring connected=true', data);
          dispatch({ type: 'SET_CONNECTED', connected: true });
          if (data?.status || data?.mode) {
            dispatch({ type: 'UPDATE_SESSION', session: { status: data.status, mode: data.mode } });
          }
        }) as EventCallback);

        client.on('error', (error: unknown) => dispatch({ type: 'SET_ERROR', error: error as Error }));

        client.on('tokenExpired', () => {
          console.warn('[Chat] Token expired — blocking further messages');
          dispatch({ type: 'TOKEN_EXPIRED' });
        });

        client.on('messageRead', ((data: any) => {
          if (data?.readBy === 'AGENT' && data?.readAt) {
            dispatch({ type: 'SET_AGENT_READ_AT', readAt: new Date(data.readAt) });
          }
        }) as EventCallback);

        let session = await client.connect();

        // ── Map customer immediately after connection is established ──────────
        // This is fire-and-forget. The chat initialisation continues in parallel.
        mapCustomer(cfg);

        if (session.status === 'CLOSED') {
          console.log('[Chat] Got CLOSED session — creating fresh session via REST');
          try {
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
              const json      = await res.json();
              const newId     = json.data?.sessionId ?? json.data?.id;
              const newMode   = json.data?.mode      ?? 'BOT';
              const newStatus = json.data?.status    ?? 'OPEN';
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

        await fetchMessages(configRef.current, session.id, dispatch, false);
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
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id:            tempId,
      chatSessionId: s.session.id,
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
  }, []);

  const startTyping = useCallback(() => { clientRef.current?.startTyping?.(); }, []);
  const stopTyping  = useCallback(() => { clientRef.current?.stopTyping?.();  }, []);

  const requestAgent = useCallback(async (reason?: string) => {
    clientRef.current?.requestAgent?.(reason);
  }, []);

  const closeSession = useCallback(async () => {
    const session = stateRef.current.session;
    if (!session) return;
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${session.id}/close`, {
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
  }, []);

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

  const loadOlderMessages = useCallback(async () => {
    const s = stateRef.current;
    if (!s.session || s.loadingMore || !s.hasMore) return;
    const oldest = s.messages[0];
    if (!oldest) return;

    dispatch({ type: 'SET_LOADING_MORE', loading: true });
    try {
      const cfg = configRef.current;
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
      });
      if (!res.ok) { dispatch({ type: 'SET_LOADING_MORE', loading: false }); return; }
      const json = await res.json();
      const data = json.data ?? {};
      const messages: ChatMessage[] = (data.messages ?? []).map((m: any) => {
        const d = new Date(m.createdAt ?? m.timestamp);
        return {
          id:               m.id,
          chatSessionId:    m.chatSessionId,
          senderType:       m.senderType,
          senderId:         m.senderId,
          senderName:       m.senderName,
          content:          m.content,
          messageType:      m.messageType ?? 'TEXT',
          timestamp:        isNaN(d.getTime()) ? new Date() : d,
          metadata:         m.metadata,
          attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
          replyToMessageId: m.replyToMessageId ?? undefined,
          replyToMessage:   m.replyToMessage   ?? undefined,
        };
      });
      dispatch({ type: 'PREPEND_MESSAGES', messages, hasMore: data.hasMore ?? false });
    } catch (err) {
      console.error('[Chat] loadOlderMessages failed:', err);
      dispatch({ type: 'SET_LOADING_MORE', loading: false });
    }
  }, []);

  const sendAttachment = useCallback(async (file: File) => {
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

    let optType: MessageType = 'FILE';
    if (file.type.startsWith('image/'))       optType = 'IMAGE';
    else if (file.type.startsWith('video/'))  optType = 'VIDEO';
    else if (file.type.startsWith('audio/'))  optType = 'AUDIO';

    const tempId = `temp-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id:            tempId,
      chatSessionId: s.session.id,
      senderType:    'CUSTOMER',
      senderId:      configRef.current.user.id,
      senderName:    configRef.current.user.name,
      content:       file.name,
      messageType:   optType,
      timestamp:     new Date(),
    };

    dispatch({ type: 'SET_UPLOADING', uploading: true });
    dispatch({ type: 'ADD_MESSAGE', message: optimistic });
    pendingAttachTempIds.current.add(tempId);

    try {
      await clientRef.current.sendAttachment(file);
      const replaceOptimistic: EventCallback = (raw: unknown) => {
        const msg = raw as ChatMessage;
        if (
          msg.senderType === 'CUSTOMER' &&
          !msg.id.startsWith('temp-') &&
          (msg.messageType === optType || msg.messageType === 'FILE')
        ) {
          dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
          pendingAttachTempIds.current.delete(tempId);
          clientRef.current?.off?.('message', replaceOptimistic);
        }
      };
      clientRef.current.on('message', replaceOptimistic);
      setTimeout(() => {
        clientRef.current?.off?.('message', replaceOptimistic);
        pendingAttachTempIds.current.delete(tempId);
      }, 15_000);
    } catch (err) {
      console.error('[Chat] Attachment upload failed:', err);
      dispatch({ type: 'SET_ERROR', error: err as Error });
    } finally {
      dispatch({ type: 'SET_UPLOADING', uploading: false });
    }
  }, []);

  const fetchPastSessions = useCallback(async () => {
    const cfg = configRef.current;
    try {
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/customer?tenantId=${encodeURIComponent(cfg.tenantId)}&customerId=${encodeURIComponent(cfg.user.id)}&limit=6`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
      });
      if (!res.ok) return;
      const json = await res.json();
      dispatch({ type: 'SET_PAST_SESSIONS', sessions: json.data?.sessions ?? [] });
    } catch (e) {
      console.warn('[Chat] fetchPastSessions failed:', e);
    }
  }, []);

  const reopenSession = useCallback(async (sessionId: string) => {
    const cfg              = configRef.current;
    const currentSessionId = stateRef.current.session?.id;
    const currentStatus    = stateRef.current.session?.status;

    if (currentSessionId && currentStatus !== 'CLOSED' && currentSessionId !== sessionId) {
      try {
        await fetch(
          `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${currentSessionId}/close`,
          {
            method:  'POST',
            headers: {
              'Authorization': `Bearer ${cfg.token}`,
              'X-Tenant-ID':   cfg.tenantId,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ customerId: cfg.user.id, closeReason: 'SWITCHED' }),
          }
        );
        console.log('[Chat] Previous session put on hold:', currentSessionId);
      } catch (e) {
        console.warn('[Chat] Could not put previous session on hold:', e);
      }

      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          id:            `system-hold-${Date.now()}`,
          chatSessionId: currentSessionId,
          senderType:    'SYSTEM',
          senderId:      'system',
          content:       '⏸ Your chat has been put on hold because you switched to another session.',
          messageType:   'TEXT',
          timestamp:     new Date(),
        } as any,
      });

      dispatch({ type: 'SET_CLOSE_REASON', reason: 'SWITCHED' });
    }

    const res = await fetch(
      `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/reopen`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ customerId: cfg.user.id }),
      },
    );
    if (!res.ok) throw new Error('Failed to reopen session');
    const json = await res.json();
    const data = json.data;

    dispatch({ type: 'SET_CLOSE_REASON', reason: null });
    clientRef.current?.joinSession(data.sessionId ?? sessionId);
    dispatch({
      type:    'INIT_SUCCESS',
      session: { id: data.sessionId ?? sessionId, mode: 'HUMAN', status: 'WAITING_FOR_AGENT' },
    });
    dispatch({ type: 'SET_MESSAGES', messages: [], hasMore: false });
    await fetchMessages(cfg, data.sessionId ?? sessionId, dispatch, false);

    return { sessionId: data.sessionId ?? sessionId, status: data.status, mode: data.mode };
  }, []);

  const markMessagesRead = useCallback(async () => {
    const s   = stateRef.current;
    const cfg = configRef.current;
    if (!s.session) return;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/read`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ customerId: cfg.user.id }),
      });
    } catch (e) {
      console.warn('[Chat] markMessagesRead failed:', e);
    }
  }, []);

  const actions: ChatSDKActions = {
    sendMessage, sendAttachment, startTyping, stopTyping,
    closeSession, requestAgent, reconnect, setWidgetOpen, loadOlderMessages,
    fetchPastSessions, reopenSession, markMessagesRead,
  };

  return (
    <ChatContext.Provider value={{ state, actions, config }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
export const useChatMessages = () => useChat().state.messages;
export const useChatSession  = () => useChat().state.session;
export const useChatActions  = () => useChat().actions;
export const useChatState    = () => useChat().state;

async function fetchMessages(
  config:    ChatSDKConfig,
  sessionId: string,
  dispatch:  React.Dispatch<ChatAction>,
  mergeOnly: boolean = false,
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
      const hasMediaContent = m.content && (
        m.content.includes('/audio/') ||
        m.content.includes('/video/') ||
        /\.(mp3|wav|ogg|m4a|aac|mp4|webm|mov)(\?|$)/i.test(m.content)
      );
      if ((m.messageType && m.messageType !== 'TEXT') || hasMediaContent || m.metadata?.attachment) {
        console.log('[Chat] fetchMessages MEDIA message RAW:', JSON.stringify(m, null, 2));
      }
      return {
        id:               m.id,
        chatSessionId:    m.chatSessionId,
        senderType:       m.senderType,
        senderId:         m.senderId,
        senderName:       m.senderName,
        content:          m.content,
        messageType:      m.messageType ?? 'TEXT',
        timestamp:        isNaN(d.getTime()) ? new Date() : d,
        metadata:         m.metadata,
        attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
        replyToMessageId: m.replyToMessageId ?? undefined,
        replyToMessage:   m.replyToMessage   ?? undefined,
      };
    });

    const hasMore = data.data.hasMore ?? false;

    if (mergeOnly) {
      for (const msg of messages) {
        dispatch({ type: 'ADD_MESSAGE', message: msg });
      }
    } else {
      dispatch({ type: 'SET_MESSAGES', messages, hasMore });
    }

    const sess = data.data.session;
    if (sess) {
      dispatch({
        type: 'UPDATE_SESSION',
        session: {
          ...(sess.assignedAgentId            && { assignedAgentId:   sess.assignedAgentId }),
          ...(sess.assignedAgent              && { assignedAgent:     sess.assignedAgent }),
          ...(sess.assignedAgent?.displayName && { assignedAgentName: sess.assignedAgent.displayName }),
          ...(sess.customer                   && { customer:          sess.customer }),
        },
      });
    }
  } catch (e) {
    console.error('[Chat] fetchMessages failed:', e);
  }
}