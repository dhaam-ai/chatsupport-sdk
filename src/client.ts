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

// import { io, Socket } from 'socket.io-client';
// import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType, FileAttachment } from './types';
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
//     attachment:    raw.attachment ?? raw.metadata?.attachment ?? undefined,
//     replyToMessageId: raw.replyToMessageId ?? raw.reply_to_message_id ?? undefined,
//     replyToMessage:   raw.replyToMessage ?? raw.reply_to_message ?? undefined,
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

//         console.log('%c[ChatClient] 🔌 Connecting 2 →', 'color:#5b4fcf;font-weight:bold', wsUrl);

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
//           console.log('%c[ChatClient] 📡 Transport connected 3', 'color:#0ea5e9;font-weight:bold');
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

//   sendMessage(content: string, messageType: MessageType = 'TEXT', replyToMessageId?: string): void {
//     if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
//     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
//     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
//       chatSessionId: this.session.id,
//       content,
//       messageType,
//       ...(replyToMessageId ? { replyToMessageId } : {}),
//     });
//   }

//   /**
//    * Upload a file to S3 via the chat-service REST API and send it as a message.
//    */
//   async sendAttachment(file: File): Promise<void> {
//     if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
//     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');

//     const formData = new FormData();
//     formData.append('file', file);
//     formData.append('chatSessionId', this.session.id);
//     if (this.config.tenantId) {
//       formData.append('tenantId', this.config.tenantId);
//     }

//     // Determine the REST base URL:
//     // 1. Explicit apiUrl (highest priority)
//     // 2. serviceUrl with :3001→:3000 port swap
//     let baseUrl = this.config.apiUrl ?? this.config.serviceUrl;
//     if (baseUrl.includes(':3001')) baseUrl = baseUrl.replace(':3001', ':3000');
//     // Strip trailing slash
//     baseUrl = baseUrl.replace(/\/+$/, '');

//     console.log('[ChatClient] 📎 Uploading attachment:', file.name, file.type, file.size, '→', `${baseUrl}/chat-services/api/v1/upload`);

//     const response = await fetch(`${baseUrl}/chat-services/api/v1/upload`, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${this.config.token}`,
//       },
//       body: formData,
//     });

//     if (!response.ok) {
//       const err = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
//       throw new Error(err.error?.message || 'File upload failed');
//     }

//     const result = await response.json();
//     const uploadData = result.data;

//     // Determine message type from media type
//     let messageType: MessageType = 'FILE';
//     if (uploadData.mediaType === 'images') messageType = 'IMAGE';
//     else if (uploadData.mediaType === 'videos') messageType = 'VIDEO';
//     else if (uploadData.mediaType === 'audio') messageType = 'AUDIO';

//     // Send as a chat message with attachment metadata
//     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
//       chatSessionId: this.session.id,
//       content: uploadData.url,
//       messageType,
//       metadata: {
//         attachment: {
//           url: uploadData.url,
//           fileName: uploadData.fileName,
//           mimeType: uploadData.mimeType,
//           size: uploadData.size,
//           mediaType: uploadData.mediaType,
//         } as FileAttachment,
//       },
//     });

//     console.log('[ChatClient] ✅ Attachment sent:', uploadData.url);
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







// import { io, Socket } from 'socket.io-client';
// import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType, FileAttachment } from './types';
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
//     attachment:    raw.attachment ?? raw.metadata?.attachment ?? undefined,
//     replyToMessageId: raw.replyToMessageId ?? raw.reply_to_message_id ?? undefined,
//     replyToMessage:   raw.replyToMessage ?? raw.reply_to_message ?? undefined,
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

//         // Parse wsUrl so socket.io-client receives the host and the path
//         // separately. If the path is passed as part of the URL string,
//         // socket.io-client interprets it as a namespace and silently falls
//         // back to the default '/socket.io' path — causing a CSP/connection error.
//         const parsedWsUrl  = new URL(wsUrl);
//         const socketPath   = parsedWsUrl.pathname !== '/' ? parsedWsUrl.pathname : '/socket.io';
//         // Normalize to https:// — socket.io-client needs an HTTP(S) origin for
//         // the initial polling handshake. Using wss:// as the origin breaks the
//         // polling transport. socket.io-client automatically upgrades to wss://
//         // for the WebSocket transport after the session is negotiated.
//         const socketOrigin = `${parsedWsUrl.host}`
//           ? `https://${parsedWsUrl.host}`
//           : parsedWsUrl.origin;

//         console.log('%c[ChatClient] 🔌 Connecting →', 'color:#5b4fcf;font-weight:bold', socketOrigin, '| path:', socketPath);

