
// // import React, { useState, useRef, useEffect, useCallback } from 'react';
// // import { ChatProvider, useChat } from './context';
// // import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';

// // // ==========================================
// // // Flow Types
// // // ==========================================

// // type FlowStep =
// //   | 'welcome'
// //   | 'menu'
// //   | 'escalating'
// //   | 'free';

// // interface QuickReply {
// //   id: string;
// //   label: string;
// //   icon: string;
// // }

// // const MAIN_MENU: QuickReply[] = [
// //   { id: 'order_details', icon: '📦', label: 'Check Order Details' },
// //   { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
// //   { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
// //   { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
// // ];

// // // ==========================================
// // // Theme
// // // ==========================================

// // const defaultTheme = {
// //   primaryColor: '#5b4fcf',
// //   headerBackground: '#5b4fcf',
// //   headerText: '#ffffff',
// //   customerBubbleColor: '#5b4fcf',
// //   agentBubbleColor: '#f0effe',
// //   fontFamily: '"Outfit", "DM Sans", system-ui, sans-serif',
// //   borderRadius: '16px',
// //   position: 'bottom-right' as 'bottom-right' | 'bottom-left',
// // };

// // type FullTheme = {
// //   primaryColor: string; headerBackground: string; headerText: string;
// //   customerBubbleColor: string; agentBubbleColor: string; fontFamily: string;
// //   borderRadius: string; position: 'bottom-right' | 'bottom-left';
// // };

// // function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
// //   const t: FullTheme = { ...defaultTheme, ...theme };
// //   const isRight = (t.position as string) !== 'bottom-left';
// //   return {
// //     container: { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
// //     launcher: { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
// //     widget: { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
// //     header: { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
// //     headerAvatar: { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
// //     headerInfo: { flex: 1 },
// //     headerTitle: { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
// //     headerSub: { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
// //     onlineDot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
// //     closeBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
// //     messages: { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
// //     bubbleCustomer: { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
// //     bubbleAgent: { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
// //     bubbleSystem: { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
// //     senderLabel: { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
// //     timestamp: { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
// //     typingWrap: { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
// //     typingDot: { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
// //     quickRepliesWrap: { padding: '10px 14px 12px', display: 'flex', flexDirection: 'column' as const, gap: '8px', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f0', flexShrink: 0 },
// //     quickRepliesLabel: { fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
// //     quickReplyBtn: { width: '100%', padding: '10px 16px', borderRadius: '12px', border: '1.5px solid #e0d9ff', backgroundColor: '#ffffff', color: '#5b4fcf', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' as const, transition: 'all 0.15s' },
// //     inputArea: { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0 },
// //     input: { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
// //     sendBtn: { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
// //     centeredBox: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
// //   };
// // }

// // // ==========================================
// // // Icons
// // // ==========================================

// // const ChatIcon = () => (
// //   <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
// //     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" opacity="0.95" />
// //     <circle cx="8"  cy="10" r="1" fill="rgba(255,255,255,0.5)" />
// //     <circle cx="12" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
// //     <circle cx="16" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
// //   </svg>
// // );

// // const CloseIcon = () => (
// //   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
// //     <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
// //   </svg>
// // );

// // const SendIcon = ({ active }: { active: boolean }) => (
// //   <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
// //     <path d="M22 2L11 13" stroke={active ? 'white' : '#9ca3af'} strokeWidth="2.5" strokeLinecap="round" />
// //     <path d="M22 2L15 22L11 13L2 9L22 2Z" fill={active ? 'white' : '#9ca3af'} />
// //   </svg>
// // );

// // // ==========================================
// // // Sub-components
// // // ==========================================

// // function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }) {
// //   return (
// //     <div style={styles.typingWrap}>
// //       {[0, 0.2, 0.4].map((d, i) => (
// //         <div key={i} style={{ ...styles.typingDot, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
// //       ))}
// //     </div>
// //   );
// // }

// // function MessageBubble({ message, styles }: { message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string }) {
// //   const isCustomer = message.senderType === 'CUSTOMER';
// //   const isSystem   = message.senderType === 'SYSTEM';
// //   const isBot      = message.senderType === 'BOT';
// //   const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// //   if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;
// //   const label = isCustomer ? null : isBot ? 'AI Assistant' : (message.senderName || 'Agent');
// //   return (
// //     <div style={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-end' : 'flex-start' }}>
// //       {label && <div style={styles.senderLabel}>{label}</div>}
// //       <div style={isCustomer ? styles.bubbleCustomer : styles.bubbleAgent}>
// //         {message.content}
// //         <div style={{ ...styles.timestamp, textAlign: isCustomer ? 'right' : 'left' }}>{time}</div>
// //       </div>
// //     </div>
// //   );
// // }

// // function QuickReplies({ replies, onSelect, styles, primaryColor }: {
// //   replies: QuickReply[]; onSelect: (r: QuickReply) => void;
// //   styles: Record<string, React.CSSProperties>; primaryColor: string;
// // }) {
// //   return (
// //     <div style={styles.quickRepliesWrap}>
// //       <div style={styles.quickRepliesLabel}>Choose an option</div>
// //       {replies.map(r => (
// //         <button key={r.id} style={styles.quickReplyBtn} onClick={() => onSelect(r)}
// //           onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor = primaryColor; }}
// //           onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff'; }}
// //         >
// //           <span style={{ fontSize: 16 }}>{r.icon}</span>
// //           <span>{r.label}</span>
// //         </button>
// //       ))}
// //     </div>
// //   );
// // }

// // function EscalatingScreen({ styles, primaryColor }: { styles: Record<string, React.CSSProperties>; primaryColor: string }) {
// //   return (
// //     <div style={styles.centeredBox}>
// //       <div style={{ fontSize: 52 }}>👤</div>
// //       <div>
// //         <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 8 }}>Connecting you to an agent</div>
// //         <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>You've been added to the support queue.<br />An agent will join shortly.</div>
// //       </div>
// //       <div style={{ display: 'flex', gap: 8 }}>
// //         {[0, 0.2, 0.4].map((d, i) => (
// //           <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: primaryColor, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
// //         ))}
// //       </div>
// //       <div style={{ padding: '8px 20px', borderRadius: 20, backgroundColor: '#ede9fe', color: primaryColor, fontSize: 12, fontWeight: 700 }}>
// //         Est. wait: &lt; 2 min
// //       </div>
// //     </div>
// //   );
// // }

// // function WidgetHeader({ onClose, styles, subtitle, theme }: {
// //   onClose: () => void; styles: Record<string, React.CSSProperties>; subtitle: string; theme: FullTheme;
// // }) {
// //   return (
// //     <div style={styles.header}>
// //       <div style={styles.headerAvatar}>💬</div>
// //       <div style={styles.headerInfo}>
// //         <h3 style={styles.headerTitle}>Chat Support</h3>
// //         <div style={styles.headerSub}><span style={styles.onlineDot} />{subtitle}</div>
// //       </div>
// //       <button style={styles.closeBtn} onClick={onClose}><CloseIcon /></button>
// //     </div>
// //   );
// // }

// // // ==========================================
// // // ChatContent — main logic
// // // ==========================================

// // export function ChatContent({ onClose, styles, config, theme, onStartNewChat }: {
// //   onClose: () => void;
// //   styles: Record<string, React.CSSProperties>;
// //   config: ChatSDKConfig;
// //   theme: FullTheme;
// //   onStartNewChat?: () => void;
// // }): JSX.Element {
// //   const { state, actions } = useChat();

// //   const [inputValue, setInputValue]             = useState('');
// //   const [flowStep, setFlowStep]                 = useState<FlowStep>('welcome');
// //   const [localMessages, setLocalMessages]       = useState<ChatMessage[]>([]);
// //   const [showTyping, setShowTyping]             = useState(false);
// //   const [showQuickReplies, setShowQuickReplies] = useState(false);
// //   const [escalationError, setEscalationError]   = useState<string | null>(null);

// //   const messagesEndRef   = useRef<HTMLDivElement>(null);
// //   const inputRef         = useRef<HTMLInputElement>(null);
// //   const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
// //   const hasWelcomed      = useRef(false);
// //   const prevMsgCount     = useRef(0);

// //   // ── Stable refs so callbacks never change identity ────────────────────────
// //   const stateRef    = useRef(state);
// //   const actionsRef  = useRef(actions);
// //   const configRef   = useRef(config);
// //   const botReplyRef = useRef<(content: string, delay?: number) => Promise<void>>();

// //   useEffect(() => { stateRef.current   = state;   }, [state]);
// //   useEffect(() => { actionsRef.current = actions; }, [actions]);
// //   useEffect(() => { configRef.current  = config;  }, [config]);

// //   // Inject keyframes once
// //   useEffect(() => {
// //     const id = 'chat-sdk-kf';
// //     if (document.getElementById(id)) return;
// //     const s = document.createElement('style');
// //     s.id = id;
// //     s.textContent = `
// //       @keyframes chatTypingBounce {
// //         0%,80%,100%{transform:translateY(0);opacity:.4}
// //         40%{transform:translateY(-5px);opacity:1}
// //       }
// //       @keyframes chatFadeIn {
// //         from{opacity:0;transform:translateY(5px)}
// //         to{opacity:1;transform:translateY(0)}
// //       }
// //     `;
// //     document.head.appendChild(s);
// //   }, []);

