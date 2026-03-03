// // // ==========================================
// // // Chat SDK - WebSocket Client — TYPING FIX (DEFINITIVE)
// // //
// // // BUGS FIXED IN THIS VERSION:
// // //
// // // BUG 1 [RECEIVING AGENT TYPING]: client.ts only had one typing listener:
// // //   socket.on(WS_EVENTS.TYPING_INDICATOR, ...)
// // //   But the server broadcasts under BOTH 'TYPING_INDICATOR' and 'TYPING'.
// // //   If WS_EVENTS.TYPING_INDICATOR resolves to something OTHER than 'TYPING_INDICATOR'
// // //   (e.g. 'TYPING_INDICATOR' the string IS correct but the server's original constant
// // //   WS_EVENTS.TYPING might be 'TYPING' which old client never listened to).
// // //   FIX: listen on ALL FOUR possible event names:
// // //     'TYPING_INDICATOR', 'TYPING', 'TYPING_START', 'TYPING_STOP'
// // //   This guarantees we catch it regardless of what the server sends.
// // //
// // // BUG 2 [SENDING TYPING]: startTyping() / stopTyping() did NOT include isTyping
// // //   in the payload alongside chatSessionId. The server's broadcastTyping reads
// // //   data.isTyping to determine the state. Without it, isTyping defaults to false
// // //   and the agent always sees "stopped typing".
// // //   FIX: emit { chatSessionId, isTyping: true/false } explicitly.
// // //
// // // LOGGING: All typing events (sent and received) are logged with [ChatClient:TYPING].
// // // ==========================================

// // import { io, Socket } from 'socket.io-client';
// // import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType } from './types';
// // import { WS_EVENTS } from './types';

// // type EventCallback = (...args: unknown[]) => void;

// // // ── Normalize raw WS payload → ChatMessage ────────────────────────────────────
// // function normalizeMessage(raw: any, sessionId: string): ChatMessage | null {
// //   if (!raw) return null;
// //   const id = raw.id ?? raw.messageId ?? raw.message_id;
// //   if (!id) {
// //     console.warn('[ChatClient] Dropping message with no id:', raw);
// //     return null;
// //   }
// //   const rawTime = raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt;
// //   let timestamp: Date;
// //   if (rawTime instanceof Date)     { timestamp = rawTime; }
// //   else if (rawTime)                { const d = new Date(rawTime); timestamp = isNaN(d.getTime()) ? new Date() : d; }
// //   else                             { timestamp = new Date(); }

// //   return {
// //     id,
// //     chatSessionId: raw.chatSessionId ?? raw.chat_session_id ?? sessionId,
// //     senderType:    raw.senderType    ?? raw.sender_type    ?? 'SYSTEM',
// //     senderId:      raw.senderId      ?? raw.sender_id      ?? '',
// //     senderName:    raw.senderName    ?? raw.sender_name,
// //     content:       raw.content       ?? raw.text           ?? '',
// //     messageType:   raw.messageType   ?? raw.message_type   ?? 'TEXT',
// //     timestamp,
// //     metadata:      raw.metadata,
// //   };
// // }

// // export class ChatWebSocketClient {
// //   private socket: Socket | null = null;
// //   private config: ChatSDKConfig;
// //   private eventHandlers: Map<string, Set<EventCallback>> = new Map();
// //   private reconnectAttempts    = 0;
// //   private maxReconnectAttempts = 5;
// //   private reconnectDelay       = 1000;

// //   public session:   ChatSession | null = null;
// //   public connected  = false;

// //   constructor(config: ChatSDKConfig) { this.config = config; }

// //   async connect(): Promise<ChatSession> {
// //     return new Promise((resolve, reject) => {
// //       try {
// //         let wsUrl: string;
// //         if (this.config.wsUrl) {
// //           wsUrl = this.config.wsUrl;
// //         } else {
// //           wsUrl = this.config.serviceUrl;
// //           if (wsUrl.includes(':3000')) wsUrl = wsUrl.replace(':3000', ':3001');
// //         }

// //         console.log('%c[ChatClient] 🔌 Connecting →', 'color:#5b4fcf;font-weight:bold', wsUrl);

// //         this.socket = io(wsUrl, {
// //           auth: {
// //             token:     this.config.token,
// //             tenantId:  this.config.tenantId,
// //             userId:    this.config.user.id,
// //             userName:  this.config.user.name,
// //             userEmail: this.config.user.email ?? '',
// //             // No userRole = server treats as CUSTOMER (correct)
// //           },
// //           transports: ['websocket', 'polling'],
// //           reconnection: true,
// //           reconnectionAttempts: this.maxReconnectAttempts,
// //           reconnectionDelay:    this.reconnectDelay,
// //         });

// //         // ── DEBUG: log every raw Socket.IO event ──────────────────────────────
// //         this.socket.onAny((eventName: string, ...args: any[]) => {
// //           console.log(
// //             `%c[ChatClient] 📨 Raw event: "${eventName}"`,
// //             'color:#059669;font-weight:bold',
// //             args[0]
// //           );
// //         });

// //         let connectionAckReceived = false;

// //         // ── CONNECTION_ACK ────────────────────────────────────────────────────
// //         this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: any) => {
// //           connectionAckReceived = true;
// //           this.connected        = true;
// //           this.reconnectAttempts = 0;

