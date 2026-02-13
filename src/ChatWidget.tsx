// ==========================================
// Chat SDK - Chat Widget Component
// ==========================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// ==========================================
// Styles (inline for zero-config usage)
// ==========================================

const defaultTheme: Required<ChatTheme> = {
  primaryColor: '#007bff',
  headerBackground: '#007bff',
  headerText: '#ffffff',
  customerBubbleColor: '#007bff',
  agentBubbleColor: '#e9ecef',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  borderRadius: '12px',
  position: 'bottom-right',
};

function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
  const t = { ...defaultTheme, ...theme };
  const isRight = t.position === 'bottom-right';

  return {
    container: {
      position: 'fixed',
      bottom: '20px',
      [isRight ? 'right' : 'left']: '20px',
      zIndex: 9999,
      fontFamily: t.fontFamily,
    },
    launcher: {
      width: '60px',
      height: '60px',
      borderRadius: '50%',
      backgroundColor: t.primaryColor,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      transition: 'transform 0.2s, box-shadow 0.2s',
    },
    widget: {
      width: '380px',
      height: '520px',
      backgroundColor: '#ffffff',
      borderRadius: t.borderRadius,
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    header: {
      backgroundColor: t.headerBackground,
      color: t.headerText,
      padding: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      fontSize: '16px',
      fontWeight: 600,
      margin: 0,
    },
    headerSubtitle: {
      fontSize: '12px',
      opacity: 0.9,
      margin: 0,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      color: t.headerText,
      cursor: 'pointer',
      padding: '4px',
      fontSize: '20px',
      lineHeight: 1,
    },
    messages: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    messageCustomer: {
      alignSelf: 'flex-end',
      backgroundColor: t.customerBubbleColor,
      color: '#ffffff',
      padding: '10px 14px',
      borderRadius: '18px 18px 4px 18px',
      maxWidth: '75%',
      wordBreak: 'break-word',
    },
    messageAgent: {
      alignSelf: 'flex-start',
      backgroundColor: t.agentBubbleColor,
      color: '#212529',
      padding: '10px 14px',
      borderRadius: '18px 18px 18px 4px',
      maxWidth: '75%',
      wordBreak: 'break-word',
    },
    messageSystem: {
      alignSelf: 'center',
      backgroundColor: '#f8f9fa',
      color: '#6c757d',
      padding: '6px 12px',
      borderRadius: '12px',
      fontSize: '12px',
      textAlign: 'center',
    },
    typingIndicator: {
      alignSelf: 'flex-start',
      backgroundColor: t.agentBubbleColor,
      padding: '10px 14px',
      borderRadius: '18px 18px 18px 4px',
      display: 'flex',
      gap: '4px',
    },
    typingDot: {
      width: '8px',
      height: '8px',
      backgroundColor: '#6c757d',
      borderRadius: '50%',
      animation: 'typing-bounce 1.4s infinite ease-in-out',
    },
    inputArea: {
      padding: '12px',
      borderTop: '1px solid #e9ecef',
      display: 'flex',
      gap: '8px',
    },
    input: {
      flex: 1,
      padding: '10px 14px',
      borderRadius: '20px',
      border: '1px solid #e9ecef',
      fontSize: '14px',
      outline: 'none',
      transition: 'border-color 0.2s',
    },
    sendButton: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      backgroundColor: t.primaryColor,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#ffffff',
    },
    statusBar: {
      padding: '8px 16px',
      backgroundColor: '#f8f9fa',
      fontSize: '12px',
      color: '#6c757d',
      textAlign: 'center',
    },
    error: {
      padding: '12px 16px',
      backgroundColor: '#f8d7da',
      color: '#721c24',
      fontSize: '14px',
      textAlign: 'center',
    },
    loading: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#6c757d',
    },
  };
}

// ==========================================
// Icons (inline SVG)
// ==========================================

const ChatIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" />
  </svg>
);

// ==========================================
// Message Component
// ==========================================

interface MessageBubbleProps {
  message: ChatMessage;
  styles: Record<string, React.CSSProperties>;
  userName?: string;
}

