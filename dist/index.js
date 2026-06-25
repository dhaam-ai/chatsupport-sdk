"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ChatProvider: () => ChatProvider,
  ChatWebSocketClient: () => ChatWebSocketClient,
  ChatWidget: () => ChatWidget,
  WS_EVENTS: () => WS_EVENTS,
  useChat: () => useChat,
  useChatActions: () => useChatActions,
  useChatMessages: () => useChatMessages,
  useChatSession: () => useChatSession,
  useChatState: () => useChatState
});
module.exports = __toCommonJS(index_exports);

// src/ChatWidget.tsx
var import_react8 = require("react");

// src/context.tsx
var import_react = require("react");

// src/shared/enums.ts
var SenderType = { CUSTOMER: 1, AGENT: 2, BOT: 3, SYSTEM: 4 };
function coerce(enumObj, value, fallback) {
  if (typeof value === "number" && Object.values(enumObj).includes(value)) return value;
  if (typeof value === "string") {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && Object.values(enumObj).includes(asNum)) return asNum;
    const byName = enumObj[value.toUpperCase().trim()];
    if (byName !== void 0) return byName;
  }
  return fallback;
}
var toSenderType = (v) => coerce(SenderType, v, SenderType.SYSTEM);

// src/client.ts
var import_socket = require("socket.io-client");

// src/types.ts
var WS_EVENTS = {
  // Client -> Server
  JOIN_SESSION: "chat.session.join",
  LEAVE_SESSION: "chat.session.leave",
  MESSAGE_SEND: "chat.message.send",
  TYPING_START: "chat.typing.start",
  TYPING_STOP: "chat.typing.stop",
  REQUEST_AGENT: "chat.request.agent",
  // Server -> Client
  CONNECTION_ACK: "chat.connection.ack",
  MESSAGE_RECEIVE: "chat.message.receive",
  TYPING_INDICATOR: "chat.typing.indicator",
  AGENT_JOINED: "chat.agent.joined",
  AGENT_LEFT: "chat.agent.left",
  SESSION_CLOSED: "chat.session.closed",
  STATUS_CHANGED: "chat.status.changed",
  SESSION_JOINED: "chat.session.joined",
  ESCALATED: "chat.escalated",
  ERROR: "chat.error",
  TYPING: "chat.typing",
  // Read / delivery receipts (Phase 3)
  MESSAGE_READ: "chat.message.read",
  MARK_READ: "chat.message.markRead",
  MESSAGE_ACK: "chat.message.ack",
  MESSAGE_DELIVERED: "chat.message.delivered",
  // Presence (§13)
  HEARTBEAT: "chat.heartbeat",
  SET_PRESENCE: "chat.presence.set",
  PRESENCE_QUERY: "chat.presence.query",
  PRESENCE_UPDATE: "chat.presence.update",
  PRESENCE_STATE: "chat.presence.state"
};

// src/client.ts
function normalizeSenderType(raw) {
  if (raw === "CUSTOMER" || raw === 1) return "CUSTOMER";
  if (raw === "AGENT" || raw === 2) return "AGENT";
  if (raw === "BOT" || raw === 3) return "BOT";
  if (raw === "SYSTEM" || raw === 4) return "SYSTEM";
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return "CUSTOMER";
  if (n === 2) return "AGENT";
  if (n === 3) return "BOT";
  return "SYSTEM";
}
function normalizeMessageType(raw) {
  if (raw === "TEXT" || raw === 1) return "TEXT";
  if (raw === "SYSTEM" || raw === 2) return "SYSTEM";
  if (raw === "FILE" || raw === 3) return "FILE";
  if (raw === "IMAGE" || raw === 4) return "IMAGE";
  if (raw === "VIDEO" || raw === 5) return "VIDEO";
  if (raw === "AUDIO" || raw === 6) return "AUDIO";
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return "TEXT";
  if (n === 2) return "SYSTEM";
  if (n === 3) return "FILE";
  if (n === 4) return "IMAGE";
  if (n === 5) return "VIDEO";
  if (n === 6) return "AUDIO";
  return "TEXT";
}
function normalizeChatStatus(raw) {
  if (raw === "OPEN" || raw === 1) return "OPEN";
  if (raw === "WAITING_FOR_AGENT" || raw === 2) return "WAITING_FOR_AGENT";
  if (raw === "ASSIGNED" || raw === 3) return "ASSIGNED";
  if (raw === "CLOSED" || raw === 4) return "CLOSED";
  if (raw === "RESOLVED" || raw === 5) return "RESOLVED";
  if (raw === "ON_HOLD" || raw === 6) return "ON_HOLD";
  if (raw == null) return "OPEN";
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return "OPEN";
  if (n === 2) return "WAITING_FOR_AGENT";
  if (n === 3) return "ASSIGNED";
  if (n === 4) return "CLOSED";
  if (n === 5) return "RESOLVED";
  if (n === 6) return "ON_HOLD";
  return "OPEN";
}
function normalizeChatMode(raw) {
  if (raw === "BOT" || raw === 1) return "BOT";
  if (raw === "HUMAN" || raw === 2) return "HUMAN";
  if (raw == null) return "BOT";
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (n === 1) return "BOT";
  if (n === 2) return "HUMAN";
  return "BOT";
}
function normalizeMessage(raw, sessionId) {
  if (!raw) return null;
  const id = raw.id ?? raw.messageId ?? raw.message_id;
  if (!id) {
    console.warn("[ChatClient] Dropping message with no id:", raw);
    return null;
  }
  const rawTime = raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt;
  let timestamp;
  if (rawTime instanceof Date) {
    timestamp = rawTime;
  } else if (rawTime) {
    const d = new Date(rawTime);
    timestamp = isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
  } else {
    timestamp = /* @__PURE__ */ new Date();
  }
  return {
    id,
    chatSessionId: raw.chatSessionId ?? raw.chat_session_id ?? sessionId,
    senderType: normalizeSenderType(raw.senderType ?? raw.sender_type),
    senderId: raw.senderId ?? raw.sender_id ?? "",
    senderName: raw.senderName ?? raw.sender_name,
    content: raw.content ?? raw.text ?? "",
    messageType: normalizeMessageType(raw.messageType ?? raw.message_type),
    timestamp,
    metadata: raw.metadata,
    attachment: raw.attachment ?? raw.metadata?.attachment ?? void 0,
    replyToMessageId: raw.replyToMessageId ?? raw.reply_to_message_id ?? void 0,
    replyToMessage: raw.replyToMessage ?? raw.reply_to_message ?? void 0
  };
}
var ChatWebSocketClient = class {
  constructor(config) {
    this.socket = null;
    this.eventHandlers = /* @__PURE__ */ new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1e3;
    this.heartbeatTimer = null;
    this.session = null;
    this.connected = false;
    this.tokenExpired = false;
    this.config = config;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        let wsUrl;
        if (this.config.wsUrl) {
          wsUrl = this.config.wsUrl;
        } else {
          wsUrl = this.config.serviceUrl;
          if (wsUrl.includes(":3000")) wsUrl = wsUrl.replace(":3000", ":3001");
        }
        const parsedWsUrl = new URL(wsUrl);
        const socketPath = parsedWsUrl.pathname !== "/" ? parsedWsUrl.pathname : "/socket.io";
        const socketOrigin = `${parsedWsUrl.host}` ? `https://${parsedWsUrl.host}` : parsedWsUrl.origin;
        console.log("%c[ChatClient] \u{1F50C} Connecting \u2192", "color:#5b4fcf;font-weight:bold", socketOrigin, "| path:", socketPath);
        const token = this.config.token;
        console.log(
          "%c[ChatClient] \u{1F511} Token being sent",
          "color:#7c3aed;font-weight:bold",
          {
            present: !!token,
            length: token?.length ?? 0,
            prefix: token ? token.slice(0, 30) + "..." : "(empty)",
            tenantId: this.config.tenantId,
            userId: this.config.user.id,
            userName: this.config.user.name,
            userEmail: this.config.user.email ?? ""
          }
        );
        if (!token) {
          console.error("[ChatClient] \u274C No token provided \u2014 server will reject with 401");
        }
        const socketQuery = {};
        if (token) socketQuery.token = token;
        if (this.config.tenantId) socketQuery.tenantId = this.config.tenantId;
        if (this.config.user.id) socketQuery.userId = this.config.user.id;
        const debugUrl = `wss://${parsedWsUrl.host}${socketPath}?EIO=4&transport=websocket&` + new URLSearchParams(socketQuery).toString();
        console.log("%c[ChatClient] \u{1F310} Final WS URL \u2192", "color:#0ea5e9;font-weight:bold", debugUrl);
        this.socket = (0, import_socket.io)(socketOrigin, {
          path: socketPath,
          auth: {
            token: this.config.token,
            tenantId: this.config.tenantId,
            userId: this.config.user.id,
            userName: this.config.user.name,
            userEmail: this.config.user.email ?? ""
          },
          query: socketQuery,
          transports: ["websocket"],
          upgrade: false,
          withCredentials: false,
          forceNew: true,
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: this.reconnectDelay
        });
        this.socket.onAny((eventName, ...args) => {
          console.log(
            `%c[ChatClient] \u{1F4E8} Raw event: "${eventName}"`,
            "color:#059669;font-weight:bold",
            args[0]
          );
        });
        let connectionAckReceived = false;
        const handleConnectionAck = (data) => {
          connectionAckReceived = true;
          this.connected = true;
          this.reconnectAttempts = 0;
          const sessionId = data.chatSessionId ?? data.sessionIds?.[0];
          console.log(
            "%c[ChatClient] \u2705 CONNECTION_ACK",
            "color:#16a34a;font-weight:bold",
            { sessionId, mode: data.mode, status: data.status }
          );
          if (sessionId) {
            const mode = normalizeChatMode(data.mode);
            const status = normalizeChatStatus(data.status);
            this.session = { id: sessionId, mode, status };
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
            this.emit("connectionAck", { sessionId, mode, status });
          }
        };
        this.socket.on(WS_EVENTS.CONNECTION_ACK, (data) => {
          handleConnectionAck(data);
          if (this.session) resolve(this.session);
          else reject(new Error("No session ID in CONNECTION_ACK"));
        });
        this.socket.on("connect", () => {
          console.log("%c[ChatClient] \u{1F4E1} Transport connected 3", "color:#0ea5e9;font-weight:bold");
          this._startHeartbeat();
        });
        this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (raw) => {
          console.log("[ChatClient] MESSAGE_RECEIVE RAW:", JSON.stringify(raw, null, 2));
          const message = normalizeMessage(raw, this.session?.id ?? "");
          if (!message) return;
          console.log("[ChatClient] MESSAGE_RECEIVE normalized \u2192", message.senderType, message.messageType, message.content?.slice(0, 80));
          this.emit("message", message);
          this.config.callbacks?.onMessage?.(message);
        });
        const handleTypingEvent = (data, sourceEvent) => {
          const isTyping = data?.isTyping ?? false;
          const senderId = data?.senderId ?? "";
          const senderType = normalizeSenderType(data?.senderType);
          console.log(
            `%c[ChatClient:TYPING] \u{1F58A} Received "${sourceEvent}"`,
            "color:#f59e0b;font-weight:bold",
            { isTyping, senderId, senderType, rawData: data }
          );
          this.emit("typing", { isTyping, senderId, senderType });
        };
        this.socket.on("TYPING_INDICATOR", (d) => handleTypingEvent(d, "TYPING_INDICATOR"));
        this.socket.on("TYPING", (d) => handleTypingEvent(d, "TYPING"));
        this.socket.on("TYPING_START", (d) => handleTypingEvent({ ...d ?? {}, isTyping: true }, "TYPING_START"));
        this.socket.on("TYPING_STOP", (d) => handleTypingEvent({ ...d ?? {}, isTyping: false }, "TYPING_STOP"));
        if (WS_EVENTS.TYPING_INDICATOR !== "TYPING_INDICATOR") {
          this.socket.on(
            WS_EVENTS.TYPING_INDICATOR,
            (d) => handleTypingEvent(d, `WS_EVENTS.TYPING_INDICATOR(${WS_EVENTS.TYPING_INDICATOR})`)
          );
        }
        this.socket.on(WS_EVENTS.AGENT_JOINED, (data) => {
          console.log("[ChatClient] AGENT_JOINED:", data);
          if (this.session) {
            this.session.assignedAgentId = data.agentId;
            this.session.assignedAgentName = data.agentName;
          }
          this.emit("agentJoined", data);
          this.config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
        });
        this.socket.on(WS_EVENTS.AGENT_LEFT, (data) => {
          this.emit("agentLeft", data);
          this.config.callbacks?.onAgentLeft?.(data.agentId);
        });
        this.socket.on(WS_EVENTS.STATUS_CHANGED, (data) => {
          const mode = normalizeChatMode(data.mode);
          const status = normalizeChatStatus(data.status);
          if (this.session) {
            this.session.mode = mode;
            this.session.status = status;
          }
          this.emit("statusChange", { ...data, mode, status });
          this.config.callbacks?.onStatusChange?.(status, mode);
        });
        this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
          if (this.session) this.session.status = "CLOSED";
          this.emit("sessionClosed", {});
          this.config.callbacks?.onSessionClosed?.();
        });
        this.socket.on(WS_EVENTS.MESSAGE_READ, (data) => {
          console.log("[ChatClient] MESSAGE_READ:", data);
          this.emit("messageRead", data);
        });
        this.socket.on(WS_EVENTS.MESSAGE_ACK, (data) => {
          const clientMessageId = data?.clientMessageId;
          const messageId = data?.messageId ?? data?.id;
          const chatSessionId = data?.chatSessionId ?? data?.sessionId;
          if (!clientMessageId || !messageId) return;
          this.emit("messageAck", { clientMessageId, messageId, chatSessionId, seq: data?.seq ?? null });
        });
        const handlePresenceUpdate = (data) => {
          const userId = data?.userId ?? data?.agentId;
          if (!userId) return;
          const status = data?.status ?? (data?.isOnline ? 1 : 2);
          const lastSeen = data?.lastSeen ?? null;
          this.emit("presenceUpdate", { userId, status, lastSeen });
        };
        this.socket.on(WS_EVENTS.PRESENCE_UPDATE, handlePresenceUpdate);
        this.socket.on("PRESENCE_UPDATE", handlePresenceUpdate);
        this.socket.on("chat.ticket.linked", (data) => {
          console.log("[ChatClient] TICKET_LINKED:", data);
          this.emit("ticketLinked", data);
        });
        this.socket.on("TICKET_LINKED", (data) => {
          console.log("[ChatClient] TICKET_LINKED (alt):", data);
          this.emit("ticketLinked", data);
        });
        const handleNewMsgNotif = (data) => {
          if (!data?.chatSessionId) return;
          this.emit("newMessageNotification", {
            eventType: data.eventType ?? 1,
            chatSessionId: data.chatSessionId,
            messageId: data.messageId ?? "",
            senderType: data.senderType ?? 0,
            senderName: data.senderName ?? "",
            preview: data.preview ?? "",
            timestamp: data.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
          });
        };
        this.socket.on("chat.notification.new_message", handleNewMsgNotif);
        this.socket.on("NEW_MESSAGE_NOTIFICATION", handleNewMsgNotif);
        this.socket.on(WS_EVENTS.ERROR, (error) => {
          const err = new Error(error.message ?? String(error));
          this.emit("error", err);
          this.config.callbacks?.onError?.(err);
        });
        this.socket.on("connect_error", (error) => {
          this.connected = false;
          this.reconnectAttempts++;
          const msg = error?.message ?? "";
          console.error(
            `[ChatClient] \u274C Connect error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`,
            msg
          );
          if (msg === "TOKEN_EXPIRED" || msg.toLowerCase().includes("expired")) {
            this.tokenExpired = true;
            this.socket?.disconnect();
            console.warn("[ChatClient] \u26A0\uFE0F Token expired \u2014 blocking further messages");
            this.emit("tokenExpired", { message: "Your session has expired. Please refresh to continue." });
            if (!connectionAckReceived) {
              reject(new Error("TOKEN_EXPIRED"));
            }
            return;
          }
          this.emit("error", error);
          if (this.reconnectAttempts >= this.maxReconnectAttempts && !connectionAckReceived) {
            reject(error);
          }
        });
        this.socket.on("disconnect", (reason) => {
          console.warn("[ChatClient] \u26A0\uFE0F  Disconnected:", reason);
          this.connected = false;
          this.emit("disconnect", { reason });
        });
        this.socket.on("reconnect", (attemptNumber) => {
          console.log(
            `%c[ChatClient] \u{1F504} Reconnected after ${attemptNumber} attempt(s)`,
            "color:#10b981;font-weight:bold"
          );
          this.connected = true;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          if (this.session?.id) {
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
          }
          this.emit("reconnect", {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  sendMessage(content, messageType = "TEXT", replyToMessageId, clientMessageId) {
    if (this.tokenExpired) throw new Error("TOKEN_EXPIRED");
    if (!this.socket || !this.connected || !this.session) throw new Error("Not connected");
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType,
      token: this.config.token,
      ...replyToMessageId ? { replyToMessageId } : {},
      ...clientMessageId ? { clientMessageId } : {}
    });
  }
  markRead() {
    if (!this.socket || !this.connected || !this.session) return;
    this.socket.emit(WS_EVENTS.MARK_READ, { chatSessionId: this.session.id });
  }
  presenceQuery(userIds) {
    if (!this.socket || !this.connected || !userIds.length) return;
    this.socket.emit(WS_EVENTS.PRESENCE_QUERY, { userIds });
  }
  setPresence(status) {
    if (!this.socket || !this.connected) return;
    this.socket.emit(WS_EVENTS.SET_PRESENCE, { status });
  }
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit(WS_EVENTS.HEARTBEAT, { timestamp: Date.now() });
      }
    }, 25e3);
  }
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  /**
   * Upload a file to S3 via the chat-service REST API and send it as a message.
   */
  async sendAttachment(file) {
    if (this.tokenExpired) throw new Error("TOKEN_EXPIRED");
    if (!this.socket || !this.connected || !this.session) throw new Error("Not connected");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("chatSessionId", this.session.id);
    if (this.config.tenantId) {
      formData.append("tenantId", this.config.tenantId);
    }
    let baseUrl = this.config.apiUrl ?? this.config.serviceUrl;
    if (baseUrl.includes(":3001")) baseUrl = baseUrl.replace(":3001", ":3000");
    baseUrl = baseUrl.replace(/\/+$/, "");
    console.log("[ChatClient] \u{1F4CE} Uploading attachment:", file.name, file.type, file.size, "\u2192", `${baseUrl}/chat-services/api/v1/upload`);
    const response = await fetch(`${baseUrl}/chat-services/api/v1/upload`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.token}`
      },
      body: formData
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: "Upload failed" } }));
      throw new Error(err.error?.message || "File upload failed");
    }
    const result = await response.json();
    const uploadData = result.data;
    let messageType = "FILE";
    if (uploadData.mediaType === "images") messageType = "IMAGE";
    else if (uploadData.mediaType === "videos") messageType = "VIDEO";
    else if (uploadData.mediaType === "audio") messageType = "AUDIO";
    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content: uploadData.url,
      messageType,
      token: this.config.token,
      metadata: {
        attachment: {
          url: uploadData.url,
          fileName: uploadData.fileName,
          mimeType: uploadData.mimeType,
          size: uploadData.size,
          mediaType: uploadData.mediaType
        }
      }
    });
    console.log("[ChatClient] \u2705 Attachment sent:", uploadData.url);
  }
  startTyping() {
    if (!this.socket || !this.connected || !this.session) return;
    const payload = { chatSessionId: this.session.id, isTyping: true };
    console.log("%c[ChatClient:TYPING] \u{1F58A} Sending TYPING_START", "color:#f59e0b;font-weight:bold", payload);
    this.socket.emit(WS_EVENTS.TYPING_START, payload);
    this.socket.emit("TYPING_INDICATOR", payload);
  }
  stopTyping() {
    if (!this.socket || !this.connected || !this.session) return;
    const payload = { chatSessionId: this.session.id, isTyping: false };
    console.log("%c[ChatClient:TYPING] \u{1F58A} Sending TYPING_STOP", "color:#6b7280;font-weight:bold", payload);
    this.socket.emit(WS_EVENTS.TYPING_STOP, payload);
    this.socket.emit("TYPING_INDICATOR", payload);
  }
  requestAgent(reason) {
    if (this.socket && this.connected && this.session) {
      this.socket.emit(WS_EVENTS.REQUEST_AGENT, { chatSessionId: this.session.id, reason });
    }
  }
  joinSession(sessionId) {
    if (!this.socket || !this.connected) return;
    if (this.session?.id && this.session.id !== sessionId) {
      this.socket.emit(WS_EVENTS.LEAVE_SESSION, { chatSessionId: this.session.id });
    }
    this.socket.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
    if (this.session) {
      this.session = { ...this.session, id: sessionId, status: "OPEN" };
    }
  }
  disconnect() {
    this._stopHeartbeat();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.session = null;
  }
  on(event, callback) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, /* @__PURE__ */ new Set());
    this.eventHandlers.get(event).add(callback);
    return () => this.off(event, callback);
  }
  off(event, callback) {
    this.eventHandlers.get(event)?.delete(callback);
  }
  emit(event, data) {
    this.eventHandlers.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[ChatClient] Handler error for "${event}":`, e);
      }
    });
  }
};

