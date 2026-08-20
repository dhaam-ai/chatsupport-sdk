// ==========================================
// Chat SDK - Type Definitions
// ==========================================

export type ChatMode = 'BOT' | 'HUMAN';
// RESOLVED and ON_HOLD were missing here while both client.ts's
// normalizeChatStatus and context.tsx's normStatus have always been able to
// produce them — every call site cast through `as any` to paper over it.
export type ChatStatus = 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED' | 'RESOLVED' | 'ON_HOLD';
export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE' | 'VIDEO' | 'AUDIO';

/**
 * SDK Configuration
 */
export interface ChatSDKConfig {
  /** Backend service URL (e.g., https://api.chat.example.com) */
  serviceUrl: string;

  /** Optional: Explicit WebSocket URL (defaults to serviceUrl on port 3001) */
  wsUrl?: string;

  /** Optional: Explicit REST API base URL for file uploads.
   *  Defaults to serviceUrl (with :3001→:3000 port swap if needed).
   *  Set this if your host app proxies WebSocket but NOT REST calls.
   *  Example: 'http://localhost:3000' */
  apiUrl?: string;

  /** Your tenant ID */
  tenantId: string;
  
  /** Cognito access token from your auth system */
  token: string;
  
  /** Current user information */
  user: {
    id: string;
    name: string;
    email?: string;
  };

  /** Optional: the widget's title. Shown in the header only when neither an
   *  assigned agent nor the bot is handling the chat. Defaults to 'Chat Support'. */
  title?: string;

  /** Optional: Custom theme */
  theme?: ChatTheme;
  
  /** Optional: Feature flags */
  features?: ChatFeatures;
  
  /** Optional: Callback handlers */
  callbacks?: ChatCallbacks;
}

/**
 * Theme customization
 */
export interface ChatTheme {
  primaryColor?: string;
  headerBackground?: string;
  headerText?: string;
  customerBubbleColor?: string;
  agentBubbleColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  position?: 'bottom-right' | 'bottom-left';
}

/**
 * Feature toggles
 */
export interface ChatFeatures {
  /** Show file upload button */
  fileUpload?: boolean;
  /** Show emoji picker */
  emoji?: boolean;
  /** Show typing indicators */
  typing?: boolean;
  /** Enable sound notifications */
  sound?: boolean;
  /** Show header with agent info */
  showHeader?: boolean;
  /** Auto-expand widget on load */
  autoExpand?: boolean;
  /** Show the "your last N conversations" picker when the widget opens.
   *  Only ever renders when the backend actually returns sessions, so it is
   *  inert for guests regardless. Default: true. */
  sessionPicker?: boolean;
  /** Let a customer bring a CLOSED/RESOLVED session back by typing into it.
   *  Requires the backend's FEATURE_SESSION_REACTIVATE_ON_CUSTOMER_MESSAGE to
   *  be on as well — with only this side enabled the message is stored but the
   *  session stays terminal. Default: false, matching the server default. */
  sessionReactivateOnMessage?: boolean;
}

/**
 * Event callbacks
 */
export interface ChatCallbacks {
  /** Called when a message is received */
  onMessage?: (message: ChatMessage) => void;
  /** Called when session status changes */
  onStatusChange?: (status: ChatStatus, mode: ChatMode) => void;
  /** Called when an agent joins */
  onAgentJoined?: (agentId: string, agentName: string) => void;
  /** Called when an agent leaves */
  onAgentLeft?: (agentId: string) => void;
  /** Called when session is closed */
  onSessionClosed?: () => void;
  /** Called on connection error */
  onError?: (error: Error) => void;
  /** Called when connection is established */
  onConnected?: (sessionId: string) => void;
}

/**
 * File attachment metadata
 */
export interface FileAttachment {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  mediaType: 'images' | 'videos' | 'audio' | 'documents';
}

/**
 * How an outbound (customer) message is doing.
 *   'sending' — optimistic, no chat.message.ack yet
 *   'sent'    — the server acked it and gave it a real id
 *   'failed'  — it did not get out; see sendFailure
 * Absent on inbound messages, which are by definition already delivered.
 */
