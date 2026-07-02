import React from 'react';

type ChatMode = 'BOT' | 'HUMAN';
type ChatStatus = 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE' | 'VIDEO' | 'AUDIO';
/**
 * SDK Configuration
 */
interface ChatSDKConfig {
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
interface ChatTheme {
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
interface ChatFeatures {
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
interface ChatCallbacks {
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
interface FileAttachment {
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
    mediaType: 'images' | 'videos' | 'audio' | 'documents';
}
/**
 * Chat message
 */
interface ChatMessage {
    id: string;
    /** Stable React-list key: set once at optimistic-creation time and preserved
     * across the optimistic→server-confirmed swap so the message subtree (and any
     * in-progress media playback) isn't remounted when `id` changes to the real one. */
    clientKey?: string;
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
 * A past session summary used in the session history screen.
 */
interface ChatSessionSummary {
    id: string;
    status: ChatStatus;
    mode: ChatMode;
    createdAt: string | Date;
    closedAt?: string | Date | null;
    lastMessage?: {
        content: string;
        senderType: SenderType;
        createdAt: string | Date;
    } | null;
}
/**
 * Chat session state
 */
interface ChatSession {
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
interface ChatSDKState {
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
    closeReason: string | null;
}
/**
 * SDK actions
 */
interface ChatSDKActions {
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
    /** Reopen a closed session — goes directly to WAITING_FOR_AGENT (bypasses AI bot) */
    reopenSession: (sessionId: string) => Promise<{
        sessionId: string;
        status: string;
        mode: string;
    }>;
    /** Mark all current session messages as read by the customer */
    markMessagesRead: () => Promise<void>;
}
/**
 * WebSocket event types
 */
declare const WS_EVENTS: {
    readonly JOIN_SESSION: "chat.session.join";
    readonly LEAVE_SESSION: "chat.session.leave";
    readonly MESSAGE_SEND: "chat.message.send";
    readonly TYPING_START: "chat.typing.start";
    readonly TYPING_STOP: "chat.typing.stop";
    readonly REQUEST_AGENT: "chat.request.agent";
    readonly CONNECTION_ACK: "chat.connection.ack";
    readonly MESSAGE_RECEIVE: "chat.message.receive";
    readonly TYPING_INDICATOR: "chat.typing.indicator";
    readonly AGENT_JOINED: "chat.agent.joined";
    readonly AGENT_LEFT: "chat.agent.left";
    readonly SESSION_CLOSED: "chat.session.closed";
    readonly STATUS_CHANGED: "chat.status.changed";
    readonly SESSION_JOINED: "chat.session.joined";
    readonly ESCALATED: "chat.escalated";
    readonly ERROR: "chat.error";
    readonly TYPING: "chat.typing";
    readonly MESSAGE_READ: "chat.message.read";
    readonly MARK_READ: "chat.message.markRead";
    readonly MESSAGE_ACK: "chat.message.ack";
    readonly MESSAGE_DELIVERED: "chat.message.delivered";
    readonly HEARTBEAT: "chat.heartbeat";
    readonly SET_PRESENCE: "chat.presence.set";
    readonly PRESENCE_QUERY: "chat.presence.query";
    readonly PRESENCE_UPDATE: "chat.presence.update";
    readonly PRESENCE_STATE: "chat.presence.state";
};

interface ChatWidgetProps {
    config: ChatSDKConfig;
    defaultOpen?: boolean;
}
declare function ChatWidget({ config, defaultOpen }: ChatWidgetProps): JSX.Element;

interface ChatContextValue {
    state: ChatSDKState;
    actions: ChatSDKActions;
    config: ChatSDKConfig | null;
}
declare function ChatProvider({ config, children }: {
    config: ChatSDKConfig;
    children: React.ReactNode;
}): JSX.Element;
declare function useChat(): ChatContextValue;
declare const useChatMessages: () => ChatMessage[];
declare const useChatSession: () => ChatSession | null;
declare const useChatActions: () => ChatSDKActions;
declare const useChatState: () => ChatSDKState;

type EventCallback = (...args: unknown[]) => void;
declare class ChatWebSocketClient {
    private socket;
    private config;
    private eventHandlers;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    private heartbeatTimer;
    session: ChatSession | null;
    connected: boolean;
    tokenExpired: boolean;
    constructor(config: ChatSDKConfig);
    connect(): Promise<ChatSession>;
    sendMessage(content: string, messageType?: MessageType, replyToMessageId?: string, clientMessageId?: string): void;
    markRead(): void;
    presenceQuery(userIds: string[]): void;
    setPresence(status: number): void;
    private _startHeartbeat;
    private _stopHeartbeat;
    /**
     * Upload a file to S3 via the chat-service REST API and send it as a message.
     */
    sendAttachment(file: File): Promise<void>;
    startTyping(): void;
    stopTyping(): void;
    requestAgent(reason?: string): void;
    joinSession(sessionId: string): void;
    disconnect(): void;
    on(event: string, callback: EventCallback): () => void;
    off(event: string, callback: EventCallback): void;
    private emit;
}

export { type ChatCallbacks, type ChatFeatures, type ChatMessage, type ChatMode, ChatProvider, type ChatSDKActions, type ChatSDKConfig, type ChatSDKState, type ChatSession, type ChatStatus, type ChatTheme, ChatWebSocketClient, ChatWidget, type ChatWidgetProps, type MessageType, type SenderType, WS_EVENTS, useChat, useChatActions, useChatMessages, useChatSession, useChatState };