// src/context.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var _SDK_BUILD = "2026-06-26-enum-fix";
console.log(`%c[ChatSDK] Build: ${_SDK_BUILD}`, "background:#7c3aed;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700;font-family:monospace;");
var initialState = {
  initialized: false,
  connected: false,
  loading: true,
  session: null,
  messages: [],
  isTyping: false,
  typingUser: void 0,
  error: null,
  tokenExpired: false,
  isWidgetOpen: false,
  unreadCount: 0,
  hasMore: true,
  loadingMore: false,
  uploading: false,
  pastSessions: [],
  agentReadAt: null,
  closeReason: null
};
function chatReducer(state, action) {
  switch (action.type) {
    case "INIT_START":
      return { ...state, loading: true, error: null };
    case "INIT_SUCCESS":
      return { ...state, initialized: true, connected: true, loading: false, session: action.session };
    case "INIT_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SET_CONNECTED":
      return { ...state, connected: action.connected };
    case "ADD_MESSAGE": {
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      const isFromAgentOrBot = action.message.senderType === "AGENT" || action.message.senderType === "BOT";
      const shouldIncrement = !state.isWidgetOpen && isFromAgentOrBot;
      return {
        ...state,
        messages: [...state.messages, action.message],
        unreadCount: shouldIncrement ? state.unreadCount + 1 : state.unreadCount
      };
    }
    case "SET_MESSAGES":
      return { ...state, messages: action.messages, hasMore: action.hasMore ?? true };
    case "PREPEND_MESSAGES": {
      if (!action.messages.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
      const existingIds = new Set(state.messages.map((m) => m.id));
      const newMsgs = action.messages.filter((m) => !existingIds.has(m.id));
      if (!newMsgs.length) return { ...state, hasMore: action.hasMore, loadingMore: false };
      return {
        ...state,
        messages: [...newMsgs, ...state.messages],
        hasMore: action.hasMore,
        loadingMore: false
      };
    }
    case "SET_LOADING_MORE":
      return { ...state, loadingMore: action.loading };
    case "REPLACE_TEMP": {
      const idx = state.messages.findIndex((m) => m.id === action.tempId);
      if (idx === -1) {
        if (state.messages.some((m) => m.id === action.message.id)) return state;
        return { ...state, messages: [...state.messages, action.message] };
      }
      const updated = [...state.messages];
      updated[idx] = action.message;
      return { ...state, messages: updated };
    }
    case "SET_TYPING":
      return { ...state, isTyping: action.isTyping, typingUser: action.typingUser };
    case "UPDATE_SESSION":
      return { ...state, session: state.session ? { ...state.session, ...action.session } : null };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "TOKEN_EXPIRED":
      return { ...state, tokenExpired: true, connected: false, error: new Error("Your session has expired. Please refresh to continue.") };
    case "SET_WIDGET_OPEN":
      return {
        ...state,
        isWidgetOpen: action.open,
        unreadCount: action.open ? 0 : state.unreadCount
      };
    case "SET_UPLOADING":
      return { ...state, uploading: action.uploading };
    case "SET_PAST_SESSIONS":
      return { ...state, pastSessions: action.sessions };
    case "UPDATE_PAST_SESSION":
      return {
        ...state,
        pastSessions: state.pastSessions.map(
          (s) => s.id === action.sessionId ? { ...s, ...action.updates } : s
        )
      };
    // ── SET_AGENT_READ_AT ─────────────────────────────────────────────────
    // No forward-only guard here. The participants restore on load gives us
    // the real backend timestamp. Real-time WS events will naturally be newer.
    // Removing the guard prevents the "seed to NOW" race from blocking the
    // accurate participants timestamp.
    case "SET_AGENT_READ_AT":
      return { ...state, agentReadAt: action.readAt };
    case "SET_CLOSE_REASON":
      return { ...state, closeReason: action.reason };
    default:
      return state;
  }
}
function safeDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function normSender(v) {
  if (v === "CUSTOMER" || v === 1) return "CUSTOMER";
  if (v === "AGENT" || v === 2) return "AGENT";
  if (v === "BOT" || v === 3) return "BOT";
  if (v === "SYSTEM" || v === 4) return "SYSTEM";
  const n = Number(v);
  if (n === 1) return "CUSTOMER";
  if (n === 2) return "AGENT";
  if (n === 3) return "BOT";
  return "SYSTEM";
}
function normMsgType(v) {
  if (v === "TEXT" || v === 1) return "TEXT";
  if (v === "SYSTEM" || v === 2) return "SYSTEM";
  if (v === "FILE" || v === 3) return "FILE";
  if (v === "IMAGE" || v === 4) return "IMAGE";
  if (v === "VIDEO" || v === 5) return "VIDEO";
  if (v === "AUDIO" || v === 6) return "AUDIO";
  const n = Number(v);
  if (n === 1) return "TEXT";
  if (n === 2) return "SYSTEM";
  if (n === 3) return "FILE";
  if (n === 4) return "IMAGE";
  if (n === 5) return "VIDEO";
  if (n === 6) return "AUDIO";
  return "TEXT";
}
function normStatus(v) {
  if (v === "OPEN" || v === 1) return "OPEN";
  if (v === "WAITING_FOR_AGENT" || v === 2) return "WAITING_FOR_AGENT";
  if (v === "ASSIGNED" || v === 3) return "ASSIGNED";
  if (v === "CLOSED" || v === 4) return "CLOSED";
  if (v === "RESOLVED" || v === 5) return "RESOLVED";
  if (v === "ON_HOLD" || v === 6) return "ON_HOLD";
  if (v == null) return "OPEN";
  const n = Number(v);
  if (n === 1) return "OPEN";
  if (n === 2) return "WAITING_FOR_AGENT";
  if (n === 3) return "ASSIGNED";
  if (n === 4) return "CLOSED";
  if (n === 5) return "RESOLVED";
  if (n === 6) return "ON_HOLD";
  return "OPEN";
}
function normMode(v) {
  if (v === "BOT" || v === 1) return "BOT";
  if (v === "HUMAN" || v === 2) return "HUMAN";
  if (v == null) return "BOT";
  const n = Number(v);
  return n === 2 ? "HUMAN" : "BOT";
}
var ChatContext = (0, import_react.createContext)(null);
var _activeConnections = /* @__PURE__ */ new Map();
async function mapCustomer(config) {
  try {
    console.log("%c[Chat] \u{1F5FA}  mapCustomer \u2192 calling /customers/map", "color:#7c3aed;font-weight:bold", {
      app_id: config.tenantId,
      external_user_id: Number(config.user.id),
      username: config.user.name,
      email: config.user.email ?? ""
    });
    const res = await fetch("https://docs-dev.dhaamai.com/customers/map", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "Authorization": `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: String(config.tenantId),
        external_user_id: Number(config.user.id),
        username: config.user.name,
        email: config.user.email ?? "",
        role_id: 4
      })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[Chat] mapCustomer failed:", res.status, body);
      return;
    }
    const data = await res.json();
    console.log("%c[Chat] \u2705 mapCustomer success", "color:#16a34a;font-weight:bold", data);
  } catch (e) {
    console.warn("[Chat] mapCustomer error (non-blocking):", e);
  }
}
function ChatProvider({ config, children }) {
  const [state, dispatch] = (0, import_react.useReducer)(chatReducer, initialState);
  const clientRef = (0, import_react.useRef)(null);
  const typingTimerRef = (0, import_react.useRef)(null);
  const botTypingTimerRef = (0, import_react.useRef)(null);
  const connectionKey = `${config.tenantId}:${config.user?.id}`;
  const configRef = (0, import_react.useRef)(config);
  (0, import_react.useEffect)(() => {
    configRef.current = config;
  });
  const pendingReplaces = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const pendingAttachTempIds = (0, import_react.useRef)(/* @__PURE__ */ new Set());
  const clientMsgMap = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const stateRef = (0, import_react.useRef)(state);
  (0, import_react.useEffect)(() => {
    stateRef.current = state;
  }, [state]);
  const lastTypingDispatch = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (_activeConnections.get(connectionKey)) return;
    _activeConnections.set(connectionKey, true);
    const initChat = async () => {
      dispatch({ type: "INIT_START" });
      try {
        const cfg = configRef.current;
        const client = new ChatWebSocketClient(cfg);
        clientRef.current = client;
        client.on("message", (msg) => {
          const _raw = msg;
          const message = { ..._raw, senderType: normSender(_raw.senderType), messageType: normMsgType(_raw.messageType) };
          if (message.senderType === "CUSTOMER" && !message.id.startsWith("temp-")) {
            if (pendingReplaces.current.has(message.content)) {
              console.log("[Chat] Skipping text echo \u2014 replaceOptimistic will handle:", message.id);
              return;
            }
            if (pendingAttachTempIds.current.size > 0) {
              console.log("[Chat] Skipping attachment echo \u2014 replaceOptimistic will handle:", message.id);
              return;
            }
          }
          if (message.senderType === "BOT" || message.senderType === "AGENT") {
            if (botTypingTimerRef.current) {
              clearTimeout(botTypingTimerRef.current);
              botTypingTimerRef.current = null;
            }
            dispatch({ type: "SET_TYPING", isTyping: false });
          }
          dispatch({ type: "ADD_MESSAGE", message });
          const isFromAgentOrBot = message.senderType === "AGENT" || message.senderType === "BOT";
          if (isFromAgentOrBot && stateRef.current.isWidgetOpen && stateRef.current.session?.id) {
            client.markRead();
            const cfg2 = configRef.current;
            fetch(
              `${cfg2.serviceUrl}/chat-services/api/v1/chat/sessions/${stateRef.current.session.id}/read`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${cfg2.token}`,
                  "X-Tenant-ID": cfg2.tenantId,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ customerId: cfg2.user.id })
              }
            ).catch(() => {
            });
          }
          if (message.senderType === "AGENT") {
            const ts = safeDate(message.timestamp);
            if (ts) {
              dispatch({ type: "SET_AGENT_READ_AT", readAt: ts });
            }
          }
        });
        client.on("typing", ((rawData) => {
          const isTyping = rawData?.isTyping ?? false;
          const senderId = rawData?.senderId ?? "";
          const rawSender = rawData?.senderType ?? rawData?.sender_type ?? "";
          const senderType = toSenderType(rawSender);
          console.log(
            `%c[Chat:TYPING] \u{1F4E8} event received`,
            "color:#f59e0b;font-weight:bold",
            { isTyping, senderId, senderType, raw: rawData?.senderType }
          );
          if (senderType === SenderType.CUSTOMER) {
            console.log("[Chat:TYPING] Skipping \u2014 explicit CUSTOMER echo");
            return;
          }
          const now = Date.now();
          const last = lastTypingDispatch.current;
          if (last !== null && last.isTyping === isTyping && now - last.time < 300) {
            console.log(`%c[Chat:TYPING] Suppressed same-value duplicate (${isTyping}) within 300ms`, "color:#9ca3af");
            return;
          }
          lastTypingDispatch.current = { isTyping, time: now };
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = null;
          }
          dispatch({ type: "SET_TYPING", isTyping, typingUser: senderId });
          if (isTyping) {
            typingTimerRef.current = setTimeout(() => {
              dispatch({ type: "SET_TYPING", isTyping: false });
              typingTimerRef.current = null;
              lastTypingDispatch.current = null;
            }, 5e3);
          } else {
            lastTypingDispatch.current = null;
          }
        }));
        client.on("statusChange", ((data) => {
          dispatch({ type: "UPDATE_SESSION", session: { status: normStatus(data.status), mode: normMode(data.mode) } });
          dispatch({
            type: "UPDATE_PAST_SESSION",
            sessionId: data.chatSessionId,
            updates: { status: data.status, mode: data.mode, closedAt: null }
          });
          if (data.status === "CLOSED" && data.closeReason) {
            dispatch({ type: "SET_CLOSE_REASON", reason: data.closeReason });
          }
          if (botTypingTimerRef.current) {
            clearTimeout(botTypingTimerRef.current);
            botTypingTimerRef.current = null;
          }
          dispatch({ type: "SET_TYPING", isTyping: false });
        }));
        client.on("agentJoined", ((data) => {
          dispatch({
            type: "UPDATE_SESSION",
            session: {
              assignedAgentId: data.agentId,
              assignedAgentName: data.agentName,
              assignedAgent: data.agentName ? {
                displayName: data.agentName,
                email: data.agentEmail || null,
                avatarUrl: data.avatarUrl || null,
                isOnline: true
              } : void 0,
              mode: "HUMAN",
              status: "ASSIGNED"
            }
          });
          if (data.agentName) {
            const localSysMsg = {
              id: `agentjoined-local-${data.agentId}-${Date.now()}`,
              chatSessionId: stateRef.current.session?.id ?? "",
              senderType: "SYSTEM",
              senderId: "system",
              content: `${data.agentName} has joined the chat.`,
              messageType: "TEXT",
              timestamp: /* @__PURE__ */ new Date()
            };
            dispatch({ type: "ADD_MESSAGE", message: localSysMsg });
          }
        }));
        client.on("sessionClosed", ((data) => {
          if (data?.closeReason) {
            dispatch({ type: "SET_CLOSE_REASON", reason: data.closeReason });
          }
        }));
        client.on("disconnect", () => {
          console.log("[Chat] Disconnected \u2014 disabling input until reconnect ACK");
          dispatch({ type: "SET_CONNECTED", connected: false });
        });
        client.on("reconnect", () => {
          console.log("[Chat] Transport reconnected \u2014 re-enabling input");
          dispatch({ type: "SET_CONNECTED", connected: true });
          const sid = stateRef.current.session?.id;
          if (sid && !stateRef.current.tokenExpired) {
            console.log("[Chat] Fetching missed messages after reconnect for session:", sid);
            fetchMessages(configRef.current, sid, dispatch, true).catch(() => {
            });
          }
        });
        client.on("connectionAck", ((data) => {
          console.log("[Chat] connectionAck received \u2014 ensuring connected=true", data);
          dispatch({ type: "SET_CONNECTED", connected: true });
          if (data?.status || data?.mode) {
            dispatch({ type: "UPDATE_SESSION", session: { status: normStatus(data.status), mode: normMode(data.mode) } });
          }
        }));
        client.on("error", (error) => dispatch({ type: "SET_ERROR", error }));
        client.on("tokenExpired", () => {
          console.warn("[Chat] Token expired \u2014 blocking further messages");
          dispatch({ type: "TOKEN_EXPIRED" });
        });
        client.on("messageRead", ((data) => {
          if (!data?.readAt) return;
          const readBy = toSenderType(data.readBy);
          const isAgentRead = readBy === SenderType.AGENT;
          if (isAgentRead) {
            const ts = safeDate(data.readAt);
            if (ts) {
              const readAt = new Date(Math.max(ts.getTime(), Date.now()));
              dispatch({ type: "SET_AGENT_READ_AT", readAt });
            }
          }
        }));
        client.on("messageAck", ((data) => {
          const tempId = clientMsgMap.current.get(data?.clientMessageId);
          if (!tempId || !data?.messageId) return;
          clientMsgMap.current.delete(data.clientMessageId);
          pendingReplaces.current.delete(stateRef.current.messages.find((m) => m.id === tempId)?.content ?? "");
          const existing = stateRef.current.messages.find((m) => m.id === tempId);
          if (!existing) return;
          dispatch({ type: "REPLACE_TEMP", tempId, message: { ...existing, id: data.messageId } });
        }));
        client.on("presenceUpdate", ((data) => {
          const session2 = stateRef.current.session;
          if (!session2 || !data?.userId) return;
          if (data.userId !== session2.assignedAgentId) return;
          const isOnline = data.status === 1;
          if (!session2.assignedAgent) return;
          dispatch({
            type: "UPDATE_SESSION",
            session: { assignedAgent: { ...session2.assignedAgent, isOnline } }
          });
        }));
        client.on("newMessageNotification", ((_data) => {
        }));
        client.on("ticketLinked", ((data) => {
          const ticketId = data?.ticketId ?? data?.ticket_id ?? data?.id ?? "";
          const ticketUrl = data?.ticketUrl ?? data?.ticket_url ?? null;
          const ticketCode = data?.ticketCode ?? data?.code ?? ticketId;
          dispatch({
            type: "UPDATE_SESSION",
            session: { ticketId: ticketCode, ticketUrl }
          });
          const sysMsg = {
            id: `ticket-linked-${ticketId}-${Date.now()}`,
            chatSessionId: stateRef.current.session?.id ?? "",
            senderType: "SYSTEM",
            senderId: "system",
            content: `\u{1F3AB} Ticket #${ticketCode} has been created for this chat.${ticketUrl ? ` Track it at: ${ticketUrl}` : ""}`,
            messageType: "TEXT",
            timestamp: /* @__PURE__ */ new Date()
          };
          dispatch({ type: "ADD_MESSAGE", message: sysMsg });
        }));
        let _rawSession = await client.connect();
        let session = { ..._rawSession, mode: normMode(_rawSession.mode), status: normStatus(_rawSession.status) };
        mapCustomer(cfg);
        if (session.status === "CLOSED") {
          console.log("[Chat] Got CLOSED session \u2014 creating fresh session via REST");
          try {
            const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${cfg.token}`,
                "X-Tenant-ID": cfg.tenantId,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                tenantId: cfg.tenantId,
                customerId: cfg.user.id,
                customerName: cfg.user.name,
                customerEmail: cfg.user.email
              })
            });
            if (res.ok) {
              const json = await res.json();
              const newId = json.data?.sessionId ?? json.data?.id;
              const newMode = normMode(json.data?.mode ?? "BOT");
              const newStatus = normStatus(json.data?.status ?? "OPEN");
              if (newId) {
                client.joinSession(newId);
                session = { id: newId, mode: newMode, status: newStatus };
                console.log("[Chat] Switched to fresh session:", newId);
              }
            }
          } catch (e) {
            console.warn("[Chat] Could not create fresh session:", e);
          }
        }
        await fetchMessages(configRef.current, session.id, dispatch, false);
        dispatch({ type: "INIT_SUCCESS", session });
        configRef.current.callbacks?.onConnected?.(session.id);
        if (session.assignedAgentId) {
          client.presenceQuery([session.assignedAgentId]);
        }
      } catch (error) {
        _activeConnections.delete(connectionKey);
        dispatch({ type: "INIT_ERROR", error });
        configRef.current.callbacks?.onError?.(error);
      }
    };
    initChat();
    return () => {
      _activeConnections.delete(connectionKey);
      pendingReplaces.current.clear();
      clientMsgMap.current.clear();
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (botTypingTimerRef.current) {
        clearTimeout(botTypingTimerRef.current);
        botTypingTimerRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [connectionKey, config.serviceUrl, config.token]);
  const sendMessage = (0, import_react.useCallback)(async (content, type = "TEXT", replyToMessageId) => {
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error("Chat not initialized");
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error("TOKEN_EXPIRED");
    const clientMessageId = crypto.randomUUID();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    clientMsgMap.current.set(clientMessageId, tempId);
    const optimistic = {
      id: tempId,
      chatSessionId: s.session.id,
      senderType: "CUSTOMER",
      senderId: configRef.current.user.id,
      senderName: configRef.current.user.name,
      content,
      messageType: type,
      timestamp: /* @__PURE__ */ new Date(),
      ...replyToMessageId ? { replyToMessageId } : {}
    };
    pendingReplaces.current.set(content, tempId);
    dispatch({ type: "ADD_MESSAGE", message: optimistic });
    clientRef.current.sendMessage(content, type, replyToMessageId, clientMessageId);
    const currentMode = stateRef.current.session?.mode;
    const currentStatus = stateRef.current.session?.status;
    const isBotSession = currentMode !== "HUMAN" && currentStatus !== "ASSIGNED" && currentStatus !== "WAITING_FOR_AGENT";
    if (isBotSession) {
      if (botTypingTimerRef.current) clearTimeout(botTypingTimerRef.current);
      dispatch({ type: "SET_TYPING", isTyping: true, typingUser: "AI Assistant" });
      botTypingTimerRef.current = setTimeout(() => {
        dispatch({ type: "SET_TYPING", isTyping: false });
        botTypingTimerRef.current = null;
      }, 15e3);
    }
    const replaceOptimistic = (rawEvt) => {
      const _r = rawEvt;
      const msg = { ..._r, senderType: normSender(_r.senderType), messageType: normMsgType(_r.messageType) };
      if (msg.senderType === "CUSTOMER" && msg.content === content && !msg.id.startsWith("temp-")) {
        dispatch({ type: "REPLACE_TEMP", tempId, message: msg });
        pendingReplaces.current.delete(content);
        clientRef.current?.off?.("message", replaceOptimistic);
      }
    };
    clientRef.current.on("message", replaceOptimistic);
    setTimeout(() => {
      clientRef.current?.off?.("message", replaceOptimistic);
      pendingReplaces.current.delete(content);
    }, 1e4);
  }, []);
  const startTyping = (0, import_react.useCallback)(() => {
    clientRef.current?.startTyping?.();
  }, []);
  const stopTyping = (0, import_react.useCallback)(() => {
    clientRef.current?.stopTyping?.();
  }, []);
  const requestAgent = (0, import_react.useCallback)(async (reason) => {
    clientRef.current?.requestAgent?.(reason);
  }, []);
  const closeSession = (0, import_react.useCallback)(async () => {
    const session = stateRef.current.session;
    if (!session) return;
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${session.id}/close`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "X-Tenant-ID": cfg.tenantId,
          "Content-Type": "application/json"
        }
      });
      dispatch({ type: "UPDATE_SESSION", session: { status: "CLOSED" } });
    } catch (error) {
      dispatch({ type: "SET_ERROR", error });
    }
  }, []);
  const reconnect = (0, import_react.useCallback)(async () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    _activeConnections.delete(connectionKey);
    pendingReplaces.current.clear();
    dispatch({ type: "INIT_START" });
    try {
      const client = new ChatWebSocketClient(configRef.current);
      clientRef.current = client;
      const session = await client.connect();
      dispatch({ type: "INIT_SUCCESS", session });
    } catch (error) {
      dispatch({ type: "INIT_ERROR", error });
    }
  }, [connectionKey]);
  const setWidgetOpen = (0, import_react.useCallback)((open) => {
    dispatch({ type: "SET_WIDGET_OPEN", open });
  }, []);
  const loadOlderMessages = (0, import_react.useCallback)(async () => {
    const s = stateRef.current;
    if (!s.session || s.loadingMore || !s.hasMore) return;
    const oldest = s.messages[0];
    if (!oldest) return;
    dispatch({ type: "SET_LOADING_MORE", loading: true });
    try {
      const cfg = configRef.current;
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${cfg.token}`, "X-Tenant-ID": cfg.tenantId }
      });
      if (!res.ok) {
        dispatch({ type: "SET_LOADING_MORE", loading: false });
        return;
      }
      const json = await res.json();
      const data = json.data ?? {};
      const messages = (data.messages ?? []).map((m) => {
        const d = new Date(m.createdAt ?? m.timestamp);
        return {
          id: m.id,
          chatSessionId: m.chatSessionId,
          senderType: normSender(m.senderType),
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          messageType: normMsgType(m.messageType),
          timestamp: isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d,
          metadata: m.metadata,
          attachment: m.attachment ?? m.metadata?.attachment ?? void 0,
          replyToMessageId: m.replyToMessageId ?? void 0,
          replyToMessage: m.replyToMessage ?? void 0
        };
      });
      dispatch({ type: "PREPEND_MESSAGES", messages, hasMore: data.hasMore ?? false });
    } catch (err) {
      console.error("[Chat] loadOlderMessages failed:", err);
      dispatch({ type: "SET_LOADING_MORE", loading: false });
    }
  }, []);
  const sendAttachment = (0, import_react.useCallback)(async (file) => {
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error("Chat not initialized");
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error("TOKEN_EXPIRED");
    let optType = "FILE";
    if (file.type.startsWith("image/")) optType = "IMAGE";
    else if (file.type.startsWith("video/")) optType = "VIDEO";
    else if (file.type.startsWith("audio/")) optType = "AUDIO";
    const tempId = `temp-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: tempId,
      chatSessionId: s.session.id,
      senderType: "CUSTOMER",
      senderId: configRef.current.user.id,
      senderName: configRef.current.user.name,
      content: file.name,
      messageType: optType,
      timestamp: /* @__PURE__ */ new Date()
    };
    dispatch({ type: "SET_UPLOADING", uploading: true });
    dispatch({ type: "ADD_MESSAGE", message: optimistic });
    pendingAttachTempIds.current.add(tempId);
    try {
      await clientRef.current.sendAttachment(file);
      const replaceOptimistic = (rawEvt) => {
        const _r = rawEvt;
        const msg = { ..._r, senderType: normSender(_r.senderType), messageType: normMsgType(_r.messageType) };
        if (msg.senderType === "CUSTOMER" && !msg.id.startsWith("temp-") && (msg.messageType === optType || msg.messageType === "FILE")) {
          dispatch({ type: "REPLACE_TEMP", tempId, message: msg });
          pendingAttachTempIds.current.delete(tempId);
          clientRef.current?.off?.("message", replaceOptimistic);
        }
      };
      clientRef.current.on("message", replaceOptimistic);
      setTimeout(() => {
        clientRef.current?.off?.("message", replaceOptimistic);
        pendingAttachTempIds.current.delete(tempId);
      }, 15e3);
    } catch (err) {
      console.error("[Chat] Attachment upload failed:", err);
      dispatch({ type: "SET_ERROR", error: err });
    } finally {
      dispatch({ type: "SET_UPLOADING", uploading: false });
    }
  }, []);
  const fetchPastSessions = (0, import_react.useCallback)(async () => {
    const cfg = configRef.current;
    try {
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/customer?tenantId=${encodeURIComponent(cfg.tenantId)}&customerId=${encodeURIComponent(cfg.user.id)}&limit=6`;
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${cfg.token}`, "X-Tenant-ID": cfg.tenantId }
      });
      if (!res.ok) return;
      const json = await res.json();
      dispatch({ type: "SET_PAST_SESSIONS", sessions: json.data?.sessions ?? [] });
    } catch (e) {
      console.warn("[Chat] fetchPastSessions failed:", e);
    }
  }, []);
  const reopenSession = (0, import_react.useCallback)(async (sessionId) => {
    const cfg = configRef.current;
    const currentSessionId = stateRef.current.session?.id;
    const currentStatus = stateRef.current.session?.status;
    if (currentSessionId && currentStatus !== "CLOSED" && currentSessionId !== sessionId) {
      try {
        await fetch(
          `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${currentSessionId}/close`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${cfg.token}`,
              "X-Tenant-ID": cfg.tenantId,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ customerId: cfg.user.id, closeReason: "SWITCHED" })
          }
        );
        console.log("[Chat] Previous session put on hold:", currentSessionId);
      } catch (e) {
        console.warn("[Chat] Could not put previous session on hold:", e);
      }
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          id: `system-hold-${Date.now()}`,
          chatSessionId: currentSessionId,
          senderType: "SYSTEM",
          senderId: "system",
          content: "\u23F8 Your chat has been put on hold because you switched to another session.",
          messageType: "TEXT",
          timestamp: /* @__PURE__ */ new Date()
        }
      });
      dispatch({ type: "SET_CLOSE_REASON", reason: "SWITCHED" });
    }
    const res = await fetch(
      `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/reopen`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "X-Tenant-ID": cfg.tenantId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ customerId: cfg.user.id })
      }
    );
    if (!res.ok) throw new Error("Failed to reopen session");
    const json = await res.json();
    const data = json.data;
    dispatch({ type: "SET_CLOSE_REASON", reason: null });
    clientRef.current?.joinSession(data.sessionId ?? sessionId);
    dispatch({
      type: "INIT_SUCCESS",
      session: { id: data.sessionId ?? sessionId, mode: "HUMAN", status: "WAITING_FOR_AGENT" }
    });
    dispatch({ type: "SET_MESSAGES", messages: [], hasMore: false });
    await fetchMessages(cfg, data.sessionId ?? sessionId, dispatch, false);
    return { sessionId: data.sessionId ?? sessionId, status: data.status, mode: data.mode };
  }, []);
  const markMessagesRead = (0, import_react.useCallback)(async () => {
    const s = stateRef.current;
    const cfg = configRef.current;
    if (!s.session) return;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/read`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "X-Tenant-ID": cfg.tenantId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ customerId: cfg.user.id })
      });
    } catch (e) {
      console.warn("[Chat] markMessagesRead failed:", e);
    }
  }, []);
  const actions = {
    sendMessage,
    sendAttachment,
    startTyping,
    stopTyping,
    closeSession,
    requestAgent,
    reconnect,
    setWidgetOpen,
    loadOlderMessages,
    fetchPastSessions,
    reopenSession,
    markMessagesRead
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChatContext.Provider, { value: { state, actions, config }, children });
}
function useChat() {
  const ctx = (0, import_react.useContext)(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
var useChatMessages = () => useChat().state.messages;
var useChatSession = () => useChat().state.session;
var useChatActions = () => useChat().actions;
var useChatState = () => useChat().state;
async function fetchMessages(config, sessionId, dispatch, mergeOnly = false) {
  try {
    const res = await fetch(
      `${config.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/full`,
      {
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "X-Tenant-ID": config.tenantId
        }
      }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.data?.messages) return;
    const messages = data.data.messages.map((m) => {
      const d = new Date(m.createdAt ?? m.timestamp);
      const msgType = normMsgType(m.messageType);
      const hasMediaContent = m.content && (m.content.includes("/audio/") || m.content.includes("/video/") || /\.(mp3|wav|ogg|m4a|aac|mp4|webm|mov)(\?|$)/i.test(m.content));
      if (msgType !== "TEXT" || hasMediaContent || m.metadata?.attachment) {
        console.log("[Chat] fetchMessages MEDIA message RAW:", JSON.stringify(m, null, 2));
      }
      return {
        id: m.id,
        chatSessionId: m.chatSessionId,
        senderType: normSender(m.senderType),
        senderId: m.senderId,
        senderName: m.senderName,
        content: m.content,
        messageType: msgType,
        timestamp: isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d,
        metadata: m.metadata,
        attachment: m.attachment ?? m.metadata?.attachment ?? void 0,
        replyToMessageId: m.replyToMessageId ?? void 0,
        replyToMessage: m.replyToMessage ?? void 0
      };
    });
    const hasMore = data.data.hasMore ?? false;
    if (mergeOnly) {
      for (const msg of messages) {
        dispatch({ type: "ADD_MESSAGE", message: msg });
      }
    } else {
      dispatch({ type: "SET_MESSAGES", messages, hasMore });
    }
    const sess = data.data.session;
    if (sess) {
      dispatch({
        type: "UPDATE_SESSION",
        session: {
          ...sess.assignedAgentId && { assignedAgentId: sess.assignedAgentId },
          ...sess.assignedAgent && { assignedAgent: sess.assignedAgent },
          ...sess.assignedAgent?.displayName && { assignedAgentName: sess.assignedAgent.displayName },
          ...sess.customer && { customer: sess.customer }
        }
      });
    }
    const participants = data.data.participants ?? [];
    const agentParticipants = participants.filter(
      (p) => p.participantType === SenderType.AGENT && p.lastReadAt
    );
    if (agentParticipants.length > 0) {
      const latestReadAt = agentParticipants.reduce((latest, p) => {
        const ts = new Date(p.lastReadAt);
        if (isNaN(ts.getTime())) return latest;
        return latest === null || ts > latest ? ts : latest;
      }, null);
      if (latestReadAt) {
        console.log("%c[Chat] \u2705 Restored agentReadAt from participants", "color:#16a34a", latestReadAt.toISOString());
        dispatch({ type: "SET_AGENT_READ_AT", readAt: latestReadAt });
      }
    }
    const customerParticipant = participants.find(
      (p) => p.participantType === SenderType.CUSTOMER && p.lastReadAt
    );
    if (customerParticipant?.lastReadAt) {
      const ts = new Date(customerParticipant.lastReadAt);
      if (!isNaN(ts.getTime())) {
        console.log("%c[Chat] \u2705 Restored customerReadAt from participants", "color:#16a34a", ts.toISOString());
        dispatch({ type: "UPDATE_SESSION", session: { customerReadAt: ts } });
      }
    }
  } catch (e) {
    console.error("[Chat] fetchMessages failed:", e);
  }
}

// src/widget/constants.ts
var MAIN_MENU = [
  { id: "order_details", icon: "\u{1F4E6}", label: "Check Order Details" },
  { id: "track_order", icon: "\u{1F69A}", label: "Track My Order" },
  { id: "faq", icon: "\u2753", label: "FAQs & Help" },
  { id: "human", icon: "\u{1F464}", label: "Talk to a Human Agent" }
];
var FAQ_ITEMS = [
  { id: "faq_return", icon: "\u{1F504}", label: "How do I return an item?" },
  { id: "faq_refund", icon: "\u{1F4B0}", label: "When will I get my refund?" },
  { id: "faq_address", icon: "\u{1F4CD}", label: "How do I change my delivery address?" },
  { id: "faq_cancel", icon: "\u274C", label: "How do I cancel my order?" },
  { id: "faq_track", icon: "\u{1F69A}", label: "How do I track my order?" },
  { id: "faq_payment", icon: "\u{1F4B3}", label: "What payment methods are accepted?" },
  { id: "faq_contact", icon: "\u{1F4DE}", label: "How do I contact support?" }
];
var defaultTheme = {
  primaryColor: "#5b4fcf",
  headerBackground: "#5b4fcf",
  headerText: "#ffffff",
  customerBubbleColor: "#5b4fcf",
  agentBubbleColor: "#f0effe",
  fontFamily: '"Outfit", "DM Sans", system-ui, sans-serif',
  borderRadius: "16px",
  position: "bottom-right"
};

// src/widget/theme.ts
function getStyles(theme = {}) {
  const t = { ...defaultTheme, ...theme };
  const isRight = t.position !== "bottom-left";
  return {
    container: { position: "fixed", bottom: "24px", [isRight ? "right" : "left"]: "24px", zIndex: 9999, fontFamily: t.fontFamily },
    launcher: { width: "56px", height: "56px", borderRadius: "50%", background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: "transform 0.2s, box-shadow 0.2s" },
    widget: { width: "380px", height: "560px", backgroundColor: "#ffffff", borderRadius: t.borderRadius, boxShadow: "0 12px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)" },
    header: { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: "14px 16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
    headerAvatar: { width: "36px", height: "36px", borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 },
    headerInfo: { flex: 1 },
    headerTitle: { fontSize: "15px", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" },
    headerSub: { fontSize: "11px", opacity: 0.85, margin: "2px 0 0", display: "flex", alignItems: "center", gap: "5px" },
    onlineDot: { width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#4ade80", display: "inline-block", flexShrink: 0 },
    closeBtn: { background: "rgba(255,255,255,0.15)", border: "none", color: t.headerText, cursor: "pointer", padding: "6px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" },
    messages: { flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: "10px", backgroundColor: "#fafafa" },
    bubbleCustomer: { alignSelf: "flex-end", background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: "#ffffff", padding: "10px 14px", borderRadius: "18px 18px 4px 18px", maxWidth: "78%", wordBreak: "break-word", fontSize: "14px", lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
    bubbleAgent: { alignSelf: "flex-start", backgroundColor: "#ffffff", color: "#1a1a2e", padding: "10px 14px", borderRadius: "18px 18px 18px 4px", maxWidth: "78%", wordBreak: "break-word", fontSize: "14px", lineHeight: 1.5, boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #f0f0f5", whiteSpace: "pre-line" },
    bubbleSystem: { alignSelf: "center", backgroundColor: "#ede9fe", color: "#5b4fcf", padding: "5px 14px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, textAlign: "center" },
    senderLabel: { fontSize: "10px", color: "#9ca3af", marginBottom: "3px", paddingLeft: "2px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
    timestamp: { fontSize: "10px", opacity: 0.5, marginTop: "4px" },
    typingWrap: { alignSelf: "flex-start", backgroundColor: "#ffffff", padding: "12px 16px", borderRadius: "18px 18px 18px 4px", display: "flex", gap: "5px", alignItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #f0f0f5" },
    typingDot: { width: "7px", height: "7px", backgroundColor: "#9ca3af", borderRadius: "50%" },
    inputArea: { padding: "10px 12px", borderTop: "1px solid #f0f0f5", display: "flex", gap: "8px", alignItems: "center", backgroundColor: "#ffffff", flexShrink: 0, position: "relative" },
    input: { flex: 1, padding: "10px 14px", borderRadius: "22px", border: "1.5px solid #e5e7eb", fontSize: "14px", outline: "none", fontFamily: "inherit", backgroundColor: "#f9fafb", color: "#111827", transition: "border-color 0.2s" },
    sendBtn: { width: "40px", height: "40px", borderRadius: "50%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" },
    centeredBox: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "32px", backgroundColor: "#fafafa", textAlign: "center" }
  };
}

// src/widget/icons.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var ChatIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "26", height: "26", viewBox: "0 0 24 24", fill: "none", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", fill: "white", opacity: "0.95" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "8", cy: "10", r: "1", fill: "rgba(255,255,255,0.5)" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "10", r: "1", fill: "rgba(255,255,255,0.5)" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "16", cy: "10", r: "1", fill: "rgba(255,255,255,0.5)" })
] });
var CloseIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
] });
var SendIcon = ({ active }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "17", height: "17", viewBox: "0 0 24 24", fill: "none", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M22 2L11 13", stroke: active ? "white" : "#9ca3af", strokeWidth: "2.5", strokeLinecap: "round" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M22 2L15 22L11 13L2 9L22 2Z", fill: active ? "white" : "#9ca3af" })
] });
var ChevronDownIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("polyline", { points: "6 9 12 15 18 9" }) });
var BackIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("polyline", { points: "15 18 9 12 15 6" }) });
var SpinnerIcon = ({ color = "#9ca3af", size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "12", r: "10", stroke: "#e5e7eb", strokeWidth: "3" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 2a10 10 0 0 1 10 10", stroke: color, strokeWidth: "3", strokeLinecap: "round", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) })
] });
var PhoneDownIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-3.33" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("line", { x1: "1", y1: "1", x2: "23", y2: "23" })
] });
var ReplyIcon = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("polyline", { points: "9 17 4 12 9 7" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M20 18v-2a4 4 0 00-4-4H4" })
] });