// //           const sessionId = data.chatSessionId ?? data.sessionIds?.[0];
// //           console.log(
// //             '%c[ChatClient] ✅ CONNECTION_ACK',
// //             'color:#16a34a;font-weight:bold',
// //             { sessionId, mode: data.mode, status: data.status }
// //           );

// //           if (sessionId) {
// //             this.session = { id: sessionId, mode: data.mode, status: data.status };
// //             this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
// //             resolve(this.session);
// //           } else {
// //             reject(new Error('No session ID in CONNECTION_ACK'));
// //           }
// //         });

// //         this.socket.on('connect', () => {
// //           console.log('%c[ChatClient] 📡 Transport connected', 'color:#0ea5e9;font-weight:bold');
// //         });

// //         // ── MESSAGE_RECEIVE ────────────────────────────────────────────────────
// //         this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw: any) => {
// //           const message = normalizeMessage(raw, this.session?.id ?? '');
// //           if (!message) return;
// //           console.log('[ChatClient] MESSAGE_RECEIVE →', message.senderType, message.content.slice(0, 50));
// //           this.emit('message', message);
// //           this.config.callbacks?.onMessage?.(message);
// //         });

// //         // ── TYPING — FIX: listen on ALL possible event names ──────────────────
// //         // The server broadcasts 'TYPING_INDICATOR' AND 'TYPING'.
// //         // We must listen on both to be safe regardless of server config.
// //         // Also keep 'TYPING_START'/'TYPING_STOP' for backward compatibility.

// //         const handleTypingEvent = (data: any, sourceEvent: string) => {
// //           const isTyping   = data?.isTyping   ?? false;
// //           const senderId   = data?.senderId   ?? '';
// //           const senderType = data?.senderType ?? 'AGENT';

// //           console.log(
// //             `%c[ChatClient:TYPING] 🖊 Received "${sourceEvent}"`,
// //             'color:#f59e0b;font-weight:bold',
// //             { isTyping, senderId, senderType, rawData: data }
// //           );

// //           this.emit('typing', { isTyping, senderId, senderType });
// //         };

// //         // 'TYPING_INDICATOR' — primary event name used by server
// //         this.socket.on('TYPING_INDICATOR', (d: any) => handleTypingEvent(d, 'TYPING_INDICATOR'));

// //         // 'TYPING' — secondary event name also broadcast by server (WS_EVENTS.TYPING)
// //         this.socket.on('TYPING', (d: any) => handleTypingEvent(d, 'TYPING'));

// //         // Legacy event names (some server versions use these)
// //         this.socket.on('TYPING_START', (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: true  }, 'TYPING_START'));
// //         this.socket.on('TYPING_STOP',  (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: false }, 'TYPING_STOP'));

// //         // Also handle via WS_EVENTS constant in case it differs from string literal
// //         if ((WS_EVENTS.TYPING_INDICATOR as string) !== 'TYPING_INDICATOR') {
// //           console.warn('[ChatClient] WS_EVENTS.TYPING_INDICATOR ≠ "TYPING_INDICATOR":', WS_EVENTS.TYPING_INDICATOR);
// //           this.socket.on(WS_EVENTS.TYPING_INDICATOR as string, (d: any) => handleTypingEvent(d, `WS_EVENTS.TYPING_INDICATOR(${WS_EVENTS.TYPING_INDICATOR})`));
// //         }

// //         // ── AGENT_JOINED ───────────────────────────────────────────────────────
// //         this.socket.on(WS_EVENTS.AGENT_JOINED, (data: any) => {
// //           console.log('[ChatClient] AGENT_JOINED:', data);
// //           if (this.session) {
// //             this.session.assignedAgentId   = data.agentId;
// //             this.session.assignedAgentName = data.agentName;
// //           }
// //           this.emit('agentJoined', data);
// //           this.config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
// //         });

// //         this.socket.on(WS_EVENTS.AGENT_LEFT, (data: any) => {
// //           this.emit('agentLeft', data);
// //           this.config.callbacks?.onAgentLeft?.(data.agentId);
// //         });

// //         // ── STATUS_CHANGED ─────────────────────────────────────────────────────
// //         this.socket.on(WS_EVENTS.STATUS_CHANGED, (data: any) => {
// //           if (this.session) { this.session.mode = data.mode; this.session.status = data.status; }
// //           this.emit('statusChange', data);
// //           this.config.callbacks?.onStatusChange?.(data.status, data.mode);
// //         });

// //         this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
// //           if (this.session) this.session.status = 'CLOSED';
// //           this.emit('sessionClosed', {});
// //           this.config.callbacks?.onSessionClosed?.();
// //         });

// //         // ── ERRORS ─────────────────────────────────────────────────────────────
// //         this.socket.on(WS_EVENTS.ERROR, (error: any) => {
// //           const err = new Error(error.message ?? String(error));
// //           this.emit('error', err);
// //           this.config.callbacks?.onError?.(err);
// //         });

// //         this.socket.on('connect_error', (error: any) => {
// //           this.connected = false;
// //           this.reconnectAttempts++;
// //           console.error(
// //             `[ChatClient] ❌ Connect error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`,
// //             error?.message
// //           );
// //           this.emit('error', error);
// //           if (this.reconnectAttempts >= this.maxReconnectAttempts && !connectionAckReceived) {
// //             reject(error);
// //           }
// //         });

