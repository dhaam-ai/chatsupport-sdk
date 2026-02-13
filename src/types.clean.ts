// ==========================================
// Chat SDK - Clean Type Definitions
// Multi-tenant chat widget SDK types
// ==========================================

// ==========================================
// Core Enums
// ==========================================

export type ChatMode = 'BOT' | 'HUMAN';
export type ChatStatus = 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE';

// ==========================================
// SDK Configuration
// ==========================================

/**
 * Main SDK configuration object
 * Pass this to ChatWidget or ChatProvider
 */
export interface ChatSDKConfig {
  /**
   * Backend service URL
   * @example "https://chat-api.example.com" or "http://localhost:3000"
   */
  serviceUrl: string;

  /**
   * Tenant ID from your organization setup
   * @example "acme-corp"
   */
  tenantId: string;

  /**
   * App ID (widget app registered under tenant)
   * @example "web-chat", "mobile-app"
   */
  appId: string;

  /**
   * Authentication token (JWT from widget/token endpoint or Cognito)
   */
  token: string;

  /**
   * Current user information
   */
  user: {
    /** Unique user identifier */
    id: string;
    /** Display name */
    name: string;
    /** Email (optional) */
    email?: string;
    /** Avatar URL (optional) */
    avatar?: string;
    /** Custom user metadata */
    metadata?: Record<string, unknown>;
  };

  /**
   * UI theme customization
   */
  theme?: ChatTheme;

  /**
   * Feature toggles
   */
  features?: ChatFeatures;

  /**
   * Event callbacks
   */
  callbacks?: ChatCallbacks;

  /**
   * Debug mode - logs events to console
   * @default false
   */
  debug?: boolean;
}

// ==========================================
// Theme Configuration
// ==========================================

/**
 * UI theming options
 */
export interface ChatTheme {
  /** Primary brand color */
  primaryColor?: string;
  
  /** Header background color */
  headerBackground?: string;
  
  /** Header text color */
  headerText?: string;
  
  /** Customer message bubble color */
  customerBubbleColor?: string;
  
  /** Agent/Bot message bubble color */
  agentBubbleColor?: string;
  
  /** Font family */
  fontFamily?: string;
  
  /** Border radius for widget */
  borderRadius?: string;
  
  /** Widget position on screen */
  position?: 'bottom-right' | 'bottom-left';
  
  /** Welcome message shown in empty chat */
  welcomeMessage?: string;
  
  /** Dark mode preference */
  darkMode?: boolean;
}

// ==========================================
// Feature Toggles
// ==========================================

/**
 * Enable/disable SDK features
 */
export interface ChatFeatures {
  /** Show file upload button */
  fileUpload?: boolean;
  
  /** Show emoji picker */
  emoji?: boolean;
  
  /** Enable typing indicators */
  typing?: boolean;
  
  /** Enable sound notifications */
  sound?: boolean;
  
  /** Show header bar */
  showHeader?: boolean;
  
  /** Auto-expand widget on load */
  autoExpand?: boolean;
  
  /** Show message timestamps */
  showTimestamps?: boolean;
  
  /** Enable message reactions */
  reactions?: boolean;
  
  /** Show read receipts */
  readReceipts?: boolean;
}

// ==========================================
// Event Callbacks
// ==========================================

/**
 * SDK event callbacks
 */
export interface ChatCallbacks {
  /** New message received */
  onMessage?: (message: ChatMessage) => void;
  
  /** Session status or mode changed */
  onStatusChange?: (status: ChatStatus, mode: ChatMode) => void;
  
  /** Human agent joined the chat */
  onAgentJoined?: (agentId: string, agentName: string) => void;
  
  /** Human agent left the chat */
  onAgentLeft?: (agentId: string) => void;
  
  /** Chat session was closed */
  onSessionClosed?: () => void;
  
  /** Connection error occurred */
  onError?: (error: Error) => void;
  
  /** Successfully connected to chat */
  onConnected?: (sessionId: string) => void;
  
  /** Disconnected from chat */
  onDisconnected?: (reason: string) => void;
  
  /** Reconnected after disconnect */
  onReconnected?: () => void;
  
  /** Someone started typing */
  onTypingStart?: (senderType: SenderType, senderId?: string) => void;
  
  /** Someone stopped typing */
  onTypingStop?: (senderType: SenderType, senderId?: string) => void;
}

// ==========================================
// Chat Data Types
// ==========================================

/**
 * Chat message object
 */
export interface ChatMessage {
  /** Unique message ID */
  id: string;
  
  /** Session ID this message belongs to */
  chatSessionId: string;
  
  /** Who sent the message */
  senderType: SenderType;
  
