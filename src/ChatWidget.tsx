// // ==========================================
// // Chat SDK - Chat Widget Component
// // Includes: conversational flow, quick replies, agent escalation
// // ==========================================

// import React, { useState, useRef, useEffect, useCallback } from 'react';
// import { ChatProvider, useChat } from './context';
// import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// // ==========================================
// // Flow Types
// // ==========================================

// type FlowStep =
//   | 'welcome'       // just opened, show welcome
//   | 'menu'          // show quick reply options
//   | 'escalating'    // queuing to agent (spinner screen)
//   | 'free';         // free-form chat

// interface QuickReply {
//   id: string;
//   label: string;
//   icon: string;
// }

// const MAIN_MENU: QuickReply[] = [
//   { id: 'order_details', icon: '📦', label: 'Check Order Details' },
//   { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
//   { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
//   { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
// ];

// // ==========================================
// // Theme
// // ==========================================

// const defaultTheme = {
//   primaryColor: '#5b4fcf',
//   headerBackground: '#5b4fcf',
//   headerText: '#ffffff',
//   customerBubbleColor: '#5b4fcf',
//   agentBubbleColor: '#f0effe',
//   fontFamily: '"Outfit", "DM Sans", system-ui, sans-serif',
//   borderRadius: '16px',
//   position: 'bottom-right' as 'bottom-right' | 'bottom-left',
// };

// type FullTheme = { primaryColor: string; headerBackground: string; headerText: string; customerBubbleColor: string; agentBubbleColor: string; fontFamily: string; borderRadius: string; position: 'bottom-right' | 'bottom-left'; };

// function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
//   const t: FullTheme = { ...defaultTheme, ...theme };
//   const isRight = (t.position as string) !== 'bottom-left';

//   return {
//     container: {
//       position: 'fixed',
//       bottom: '24px',
//       [isRight ? 'right' : 'left']: '24px',
//       zIndex: 9999,
//       fontFamily: t.fontFamily,
//     },
//     launcher: {
//       width: '56px',
//       height: '56px',
//       borderRadius: '50%',
//       background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`,
//       border: 'none',
//       cursor: 'pointer',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       boxShadow: `0 4px 20px ${t.primaryColor}55`,
//       transition: 'transform 0.2s, box-shadow 0.2s',
//     },
//     widget: {
//       width: '380px',
//       height: '560px',
//       backgroundColor: '#ffffff',
//       borderRadius: t.borderRadius,
//       boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
//       display: 'flex',
//       flexDirection: 'column',
//       overflow: 'hidden',
//       border: '1px solid rgba(0,0,0,0.06)',
//     },
//     header: {
//       background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`,
//       color: t.headerText,
//       padding: '14px 16px',
//       display: 'flex',
//       alignItems: 'center',
//       gap: '10px',
//       flexShrink: 0,
//     },
//     headerAvatar: {
//       width: '36px',
//       height: '36px',
//       borderRadius: '50%',
//       backgroundColor: 'rgba(255,255,255,0.2)',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       fontSize: '18px',
//       flexShrink: 0,
//     },
//     headerInfo: { flex: 1 },
//     headerTitle: {
//       fontSize: '15px',
//       fontWeight: 700,
//       margin: 0,
//       letterSpacing: '-0.01em',
//     },
//     headerSub: {
//       fontSize: '11px',
//       opacity: 0.85,
//       margin: '2px 0 0',
//       display: 'flex',
//       alignItems: 'center',
//       gap: '5px',
//     },
//     onlineDot: {
//       width: '6px',
//       height: '6px',
//       borderRadius: '50%',
//       backgroundColor: '#4ade80',
//       display: 'inline-block',
//       flexShrink: 0,
//     },
//     closeBtn: {
//       background: 'rgba(255,255,255,0.15)',
//       border: 'none',
//       color: t.headerText,
//       cursor: 'pointer',
//       padding: '6px',
//       borderRadius: '8px',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//     },
//     messages: {
//       flex: 1,
//       overflowY: 'auto',
//       padding: '16px 14px',
//       display: 'flex',
//       flexDirection: 'column',
//       gap: '10px',
//       backgroundColor: '#fafafa',
//     },
//     bubbleCustomer: {
//       alignSelf: 'flex-end',
//       background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`,
//       color: '#ffffff',
//       padding: '10px 14px',
//       borderRadius: '18px 18px 4px 18px',
//       maxWidth: '78%',
//       wordBreak: 'break-word',
//       fontSize: '14px',
//       lineHeight: 1.5,
//       boxShadow: `0 2px 8px ${t.customerBubbleColor}33`,
//     },
//     bubbleAgent: {
//       alignSelf: 'flex-start',
//       backgroundColor: '#ffffff',
//       color: '#1a1a2e',
//       padding: '10px 14px',
//       borderRadius: '18px 18px 18px 4px',
//       maxWidth: '78%',
//       wordBreak: 'break-word',
//       fontSize: '14px',
//       lineHeight: 1.5,
//       boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
//       border: '1px solid #f0f0f5',
//       whiteSpace: 'pre-line',
//     },
//     bubbleSystem: {
//       alignSelf: 'center',
//       backgroundColor: '#ede9fe',
//       color: '#5b4fcf',
//       padding: '5px 14px',
//       borderRadius: '20px',
//       fontSize: '11px',
//       fontWeight: 600,
//       textAlign: 'center' as const,
//     },
//     senderLabel: {
//       fontSize: '10px',
//       color: '#9ca3af',
//       marginBottom: '3px',
//       paddingLeft: '2px',
//       fontWeight: 600,
//       textTransform: 'uppercase' as const,
//       letterSpacing: '0.04em',
//     },
//     timestamp: {
//       fontSize: '10px',
//       opacity: 0.5,
//       marginTop: '4px',
//     },
//     typingWrap: {
//       alignSelf: 'flex-start',
//       backgroundColor: '#ffffff',
//       padding: '12px 16px',
//       borderRadius: '18px 18px 18px 4px',
//       display: 'flex',
//       gap: '5px',
//       alignItems: 'center',
//       boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
//       border: '1px solid #f0f0f5',
//     },
//     typingDot: {
//       width: '7px',
//       height: '7px',
//       backgroundColor: '#9ca3af',
//       borderRadius: '50%',
//     },
//     quickRepliesWrap: {
//       padding: '10px 14px 12px',
//       display: 'flex',
//       flexDirection: 'column' as const,
//       gap: '8px',
//       backgroundColor: '#fafafa',
//       borderTop: '1px solid #f0f0f0',
//       flexShrink: 0,
//     },
//     quickRepliesLabel: {
//       fontSize: '11px',
//       color: '#9ca3af',
//       fontWeight: 600,
//       textTransform: 'uppercase' as const,
//       letterSpacing: '0.06em',
//     },
//     quickReplyBtn: {
//       width: '100%',
//       padding: '10px 16px',
//       borderRadius: '12px',
//       border: '1.5px solid #e0d9ff',
//       backgroundColor: '#ffffff',
//       color: '#5b4fcf',
//       cursor: 'pointer',
//       fontSize: '13px',
//       fontWeight: 600,
//       fontFamily: 'inherit',
//       display: 'flex',
//       alignItems: 'center',
//       gap: '8px',
//       textAlign: 'left' as const,
//       transition: 'all 0.15s',
//     },
//     inputArea: {
//       padding: '10px 12px',
//       borderTop: '1px solid #f0f0f5',
//       display: 'flex',
//       gap: '8px',
//       alignItems: 'center',
//       backgroundColor: '#ffffff',
//       flexShrink: 0,
//     },
//     input: {
//       flex: 1,
//       padding: '10px 14px',
//       borderRadius: '22px',
//       border: '1.5px solid #e5e7eb',
//       fontSize: '14px',
//       outline: 'none',
//       fontFamily: 'inherit',
//       backgroundColor: '#f9fafb',
//       color: '#111827',
//       transition: 'border-color 0.2s',
//     },
//     sendBtn: {
//       width: '40px',
//       height: '40px',
//       borderRadius: '50%',
//       border: 'none',
//       cursor: 'pointer',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       flexShrink: 0,
//       transition: 'all 0.15s',
//     },
//     centeredBox: {
//       flex: 1,
//       display: 'flex',
//       flexDirection: 'column' as const,
//       alignItems: 'center',
//       justifyContent: 'center',
//       gap: '16px',
//       padding: '32px',
//       backgroundColor: '#fafafa',
//       textAlign: 'center' as const,
//     },
//   };
// }