// //         this.socket.on('disconnect', (reason: string) => {
// //           console.warn('[ChatClient] ⚠️  Disconnected:', reason);
// //           this.connected = false;
// //           this.emit('disconnect', { reason });
// //         });

// //         this.socket.on('reconnect', () => {
// //           this.connected         = true;
// //           this.reconnectAttempts = 0;
// //           if (this.session) this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
// //           this.emit('reconnect', {});
// //         });

// //       } catch (error) {
// //         reject(error);
// //       }
// //     });
// //   }

// //   sendMessage(content: string, messageType: MessageType = 'TEXT'): void {
// //     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
// //     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
// //       chatSessionId: this.session.id,
// //       content,
// //       messageType,
// //     });
// //   }

// //   // FIX: include isTyping: true/false explicitly in the payload.
// //   // Server's broadcastTyping() reads data.isTyping — without it defaults to false,
// //   // so agent always sees typing=false even when customer is actively typing.
// //   startTyping(): void {
// //     if (!this.socket || !this.connected || !this.session) return;
// //     const payload = { chatSessionId: this.session.id, isTyping: true };
// //     console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_START', 'color:#f59e0b;font-weight:bold', payload);
// //     this.socket.emit(WS_EVENTS.TYPING_START, payload);
// //     // Also emit TYPING_INDICATOR for servers that only listen on that
// //     this.socket.emit('TYPING_INDICATOR', payload);
// //   }

// //   stopTyping(): void {
// //     if (!this.socket || !this.connected || !this.session) return;
// //     const payload = { chatSessionId: this.session.id, isTyping: false };
// //     console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_STOP', 'color:#6b7280;font-weight:bold', payload);
// //     this.socket.emit(WS_EVENTS.TYPING_STOP, payload);
// //     this.socket.emit('TYPING_INDICATOR', payload);
// //   }

// //   requestAgent(reason?: string): void {
// //     if (this.socket && this.connected && this.session) {
// //       this.socket.emit(WS_EVENTS.REQUEST_AGENT, { chatSessionId: this.session.id, reason });
// //     }
// //   }

// //   // Switch the socket to a different session room.
// //   // Used when the session returned by CONNECTION_ACK is CLOSED and a fresh one
// //   // was created via REST — we leave the old room and join the new one.
// //   joinSession(sessionId: string): void {
// //     if (!this.socket || !this.connected) return;
// //     if (this.session?.id && this.session.id !== sessionId) {
// //       this.socket.emit(WS_EVENTS.LEAVE_SESSION, { chatSessionId: this.session.id });
// //     }
// //     this.socket.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
// //     if (this.session) {
// //       this.session = { ...this.session, id: sessionId, status: 'OPEN' };
// //     }
// //   }

// //   disconnect(): void {
// //     if (this.socket) { this.socket.disconnect(); this.socket = null; }
// //     this.connected = false;
// //     this.session   = null;
// //   }

// //   on(event: string, callback: EventCallback): () => void {
// //     if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
// //     this.eventHandlers.get(event)!.add(callback);
// //     return () => this.off(event, callback);
// //   }

// //   off(event: string, callback: EventCallback): void {
// //     this.eventHandlers.get(event)?.delete(callback);
// //   }

// //   private emit(event: string, data: unknown): void {
// //     this.eventHandlers.get(event)?.forEach(cb => {
// //       try { cb(data); }
// //       catch (e) { console.error(`[ChatClient] Handler error for "${event}":`, e); }
// //     });
// //   }
// // }


// // ==========================================
// // Chat SDK - WebSocket Client — TYPING FIX (DEFINITIVE)
// //
// // BUGS FIXED IN THIS VERSION:
// //
// // BUG 1 [RECEIVING AGENT TYPING]: client.ts only had one typing listener:
// //   socket.on(WS_EVENTS.TYPING_INDICATOR, ...)
// //   But the server broadcasts under BOTH 'TYPING_INDICATOR' and 'TYPING'.
// //   If WS_EVENTS.TYPING_INDICATOR resolves to something OTHER than 'TYPING_INDICATOR'
// //   (e.g. 'TYPING_INDICATOR' the string IS correct but the server's original constant
// //   WS_EVENTS.TYPING might be 'TYPING' which old client never listened to).
// //   FIX: listen on ALL FOUR possible event names:
// //     'TYPING_INDICATOR', 'TYPING', 'TYPING_START', 'TYPING_STOP'
// //   This guarantees we catch it regardless of what the server sends.
// //
// // BUG 2 [SENDING TYPING]: startTyping() / stopTyping() did NOT include isTyping
// //   in the payload alongside chatSessionId. The server's broadcastTyping reads
// //   data.isTyping to determine the state. Without it, isTyping defaults to false
// //   and the agent always sees "stopped typing".
// //   FIX: emit { chatSessionId, isTyping: true/false } explicitly.
// //
// // LOGGING: All typing events (sent and received) are logged with [ChatClient:TYPING].
// // ==========================================

// import { io, Socket } from 'socket.io-client';
// import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType } from './types';
// import { WS_EVENTS } from './types';

// type EventCallback = (...args: unknown[]) => void;