// //   // ── addLocal: ZERO deps — reads session via stateRef, never re-creates ────
// //   // This is the root fix. Previously depended on state.session?.id which
// //   // caused botReply → welcome effect chain to break.
// //   const addLocal = useCallback((
// //     msg: Omit<ChatMessage, 'id' | 'timestamp' | 'chatSessionId' | 'messageType'> &
// //          { id?: string; chatSessionId?: string; messageType?: ChatMessage['messageType'] }
// //   ) => {
// //     const full: ChatMessage = {
// //       id:            msg.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
// //       timestamp:     new Date(),
// //       chatSessionId: msg.chatSessionId || stateRef.current.session?.id || 'local',
// //       messageType:   msg.messageType || 'TEXT',
// //       ...msg,
// //     };
// //     setLocalMessages(prev => [...prev, full]);
// //   }, []); // ← zero deps: stable forever

// //   // ── botReply: stable, also kept in ref ───────────────────────────────────
// //   const botReply = useCallback((content: string, delay = 800): Promise<void> => {
// //     setShowTyping(true);
// //     return new Promise(resolve => {
// //       setTimeout(() => {
// //         setShowTyping(false);
// //         addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
// //         resolve();
// //       }, delay);
// //     });
// //   }, [addLocal]); // addLocal is stable so botReply is also stable

// //   useEffect(() => { botReplyRef.current = botReply; }, [botReply]);

// //   // ── FIXED Welcome effect: only depends on state.connected + state.loading ─
// //   //
// //   // state.loading becomes false AFTER fetchMessages completes (messages are
// //   // already in state when INIT_SUCCESS fires). So by the time this runs,
// //   // state.messages is populated and session.status is known.
// //   //
// //   // Decision tree:
// //   //   1. Session is ASSIGNED / HUMAN → already with agent → skip to free chat
// //   //   2. Session is WAITING_FOR_AGENT → in queue → skip to free chat
// //   //   3. Session has existing messages → returning user → skip to free chat
// //   //   4. Fresh session → show welcome + menu
// //   useEffect(() => {
// //     // Wait until fully connected AND messages loaded
// //     if (!state.connected || state.loading) return;

// //     // Only run once
// //     if (hasWelcomed.current) return;
// //     hasWelcomed.current = true;

// //     const sess = stateRef.current.session;
// //     const msgs = stateRef.current.messages;

// //     console.log('%c[Chat:WELCOME] Deciding flow...', 'color:#8b5cf6;font-weight:bold', {
// //       sessionId: sess?.id,
// //       status:    sess?.status,
// //       mode:      sess?.mode,
// //       agentName: sess?.assignedAgentName,
// //       msgCount:  msgs.length,
// //       msgs:      msgs.map(m => `[${m.senderType}] ${m.content.slice(0, 40)}`),
// //     });

// //     // 1. Already with a human agent — skip bot flow entirely
// //     if (
// //       sess?.status === 'ASSIGNED' ||
// //       sess?.status === 'WAITING_FOR_AGENT' ||
// //       sess?.mode === 'HUMAN'
// //     ) {
// //       console.log('%c[Chat:WELCOME] Human session active, going to free chat. Status:', 'color:#10b981;font-weight:bold', sess?.status);
// //       setFlowStep('free');
// //       return;
// //     }

// //     // 2. Count messages by sender type
// //     const customerMsgCount = msgs.filter(m => m.senderType === 'CUSTOMER').length;
// //     const agentMsgCount    = msgs.filter(m => m.senderType === 'AGENT').length;
// //     const botMsgCount      = msgs.filter(m => m.senderType === 'BOT').length;

// //     // Real conversation = customer or agent has sent at least one message.
// //     // A lone BOT message (our own saved welcome greeting) does NOT count.
// //     const hasRealHistory = customerMsgCount > 0 || agentMsgCount > 0;

// //     console.log('%c[Chat:WELCOME] Message breakdown:', 'color:#8b5cf6;font-weight:bold', {
// //       customer: customerMsgCount,
// //       agent:    agentMsgCount,
// //       bot:      botMsgCount,
// //       hasRealHistory,
// //     });

// //     if (hasRealHistory) {
// //       console.log('%c[Chat:WELCOME] Real history found, going to free chat', 'color:#10b981;font-weight:bold');
// //       setFlowStep('free');
// //       return;
// //     }

// //     // 3. No real history (0 msgs OR only bot welcome messages from a previous visit)
// //     //    Show fresh welcome + quick reply menu
// //     console.log('%c[Chat:WELCOME] No real history — showing welcome menu', 'color:#f59e0b;font-weight:bold');
// //     const run = async () => {
// //       await botReplyRef.current!('👋 Hello! Welcome to Support. How can I help you today?', 700);
// //       setFlowStep('menu');
// //       setShowQuickReplies(true);
// //     };
// //     setTimeout(run, 300);

// //   }, [state.connected, state.loading]); // ← ONLY these two. No botReply, no messages.

// //   // Auto-focus input in free mode
// //   useEffect(() => {
// //     if (flowStep === 'free') inputRef.current?.focus();
// //   }, [flowStep]);

// //   // Auto-switch to free when agent joins mid-flow
// //   useEffect(() => {
// //     const newCount = state.messages.length;
// //     if (newCount > prevMsgCount.current) {
// //       const newMsgs = state.messages.slice(prevMsgCount.current);
// //       if (newMsgs.some(m => m.senderType === 'AGENT') && flowStep !== 'free') {
// //         setFlowStep('free');
// //         setShowQuickReplies(false);
// //       }
// //     }
// //     prevMsgCount.current = newCount;
// //   }, [state.messages, flowStep]);

// //   // ── waitForSession: polls until session.id is ready (max 8s) ─────────────
// //   const waitForSession = useCallback((): Promise<string> => {
// //     return new Promise((resolve, reject) => {
// //       if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
// //       const max = 8000; const step = 200; let elapsed = 0;
// //       const t = setInterval(() => {
// //         elapsed += step;
// //         const id = stateRef.current.session?.id;
// //         if (id) { clearInterval(t); resolve(id); }
// //         else if (elapsed >= max) { clearInterval(t); reject(new Error('Session not ready — please try again')); }
// //       }, step);
// //     });
// //   }, []);

// //   // ── escalateToAgent: REST first (persists to DB) then WS (real-time ping) ─
// //   const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
// //     const cfg = configRef.current;
// //     try {
// //       await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${sessionId}/escalate`, {
// //         method: 'POST',
// //         headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
// //         body: JSON.stringify({ reason }),
// //       });
// //     } catch (e) {
// //       console.warn('[Chat] REST escalation failed, using WS only:', e);
// //     }
// //     actionsRef.current.requestAgent?.(reason);
// //   }, []);

// //   // ── allMessages merge ─────────────────────────────────────────────────────
// //   const allMessages = React.useMemo(() => {
// //     const seen = new Set<string>();
// //     const result: ChatMessage[] = [];
// //     for (const m of state.messages) { seen.add(m.id); result.push(m); }
// //     for (const m of localMessages) {
// //       if (seen.has(m.id)) continue;
// //       if (m.id.startsWith('temp-')) {
// //         if (!state.messages.some(s => s.senderType === 'CUSTOMER' && s.content === m.content)) {
// //           seen.add(m.id); result.push(m);
// //         }
// //       } else { seen.add(m.id); result.push(m); }
// //     }
// //     return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
// //   }, [state.messages, localMessages]);

// //   useEffect(() => {
// //     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
// //   }, [allMessages.length, showTyping, state.isTyping]);

// //   // ── Quick reply handler ───────────────────────────────────────────────────
// //   const handleQuickReply = useCallback(async (reply: QuickReply) => {
// //     setShowQuickReplies(false);
// //     setEscalationError(null);

// //     addLocal({
// //       senderType: 'CUSTOMER',
// //       senderId: configRef.current.user.id,
// //       senderName: configRef.current.user.name,
// //       content: reply.label,
// //     });

// //     switch (reply.id) {
// //       case 'order_details':
// //         await botReply("Sure! Let me pull up your recent orders.", 800);
// //         await botReply("📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch", 1400);
// //         await botReply("Is there anything else I can help you with?", 900);
// //         setFlowStep('menu'); setShowQuickReplies(true);
// //         break;

// //       case 'track_order':
// //         await botReply("🔍 Fetching tracking info for your latest order...", 800);
// //         await botReply("📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18", 1600);
// //         await botReply("Need anything else?", 800);
// //         setFlowStep('menu'); setShowQuickReplies(true);
// //         break;

// //       case 'faq':
// //         await botReply("📚 Here are answers to common questions:", 800);
// //         await botReply("🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)", 1500);
// //         await botReply("Still need help?", 700);
// //         setFlowStep('menu'); setShowQuickReplies(true);
// //         break;

// //       case 'human': {
// //         setFlowStep('escalating');
// //         await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
// //         try {
// //           const sessionId = await waitForSession();
// //           await escalateToAgent(sessionId, 'Customer requested human agent');
// //           addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '🟢 You are now in the agent queue. An agent will join shortly.' });
// //           setFlowStep('free');
// //         } catch (err: any) {
// //           const msg = err?.message ?? 'Could not connect. Please try again.';
// //           setEscalationError(msg);
// //           addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '⚠️ Could not connect to an agent. Please try again.' });
// //           setFlowStep('menu');
// //           setTimeout(() => setShowQuickReplies(true), 500);
// //         }
// //         break;
// //       }
// //     }
// //   }, [addLocal, botReply, waitForSession, escalateToAgent]);

// //   // ── Send message ──────────────────────────────────────────────────────────
// //   const handleSend = useCallback(() => {
// //     const content = inputValue.trim();
// //     if (!content || !stateRef.current.connected) return;
// //     actionsRef.current.sendMessage(content);
// //     setInputValue('');
// //     actionsRef.current.stopTyping?.();
// //     if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
// //   }, [inputValue, flowStep]);

// //   const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
// //     if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
// //   }, [handleSend]);

// //   const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
// //     setInputValue(e.target.value);
// //     actionsRef.current.startTyping?.();
// //     if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
// //     typingTimeoutRef.current = setTimeout(() => actionsRef.current.stopTyping?.(), 2000);
// //   }, []);