export type SendStatus = 'sending' | 'sent' | 'failed';

/**
 * Why an outbound message did not make it.
 * `retryable: false` means the UI must show NO retry affordance — the same
 * payload is refused identically every time.
 */
export interface SendFailure {
  /** Server code from chat.error, or one of sendState.ts's LOCAL_CODES. */
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Chat message
 */
export interface ChatMessage {
  id: string;
  /** Stable React-list key: set once at optimistic-creation time and preserved
   * across the optimistic→server-confirmed swap so the message subtree (and any
   * in-progress media playback) isn't remounted when `id` changes to the real one. */
  clientKey?: string;
  /** The idempotency key this message was sent with. The backend dedupes on
   * (chatSessionId, clientMessageId) — see prisma/schema.prisma's
   * `@@unique([chatSessionId, clientMessageId])` and message.service.ts:78 —
   * so a RETRY MUST replay this exact value. Minting a fresh one is what makes
   * a retry create a second message instead of retrying the first. */
  clientMessageId?: string;
  /** Set on outbound (CUSTOMER) messages only. */
  sendStatus?: SendStatus;
  /** Set only when sendStatus === 'failed'. */
  sendFailure?: SendFailure;
  chatSessionId: string;
  senderType: SenderType;
  senderId?: string;
  senderName?: string;
  content: string;
  messageType: MessageType;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  attachment?: FileAttachment;
  replyToMessageId?: string | null;
  replyToMessage?: {
    id: string;
    content: string;
    senderType: SenderType;
    senderId?: string | null;
    senderName?: string;
    messageType: MessageType;
  } | null;
}

/**
 * Who is/was handling a session. Absent — never null, never a placeholder —
 * when nobody has picked it up yet.
 */
export interface HandledBy {
  kind: 'AGENT' | 'BOT';
  /** The agent's external id, or the fixed sentinel "bot". */
  id: string;
  displayName: string;
}

/**
 * A past session summary used in the session picker / history screen.
 *
 * Shape of GET /chat/sessions/customer's `data.sessions[]` items — see
 * ChatSessionSummaryWire in openapi/chat-api.yaml. The nested `lastMessage`
 * object this used to declare no longer exists on the wire; it was replaced by
 * the flat lastMessageAt / lastMessagePreview / unreadCount trio.
 */
export interface ChatSessionSummary {
  id: string;
  status: ChatStatus;
  mode: ChatMode;
  createdAt: string | Date | null;
  closedAt?: string | Date | null;
  /** Timestamp of the most recent PUBLIC message, or null if there is none. */
  lastMessageAt?: string | Date | null;
  /** Verbatim content of the most recent PUBLIC message. Absent, never '', when
   *  the session has no public message yet. */
  lastMessagePreview?: string;
  /** PUBLIC messages not sent by the customer since their read watermark. */
  unreadCount: number;
  handledBy?: HandledBy;
}

/**
 * Chat session state
 */
export interface ChatSession {
  id: string;
  mode: ChatMode;
  status: ChatStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  /** Enriched agent profile from ChatUser table */
  assignedAgent?: {
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    isOnline: boolean;
  } | null;
  /** Enriched customer profile from ChatUser table */
  customer?: {
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    isOnline: boolean;
  } | null;
}

/**
 * SDK state
 */
export interface ChatSDKState {
  /** Whether SDK is initialized */
  initialized: boolean;
  /** Whether connected to WebSocket */
  connected: boolean;
  /** Whether chat is loading */
  loading: boolean;
  /** Current session */
  session: ChatSession | null;
  /** Chat messages */
  messages: ChatMessage[];
  /** Whether someone is typing */
  isTyping: boolean;
  /** Who is typing */
  typingUser?: string;
  /** Error state */
  error: Error | null;
  /** Whether the auth token has expired */
  tokenExpired: boolean;
  /** Whether the chat widget is currently visible to the user */
  isWidgetOpen: boolean;
  /** Number of unread agent/bot messages (accumulated while widget is closed) */
  unreadCount: number;
  /** Whether older messages exist on the server (scroll-up pagination) */
  hasMore: boolean;
  /** Whether we are currently fetching older messages */
  loadingMore: boolean;
  /** Whether a file attachment is currently being uploaded */
  uploading: boolean;
  /** Past sessions for the session history screen */
  pastSessions: ChatSessionSummary[];
  /** When the agent last read messages in this session (from WS chat.message.read event) */
  agentReadAt: Date | null;