// // ── Normalize raw WS payload → ChatMessage ────────────────────────────────────
// function normalizeMessage(raw: any, sessionId: string): ChatMessage | null {
//   if (!raw) return null;
//   const id = raw.id ?? raw.messageId ?? raw.message_id;
//   if (!id) {
//     console.warn('[ChatClient] Dropping message with no id:', raw);
//     return null;
//   }
//   const rawTime = raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt;
//   let timestamp: Date;
//   if (rawTime instanceof Date)     { timestamp = rawTime; }
//   else if (rawTime)                { const d = new Date(rawTime); timestamp = isNaN(d.getTime()) ? new Date() : d; }
//   else                             { timestamp = new Date(); }

//   return {
//     id,
//     chatSessionId: raw.chatSessionId ?? raw.chat_session_id ?? sessionId,
//     senderType:    raw.senderType    ?? raw.sender_type    ?? 'SYSTEM',
//     senderId:      raw.senderId      ?? raw.sender_id      ?? '',
//     senderName:    raw.senderName    ?? raw.sender_name,
//     content:       raw.content       ?? raw.text           ?? '',
//     messageType:   raw.messageType   ?? raw.message_type   ?? 'TEXT',
//     timestamp,
//     metadata:      raw.metadata,
//   };
// }

// export class ChatWebSocketClient {
//   private socket: Socket | null = null;
//   private config: ChatSDKConfig;
//   private eventHandlers: Map<string, Set<EventCallback>> = new Map();
//   private reconnectAttempts    = 0;
//   private maxReconnectAttempts = 5;
//   private reconnectDelay       = 1000;

//   public session:       ChatSession | null = null;
//   public connected      = false;
//   public tokenExpired   = false;

//   constructor(config: ChatSDKConfig) { this.config = config; }

//   async connect(): Promise<ChatSession> {
//     return new Promise((resolve, reject) => {
//       try {
//         let wsUrl: string;
//         if (this.config.wsUrl) {
//           wsUrl = this.config.wsUrl;
//         } else {
//           wsUrl = this.config.serviceUrl;
//           if (wsUrl.includes(':3000')) wsUrl = wsUrl.replace(':3000', ':3001');
//         }

//         console.log('%c[ChatClient] 🔌 Connecting →', 'color:#5b4fcf;font-weight:bold', wsUrl);

//         this.socket = io(wsUrl, {
//           auth: {
//             token:     this.config.token,
//             tenantId:  this.config.tenantId,
//             userId:    this.config.user.id,
//             userName:  this.config.user.name,
//             userEmail: this.config.user.email ?? '',
//             // No userRole = server treats as CUSTOMER (correct)
//           },
//           transports: ['websocket', 'polling'],
//           reconnection: true,
//           reconnectionAttempts: this.maxReconnectAttempts,
//           reconnectionDelay:    this.reconnectDelay,
//         });

//         // ── DEBUG: log every raw Socket.IO event ──────────────────────────────
//         this.socket.onAny((eventName: string, ...args: any[]) => {
//           console.log(
//             `%c[ChatClient] 📨 Raw event: "${eventName}"`,
//             'color:#059669;font-weight:bold',
//             args[0]
//           );
//         });

//         let connectionAckReceived = false;

//         // ── CONNECTION_ACK ────────────────────────────────────────────────────
//         this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: any) => {
//           connectionAckReceived = true;
//           this.connected        = true;
//           this.reconnectAttempts = 0;

//           const sessionId = data.chatSessionId ?? data.sessionIds?.[0];
//           console.log(
//             '%c[ChatClient] ✅ CONNECTION_ACK',
//             'color:#16a34a;font-weight:bold',
//             { sessionId, mode: data.mode, status: data.status }
//           );

//           if (sessionId) {
//             this.session = { id: sessionId, mode: data.mode, status: data.status };
//             this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
//             resolve(this.session);
//           } else {
//             reject(new Error('No session ID in CONNECTION_ACK'));
//           }
//         });

//         this.socket.on('connect', () => {
//           console.log('%c[ChatClient] 📡 Transport connected', 'color:#0ea5e9;font-weight:bold');
//         });

//         // ── MESSAGE_RECEIVE ────────────────────────────────────────────────────
//         this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw: any) => {
//           const message = normalizeMessage(raw, this.session?.id ?? '');
//           if (!message) return;
//           console.log('[ChatClient] MESSAGE_RECEIVE →', message.senderType, message.content.slice(0, 50));
//           this.emit('message', message);
//           this.config.callbacks?.onMessage?.(message);
//         });

//         // ── TYPING — FIX: listen on ALL possible event names ──────────────────
//         // The server broadcasts 'TYPING_INDICATOR' AND 'TYPING'.
//         // We must listen on both to be safe regardless of server config.
//         // Also keep 'TYPING_START'/'TYPING_STOP' for backward compatibility.

//         const handleTypingEvent = (data: any, sourceEvent: string) => {
//           const isTyping   = data?.isTyping   ?? false;
//           const senderId   = data?.senderId   ?? '';
//           const senderType = data?.senderType ?? 'AGENT';

//           console.log(
//             `%c[ChatClient:TYPING] 🖊 Received "${sourceEvent}"`,
//             'color:#f59e0b;font-weight:bold',
//             { isTyping, senderId, senderType, rawData: data }
//           );

//           this.emit('typing', { isTyping, senderId, senderType });
//         };