// src/widget/ChatContentInner.tsx
var import_react7 = require("react");

// src/notificationSound.ts
var audioCtx = null;
function getCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playNotificationSound(volume = 0.65) {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const notes = [
      { freq: 659.25, start: now + 0, dur: 0.12 },
      { freq: 783.99, start: now + 0.11, dur: 0.18 }
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, note.start);
      gain.gain.setValueAtTime(0, note.start);
      gain.gain.linearRampToValueAtTime(volume, note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(1e-3, note.start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(note.start);
      osc.stop(note.start + note.dur + 0.01);
    }
  } catch (_) {
  }
}
function unlockAudio() {
  try {
    getCtx();
  } catch (_) {
  }
}

// src/Messageticks.tsx
var import_react2 = __toESM(require("react"));
var import_jsx_runtime3 = require("react/jsx-runtime");
var PURPLE = "#7c3aed";
var GREY = "#a0aec0";
var SingleTick = ({ color = GREY }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
  "svg",
  {
    width: "14",
    height: "10",
    viewBox: "0 0 14 10",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 },
    children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "polyline",
      {
        points: "1,5 5,9 13,1",
        stroke: color,
        strokeWidth: "1.8",
        strokeLinecap: "round",
        strokeLinejoin: "round"
      }
    )
  }
);
var DoubleTick = ({ color = GREY }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
  "svg",
  {
    width: "18",
    height: "10",
    viewBox: "0 0 18 10",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 },
    children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "polyline",
        {
          points: "5,5 9,9 17,1",
          stroke: color,
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "polyline",
        {
          points: "1,5 5,9 13,1",
          stroke: color,
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      )
    ]
  }
);
function getTickStatus(params) {
  const { msgTimestamp, msgId, senderType, isOwnMessage, readAt, otherPartyOnline } = params;
  if (!isOwnMessage) return "none";
  if (senderType === "SYSTEM") return "none";
  if (msgId.startsWith("optimistic-") || msgId.startsWith("opt-") || msgId.startsWith("temp-") || msgId.startsWith("local-")) return "none";
  const msgTime = msgTimestamp instanceof Date ? msgTimestamp : new Date(msgTimestamp);
  if (isNaN(msgTime.getTime())) return "sent";
  if (readAt && msgTime <= readAt) return "seen";
  if (otherPartyOnline) return "delivered";
  return "sent";
}
var MessageTicks = import_react2.default.memo(function MessageTicks2({
  status,
  purple = PURPLE,
  style,
  showLabel = false,
  labelStyle
}) {
  if (status === "none") return null;
  const wrapper = {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    lineHeight: 1,
    ...style
  };
  if (status === "sent") {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: wrapper, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SingleTick, { color: GREY }),
      showLabel && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 10, color: GREY, fontWeight: 500, ...labelStyle }, children: "Sent" })
    ] });
  }
  if (status === "delivered") {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: wrapper, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DoubleTick, { color: GREY }),
      showLabel && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 10, color: GREY, fontWeight: 500, ...labelStyle }, children: "Delivered" })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: wrapper, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DoubleTick, { color: purple }),
    showLabel && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 10, color: purple, fontWeight: 700, ...labelStyle }, children: "Seen" })
  ] });
});
function buildTickMap(params) {
  const { messages, viewerSenderType, readAt, otherPartyOnline } = params;
  const map = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    const isOwnMessage = msg.senderType === viewerSenderType || // BOT messages are "owned" by the agent side (agent dashboard shows them)
    viewerSenderType === "AGENT" && msg.senderType === "BOT";
    const ts = msg.createdAt ?? (msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp) ?? "";
    map.set(msg.id, getTickStatus({
      msgTimestamp: ts,
      msgId: msg.id,
      senderType: msg.senderType,
      isOwnMessage,
      readAt,
      otherPartyOnline
    }));
  }
  return map;
}