// //   const subtitle = (() => {
// //     if (state.loading) return 'Connecting...';
// //     if (flowStep === 'escalating') return 'Connecting to agent...';
// //     if (state.session?.assignedAgentName) return `Chatting with ${state.session.assignedAgentName}`;
// //     if (state.session?.mode === 'HUMAN') return 'Connected to agent';
// //     return 'AI Support · Online';
// //   })();

// //   const isClosed = state.session?.status === 'CLOSED';
// //   const canType  = !isClosed && state.connected && flowStep !== 'escalating';
// //   const isActive = !!inputValue.trim() && canType;

// //   // ── Loading ───────────────────────────────────────────────────────────────
// //   if (state.loading) {
// //     return (
// //       <div style={styles.widget}>
// //         <WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme} />
// //         <div style={styles.centeredBox}>
// //           <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
// //             <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
// //             <path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round">
// //               <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
// //             </path>
// //           </svg>
// //           <span style={{ fontSize: 13, color: '#9ca3af' }}>Starting chat...</span>
// //         </div>
// //       </div>
// //     );
// //   }

// //   // ── Error ─────────────────────────────────────────────────────────────────
// //   if (state.error && !state.connected) {
// //     return (
// //       <div style={styles.widget}>
// //         <WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme} />
// //         <div style={styles.centeredBox}>
// //           <div style={{ fontSize: 40 }}>⚠️</div>
// //           <div>
// //             <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Connection Lost</div>
// //             <div style={{ fontSize: 13, color: '#6b7280' }}>{state.error.message}</div>
// //           </div>
// //           <button onClick={() => actionsRef.current.reconnect?.()} style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
// //             Retry
// //           </button>
// //         </div>
// //       </div>
// //     );
// //   }

// //   // ── Main ──────────────────────────────────────────────────────────────────
// //   return (
// //     <div style={styles.widget}>
// //       <WidgetHeader onClose={onClose} styles={styles} subtitle={subtitle} theme={theme} />

// //       {flowStep === 'escalating' ? (
// //         <EscalatingScreen styles={styles} primaryColor={theme.primaryColor} />
// //       ) : (
// //         <>
// //           <div style={styles.messages}>
// //             {allMessages.map(msg => (
// //               <div key={msg.id} style={{ animation: 'chatFadeIn 0.2s ease' }}>
// //                 <MessageBubble message={msg} styles={styles} userName={config.user.name} />
// //               </div>
// //             ))}
// //             {(showTyping || state.isTyping) && <TypingIndicator styles={styles} />}
// //             <div ref={messagesEndRef} />
// //           </div>

// //           {escalationError && (
// //             <div style={{ margin: '8px 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
// //               <span>⚠️</span>
// //               <span style={{ flex: 1 }}>{escalationError}</span>
// //               <button onClick={() => setEscalationError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1 }}>×</button>
// //             </div>
// //           )}

// //           {showQuickReplies && flowStep === 'menu' && (
// //             <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} styles={styles} primaryColor={theme.primaryColor} />
// //           )}

// //           {isClosed ? (
// //             <div style={{ padding: '16px 14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#fafafa' }}>
// //               <div style={{ fontSize: 28 }}>✅</div>
// //               <div style={{ textAlign: 'center' }}>
// //                 <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat Ended</div>
// //                 <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This session has been closed.<br />Need more help?</div>
// //               </div>
// //               {onStartNewChat && (
// //                 <button
// //                   onClick={onStartNewChat}
// //                   style={{ padding: '10px 24px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)`, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', boxShadow: `0 3px 12px ${theme.primaryColor}44`, letterSpacing: '-0.01em' }}
// //                   onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 5px 18px ${theme.primaryColor}66`; }}
// //                   onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 3px 12px ${theme.primaryColor}44`; }}
// //                 >
// //                   + Start New Chat
// //                 </button>
// //               )}
// //             </div>
// //           ) : (
// //             <div style={styles.inputArea}>
// //               <input
// //                 ref={inputRef}
// //                 type="text"
// //                 placeholder={canType ? 'Type a message...' : 'Connecting...'}
// //                 value={inputValue}
// //                 onChange={handleInputChange}
// //                 onKeyDown={handleKeyDown}
// //                 disabled={!canType}
// //                 style={{ ...styles.input, borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb', opacity: canType ? 1 : 0.6 }}
// //               />
// //               <button onClick={handleSend} disabled={!isActive} style={{ ...styles.sendBtn, background: isActive ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)` : '#f3f4f6', boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none', cursor: isActive ? 'pointer' : 'not-allowed' }}>
// //                 <SendIcon active={!!isActive} />
// //               </button>
// //             </div>
// //           )}
// //         </>
// //       )}
// //     </div>
// //   );
// // }

// // // ==========================================
// // // ChatWidget — public entry point
// // // ==========================================

// // export interface ChatWidgetProps {
// //   config: ChatSDKConfig;
// //   defaultOpen?: boolean;
// // }

// // export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
// //   const [isOpen, setIsOpen]         = useState(defaultOpen);
// //   const [launchHover, setLaunchHover] = useState(false);
// //   const [chatKey, setChatKey]       = useState(0);
// //   const theme: FullTheme = { ...defaultTheme, ...config.theme };
// //   const styles = getStyles(config.theme);

// //   const handleStartNewChat = () => {
// //     // Increment key → unmounts ChatProvider → mounts fresh one → new WS session
// //     setChatKey(k => k + 1);
// //   };

// //   return (
// //     <div style={styles.container}>
// //       {!isOpen && (
// //         <button
// //           style={{ ...styles.launcher, transform: launchHover ? 'scale(1.1)' : 'scale(1)', boxShadow: launchHover ? `0 6px 28px ${theme.primaryColor}77` : `0 4px 20px ${theme.primaryColor}44` }}
// //           onClick={() => setIsOpen(true)}
// //           onMouseEnter={() => setLaunchHover(true)}
// //           onMouseLeave={() => setLaunchHover(false)}
// //           aria-label="Open chat support"
// //         >
// //           <ChatIcon />
// //         </button>
// //       )}

// //       {/* key={chatKey} forces a full remount → creates a fresh session on Start New Chat */}
// //       <ChatProvider config={config} key={chatKey}>
// //         <div style={{ display: isOpen ? 'block' : 'none' }}>
// //           <ChatContent onClose={() => setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} />
// //         </div>
// //       </ChatProvider>
// //     </div>
// //   );
// // }

// // export default ChatWidget;


// import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
// import { ChatProvider, useChat } from './context';
// import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';
// import { playNotificationSound, unlockAudio } from './notificationSound';

// // ==========================================
// // Flow Types
// // ==========================================

// type FlowStep =
//   | 'welcome'
//   | 'menu'
//   | 'escalating'
//   | 'free';

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

// type FullTheme = {
//   primaryColor: string; headerBackground: string; headerText: string;
//   customerBubbleColor: string; agentBubbleColor: string; fontFamily: string;
//   borderRadius: string; position: 'bottom-right' | 'bottom-left';
// };

// function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
//   const t: FullTheme = { ...defaultTheme, ...theme };
//   const isRight = (t.position as string) !== 'bottom-left';
//   return {
//     container: { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
//     launcher: { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
//     widget: { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
//     header: { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
//     headerAvatar: { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
//     headerInfo: { flex: 1 },
//     headerTitle: { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
//     headerSub: { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
//     onlineDot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
//     closeBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
//     messages: { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
//     bubbleCustomer: { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
//     bubbleAgent: { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
//     bubbleSystem: { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
//     senderLabel: { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
//     timestamp: { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
//     typingWrap: { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
//     typingDot: { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
//     quickRepliesWrap: { padding: '10px 14px 12px', display: 'flex', flexDirection: 'column' as const, gap: '8px', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f0', flexShrink: 0 },
//     quickRepliesLabel: { fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
//     quickReplyBtn: { width: '100%', padding: '10px 16px', borderRadius: '12px', border: '1.5px solid #e0d9ff', backgroundColor: '#ffffff', color: '#5b4fcf', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' as const, transition: 'all 0.15s' },
//     inputArea: { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0 },
//     input: { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
//     sendBtn: { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
//     centeredBox: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
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
//     <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
//   </svg>
// );

// const SendIcon = ({ active }: { active: boolean }) => (
//   <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//     <path d="M22 2L11 13" stroke={active ? 'white' : '#9ca3af'} strokeWidth="2.5" strokeLinecap="round" />
//     <path d="M22 2L15 22L11 13L2 9L22 2Z" fill={active ? 'white' : '#9ca3af'} />
//   </svg>
// );

// const ChevronDownIcon = () => (
//   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
//     <polyline points="6 9 12 15 18 9" />
//   </svg>
// );

// const SpinnerIcon = ({ color = '#9ca3af', size = 16 }: { color?: string; size?: number }) => (
//   <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
//     <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
//     <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round">
//       <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
//     </path>
//   </svg>
// );

// // ==========================================
// // Sub-components
// // ==========================================

// function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }) {
//   return (
//     <div style={styles.typingWrap}>
//       {[0, 0.2, 0.4].map((d, i) => (
//         <div key={i} style={{ ...styles.typingDot, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
//       ))}
//     </div>
//   );
// }

// // Returns true if the string looks like a raw hex ID (e.g. Cognito sub or UUID without hyphens)
// function looksLikeRawId(s: string | undefined): boolean {
//   if (!s) return false;
//   return /^[0-9a-fA-F-]{20,}$/.test(s);
// }

// function MessageBubble({ message, styles }: { message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string }) {
//   const isCustomer = message.senderType === 'CUSTOMER';
//   const isSystem   = message.senderType === 'SYSTEM';
//   const isBot      = message.senderType === 'BOT';
//   const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