// // ==========================================
// // Icons
// // ==========================================

// const ChatIcon = () => (
//   <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
//     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" opacity="0.95" />
//     <circle cx="8"  cy="10" r="1" fill="rgba(255,255,255,0.5)" />
//     <circle cx="12" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
//     <circle cx="16" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
//   </svg>
// );

// const CloseIcon = () => (
//   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
//     <line x1="18" y1="6" x2="6" y2="18" />
//     <line x1="6" y1="6" x2="18" y2="18" />
//   </svg>
// );

// const SendIcon = ({ active }: { active: boolean }) => (
//   <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//     <path d="M22 2L11 13" stroke={active ? 'white' : '#9ca3af'} strokeWidth="2.5" strokeLinecap="round" />
//     <path d="M22 2L15 22L11 13L2 9L22 2Z" fill={active ? 'white' : '#9ca3af'} />
//   </svg>
// );

// // ==========================================
// // Sub-components
// // ==========================================

// function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }) {
//   return (
//     <div style={styles.typingWrap}>
//       {[0, 0.2, 0.4].map((d, i) => (
//         <div key={i} style={{
//           ...styles.typingDot,
//           animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out`,
//         }} />
//       ))}
//     </div>
//   );
// }

// function MessageBubble({ message, styles, userName }: {
//   message: ChatMessage;
//   styles: Record<string, React.CSSProperties>;
//   userName?: string;
// }) {
//   const isCustomer = message.senderType === 'CUSTOMER';
//   const isSystem   = message.senderType === 'SYSTEM';
//   const isBot      = message.senderType === 'BOT';
//   const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

//   if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

//   const label = isCustomer ? null : isBot ? 'AI Assistant' : (message.senderName || 'Agent');

//   return (
//     <div style={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-end' : 'flex-start' }}>
//       {label && <div style={styles.senderLabel}>{label}</div>}
//       <div style={isCustomer ? styles.bubbleCustomer : styles.bubbleAgent}>
//         {message.content}
//         <div style={{ ...styles.timestamp, textAlign: isCustomer ? 'right' : 'left' }}>{time}</div>
//       </div>
//     </div>
//   );
// }

