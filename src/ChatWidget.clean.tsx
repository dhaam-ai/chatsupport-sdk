// ==========================================
// Chat SDK - Modern Chat Widget Component
// Clean, Professional UI with Dark/Light Modes
// ==========================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// ==========================================
// Theme System
// ==========================================

interface ThemeColors {
  // Core Colors
  primary: string;
  primaryHover: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceHover: string;
  
  // Text Colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  
  // Bubble Colors
  customerBubble: string;
  customerBubbleText: string;
  agentBubble: string;
  agentBubbleText: string;
  botBubble: string;
  botBubbleText: string;
  systemBubble: string;
  systemBubbleText: string;
  
  // UI Elements
  border: string;
  shadow: string;
  overlay: string;
  
  // States
  success: string;
  warning: string;
  error: string;
  info: string;
}

const lightTheme: ThemeColors = {
  primary: '#6366f1',
  primaryHover: '#4f46e5',
  secondary: '#10b981',
  background: '#ffffff',
  surface: '#f8fafc',
  surfaceHover: '#f1f5f9',
  
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textOnPrimary: '#ffffff',
  
  customerBubble: '#6366f1',
  customerBubbleText: '#ffffff',
  agentBubble: '#e2e8f0',
  agentBubbleText: '#0f172a',
  botBubble: '#dbeafe',
  botBubbleText: '#1e40af',
  systemBubble: '#f1f5f9',
  systemBubbleText: '#64748b',
  
  border: '#e2e8f0',
  shadow: 'rgba(0, 0, 0, 0.1)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
};

const darkTheme: ThemeColors = {
  primary: '#818cf8',
  primaryHover: '#a5b4fc',
  secondary: '#34d399',
  background: '#0f172a',
  surface: '#1e293b',
  surfaceHover: '#334155',
  
  textPrimary: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  textOnPrimary: '#0f172a',
  
  customerBubble: '#818cf8',
  customerBubbleText: '#0f172a',
  agentBubble: '#334155',
  agentBubbleText: '#f8fafc',
  botBubble: '#1e3a5f',
  botBubbleText: '#93c5fd',
  systemBubble: '#1e293b',
  systemBubbleText: '#94a3b8',
  
  border: '#334155',
  shadow: 'rgba(0, 0, 0, 0.3)',
  overlay: 'rgba(0, 0, 0, 0.7)',
  
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#60a5fa',
};

// ==========================================
// Styled Components (CSS-in-JS)
// ==========================================