//         // 'TYPING_INDICATOR' — primary event name used by server
//         this.socket.on('TYPING_INDICATOR', (d: any) => handleTypingEvent(d, 'TYPING_INDICATOR'));

//         // 'TYPING' — secondary event name also broadcast by server (WS_EVENTS.TYPING)
//         this.socket.on('TYPING', (d: any) => handleTypingEvent(d, 'TYPING'));

//         // Legacy event names (some server versions use these)
//         this.socket.on('TYPING_START', (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: true  }, 'TYPING_START'));
//         this.socket.on('TYPING_STOP',  (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: false }, 'TYPING_STOP'));

//         // Also handle via WS_EVENTS constant in case it differs from string literal
//         if ((WS_EVENTS.TYPING_INDICATOR as string) !== 'TYPING_INDICATOR') {
//           console.warn('[ChatClient] WS_EVENTS.TYPING_INDICATOR ≠ "TYPING_INDICATOR":', WS_EVENTS.TYPING_INDICATOR);
//           this.socket.on(WS_EVENTS.TYPING_INDICATOR as string, (d: any) => handleTypingEvent(d, `WS_EVENTS.TYPING_INDICATOR(${WS_EVENTS.TYPING_INDICATOR})`));
//         }

//         // ── AGENT_JOINED ───────────────────────────────────────────────────────
//         this.socket.on(WS_EVENTS.AGENT_JOINED, (data: any) => {
//           console.log('[ChatClient] AGENT_JOINED:', data);
//           if (this.session) {
//             this.session.assignedAgentId   = data.agentId;
//             this.session.assignedAgentName = data.agentName;
//           }
//           this.emit('agentJoined', data);
//           this.config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
//         });

//         this.socket.on(WS_EVENTS.AGENT_LEFT, (data: any) => {
//           this.emit('agentLeft', data);
//           this.config.callbacks?.onAgentLeft?.(data.agentId);
//         });

//         // ── STATUS_CHANGED ─────────────────────────────────────────────────────
//         this.socket.on(WS_EVENTS.STATUS_CHANGED, (data: any) => {
//           if (this.session) { this.session.mode = data.mode; this.session.status = data.status; }
//           this.emit('statusChange', data);
//           this.config.callbacks?.onStatusChange?.(data.status, data.mode);
//         });

//         this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
//           if (this.session) this.session.status = 'CLOSED';
//           this.emit('sessionClosed', {});
//           this.config.callbacks?.onSessionClosed?.();
//         });

//         // ── ERRORS ─────────────────────────────────────────────────────────────
//         this.socket.on(WS_EVENTS.ERROR, (error: any) => {
//           const err = new Error(error.message ?? String(error));
//           this.emit('error', err);
//           this.config.callbacks?.onError?.(err);
//         });

//         this.socket.on('connect_error', (error: any) => {
//           this.connected = false;
//           this.reconnectAttempts++;
//           const msg = error?.message ?? '';
//           console.error(
//             `[ChatClient] ❌ Connect error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`,
//             msg
//           );

//           // ── TOKEN_EXPIRED: stop reconnecting, notify widget ────────────────
//           if (msg === 'TOKEN_EXPIRED' || msg.toLowerCase().includes('expired')) {
//             this.tokenExpired = true;
//             this.socket?.disconnect();  // stop auto-reconnect
//             console.warn('[ChatClient] ⚠️ Token expired — blocking further messages');
//             this.emit('tokenExpired', { message: 'Your session has expired. Please refresh to continue.' });
//             if (!connectionAckReceived) {
//               reject(new Error('TOKEN_EXPIRED'));
//             }
//             return;
//           }

//           this.emit('error', error);
//           if (this.reconnectAttempts >= this.maxReconnectAttempts && !connectionAckReceived) {
//             reject(error);
//           }
//         });

//         this.socket.on('disconnect', (reason: string) => {
//           console.warn('[ChatClient] ⚠️  Disconnected:', reason);
//           this.connected = false;
//           this.emit('disconnect', { reason });
//         });

//         this.socket.on('reconnect', () => {
//           this.connected         = true;
//           this.reconnectAttempts = 0;
//           if (this.session) this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
//           this.emit('reconnect', {});
//         });

//       } catch (error) {
//         reject(error);
//       }
//     });
//   }

//   sendMessage(content: string, messageType: MessageType = 'TEXT'): void {
//     if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
//     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
//     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
//       chatSessionId: this.session.id,
//       content,
//       messageType,
//     });
//   }

//   // FIX: include isTyping: true/false explicitly in the payload.
//   // Server's broadcastTyping() reads data.isTyping — without it defaults to false,
//   // so agent always sees typing=false even when customer is actively typing.
//   startTyping(): void {
//     if (!this.socket || !this.connected || !this.session) return;
//     const payload = { chatSessionId: this.session.id, isTyping: true };
//     console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_START', 'color:#f59e0b;font-weight:bold', payload);
//     this.socket.emit(WS_EVENTS.TYPING_START, payload);
//     // Also emit TYPING_INDICATOR for servers that only listen on that
//     this.socket.emit('TYPING_INDICATOR', payload);
//   }