// function QuickReplies({ replies, onSelect, styles, primaryColor }: {
//   replies: QuickReply[];
//   onSelect: (r: QuickReply) => void;
//   styles: Record<string, React.CSSProperties>;
//   primaryColor: string;
// }) {
//   return (
//     <div style={styles.quickRepliesWrap}>
//       <div style={styles.quickRepliesLabel}>Choose an option</div>
//       {replies.map(r => (
//         <button
//           key={r.id}
//           style={styles.quickReplyBtn}
//           onClick={() => onSelect(r)}
//           onMouseEnter={e => {
//             (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe';
//             (e.currentTarget as HTMLElement).style.borderColor = primaryColor;
//           }}
//           onMouseLeave={e => {
//             (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff';
//             (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff';
//           }}
//         >
//           <span style={{ fontSize: 16 }}>{r.icon}</span>
//           <span>{r.label}</span>
//         </button>
//       ))}
//     </div>
//   );
// }

// function EscalatingScreen({ styles, primaryColor }: { styles: Record<string, React.CSSProperties>; primaryColor: string }) {
//   return (
//     <div style={styles.centeredBox}>
//       <div style={{ fontSize: 52 }}>👤</div>
//       <div>
//         <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 8 }}>
//           Connecting you to an agent
//         </div>
//         <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>
//           You've been added to the support queue.<br />
//           An agent will join shortly.
//         </div>
//       </div>
//       <div style={{ display: 'flex', gap: 8 }}>
//         {[0, 0.2, 0.4].map((d, i) => (
//           <div key={i} style={{
//             width: 9, height: 9, borderRadius: '50%', backgroundColor: primaryColor,
//             animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out`,
//           }} />
//         ))}
//       </div>
//       <div style={{
//         padding: '8px 20px', borderRadius: 20,
//         backgroundColor: '#ede9fe', color: primaryColor,
//         fontSize: 12, fontWeight: 700,
//       }}>
//         Est. wait: &lt; 2 min
//       </div>
//     </div>
//   );
// }



// export function ChatContent({ onClose, styles, config, theme }: {
//   onClose: () => void;
//   styles: Record<string, React.CSSProperties>;
//   config: ChatSDKConfig;
//   theme: FullTheme;
// }): JSX.Element {
//   const { state, actions } = useChat();
//   const [inputValue, setInputValue]           = useState('');
//   const [flowStep, setFlowStep]               = useState<FlowStep>('welcome');
//   const [localMessages, setLocalMessages]     = useState<ChatMessage[]>([]);
//   const [showTyping, setShowTyping]           = useState(false);       // local bot typing
//   const [showQuickReplies, setShowQuickReplies] = useState(false);
//   const messagesEndRef    = useRef<HTMLDivElement>(null);
//   const inputRef          = useRef<HTMLInputElement>(null);
//   const typingTimeoutRef  = useRef<ReturnType<typeof setTimeout>>();
//   const hasWelcomed       = useRef(false);
//   const prevServerMsgCount = useRef(0);

//   // Inject keyframes CSS once
//   useEffect(() => {
//     const id = 'chat-sdk-kf';
//     if (!document.getElementById(id)) {
//       const s = document.createElement('style');
//       s.id = id;
//       s.textContent = `
//         @keyframes chatTypingBounce {
//           0%,80%,100% { transform:translateY(0); opacity:0.4; }
//           40% { transform:translateY(-5px); opacity:1; }
//         }
//         @keyframes chatFadeIn {
//           from { opacity:0; transform:translateY(5px); }
//           to   { opacity:1; transform:translateY(0); }
//         }
//       `;
//       document.head.appendChild(s);
//     }
//   }, []);

//   const addLocal = useCallback((
//     msg: Omit<ChatMessage, 'id' | 'timestamp' | 'chatSessionId' | 'messageType'> &
//          { id?: string; chatSessionId?: string; messageType?: ChatMessage['messageType'] }
//   ) => {
//     const full: ChatMessage = {
//       id: msg.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
//       timestamp: new Date(),
//       chatSessionId: msg.chatSessionId || state.session?.id || 'local',
//       messageType: msg.messageType || 'TEXT',
//       ...msg,
//     };
//     setLocalMessages(prev => [...prev, full]);
//   }, [state.session?.id]);

//   const botReply = useCallback((content: string, delay = 800) => {
//     setShowTyping(true);
//     return new Promise<void>(resolve => {
//       setTimeout(() => {
//         setShowTyping(false);
//         addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
//         resolve();
//       }, delay);
//     });
//   }, [addLocal]);

//   // ── Welcome flow — only for genuinely new sessions ──────────────────────────
//   useEffect(() => {
//     if (!state.connected || hasWelcomed.current) return;
//     hasWelcomed.current = true;

//     // If server already has messages, this is an existing session — go straight to free
//     if (state.messages.length > 0) {
//       setFlowStep('free');
//       setShowQuickReplies(false);
//       return;
//     }

//     const run = async () => {
//       await botReply('👋 Hello! Welcome to Support. How can I help you today?', 700);
//       setFlowStep('menu');
//       setShowQuickReplies(true);
//     };
//     setTimeout(run, 300);
//   }, [state.connected, state.messages.length, botReply]);

//   // Focus input in free mode
//   useEffect(() => {
//     if (flowStep === 'free') inputRef.current?.focus();
//   }, [flowStep]);

//   // ── Auto-switch to free mode when agent message arrives ─────────────────────
//   useEffect(() => {
//     const newCount = state.messages.length;
//     if (newCount > prevServerMsgCount.current) {
//       const newMsgs = state.messages.slice(prevServerMsgCount.current);
//       if (newMsgs.some(m => m.senderType === 'AGENT') && flowStep !== 'free') {
//         setFlowStep('free');
//         setShowQuickReplies(false);
//       }
//     }
//     prevServerMsgCount.current = newCount;
//   }, [state.messages, flowStep]);