const createStyles = (colors: ThemeColors, userTheme: ChatTheme = {}) => {
  const isRight = userTheme.position !== 'bottom-left';
  const borderRadius = userTheme.borderRadius || '16px';
  const fontFamily = userTheme.fontFamily || 
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  return {
    // Container & Launcher
    container: {
      position: 'fixed' as const,
      bottom: '24px',
      [isRight ? 'right' : 'left']: '24px',
      zIndex: 99999,
      fontFamily,
    },
    
    launcher: {
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      backgroundColor: userTheme.primaryColor || colors.primary,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: `0 4px 24px ${colors.shadow}`,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      transform: 'scale(1)',
    },
    
    launcherHover: {
      transform: 'scale(1.05)',
      boxShadow: `0 8px 32px ${colors.shadow}`,
    },
    
    // Widget Window
    widget: {
      width: '400px',
      height: '600px',
      maxWidth: 'calc(100vw - 48px)',
      maxHeight: 'calc(100vh - 120px)',
      backgroundColor: colors.background,
      borderRadius,
      boxShadow: `0 16px 64px ${colors.shadow}`,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
      animation: 'slideUp 0.3s ease-out',
    },
    
    // Header
    header: {
      background: `linear-gradient(135deg, ${userTheme.headerBackground || userTheme.primaryColor || colors.primary} 0%, ${colors.primaryHover} 100%)`,
      color: userTheme.headerText || colors.textOnPrimary,
      padding: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      position: 'relative' as const,
    },
    
    headerAvatar: {
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    headerContent: {
      flex: 1,
    },
    
    headerTitle: {
      fontSize: '18px',
      fontWeight: 700,
      margin: 0,
      letterSpacing: '-0.02em',
    },
    
    headerSubtitle: {
      fontSize: '13px',
      opacity: 0.9,
      margin: '4px 0 0 0',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    
    statusDot: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: colors.success,
      animation: 'pulse 2s infinite',
    },
    
    closeButton: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background-color 0.2s',
    },
    
    // Messages Container
    messages: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '16px',
      backgroundColor: colors.background,
    },
    
    // Message Bubbles
    messageWrapper: {
      display: 'flex',
      flexDirection: 'column' as const,
      maxWidth: '80%',
    },
    
    messageWrapperCustomer: {
      alignSelf: 'flex-end',
    },
    
    messageWrapperAgent: {
      alignSelf: 'flex-start',
    },
    
    messageSender: {
      fontSize: '12px',
      color: colors.textMuted,
      marginBottom: '4px',
      paddingLeft: '12px',
    },
    
    messageBubbleBase: {
      padding: '12px 16px',
      fontSize: '14px',
      lineHeight: 1.5,
      wordBreak: 'break-word' as const,
      boxShadow: `0 1px 2px ${colors.shadow}`,
    },
    
    messageCustomer: {
      backgroundColor: userTheme.customerBubbleColor || colors.customerBubble,
      color: colors.customerBubbleText,
      borderRadius: '20px 20px 4px 20px',
    },
    
    messageAgent: {
      backgroundColor: colors.agentBubble,
      color: colors.agentBubbleText,
      borderRadius: '20px 20px 20px 4px',
    },
    
    messageBot: {
      backgroundColor: colors.botBubble,
      color: colors.botBubbleText,
      borderRadius: '20px 20px 20px 4px',
    },
    
    messageSystem: {
      alignSelf: 'center' as const,
      backgroundColor: colors.systemBubble,
      color: colors.systemBubbleText,
      padding: '8px 16px',
      borderRadius: '12px',
      fontSize: '12px',
      textAlign: 'center' as const,
      maxWidth: '90%',
    },
    
    messageTime: {
      fontSize: '11px',
      color: colors.textMuted,
      marginTop: '4px',
      paddingLeft: '12px',
      paddingRight: '12px',
    },
    
    // Typing Indicator
    typingIndicator: {
      display: 'flex',
      gap: '4px',
      padding: '12px 16px',
      backgroundColor: colors.surface,
      borderRadius: '20px',
      width: 'fit-content',
    },
    
    typingDot: {
      width: '8px',
      height: '8px',
      backgroundColor: colors.textMuted,
      borderRadius: '50%',
    },
    
    // Input Area
    inputArea: {
      padding: '16px 20px',
      backgroundColor: colors.surface,
      borderTop: `1px solid ${colors.border}`,
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-end',
    },
    
    inputWrapper: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: '24px',
      border: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      padding: '4px 8px 4px 16px',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    },
    
    inputWrapperFocus: {
      borderColor: userTheme.primaryColor || colors.primary,
      boxShadow: `0 0 0 3px ${colors.primary}20`,
    },
    
    input: {
      flex: 1,
      border: 'none',
      backgroundColor: 'transparent',
      color: colors.textPrimary,
      fontSize: '14px',
      lineHeight: '24px',
      padding: '8px 0',
      resize: 'none' as const,
      outline: 'none',
      fontFamily,
      maxHeight: '120px',
    },
    
    sendButton: {
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      backgroundColor: userTheme.primaryColor || colors.primary,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s',
      flexShrink: 0,
    },
    
    sendButtonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    
    // Status Bar
    statusBar: {
      padding: '10px 20px',
      backgroundColor: colors.surface,
      borderTop: `1px solid ${colors.border}`,
      fontSize: '12px',
      color: colors.textSecondary,
      textAlign: 'center' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
    },
    
    // States
    error: {
      margin: '16px',
      padding: '12px 16px',
      backgroundColor: `${colors.error}15`,
      color: colors.error,
      borderRadius: '12px',
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    
    loading: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      color: colors.textMuted,
    },
    
    // Welcome Screen
    welcome: {
      flex: 1,
      padding: '40px 24px',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
    },
    
    welcomeIcon: {
      width: '80px',
      height: '80px',
      borderRadius: '50%',
      backgroundColor: `${colors.primary}15`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '24px',
    },
    
    welcomeTitle: {
      fontSize: '20px',
      fontWeight: 700,
      color: colors.textPrimary,
      margin: '0 0 12px 0',
    },
    
    welcomeText: {
      fontSize: '14px',
      color: colors.textSecondary,
      margin: '0 0 32px 0',
      lineHeight: 1.6,
    },
    
    startButton: {
      padding: '14px 32px',
      backgroundColor: userTheme.primaryColor || colors.primary,
      color: colors.textOnPrimary,
      border: 'none',
      borderRadius: '12px',
      fontSize: '15px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    
    // Quick Replies
    quickReplies: {
      display: 'flex',
      flexWrap: 'wrap' as const,
      gap: '8px',
      padding: '12px 20px',
      backgroundColor: colors.surface,
    },
    
    quickReplyButton: {
      padding: '8px 16px',
      backgroundColor: colors.background,
      color: colors.textPrimary,
      border: `1px solid ${colors.border}`,
      borderRadius: '20px',
      fontSize: '13px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
  };
};

