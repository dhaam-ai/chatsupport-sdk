// ==========================================
// Chat SDK - Chat Widget Component
// Includes: conversational flow, quick replies, agent escalation
// ==========================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// ==========================================
// Flow Types
// ==========================================

type FlowStep =
  | 'welcome'       // just opened, show welcome
  | 'menu'          // show quick reply options
  | 'escalating'    // queuing to agent (spinner screen)
  | 'free';         // free-form chat

interface QuickReply {
  id: string;
  label: string;
  icon: string;
}

const MAIN_MENU: QuickReply[] = [
  { id: 'order_details', icon: '📦', label: 'Check Order Details' },
  { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
  { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
  { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
];

// ==========================================
// Theme
// ==========================================

const defaultTheme = {
  primaryColor: '#5b4fcf',
  headerBackground: '#5b4fcf',
  headerText: '#ffffff',
  customerBubbleColor: '#5b4fcf',
  agentBubbleColor: '#f0effe',
  fontFamily: '"Outfit", "DM Sans", system-ui, sans-serif',
  borderRadius: '16px',
  position: 'bottom-right' as 'bottom-right' | 'bottom-left',
};

type FullTheme = { primaryColor: string; headerBackground: string; headerText: string; customerBubbleColor: string; agentBubbleColor: string; fontFamily: string; borderRadius: string; position: 'bottom-right' | 'bottom-left'; };

function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
  const t: FullTheme = { ...defaultTheme, ...theme };
  const isRight = (t.position as string) !== 'bottom-left';

  return {
    container: {
      position: 'fixed',
      bottom: '24px',
      [isRight ? 'right' : 'left']: '24px',
      zIndex: 9999,
      fontFamily: t.fontFamily,
    },
    launcher: {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: `0 4px 20px ${t.primaryColor}55`,
      transition: 'transform 0.2s, box-shadow 0.2s',
    },
    widget: {
      width: '380px',
      height: '560px',
      backgroundColor: '#ffffff',
      borderRadius: t.borderRadius,
      boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      border: '1px solid rgba(0,0,0,0.06)',
    },
    header: {
      background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`,
      color: t.headerText,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexShrink: 0,
    },
    headerAvatar: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255,255,255,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      flexShrink: 0,
    },
    headerInfo: { flex: 1 },
    headerTitle: {
      fontSize: '15px',
      fontWeight: 700,
      margin: 0,
      letterSpacing: '-0.01em',
    },
    headerSub: {
      fontSize: '11px',
      opacity: 0.85,
      margin: '2px 0 0',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    },
    onlineDot: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      backgroundColor: '#4ade80',
      display: 'inline-block',
      flexShrink: 0,
    },
    closeBtn: {
      background: 'rgba(255,255,255,0.15)',
      border: 'none',
      color: t.headerText,
      cursor: 'pointer',
      padding: '6px',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    messages: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      backgroundColor: '#fafafa',
    },
    bubbleCustomer: {
      alignSelf: 'flex-end',
      background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`,
      color: '#ffffff',
      padding: '10px 14px',
      borderRadius: '18px 18px 4px 18px',
      maxWidth: '78%',
      wordBreak: 'break-word',
      fontSize: '14px',
      lineHeight: 1.5,
      boxShadow: `0 2px 8px ${t.customerBubbleColor}33`,
    },
    bubbleAgent: {
      alignSelf: 'flex-start',
      backgroundColor: '#ffffff',
      color: '#1a1a2e',
      padding: '10px 14px',
      borderRadius: '18px 18px 18px 4px',
      maxWidth: '78%',
      wordBreak: 'break-word',
      fontSize: '14px',
      lineHeight: 1.5,
      boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      border: '1px solid #f0f0f5',
      whiteSpace: 'pre-line',
    },
    bubbleSystem: {
      alignSelf: 'center',
      backgroundColor: '#ede9fe',
      color: '#5b4fcf',
      padding: '5px 14px',
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 600,
      textAlign: 'center' as const,
    },
    senderLabel: {
      fontSize: '10px',
      color: '#9ca3af',
      marginBottom: '3px',
      paddingLeft: '2px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.04em',
    },
    timestamp: {
      fontSize: '10px',
      opacity: 0.5,
      marginTop: '4px',
    },
    typingWrap: {
      alignSelf: 'flex-start',
      backgroundColor: '#ffffff',
      padding: '12px 16px',
      borderRadius: '18px 18px 18px 4px',
      display: 'flex',
      gap: '5px',
      alignItems: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      border: '1px solid #f0f0f5',
    },
    typingDot: {
      width: '7px',
      height: '7px',
      backgroundColor: '#9ca3af',
      borderRadius: '50%',
    },
    quickRepliesWrap: {
      padding: '10px 14px 12px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '8px',
      backgroundColor: '#fafafa',
      borderTop: '1px solid #f0f0f0',
      flexShrink: 0,
    },
    quickRepliesLabel: {
      fontSize: '11px',
      color: '#9ca3af',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
    },
    quickReplyBtn: {
      width: '100%',
      padding: '10px 16px',
      borderRadius: '12px',
      border: '1.5px solid #e0d9ff',
      backgroundColor: '#ffffff',
      color: '#5b4fcf',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 600,
      fontFamily: 'inherit',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      textAlign: 'left' as const,
      transition: 'all 0.15s',
    },
    inputArea: {
      padding: '10px 12px',
      borderTop: '1px solid #f0f0f5',
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      backgroundColor: '#ffffff',
      flexShrink: 0,
    },
    input: {
      flex: 1,
      padding: '10px 14px',
      borderRadius: '22px',
      border: '1.5px solid #e5e7eb',
      fontSize: '14px',
      outline: 'none',
      fontFamily: 'inherit',
      backgroundColor: '#f9fafb',
      color: '#111827',
      transition: 'border-color 0.2s',
    },
    sendBtn: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      transition: 'all 0.15s',
    },
    centeredBox: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      padding: '32px',
      backgroundColor: '#fafafa',
      textAlign: 'center' as const,
    },
  };
}