// src/widget/MessageBubble.tsx
var import_react4 = __toESM(require("react"));

// src/widget/helpers.ts
function looksLikeRawId(s) {
  if (!s) return false;
  if (/^[0-9a-fA-F-]{20,}$/.test(s)) return true;
  if (/^\d{6,}$/.test(s)) return true;
  if (/^\d+::\d+::\d+$/.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^(ADMIN|AGENT|BOT|SYSTEM)\d*$/i.test(s)) return true;
  return false;
}
function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

// src/widget/AudioPlayer.tsx
var import_react3 = __toESM(require("react"));
var import_jsx_runtime4 = require("react/jsx-runtime");
var CompactAudioPlayer = import_react3.default.memo(function CompactAudioPlayer2({ src, isCustomer }) {
  const audioRef = (0, import_react3.useRef)(null);
  const [playing, setPlaying] = (0, import_react3.useState)(false);
  const [progress, setProgress] = (0, import_react3.useState)(0);
  const [duration, setDuration] = (0, import_react3.useState)(0);
  const [current, setCurrent] = (0, import_react3.useState)(0);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    playing ? a.pause() : a.play();
  };
  const fmt = (s) => !isFinite(s) || isNaN(s) ? "0:00" : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  const accent = isCustomer ? "rgba(255,255,255,0.9)" : "#5b4fcf";
  const trackBg = isCustomer ? "rgba(255,255,255,0.25)" : "#e5e7eb";
  const fillBg = isCustomer ? "rgba(255,255,255,0.9)" : "#5b4fcf";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", width: "210px", height: "40px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "audio",
      {
        ref: audioRef,
        src,
        preload: "metadata",
        style: { display: "none" },
        onPlay: () => setPlaying(true),
        onPause: () => setPlaying(false),
        onEnded: () => {
          setPlaying(false);
          setProgress(0);
          setCurrent(0);
        },
        onTimeUpdate: () => {
          const a = audioRef.current;
          if (!a?.duration) return;
          setCurrent(a.currentTime);
          setProgress(a.currentTime / a.duration);
        },
        onLoadedMetadata: () => {
          const a = audioRef.current;
          if (a) setDuration(a.duration);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        onClick: toggle,
        style: { flexShrink: 0, width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${accent}`, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: accent, padding: 0 },
        children: playing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "currentColor", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("rect", { x: "5", y: "4", width: "4", height: "16", rx: "1" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("rect", { x: "15", y: "4", width: "4", height: "16", rx: "1" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("polygon", { points: "6,4 20,12 6,20" }) })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "div",
        {
          style: { height: "3px", borderRadius: "2px", background: trackBg, cursor: "pointer", position: "relative" },
          onClick: (e) => {
            const a = audioRef.current;
            if (!a?.duration) return;
            const r = e.currentTarget.getBoundingClientRect();
            a.currentTime = (e.clientX - r.left) / r.width * a.duration;
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { height: "100%", width: `${progress * 100}%`, background: fillBg, borderRadius: "2px", transition: "width 0.1s linear" } })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { fontSize: "9px", color: accent, opacity: 0.8, lineHeight: 1 }, children: [
        fmt(current),
        " / ",
        fmt(duration || 0)
      ] })
    ] })
  ] });
});

// src/widget/MessageBubble.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var MEDIA_LABEL = {
  IMAGE: "Image",
  VIDEO: "Video",
  AUDIO: "Audio",
  FILE: "File"
};
function TypingIndicator({ styles }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: styles.typingWrap, children: [0, 0.2, 0.4].map((d, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...styles.typingDot, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` } }, i)) });
}
function CustomerTick({ status }) {
  if (status === "none") return null;
  const W = "rgba(255,255,255,0.95)";
  const Wm = "rgba(255,255,255,0.65)";
  const Single = () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { width: "14", height: "10", viewBox: "0 0 14 10", fill: "none", style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("polyline", { points: "1,5 5,9 13,1", stroke: Wm, strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) });
  const Double = ({ bright }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: "18", height: "10", viewBox: "0 0 18 10", fill: "none", style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("polyline", { points: "5,5 9,9 17,1", stroke: bright ? W : Wm, strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("polyline", { points: "1,5 5,9 13,1", stroke: bright ? W : Wm, strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
  if (status === "sent") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Single, {});
  if (status === "delivered") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Double, { bright: false });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Double, { bright: true }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { fontSize: 9, fontWeight: 700, color: W, lineHeight: 1 }, children: "Seen" })
  ] });
}
var MessageBubble = import_react4.default.memo(function MessageBubble2({
  message,
  styles,
  onImageClick,
  onReply,
  replyToResolved,
  tickStatus,
  primaryColor
}) {
  const isCustomer = message.senderType === "CUSTOMER";
  const isSystem = message.senderType === "SYSTEM";
  const isBot = message.senderType === "BOT";
  const time = formatTime(message.timestamp);
  const [hovered, setHovered] = (0, import_react4.useState)(false);
  if (isSystem && looksLikeRawId(message.content?.trim())) return null;
  if (isSystem) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: styles.bubbleSystem, children: message.content });
  const rawName = message.senderName;
  const agentLabel = rawName && !looksLikeRawId(rawName) ? rawName : "Agent";
  const label = isCustomer ? null : isBot ? "AI Assistant" : agentLabel;
  const attachment = message.attachment ?? message.metadata?.attachment ?? null;
  const contentUrl = message.content ?? "";
  const isImageUrl = /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(contentUrl);
  const isVideoUrl = /\.(mp4|mov|avi|mkv|flv|wmv)(\?.*)?$/i.test(contentUrl);
  const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)(\?.*)?$/i.test(contentUrl) || /\/audio\//i.test(contentUrl);
  const isFileUrl = /^https?:\/\//i.test(contentUrl);
  let effectiveType = null;
  if (message.messageType === "IMAGE") effectiveType = "IMAGE";
  else if (message.messageType === "VIDEO") effectiveType = "VIDEO";
  else if (message.messageType === "AUDIO") effectiveType = "AUDIO";
  else if (message.messageType === "FILE") effectiveType = "FILE";
  else if (attachment?.mimeType?.startsWith("image/")) effectiveType = "IMAGE";
  else if (attachment?.mimeType?.startsWith("video/")) effectiveType = "VIDEO";
  else if (attachment?.mimeType?.startsWith("audio/")) effectiveType = "AUDIO";
  else if (isImageUrl) effectiveType = "IMAGE";
  else if (isVideoUrl) effectiveType = "VIDEO";
  else if (isAudioUrl) effectiveType = "AUDIO";
  else if (attachment || isFileUrl && contentUrl.includes("/") && !contentUrl.includes(" ")) effectiveType = "FILE";
  const isAttachment = effectiveType !== null;
  const isAudio = effectiveType === "AUDIO";
  const replyTo = message.replyToMessage ?? replyToResolved ?? null;
  const renderReplyQuote = () => {
    if (!replyTo) return null;
    const rName = replyTo.senderType === "CUSTOMER" ? "You" : replyTo.senderName ?? (replyTo.senderType === "BOT" ? "AI Assistant" : "Agent");
    const mediaLabel = MEDIA_LABEL[replyTo.messageType];
    const preview = mediaLabel ? `\u{1F4CE} ${mediaLabel}` : replyTo.content?.length > 60 ? replyTo.content.slice(0, 60) + "\u2026" : replyTo.content;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
      "div",
      {
        style: { padding: "6px 10px", marginBottom: "6px", borderLeft: `3px solid ${isCustomer ? "rgba(255,255,255,0.5)" : "#7c3aed"}`, borderRadius: "4px", backgroundColor: isCustomer ? "rgba(255,255,255,0.12)" : "#f5f3ff", fontSize: "11px", lineHeight: "1.4", cursor: "pointer" },
        onClick: (e) => {
          e.stopPropagation();
          const el = document.getElementById(`chat-msg-${replyTo.id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.animate(
              [{ backgroundColor: "transparent" }, { backgroundColor: isCustomer ? "rgba(124,58,237,0.15)" : "#ede9fe" }, { backgroundColor: isCustomer ? "rgba(124,58,237,0.15)" : "#ede9fe" }, { backgroundColor: "transparent" }],
              { duration: 2e3, easing: "ease-in-out" }
            );
          }
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontWeight: 700, color: isCustomer ? "rgba(255,255,255,0.85)" : "#7c3aed", marginBottom: "2px" }, children: rName }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { color: isCustomer ? "rgba(255,255,255,0.7)" : "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: preview })
        ]
      }
    );
  };
  const renderAttachment = () => {
    const url = attachment?.url ?? contentUrl;
    const fileName = attachment?.fileName ?? url.split("/").pop()?.split("?")[0] ?? "file";
    if (effectiveType === "IMAGE") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { cursor: "pointer" }, onClick: () => onImageClick?.(url, fileName), children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { src: url, alt: fileName, style: { maxWidth: "220px", maxHeight: "180px", borderRadius: "12px", objectFit: "cover", display: "block" }, loading: "lazy" }) });
    if (effectiveType === "VIDEO") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("video", { src: url, controls: true, style: { maxWidth: "240px", maxHeight: "180px", borderRadius: "12px" }, preload: "metadata" });
    if (effectiveType === "AUDIO") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CompactAudioPlayer, { src: url, isCustomer });
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("a", { href: url, target: "_blank", rel: "noopener noreferrer", style: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "10px", backgroundColor: isCustomer ? "rgba(255,255,255,0.15)" : "#f3f4f6", color: isCustomer ? "#fff" : "#5b4fcf", fontSize: "13px", fontWeight: 600, textDecoration: "none" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: fileName })
    ] });
  };
  const bubbleStyle = isAudio ? { ...isCustomer ? { background: styles.bubbleCustomer.background ?? "#5b4fcf", borderRadius: "18px 18px 4px 18px" } : { background: "#ffffff", border: "1px solid #ede9fe", borderRadius: "18px 18px 18px 4px" }, padding: "8px 10px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: "2px" } : isCustomer ? styles.bubbleCustomer : styles.bubbleAgent;
  const Timestamps = () => isCustomer ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...styles.timestamp, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: time }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CustomerTick, { status: tickStatus })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...styles.timestamp, textAlign: "left" }, children: time });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "div",
    {
      style: { display: "flex", flexDirection: "column", alignItems: isCustomer ? "flex-end" : "flex-start" },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      children: [
        label && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: styles.senderLabel, children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { position: "relative", ...isAudio ? { width: "fit-content" } : { maxWidth: "82%" } }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...bubbleStyle, ...isAudio ? {} : { maxWidth: "100%" } }, children: [
            renderReplyQuote(),
            isAttachment ? renderAttachment() : message.content,
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Timestamps, {})
          ] }),
          onReply && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              onClick: () => onReply(message),
              title: "Reply",
              style: { position: "absolute", top: "50%", ...isCustomer ? { left: "-32px" } : { right: "-32px" }, transform: "translateY(-50%)", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", flexShrink: 0, transition: "opacity 0.15s", padding: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" },
              onMouseEnter: (e) => {
                e.currentTarget.style.background = "#ede9fe";
                e.currentTarget.style.color = "#5b4fcf";
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.background = "#f3f4f6";
                e.currentTarget.style.color = "#6b7280";
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ReplyIcon, {})
            }
          )
        ] })
      ]
    }
  );
});

// src/widget/QuickReplies.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function QuickReplies({ replies, onSelect, primaryColor }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: "8px", backgroundColor: "#fafafa", borderTop: "1px solid #f0f0f0", flexShrink: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }, children: "How can we help?" }),
    replies.map((r) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        style: { width: "100%", padding: "10px 16px", borderRadius: "12px", border: "1.5px solid #e0d9ff", backgroundColor: "#ffffff", color: primaryColor, cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: "8px", textAlign: "left", transition: "all 0.15s" },
        onClick: () => onSelect(r),
        onMouseEnter: (e) => {
          e.currentTarget.style.backgroundColor = "#ede9fe";
          e.currentTarget.style.borderColor = primaryColor;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.backgroundColor = "#ffffff";
          e.currentTarget.style.borderColor = "#e0d9ff";
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 16 }, children: r.icon }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: r.label })
        ]
      },
      r.id
    ))
  ] });
}
function FAQScreen({ primaryColor, onSelect, onBack }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { borderTop: "1px solid #f0f0f0", flexShrink: 0, backgroundColor: "#fafafa" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        onClick: onBack,
        style: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px 4px", background: "none", border: "none", cursor: "pointer", color: primaryColor, fontSize: "12px", fontWeight: 600, fontFamily: "inherit" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(BackIcon, {}),
          " Back to menu"
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { padding: "2px 14px 6px", fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }, children: "Frequently Asked Questions" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { maxHeight: "230px", overflowY: "auto", padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: "6px" }, children: FAQ_ITEMS.map((faq) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        style: { width: "100%", padding: "9px 14px", borderRadius: "10px", border: "1.5px solid #e0d9ff", backgroundColor: "#ffffff", color: primaryColor, cursor: "pointer", fontSize: "13px", fontWeight: 500, fontFamily: "inherit", display: "flex", alignItems: "center", gap: "8px", textAlign: "left", transition: "all 0.15s" },
        onClick: () => onSelect(faq),
        onMouseEnter: (e) => {
          e.currentTarget.style.backgroundColor = "#ede9fe";
          e.currentTarget.style.borderColor = primaryColor;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.backgroundColor = "#ffffff";
          e.currentTarget.style.borderColor = "#e0d9ff";
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 15 }, children: faq.icon }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: faq.label })
        ]
      },
      faq.id
    )) })
  ] });
}

// src/widget/Screens.tsx
var import_react5 = __toESM(require("react"));
var import_jsx_runtime7 = require("react/jsx-runtime");
function EscalatingScreen({ primaryColor, onTimeout }) {
  (0, import_react5.useEffect)(() => {
    const t = setTimeout(onTimeout, 5e3);
    return () => clearTimeout(t);
  }, [onTimeout]);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "32px", backgroundColor: "#fafafa", textAlign: "center" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 52 }, children: "\u{1F464}" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontWeight: 700, fontSize: 16, color: "#1a1a2e", marginBottom: 8 }, children: "Connecting you to an agent" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 13, color: "#6b7280", lineHeight: 1.7 }, children: [
        "You've been added to the support queue.",
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("br", {}),
        "An agent will join shortly."
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", gap: 8 }, children: [0, 0.2, 0.4].map((d, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { width: 9, height: 9, borderRadius: "50%", backgroundColor: primaryColor, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` } }, i)) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { padding: "8px 20px", borderRadius: 20, backgroundColor: "#ede9fe", color: primaryColor, fontSize: 12, fontWeight: 700 }, children: "Est. wait: < 2 min" })
  ] });
}
function FeedbackModal({ primaryColor, onSubmit, onSkip }) {
  const [rating, setRating] = import_react5.default.useState(0);
  const [hovered, setHovered] = import_react5.default.useState(0);
  const [comment, setComment] = import_react5.default.useState("");
  const [submitted, setSubmitted] = import_react5.default.useState(false);
  const labels = ["Terrible", "Bad", "Okay", "Good", "Excellent"];
  const handleSubmit = () => {
    if (rating === 0) return;
    setSubmitted(true);
    setTimeout(() => onSubmit(rating, comment), 900);
  };
  if (submitted) return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", padding: "32px", backgroundColor: "#fafafa" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 52 }, children: "\u{1F389}" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { textAlign: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 6 }, children: "Thank you!" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 13, color: "#6b7280", lineHeight: 1.6 }, children: "Your feedback helps us improve." })
    ] })
  ] });
  const active = hovered || rating;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#fafafa", padding: "28px 24px 20px", gap: "20px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { textAlign: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 28, marginBottom: "10px" }, children: "\u2B50" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }, children: "How was your experience?" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }, children: "Your feedback helps us serve you better" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", gap: "10px" }, children: [1, 2, 3, 4, 5].map((star) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          onClick: () => setRating(star),
          onMouseEnter: () => setHovered(star),
          onMouseLeave: () => setHovered(0),
          style: { background: "none", border: "none", cursor: "pointer", padding: "2px", fontSize: "32px", lineHeight: 1, transition: "transform 0.15s", transform: active >= star ? "scale(1.15)" : "scale(1)", filter: active >= star ? "drop-shadow(0 2px 4px rgba(234,179,8,0.4))" : "grayscale(1) opacity(0.35)" },
          children: "\u2B50"
        },
        star
      )) }),
      active > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: "12px", fontWeight: 600, color: primaryColor }, children: labels[active - 1] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "6px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("label", { style: { fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }, children: "Tell us more (optional)" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "textarea",
        {
          value: comment,
          onChange: (e) => setComment(e.target.value),
          placeholder: "What could we do better?",
          rows: 3,
          style: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "12px", border: `1.5px solid ${comment ? primaryColor + "88" : "#e5e7eb"}`, fontSize: "13px", fontFamily: "inherit", resize: "none", backgroundColor: "#ffffff", color: "#111827", outline: "none", transition: "border-color 0.2s", lineHeight: 1.5 }
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: "10px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: onSkip, style: { flex: 1, padding: "10px", borderRadius: "22px", border: "1.5px solid #e5e7eb", background: "#ffffff", color: "#6b7280", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }, children: "Skip" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          onClick: handleSubmit,
          disabled: rating === 0,
          style: { flex: 2, padding: "10px", borderRadius: "22px", border: "none", background: rating > 0 ? `linear-gradient(135deg,${primaryColor},${primaryColor}cc)` : "#f3f4f6", color: rating > 0 ? "#ffffff" : "#9ca3af", fontSize: "13px", fontWeight: 700, cursor: rating > 0 ? "pointer" : "not-allowed", fontFamily: "inherit" },
          children: "Submit Feedback"
        }
      )
    ] })
  ] });
}
function EndChatConfirmModal({ onConfirm, onCancel }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { position: "absolute", inset: 0, zIndex: 50, backgroundColor: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end" }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { width: "100%", backgroundColor: "#ffffff", borderRadius: "20px 20px 0 0", padding: "24px 20px 28px", boxShadow: "0 -8px 32px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: "16px", animation: "chatFadeIn 0.2s ease" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 2 } }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { textAlign: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 36, marginBottom: "10px" }, children: "\u{1F44B}" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 15, fontWeight: 700, color: "#1a1a2e", marginBottom: 6 }, children: "End this chat?" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 13, color: "#6b7280", lineHeight: 1.6 }, children: [
        "This will close your current session.",
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("br", {}),
        "You'll have a chance to leave feedback."
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: "10px", marginTop: 4 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: onCancel, style: { flex: 1, padding: "12px", borderRadius: "14px", border: "1.5px solid #e5e7eb", background: "#f9fafb", color: "#374151", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }, children: "Keep Chatting" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: onConfirm, style: { flex: 1, padding: "12px", borderRadius: "14px", border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#ffffff", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }, children: "End Chat" })
    ] })
  ] }) });
}