function MessageBubble({ message, styles, userName }: MessageBubbleProps): JSX.Element {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isSystem = message.senderType === 'SYSTEM';
  const isBot = message.senderType === 'BOT';

  let style: React.CSSProperties;
  if (isSystem) {
    style = styles.messageSystem;
  } else if (isCustomer) {
    style = styles.messageCustomer;
  } else {
    style = styles.messageAgent;
  }

  const senderName = isCustomer
    ? userName || 'You'
    : isBot
    ? 'AI Assistant'
    : message.senderName || 'Agent';

  return (
    <div style={style}>
      {!isSystem && !isCustomer && (
        <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
          {senderName}
        </div>
      )}
      <div>{message.content}</div>
      <div
        style={{
          fontSize: '10px',
          opacity: 0.7,
          marginTop: '4px',
          textAlign: isCustomer ? 'right' : 'left',
        }}
      >
        {new Date(message.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  );
}

// ==========================================
// Typing Indicator
// ==========================================

function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }): JSX.Element {
  return (
    <div style={styles.typingIndicator}>
      <div style={{ ...styles.typingDot, animationDelay: '0s' }} />
      <div style={{ ...styles.typingDot, animationDelay: '0.2s' }} />
      <div style={{ ...styles.typingDot, animationDelay: '0.4s' }} />
    </div>
  );
}

// ==========================================
// Chat Content
// ==========================================

interface ChatContentProps {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  config: ChatSDKConfig;
}

function ChatContent({ onClose, styles, config }: ChatContentProps): JSX.Element {
  const { state, actions } = useChat();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages, state.isTyping]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content) return;

    actions.sendMessage(content);
    setInputValue('');
    actions.stopTyping();
  }, [inputValue, actions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);

      // Typing indicator
      actions.startTyping();

      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Stop typing after 2 seconds of no input
      typingTimeoutRef.current = setTimeout(() => {
        actions.stopTyping();
      }, 2000);
    },
    [actions]
  );

  // Get status text
  const getStatusText = (): string => {
    if (!state.session) return 'Connecting...';
    
    switch (state.session.status) {
      case 'OPEN':
        return state.session.mode === 'BOT' ? 'Chatting with AI' : 'Connected';
      case 'WAITING_FOR_AGENT':
        return 'Waiting for agent...';
      case 'ASSIGNED':
        return state.session.assignedAgentName
          ? `Chatting with ${state.session.assignedAgentName}`
          : 'Connected to agent';
      case 'CLOSED':
        return 'Chat ended';
      default:
        return 'Connected';
    }
  };

  // Loading state
  if (state.loading) {
    return (
      <div style={styles.widget}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.headerTitle}>Chat Support</h3>
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div style={styles.loading}>Connecting...</div>
      </div>
    );
  }

  // Error state
  if (state.error && !state.connected) {
    return (
      <div style={styles.widget}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.headerTitle}>Chat Support</h3>
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div style={styles.error}>
          <div>Connection error</div>
          <button
            onClick={() => actions.reconnect()}
            style={{
              marginTop: '8px',
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#721c24',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isClosed = state.session?.status === 'CLOSED';

  return (
    <div style={styles.widget}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h3 style={styles.headerTitle}>Chat Support</h3>
          <p style={styles.headerSubtitle}>{getStatusText()}</p>
        </div>
        <button style={styles.closeButton} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {state.messages.length === 0 && !state.loading && (
          <div style={{ ...styles.messageSystem, padding: '20px' }}>
            Welcome! How can we help you today?
          </div>
        )}

        {state.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            styles={styles}
            userName={config.user.name}
          />
        ))}

        {state.isTyping && <TypingIndicator styles={styles} />}

        <div ref={messagesEndRef} />
      </div>

      {/* Status bar for waiting */}
      {state.session?.status === 'WAITING_FOR_AGENT' && (
        <div style={styles.statusBar}>
          An agent will be with you shortly...
        </div>
      )}

      {/* Input area */}
      {!isClosed ? (
        <div style={styles.inputArea}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message..."
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={styles.input}
            disabled={!state.connected}
          />
          <button
            style={{
              ...styles.sendButton,
              opacity: inputValue.trim() ? 1 : 0.5,
            }}
            onClick={handleSend}
            disabled={!inputValue.trim() || !state.connected}
          >
            <SendIcon />
          </button>
        </div>
      ) : (
        <div style={styles.statusBar}>
          This chat has ended.
        </div>
      )}
    </div>
  );
}

// ==========================================
// Main ChatWidget Component
// ==========================================

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const styles = getStyles(config.theme);

  // Inject keyframe animation for typing indicator
  useEffect(() => {
    const styleId = 'chat-sdk-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div style={styles.container}>
      {isOpen ? (
        <ChatProvider config={config}>
          <ChatContent
            onClose={() => setIsOpen(false)}
            styles={styles}
            config={config}
          />
        </ChatProvider>
      ) : (
        <button
          style={styles.launcher}
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <ChatIcon />
        </button>
      )}
    </div>
  );
}

export default ChatWidget;
