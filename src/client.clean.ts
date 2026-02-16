// ==========================================
// Chat SDK - WebSocket Client
// ==========================================

import { io, Socket } from 'socket.io-client';
import type {
  ChatSDKConfig,
  ChatMessage,
  ChatSession,
  WS_EVENTS as WS_EVENTS_TYPE,
  MessageType,
} from './types';
import { WS_EVENTS } from './types';

type EventCallback = (...args: unknown[]) => void;

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

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<ChatSession> {
    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL
        let wsUrl = this.config.serviceUrl;
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        }
        
        // Remove port 3000 (REST) and use 3001 (WebSocket) if needed
        if (wsUrl.includes(':3000')) {
          wsUrl = wsUrl.replace(':3000', ':3001');
        }

        console.log('🔌 Chat SDK: Connecting to WebSocket at', wsUrl);

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
        });

        let connectionAckReceived = false;

        // Handle connection acknowledgment
        this.socket.on(WS_EVENTS.CONNECTION_ACK, (data: {
          sessionIds: string[];
          chatSessionId?: string;
          mode: string;
          status: string;
        }) => {
          connectionAckReceived = true;
          console.log('✅ Chat SDK: Connection acknowledged, session ID:', data.chatSessionId || data.sessionIds?.[0]);
          this.connected = true;
          this.reconnectAttempts = 0;

          const sessionId = data.chatSessionId || data.sessionIds?.[0];
          
          if (sessionId) {
            this.session = {
              id: sessionId,
              mode: data.mode as 'BOT' | 'HUMAN',
              status: data.status as 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED',
            };

            // Join the session room
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: sessionId });
            
            resolve(this.session);
          } else {
            reject(new Error('No session ID received'));
          }
        });

        // Handle socket connection
        this.socket.on('connect', () => {
          console.log('📡 Chat SDK: Socket connected (transport established)');
        });

        // Handle incoming messages
        this.socket.on(WS_EVENTS.MESSAGE_RECEIVE, (data: ChatMessage) => {
          this.emit('message', data);
          this.config.callbacks?.onMessage?.(data);
        });

        // Handle typing indicator
        this.socket.on(WS_EVENTS.TYPING_INDICATOR, (data: {
          senderType: string;
          senderId: string;
          isTyping: boolean;
        }) => {
          this.emit('typing', data);
        });

        // Handle agent joined
        this.socket.on(WS_EVENTS.AGENT_JOINED, (data: {
          agentId: string;
          agentName: string;
        }) => {
          if (this.session) {
            this.session.assignedAgentId = data.agentId;
            this.session.assignedAgentName = data.agentName;
          }
          this.emit('agentJoined', data);
          this.config.callbacks?.onAgentJoined?.(data.agentId, data.agentName);
        });

        // Handle agent left
        this.socket.on(WS_EVENTS.AGENT_LEFT, (data: { agentId: string }) => {
          this.emit('agentLeft', data);
          this.config.callbacks?.onAgentLeft?.(data.agentId);
        });

        // Handle status change
        this.socket.on(WS_EVENTS.STATUS_CHANGED, (data: {
          mode: string;
          status: string;
        }) => {
          if (this.session) {
            this.session.mode = data.mode as 'BOT' | 'HUMAN';
            this.session.status = data.status as 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
          }
          this.emit('statusChange', data);
          this.config.callbacks?.onStatusChange?.(
            data.status as 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED',
            data.mode as 'BOT' | 'HUMAN'
          );
        });

        // Handle session closed
        this.socket.on(WS_EVENTS.SESSION_CLOSED, () => {
          if (this.session) {
            this.session.status = 'CLOSED';
          }
          this.emit('sessionClosed', {});
          this.config.callbacks?.onSessionClosed?.();
        });

        // Handle errors
        this.socket.on(WS_EVENTS.ERROR, (error: { code: string; message: string }) => {
          const err = new Error(error.message);
          this.emit('error', err);
          this.config.callbacks?.onError?.(err);
        });

        // Handle connection error
        this.socket.on('connect_error', (error) => {
          this.connected = false;
          this.reconnectAttempts++;
          console.error('❌ Chat SDK: Connection error (attempt', this.reconnectAttempts + '/' + this.maxReconnectAttempts + '):', error?.message);
          this.emit('error', error);
          
          // Only reject if max reconnection attempts reached AND we haven't received CONNECTION_ACK
          if (this.reconnectAttempts >= this.maxReconnectAttempts && !connectionAckReceived) {
            console.error('❌ Chat SDK: Max reconnection attempts reached, giving up');
            this.config.callbacks?.onError?.(error);
            reject(error);
          }
        });

        // Handle disconnect
        this.socket.on('disconnect', (reason) => {
          console.warn('⚠️ Chat SDK: Disconnected -', reason);
          this.connected = false;
          this.emit('disconnect', { reason });
        });

        // Handle reconnect
        this.socket.on('reconnect', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          
          // Rejoin session on reconnect
          if (this.session) {
            this.socket?.emit(WS_EVENTS.JOIN_SESSION, { chatSessionId: this.session.id });
          }
          
          this.emit('reconnect', {});
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send a message
   */
  sendMessage(content: string, messageType: MessageType = 'TEXT'): void {
    if (!this.socket || !this.connected || !this.session) {
      throw new Error('Not connected to chat');
    }

    this.socket.emit(WS_EVENTS.MESSAGE_SEND, {
      chatSessionId: this.session.id,
      content,
      messageType,
    });
  }

  /**
   * Send typing start indicator
   */
  startTyping(): void {
    if (this.socket && this.connected && this.session) {
      this.socket.emit(WS_EVENTS.TYPING_START, { chatSessionId: this.session.id });
    }
  }

  /**
   * Send typing stop indicator
   */
  stopTyping(): void {
    if (this.socket && this.connected && this.session) {
      this.socket.emit(WS_EVENTS.TYPING_STOP, { chatSessionId: this.session.id });
    }
  }

  /**
   * Request human agent
   */
  requestAgent(reason?: string): void {
    if (this.socket && this.connected && this.session) {
      this.socket.emit(WS_EVENTS.REQUEST_AGENT, {
        chatSessionId: this.session.id,
        reason,
      });
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.session = null;
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: EventCallback): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(callback);
    };
  }

  /**
   * Emit event to subscribers
   */
  private emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
}