//   stopTyping(): void {
//     if (!this.socket || !this.connected || !this.session) return;
//     const payload = { chatSessionId: this.session.id, isTyping: false };
//     console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_STOP', 'color:#6b7280;font-weight:bold', payload);
//     this.socket.emit(WS_EVENTS.TYPING_STOP, payload);
//     this.socket.emit('TYPING_INDICATOR', payload);
//   }

//   requestAgent(reason?: string): void {
//     if (this.socket && this.connected && this.session) {
//       this.socket.emit(WS_EVENTS.REQUEST_AGENT, { chatSessionId: this.session.id, reason });
//     }
//   }

//   // Switch the socket to a different session room.
//   // Used when the session returned by CONNECTION_ACK is CLOSED and a fresh one
//   // was created via REST — we leave the old room and join the new one.
//   joinSession(sessionId: string): void {
//     if (!this.socket || !this.connected) return;
//     if (this.session?.id && this.session.id !== sessionId) {
//       this.socket.emit(WS_EVENTS.LEAVE_SESSION, { chatSessionId: this.session.id });
//     }
//     this.socket.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
//     if (this.session) {
//       this.session = { ...this.session, id: sessionId, status: 'OPEN' };
//     }
//   }

//   disconnect(): void {
//     if (this.socket) { this.socket.disconnect(); this.socket = null; }
//     this.connected = false;
//     this.session   = null;
//   }

//   on(event: string, callback: EventCallback): () => void {
//     if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
//     this.eventHandlers.get(event)!.add(callback);
//     return () => this.off(event, callback);
//   }

//   off(event: string, callback: EventCallback): void {
//     this.eventHandlers.get(event)?.delete(callback);
//   }

//   private emit(event: string, data: unknown): void {
//     this.eventHandlers.get(event)?.forEach(cb => {
//       try { cb(data); }
//       catch (e) { console.error(`[ChatClient] Handler error for "${event}":`, e); }
//     });
//   }
// }


// ==========================================
// Chat SDK - WebSocket Client — TYPING FIX (DEFINITIVE)
//
// BUGS FIXED IN THIS VERSION:
//
// BUG 1 [RECEIVING AGENT TYPING]: client.ts only had one typing listener:
//   socket.on(WS_EVENTS.TYPING_INDICATOR, ...)
//   But the server broadcasts under BOTH 'TYPING_INDICATOR' and 'TYPING'.
//   If WS_EVENTS.TYPING_INDICATOR resolves to something OTHER than 'TYPING_INDICATOR'
//   (e.g. 'TYPING_INDICATOR' the string IS correct but the server's original constant
//   WS_EVENTS.TYPING might be 'TYPING' which old client never listened to).
//   FIX: listen on ALL FOUR possible event names:
//     'TYPING_INDICATOR', 'TYPING', 'TYPING_START', 'TYPING_STOP'
//   This guarantees we catch it regardless of what the server sends.
//
// BUG 2 [SENDING TYPING]: startTyping() / stopTyping() did NOT include isTyping
//   in the payload alongside chatSessionId. The server's broadcastTyping reads
//   data.isTyping to determine the state. Without it, isTyping defaults to false
//   and the agent always sees "stopped typing".
//   FIX: emit { chatSessionId, isTyping: true/false } explicitly.
//
// LOGGING: All typing events (sent and received) are logged with [ChatClient:TYPING].
// ==========================================

import { io, Socket } from 'socket.io-client';
import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType, FileAttachment } from './types';
import { WS_EVENTS } from './types';

type EventCallback = (...args: unknown[]) => void;

// ── Normalize raw WS payload → ChatMessage ────────────────────────────────────
function normalizeMessage(raw: any, sessionId: string): ChatMessage | null {
  if (!raw) return null;
  const id = raw.id ?? raw.messageId ?? raw.message_id;
  if (!id) {
    console.warn('[ChatClient] Dropping message with no id:', raw);
    return null;
  }
  const rawTime = raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt;
  let timestamp: Date;
  if (rawTime instanceof Date)     { timestamp = rawTime; }
  else if (rawTime)                { const d = new Date(rawTime); timestamp = isNaN(d.getTime()) ? new Date() : d; }
  else                             { timestamp = new Date(); }

  return {
    id,
    chatSessionId: raw.chatSessionId ?? raw.chat_session_id ?? sessionId,
    senderType:    raw.senderType    ?? raw.sender_type    ?? 'SYSTEM',
    senderId:      raw.senderId      ?? raw.sender_id      ?? '',
    senderName:    raw.senderName    ?? raw.sender_name,
    content:       raw.content       ?? raw.text           ?? '',
    messageType:   raw.messageType   ?? raw.message_type   ?? 'TEXT',
    timestamp,
    metadata:      raw.metadata,
    attachment:    raw.attachment ?? raw.metadata?.attachment ?? undefined,
  };
}

export class ChatWebSocketClient {
  private socket: Socket | null = null;
  private config: ChatSDKConfig;
  private eventHandlers: Map<string, Set<EventCallback>> = new Map();
  private reconnectAttempts    = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay       = 1000;

  public session:       ChatSession | null = null;
  public connected      = false;
  public tokenExpired   = false;

  constructor(config: ChatSDKConfig) { this.config = config; }