//   // Filter out system messages that are just raw hex IDs (no real text content)
//   if (isSystem && looksLikeRawId(message.content?.trim())) return null;

//   if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

//   // Use senderName, but fall back to 'Agent' if it's missing or looks like a raw ID
//   const rawName = message.senderName;
//   const agentLabel = (rawName && !looksLikeRawId(rawName)) ? rawName : 'Agent';
//   const label = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

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
//   replies: QuickReply[]; onSelect: (r: QuickReply) => void;
//   styles: Record<string, React.CSSProperties>; primaryColor: string;
// }) {
//   return (
//     <div style={styles.quickRepliesWrap}>
//       <div style={styles.quickRepliesLabel}>Choose an option</div>
//       {replies.map(r => (
//         <button key={r.id} style={styles.quickReplyBtn} onClick={() => onSelect(r)}
//           onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor = primaryColor; }}
//           onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff'; }}
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
//         <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 8 }}>Connecting you to an agent</div>
//         <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>You've been added to the support queue.<br />An agent will join shortly.</div>
//       </div>
//       <div style={{ display: 'flex', gap: 8 }}>
//         {[0, 0.2, 0.4].map((d, i) => (
//           <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: primaryColor, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
//         ))}
//       </div>
//       <div style={{ padding: '8px 20px', borderRadius: 20, backgroundColor: '#ede9fe', color: primaryColor, fontSize: 12, fontWeight: 700 }}>
//         Est. wait: &lt; 2 min
//       </div>
//     </div>
//   );
// }

// function WidgetHeader({ onClose, styles, subtitle, theme }: {
//   onClose: () => void; styles: Record<string, React.CSSProperties>; subtitle: string; theme: FullTheme;
// }) {
//   return (
//     <div style={styles.header}>
//       <div style={styles.headerAvatar}>💬</div>
//       <div style={styles.headerInfo}>
//         <h3 style={styles.headerTitle}>Chat Support</h3>
//         <div style={styles.headerSub}><span style={styles.onlineDot} />{subtitle}</div>
//       </div>
//       <button style={styles.closeBtn} onClick={onClose}><CloseIcon /></button>
//     </div>
//   );
// }

// // ==========================================
// // ChatContent — main logic
// // ==========================================

// export function ChatContent({ onClose, styles, config, theme, onStartNewChat }: {
//   onClose: () => void;
//   styles: Record<string, React.CSSProperties>;
//   config: ChatSDKConfig;
//   theme: FullTheme;
//   onStartNewChat?: () => void;
// }): JSX.Element {
//   const { state, actions } = useChat();

//   const [inputValue, setInputValue]             = useState('');
//   const [flowStep, setFlowStep]                 = useState<FlowStep>('welcome');
//   const [localMessages, setLocalMessages]       = useState<ChatMessage[]>([]);
//   const [showTyping, setShowTyping]             = useState(false);
//   const [showQuickReplies, setShowQuickReplies] = useState(false);
//   const [escalationError, setEscalationError]   = useState<string | null>(null);

//   const messagesEndRef   = useRef<HTMLDivElement>(null);
//   const messagesAreaRef  = useRef<HTMLDivElement>(null);
//   const inputRef         = useRef<HTMLInputElement>(null);
//   const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
//   const hasWelcomed      = useRef(false);
//   const prevMsgCount     = useRef(0);
//   const prevSoundCount   = useRef(0);

//   // ── Scroll-up pagination state (mirrors agent dashboard ChatPanel) ────────
//   const shouldScrollBottom     = useRef(true);
//   const savedScrollHeightRef   = useRef(0);
//   const prevMsgCountLayoutRef  = useRef(0);
//   const maxScrollTopRef        = useRef(0);
//   const [showJumpToBottom, setShowJumpToBottom] = useState(false);

//   // ── Stable refs so callbacks never change identity ────────────────────────
//   const stateRef    = useRef(state);
//   const actionsRef  = useRef(actions);
//   const configRef   = useRef(config);
//   const botReplyRef = useRef<(content: string, delay?: number) => Promise<void>>();

//   useEffect(() => { stateRef.current   = state;   }, [state]);
//   useEffect(() => { actionsRef.current = actions; }, [actions]);
//   useEffect(() => { configRef.current  = config;  }, [config]);

//   // Inject keyframes once
//   useEffect(() => {
//     const id = 'chat-sdk-kf';
//     if (document.getElementById(id)) return;
//     const s = document.createElement('style');
//     s.id = id;
//     s.textContent = `
//       @keyframes chatTypingBounce {
//         0%,80%,100%{transform:translateY(0);opacity:.4}
//         40%{transform:translateY(-5px);opacity:1}
//       }
//       @keyframes chatFadeIn {
//         from{opacity:0;transform:translateY(5px)}
//         to{opacity:1;transform:translateY(0)}
//       }
//     `;
//     document.head.appendChild(s);
//   }, []);

//   // ── addLocal: ZERO deps — reads session via stateRef, never re-creates ────
//   // This is the root fix. Previously depended on state.session?.id which
//   // caused botReply → welcome effect chain to break.
//   const addLocal = useCallback((
//     msg: Omit<ChatMessage, 'id' | 'timestamp' | 'chatSessionId' | 'messageType'> &
//          { id?: string; chatSessionId?: string; messageType?: ChatMessage['messageType'] }
//   ) => {
//     const full: ChatMessage = {
//       id:            msg.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
//       timestamp:     new Date(),
//       chatSessionId: msg.chatSessionId || stateRef.current.session?.id || 'local',
//       messageType:   msg.messageType || 'TEXT',
//       ...msg,
//     };
//     setLocalMessages(prev => [...prev, full]);
//   }, []); // ← zero deps: stable forever

//   // ── botReply: stable, also kept in ref ───────────────────────────────────
//   const botReply = useCallback((content: string, delay = 800): Promise<void> => {
//     setShowTyping(true);
//     return new Promise(resolve => {
//       setTimeout(() => {
//         setShowTyping(false);
//         addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
//         resolve();
//       }, delay);
//     });
//   }, [addLocal]); // addLocal is stable so botReply is also stable

//   useEffect(() => { botReplyRef.current = botReply; }, [botReply]);

//   // ── FIXED Welcome effect: only depends on state.connected + state.loading ─
//   //
//   // state.loading becomes false AFTER fetchMessages completes (messages are
//   // already in state when INIT_SUCCESS fires). So by the time this runs,
//   // state.messages is populated and session.status is known.
//   //
//   // Decision tree:
//   //   1. Session is ASSIGNED / HUMAN → already with agent → skip to free chat
//   //   2. Session is WAITING_FOR_AGENT → in queue → skip to free chat
//   //   3. Session has existing messages → returning user → skip to free chat
//   //   4. Fresh session → show welcome + menu
//   useEffect(() => {
//     // Wait until fully connected AND messages loaded
//     if (!state.connected || state.loading) return;

//     // Only run once
//     if (hasWelcomed.current) return;
//     hasWelcomed.current = true;

//     const sess = stateRef.current.session;
//     const msgs = stateRef.current.messages;

//     console.log('%c[Chat:WELCOME] Deciding flow...', 'color:#8b5cf6;font-weight:bold', {
//       sessionId: sess?.id,
//       status:    sess?.status,
//       mode:      sess?.mode,
//       agentName: sess?.assignedAgentName,
//       msgCount:  msgs.length,
//       msgs:      msgs.map(m => `[${m.senderType}] ${m.content.slice(0, 40)}`),
//     });

//     // 1. Already with a human agent — skip bot flow entirely
//     if (
//       sess?.status === 'ASSIGNED' ||
//       sess?.status === 'WAITING_FOR_AGENT' ||
//       sess?.mode === 'HUMAN'
//     ) {
//       console.log('%c[Chat:WELCOME] Human session active, going to free chat. Status:', 'color:#10b981;font-weight:bold', sess?.status);
//       setFlowStep('free');
//       return;
//     }

//     // 2. Count messages by sender type
//     const customerMsgCount = msgs.filter(m => m.senderType === 'CUSTOMER').length;
//     const agentMsgCount    = msgs.filter(m => m.senderType === 'AGENT').length;
//     const botMsgCount      = msgs.filter(m => m.senderType === 'BOT').length;

//     // Real conversation = customer or agent has sent at least one message.
//     // A lone BOT message (our own saved welcome greeting) does NOT count.
//     const hasRealHistory = customerMsgCount > 0 || agentMsgCount > 0;

//     console.log('%c[Chat:WELCOME] Message breakdown:', 'color:#8b5cf6;font-weight:bold', {
//       customer: customerMsgCount,
//       agent:    agentMsgCount,
//       bot:      botMsgCount,
//       hasRealHistory,
//     });

//     if (hasRealHistory) {
//       console.log('%c[Chat:WELCOME] Real history found, going to free chat', 'color:#10b981;font-weight:bold');
//       setFlowStep('free');
//       return;
//     }

//     // 3. No real history (0 msgs OR only bot welcome messages from a previous visit)
//     //    Show fresh welcome + quick reply menu
//     console.log('%c[Chat:WELCOME] No real history — showing welcome menu', 'color:#f59e0b;font-weight:bold');
//     const run = async () => {
//       await botReplyRef.current!('👋 Hello! Welcome to Support. How can I help you today?', 700);
//       setFlowStep('menu');
//       setShowQuickReplies(true);
//     };
//     setTimeout(run, 300);

//   }, [state.connected, state.loading]); // ← ONLY these two. No botReply, no messages.

//   // Auto-focus input in free mode
//   useEffect(() => {
//     if (flowStep === 'free') inputRef.current?.focus();
//   }, [flowStep]);