// ==========================================
// Icons
// ==========================================

const ChatIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" opacity="0.95" />
    <circle cx="8"  cy="10" r="1" fill="rgba(255,255,255,0.5)" />
    <circle cx="12" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
    <circle cx="16" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SendIcon = ({ active }: { active: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
    <path d="M22 2L11 13" stroke={active ? 'white' : '#9ca3af'} strokeWidth="2.5" strokeLinecap="round" />
    <path d="M22 2L15 22L11 13L2 9L22 2Z" fill={active ? 'white' : '#9ca3af'} />
  </svg>
);

// ==========================================
// Sub-components
// ==========================================

function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }) {
  return (
    <div style={styles.typingWrap}>
      {[0, 0.2, 0.4].map((d, i) => (
        <div key={i} style={{
          ...styles.typingDot,
          animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out`,
        }} />
      ))}
    </div>
  );
}

function MessageBubble({ message, styles, userName }: {
  message: ChatMessage;
  styles: Record<string, React.CSSProperties>;
  userName?: string;
}) {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isSystem   = message.senderType === 'SYSTEM';
  const isBot      = message.senderType === 'BOT';
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

  const label = isCustomer ? null : isBot ? 'AI Assistant' : (message.senderName || 'Agent');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-end' : 'flex-start' }}>
      {label && <div style={styles.senderLabel}>{label}</div>}
      <div style={isCustomer ? styles.bubbleCustomer : styles.bubbleAgent}>
        {message.content}
        <div style={{ ...styles.timestamp, textAlign: isCustomer ? 'right' : 'left' }}>{time}</div>
      </div>
    </div>
  );
}

function QuickReplies({ replies, onSelect, styles, primaryColor }: {
  replies: QuickReply[];
  onSelect: (r: QuickReply) => void;
  styles: Record<string, React.CSSProperties>;
  primaryColor: string;
}) {
  return (
    <div style={styles.quickRepliesWrap}>
      <div style={styles.quickRepliesLabel}>Choose an option</div>
      {replies.map(r => (
        <button
          key={r.id}
          style={styles.quickReplyBtn}
          onClick={() => onSelect(r)}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe';
            (e.currentTarget as HTMLElement).style.borderColor = primaryColor;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff';
            (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff';
          }}
        >
          <span style={{ fontSize: 16 }}>{r.icon}</span>
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );
}

function EscalatingScreen({ styles, primaryColor }: { styles: Record<string, React.CSSProperties>; primaryColor: string }) {
  return (
    <div style={styles.centeredBox}>
      <div style={{ fontSize: 52 }}>👤</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 8 }}>
          Connecting you to an agent
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>
          You've been added to the support queue.<br />
          An agent will join shortly.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 0.2, 0.4].map((d, i) => (
          <div key={i} style={{
            width: 9, height: 9, borderRadius: '50%', backgroundColor: primaryColor,
            animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out`,
          }} />
        ))}
      </div>
      <div style={{
        padding: '8px 20px', borderRadius: 20,
        backgroundColor: '#ede9fe', color: primaryColor,
        fontSize: 12, fontWeight: 700,
      }}>
        Est. wait: &lt; 2 min
      </div>
    </div>
  );
}

