

import { io, Socket } from 'socket.io-client';
import type { ChatSDKConfig, ChatMessage, ChatSession, MessageType, FileAttachment, SenderType, ChatMode, ChatStatus } from './types';
import { WS_EVENTS } from './types';
import { toSenderType, toMessageType, toChatStatus, toChatMode } from './shared/enums';

// Normalise any integer or string enum value the backend sends to the canonical
// STRING name that context.tsx and types.ts expect.
// Backend uses §12 integer enums: CUSTOMER=1, AGENT=2, BOT=3, SYSTEM=4, etc.
// Using explicit if-chains rather than object lookups to avoid any JS engine
// quirk with numeric-keyed object property access.
function normalizeSenderType(raw: unknown): string {
  if (raw === 'CUSTOMER' || raw === 1) return 'CUSTOMER';
  if (raw === 'AGENT'    || raw === 2) return 'AGENT';
  if (raw === 'BOT'      || raw === 3) return 'BOT';
  if (raw === 'SYSTEM'   || raw === 4) return 'SYSTEM';
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return 'CUSTOMER';
  if (n === 2) return 'AGENT';
  if (n === 3) return 'BOT';
  return 'SYSTEM';
}
function normalizeMessageType(raw: unknown): string {
  if (raw === 'TEXT'   || raw === 1) return 'TEXT';
  if (raw === 'SYSTEM' || raw === 2) return 'SYSTEM';
  if (raw === 'FILE'   || raw === 3) return 'FILE';
  if (raw === 'IMAGE'  || raw === 4) return 'IMAGE';
  if (raw === 'VIDEO'  || raw === 5) return 'VIDEO';
  if (raw === 'AUDIO'  || raw === 6) return 'AUDIO';
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return 'TEXT';
  if (n === 2) return 'SYSTEM';
  if (n === 3) return 'FILE';
  if (n === 4) return 'IMAGE';
  if (n === 5) return 'VIDEO';
  if (n === 6) return 'AUDIO';
  return 'TEXT';
}
function normalizeChatStatus(raw: unknown): string {
  if (raw === 'OPEN'             || raw === 1) return 'OPEN';
  if (raw === 'WAITING_FOR_AGENT'|| raw === 2) return 'WAITING_FOR_AGENT';
  if (raw === 'ASSIGNED'         || raw === 3) return 'ASSIGNED';
  if (raw === 'CLOSED'           || raw === 4) return 'CLOSED';
  if (raw === 'RESOLVED'         || raw === 5) return 'RESOLVED';
  if (raw === 'ON_HOLD'          || raw === 6) return 'ON_HOLD';
  if (raw == null) return 'OPEN';
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return 'OPEN';
  if (n === 2) return 'WAITING_FOR_AGENT';
  if (n === 3) return 'ASSIGNED';
  if (n === 4) return 'CLOSED';
  if (n === 5) return 'RESOLVED';
  if (n === 6) return 'ON_HOLD';
  return 'OPEN';
}
function normalizeChatMode(raw: unknown): string {
  if (raw === 'BOT'   || raw === 1) return 'BOT';
  if (raw === 'HUMAN' || raw === 2) return 'HUMAN';
  if (raw == null) return 'BOT';
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return 'BOT';
  if (n === 2) return 'HUMAN';
  return 'BOT';
}

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
    senderType:    normalizeSenderType(raw.senderType ?? raw.sender_type) as SenderType,
    senderId:      raw.senderId      ?? raw.sender_id      ?? '',
    senderName:    raw.senderName    ?? raw.sender_name,
    content:       raw.content       ?? raw.text           ?? '',
    messageType:   normalizeMessageType(raw.messageType ?? raw.message_type) as MessageType,
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
  private heartbeatTimer:       ReturnType<typeof setInterval> | null = null;
  private onBrowserOffline:     (() => void) | null = null;
  private onBrowserOnline:      (() => void) | null = null;

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
          // Deliberately NOT maxReconnectAttempts (5). That capped the manager
          // at five tries and then emitted reconnect_failed and stopped
          // FOREVER — so a backend that was down for a minute left the widget
          // permanently dead even after it came back. maxReconnectAttempts
          // still bounds the FIRST connect (see connect_error below), which is
          // where giving up and showing an error screen is the right answer.
          // Infinity is socket.io's own default (manager.js:53).
          reconnectionAttempts: Infinity,
          reconnectionDelay:    this.reconnectDelay,
          // Bound the exponential backoff so a long outage does not end up
          // waiting minutes between attempts.
          reconnectionDelayMax: 10_000,
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

          const ackSessionId = data.chatSessionId ?? data.sessionIds?.[0];
          console.log(
            '%c[ChatClient] ✅ CONNECTION_ACK',
            'color:#16a34a;font-weight:bold',
            { ackSessionId, mode: data.mode, status: data.status }
          );

          // CONNECTION_ACK names the server's PRIMARY session for this
          // customer, which is not necessarily the one they are looking at —
          // after picking an older conversation from the history, a reconnect
          // would otherwise silently yank them back into the primary one.
          // Once we have a session, it wins; we just re-join its room.
          const sessionId = this.session?.id ?? ackSessionId;

          if (sessionId) {
            const isAckForOurSession = sessionId === ackSessionId;
            // Only trust the ack's mode/status when it is describing OUR
            // session; otherwise keep what we already know.
            const mode   = isAckForOurSession
              ? normalizeChatMode(data.mode) as ChatMode
              : (this.session?.mode ?? 'BOT');
            const status = isAckForOurSession
              ? normalizeChatStatus(data.status) as ChatStatus
              : (this.session?.status ?? 'OPEN');
            // Merge, do not replace. CONNECTION_ACK carries only {id, mode,
            // status} — a plain replace on every reconnect wiped the assigned
            // agent's identity off the session, so the header silently fell
            // back to the generic title after any transport blip.
            const prev = this.session?.id === sessionId ? this.session : null;
            this.session = { ...(prev ?? {}), id: sessionId, mode, status };
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });

            // ── FIX: Emit 'connectionAck' on internal emitter ──────────────
            // context.ts listens for this event to dispatch SET_CONNECTED:true
            // after a reconnect. Without this, the input stays disabled because
            // the 'reconnect' socket event fires before the session is re-joined
            // and context.ts has no way to know the handshake completed again.
            this.emit('connectionAck', { sessionId, mode, status });
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
          console.log('%c[ChatClient] 📡 Transport connected 3', 'color:#0ea5e9;font-weight:bold');
          this._startHeartbeat();
        });

        // ── MESSAGE_RECEIVE ────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw: any) => {
          // Log FULL raw payload so we can diagnose media message structure
          console.log('[ChatClient] MESSAGE_RECEIVE RAW:', JSON.stringify(raw, null, 2));
          const message = normalizeMessage(raw, this.session?.id ?? '');
          if (!message) return;
          console.log('[ChatClient] MESSAGE_RECEIVE normalized →', message.senderType, message.messageType, message.content?.slice(0, 80));
          this.emit('message', message);
          this.config.callbacks?.onMessage?.(message);
        });

        // ── TYPING events ──────────────────────────────────────────────────
        const handleTypingEvent = (data: any, sourceEvent: string) => {
          const isTyping   = data?.isTyping   ?? false;
          const senderId   = data?.senderId   ?? '';
          const senderType = normalizeSenderType(data?.senderType);

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
          const mode   = normalizeChatMode(data.mode)    as ChatMode;
          const status = normalizeChatStatus(data.status) as ChatStatus;
          if (this.session) { this.session.mode = mode; this.session.status = status; }
          this.emit('statusChange', { ...data, mode, status });
          this.config.callbacks?.onStatusChange?.(status, mode);
        });

        this.socket.on(WS_EVENTS.SESSION_CLOSED, (data: any) => {
          // Pass the payload through instead of swallowing it: the room this
          // arrives on may be the customer's OTHER session (a reactivation
          // closes it with closeReason SWITCHED), and the consumer needs
          // chatSessionId + closeReason to tell the two apart.
          const closedId = data?.chatSessionId ?? data?.sessionId ?? null;
          if (this.session && (!closedId || closedId === this.session.id)) {
            this.session.status = 'CLOSED';
          }
          this.emit('sessionClosed', data ?? {});
          this.config.callbacks?.onSessionClosed?.();
        });

        // ── MESSAGE_READ (read receipts / "Seen ✓" indicator) ─────────────
        // this.socket.on(WS_EVENTS.MESSAGE_READ, (data: any) => {
        //   console.log('[ChatClient] MESSAGE_READ:', data);
        //   this.emit('messageRead', data);
        // });

        // ── MESSAGE_READ (read receipts / "Seen ✓" indicator) ─────────────