// ==========================================
// Icons
// ==========================================

const ChatIcon = ({ color = 'white', size = 28 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const CloseIcon = ({ color = 'white', size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SendIcon = ({ color = 'white', size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const BotIcon = ({ color = 'currentColor', size = 24 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
);

const AgentIcon = ({ color = 'currentColor', size = 24 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const MinimizeIcon = ({ color = 'white', size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

// ==========================================
// Animation Styles (inject once)
// ==========================================

const animationStyles = `
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  @keyframes typing {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  .chat-widget-messages::-webkit-scrollbar {
    width: 6px;
  }
  
  .chat-widget-messages::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .chat-widget-messages::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
  
  .chat-widget-messages::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
  }
`;

// ==========================================
// Typing Indicator Component
// ==========================================

const TypingIndicator: React.FC<{ styles: ReturnType<typeof createStyles> }> = ({ styles }) => (
  <div style={styles.typingIndicator}>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={{
          ...styles.typingDot,
          animation: `typing 1.4s infinite ${i * 0.2}s`,
        }}
      />
    ))}
  </div>
);

// ==========================================
// Message Component
// ==========================================

interface MessageProps {
  message: ChatMessage;
  styles: ReturnType<typeof createStyles>;
  formatTime: (date: Date) => string;
}

const Message: React.FC<MessageProps> = ({ message, styles, formatTime }) => {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isAgent = message.senderType === 'AGENT';
  const isBot = message.senderType === 'BOT';
  const isSystem = message.senderType === 'SYSTEM' || message.messageType === 'SYSTEM';

  if (isSystem) {
    return (
      <div style={styles.messageSystem as React.CSSProperties}>
        {message.content}
      </div>
    );
  }

  const bubbleStyle = {
    ...styles.messageBubbleBase,
    ...(isCustomer ? styles.messageCustomer : isBot ? styles.messageBot : styles.messageAgent),
  };

  return (
    <div style={{
      ...styles.messageWrapper,
      ...(isCustomer ? styles.messageWrapperCustomer : styles.messageWrapperAgent),
    }}>
      {!isCustomer && (
        <div style={styles.messageSender}>
          {isBot ? '🤖 AI Assistant' : message.senderName || 'Agent'}
        </div>
      )}
      <div style={bubbleStyle}>
        {message.content}
      </div>
      <div style={{
        ...styles.messageTime,
        textAlign: isCustomer ? 'right' : 'left' as const,
      }}>
        {formatTime(new Date(message.timestamp))}
      </div>
    </div>
  );
};

// ==========================================
// Chat Window Component
// ==========================================

interface ChatWindowProps {
  config: ChatSDKConfig;
  onClose: () => void;
  isDark?: boolean;
}

const ChatWindowInner: React.FC<ChatWindowProps> = ({ config, onClose, isDark = false }) => {
  const { state, actions } = useChat();
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const colors = isDark ? darkTheme : lightTheme;
  const styles = useMemo(() => createStyles(colors, config.theme), [colors, config.theme]);

  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  // Handle send message
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || state.loading) return;

    setInputValue('');
    await actions.sendMessage(content);
    inputRef.current?.focus();
  }, [inputValue, state.loading, actions]);

  // Handle key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Handle typing
  const handleTyping = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    actions.startTyping();
  }, [actions]);

  // Get status text
  const statusText = useMemo(() => {
    if (!state.session) return 'Connecting...';
    switch (state.session.status) {
      case 'WAITING_FOR_AGENT':
        return '⏳ Waiting for an agent...';
      case 'ASSIGNED':
        return `🟢 Connected with ${state.session.assignedAgentName || 'Agent'}`;
      case 'CLOSED':
        return '🔴 Session ended';
      default:
        return state.session.mode === 'BOT' ? '🤖 AI Assistant' : '🟢 Online';
    }
  }, [state.session]);

  // Header title
  const headerTitle = config.theme?.headerText || config.appId || 'Chat Support';

  return (
    <div style={styles.widget as React.CSSProperties}>
      {/* Inject animations */}
      <style>{animationStyles}</style>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerAvatar}>
          {state.session?.mode === 'HUMAN' ? (
            <AgentIcon color="white" size={24} />
          ) : (
            <BotIcon color="white" size={24} />
          )}
        </div>
        <div style={styles.headerContent}>
          <h2 style={styles.headerTitle}>{headerTitle}</h2>
          <p style={styles.headerSubtitle}>
            <span style={styles.statusDot} />
            {statusText}
          </p>
        </div>
        <button
          style={styles.closeButton}
          onClick={onClose}
          aria-label="Minimize chat"
        >
          <MinimizeIcon color="white" size={18} />
        </button>
      </div>

      {/* Error State */}
      {state.error && (
        <div style={styles.error}>
          <span>⚠️</span>
          <span>{state.error.message}</span>
        </div>
      )}

      {/* Messages */}
      <div style={styles.messages} className="chat-widget-messages">
        {state.messages.length === 0 && !state.loading && (
          <div style={styles.welcome}>
            <div style={styles.welcomeIcon}>
              <ChatIcon color={colors.primary} size={40} />
            </div>
            <h3 style={styles.welcomeTitle}>Welcome! 👋</h3>
            <p style={styles.welcomeText}>
              {config.theme?.welcomeMessage || 
                "Hi there! We're here to help. Send us a message and we'll respond as soon as we can."}
            </p>
          </div>
        )}

        {state.messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            styles={styles}
            formatTime={formatTime}
          />
        ))}

        {state.isTyping && (
          <div style={styles.messageWrapper}>
            <div style={styles.messageSender}>
              {state.typingUser || 'Assistant'} is typing...
            </div>
            <TypingIndicator styles={styles} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {state.session?.status !== 'CLOSED' && (
        <div style={styles.inputArea}>
          <div style={{
            ...styles.inputWrapper,
            ...(inputFocused ? styles.inputWrapperFocus : {}),
          }}>
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleTyping}
              onKeyDown={handleKeyPress}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Type a message..."
              style={styles.input}
              rows={1}
              disabled={state.loading || state.session?.status === 'CLOSED'}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || state.loading}
            style={{
              ...styles.sendButton,
              ...((!inputValue.trim() || state.loading) ? styles.sendButtonDisabled : {}),
            }}
            aria-label="Send message"
          >
            <SendIcon color="white" size={18} />
          </button>
        </div>
      )}

      {/* Closed Session Bar */}
      {state.session?.status === 'CLOSED' && (
        <div style={styles.statusBar}>
          <span>This conversation has ended.</span>
        </div>
      )}
    </div>
  );
};