  /** Sender's user ID (if applicable) */
  senderId?: string;
  
  /** Sender's display name */
  senderName?: string;
  
  /** Message text content */
  content: string;
  
  /** Type of message */
  messageType: MessageType;
  
  /** When the message was sent */
  timestamp: Date;
  
  /** Additional metadata */
  metadata?: {
    /** File URL for FILE/IMAGE types */
    fileUrl?: string;
    /** File name */
    fileName?: string;
    /** File size in bytes */
    fileSize?: number;
    /** MIME type */
    mimeType?: string;
    /** Quick reply options */
    quickReplies?: string[];
    /** Custom data */
    [key: string]: unknown;
  };
}

/**
 * Chat session state
 */
export interface ChatSession {
  /** Session ID */
  id: string;
  
  /** Current chat mode (BOT or HUMAN) */
  mode: ChatMode;
  
  /** Current session status */
  status: ChatStatus;
  
  /** Assigned agent ID (if any) */
  assignedAgentId?: string;
  
  /** Assigned agent name */
  assignedAgentName?: string;
  
  /** Session priority (0-100) */
  priority?: number;
  
  /** When session was created */
  createdAt?: Date;
  
  /** When escalated to human */
  escalatedAt?: Date;
}

// ==========================================
// SDK State & Actions
// ==========================================

/**
 * Internal SDK state
 */
export interface ChatSDKState {
  /** SDK initialized and ready */
  initialized: boolean;
  
  /** Connected to WebSocket */
  connected: boolean;
  
  /** Operation in progress */
  loading: boolean;
  
  /** Current chat session */
  session: ChatSession | null;
  
  /** Message history */
  messages: ChatMessage[];
  
  /** Someone is typing */
  isTyping: boolean;
  
  /** Who is typing */
  typingUser?: string;
  
  /** Current error (if any) */
  error: Error | null;
  
  /** Unread message count */
  unreadCount: number;
}

/**
 * SDK action methods
 */
export interface ChatSDKActions {
  /** Send a text message */
  sendMessage: (content: string, type?: MessageType) => Promise<void>;
  
  /** Send typing indicator */
  startTyping: () => void;
  
  /** Stop typing indicator */
  stopTyping: () => void;
  
  /** Close the current session */
  closeSession: () => Promise<void>;
  
  /** Request human agent (escalation) */
  requestAgent: (reason?: string) => Promise<void>;
  
  /** Reconnect to WebSocket */
  reconnect: () => Promise<void>;
  
  /** Mark messages as read */
  markAsRead: () => void;
  
  /** Clear error state */
  clearError: () => void;
}

/**
 * Combined SDK context value
 */
export interface ChatSDKContextValue {
  state: ChatSDKState;
  actions: ChatSDKActions;
  config: ChatSDKConfig;
}

// ==========================================
// WebSocket Events
// ==========================================

/**
 * WebSocket event names
 */
export const WS_EVENTS = {
  // Client emits
  JOIN_SESSION: 'chat.session.join',
  LEAVE_SESSION: 'chat.session.leave',
  MESSAGE_SEND: 'chat.message.send',
  TYPING_START: 'chat.typing.start',
  TYPING_STOP: 'chat.typing.stop',
  REQUEST_AGENT: 'chat.request.agent',

  // Server emits
  CONNECTION_ACK: 'chat.connection.ack',
  MESSAGE_RECEIVE: 'chat.message.receive',
  TYPING_INDICATOR: 'chat.typing.indicator',
  AGENT_JOINED: 'chat.agent.joined',
  AGENT_LEFT: 'chat.agent.left',
  SESSION_CLOSED: 'chat.session.closed',
  STATUS_CHANGED: 'chat.status.changed',
  ERROR: 'chat.error',
} as const;

export type WSEventName = typeof WS_EVENTS[keyof typeof WS_EVENTS];

// ==========================================
// API Response Types
// ==========================================

/**
 * Standard API response wrapper
 */
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Widget token response
 */
export interface WidgetTokenResponse {
  token: string;
  expiresIn: number;
}

/**
 * Create session response
 */
export interface CreateSessionResponse {
  chatSessionId: string;
  mode: ChatMode;
  status: ChatStatus;
}

/**
 * Widget config response (from /sdk/config/:appId)
 */
export interface WidgetConfigResponse {
  appId: string;
  appName: string;
  tenantId: string;
  aiEnabled: boolean;
  config: {
    theme?: ChatTheme;
    features?: ChatFeatures;
  };
}

// ==========================================
// Export all types
// ==========================================

export type {
  ChatMode as Mode,
  ChatStatus as Status,
  SenderType as Sender,
  MessageType as MsgType,
};