this.socket.on(WS_EVENTS.MESSAGE_READ, (data: any) => {
  console.log('[ChatClient] MESSAGE_READ:', data);
  this.emit('messageRead', data);
});

this.socket.on(WS_EVENTS.MESSAGE_ACK, (data: any) => {
  const clientMessageId = data?.clientMessageId;
  const messageId       = data?.messageId ?? data?.id;
  const chatSessionId   = data?.chatSessionId ?? data?.sessionId;
  if (!clientMessageId || !messageId) return;
  this.emit('messageAck', { clientMessageId, messageId, chatSessionId, seq: data?.seq ?? null });
});

const handlePresenceUpdate = (data: any) => {
  const userId = data?.userId ?? data?.agentId;
  if (!userId) return;
  const status   = data?.status ?? (data?.isOnline ? 1 : 2);
  const lastSeen = data?.lastSeen ?? null;
  this.emit('presenceUpdate', { userId, status, lastSeen });
};
this.socket.on(WS_EVENTS.PRESENCE_UPDATE, handlePresenceUpdate);
this.socket.on('PRESENCE_UPDATE',          handlePresenceUpdate);

this.socket.on('chat.ticket.linked', (data: any) => {
  console.log('[ChatClient] TICKET_LINKED:', data);
  this.emit('ticketLinked', data);
});
this.socket.on('TICKET_LINKED', (data: any) => {
  console.log('[ChatClient] TICKET_LINKED (alt):', data);
  this.emit('ticketLinked', data);
});