//   // Auto-switch to free when agent joins mid-flow
//   useEffect(() => {
//     const newCount = state.messages.length;
//     if (newCount > prevMsgCount.current) {
//       const newMsgs = state.messages.slice(prevMsgCount.current);
//       if (newMsgs.some(m => m.senderType === 'AGENT') && flowStep !== 'free') {
//         setFlowStep('free');
//         setShowQuickReplies(false);
//       }
//     }
//     prevMsgCount.current = newCount;
//   }, [state.messages, flowStep]);

//   // ── Notification sound for new agent/bot messages ─────────────────────────
//   // Mirror agent dashboard: only play sound when widget is NOT visible.
//   // Uses its own ref (prevSoundCount) so the auto-switch effect above
//   // doesn't swallow the check by updating prevMsgCount first.
//   useEffect(() => {
//     const newCount = state.messages.length;
//     if (newCount > prevSoundCount.current) {
//       const newMsgs = state.messages.slice(prevSoundCount.current);
//       const hasAgentOrBotMsg = newMsgs.some(m => m.senderType === 'AGENT' || m.senderType === 'BOT');
//       if (hasAgentOrBotMsg && !state.isWidgetOpen) {
//         playNotificationSound();
//       }
//     }
//     prevSoundCount.current = newCount;
//   }, [state.messages.length, state.isWidgetOpen]);

//   // ── Unlock audio on first user interaction ────────────────────────────────
//   useEffect(() => {
//     const unlock = () => { unlockAudio(); window.removeEventListener('click', unlock); };
//     window.addEventListener('click', unlock);
//     return () => window.removeEventListener('click', unlock);
//   }, []);

//   // ── waitForSession: polls until session.id is ready (max 8s) ─────────────
//   const waitForSession = useCallback((): Promise<string> => {
//     return new Promise((resolve, reject) => {
//       if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
//       const max = 8000; const step = 200; let elapsed = 0;
//       const t = setInterval(() => {
//         elapsed += step;
//         const id = stateRef.current.session?.id;
//         if (id) { clearInterval(t); resolve(id); }
//         else if (elapsed >= max) { clearInterval(t); reject(new Error('Session not ready — please try again')); }
//       }, step);
//     });
//   }, []);

//   // ── escalateToAgent: REST first (persists to DB) then WS (real-time ping) ─
//   const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
//     const cfg = configRef.current;
//     try {
//       await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${sessionId}/escalate`, {
//         method: 'POST',
//         headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
//         body: JSON.stringify({ reason }),
//       });
//     } catch (e) {
//       console.warn('[Chat] REST escalation failed, using WS only:', e);
//     }
//     actionsRef.current.requestAgent?.(reason);
//   }, []);

//   // ── allMessages merge ─────────────────────────────────────────────────────
//   const allMessages = React.useMemo(() => {
//     const seen = new Set<string>();
//     const result: ChatMessage[] = [];
//     for (const m of state.messages) { seen.add(m.id); result.push(m); }
//     for (const m of localMessages) {
//       if (seen.has(m.id)) continue;
//       if (m.id.startsWith('temp-')) {
//         if (!state.messages.some(s => s.senderType === 'CUSTOMER' && s.content === m.content)) {
//           seen.add(m.id); result.push(m);
//         }
//       } else { seen.add(m.id); result.push(m); }
//     }
//     return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
//   }, [state.messages, localMessages]);

//   // ── Scroll restoration (useLayoutEffect — runs before paint) ──────────────
//   // Mirror agent dashboard ChatPanel: when older messages are prepended, the
//   // DOM height grows. We saved the OLD scrollHeight before triggering load;
//   // here we shift scrollTop by the diff so the viewport stays in place.
//   useLayoutEffect(() => {
//     const el = messagesAreaRef.current;
//     const msgCount = allMessages.length;

//     if (
//       el &&
//       msgCount > prevMsgCountLayoutRef.current &&
//       !shouldScrollBottom.current &&
//       savedScrollHeightRef.current > 0
//     ) {
//       const diff = el.scrollHeight - savedScrollHeightRef.current;
//       if (diff > 0) el.scrollTop = diff;
//       savedScrollHeightRef.current = 0;
//     }
//     prevMsgCountLayoutRef.current = msgCount;
//   }, [allMessages.length]);

//   // ── Auto-scroll to bottom when new messages arrive (if user is at bottom) ─
//   useEffect(() => {
//     if (shouldScrollBottom.current) {
//       messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//     }
//   }, [allMessages.length, showTyping, state.isTyping]);

//   // ── Scroll handler: detect scroll-up for pagination + show jump button ────
//   const handleMessagesScroll = useCallback(() => {
//     const el = messagesAreaRef.current;
//     if (!el) return;

//     // Track max scroll position user has reached
//     if (el.scrollTop > maxScrollTopRef.current) {
//       maxScrollTopRef.current = el.scrollTop;
//     }

//     // Is user near the bottom? (within 80px)
//     const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
//     const isAtBottom = distanceFromBottom < 80;
//     shouldScrollBottom.current = isAtBottom;
//     setShowJumpToBottom(!isAtBottom);

//     // Scroll-up pagination trigger: when user scrolls near top
//     if (
//       el.scrollTop < 60 &&
//       maxScrollTopRef.current > 60 &&
//       !state.loadingMore &&
//       state.hasMore
//     ) {
//       savedScrollHeightRef.current = el.scrollHeight;
//       shouldScrollBottom.current = false;
//       actions.loadOlderMessages();
//     }
//   }, [state.loadingMore, state.hasMore, actions]);

//   // ── Jump to bottom ────────────────────────────────────────────────────────
//   const scrollToBottom = useCallback(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//     shouldScrollBottom.current = true;
//     setShowJumpToBottom(false);
//   }, []);

//   // ── Quick reply handler ───────────────────────────────────────────────────
//   const handleQuickReply = useCallback(async (reply: QuickReply) => {
//     setShowQuickReplies(false);
//     setEscalationError(null);

//     addLocal({
//       senderType: 'CUSTOMER',
//       senderId: configRef.current.user.id,
//       senderName: configRef.current.user.name,
//       content: reply.label,
//     });

//     switch (reply.id) {
//       case 'order_details':
//         await botReply("Sure! Let me pull up your recent orders.", 800);
//         await botReply("📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch", 1400);
//         await botReply("Is there anything else I can help you with?", 900);
//         setFlowStep('menu'); setShowQuickReplies(true);
//         break;

//       case 'track_order':
//         await botReply("🔍 Fetching tracking info for your latest order...", 800);
//         await botReply("📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18", 1600);
//         await botReply("Need anything else?", 800);
//         setFlowStep('menu'); setShowQuickReplies(true);
//         break;

//       case 'faq':
//         await botReply("📚 Here are answers to common questions:", 800);
//         await botReply("🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)", 1500);
//         await botReply("Still need help?", 700);
//         setFlowStep('menu'); setShowQuickReplies(true);
//         break;

//       case 'human': {
//         setFlowStep('escalating');
//         await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
//         try {
//           const sessionId = await waitForSession();
//           await escalateToAgent(sessionId, 'Customer requested human agent');
//           addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '🟢 You are now in the agent queue. An agent will join shortly.' });
//           setFlowStep('free');
//         } catch (err: any) {
//           const msg = err?.message ?? 'Could not connect. Please try again.';
//           setEscalationError(msg);
//           addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '⚠️ Could not connect to an agent. Please try again.' });
//           setFlowStep('menu');
//           setTimeout(() => setShowQuickReplies(true), 500);
//         }
//         break;
//       }
//     }
//   }, [addLocal, botReply, waitForSession, escalateToAgent]);

//   // ── Send message ──────────────────────────────────────────────────────────
//   const handleSend = useCallback(() => {
//     const content = inputValue.trim();
//     if (!content || !stateRef.current.connected || stateRef.current.tokenExpired) return;
//     try {
//       actionsRef.current.sendMessage(content);
//       setInputValue('');
//       actionsRef.current.stopTyping?.();
//       if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
//     } catch (err: any) {
//       if (err?.message === 'TOKEN_EXPIRED') {
//         console.warn('[Chat] Cannot send — token expired');
//         return;
//       }
//       throw err;
//     }
//   }, [inputValue, flowStep]);

//   const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
//     if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
//   }, [handleSend]);

//   const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
//     setInputValue(e.target.value);
//     actionsRef.current.startTyping?.();
//     if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
//     typingTimeoutRef.current = setTimeout(() => actionsRef.current.stopTyping?.(), 2000);
//   }, []);

//   const subtitle = (() => {
//     if (state.tokenExpired) return 'Session Expired';
//     if (state.loading) return 'Connecting...';
//     if (flowStep === 'escalating') return 'Connecting to agent...';
//     if (state.session?.assignedAgentName && !looksLikeRawId(state.session.assignedAgentName)) {
//       return `Chatting with ${state.session.assignedAgentName}`;
//     }
//     if (state.session?.mode === 'HUMAN') return 'Connected to agent';
//     return 'AI Support · Online';
//   })();

//   const isClosed = state.session?.status === 'CLOSED';
//   const canType  = !isClosed && !state.tokenExpired && state.connected && flowStep !== 'escalating';
//   const isActive = !!inputValue.trim() && canType;

//   // ── Loading ───────────────────────────────────────────────────────────────
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

//   // ── Error ─────────────────────────────────────────────────────────────────
//   if (state.tokenExpired) {
//     return (
//       <div style={styles.widget}>
//         <WidgetHeader onClose={onClose} styles={styles} subtitle="Session Expired" theme={theme} />
//         <div style={styles.centeredBox}>
//           <div style={{ fontSize: 40 }}>⏳</div>
//           <div>
//             <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Session Expired</div>
//             <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>Your session has expired. Please refresh the page to continue chatting.</div>
//           </div>
//           <button
//             onClick={() => window.location.reload()}
//             style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}
//           >
//             Refresh Page
//           </button>
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
//           <button onClick={() => actionsRef.current.reconnect?.()} style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
//             Retry
//           </button>
//         </div>
//       </div>
//     );
//   }