// src/widget/WidgetHeader.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function WidgetHeader({ onClose, styles, subtitle, theme, onEndChat, showEndChat, onHistory, showHistory }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: styles.header, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: styles.headerAvatar, children: "\u{1F4AC}" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: styles.headerInfo, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { style: styles.headerTitle, children: "Chat Support" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: styles.headerSub, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: styles.onlineDot }),
        subtitle
      ] })
    ] }),
    onHistory && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "button",
      {
        onClick: onHistory,
        title: showHistory ? "Back to chat" : "Chat history",
        style: { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", color: theme.headerText, cursor: "pointer", padding: "6px 8px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", marginRight: "4px", transition: "all 0.15s" },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.22)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.12)";
        },
        children: showHistory ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("polyline", { points: "15 18 9 12 15 6" }) }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("circle", { cx: "12", cy: "12", r: "10" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("polyline", { points: "12 6 12 12 16 14" })
        ] })
      }
    ),
    showEndChat && onEndChat && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "button",
      {
        onClick: onEndChat,
        title: "End chat",
        style: { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", color: theme.headerText, cursor: "pointer", padding: "6px 10px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, marginRight: "6px", transition: "all 0.15s", letterSpacing: "0.02em" },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = "rgba(239,68,68,0.3)";
          e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.12)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(PhoneDownIcon, {}),
          " End"
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { style: styles.closeBtn, onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(CloseIcon, {}) })
  ] });
}