//         // ── TOKEN DEBUG LOG ───────────────────────────────────────────────────
//         const token = this.config.token;
//         console.log(
//           '%c[ChatClient] 🔑 Token being sent',
//           'color:#7c3aed;font-weight:bold',
//           {
//             present:     !!token,
//             length:      token?.length ?? 0,
//             prefix:      token ? token.slice(0, 30) + '...' : '(empty)',
//             tenantId:    this.config.tenantId,
//             userId:      this.config.user.id,
//             userName:    this.config.user.name,
//             userEmail:   this.config.user.email ?? '',
//           }
//         );

//         if (!token) {
//           console.error('[ChatClient] ❌ No token provided — server will reject with 401');
//         }

//         // Build query params — only include a key when it has a value so
//         // socket.io-client doesn't append "undefined" or empty strings to the URL.
//         const socketQuery: Record<string, string> = {};
//         if (token)                     socketQuery.token    = token;
//         if (this.config.tenantId)      socketQuery.tenantId = this.config.tenantId;
//         if (this.config.user.id)       socketQuery.userId   = this.config.user.id;

//         // Log the exact URL the WS will connect to so we can verify token presence.
//         const debugUrl = `wss://${parsedWsUrl.host}${socketPath}?EIO=4&transport=websocket&` +
//           new URLSearchParams(socketQuery).toString();
//         console.log('%c[ChatClient] 🌐 Final WS URL →', 'color:#0ea5e9;font-weight:bold', debugUrl);

//         this.socket = io(socketOrigin, {
//           path: socketPath,
//           auth: {
//             token:     this.config.token,
//             tenantId:  this.config.tenantId,
//             userId:    this.config.user.id,
//             userName:  this.config.user.name,
//             userEmail: this.config.user.email ?? '',
//             // No userRole = server treats as CUSTOMER (correct)
//           },
//           // Also pass token + tenantId as query params so the server can read
//           // them from socket.handshake.query as a fallback when the WS auth
//           // header is stripped by a proxy/ingress.
//           query: socketQuery,
//           // Use WebSocket-only transport to avoid "Session ID unknown" (code 1) errors.
//           //
//           // When running behind a load balancer (e.g. Kubernetes Ingress), the
//           // polling transport sends multiple independent HTTP requests that can
//           // land on *different* backend pods. Only the pod that handled the
//           // initial handshake knows the session SID → every other pod returns
//           // 400 "Session ID unknown".
//           //
//           // WebSocket opens a single persistent TCP connection, so all frames
//           // travel through one pod and sticky-session requirements disappear.
//           transports: ['websocket'],
//           upgrade: false,          // don't attempt upgrade; we're already on WS
//           withCredentials: false,  // don't send cookies; avoids CORS preflight credential issues
//           forceNew: true,          // don't reuse a cached manager from a previous failed connection
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
//           console.log('%c[ChatClient] 📡 Transport connected 3', 'color:#0ea5e9;font-weight:bold');
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

//   sendMessage(content: string, messageType: MessageType = 'TEXT', replyToMessageId?: string): void {
//     if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
//     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
//     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
//       chatSessionId: this.session.id,
//       content,
//       messageType,
//       ...(replyToMessageId ? { replyToMessageId } : {}),
//     });
//   }

//   /**
//    * Upload a file to S3 via the chat-service REST API and send it as a message.
//    */
//   async sendAttachment(file: File): Promise<void> {
//     if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
//     if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');

//     const formData = new FormData();
//     formData.append('file', file);
//     formData.append('chatSessionId', this.session.id);
//     if (this.config.tenantId) {
//       formData.append('tenantId', this.config.tenantId);
//     }

//     // Determine the REST base URL:
//     // 1. Explicit apiUrl (highest priority)
//     // 2. serviceUrl with :3001→:3000 port swap
//     let baseUrl = this.config.apiUrl ?? this.config.serviceUrl;
//     if (baseUrl.includes(':3001')) baseUrl = baseUrl.replace(':3001', ':3000');
//     // Strip trailing slash
//     baseUrl = baseUrl.replace(/\/+$/, '');

//     console.log('[ChatClient] 📎 Uploading attachment:', file.name, file.type, file.size, '→', `${baseUrl}/chat-services/api/v1/upload`);

//     const response = await fetch(`${baseUrl}/chat-services/api/v1/upload`, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${this.config.token}`,
//       },
//       body: formData,
//     });

//     if (!response.ok) {
//       const err = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
//       throw new Error(err.error?.message || 'File upload failed');
//     }