//   // ── Main ──────────────────────────────────────────────────────────────────
//   return (
//     <div style={styles.widget}>
//       <WidgetHeader onClose={onClose} styles={styles} subtitle={subtitle} theme={theme} />

//       {flowStep === 'escalating' ? (
//         <EscalatingScreen styles={styles} primaryColor={theme.primaryColor} />
//       ) : (
//         <>
//           <div style={{ ...styles.messages, position: 'relative' as const }} ref={messagesAreaRef} onScroll={handleMessagesScroll}>
//             {/* Loading older messages spinner */}
//             {state.loadingMore && (
//               <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0 6px', gap: '8px' }}>
//                 <SpinnerIcon color={theme.primaryColor} size={16} />
//                 <span style={{ fontSize: '11px', color: '#9ca3af' }}>Loading older messages…</span>
//               </div>
//             )}
//             {/* Beginning of conversation marker */}
//             {!state.hasMore && allMessages.length > 0 && !state.loadingMore && (
//               <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0 12px' }}>
//                 <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', backgroundColor: '#f3eeff', padding: '3px 12px', borderRadius: '10px' }}>
//                   Beginning of conversation
//                 </span>
//               </div>
//             )}
//             {allMessages.map(msg => (
//               <div key={msg.id} style={{ animation: 'chatFadeIn 0.2s ease' }}>
//                 <MessageBubble message={msg} styles={styles} userName={config.user.name} />
//               </div>
//             ))}
//             {(showTyping || state.isTyping) && <TypingIndicator styles={styles} />}
//             <div ref={messagesEndRef} />
//           </div>

//           {/* Jump-to-bottom button — appears when user scrolls up */}
//           {showJumpToBottom && (
//             <div style={{ position: 'relative' as const, height: 0, zIndex: 10 }}>
//               <button
//                 onClick={scrollToBottom}
//                 style={{
//                   position: 'absolute', bottom: '8px', right: '16px',
//                   width: '36px', height: '36px', borderRadius: '50%',
//                   backgroundColor: '#ffffff', border: '1px solid #e5e7eb',
//                   boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
//                   cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
//                   color: theme.primaryColor, transition: 'all 0.15s',
//                 }}
//                 onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = theme.primaryColor; (e.currentTarget as HTMLElement).style.color = '#ffffff'; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 14px ${theme.primaryColor}44`; }}
//                 onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.color = theme.primaryColor; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'; }}
//                 aria-label="Scroll to latest messages"
//               >
//                 <ChevronDownIcon />
//               </button>
//             </div>
//           )}

//           {escalationError && (
//             <div style={{ margin: '8px 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
//               <span>⚠️</span>
//               <span style={{ flex: 1 }}>{escalationError}</span>
//               <button onClick={() => setEscalationError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1 }}>×</button>
//             </div>
//           )}

//           {showQuickReplies && flowStep === 'menu' && (
//             <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} styles={styles} primaryColor={theme.primaryColor} />
//           )}

//           {isClosed ? (
//             <div style={{ padding: '16px 14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#fafafa' }}>
//               <div style={{ fontSize: 28 }}>✅</div>
//               <div style={{ textAlign: 'center' }}>
//                 <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat Ended</div>
//                 <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This session has been closed.<br />Need more help?</div>
//               </div>
//               {onStartNewChat && (
//                 <button
//                   onClick={onStartNewChat}
//                   style={{ padding: '10px 24px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)`, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', boxShadow: `0 3px 12px ${theme.primaryColor}44`, letterSpacing: '-0.01em' }}
//                   onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 5px 18px ${theme.primaryColor}66`; }}
//                   onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 3px 12px ${theme.primaryColor}44`; }}
//                 >
//                   + Start New Chat
//                 </button>
//               )}
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
//                 style={{ ...styles.input, borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb', opacity: canType ? 1 : 0.6 }}
//               />
//               <button onClick={handleSend} disabled={!isActive} style={{ ...styles.sendBtn, background: isActive ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)` : '#f3f4f6', boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none', cursor: isActive ? 'pointer' : 'not-allowed' }}>
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
// // UnreadTracker — syncs isOpen into the reducer and reports state.unreadCount.
// // All counting logic lives in the reducer (ADD_MESSAGE / SET_WIDGET_OPEN),
// // exactly mirroring the agent dashboard's APPEND_MESSAGE / SELECT_SESSION pattern.
// // ==========================================

// function UnreadTracker({ isOpen, onUnreadChange }: {
//   isOpen: boolean;
//   onUnreadChange: (count: number) => void;
// }) {
//   const { state, actions } = useChat();
//   const prevIsOpenRef = useRef(isOpen);
//   const onUnreadChangeRef = useRef(onUnreadChange);
//   onUnreadChangeRef.current = onUnreadChange;

//   // Mirror agent dashboard SELECT_SESSION: tell reducer when widget opens/closes.
//   // Only dispatch when isOpen actually changes to avoid loops.
//   useEffect(() => {
//     if (prevIsOpenRef.current !== isOpen) {
//       prevIsOpenRef.current = isOpen;
//       actions.setWidgetOpen(isOpen);
//     }
//   }, [isOpen, actions]);

//   // Propagate reducer's unreadCount to the parent badge whenever it changes.
//   // Use ref for the callback to avoid re-running when callback identity changes.
//   useEffect(() => {
//     onUnreadChangeRef.current(state.unreadCount);
//   }, [state.unreadCount]);

//   return null;
// }

// // ==========================================
// // ChatWidget — public entry point
// // ====================

// export interface ChatWidgetProps {
//   config: ChatSDKConfig;
//   defaultOpen?: boolean;
// }

// export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
//   const [isOpen, setIsOpen]           = useState(defaultOpen);
//   const [launchHover, setLaunchHover] = useState(false);
//   const [chatKey, setChatKey]         = useState(0);
//   const [unreadCount, setUnreadCount] = useState(0);
//   const theme: FullTheme = useMemo(() => ({ ...defaultTheme, ...config.theme }), [config.theme]);
//   const styles = useMemo(() => getStyles(config.theme), [config.theme]);

//   const handleStartNewChat = () => {
//     // Increment key → unmounts ChatProvider → mounts fresh one → new WS session
//     setChatKey(k => k + 1);
//   };

//   const handleUnreadChange = useCallback((count: number) => {
//     setUnreadCount(count);
//   }, []);

//   return (
//     <div style={styles.container}>
//       {!isOpen && (
//         <button
//           style={{ ...styles.launcher, transform: launchHover ? 'scale(1.1)' : 'scale(1)', boxShadow: launchHover ? `0 6px 28px ${theme.primaryColor}77` : `0 4px 20px ${theme.primaryColor}44`, position: 'relative' as const }}
//           onClick={() => setIsOpen(true)}
//           onMouseEnter={() => setLaunchHover(true)}
//           onMouseLeave={() => setLaunchHover(false)}
//           aria-label="Open chat support"
//         >
//           <ChatIcon />
//           {unreadCount > 0 && (
//             <span style={{
//               position: 'absolute', top: '-4px', right: '-4px',
//               minWidth: '20px', height: '20px', borderRadius: '10px',
//               backgroundColor: '#ef4444', color: '#ffffff',
//               fontSize: '11px', fontWeight: 700,
//               display: 'flex', alignItems: 'center', justifyContent: 'center',
//               padding: '0 5px',
//               boxShadow: '0 2px 6px rgba(239,68,68,0.5)',
//               border: '2px solid #ffffff',
//               fontFamily: 'system-ui, sans-serif', lineHeight: 1,
//             }}>
//               {unreadCount > 99 ? '99+' : unreadCount}
//             </span>
//           )}
//         </button>
//       )}

//       {/* key={chatKey} forces a full remount → creates a fresh session on Start New Chat */}
//       <ChatProvider config={config} key={chatKey}>
//         <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange} />
//         <div style={{ display: isOpen ? 'block' : 'none' }}>
//           <ChatContent onClose={() => setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} />
//         </div>
//       </ChatProvider>
//     </div>
//   );
// }

// export default ChatWidget;




import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';
import { playNotificationSound, unlockAudio } from './notificationSound';

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