  closeReason: string | null;  // 'SWITCHED' | 'MANUAL' | null
}

/**
 * SDK actions
 */
export interface ChatSDKActions {
  /** Send a message */
  sendMessage: (content: string, type?: MessageType, replyToMessageId?: string) => Promise<void>;
  /** Send a file attachment */
  sendAttachment: (file: File) => Promise<void>;
  /** Start typing indicator */
  startTyping: () => void;
  /** Stop typing indicator */
  stopTyping: () => void;
  /** Close the chat session */
  closeSession: () => Promise<void>;
  /** Request human agent */
  requestAgent: (reason?: string) => Promise<void>;
  /** Reconnect to WebSocket */
  reconnect: () => Promise<void>;
  /** Tell the reducer whether the widget is visible (controls unread counting) */
  setWidgetOpen: (open: boolean) => void;
  /** Load older messages (scroll-up pagination) */
  loadOlderMessages: () => Promise<void>;
  /** Fetch the last N sessions for the current customer (session history) */
  fetchPastSessions: () => Promise<void>;
  /** Reopen a closed session via POST /reopen — goes directly to
   *  WAITING_FOR_AGENT (bypasses AI bot). NOTE its convergence semantics: if
   *  the customer already has a different active session, the backend returns
   *  THAT session instead of reopening the requested one. Kept for callers that
   *  want exactly that; the session picker deliberately does not use it —
   *  see selectSession. */
  reopenSession: (sessionId: string) => Promise<{ sessionId: string; status: string; mode: string }>;
  /** Switch the widget to an existing session and load its transcript, without
   *  mutating it server-side. A terminal session picked this way comes back
   *  when the customer types (server-side reactivation), which is why this
   *  does not converge onto some other session the way /reopen does. */
  selectSession: (sessionId: string) => Promise<void>;
  /** Mark all current session messages as read by the customer */
  markMessagesRead: () => Promise<void>;
  /** Retry a failed outbound message by REPLAYING its original clientMessageId.
   *  No-op when the message is not failed, or when its failure is not
   *  retryable — retrying a permanently-refused send is refused identically. */
  retryMessage: (messageId: string) => Promise<void>;
}

/**
 * WebSocket event types
 */
export const WS_EVENTS = {
  // Client -> Server
  JOIN_SESSION: 'chat.session.join',
  LEAVE_SESSION: 'chat.session.leave',
  MESSAGE_SEND: 'chat.message.send',
  TYPING_START: 'chat.typing.start',
  TYPING_STOP: 'chat.typing.stop',
  REQUEST_AGENT: 'chat.request.agent',
  
  // Server -> Client
  CONNECTION_ACK: 'chat.connection.ack',
  MESSAGE_RECEIVE: 'chat.message.receive',
  TYPING_INDICATOR: 'chat.typing.indicator',
  AGENT_JOINED: 'chat.agent.joined',
  AGENT_LEFT: 'chat.agent.left',
  SESSION_CLOSED: 'chat.session.closed',
  STATUS_CHANGED: 'chat.status.changed',
  SESSION_JOINED: 'chat.session.joined',
  ESCALATED: 'chat.escalated',
  ERROR: 'chat.error',
  TYPING: 'chat.typing',
  // Read / delivery receipts (Phase 3)
  MESSAGE_READ: 'chat.message.read',
  MARK_READ: 'chat.message.markRead',
  MESSAGE_ACK: 'chat.message.ack',
  MESSAGE_DELIVERED: 'chat.message.delivered',
  // Presence (§13)
  HEARTBEAT: 'chat.heartbeat',
  SET_PRESENCE: 'chat.presence.set',
  PRESENCE_QUERY: 'chat.presence.query',
  PRESENCE_UPDATE: 'chat.presence.update',
  PRESENCE_STATE: 'chat.presence.state',
} as const;
