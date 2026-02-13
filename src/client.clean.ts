// ==========================================
// Chat SDK - WebSocket Client
// Clean implementation for real-time chat
// ==========================================

import { io, Socket } from 'socket.io-client';
import type {
  ChatSDKConfig,
  ChatMessage,
  ChatSession,
  MessageType,
  WS_EVENTS as WS_EVENTS_TYPE,
} from './types.clean';
import { WS_EVENTS } from './types.clean';

// ==========================================
// Types
// ==========================================

type EventCallback = (...args: unknown[]) => void;

interface ConnectionAckData {
  socketId: string;
  sessionIds: string[];
  chatSessionId?: string;
  mode?: string;
  status?: string;
  timestamp: string;
}

interface MessageReceiveData {
  chatSessionId: string;
  messageId: string;
  senderType: string;
  senderId?: string;
  senderName?: string;
  content: string;
  messageType: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

interface TypingData {
  chatSessionId: string;
  senderType: string;
  senderId?: string;
  isTyping: boolean;
}

interface AgentData {
  agentId: string;
  agentName: string;
}

interface StatusData {
  mode: string;
  status: string;
}

interface ErrorData {
  code: string;
  message: string;
}

// ==========================================
// WebSocket Client Class
// ==========================================

export class ChatWebSocketClient {
  private socket: Socket | null = null;
  private config: ChatSDKConfig;
  private eventHandlers: Map<string, Set<EventCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  public session: ChatSession | null = null;
  public connected = false;

  constructor(config: ChatSDKConfig) {
    this.config = config;
  }

  // ==========================================
  // Event Emitter Methods
  // ==========================================

  /**
   * Register event handler
   */
  on(event: string, callback: EventCallback): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

  /**
   * Remove event handler
   */
  off(event: string, callback: EventCallback): void {
    this.eventHandlers.get(event)?.delete(callback);
  }

  /**
   * Emit event to handlers
   */
  private emit(event: string, ...args: unknown[]): void {
    this.eventHandlers.get(event)?.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[ChatSDK] Event handler error for ${event}:`, error);
      }
    });
  }

  // ==========================================
  // Connection Methods
  // ==========================================

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<ChatSession> {
    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL
        let wsUrl = this.config.serviceUrl;
        
        // Convert HTTP to WS
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        }

        // Replace REST port (3000) with WebSocket port (3001) if present
        if (wsUrl.includes(':3000')) {
          wsUrl = wsUrl.replace(':3000', ':3001');
        } else if (!wsUrl.includes(':300')) {
          // Add WebSocket port if no port specified
          const urlObj = new URL(wsUrl);
          if (!urlObj.port) {
            wsUrl = wsUrl.replace(urlObj.host, `${urlObj.host}:3001`);
          }
        }

        this.log('Connecting to WebSocket:', wsUrl);

        // Create socket connection
        this.socket = io(wsUrl, {
          auth: {
            token: this.config.token,
            tenantId: this.config.tenantId,
            appId: this.config.appId,
            userId: this.config.user.id,
            userName: this.config.user.name,
            userEmail: this.config.user.email || '',
          },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: this.reconnectDelay,
          timeout: 10000,
        });

        // Connection timeout
        const connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            this.socket?.disconnect();
            reject(new Error('Connection timeout'));
          }
        }, 15000);

        // Handle connection acknowledgment
        this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: ConnectionAckData) => {
          clearTimeout(connectionTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;

          this.log('Connection acknowledged:', data);

          const sessionId = data.chatSessionId || data.sessionIds?.[0];

          if (sessionId) {
            this.session = {
              id: sessionId,
              mode: (data.mode as ChatSession['mode']) || 'BOT',
              status: (data.status as ChatSession['status']) || 'OPEN',
            };

            // Join the session room
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });

            resolve(this.session);
          } else {
            // If no session ID, we need to create a session first
            this.createSession()
              .then((session) => resolve(session))
              .catch(reject);
          }
        });

        // Setup event listeners
        this.setupEventListeners();

        // Handle connection errors
        this.socket.on('connect_error', (error) => {
          clearTimeout(connectionTimeout);
          this.connected = false;
          this.reconnectAttempts++;
          this.log('Connection error:', error.message);
          this.emit('error', error);

          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            reject(new Error(`Failed to connect after ${this.maxReconnectAttempts} attempts`));
          }
        });

        // Handle immediate socket error
        this.socket.on('error', (error) => {
          this.log('Socket error:', error);
          this.emit('error', new Error(String(error)));
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create a new chat session via REST API
   */
  private async createSession(): Promise<ChatSession> {
    const response = await fetch(`${this.config.serviceUrl}/api/v1/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to create session');
    }

    this.session = {
      id: result.data.chatSessionId,
      mode: result.data.mode,
      status: result.data.status,
    };