// Reply-to state type
interface ReplyTarget {
  id: string;
  content: string;
  senderType: string;
  senderName?: string;
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

const ChevronDownIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const SpinnerIcon = ({ color = '#9ca3af', size = 16 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
    </path>
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

// Returns true if the string looks like a raw hex ID (e.g. Cognito sub or UUID without hyphens)
function looksLikeRawId(s: string | undefined): boolean {
  if (!s) return false;
  return /^[0-9a-fA-F-]{20,}$/.test(s);
}

function MessageBubble({ message, styles, onImageClick, onReply, allMessages }: { message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string; onImageClick?: (url: string, fileName: string) => void; onReply?: (msg: ChatMessage) => void; allMessages?: ChatMessage[] }) {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isSystem   = message.senderType === 'SYSTEM';
  const isBot      = message.senderType === 'BOT';
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [hovered, setHovered] = useState(false);

  // Filter out system messages that are just raw hex IDs (no real text content)
  if (isSystem && looksLikeRawId(message.content?.trim())) return null;

  if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

  // Use senderName, but fall back to 'Agent' if it's missing or looks like a raw ID
  const rawName = message.senderName;
  const agentLabel = (rawName && !looksLikeRawId(rawName)) ? rawName : 'Agent';
  const label = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

  // Check if this is an attachment message
  const attachment = message.attachment ?? (message.metadata?.attachment as any) ?? null;

  // Auto-detect: if messageType is IMAGE/VIDEO/AUDIO/FILE, or if attachment exists,
  // or if the content is a CDN URL that looks like a media file
  const isCdnUrl = /^https?:\/\/cdn\.\w+\.\w+\//.test(message.content ?? '');
  const contentUrl = message.content ?? '';
  const isImageUrl = /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(contentUrl);
  const isVideoUrl = /\.(mp4|webm|mov|avi)(\?.*)?$/i.test(contentUrl);
  const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac|webm)(\?.*)?$/i.test(contentUrl);

  // Resolve effective type
  let effectiveType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null = null;
  if (message.messageType === 'IMAGE' || (attachment?.mimeType?.startsWith('image/')) || (isCdnUrl && isImageUrl)) effectiveType = 'IMAGE';
  else if (message.messageType === 'VIDEO' || (attachment?.mimeType?.startsWith('video/')) || (isCdnUrl && isVideoUrl)) effectiveType = 'VIDEO';
  else if (message.messageType === 'AUDIO' || (attachment?.mimeType?.startsWith('audio/')) || (isCdnUrl && isAudioUrl)) effectiveType = 'AUDIO';
  else if (message.messageType === 'FILE' || attachment) effectiveType = 'FILE';

  const isAttachment = effectiveType !== null;
  const isAudio = effectiveType === 'AUDIO';

  // Resolve reply-to message
  const replyTo = message.replyToMessage ?? (message.replyToMessageId && allMessages
    ? allMessages.find(m => m.id === message.replyToMessageId) ?? null
    : null);

  const renderReplyQuote = () => {
    if (!replyTo) return null;
    const replyName = replyTo.senderType === 'CUSTOMER' ? 'You'
      : (replyTo as any).senderName ?? (replyTo.senderType === 'BOT' ? 'AI Assistant' : 'Agent');
    const isMediaReply = ['IMAGE', 'VIDEO', 'AUDIO', 'FILE'].includes(replyTo.messageType);
    const replyPreview = isMediaReply
      ? `📎 ${replyTo.messageType.charAt(0) + replyTo.messageType.slice(1).toLowerCase()}`
      : (replyTo.content?.length > 60 ? replyTo.content.slice(0, 60) + '…' : replyTo.content);
    return (
      <div style={{
        padding: '6px 10px', marginBottom: '6px',
        borderLeft: `3px solid ${isCustomer ? 'rgba(255,255,255,0.5)' : '#7c3aed'}`,
        borderRadius: '4px',
        backgroundColor: isCustomer ? 'rgba(255,255,255,0.12)' : '#f5f3ff',
        fontSize: '11px', lineHeight: '1.4',
      }}>
        <div style={{ fontWeight: 700, color: isCustomer ? 'rgba(255,255,255,0.85)' : '#7c3aed', marginBottom: '2px' }}>
          {replyName}
        </div>
        <div style={{ color: isCustomer ? 'rgba(255,255,255,0.7)' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {replyPreview}
        </div>
      </div>
    );
  };

  const renderAttachmentContent = () => {
    const url = attachment?.url ?? contentUrl;
    const fileName = attachment?.fileName ?? url.split('/').pop()?.split('?')[0] ?? 'file';
    const fileSize = attachment?.size;

    if (effectiveType === 'IMAGE') {
      return (
        <div style={{ cursor: 'pointer' }} onClick={() => onImageClick?.(url, fileName)}>
          <img src={url} alt={fileName} style={{ maxWidth: '220px', maxHeight: '180px', borderRadius: '12px', objectFit: 'cover', display: 'block' }} loading="lazy" />
        </div>
      );
    }
    if (effectiveType === 'VIDEO') {
      return <video src={url} controls style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '12px' }} preload="metadata" />;
    }
    if (effectiveType === 'AUDIO') {
      return (
        <audio src={url} controls preload="metadata" style={{
          width: '220px', height: '36px', borderRadius: '18px',
          filter: isCustomer ? 'invert(1) hue-rotate(180deg) brightness(1.2)' : 'none',
        }} />
      );
    }
    // Generic file
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '10px', backgroundColor: isCustomer ? 'rgba(255,255,255,0.15)' : '#f3f4f6', color: isCustomer ? '#fff' : '#5b4fcf', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
        {fileSize && <span style={{ fontSize: '10px', opacity: 0.6, flexShrink: 0 }}>{(fileSize / 1024).toFixed(0)}KB</span>}
      </a>
    );
  };

  // Audio messages get a compact, clean bubble without padding bloat
  const bubbleStyle: React.CSSProperties = isAudio
    ? {
        ...(isCustomer
          ? { background: `linear-gradient(135deg, ${styles.bubbleCustomer.background || '#5b4fcf'}, ${styles.bubbleCustomer.background || '#5b4fcf'}cc)`, borderRadius: '18px 18px 4px 18px' }
          : { background: '#ffffff', border: '1px solid #f0f0f5', borderRadius: '18px 18px 18px 4px' }),
        padding: '8px 10px', maxWidth: '78%', boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      }
    : (isCustomer ? styles.bubbleCustomer : styles.bubbleAgent);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-end' : 'flex-start', position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label && <div style={styles.senderLabel}>{label}</div>}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px', flexDirection: isCustomer ? 'row-reverse' : 'row' }}>
        <div style={bubbleStyle}>
          {renderReplyQuote()}
          {isAttachment ? renderAttachmentContent() : message.content}
          {!isAudio && <div style={{ ...styles.timestamp, textAlign: isCustomer ? 'right' : 'left' }}>{time}</div>}
        </div>
        {/* Reply button on hover */}
        {hovered && onReply && (
          <button
            onClick={() => onReply(message)}
            title="Reply"
            style={{
              background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '50%',
              width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#6b7280', flexShrink: 0, transition: 'all 0.15s', padding: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ede9fe'; (e.currentTarget as HTMLElement).style.color = '#5b4fcf'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
          </button>
        )}
      </div>
      {isAudio && <div style={{ ...styles.timestamp, textAlign: isCustomer ? 'right' : 'left', marginTop: '2px' }}>{time}</div>}
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
  const [viewerImage, setViewerImage]           = useState<{ url: string; fileName: string } | null>(null);
  const [isRecording, setIsRecording]           = useState(false);
  const [replyTarget, setReplyTarget]           = useState<ReplyTarget | null>(null);

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const messagesAreaRef  = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLInputElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasWelcomed      = useRef(false);
  const prevMsgCount     = useRef(0);
  const prevSoundCount   = useRef(0);

  // ── Scroll-up pagination state (mirrors agent dashboard ChatPanel) ────────
  const shouldScrollBottom     = useRef(true);
  const savedScrollHeightRef   = useRef(0);
  const prevMsgCountLayoutRef  = useRef(0);
  const maxScrollTopRef        = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

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
      @keyframes pulse-recording {
        0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}
        70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}
        100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}
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

  // ── Notification sound for new agent/bot messages ─────────────────────────
  // Mirror agent dashboard: only play sound when widget is NOT visible.
  // Uses its own ref (prevSoundCount) so the auto-switch effect above
  // doesn't swallow the check by updating prevMsgCount first.
  useEffect(() => {
    const newCount = state.messages.length;
    if (newCount > prevSoundCount.current) {
      const newMsgs = state.messages.slice(prevSoundCount.current);
      const hasAgentOrBotMsg = newMsgs.some(m => m.senderType === 'AGENT' || m.senderType === 'BOT');
      if (hasAgentOrBotMsg && !state.isWidgetOpen) {
        playNotificationSound();
      }
    }
    prevSoundCount.current = newCount;
  }, [state.messages.length, state.isWidgetOpen]);

  // ── Unlock audio on first user interaction ────────────────────────────────
  useEffect(() => {
    const unlock = () => { unlockAudio(); window.removeEventListener('click', unlock); };
    window.addEventListener('click', unlock);
    return () => window.removeEventListener('click', unlock);
  }, []);

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
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
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

  // ── Scroll restoration (useLayoutEffect — runs before paint) ──────────────
  // Mirror agent dashboard ChatPanel: when older messages are prepended, the
  // DOM height grows. We saved the OLD scrollHeight before triggering load;
  // here we shift scrollTop by the diff so the viewport stays in place.
  useLayoutEffect(() => {
    const el = messagesAreaRef.current;
    const msgCount = allMessages.length;

    if (
      el &&
      msgCount > prevMsgCountLayoutRef.current &&
      !shouldScrollBottom.current &&
      savedScrollHeightRef.current > 0
    ) {
      const diff = el.scrollHeight - savedScrollHeightRef.current;
      if (diff > 0) el.scrollTop = diff;
      savedScrollHeightRef.current = 0;
    }
    prevMsgCountLayoutRef.current = msgCount;
  }, [allMessages.length]);

  // ── Auto-scroll to bottom when new messages arrive (if user is at bottom) ─
  useEffect(() => {
    if (shouldScrollBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages.length, showTyping, state.isTyping]);

  // ── Scroll handler: detect scroll-up for pagination + show jump button ────
  const handleMessagesScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;

    // Track max scroll position user has reached
    if (el.scrollTop > maxScrollTopRef.current) {
      maxScrollTopRef.current = el.scrollTop;
    }

    // Is user near the bottom? (within 80px)
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = distanceFromBottom < 80;
    shouldScrollBottom.current = isAtBottom;
    setShowJumpToBottom(!isAtBottom);

    // Scroll-up pagination trigger: when user scrolls near top
    if (
      el.scrollTop < 60 &&
      maxScrollTopRef.current > 60 &&
      !state.loadingMore &&
      state.hasMore
    ) {
      savedScrollHeightRef.current = el.scrollHeight;
      shouldScrollBottom.current = false;
      actions.loadOlderMessages();
    }
  }, [state.loadingMore, state.hasMore, actions]);

  // ── Jump to bottom ────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    shouldScrollBottom.current = true;
    setShowJumpToBottom(false);
  }, []);

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
    if (!content || !stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      actionsRef.current.sendMessage(content, 'TEXT', replyTarget?.id);
      setInputValue('');
      setReplyTarget(null);
      actionsRef.current.stopTyping?.();
      if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
    } catch (err: any) {
      if (err?.message === 'TOKEN_EXPIRED') {
        console.warn('[Chat] Cannot send — token expired');
        return;
      }
      throw err;
    }
  }, [inputValue, flowStep, replyTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleAttachment = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || stateRef.current.tokenExpired) return;
    try {
      await actionsRef.current.sendAttachment(file);
    } catch (err: any) {
      console.error('[Chat] Attachment upload failed:', err);
    }
    e.target.value = '';
  }, []);

  // ── Audio recording ──────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes('webm') ? 'webm' : 'm4a';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: recorder.mimeType });
        try {
          await actionsRef.current.sendAttachment(file);
        } catch (err: any) {
          console.error('[Chat] Audio upload failed:', err);
        }
        setIsRecording(false);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error('[Chat] Microphone access denied:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    actionsRef.current.startTyping?.();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => actionsRef.current.stopTyping?.(), 2000);
  }, []);

  const subtitle = (() => {
    if (state.tokenExpired) return 'Session Expired';
    if (state.loading) return 'Connecting...';
    if (flowStep === 'escalating') return 'Connecting to agent...';
    if (state.session?.assignedAgentName && !looksLikeRawId(state.session.assignedAgentName)) {
      return `Chatting with ${state.session.assignedAgentName}`;
    }
    if (state.session?.mode === 'HUMAN') return 'Connected to agent';
    return 'AI Support · Online';
  })();

  const isClosed = state.session?.status === 'CLOSED';
  const canType  = !isClosed && !state.tokenExpired && state.connected && flowStep !== 'escalating';
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
  if (state.tokenExpired) {
    return (
      <div style={styles.widget}>
        <WidgetHeader onClose={onClose} styles={styles} subtitle="Session Expired" theme={theme} />
        <div style={styles.centeredBox}>
          <div style={{ fontSize: 40 }}>⏳</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Session Expired</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>Your session has expired. Please refresh the page to continue chatting.</div>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }
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
          <div style={{ ...styles.messages, position: 'relative' as const }} ref={messagesAreaRef} onScroll={handleMessagesScroll}>
            {/* Loading older messages spinner */}
            {state.loadingMore && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0 6px', gap: '8px' }}>
                <SpinnerIcon color={theme.primaryColor} size={16} />
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>Loading older messages…</span>
              </div>
            )}
            {/* Beginning of conversation marker */}
            {!state.hasMore && allMessages.length > 0 && !state.loadingMore && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0 12px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', backgroundColor: '#f3eeff', padding: '3px 12px', borderRadius: '10px' }}>
                  Beginning of conversation
                </span>
              </div>
            )}
            {allMessages.map(msg => (
              <div key={msg.id} style={{ animation: 'chatFadeIn 0.2s ease' }}>
                <MessageBubble message={msg} styles={styles} userName={config.user.name} onImageClick={(url, fileName) => setViewerImage({ url, fileName })} onReply={(m) => { setReplyTarget({ id: m.id, content: m.content, senderType: m.senderType, senderName: m.senderName }); inputRef.current?.focus(); }} allMessages={allMessages} />
              </div>
            ))}
            {(showTyping || state.isTyping) && <TypingIndicator styles={styles} />}
            <div ref={messagesEndRef} />
          </div>

          {/* Jump-to-bottom button — appears when user scrolls up */}
          {showJumpToBottom && (
            <div style={{ position: 'relative' as const, height: 0, zIndex: 10 }}>
              <button
                onClick={scrollToBottom}
                style={{
                  position: 'absolute', bottom: '8px', right: '16px',
                  width: '36px', height: '36px', borderRadius: '50%',
                  backgroundColor: '#ffffff', border: '1px solid #e5e7eb',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: theme.primaryColor, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = theme.primaryColor; (e.currentTarget as HTMLElement).style.color = '#ffffff'; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 14px ${theme.primaryColor}44`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.color = theme.primaryColor; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'; }}
                aria-label="Scroll to latest messages"
              >
                <ChevronDownIcon />
              </button>
            </div>
          )}

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
            <div style={{ flexShrink: 0 }}>
              {/* Reply banner */}
              {replyTarget && (
                <div style={{
                  padding: '8px 12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#f9fafb',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <div style={{
                    flex: 1, borderLeft: `3px solid ${theme.primaryColor}`, paddingLeft: '10px',
                    overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: theme.primaryColor, marginBottom: '1px' }}>
                      {replyTarget.senderType === 'CUSTOMER' ? 'You' : (replyTarget.senderName || 'Agent')}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {replyTarget.content?.length > 80 ? replyTarget.content.slice(0, 80) + '…' : replyTarget.content}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyTarget(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
                  >×</button>
                </div>
              )}
            <div style={styles.inputArea}>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={handleAttachment} />
              <button onClick={() => fileInputRef.current?.click()} disabled={!canType} title="Attach file" style={{ background: 'none', border: 'none', cursor: canType ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', opacity: canType ? 0.6 : 0.3 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              </button>
              {/* Audio record button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!canType}
                title={isRecording ? 'Stop recording' : 'Record audio'}
                style={{
                  background: isRecording ? '#ef4444' : 'none',
                  border: isRecording ? '2px solid #ef4444' : 'none',
                  borderRadius: '50%',
                  cursor: canType ? 'pointer' : 'not-allowed',
                  padding: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: canType ? (isRecording ? 1 : 0.6) : 0.3,
                  width: 28, height: 28,
                  animation: isRecording ? 'pulse-recording 1.5s ease-in-out infinite' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {isRecording ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                )}
              </button>
              <input
                ref={inputRef}
                type="text"
                placeholder={canType ? (isRecording ? '🔴 Recording audio...' : 'Type a message...') : 'Connecting...'}
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
            </div>
          )}
        </>
      )}

      {/* ── Image Viewer Modal ── */}
      {viewerImage && (
        <div
          onClick={() => setViewerImage(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setViewerImage(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
              width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 22, fontWeight: 700, backdropFilter: 'blur(4px)',
            }}
            aria-label="Close image viewer"
          >×</button>

          {/* Download button */}
          <a
            href={viewerImage.url}
            download={viewerImage.fileName}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 16, right: 68,
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
              width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', backdropFilter: 'blur(4px)', textDecoration: 'none',
            }}
            aria-label="Download image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>

          {/* Filename label */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 20, left: 16, right: 120,
              color: '#fff', fontSize: 13, fontWeight: 500, opacity: 0.8,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{viewerImage.fileName}</div>

          {/* Image */}
          <img
            src={viewerImage.url}
            alt={viewerImage.fileName}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '85vh',
              objectFit: 'contain', borderRadius: 8,
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              cursor: 'default',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ==========================================
// UnreadTracker — syncs isOpen into the reducer and reports state.unreadCount.
// All counting logic lives in the reducer (ADD_MESSAGE / SET_WIDGET_OPEN),
// exactly mirroring the agent dashboard's APPEND_MESSAGE / SELECT_SESSION pattern.
// ==========================================

function UnreadTracker({ isOpen, onUnreadChange }: {
  isOpen: boolean;
  onUnreadChange: (count: number) => void;
}) {
  const { state, actions } = useChat();

  // Mirror agent dashboard SELECT_SESSION: tell reducer when widget opens/closes.
  // The reducer zeroes unreadCount atomically when open becomes true.
  useEffect(() => {
    actions.setWidgetOpen(isOpen);
  }, [isOpen, actions]);

  // Propagate reducer's unreadCount to the parent badge whenever it changes.
  useEffect(() => {
    onUnreadChange(state.unreadCount);
  }, [state.unreadCount, onUnreadChange]);

  return null;
}

// ==========================================
// ChatWidget — public entry point
// ====================

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen]           = useState(defaultOpen);
  const [launchHover, setLaunchHover] = useState(false);
  const [chatKey, setChatKey]         = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const theme: FullTheme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);

  const handleStartNewChat = () => {
    // Increment key → unmounts ChatProvider → mounts fresh one → new WS session
    setChatKey(k => k + 1);
  };

  const handleUnreadChange = useCallback((count: number) => {
    setUnreadCount(count);
  }, []);

  return (
    <div style={styles.container}>
      {!isOpen && (
        <button
          style={{ ...styles.launcher, transform: launchHover ? 'scale(1.1)' : 'scale(1)', boxShadow: launchHover ? `0 6px 28px ${theme.primaryColor}77` : `0 4px 20px ${theme.primaryColor}44`, position: 'relative' as const }}
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setLaunchHover(true)}
          onMouseLeave={() => setLaunchHover(false)}
          aria-label="Open chat support"
        >
          <ChatIcon />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-4px',
              minWidth: '20px', height: '20px', borderRadius: '10px',
              backgroundColor: '#ef4444', color: '#ffffff',
              fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 5px',
              boxShadow: '0 2px 6px rgba(239,68,68,0.5)',
              border: '2px solid #ffffff',
              fontFamily: 'system-ui, sans-serif', lineHeight: 1,
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* key={chatKey} forces a full remount → creates a fresh session on Start New Chat */}
      <ChatProvider config={config} key={chatKey}>
        <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange} />
        <div style={{ display: isOpen ? 'block' : 'none' }}>
          <ChatContent onClose={() => setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} />
        </div>
      </ChatProvider>
    </div>
  );
}

export default ChatWidget;