// NEW_MESSAGE_NOTIFICATION — customer widget: only WS in-app, never push
const handleNewMsgNotif = (data: any) => {
  if (!data?.chatSessionId) return;
  this.emit('newMessageNotification', {
    eventType:     data.eventType     ?? 1,
    chatSessionId: data.chatSessionId,
    messageId:     data.messageId     ?? '',
    senderType:    data.senderType    ?? 0,
    senderName:    data.senderName    ?? '',
    preview:       data.preview       ?? '',
    timestamp:     data.timestamp     ?? new Date().toISOString(),
  });
};
this.socket.on('chat.notification.new_message', handleNewMsgNotif);
this.socket.on('NEW_MESSAGE_NOTIFICATION',      handleNewMsgNotif);

        // ── ERRORS ─────────────────────────────────────────────────────────
        this.socket.on(WS_EVENTS.ERROR, (error: any) => {
          const err = new Error(error?.message ?? String(error));
          // Carry the server's code through. This used to be dropped on the
          // floor, which made every failure indistinguishable — a validation
          // refusal and a transient write error looked identical, so the UI
          // could not know whether a retry was even possible.
          // chat-service emits { code, message }: NOT_IN_SESSION, RATE_LIMITED,
          // MESSAGE_ERROR, VALIDATION_ERROR, UNAUTHORIZED, SESSION_ERROR.
          if (error?.code) (err as any).code = error.code;
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

        // ── On socket.io reconnect, re-join the session room ──────────────
        // BUG THIS FIXES: this was `this.socket.on('reconnect', ...)`, which
        // never fired. In socket.io-client v4 'reconnect' is emitted by the
        // MANAGER, not the Socket — verified in socket.io-client@4.8.3:
        // manager.js:413 `this.emitReserved("reconnect", attempt)` inside
        // Manager.onreconnect, while the Socket's RESERVED_EVENTS
        // (socket.js:16) are only connect / connect_error / disconnect /
        // disconnecting / newListener / removeListener. Registering it on the
        // socket made it an ordinary user-event listener for a name the server
        // never sends, so after every auto-reconnect `this.connected` stayed
        // false, JOIN_SESSION was never re-emitted from here, and context.tsx
        // never re-enabled the input or refetched the missed messages.
        //
        // socket.io fires this after the transport re-connects but BEFORE the
        // server sends a new CONNECTION_ACK, so we re-emit JOIN_SESSION to get
        // put back in the room; the CONNECTION_ACK that follows drives
        // handleConnectionAck above.
        this.socket.io.on('reconnect', (attemptNumber: number) => {
          console.log(`%c[ChatClient] 🔄 Reconnected after ${attemptNumber} attempt(s)`,
            'color:#10b981;font-weight:bold');
          this.connected         = true;
          this.reconnectAttempts = 0;
          this._startHeartbeat();

          // Re-join session room so server sends a new CONNECTION_ACK
          if (this.session?.id) {
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
          }

          // Emit internal event so context.ts immediately re-enables UI
          // (CONNECTION_ACK will follow shortly and update session state)
          this.emit('reconnect', {});
        });

        this.socket.io.on('reconnect_attempt', (attempt: number) => {
          console.log(`[ChatClient] 🔄 Reconnect attempt ${attempt}`);
          this.emit('reconnectAttempt', { attempt });
        });

        this.socket.io.on('reconnect_error', (err: any) => {
          console.warn('[ChatClient] 🔄 Reconnect attempt failed:', err?.message ?? err);
        });

        this._bindConnectivityListeners();

      } catch (error) {
        reject(error);
      }
    });
  }

  sendMessage(content: string, messageType: MessageType = 'TEXT', replyToMessageId?: string, clientMessageId?: string): void {
    if (this.tokenExpired) throw new Error('TOKEN_EXPIRED');
    if (!this.socket || !this.connected || !this.session) throw new Error('Not connected');
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType: toMessageType(messageType),
      token: this.config.token,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(clientMessageId  ? { clientMessageId }  : {}),
    });
  }

  markRead(): void {
    if (!this.socket || !this.connected || !this.session) return;
    this.socket.emit(WS_EVENTS.MARK_READ, { chatSessionId: this.session.id });
  }

  presenceQuery(userIds: string[]): void {
    if (!this.socket || !this.connected || !userIds.length) return;
    this.socket.emit(WS_EVENTS.PRESENCE_QUERY, { userIds });
  }

  setPresence(status: number): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit(WS_EVENTS.SET_PRESENCE, { status });
  }

  // ── Browser connectivity ──────────────────────────────────────────────────
  // socket.io only notices a dropped network when a transport read fails or
  // the heartbeat times out, which can take tens of seconds — during which the
  // widget still looks connected and messages silently vanish into the send
  // buffer. The browser knows immediately, so listen to it.
  //
  // MDN: navigator.onLine / the window 'online' and 'offline' events —
  // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
  // Note the documented caveat: `onLine === true` only means *some* network
  // interface is up, not that the server is reachable. That is why 'online'
  // triggers a reconnect ATTEMPT rather than declaring us connected — only a
  // CONNECTION_ACK does that.
  private _bindConnectivityListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._unbindConnectivityListeners();

    this.onBrowserOffline = () => {
      console.warn('[ChatClient] 📴 Browser went offline');
      this.connected = false;
      // Tell the UI now instead of after the heartbeat eventually times out.
      this.emit('disconnect', { reason: 'browser-offline' });
    };

    this.onBrowserOnline = () => {
      console.log('[ChatClient] 📶 Browser back online — forcing a reconnect attempt');
      // socket.io may be mid-backoff (up to reconnectionDelayMax). The network
      // just came back, so try immediately rather than waiting out the delay.
      if (this.tokenExpired) return;
      if (this.socket && !this.socket.connected) this.socket.connect();
    };

    window.addEventListener('offline', this.onBrowserOffline);
    window.addEventListener('online',  this.onBrowserOnline);
  }

  private _unbindConnectivityListeners(): void {
    if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return;
    if (this.onBrowserOffline) window.removeEventListener('offline', this.onBrowserOffline);
    if (this.onBrowserOnline)  window.removeEventListener('online',  this.onBrowserOnline);
    this.onBrowserOffline = null;
    this.onBrowserOnline  = null;
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit(WS_EVENTS.HEARTBEAT, { timestamp: Date.now() });
      }
    }, 25_000);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
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
      messageType: toMessageType(messageType),
      token: this.config.token,
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

  /**
   * @param status the status the caller already knows this session to be in.
   *   Pass it when switching to a session picked from history: the old default
   *   of 'OPEN' fabricated a status for a session that may well be CLOSED or
   *   RESOLVED, and terminal is not something the client may quietly overwrite.
   */
  joinSession(sessionId: string, status?: ChatStatus): void {
    if (!this.socket || !this.connected) return;
    if (this.session?.id && this.session.id !== sessionId) {
      this.socket.emit(WS_EVENTS.LEAVE_SESSION, { chatSessionId: this.session.id });
    }
    this.socket.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
    if (this.session) {
      this.session = { ...this.session, id: sessionId, status: status ?? 'OPEN' };
    }
  }

  disconnect(): void {
    this._stopHeartbeat();
    this._unbindConnectivityListeners();
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