    // Join the new session
    this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });

    return this.session;
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Handle incoming messages
    this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (data: MessageReceiveData) => {
      this.log('Message received:', data);

      const message: ChatMessage = {
        id: data.messageId,
        chatSessionId: data.chatSessionId,
        senderType: data.senderType as ChatMessage['senderType'],
        senderId: data.senderId,
        senderName: data.senderName,
        content: data.content,
        messageType: data.messageType as ChatMessage['messageType'],
        timestamp: new Date(data.timestamp || Date.now()),
        metadata: data.metadata,
      };

      this.emit('message', message);
    });

    // Handle typing indicator
    this.socket.on(WS_EVENTS.TYPING_INDICATOR, (data: TypingData) => {
      this.log('Typing indicator:', data);
      this.emit('typing', data);
    });

    // Handle agent joined
    this.socket.on(WS_EVENTS.AGENT_JOINED, (data: AgentData) => {
      this.log('Agent joined:', data);

      if (this.session) {
        this.session.assignedAgentId = data.agentId;
        this.session.assignedAgentName = data.agentName;
        this.session.mode = 'HUMAN';
        this.session.status = 'ASSIGNED';
      }

      this.emit('agentJoined', data);
    });

    // Handle agent left
    this.socket.on(WS_EVENTS.AGENT_LEFT, (data: { agentId: string }) => {
      this.log('Agent left:', data);
      this.emit('agentLeft', data);
    });

    // Handle status change
    this.socket.on(WS_EVENTS.STATUS_CHANGED, (data: StatusData) => {
      this.log('Status changed:', data);

      if (this.session) {
        this.session.mode = data.mode as ChatSession['mode'];
        this.session.status = data.status as ChatSession['status'];
      }

      this.emit('statusChange', data);
    });

    // Handle session closed
    this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
      this.log('Session closed');

      if (this.session) {
        this.session.status = 'CLOSED';
      }

      this.emit('sessionClosed', {});
    });

    // Handle errors
    this.socket.on(WS_EVENTS.ERROR, (error: ErrorData) => {
      this.log('Server error:', error);
      this.emit('error', new Error(error.message));
    });

    // Handle disconnect
    this.socket.on('disconnect', (reason: string) => {
      this.log('Disconnected:', reason);
      this.connected = false;
      this.emit('disconnect', { reason });
    });

    // Handle reconnect
    this.socket.on('reconnect', () => {
      this.log('Reconnected');
      this.connected = true;
      this.reconnectAttempts = 0;

      // Rejoin session on reconnect
      if (this.session) {
        this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
      }

      this.emit('reconnect', {});
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.log('Disconnecting...');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  // ==========================================
  // Chat Methods
  // ==========================================

  /**
   * Send a message
   */
  async sendMessage(content: string, messageType: MessageType = 'TEXT'): Promise<void> {
    if (!this.socket || !this.session) {
      throw new Error('Not connected to chat');
    }

    this.log('Sending message:', { content, messageType });

    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType,
    });
  }

  /**
   * Start typing indicator
   */
  startTyping(): void {
    if (!this.socket || !this.session) return;

    this.socket.emit(WS_EVENTS.TYPING_START, {
      chatSessionId: this.session.id,
    });
  }

  /**
   * Stop typing indicator
   */
  stopTyping(): void {
    if (!this.socket || !this.session) return;

    this.socket.emit(WS_EVENTS.TYPING_STOP, {
      chatSessionId: this.session.id,
    });
  }

  /**
   * Request human agent (escalation)
   */
  async requestAgent(reason?: string): Promise<void> {
    if (!this.socket || !this.session) {
      throw new Error('Not connected to chat');
    }

    this.log('Requesting agent:', { reason });

    this.socket.emit(WS_EVENTS.REQUEST_AGENT, {
      chatSessionId: this.session.id,
      reason,
    });
  }

  /**
   * Close the chat session
   */
  async closeSession(): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.log('Closing session');

    // Call REST API to close session
    const response = await fetch(
      `${this.config.serviceUrl}/api/v1/chat/sessions/${this.session.id}/close`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to close session');
    }

    if (this.session) {
      this.session.status = 'CLOSED';
    }
  }

  /**
   * Get session history
   */
  async getHistory(limit = 50): Promise<ChatMessage[]> {
    if (!this.session) {
      throw new Error('No active session');
    }

    const response = await fetch(
      `${this.config.serviceUrl}/api/v1/chat/sessions/${this.session.id}/messages?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch history');
    }

    const result = await response.json();

    return result.data || [];
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[ChatSDK Client] ${message}`, data || '');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.socket?.connected === true;
  }

  /**
   * Get current session
   */
  getSession(): ChatSession | null {
    return this.session;
  }
}

export default ChatWebSocketClient;
