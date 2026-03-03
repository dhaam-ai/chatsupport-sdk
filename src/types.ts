// // ==========================================
// // Chat SDK - Type Definitions
// // ==========================================

// export type ChatMode = 'BOT' | 'HUMAN';
// export type ChatStatus = 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
// export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
// export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE';

// /**
//  * SDK Configuration
//  */
// export interface ChatSDKConfig {
//   /** Backend service URL (e.g., https://api.chat.example.com) */
//   serviceUrl: string;

//   /** Optional: Explicit WebSocket URL (defaults to serviceUrl on port 3001) */
//   wsUrl?: string;

//   /** Your tenant ID */
//   tenantId: string;
  
//   /** Your app ID */
//   appId: string;
  
//   /** Cognito access token from your auth system */
//   token: string;
  
//   /** Current user information */
//   user: {
//     id: string;
//     name: string;
//     email?: string;
//   };
  
//   /** Optional: Custom theme */
//   theme?: ChatTheme;
  
//   /** Optional: Feature flags */
//   features?: ChatFeatures;
  
//   /** Optional: Callback handlers */
//   callbacks?: ChatCallbacks;
// }

// /**
//  * Theme customization
//  */
// export interface ChatTheme {
//   primaryColor?: string;
//   headerBackground?: string;
//   headerText?: string;
//   customerBubbleColor?: string;
//   agentBubbleColor?: string;
//   fontFamily?: string;
//   borderRadius?: string;
//   position?: 'bottom-right' | 'bottom-left';
// }

// /**
//  * Feature toggles
//  */
// export interface ChatFeatures {
//   /** Show file upload button */
//   fileUpload?: boolean;
//   /** Show emoji picker */
//   emoji?: boolean;
//   /** Show typing indicators */
//   typing?: boolean;
//   /** Enable sound notifications */
//   sound?: boolean;
//   /** Show header with agent info */
//   showHeader?: boolean;
//   /** Auto-expand widget on load */
//   autoExpand?: boolean;
// }

// /**
//  * Event callbacks
//  */
// export interface ChatCallbacks {
//   /** Called when a message is received */
//   onMessage?: (message: ChatMessage) => void;
//   /** Called when session status changes */
//   onStatusChange?: (status: ChatStatus, mode: ChatMode) => void;
//   /** Called when an agent joins */
//   onAgentJoined?: (agentId: string, agentName: string) => void;
//   /** Called when an agent leaves */
//   onAgentLeft?: (agentId: string) => void;
//   /** Called when session is closed */
//   onSessionClosed?: () => void;
//   /** Called on connection error */
//   onError?: (error: Error) => void;
//   /** Called when connection is established */
//   onConnected?: (sessionId: string) => void;
// }

// /**
//  * Chat message
//  */
// export interface ChatMessage {
//   id: string;
//   chatSessionId: string;
//   senderType: SenderType;
//   senderId?: string;
//   senderName?: string;
//   content: string;
//   messageType: MessageType;
//   timestamp: Date;
//   metadata?: Record<string, unknown>;
// }

// /**
//  * Chat session state
//  */
// export interface ChatSession {
//   id: string;
//   mode: ChatMode;
//   status: ChatStatus;
//   assignedAgentId?: string;
//   assignedAgentName?: string;
// }

// /**
//  * SDK state
//  */
// export interface ChatSDKState {
//   /** Whether SDK is initialized */
//   initialized: boolean;
//   /** Whether connected to WebSocket */
//   connected: boolean;
//   /** Whether chat is loading */
//   loading: boolean;
//   /** Current session */
//   session: ChatSession | null;
//   /** Chat messages */
//   messages: ChatMessage[];
//   /** Whether someone is typing */
//   isTyping: boolean;
//   /** Who is typing */
//   typingUser?: string;
//   /** Error state */
//   error: Error | null;
// }

// /**
//  * SDK actions
//  */
// export interface ChatSDKActions {
//   /** Send a message */
//   sendMessage: (content: string, type?: MessageType) => Promise<void>;
//   /** Start typing indicator */
//   startTyping: () => void;
//   /** Stop typing indicator */
//   stopTyping: () => void;
//   /** Close the chat session */
//   closeSession: () => Promise<void>;
//   /** Request human agent */
//   requestAgent: (reason?: string) => Promise<void>;
//   /** Reconnect to WebSocket */
//   reconnect: () => Promise<void>;
// }

// /**
//  * WebSocket event types
//  */
// export const WS_EVENTS = {
//   // Client -> Server
//   JOIN_SESSION: 'chat.session.join',
//   LEAVE_SESSION: 'chat.session.leave',
//   MESSAGE_SEND: 'chat.message.send',
//   TYPING_START: 'chat.typing.start',
//   TYPING_STOP: 'chat.typing.stop',
//   REQUEST_AGENT: 'chat.request.agent',
  
//   // Server -> Client
//   CONNECTION_ACK: 'chat.connection.ack',
//   MESSAGE_RECEIVE: 'chat.message.receive',
//   TYPING_INDICATOR: 'chat.typing.indicator',
//   AGENT_JOINED: 'chat.agent.joined',
//   AGENT_LEFT: 'chat.agent.left',
//   SESSION_CLOSED: 'chat.session.closed',
//   STATUS_CHANGED: 'chat.status.changed',
//   ERROR: 'chat.error',
// } as const;


// ==========================================
// Chat SDK - Type Definitions
// ==========================================

export type ChatMode = 'BOT' | 'HUMAN';
export type ChatStatus = 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE';

/**
 * SDK Configuration
 */
export interface ChatSDKConfig {
  /** Backend service URL (e.g., https://api.chat.example.com) */
  serviceUrl: string;

  /** Optional: Explicit WebSocket URL (defaults to serviceUrl on port 3001) */
  wsUrl?: string;

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
 * Chat message
 */
export interface ChatMessage {
  id: string;
  chatSessionId: string;
  senderType: SenderType;
  senderId?: string;
  senderName?: string;
  content: string;
  messageType: MessageType;
  timestamp: Date;
  metadata?: Record<string, unknown>;
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
}

/**
 * SDK actions
 */
export interface ChatSDKActions {
  /** Send a message */
  sendMessage: (content: string, type?: MessageType) => Promise<void>;
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
  ERROR: 'chat.error',
} as const;