//   // ── FIXED allMessages merge ─────────────────────────────────────────────────
//   // Server messages are ground truth. Local messages fill gaps only.
//   const allMessages = React.useMemo(() => {
//     const seen = new Set<string>();
//     const result: ChatMessage[] = [];

//     // Server messages first — these include all confirmed customer, agent, bot msgs
//     for (const msg of state.messages) {
//       seen.add(msg.id);
//       result.push(msg);
//     }

//     // Local-only messages: bot replies and unconfirmed optimistic customer sends
//     for (const msg of localMessages) {
//       if (seen.has(msg.id)) continue;

//       if (msg.id.startsWith('temp-')) {
//         // Show optimistic send only until server confirms it (matched by content)
//         const confirmed = state.messages.some(
//           m => m.senderType === 'CUSTOMER' && m.content === msg.content
//         );
//         if (!confirmed) {
//           seen.add(msg.id);
//           result.push(msg);
//         }
//       } else {
//         // Local bot/system message — always show (they never come from server)
//         seen.add(msg.id);
//         result.push(msg);
//       }
//     }

//     return result.sort(
//       (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
//     );
//   }, [state.messages, localMessages]);

//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [allMessages.length, showTyping, state.isTyping]);

//   // ── Quick reply handler ─────────────────────────────────────────────────────
//   const handleQuickReply = useCallback(async (reply: QuickReply) => {
//     setShowQuickReplies(false);
//     addLocal({
//       senderType: 'CUSTOMER', senderId: config.user.id,
//       senderName: config.user.name, content: reply.label,
//     });

//     switch (reply.id) {
//       case 'order_details':
//         await botReply("Sure! Let me pull up your recent orders.", 800);
//         await botReply(
//           "📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch",
//           1400,
//         );
//         await botReply("Is there anything else I can help you with?", 900);
//         setFlowStep('menu');
//         setShowQuickReplies(true);
//         break;

//       case 'track_order':
//         await botReply("🔍 Fetching tracking info for your latest order...", 800);
//         await botReply(
//           "📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18",
//           1600,
//         );
//         await botReply("Need anything else?", 800);
//         setFlowStep('menu');
//         setShowQuickReplies(true);
//         break;

//       case 'faq':
//         await botReply("📚 Here are answers to common questions:", 800);
//         await botReply(
//           "🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)",
//           1500,
//         );
//         await botReply("Still need help?", 700);
//         setFlowStep('menu');
//         setShowQuickReplies(true);
//         break;

//       case 'human':
//         setFlowStep('escalating');
//         await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
//         try {
//           if (state.session?.id) actions.requestAgent?.('Customer requested human agent');
//         } catch (e) {
//           console.error('Escalation error', e);
//         }
//         setTimeout(() => {
//           addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '🟢 You are now in the agent queue' });
//           setFlowStep('free');
//         }, 3000);
//         break;
//     }
//   }, [addLocal, botReply, actions, config.user, state.session?.id]);

//   // ── Send free-form message ──────────────────────────────────────────────────
//   const handleSend = useCallback(() => {
//     const content = inputValue.trim();
//     if (!content || !state.connected) return;
//     actions.sendMessage(content);
//     setInputValue('');
//     actions.stopTyping?.();
//     if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
//   }, [inputValue, actions, state.connected, flowStep]);

//   const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
//     if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
//   }, [handleSend]);

//   const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
//     setInputValue(e.target.value);
//     actions.startTyping?.();
//     if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
//     typingTimeoutRef.current = setTimeout(() => actions.stopTyping?.(), 2000);
//   }, [actions]);

//   const subtitle = (() => {
//     if (state.loading) return 'Connecting...';
//     if (flowStep === 'escalating') return 'Connecting to agent...';
//     if (state.session?.assignedAgentName) return `Chatting with ${state.session.assignedAgentName}`;
//     if (state.session?.mode === 'HUMAN') return 'Connected to agent';
//     return 'AI Support · Online';
//   })();

//   const isClosed = state.session?.status === 'CLOSED';
//   const canType  = !isClosed && state.connected && flowStep !== 'escalating';
//   const isActive = !!inputValue.trim() && canType;

//   // ── Render skeletons ────────────────────────────────────────────────────────

//   if (state.loading) {
//     return (
//       <div style={styles.widget}>
//         <WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme} />
//         <div style={styles.centeredBox}>
//           <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
//             <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
//             <path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round">
//               <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
//             </path>
//           </svg>
//           <span style={{ fontSize: 13, color: '#9ca3af' }}>Starting chat...</span>
//         </div>
//       </div>
//     );
//   }

//   if (state.error && !state.connected) {
//     return (
//       <div style={styles.widget}>
//         <WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme} />
//         <div style={styles.centeredBox}>
//           <div style={{ fontSize: 40 }}>⚠️</div>
//           <div>
//             <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Connection Lost</div>
//             <div style={{ fontSize: 13, color: '#6b7280' }}>{state.error.message}</div>
//           </div>
//           <button onClick={() => actions.reconnect?.()}
//             style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
//             Retry
//           </button>
//         </div>
//       </div>
//     );
//   }

//   // ── Main render ─────────────────────────────────────────────────────────────
//   return (
//     <div style={styles.widget}>
//       <WidgetHeader onClose={onClose} styles={styles} subtitle={subtitle} theme={theme} />