// ==========================================
// ChatContent
// ==========================================

function ChatContent({ onClose, styles, config, theme }: {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  config: ChatSDKConfig;
  theme: FullTheme;
}): JSX.Element {
  const { state, actions } = useChat();
  const [inputValue, setInputValue] = useState('');
  const [flowStep, setFlowStep] = useState<FlowStep>('welcome');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasWelcomed = useRef(false);

  // Inject CSS keyframes
  useEffect(() => {
    const id = 'chat-sdk-kf';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = `
        @keyframes chatTypingBounce {
          0%,80%,100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(s);
    }
  }, []);

  const addLocal = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp' | 'chatSessionId' | 'messageType'> & { id?: string; chatSessionId?: string; messageType?: ChatMessage['messageType'] }) => {
    const full: ChatMessage = {
      id: msg.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
      ...msg,
      chatSessionId: msg.chatSessionId || state.session?.id || 'local',
      messageType: msg.messageType || 'TEXT',
    };
    setLocalMessages(prev => [...prev, full]);
  }, [state.session?.id]);

  const botReply = useCallback((content: string, delay = 800) => {
    setShowTyping(true);
    return new Promise<void>(resolve => {
      setTimeout(() => {
        setShowTyping(false);
        addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
        resolve();
      }, delay);
    });
  }, [addLocal]);

  // Run welcome flow once connected
  useEffect(() => {
    if (!state.connected || hasWelcomed.current) return;
    hasWelcomed.current = true;
    const run = async () => {
      await botReply('👋 Hello! Welcome to Support. How can I help you today?', 700);
      setFlowStep('menu');
      setShowQuickReplies(true);
    };
    setTimeout(run, 300);
  }, [state.connected, botReply]);

  // Focus input when in free chat
  useEffect(() => {
    if (flowStep === 'free') inputRef.current?.focus();
  }, [flowStep]);

  // Auto-scroll
  const allMessages = [...state.messages, ...localMessages]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length, showTyping]);

  // Handle quick reply tap
  const handleQuickReply = useCallback(async (reply: QuickReply) => {
    setShowQuickReplies(false);
    addLocal({
      senderType: 'CUSTOMER', senderId: config.user.id,
      senderName: config.user.name, content: reply.label,
    });

    switch (reply.id) {
      case 'order_details':
        await botReply("Sure! Let me pull up your recent orders.", 800);
        await botReply(
          "📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch",
          1400,
        );
        await botReply("Is there anything else I can help you with?", 900);
        setFlowStep('menu');
        setShowQuickReplies(true);
        break;

      case 'track_order':
        await botReply("🔍 Fetching tracking info for your latest order...", 800);
        await botReply(
          "📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18",
          1600,
        );
        await botReply("Need anything else?", 800);
        setFlowStep('menu');
        setShowQuickReplies(true);
        break;

      case 'faq':
        await botReply("📚 Here are answers to common questions:", 800);
        await botReply(
          "🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)",
          1500,
        );
        await botReply("Still need help?", 700);
        setFlowStep('menu');
        setShowQuickReplies(true);
        break;

      case 'human':
        setFlowStep('escalating');
        await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
        // Actual escalation call
        try {
          if (state.session?.id) {
            actions.requestAgent?.('Customer requested human agent');
          }
        } catch (e) {
          console.error('Escalation error', e);
        }
        // After 3s show queued confirmation
        setTimeout(() => {
          addLocal({
            senderType: 'SYSTEM', senderId: 'system',
            content: '🟢 You are now in the agent queue',
          });
          setFlowStep('free');
        }, 3000);
        break;
    }
  }, [addLocal, botReply, actions, config.user, state.session?.id]);

  // Send free-form message
  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !state.connected) return;
    actions.sendMessage(content);
    setInputValue('');
    actions.stopTyping?.();
    if (flowStep !== 'free') {
      setShowQuickReplies(false);
      setFlowStep('free');
    }
  }, [inputValue, actions, state.connected, flowStep]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    actions.startTyping?.();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => actions.stopTyping?.(), 2000);
  }, [actions]);

  const subtitle = (() => {
    if (state.loading) return 'Connecting...';
    if (flowStep === 'escalating') return 'Connecting to agent...';
    if (state.session?.assignedAgentName) return `Chatting with ${state.session.assignedAgentName}`;
    if (state.session?.mode === 'HUMAN') return 'Connected to agent';
    return 'AI Support · Online';
  })();

  const isClosed = state.session?.status === 'CLOSED';
  const canType = !isClosed && state.connected && flowStep !== 'escalating';
  const isActive = inputValue.trim() && canType;

  // Loading
  if (state.loading) {
    return (
      <div style={styles.widget}>
        <WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme} />
        <div style={styles.centeredBox}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
            </path>
          </svg>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>Starting chat...</span>
        </div>
      </div>
    );
  }

  // Error
  if (state.error && !state.connected) {
    return (
      <div style={styles.widget}>
        <WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme} />
        <div style={styles.centeredBox}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Connection Lost</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{state.error.message}</div>
          </div>
          <button onClick={() => actions.reconnect?.()}
            style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.widget}>
      <WidgetHeader onClose={onClose} styles={styles} subtitle={subtitle} theme={theme} />

      {flowStep === 'escalating' ? (
        <EscalatingScreen styles={styles} primaryColor={theme.primaryColor} />
      ) : (
        <>
          <div style={styles.messages}>
            {allMessages.map(msg => (
              <div key={msg.id} style={{ animation: 'chatFadeIn 0.2s ease' }}>
                <MessageBubble message={msg} styles={styles} userName={config.user.name} />
              </div>
            ))}
            {(showTyping || state.isTyping) && <TypingIndicator styles={styles} />}
            <div ref={messagesEndRef} />
          </div>

          {showQuickReplies && flowStep === 'menu' && (
            <QuickReplies
              replies={MAIN_MENU}
              onSelect={handleQuickReply}
              styles={styles}
              primaryColor={theme.primaryColor}
            />
          )}

          {isClosed ? (
            <div style={{ padding: '14px', textAlign: 'center', fontSize: 13, color: '#9ca3af', borderTop: '1px solid #f0f0f5' }}>
              This chat has ended.
            </div>
          ) : (
            <div style={styles.inputArea}>
              <input
                ref={inputRef}
                type="text"
                placeholder={canType ? 'Type a message...' : 'Connecting...'}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={!canType}
                style={{
                  ...styles.input,
                  borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb',
                  opacity: canType ? 1 : 0.6,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!isActive}
                style={{
                  ...styles.sendBtn,
                  background: isActive
                    ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)`
                    : '#f3f4f6',
                  boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none',
                  cursor: isActive ? 'pointer' : 'not-allowed',
                }}
              >
                <SendIcon active={!!isActive} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// Header
// ==========================================

function WidgetHeader({ onClose, styles, subtitle, theme }: {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  subtitle: string;
  theme: FullTheme;
}) {
  return (
    <div style={styles.header}>
      <div style={styles.headerAvatar}>💬</div>
      <div style={styles.headerInfo}>
        <h3 style={styles.headerTitle}>Chat Support</h3>
        <div style={styles.headerSub}>
          <span style={styles.onlineDot} />
          {subtitle}
        </div>
      </div>
      <button style={styles.closeBtn} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

// ==========================================
// ChatWidget
// ==========================================

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [launchHover, setLaunchHover] = useState(false);
  const theme: FullTheme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);

  return (
    <div style={styles.container}>
      {/* Launcher button — only visible when chat is closed */}
      {!isOpen && (
        <button
          style={{
            ...styles.launcher,
            transform: launchHover ? 'scale(1.1)' : 'scale(1)',
            boxShadow: launchHover
              ? `0 6px 28px ${theme.primaryColor}77`
              : `0 4px 20px ${theme.primaryColor}44`,
          }}
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setLaunchHover(true)}
          onMouseLeave={() => setLaunchHover(false)}
          aria-label="Open chat support"
        >
          <ChatIcon />
        </button>
      )}

      {/* ChatProvider ALWAYS mounted — WebSocket connects on load, never disconnects on close */}
      <ChatProvider config={config}>
        <div style={{ display: isOpen ? 'block' : 'none' }}>
          <ChatContent
            onClose={() => setIsOpen(false)}
            styles={styles}
            config={config}
            theme={theme}
          />
        </div>
      </ChatProvider>
    </div>
  );
}

export default ChatWidget;