// src/widget/SessionHistoryPanel.tsx
var import_react6 = require("react");
var import_jsx_runtime9 = require("react/jsx-runtime");
function SessionHistoryPanel({ primaryColor, sessions, currentSessionId, onSelectActive, onReopen }) {
  const [reopening, setReopening] = (0, import_react6.useState)(null);
  const active = sessions.filter((s) => s.status !== "CLOSED");
  const closed = sessions.filter((s) => s.status === "CLOSED").slice(0, 5);
  const formatDate = (d) => {
    if (!d) return "";
    const date = new Date(d);
    if (isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    if (diff < 6e4) return "Just now";
    if (diff < 36e5) return `${Math.round(diff / 6e4)}m ago`;
    if (diff < 864e5) return `${Math.round(diff / 36e5)}h ago`;
    if (diff < 7 * 864e5) return `${Math.round(diff / 864e5)}d ago`;
    return date.toLocaleDateString(void 0, { month: "short", day: "numeric" });
  };
  const handleReopen = async (id) => {
    setReopening(id);
    try {
      await onReopen(id);
    } finally {
      setReopening(null);
    }
  };
  const badge = (status) => {
    const map = {
      OPEN: { label: "Open", bg: "#dcfce7", color: "#166534" },
      WAITING_FOR_AGENT: { label: "Waiting", bg: "#fef9c3", color: "#854d0e" },
      ASSIGNED: { label: "Active", bg: "#dbeafe", color: "#1e40af" },
      CLOSED: { label: "Closed", bg: "#f3f4f6", color: "#6b7280" }
    };
    const s = map[status] ?? { label: status, bg: "#f3f4f6", color: "#6b7280" };
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 700, background: s.bg, color: s.color, letterSpacing: "0.03em" }, children: s.label });
  };
  const renderRow = (s, isAct) => {
    const preview = s.lastMessage?.content?.trim();
    const previewText = preview ? preview.length > 55 ? preview.slice(0, 55) + "\u2026" : preview : "(no messages yet)";
    const isCurrent = s.id === currentSessionId;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { padding: "12px 16px", borderBottom: "1px solid #f0f0f5", display: "flex", flexDirection: "column", gap: "6px", backgroundColor: isCurrent ? "#f9f7ff" : "#ffffff" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }, children: [
          badge(s.status),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { fontSize: "11px", color: "#9ca3af" }, children: formatDate(s.closedAt ?? s.createdAt) })
        ] }),
        isAct ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "button",
          {
            onClick: onSelectActive,
            style: { padding: "5px 12px", borderRadius: "14px", border: `1.5px solid ${primaryColor}`, background: isCurrent ? primaryColor : "transparent", color: isCurrent ? "#ffffff" : primaryColor, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
            children: isCurrent ? "Current \u2713" : "Continue"
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "button",
          {
            onClick: () => handleReopen(s.id),
            disabled: reopening === s.id,
            style: { padding: "5px 12px", borderRadius: "14px", border: `1.5px solid ${primaryColor}`, background: "transparent", color: primaryColor, fontSize: "11px", fontWeight: 700, cursor: reopening === s.id ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: reopening === s.id ? 0.6 : 1, whiteSpace: "nowrap" },
            children: reopening === s.id ? "\u2026" : "Reopen"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { fontSize: "12px", color: "#6b7280", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: previewText })
    ] }, s.id);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", backgroundColor: "#fafafa" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { padding: "12px 16px 4px", fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", backgroundColor: "#fafafa" }, children: "Active" }),
    active.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { padding: "12px 16px", fontSize: "13px", color: "#c4b5fd", textAlign: "center" }, children: "No active sessions" }),
    active.map((s) => renderRow(s, true)),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { padding: "12px 16px 4px", fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", backgroundColor: "#fafafa", borderTop: "1px solid #f0f0f5", marginTop: "4px" }, children: "Closed" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { flex: 1, overflowY: "auto" }, children: [
      closed.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { padding: "16px", fontSize: "13px", color: "#c4b5fd", textAlign: "center" }, children: "No closed sessions yet" }),
      closed.map((s) => renderRow(s, false))
    ] })
  ] });
}