//       {flowStep === 'escalating' ? (
//         <EscalatingScreen styles={styles} primaryColor={theme.primaryColor} />
//       ) : (
//         <>
//           <div style={styles.messages}>
//             {allMessages.map(msg => (
//               <div key={msg.id} style={{ animation: 'chatFadeIn 0.2s ease' }}>
//                 <MessageBubble message={msg} styles={styles} userName={config.user.name} />
//               </div>
//             ))}

//             {/* Show typing: local bot typing OR agent typing from WS */}
//             {(showTyping || state.isTyping) && <TypingIndicator styles={styles} />}
//             <div ref={messagesEndRef} />
//           </div>

//           {showQuickReplies && flowStep === 'menu' && (
//             <QuickReplies
//               replies={MAIN_MENU}
//               onSelect={handleQuickReply}
//               styles={styles}
//               primaryColor={theme.primaryColor}
//             />
//           )}

//           {isClosed ? (
//             <div style={{ padding: '14px', textAlign: 'center', fontSize: 13, color: '#9ca3af', borderTop: '1px solid #f0f0f5' }}>
//               This chat has ended.
//             </div>
//           ) : (
//             <div style={styles.inputArea}>
//               <input
//                 ref={inputRef}
//                 type="text"
//                 placeholder={canType ? 'Type a message...' : 'Connecting...'}
//                 value={inputValue}
//                 onChange={handleInputChange}
//                 onKeyDown={handleKeyDown}
//                 disabled={!canType}
//                 style={{
//                   ...styles.input,
//                   borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb',
//                   opacity: canType ? 1 : 0.6,
//                 }}
//               />
//               <button
//                 onClick={handleSend}
//                 disabled={!isActive}
//                 style={{
//                   ...styles.sendBtn,
//                   background: isActive
//                     ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)`
//                     : '#f3f4f6',
//                   boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none',
//                   cursor: isActive ? 'pointer' : 'not-allowed',
//                 }}
//               >
//                 <SendIcon active={!!isActive} />
//               </button>
//             </div>
//           )}
//         </>
//       )}
//     </div>
//   );
// }

// // ==========================================
// // Header
// // ==========================================

// function WidgetHeader({ onClose, styles, subtitle, theme }: {
//   onClose: () => void;
//   styles: Record<string, React.CSSProperties>;
//   subtitle: string;
//   theme: FullTheme;
// }) {
//   return (
//     <div style={styles.header}>
//       <div style={styles.headerAvatar}>💬</div>
//       <div style={styles.headerInfo}>
//         <h3 style={styles.headerTitle}>Chat Support</h3>
//         <div style={styles.headerSub}>
//           <span style={styles.onlineDot} />
//           {subtitle}
//         </div>
//       </div>
//       <button style={styles.closeBtn} onClick={onClose}>
//         <CloseIcon />
//       </button>
//     </div>
//   );
// }

// // ==========================================
// // ChatWidget
// // ==========================================

// export interface ChatWidgetProps {
//   config: ChatSDKConfig;
//   defaultOpen?: boolean;
// }

// export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
//   const [isOpen, setIsOpen] = useState(defaultOpen);
//   const [launchHover, setLaunchHover] = useState(false);
//   const theme: FullTheme = { ...defaultTheme, ...config.theme };
//   const styles = getStyles(config.theme);

//   return (
//     <div style={styles.container}>
//       {!isOpen && (
//         <button
//           style={{
//             ...styles.launcher,
//             transform: launchHover ? 'scale(1.1)' : 'scale(1)',
//             boxShadow: launchHover
//               ? `0 6px 28px ${theme.primaryColor}77`
//               : `0 4px 20px ${theme.primaryColor}44`,
//           }}
//           onClick={() => setIsOpen(true)}
//           onMouseEnter={() => setLaunchHover(true)}
//           onMouseLeave={() => setLaunchHover(false)}
//           aria-label="Open chat support"
//         >
//           <ChatIcon />
//         </button>
//       )}

//       {/* ChatProvider ALWAYS mounted — WebSocket connects on load, never disconnects on close */}
//       <ChatProvider config={config}>
//         <div style={{ display: isOpen ? 'block' : 'none' }}>
//           <ChatContent
//             onClose={() => setIsOpen(false)}
//             styles={styles}
//             config={config}
//             theme={theme}
//           />
//         </div>
//       </ChatProvider>
//     </div>
//   );
// }

// export default ChatWidget;






// ==========================================
// Chat SDK - Chat Widget Component — FULLY FIXED
//
// FIXES IN THIS VERSION:
//
// FIX 1 [QUICK REPLIES NEVER SHOW]:
//   addLocal() depended on state.session?.id → new ref when session arrives
//   → botReply got new ref → welcome useEffect re-ran → hasWelcomed=true → skipped
//   FIX: addLocal reads session via stateRef (stable ref), zero deps, never re-creates.
//   botReply stored in botReplyRef so welcome effect has ONLY [state.connected] as dep.
//
// FIX 2 [REOPEN / REFRESH SHOWS MENU AGAIN WHEN ALREADY WITH AGENT]:
//   On refresh, fetchMessages is async. Welcome effect ran before messages loaded.
//   state.messages.length was 0 → showed welcome + menu even mid-agent-conversation.
//   FIX: Check session status (ASSIGNED/WAITING/HUMAN) from CONNECTION_ACK first.
//   Also wait for state.loading=false before deciding (messages are fetched before INIT_SUCCESS).
//
// FIX 3 [HUMAN ESCALATION SILENT FAIL]:
//   state.session?.id guard silently aborted for fresh users.
//   FIX: waitForSession() polls until session.id ready (max 8s).
//   escalateToAgent() calls REST first to persist DB status, then WS.
// ==========================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// ==========================================
// Flow Types
// ==========================================