//     const result = await response.json();
//     const uploadData = result.data;

//     // Determine message type from media type
//     let messageType: MessageType = 'FILE';
//     if (uploadData.mediaType === 'images') messageType = 'IMAGE';
//     else if (uploadData.mediaType === 'videos') messageType = 'VIDEO';
//     else if (uploadData.mediaType === 'audio') messageType = 'AUDIO';

//     // Send as a chat message with attachment metadata
//     this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
//       chatSessionId: this.session.id,
//       content: uploadData.url,
//       messageType,
//       metadata: {
//         attachment: {
//           url: uploadData.url,
//           fileName: uploadData.fileName,
//           mimeType: uploadData.mimeType,
//           size: uploadData.size,
//           mediaType: uploadData.mediaType,
//         } as FileAttachment,
//       },
//     });

//     console.log('[ChatClient] ✅ Attachment sent:', uploadData.url);
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
    replyToMessageId: raw.replyToMessageId ?? raw.reply_to_message_id ?? undefined,
    replyToMessage:   raw.replyToMessage ?? raw.reply_to_message ?? undefined,
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

        const parsedWsUrl  = new URL(wsUrl);
        const socketPath   = parsedWsUrl.pathname !== '/' ? parsedWsUrl.pathname : '/socket.io';
        const socketOrigin = `${parsedWsUrl.host}`
          ? `https://${parsedWsUrl.host}`
          : parsedWsUrl.origin;

        console.log('%c[ChatClient] 🔌 Connecting →', 'color:#5b4fcf;font-weight:bold', socketOrigin, '| path:', socketPath);

        const token = this.config.token;
        console.log(
          '%c[ChatClient] 🔑 Token being sent',
          'color:#7c3aed;font-weight:bold',
          {
            present:     !!token,
            length:      token?.length ?? 0,
            prefix:      token ? token.slice(0, 30) + '...' : '(empty)',
            tenantId:    this.config.tenantId,
            userId:      this.config.user.id,
            userName:    this.config.user.name,
            userEmail:   this.config.user.email ?? '',
          }
        );

        if (!token) {
          console.error('[ChatClient] ❌ No token provided — server will reject with 401');
        }

        const socketQuery: Record<string, string> = {};
        if (token)                     socketQuery.token    = token;
        if (this.config.tenantId)      socketQuery.tenantId = this.config.tenantId;
        if (this.config.user.id)       socketQuery.userId   = this.config.user.id;

        const debugUrl = `wss://${parsedWsUrl.host}${socketPath}?EIO=4&transport=websocket&` +
          new URLSearchParams(socketQuery).toString();
        console.log('%c[ChatClient] 🌐 Final WS URL →', 'color:#0ea5e9;font-weight:bold', debugUrl);

        this.socket = io(socketOrigin, {
          path: socketPath,
          auth: {
            token:     this.config.token,
            tenantId:  this.config.tenantId,
            userId:    this.config.user.id,
            userName:  this.config.user.name,
            userEmail: this.config.user.email ?? '',
          },
          query: socketQuery,
          transports: ['websocket'],
          upgrade: false,
          withCredentials: false,
          forceNew: true,
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay:    this.reconnectDelay,
        });

        // ── DEBUG: log every raw Socket.IO event ──────────────────────────
        this.socket.onAny((eventName: string, ...args: any[]) => {
          console.log(
            `%c[ChatClient] 📨 Raw event: "${eventName}"`,
            'color:#059669;font-weight:bold',
            args[0]
          );
        });

        let connectionAckReceived = false;

        // ── Helper: process a CONNECTION_ACK payload ───────────────────────
        // Extracted so we can call it both on first connect AND on reconnect.
        const handleConnectionAck = (data: any) => {
          connectionAckReceived  = true;
          this.connected         = true;
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

            // ── FIX: Emit 'connectionAck' on internal emitter ──────────────
            // context.ts listens for this event to dispatch SET_CONNECTED:true
            // after a reconnect. Without this, the input stays disabled because
            // the 'reconnect' socket event fires before the session is re-joined
            // and context.ts has no way to know the handshake completed again.
            this.emit('connectionAck', { sessionId, mode: data.mode, status: data.status });
          }
        };

        // ── CONNECTION_ACK ─────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: any) => {
          handleConnectionAck(data);
          // Only resolve the connect() promise once (first connect)
          if (this.session) resolve(this.session);
          else reject(new Error('No session ID in CONNECTION_ACK'));
        });

        this.socket.on('connect', () => {
          console.log('%c[ChatClient] 📡 Transport connected 4', 'color:#0ea5e9;font-weight:bold');
        });

        // ── MESSAGE_RECEIVE ────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw: any) => {
          const message = normalizeMessage(raw, this.session?.id ?? '');
          if (!message) return;
          console.log('[ChatClient] MESSAGE_RECEIVE →', message.senderType, message.content.slice(0, 50));
          this.emit('message', message);
          this.config.callbacks?.onMessage?.(message);
        });

        // ── TYPING events ──────────────────────────────────────────────────
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

        this.socket.on('TYPING_INDICATOR', (d: any) => handleTypingEvent(d, 'TYPING_INDICATOR'));
        this.socket.on('TYPING',           (d: any) => handleTypingEvent(d, 'TYPING'));
        this.socket.on('TYPING_START', (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: true  }, 'TYPING_START'));
        this.socket.on('TYPING_STOP',  (d: any) => handleTypingEvent({ ...(d ?? {}), isTyping: false }, 'TYPING_STOP'));

        if ((WS_EVENTS.TYPING_INDICATOR as string) !== 'TYPING_INDICATOR') {
          this.socket.on(WS_EVENTS.TYPING_INDICATOR as string, (d: any) =>
            handleTypingEvent(d, `WS_EVENTS.TYPING_INDICATOR(${WS_EVENTS.TYPING_INDICATOR})`)
          );
        }

        // ── AGENT_JOINED ───────────────────────────────────────────────────
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

        // ── STATUS_CHANGED ─────────────────────────────────────────────────
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

        // ── ERRORS ─────────────────────────────────────────────────────────
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

          if (msg === 'TOKEN_EXPIRED' || msg.toLowerCase().includes('expired')) {
            this.tokenExpired = true;
            this.socket?.disconnect();
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

        // ── FIX: On socket.io reconnect, re-join the session room ─────────
        // socket.io fires 'reconnect' after the transport re-connects but
        // BEFORE the server sends a new CONNECTION_ACK. We re-emit JOIN_SESSION
        // so the server adds this socket back to the room. The server will then
        // send a new CONNECTION_ACK which triggers handleConnectionAck above,
        // which in turn emits our internal 'connectionAck' event so context.ts
        // can re-enable the input.
        this.socket.on('reconnect', (attemptNumber: number) => {
          console.log(`%c[ChatClient] 🔄 Reconnected after ${attemptNumber} attempt(s)`,
            'color:#10b981;font-weight:bold');
          this.connected         = true;
          this.reconnectAttempts = 0;

          // Re-join session room so server sends a new CONNECTION_ACK
          if (this.session?.id) {
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
          }

          // Emit internal event so context.ts immediately re-enables UI
          // (CONNECTION_ACK will follow shortly and update session state)
          this.emit('reconnect', {});
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  sendMessage(content: string, messageType: MessageType = 'TEXT', replyToMessageId?: string): void {
    if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
    if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType,
      ...(replyToMessageId ? { replyToMessageId } : {}),
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

    let baseUrl = this.config.apiUrl ?? this.config.serviceUrl;
    if (baseUrl.includes(':3001')) baseUrl = baseUrl.replace(':3001', ':3000');
    baseUrl = baseUrl.replace(/\/+$/, '');

    console.log('[ChatClient] 📎 Uploading attachment:', file.name, file.type, file.size, '→', `${baseUrl}/chat-services/api/v1/upload`);

    const response = await fetch(`${baseUrl}/chat-services/api/v1/upload`, {
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

    const result     = await response.json();
    const uploadData = result.data;

    let messageType: MessageType = 'FILE';
    if (uploadData.mediaType === 'images') messageType = 'IMAGE';
    else if (uploadData.mediaType === 'videos') messageType = 'VIDEO';
    else if (uploadData.mediaType === 'audio')  messageType = 'AUDIO';

    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content: uploadData.url,
      messageType,
      metadata: {
        attachment: {
          url:       uploadData.url,
          fileName:  uploadData.fileName,
          mimeType:  uploadData.mimeType,
          size:      uploadData.size,
          mediaType: uploadData.mediaType,
        } as FileAttachment,
      },
    });

    console.log('[ChatClient] ✅ Attachment sent:', uploadData.url);
  }

  startTyping(): void {
    if (!this.socket || !this.connected || !this.session) return;
    const payload = { chatSessionId: this.session.id, isTyping: true };
    console.log('%c[ChatClient:TYPING] 🖊 Sending TYPING_START', 'color:#f59e0b;font-weight:bold', payload);
    this.socket.emit(WS_EVENTS.TYPING_START, payload);
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