  async connect(): Promise<ChatSession> {
    return new Promise((resolve, reject) => {
      try {
        let wsUrl: string;
        if (this.config.wsUrl) {
          wsUrl = this.config.wsUrl;
        } else {
          wsUrl = this.config.serviceUrl;
          if (wsUrl.includes(':3000')) wsUrl = wsUrl.replace(':3000', ':3001');
        }

        console.log('%c[ChatClient] 2.0🔌 Connecting →', 'color:#5b4fcf;font-weight:bold', wsUrl);

        this.socket = io(wsUrl, {
          auth: {
            token:     this.config.token,
            tenantId:  this.config.tenantId,
            userId:    this.config.user.id,
            userName:  this.config.user.name,
            userEmail: this.config.user.email ?? '',
            // No userRole = server treats as CUSTOMER (correct)
          },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay:    this.reconnectDelay,
        });

        // ── DEBUG: log every raw Socket.IO event ──────────────────────────────
        this.socket.onAny((eventName: string, ...args: any[]) => {
          console.log(
            `%c[ChatClient] 📨 Raw event: "${eventName}"`,
            'color:#059669;font-weight:bold',
            args[0]
          );
        });

        let connectionAckReceived = false;

        // ── CONNECTION_ACK ────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: any) => {
          connectionAckReceived = true;
          this.connected        = true;
          this.reconnectAttempts = 0;

          const sessionId = data.chatSessionId ?? data.sessionIds?.[0];
          console.log(
            '%c[ChatClient] ✅ CONNECTION_ACK',
            'color:#16a34a;font-weight:bold',
            { sessionId, mode: data.mode, status: data.status }
          );

          if (sessionId) {
            this.session = { id: sessionId, mode: data.mode, status: data.status };
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
            resolve(this.session);
          } else {
            reject(new Error('No session ID in CONNECTION_ACK'));
          }
        });

        this.socket.on('connect', () => {
          console.log('%c[ChatClient] 📡 Transport connected', 'color:#0ea5e9;font-weight:bold');
        });

        // ── MESSAGE_RECEIVE ────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw: any) => {
          const message = normalizeMessage(raw, this.session?.id ?? '');
          if (!message) return;
          console.log('[ChatClient] MESSAGE_RECEIVE →', message.senderType, message.content.slice(0, 50));
          this.emit('message', message);
          this.config.callbacks?.onMessage?.(message);
        });

        // ── TYPING — FIX: listen on ALL possible event names ──────────────────
        // The server broadcasts 'TYPING_INDICATOR' AND 'TYPING'.
        // We must listen on both to be safe regardless of server config.
        // Also keep 'TYPING_START'/'TYPING_STOP' for backward compatibility.

        const handleTypingEvent = (data: any, sourceEvent: string) => {
          const isTyping   = data?.isTyping   ?? false;
          const senderId   = data?.senderId   ?? '';
          const senderType = data?.senderType ?? 'AGENT';

          console.log(
            `%c[ChatClient:TYPING] 🖊 Received "${sourceEvent}"`,
            'color:#f59e0b;font-weight:bold',
            { isTyping, senderId, senderType, rawData: data }
          );

          this.emit('typing', { isTyping, senderId, senderType });
        };

        // 'TYPING_INDICATOR' — primary event name used by server
        this.socket.on('TYPING_INDICATOR', (d: any) => handleTypingEvent(d, 'TYPING_INDICATOR'));

        // 'TYPING' — secondary event name also broadcast by server (WS_EVENTS.TYPING)
        this.socket.on('TYPING', (d: any) => handleTypingEvent(d, 'TYPING'));