type FlowStep =
  | 'welcome'
  | 'menu'
  | 'escalating'
  | 'free';

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

type FullTheme = {
  primaryColor: string; headerBackground: string; headerText: string;
  customerBubbleColor: string; agentBubbleColor: string; fontFamily: string;
  borderRadius: string; position: 'bottom-right' | 'bottom-left';
};

function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
  const t: FullTheme = { ...defaultTheme, ...theme };
  const isRight = (t.position as string) !== 'bottom-left';
  return {
    container: { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
    launcher: { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
    widget: { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
    header: { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
    headerAvatar: { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
    headerInfo: { flex: 1 },
    headerTitle: { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
    headerSub: { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
    onlineDot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
    closeBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    messages: { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
    bubbleCustomer: { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
    bubbleAgent: { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
    bubbleSystem: { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
    senderLabel: { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
    timestamp: { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
    typingWrap: { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
    typingDot: { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
    quickRepliesWrap: { padding: '10px 14px 12px', display: 'flex', flexDirection: 'column' as const, gap: '8px', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f0', flexShrink: 0 },
    quickRepliesLabel: { fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
    quickReplyBtn: { width: '100%', padding: '10px 16px', borderRadius: '12px', border: '1.5px solid #e0d9ff', backgroundColor: '#ffffff', color: '#5b4fcf', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' as const, transition: 'all 0.15s' },
    inputArea: { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0 },
    input: { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
    sendBtn: { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
    centeredBox: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
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
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
        <div key={i} style={{ ...styles.typingDot, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

function MessageBubble({ message, styles }: { message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string }) {
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
  replies: QuickReply[]; onSelect: (r: QuickReply) => void;
  styles: Record<string, React.CSSProperties>; primaryColor: string;
}) {
  return (
    <div style={styles.quickRepliesWrap}>
      <div style={styles.quickRepliesLabel}>Choose an option</div>
      {replies.map(r => (
        <button key={r.id} style={styles.quickReplyBtn} onClick={() => onSelect(r)}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor = primaryColor; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff'; }}
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
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 8 }}>Connecting you to an agent</div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>You've been added to the support queue.<br />An agent will join shortly.</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 0.2, 0.4].map((d, i) => (
          <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: primaryColor, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
        ))}
      </div>
      <div style={{ padding: '8px 20px', borderRadius: 20, backgroundColor: '#ede9fe', color: primaryColor, fontSize: 12, fontWeight: 700 }}>
        Est. wait: &lt; 2 min
      </div>
    </div>
  );
}

function WidgetHeader({ onClose, styles, subtitle, theme }: {
  onClose: () => void; styles: Record<string, React.CSSProperties>; subtitle: string; theme: FullTheme;
}) {
  return (
    <div style={styles.header}>
      <div style={styles.headerAvatar}>💬</div>
      <div style={styles.headerInfo}>
        <h3 style={styles.headerTitle}>Chat Support</h3>
        <div style={styles.headerSub}><span style={styles.onlineDot} />{subtitle}</div>
      </div>
      <button style={styles.closeBtn} onClick={onClose}><CloseIcon /></button>
    </div>
  );
}

// ==========================================
// ChatContent — main logic
// ==========================================

export function ChatContent({ onClose, styles, config, theme, onStartNewChat }: {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  config: ChatSDKConfig;
  theme: FullTheme;
  onStartNewChat?: () => void;
}): JSX.Element {
  const { state, actions } = useChat();

  const [inputValue, setInputValue]             = useState('');
  const [flowStep, setFlowStep]                 = useState<FlowStep>('welcome');
  const [localMessages, setLocalMessages]       = useState<ChatMessage[]>([]);
  const [showTyping, setShowTyping]             = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [escalationError, setEscalationError]   = useState<string | null>(null);

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasWelcomed      = useRef(false);
  const prevMsgCount     = useRef(0);

  // ── Stable refs so callbacks never change identity ────────────────────────
  const stateRef    = useRef(state);
  const actionsRef  = useRef(actions);
  const configRef   = useRef(config);
  const botReplyRef = useRef<(content: string, delay?: number) => Promise<void>>();

  useEffect(() => { stateRef.current   = state;   }, [state]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { configRef.current  = config;  }, [config]);

  // Inject keyframes once
  useEffect(() => {
    const id = 'chat-sdk-kf';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      @keyframes chatTypingBounce {
        0%,80%,100%{transform:translateY(0);opacity:.4}
        40%{transform:translateY(-5px);opacity:1}
      }
      @keyframes chatFadeIn {
        from{opacity:0;transform:translateY(5px)}
        to{opacity:1;transform:translateY(0)}
      }
    `;
    document.head.appendChild(s);
  }, []);

  // ── addLocal: ZERO deps — reads session via stateRef, never re-creates ────
  // This is the root fix. Previously depended on state.session?.id which
  // caused botReply → welcome effect chain to break.
  const addLocal = useCallback((
    msg: Omit<ChatMessage, 'id' | 'timestamp' | 'chatSessionId' | 'messageType'> &
         { id?: string; chatSessionId?: string; messageType?: ChatMessage['messageType'] }
  ) => {
    const full: ChatMessage = {
      id:            msg.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp:     new Date(),
      chatSessionId: msg.chatSessionId || stateRef.current.session?.id || 'local',
      messageType:   msg.messageType || 'TEXT',
      ...msg,
    };
    setLocalMessages(prev => [...prev, full]);
  }, []); // ← zero deps: stable forever

  // ── botReply: stable, also kept in ref ───────────────────────────────────
  const botReply = useCallback((content: string, delay = 800): Promise<void> => {
    setShowTyping(true);
    return new Promise(resolve => {
      setTimeout(() => {
        setShowTyping(false);
        addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
        resolve();
      }, delay);
    });
  }, [addLocal]); // addLocal is stable so botReply is also stable

  useEffect(() => { botReplyRef.current = botReply; }, [botReply]);

  // ── FIXED Welcome effect: only depends on state.connected + state.loading ─
  //
  // state.loading becomes false AFTER fetchMessages completes (messages are
  // already in state when INIT_SUCCESS fires). So by the time this runs,
  // state.messages is populated and session.status is known.
  //
  // Decision tree:
  //   1. Session is ASSIGNED / HUMAN → already with agent → skip to free chat
  //   2. Session is WAITING_FOR_AGENT → in queue → skip to free chat
  //   3. Session has existing messages → returning user → skip to free chat
  //   4. Fresh session → show welcome + menu
  useEffect(() => {
    // Wait until fully connected AND messages loaded
    if (!state.connected || state.loading) return;

    // Only run once
    if (hasWelcomed.current) return;
    hasWelcomed.current = true;

    const sess = stateRef.current.session;
    const msgs = stateRef.current.messages;

    console.log('%c[Chat:WELCOME] Deciding flow...', 'color:#8b5cf6;font-weight:bold', {
      sessionId: sess?.id,
      status:    sess?.status,
      mode:      sess?.mode,
      agentName: sess?.assignedAgentName,
      msgCount:  msgs.length,
      msgs:      msgs.map(m => `[${m.senderType}] ${m.content.slice(0, 40)}`),
    });

    // 1. Already with a human agent — skip bot flow entirely
    if (
      sess?.status === 'ASSIGNED' ||
      sess?.status === 'WAITING_FOR_AGENT' ||
      sess?.mode === 'HUMAN'
    ) {
      console.log('%c[Chat:WELCOME] Human session active, going to free chat. Status:', 'color:#10b981;font-weight:bold', sess?.status);
      setFlowStep('free');
      return;
    }

    // 2. Count messages by sender type
    const customerMsgCount = msgs.filter(m => m.senderType === 'CUSTOMER').length;
    const agentMsgCount    = msgs.filter(m => m.senderType === 'AGENT').length;
    const botMsgCount      = msgs.filter(m => m.senderType === 'BOT').length;

    // Real conversation = customer or agent has sent at least one message.
    // A lone BOT message (our own saved welcome greeting) does NOT count.
    const hasRealHistory = customerMsgCount > 0 || agentMsgCount > 0;

    console.log('%c[Chat:WELCOME] Message breakdown:', 'color:#8b5cf6;font-weight:bold', {
      customer: customerMsgCount,
      agent:    agentMsgCount,
      bot:      botMsgCount,
      hasRealHistory,
    });

    if (hasRealHistory) {
      console.log('%c[Chat:WELCOME] Real history found, going to free chat', 'color:#10b981;font-weight:bold');
      setFlowStep('free');
      return;
    }

    // 3. No real history (0 msgs OR only bot welcome messages from a previous visit)
    //    Show fresh welcome + quick reply menu
    console.log('%c[Chat:WELCOME] No real history — showing welcome menu', 'color:#f59e0b;font-weight:bold');
    const run = async () => {
      await botReplyRef.current!('👋 Hello! Welcome to Support. How can I help you today?', 700);
      setFlowStep('menu');
      setShowQuickReplies(true);
    };
    setTimeout(run, 300);

  }, [state.connected, state.loading]); // ← ONLY these two. No botReply, no messages.

  // Auto-focus input in free mode
  useEffect(() => {
    if (flowStep === 'free') inputRef.current?.focus();
  }, [flowStep]);

  // Auto-switch to free when agent joins mid-flow
  useEffect(() => {
    const newCount = state.messages.length;
    if (newCount > prevMsgCount.current) {
      const newMsgs = state.messages.slice(prevMsgCount.current);
      if (newMsgs.some(m => m.senderType === 'AGENT') && flowStep !== 'free') {
        setFlowStep('free');
        setShowQuickReplies(false);
      }
    }
    prevMsgCount.current = newCount;
  }, [state.messages, flowStep]);

  // ── waitForSession: polls until session.id is ready (max 8s) ─────────────
  const waitForSession = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
      const max = 8000; const step = 200; let elapsed = 0;
      const t = setInterval(() => {
        elapsed += step;
        const id = stateRef.current.session?.id;
        if (id) { clearInterval(t); resolve(id); }
        else if (elapsed >= max) { clearInterval(t); reject(new Error('Session not ready — please try again')); }
      }, step);
    });
  }, []);

  // ── escalateToAgent: REST first (persists to DB) then WS (real-time ping) ─
  const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${sessionId}/escalate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'X-App-ID': cfg.appId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
    } catch (e) {
      console.warn('[Chat] REST escalation failed, using WS only:', e);
    }
    actionsRef.current.requestAgent?.(reason);
  }, []);

  // ── allMessages merge ─────────────────────────────────────────────────────
  const allMessages = React.useMemo(() => {
    const seen = new Set<string>();
    const result: ChatMessage[] = [];
    for (const m of state.messages) { seen.add(m.id); result.push(m); }
    for (const m of localMessages) {
      if (seen.has(m.id)) continue;
      if (m.id.startsWith('temp-')) {
        if (!state.messages.some(s => s.senderType === 'CUSTOMER' && s.content === m.content)) {
          seen.add(m.id); result.push(m);
        }
      } else { seen.add(m.id); result.push(m); }
    }
    return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [state.messages, localMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length, showTyping, state.isTyping]);

  // ── Quick reply handler ───────────────────────────────────────────────────
  const handleQuickReply = useCallback(async (reply: QuickReply) => {
    setShowQuickReplies(false);
    setEscalationError(null);

    addLocal({
      senderType: 'CUSTOMER',
      senderId: configRef.current.user.id,
      senderName: configRef.current.user.name,
      content: reply.label,
    });

    switch (reply.id) {
      case 'order_details':
        await botReply("Sure! Let me pull up your recent orders.", 800);
        await botReply("📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch", 1400);
        await botReply("Is there anything else I can help you with?", 900);
        setFlowStep('menu'); setShowQuickReplies(true);
        break;

      case 'track_order':
        await botReply("🔍 Fetching tracking info for your latest order...", 800);
        await botReply("📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18", 1600);
        await botReply("Need anything else?", 800);
        setFlowStep('menu'); setShowQuickReplies(true);
        break;

      case 'faq':
        await botReply("📚 Here are answers to common questions:", 800);
        await botReply("🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)", 1500);
        await botReply("Still need help?", 700);
        setFlowStep('menu'); setShowQuickReplies(true);
        break;

      case 'human': {
        setFlowStep('escalating');
        await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
        try {
          const sessionId = await waitForSession();
          await escalateToAgent(sessionId, 'Customer requested human agent');
          addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '🟢 You are now in the agent queue. An agent will join shortly.' });
          setFlowStep('free');
        } catch (err: any) {
          const msg = err?.message ?? 'Could not connect. Please try again.';
          setEscalationError(msg);
          addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '⚠️ Could not connect to an agent. Please try again.' });
          setFlowStep('menu');
          setTimeout(() => setShowQuickReplies(true), 500);
        }
        break;
      }
    }
  }, [addLocal, botReply, waitForSession, escalateToAgent]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !stateRef.current.connected) return;
    actionsRef.current.sendMessage(content);
    setInputValue('');
    actionsRef.current.stopTyping?.();
    if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
  }, [inputValue, flowStep]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    actionsRef.current.startTyping?.();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => actionsRef.current.stopTyping?.(), 2000);
  }, []);

  const subtitle = (() => {
    if (state.loading) return 'Connecting...';
    if (flowStep === 'escalating') return 'Connecting to agent...';
    if (state.session?.assignedAgentName) return `Chatting with ${state.session.assignedAgentName}`;
    if (state.session?.mode === 'HUMAN') return 'Connected to agent';
    return 'AI Support · Online';
  })();

  const isClosed = state.session?.status === 'CLOSED';
  const canType  = !isClosed && state.connected && flowStep !== 'escalating';
  const isActive = !!inputValue.trim() && canType;

  // ── Loading ───────────────────────────────────────────────────────────────
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

  // ── Error ─────────────────────────────────────────────────────────────────
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
          <button onClick={() => actionsRef.current.reconnect?.()} style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
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

          {escalationError && (
            <div style={{ margin: '8px 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{escalationError}</span>
              <button onClick={() => setEscalationError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          )}

          {showQuickReplies && flowStep === 'menu' && (
            <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} styles={styles} primaryColor={theme.primaryColor} />
          )}

          {isClosed ? (
            <div style={{ padding: '16px 14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#fafafa' }}>
              <div style={{ fontSize: 28 }}>✅</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat Ended</div>
                <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This session has been closed.<br />Need more help?</div>
              </div>
              {onStartNewChat && (
                <button
                  onClick={onStartNewChat}
                  style={{ padding: '10px 24px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)`, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', boxShadow: `0 3px 12px ${theme.primaryColor}44`, letterSpacing: '-0.01em' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 5px 18px ${theme.primaryColor}66`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 3px 12px ${theme.primaryColor}44`; }}
                >
                  + Start New Chat
                </button>
              )}
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
                style={{ ...styles.input, borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb', opacity: canType ? 1 : 0.6 }}
              />
              <button onClick={handleSend} disabled={!isActive} style={{ ...styles.sendBtn, background: isActive ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)` : '#f3f4f6', boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none', cursor: isActive ? 'pointer' : 'not-allowed' }}>
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
// ChatWidget — public entry point
// ==========================================

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen]         = useState(defaultOpen);
  const [launchHover, setLaunchHover] = useState(false);
  const [chatKey, setChatKey]       = useState(0);
  const theme: FullTheme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);

  const handleStartNewChat = () => {
    // Increment key → unmounts ChatProvider → mounts fresh one → new WS session
    setChatKey(k => k + 1);
  };

  return (
    <div style={styles.container}>
      {!isOpen && (
        <button
          style={{ ...styles.launcher, transform: launchHover ? 'scale(1.1)' : 'scale(1)', boxShadow: launchHover ? `0 6px 28px ${theme.primaryColor}77` : `0 4px 20px ${theme.primaryColor}44` }}
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setLaunchHover(true)}
          onMouseLeave={() => setLaunchHover(false)}
          aria-label="Open chat support"
        >
          <ChatIcon />
        </button>
      )}

      {/* key={chatKey} forces a full remount → creates a fresh session on Start New Chat */}
      <ChatProvider config={config} key={chatKey}>
        <div style={{ display: isOpen ? 'block' : 'none' }}>
          <ChatContent onClose={() => setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} />
        </div>
      </ChatProvider>
    </div>
  );
}

export default ChatWidget;