// src/widget/ChatContentInner.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
function ChatContentInner({ onClose, styles, config, theme, onStartNewChat, externalMessagesAreaRef }) {
  const { state, actions } = useChat();
  const [inputValue, setInputValue] = (0, import_react7.useState)("");
  const [flowStep, setFlowStep] = (0, import_react7.useState)("menu");
  const [showQuickReplies, setShowQuickReplies] = (0, import_react7.useState)(true);
  const [escalationError, setEscalationError] = (0, import_react7.useState)(null);
  const [viewerImage, setViewerImage] = (0, import_react7.useState)(null);
  const [isRecording, setIsRecording] = (0, import_react7.useState)(false);
  const [replyTarget, setReplyTarget] = (0, import_react7.useState)(null);
  const [showEndConfirm, setShowEndConfirm] = (0, import_react7.useState)(false);
  const [showFeedback, setShowFeedback] = (0, import_react7.useState)(false);
  const [endingChat, setEndingChat] = (0, import_react7.useState)(false);
  const [showHistory, setShowHistory] = (0, import_react7.useState)(false);
  const inputRef = (0, import_react7.useRef)(null);
  const fileInputRef = (0, import_react7.useRef)(null);
  const mediaRecorderRef = (0, import_react7.useRef)(null);
  const audioChunksRef = (0, import_react7.useRef)([]);
  const typingTimeoutRef = (0, import_react7.useRef)();
  const hasInited = (0, import_react7.useRef)(false);
  const prevMsgCount = (0, import_react7.useRef)(0);
  const prevSoundCount = (0, import_react7.useRef)(0);
  const messagesAreaRef = externalMessagesAreaRef;
  const messagesEndRef = (0, import_react7.useRef)(null);
  const shouldScrollBottom = (0, import_react7.useRef)(true);
  const savedScrollHeightRef = (0, import_react7.useRef)(0);
  const prevMsgCountLayoutRef = (0, import_react7.useRef)(0);
  const maxScrollTopRef = (0, import_react7.useRef)(0);
  const isRestoringScroll = (0, import_react7.useRef)(false);
  const [showJumpToBottom, setShowJumpToBottom] = (0, import_react7.useState)(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = (0, import_react7.useState)(0);
  const renderedMsgIds = (0, import_react7.useRef)(/* @__PURE__ */ new Set());
  const hasRenderedOnce = (0, import_react7.useRef)(false);
  const stateRef = (0, import_react7.useRef)(state);
  const actionsRef = (0, import_react7.useRef)(actions);
  const configRef = (0, import_react7.useRef)(config);
  (0, import_react7.useEffect)(() => {
    stateRef.current = state;
  }, [state]);
  (0, import_react7.useEffect)(() => {
    actionsRef.current = actions;
  }, [actions]);
  (0, import_react7.useEffect)(() => {
    configRef.current = config;
  }, [config]);
  (0, import_react7.useEffect)(() => {
    const id = "chat-sdk-kf";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @keyframes chatTypingBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}
      @keyframes chatFadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse-recording{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
      @keyframes chatUploadPulse{0%{width:0%;margin-left:0%}50%{width:60%;margin-left:20%}100%{width:0%;margin-left:100%}}
    `;
    document.head.appendChild(s);
  }, []);
  (0, import_react7.useEffect)(() => {
    if (!state.connected || state.loading) return;
    if (hasInited.current) return;
    hasInited.current = true;
    const sess = stateRef.current.session;
    const msgs = stateRef.current.messages;
    const hasAgentSession = sess?.status === "ASSIGNED" || sess?.status === "WAITING_FOR_AGENT" || sess?.mode === "HUMAN";
    const hasHistory = msgs.some((m) => m.senderType === "CUSTOMER") || msgs.some((m) => m.senderType === "AGENT");
    if (hasAgentSession || hasHistory) {
      setFlowStep("free");
      setShowQuickReplies(false);
    } else {
      setFlowStep("menu");
      setShowQuickReplies(true);
    }
  }, [state.connected, state.loading]);
  (0, import_react7.useEffect)(() => {
    if (flowStep === "free") inputRef.current?.focus();
  }, [flowStep]);
  (0, import_react7.useEffect)(() => {
    const newCount = state.messages.length;
    if (newCount > prevMsgCount.current) {
      const newMsgs = state.messages.slice(prevMsgCount.current);
      if (newMsgs.some((m) => m.senderType === "AGENT") && flowStep !== "free") {
        setFlowStep("free");
        setShowQuickReplies(false);
      }
    }
    prevMsgCount.current = newCount;
  }, [state.messages, flowStep]);
  (0, import_react7.useEffect)(() => {
    if (flowStep !== "escalating") return;
    const status = state.session?.status;
    const mode = state.session?.mode;
    if (status === "ASSIGNED" || status === "WAITING_FOR_AGENT" || mode === "HUMAN") {
      setFlowStep("free");
      setShowQuickReplies(false);
    }
  }, [state.session?.status, state.session?.mode, flowStep]);
  (0, import_react7.useEffect)(() => {
    const newCount = state.messages.length;
    if (newCount > prevSoundCount.current) {
      const newMsgs = state.messages.slice(prevSoundCount.current);
      if (newMsgs.some((m) => m.senderType === "AGENT" || m.senderType === "BOT") && !state.isWidgetOpen) playNotificationSound();
    }
    prevSoundCount.current = newCount;
  }, [state.messages.length, state.isWidgetOpen]);
  (0, import_react7.useEffect)(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);
  (0, import_react7.useEffect)(() => {
    if (!state.isWidgetOpen || !state.session?.id) return;
    const t = setTimeout(() => {
      actionsRef.current.markMessagesRead?.().catch(() => {
      });
    }, 200);
    return () => clearTimeout(t);
  }, [state.isWidgetOpen, state.session?.id, state.messages.length]);
  (0, import_react7.useEffect)(() => {
    if (showHistory) actionsRef.current.fetchPastSessions?.().catch(() => {
    });
  }, [showHistory]);
  const waitForSession = (0, import_react7.useCallback)(() => {
    return new Promise((resolve, reject) => {
      if (stateRef.current.session?.id) {
        resolve(stateRef.current.session.id);
        return;
      }
      const max = 8e3;
      const step = 200;
      let elapsed = 0;
      const t = setInterval(() => {
        elapsed += step;
        const id = stateRef.current.session?.id;
        if (id) {
          clearInterval(t);
          resolve(id);
        } else if (elapsed >= max) {
          clearInterval(t);
          reject(new Error("Session not ready \u2014 please try again"));
        }
      }, step);
    });
  }, []);
  const escalateToAgent = (0, import_react7.useCallback)(async (sessionId, reason) => {
    const cfg = configRef.current;
    const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/escalate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.token}`, "X-Tenant-ID": cfg.tenantId, "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Escalation failed (${res.status}): ${body}`);
    }
  }, []);
  const allMessages = (0, import_react7.useMemo)(() => {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const m of state.messages) {
      seen.add(m.id);
      result.push(m);
    }
    return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [state.messages]);
  (0, import_react7.useLayoutEffect)(() => {
    const el = messagesAreaRef.current;
    const msgCount = allMessages.length;
    if (el && msgCount > prevMsgCountLayoutRef.current && !shouldScrollBottom.current && savedScrollHeightRef.current > 0) {
      const diff = el.scrollHeight - savedScrollHeightRef.current;
      if (diff > 0) {
        isRestoringScroll.current = true;
        el.scrollTop = diff;
        shouldScrollBottom.current = false;
        maxScrollTopRef.current = diff;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          isRestoringScroll.current = false;
          const el2 = messagesAreaRef.current;
          if (el2) {
            const atBottom = el2.scrollHeight - el2.scrollTop - el2.clientHeight < 60;
            shouldScrollBottom.current = atBottom;
          }
        }));
      }
      savedScrollHeightRef.current = 0;
    }
    prevMsgCountLayoutRef.current = msgCount;
  }, [allMessages.length, messagesAreaRef]);
  (0, import_react7.useEffect)(() => {
    allMessages.forEach((m) => renderedMsgIds.current.add(m.id));
    hasRenderedOnce.current = true;
  }, [allMessages]);
  const msgByIdMap = (0, import_react7.useMemo)(() => {
    const map = /* @__PURE__ */ new Map();
    for (const m of allMessages) map.set(m.id, m);
    return map;
  }, [allMessages]);
  const agentOnline = (0, import_react7.useMemo)(() => {
    if (state.session?.assignedAgent?.isOnline === true) return true;
    if (state.session?.assignedAgentId) return true;
    return allMessages.some((m) => m.senderType === "AGENT");
  }, [state.session?.assignedAgent?.isOnline, state.session?.assignedAgentId, allMessages]);
  const agentReadAt = (0, import_react7.useMemo)(() => {
    const raw = state.agentReadAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const latestAgentMsg = [...allMessages].reverse().find((m) => m.senderType === "AGENT");
    if (latestAgentMsg) {
      const agentMsgTime = new Date(latestAgentMsg.timestamp);
      return new Date(Math.max(d.getTime(), agentMsgTime.getTime()));
    }
    return d;
  }, [state.agentReadAt, allMessages]);
  const tickMap = (0, import_react7.useMemo)(() => buildTickMap({
    messages: allMessages.map((m) => {
      const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp);
      return { id: m.id, createdAt: isNaN(ts.getTime()) ? (/* @__PURE__ */ new Date()).toISOString() : ts.toISOString(), senderType: m.senderType };
    }),
    viewerSenderType: "CUSTOMER",
    readAt: agentReadAt,
    otherPartyOnline: agentOnline
  }), [allMessages, agentReadAt, agentOnline]);
  const handleImageClick = (0, import_react7.useCallback)((url, fileName) => setViewerImage({ url, fileName }), []);
  const handleReply = (0, import_react7.useCallback)((m) => {
    setReplyTarget({ id: m.id, content: m.content, senderType: m.senderType, senderName: m.senderName });
    inputRef.current?.focus();
  }, []);
  const scrollToBottomNow = (0, import_react7.useCallback)((behavior = "smooth") => {
    const el = messagesAreaRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
    shouldScrollBottom.current = true;
    setShowJumpToBottom(false);
    setUnreadWhileScrolled(0);
  }, [messagesAreaRef]);
  const lastMsgId = allMessages.length > 0 ? allMessages[allMessages.length - 1].id : null;
  const lastMsgType = allMessages.length > 0 ? allMessages[allMessages.length - 1].senderType : null;
  const lastMessageIdRef = (0, import_react7.useRef)(null);
  const scrollInitSeeded = (0, import_react7.useRef)(false);
  (0, import_react7.useEffect)(() => {
    if (!lastMsgId) return;
    if (!scrollInitSeeded.current) {
      lastMessageIdRef.current = lastMsgId;
      scrollInitSeeded.current = true;
      return;
    }
    if (lastMsgId === lastMessageIdRef.current) return;
    lastMessageIdRef.current = lastMsgId;
    if (shouldScrollBottom.current) {
      scrollToBottomNow("smooth");
    } else {
      if (lastMsgType !== "CUSTOMER") {
        setUnreadWhileScrolled((c) => c + 1);
        setShowJumpToBottom(true);
      }
    }
  }, [lastMsgId, scrollToBottomNow]);
  (0, import_react7.useEffect)(() => {
    if (state.isTyping && shouldScrollBottom.current) scrollToBottomNow("smooth");
  }, [state.isTyping, scrollToBottomNow]);
  const handleMessagesScroll = (0, import_react7.useCallback)(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    if (el.scrollTop > maxScrollTopRef.current) maxScrollTopRef.current = el.scrollTop;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!isRestoringScroll.current) {
      shouldScrollBottom.current = isAtBottom;
      setShowJumpToBottom(!isAtBottom);
    }
    if (el.scrollTop < 60 && maxScrollTopRef.current > 200 && el.scrollTop < maxScrollTopRef.current - 100 && !state.loadingMore && state.hasMore) {
      savedScrollHeightRef.current = el.scrollHeight;
      shouldScrollBottom.current = false;
      void actions.loadOlderMessages();
    }
  }, [state.loadingMore, state.hasMore, messagesAreaRef]);
  const scrollToBottom = (0, import_react7.useCallback)(() => scrollToBottomNow("smooth"), [scrollToBottomNow]);
  const sendRealMessage = (0, import_react7.useCallback)((content) => {
    if (!stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      void actionsRef.current.sendMessage(content, "TEXT");
      setFlowStep("free");
      setShowQuickReplies(false);
    } catch (err) {
      if (err?.message === "TOKEN_EXPIRED") return;
      throw err;
    }
  }, []);
  const handleQuickReply = (0, import_react7.useCallback)(async (reply) => {
    setShowQuickReplies(false);
    setEscalationError(null);
    switch (reply.id) {
      case "order_details":
      case "track_order":
        sendRealMessage(reply.label);
        break;
      case "faq":
        setFlowStep("faq");
        break;
      case "human": {
        setFlowStep("escalating");
        const sessionId = stateRef.current.session?.id;
        if (!sessionId) {
          setEscalationError("Session not ready. Please try again.");
          setFlowStep("menu");
          setTimeout(() => setShowQuickReplies(true), 500);
          break;
        }
        const forceFreetimer = setTimeout(() => {
          setFlowStep("free");
          setShowQuickReplies(false);
        }, 5e3);
        escalateToAgent(sessionId, "Customer requested human agent").then(() => clearTimeout(forceFreetimer)).catch((err) => {
          clearTimeout(forceFreetimer);
          if (stateRef.current.session?.status !== "ASSIGNED" && stateRef.current.session?.mode !== "HUMAN") {
            setEscalationError(err?.message ?? "Could not connect. Please try again.");
            setFlowStep("menu");
            setTimeout(() => setShowQuickReplies(true), 500);
          }
        });
        break;
      }
    }
  }, [sendRealMessage, waitForSession, escalateToAgent]);
  const handleFaqSelect = (0, import_react7.useCallback)((faq) => {
    sendRealMessage(faq.label);
  }, [sendRealMessage]);
  const handleSend = (0, import_react7.useCallback)(() => {
    const content = inputValue.trim();
    if (!content || !stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      void actionsRef.current.sendMessage(content, "TEXT", replyTarget?.id);
      setInputValue("");
      setReplyTarget(null);
      actionsRef.current.stopTyping?.();
      if (flowStep !== "free") {
        setShowQuickReplies(false);
        setFlowStep("free");
      }
    } catch (err) {
      if (err?.message === "TOKEN_EXPIRED") return;
      throw err;
    }
  }, [inputValue, flowStep, replyTarget]);
  const handleEndChat = (0, import_react7.useCallback)(async () => {
    setShowEndConfirm(false);
    setEndingChat(true);
    const sessionId = stateRef.current.session?.id;
    const cfg = configRef.current;
    if (sessionId) {
      try {
        await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/close`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${cfg.token}`, "X-Tenant-ID": cfg.tenantId, "Content-Type": "application/json" },
          body: JSON.stringify({ closeReason: "MANUAL" })
        });
      } catch {
      }
    }
    setEndingChat(false);
    onClose();
    onStartNewChat?.();
  }, []);
  const handleKeyDown = (0, import_react7.useCallback)((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  const handleAttachment = (0, import_react7.useCallback)(async (e) => {
    const file = e.target.files?.[0];
    if (!file || stateRef.current.tokenExpired) return;
    try {
      await actionsRef.current.sendAttachment(file);
    } catch {
    }
    e.target.value = "";
  }, []);
  const startRecording = (0, import_react7.useCallback)(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: recorder.mimeType });
        try {
          await actionsRef.current.sendAttachment(file);
        } catch {
        }
        setIsRecording(false);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
    }
  }, []);
  const stopRecording = (0, import_react7.useCallback)(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  }, []);
  const handleInputChange = (0, import_react7.useCallback)((e) => {
    setInputValue(e.target.value);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    } else {
      actionsRef.current.startTyping?.();
    }
    typingTimeoutRef.current = setTimeout(() => {
      actionsRef.current.stopTyping?.();
      typingTimeoutRef.current = void 0;
    }, 2e3);
  }, []);
  const subtitle = (() => {
    if (state.tokenExpired) return "Session Expired";
    if (state.loading) return "Connecting...";
    if (flowStep === "escalating") return "Connecting to agent...";
    const agentDisplayName = state.session?.assignedAgent?.displayName ?? state.session?.assignedAgentName;
    if (agentDisplayName && !looksLikeRawId(agentDisplayName)) return `Chatting with ${agentDisplayName}`;
    if (state.session?.mode === "HUMAN") return "Connected to agent";
    return "AI Support \xB7 Online";
  })();
  const isClosed = state.session?.status === "CLOSED";
  const canType = !isClosed && !state.tokenExpired && state.connected && flowStep !== "escalating";
  const isActive = !!inputValue.trim() && canType;
  if (state.loading) return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.widget, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(WidgetHeader, { onClose, styles, subtitle: "Connecting...", theme }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.centeredBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("svg", { width: "36", height: "36", viewBox: "0 0 24 24", fill: "none", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("circle", { cx: "12", cy: "12", r: "10", stroke: "#e5e7eb", strokeWidth: "3" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M12 2a10 10 0 0 1 10 10", stroke: theme.primaryColor, strokeWidth: "3", strokeLinecap: "round", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontSize: 13, color: "#9ca3af" }, children: "Starting chat..." })
    ] })
  ] });
  if (state.tokenExpired) return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.widget, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(WidgetHeader, { onClose, styles, subtitle: "Session Expired", theme }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.centeredBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 40 }, children: "\u23F3" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 6 }, children: "Session Expired" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 13, color: "#6b7280", lineHeight: 1.5 }, children: "Your session has expired. Please refresh to continue chatting." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => window.location.reload(), style: { padding: "10px 28px", borderRadius: 22, border: "none", background: theme.primaryColor, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }, children: "Refresh Page" })
    ] })
  ] });
  if (state.error && !state.connected) return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.widget, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(WidgetHeader, { onClose, styles, subtitle: "Disconnected", theme }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.centeredBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 40 }, children: "\u26A0\uFE0F" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 6 }, children: "Connection Lost" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 13, color: "#6b7280" }, children: state.error.message })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => actionsRef.current.reconnect?.(), style: { padding: "10px 28px", borderRadius: 22, border: "none", background: theme.primaryColor, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }, children: "Retry" })
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { ...styles.widget, position: "relative" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      WidgetHeader,
      {
        onClose,
        styles,
        subtitle: showHistory ? "Chat History" : endingChat ? "Ending session\u2026" : subtitle,
        theme,
        showEndChat: !showHistory && !isClosed && !showFeedback && state.connected && flowStep !== "escalating",
        onEndChat: () => setShowEndConfirm(true),
        onHistory: () => setShowHistory((p) => !p),
        showHistory
      }
    ),
    showHistory && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      SessionHistoryPanel,
      {
        primaryColor: theme.primaryColor,
        sessions: state.pastSessions,
        currentSessionId: state.session?.id,
        onSelectActive: () => setShowHistory(false),
        onReopen: async (sessionId) => {
          await actionsRef.current.reopenSession?.(sessionId);
          setShowHistory(false);
        },
        onBack: () => setShowHistory(false)
      }
    ),
    !showHistory && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      showEndConfirm && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(EndChatConfirmModal, { primaryColor: theme.primaryColor, onConfirm: handleEndChat, onCancel: () => setShowEndConfirm(false) }),
      showFeedback ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
        FeedbackModal,
        {
          primaryColor: theme.primaryColor,
          onSubmit: () => {
            setShowFeedback(false);
            onClose();
            onStartNewChat?.();
          },
          onSkip: () => {
            setShowFeedback(false);
            onClose();
            onStartNewChat?.();
          }
        }
      ) : flowStep === "escalating" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(EscalatingScreen, { primaryColor: theme.primaryColor, onTimeout: () => {
        setFlowStep("free");
        setShowQuickReplies(false);
      } }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { ...styles.messages, position: "relative" }, ref: messagesAreaRef, onScroll: handleMessagesScroll, children: [
          state.loadingMore && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 0 6px", gap: "8px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(SpinnerIcon, { color: theme.primaryColor, size: 16 }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontSize: "11px", color: "#9ca3af" }, children: "Loading older messages\u2026" })
          ] }),
          !state.hasMore && allMessages.length > 0 && !state.loadingMore && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 0 12px" }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontSize: "10px", fontWeight: 600, color: "#c4b5fd", backgroundColor: "#f3eeff", padding: "3px 12px", borderRadius: "10px" }, children: "Beginning of conversation" }) }),
          allMessages.map((msg) => {
            const isNew = hasRenderedOnce.current && !renderedMsgIds.current.has(msg.id);
            return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { id: `chat-msg-${msg.id}`, style: isNew ? { animation: "chatFadeIn 0.2s ease", borderRadius: "12px" } : { borderRadius: "12px" }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              MessageBubble,
              {
                message: msg,
                styles,
                userName: config.user.name,
                onImageClick: handleImageClick,
                onReply: handleReply,
                replyToResolved: msg.replyToMessageId ? msgByIdMap.get(msg.replyToMessageId) ?? null : null,
                tickStatus: tickMap.get(msg.id) ?? "none",
                primaryColor: theme.primaryColor
              }
            ) }, msg.id);
          }),
          state.isTyping && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(TypingIndicator, { styles }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { ref: messagesEndRef })
        ] }),
        showJumpToBottom && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { position: "relative", height: 0, zIndex: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "button",
            {
              onClick: scrollToBottom,
              "aria-label": "Scroll to latest messages",
              style: { position: "absolute", bottom: "8px", right: "16px", width: "36px", height: "36px", borderRadius: "50%", backgroundColor: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: theme.primaryColor, transition: "all 0.15s" },
              onMouseEnter: (e) => {
                e.currentTarget.style.backgroundColor = theme.primaryColor;
                e.currentTarget.style.color = "#ffffff";
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.backgroundColor = "#ffffff";
                e.currentTarget.style.color = theme.primaryColor;
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ChevronDownIcon, {})
            }
          ),
          unreadWhileScrolled > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { position: "absolute", bottom: "38px", right: "12px", background: theme.primaryColor, color: "#fff", fontSize: "10px", fontWeight: 700, lineHeight: 1, padding: "3px 6px", borderRadius: "10px", minWidth: "18px", textAlign: "center", boxShadow: `0 2px 6px ${theme.primaryColor}55`, pointerEvents: "none" }, children: unreadWhileScrolled > 99 ? "99+" : unreadWhileScrolled })
        ] }),
        escalationError && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { margin: "8px 12px", padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: "\u26A0\uFE0F" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { flex: 1 }, children: escalationError }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => setEscalationError(null), style: { background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18, lineHeight: 1 }, children: "\xD7" })
        ] }),
        flowStep === "faq" && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(FAQScreen, { primaryColor: theme.primaryColor, onSelect: handleFaqSelect, onBack: () => {
          setFlowStep("menu");
          setShowQuickReplies(true);
        } }),
        flowStep === "menu" && showQuickReplies && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(QuickReplies, { replies: MAIN_MENU, onSelect: handleQuickReply, primaryColor: theme.primaryColor }),
        isClosed ? state.closeReason === "SWITCHED" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { padding: "16px 14px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", borderTop: "1px solid #f0f0f5", backgroundColor: "#fafafa" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 28 }, children: "\u23F8" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { textAlign: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4 }, children: "Chat on Hold" }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }, children: [
              "This chat was put on hold while you switched to another session.",
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("br", {}),
              "You can resume it from your chat history."
            ] })
          ] }),
          onStartNewChat && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: onStartNewChat, style: { padding: "10px 24px", borderRadius: 22, border: "none", background: `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }, children: "+ Start New Chat" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { padding: "16px 14px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", borderTop: "1px solid #f0f0f5", backgroundColor: "#fafafa" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 28 }, children: "\u2705" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { textAlign: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4 }, children: "Chat Ended" }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }, children: [
              "This session has been closed.",
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("br", {}),
              "Need more help?"
            ] })
          ] }),
          onStartNewChat && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: onStartNewChat, style: { padding: "10px 24px", borderRadius: 22, border: "none", background: `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }, children: "+ Start New Chat" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { flexShrink: 0 }, children: [
          state.uploading && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { padding: "8px 14px", backgroundColor: theme.primaryColor + "10", borderTop: `1px solid ${theme.primaryColor}30`, display: "flex", alignItems: "center", gap: "8px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", style: { flexShrink: 0 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("circle", { cx: "12", cy: "12", r: "10", stroke: "#e5e7eb", strokeWidth: "3" }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M12 2a10 10 0 0 1 10 10", stroke: theme.primaryColor, strokeWidth: "3", strokeLinecap: "round", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { flex: 1, height: "3px", borderRadius: "2px", backgroundColor: theme.primaryColor + "25", overflow: "hidden" }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { height: "100%", borderRadius: "2px", backgroundColor: theme.primaryColor, animation: "chatUploadPulse 1.4s ease-in-out infinite" } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontSize: "11px", color: theme.primaryColor, fontWeight: 600, flexShrink: 0 }, children: "Uploading\u2026" })
          ] }),
          replyTarget && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { padding: "8px 12px", borderTop: "1px solid #f0f0f5", backgroundColor: "#f9fafb", display: "flex", alignItems: "center", gap: "8px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { flex: 1, borderLeft: `3px solid ${theme.primaryColor}`, paddingLeft: "10px", overflow: "hidden" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: "11px", fontWeight: 700, color: theme.primaryColor, marginBottom: "1px" }, children: replyTarget.senderType === "CUSTOMER" ? "You" : replyTarget.senderName || "Agent" }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontSize: "12px", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: replyTarget.content?.length > 80 ? replyTarget.content.slice(0, 80) + "\u2026" : replyTarget.content })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => setReplyTarget(null), style: { background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: "18px", lineHeight: 1, padding: "2px", flexShrink: 0 }, children: "\xD7" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: styles.inputArea, children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("input", { type: "file", ref: fileInputRef, style: { display: "none" }, accept: "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar", onChange: handleAttachment }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "button",
              {
                onClick: () => fileInputRef.current?.click(),
                disabled: !canType || state.uploading,
                title: "Attach file",
                style: { background: "none", border: "none", cursor: canType && !state.uploading ? "pointer" : "not-allowed", padding: "4px", display: "flex", alignItems: "center", opacity: canType && !state.uploading ? 0.6 : 0.3 },
                children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "#6b7280", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" }) })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "button",
              {
                onClick: isRecording ? stopRecording : startRecording,
                disabled: !canType || state.uploading,
                title: isRecording ? "Stop recording" : state.uploading ? "Uploading\u2026" : "Record audio",
                style: { background: isRecording ? "#ef4444" : "none", border: isRecording ? "2px solid #ef4444" : "none", borderRadius: "50%", cursor: canType && !state.uploading ? "pointer" : "not-allowed", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", opacity: canType && !state.uploading ? isRecording ? 1 : 0.6 : 0.3, width: 28, height: 28, animation: isRecording ? "pulse-recording 1.5s ease-in-out infinite" : "none", transition: "all 0.2s" },
                children: isRecording ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "#fff", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }) }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "#6b7280", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("rect", { x: "9", y: "1", width: "6", height: "11", rx: "3" }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M19 10v1a7 7 0 01-14 0v-1" }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("line", { x1: "12", y1: "19", x2: "12", y2: "23" }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("line", { x1: "8", y1: "23", x2: "16", y2: "23" })
                ] })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "input",
              {
                ref: inputRef,
                type: "text",
                placeholder: state.uploading ? "\u23F3 Uploading file, please wait..." : canType ? isRecording ? "\u{1F534} Recording audio..." : "Type a message..." : "Connecting...",
                value: inputValue,
                onChange: handleInputChange,
                onKeyDown: handleKeyDown,
                disabled: !canType,
                style: { ...styles.input, borderColor: inputValue ? theme.primaryColor + "88" : "#e5e7eb", opacity: canType ? 1 : 0.6 }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "button",
              {
                onClick: handleSend,
                disabled: !isActive,
                style: { ...styles.sendBtn, background: isActive ? `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)` : "#f3f4f6", boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : "none", cursor: isActive ? "pointer" : "not-allowed" },
                children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(SendIcon, { active: !!isActive })
              }
            )
          ] })
        ] })
      ] })
    ] }),
    viewerImage && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { onClick: () => setViewerImage(null), style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", zIndex: 1e5, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => setViewerImage(null), style: { position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22, fontWeight: 700, backdropFilter: "blur(4px)" }, "aria-label": "Close", children: "\xD7" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("a", { href: viewerImage.url, download: viewerImage.fileName, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: { position: "absolute", top: 16, right: 68, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", backdropFilter: "blur(4px)", textDecoration: "none" }, "aria-label": "Download", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("polyline", { points: "7 10 12 15 17 10" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("line", { x1: "12", y1: "15", x2: "12", y2: "3" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { onClick: (e) => e.stopPropagation(), style: { position: "absolute", top: 20, left: 16, right: 120, color: "#fff", fontSize: 13, fontWeight: 500, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: viewerImage.fileName }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("img", { src: viewerImage.url, alt: viewerImage.fileName, onClick: (e) => e.stopPropagation(), style: { maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", cursor: "default" } })
    ] })
  ] });
}
function ChatContentWithScrollRef({ scrollToBottomRef, ...props }) {
  const localMessagesAreaRef = (0, import_react7.useRef)(null);
  (0, import_react7.useEffect)(() => {
    scrollToBottomRef.current = () => {
      const el = localMessagesAreaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    return () => {
      scrollToBottomRef.current = null;
    };
  }, [scrollToBottomRef]);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ChatContentInner, { ...props, externalMessagesAreaRef: localMessagesAreaRef });
}

// src/ChatWidget.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function UnreadTracker({ isOpen, onUnreadChange, onTicketChange }) {
  const { state, actions } = useChat();
  const setWidgetOpenRef = (0, import_react8.useRef)(actions.setWidgetOpen);
  setWidgetOpenRef.current = actions.setWidgetOpen;
  (0, import_react8.useEffect)(() => {
    setWidgetOpenRef.current(isOpen);
  }, [isOpen]);
  (0, import_react8.useEffect)(() => {
    onUnreadChange(state.unreadCount);
  }, [state.unreadCount, onUnreadChange]);
  (0, import_react8.useEffect)(() => {
    onTicketChange(state.session?.ticketId ?? null);
  }, [state.session?.ticketId, onTicketChange]);
  return null;
}
function ChatWidget({ config, defaultOpen = false }) {
  const [isOpen, setIsOpen] = (0, import_react8.useState)(defaultOpen);
  const [launchHover, setLaunchHover] = (0, import_react8.useState)(false);
  const [chatKey, setChatKey] = (0, import_react8.useState)(0);
  const [unreadCount, setUnreadCount] = (0, import_react8.useState)(0);
  const [ticketId, setTicketId] = (0, import_react8.useState)(null);
  const handleTicketChange = (0, import_react8.useCallback)((id) => setTicketId(id), []);
  const handleUnreadChange = (0, import_react8.useCallback)((count) => setUnreadCount(count), []);
  const theme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);
  const scrollToBottomRef = (0, import_react8.useRef)(null);
  const handleStartNewChat = () => setChatKey((k) => k + 1);
  const prevIsOpen = (0, import_react8.useRef)(isOpen);
  (0, import_react8.useEffect)(() => {
    if (isOpen && !prevIsOpen.current) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scrollToBottomRef.current?.();
      }));
    }
    prevIsOpen.current = isOpen;
  }, [isOpen]);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: styles.container, children: [
    !isOpen && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "button",
      {
        style: { ...styles.launcher, transform: launchHover ? "scale(1.1)" : "scale(1)", boxShadow: launchHover ? `0 6px 28px ${theme.primaryColor}77` : `0 4px 20px ${theme.primaryColor}44`, position: "relative" },
        onClick: () => setIsOpen(true),
        onMouseEnter: () => setLaunchHover(true),
        onMouseLeave: () => setLaunchHover(false),
        "aria-label": "Open chat support",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ChatIcon, {}),
          unreadCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { position: "absolute", top: "-4px", right: "-4px", minWidth: "20px", height: "20px", borderRadius: "10px", backgroundColor: "#ef4444", color: "#ffffff", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", boxShadow: "0 2px 6px rgba(239,68,68,0.5)", border: "2px solid #ffffff", fontFamily: "system-ui,sans-serif", lineHeight: 1 }, children: unreadCount > 99 ? "99+" : unreadCount }),
          ticketId && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: { position: "absolute", bottom: "-4px", left: "-4px", backgroundColor: "#7c3aed", color: "#fff", fontSize: "9px", fontWeight: 700, padding: "2px 5px", borderRadius: "8px", border: "2px solid #fff", lineHeight: 1.2, whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(124,58,237,0.5)" }, children: [
            "\u{1F3AB} #",
            ticketId
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(ChatProvider, { config, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(UnreadTracker, { isOpen, onUnreadChange: handleUnreadChange, onTicketChange: handleTicketChange }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { display: isOpen ? "block" : "none" }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        ChatContentWithScrollRef,
        {
          onClose: () => setIsOpen(false),
          styles,
          config,
          theme,
          onStartNewChat: handleStartNewChat,
          scrollToBottomRef
        }
      ) })
    ] }, chatKey)
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChatProvider,
  ChatWebSocketClient,
  ChatWidget,
  WS_EVENTS,
  useChat,
  useChatActions,
  useChatMessages,
  useChatSession,
  useChatState
});
//# sourceMappingURL=index.js.map