// ==========================================
// Main Chat Widget Export
// ==========================================

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  /** Dark mode */
  darkMode?: boolean;
  /** Initially open */
  defaultOpen?: boolean;
  /** Custom launcher button */
  customLauncher?: React.ReactNode;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  config,
  darkMode = false,
  defaultOpen = false,
  customLauncher,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [launcherHover, setLauncherHover] = useState(false);

  const colors = darkMode ? darkTheme : lightTheme;
  const styles = useMemo(() => createStyles(colors, config.theme), [colors, config.theme]);

  return (
    <ChatProvider config={config}>
      <div style={styles.container}>
        {/* Inject animations */}
        <style>{animationStyles}</style>

        {isOpen ? (
          <ChatWindowInner
            config={config}
            onClose={() => setIsOpen(false)}
            isDark={darkMode}
          />
        ) : customLauncher ? (
          <div onClick={() => setIsOpen(true)}>{customLauncher}</div>
        ) : (
          <button
            style={{
              ...styles.launcher,
              ...(launcherHover ? styles.launcherHover : {}),
            }}
            onClick={() => setIsOpen(true)}
            onMouseEnter={() => setLauncherHover(true)}
            onMouseLeave={() => setLauncherHover(false)}
            aria-label="Open chat"
          >
            <ChatIcon color="white" size={28} />
          </button>
        )}
      </div>
    </ChatProvider>
  );
};

export default ChatWidget;