        // Legacy event names (some server versions use these)
        this.socket.on('TYPING_START', (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: true  }, 'TYPING_START'));
        this.socket.on('TYPING_STOP',  (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: false }, 'TYPING_STOP'));

        // Also handle via WS_EVENTS constant in case it differs from string literal
        if ((WS_EVENTS.TYPING_INDICATOR as string) !== 'TYPING_INDICATOR') {
          console.warn('[ChatClient] WS_EVENTS.TYPING_INDICATOR ≠ "TYPING_INDICATOR":', WS_EVENTS.TYPING_INDICATOR);
          this.socket.on(WS_EVENTS.TYPING_INDICATOR as string, (d: any) => handleTypingEvent(d, `WS_EVENTS.TYPING_INDICATOR(${WS_EVENTS.TYPING_INDICATOR})`));
        }

        // ── AGENT_JOINED ───────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.AGENT_JOINED, (data: any) => {
          console.log('[ChatClient] AGENT_JOINED:', data);
          if (this.session) {
            this.session.assignedAgentId   = data.agentId;
            this.session.assignedAgentName = data.agentName;
          }
          this.emit('agentJoined', data);
          this.config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
        });

        this.socket.on(WS_EVENTS.AGENT_LEFT, (data: any) => {
          this.emit('agentLeft', data);
          this.config.callbacks?.onAgentLeft?.(data.agentId);
        });

        // ── STATUS_CHANGED ─────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.STATUS_CHANGED, (data: any) => {
          if (this.session) { this.session.mode = data.mode; this.session.status = data.status; }
          this.emit('statusChange', data);
          this.config.callbacks?.onStatusChange?.(data.status, data.mode);
        });

        this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
          if (this.session) this.session.status = 'CLOSED';
          this.emit('sessionClosed', {});
          this.config.callbacks?.onSessionClosed?.();
        });

        // ── ERRORS ─────────────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.ERROR, (error: any) => {
          const err = new Error(error.message ?? String(error));
          this.emit('error', err);
          this.config.callbacks?.onError?.(err);
        });

        this.socket.on('connect_error', (error: any) => {
          this.connected = false;
          this.reconnectAttempts++;
          const msg = error?.message ?? '';
          console.error(
            `[ChatClient] ❌ Connect error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`,
            msg
          );

          // ── TOKEN_EXPIRED: stop reconnecting, notify widget ────────────────
          if (msg === 'TOKEN_EXPIRED' || msg.toLowerCase().includes('expired')) {
            this.tokenExpired = true;
            this.socket?.disconnect();  // stop auto-reconnect
            console.warn('[ChatClient] ⚠️ Token expired — blocking further messages');
            this.emit('tokenExpired', { message: 'Your session has expired. Please refresh to continue.' });
            if (!connectionAckReceived) {
              reject(new Error('TOKEN_EXPIRED'));
            }
            return;
          }

          this.emit('error', error);
          if (this.reconnectAttempts >= this.maxReconnectAttempts && !connectionAckReceived) {
            reject(error);
          }
        });

        this.socket.on('disconnect', (reason: string) => {
          console.warn('[ChatClient] ⚠️  Disconnected:', reason);
          this.connected = false;
          this.emit('disconnect', { reason });
        });

        this.socket.on('reconnect', () => {
          this.connected         = true;
          this.reconnectAttempts = 0;
          if (this.session) this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
          this.emit('reconnect', {});
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  sendMessage(content: string, messageType: MessageType = 'TEXT'): void {
    if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
    if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType,
    });
  }

  /**
   * Upload a file to S3 via the chat-service REST API and send it as a message.
   */
  async sendAttachment(file: File): Promise<void> {
    if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
    if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatSessionId', this.session.id);
    if (this.config.tenantId) {
      formData.append('tenantId', this.config.tenantId);
    }

    // Determine the REST base URL
    let baseUrl = this.config.serviceUrl;
    // If pointing at WS port, switch to REST port
    if (baseUrl.includes(':3001')) baseUrl = baseUrl.replace(':3001', ':3000');

    console.log('[ChatClient] 📎 Uploading attachment:', file.name, file.type, file.size);

    const response = await fetch(`${baseUrl}/api/v1/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
      throw new Error(err.error?.message || 'File upload failed');
    }

    const result = await response.json();
    const uploadData = result.data;

    // Determine message type from media type
    let messageType: MessageType = 'FILE';
    if (uploadData.mediaType === 'images') messageType = 'IMAGE';
    else if (uploadData.mediaType === 'videos') messageType = 'VIDEO';
    else if (uploadData.mediaType === 'audio') messageType = 'AUDIO';

    // Send as a chat message with attachment metadata
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content: uploadData.url,
      messageType,
      metadata: {
        attachment: {
          url: uploadData.url,
          fileName: uploadData.fileName,
          mimeType: uploadData.mimeType,
          size: uploadData.size,
          mediaType: uploadData.mediaType,
        } as FileAttachment,
      },
    });

    console.log('[ChatClient] ✅ Attachment sent:', uploadData.url);
  }

  // FIX: include isTyping: true/false explicitly in the payload.
  // Server's broadcastTyping() reads data.isTyping — without it defaults to false,
  // so agent always sees typing=false even when customer is actively typing.
  startTyping(): void {
    if (!this.socket || !this.connected || !this.session) return;
    const payload = { chatSessionId: this.session.id, isTyping: true };
    console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_START', 'color:#f59e0b;font-weight:bold', payload);
    this.socket.emit(WS_EVENTS.TYPING_START, payload);
    // Also emit TYPING_INDICATOR for servers that only listen on that
    this.socket.emit('TYPING_INDICATOR', payload);
  }

  stopTyping(): void {
    if (!this.socket || !this.connected || !this.session) return;
    const payload = { chatSessionId: this.session.id, isTyping: false };
    console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_STOP', 'color:#6b7280;font-weight:bold', payload);
    this.socket.emit(WS_EVENTS.TYPING_STOP, payload);
    this.socket.emit('TYPING_INDICATOR', payload);
  }

  requestAgent(reason?: string): void {
    if (this.socket && this.connected && this.session) {
      this.socket.emit(WS_EVENTS.REQUEST_AGENT, { chatSessionId: this.session.id, reason });
    }
  }

  // Switch the socket to a different session room.
  // Used when the session returned by CONNECTION_ACK is CLOSED and a fresh one
  // was created via REST — we leave the old room and join the new one.
  joinSession(sessionId: string): void {
    if (!this.socket || !this.connected) return;
    if (this.session?.id && this.session.id !== sessionId) {
      this.socket.emit(WS_EVENTS.LEAVE_SESSION, { chatSessionId: this.session.id });
    }
    this.socket.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
    if (this.session) {
      this.session = { ...this.session, id: sessionId, status: 'OPEN' };
    }
  }

  disconnect(): void {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this.connected = false;
    this.session   = null;
  }

  on(event: string, callback: EventCallback): () => void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: EventCallback): void {
    this.eventHandlers.get(event)?.delete(callback);
  }

  private emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach(cb => {
      try { cb(data); }
      catch (e) { console.error(`[ChatClient] Handler error for "${event}":`, e); }
    });
  }
}