
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



import React, {
  useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo,
} from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme } from './types';
import { playNotificationSound, unlockAudio } from './notificationSound';

// ─── Types ────────────────────────────────────────────────────────────────────

type FlowStep = 'welcome' | 'menu' | 'escalating' | 'free';

interface QuickReply { id: string; label: string; icon: string; }

interface ReplyTarget {
  id: string; content: string; senderType: string; senderName?: string;
}

const MAIN_MENU: QuickReply[] = [
  { id: 'order_details', icon: '📦', label: 'Check Order Details' },
  { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
  { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
  { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
];

// ─── Static CSS (injected once, never recreated) ──────────────────────────────

const STATIC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

  .cw-root * { box-sizing: border-box; }
  .cw-root { font-family: 'DM Sans', system-ui, sans-serif; }

  @keyframes cw-bounce {
    0%,80%,100%{ transform:translateY(0); opacity:.35; }
    40%{ transform:translateY(-5px); opacity:1; }
  }
  @keyframes cw-fadein {
    from{ opacity:0; transform:translateY(6px); }
    to  { opacity:1; transform:translateY(0); }
  }
  @keyframes cw-pulse-rec {
    0%  { box-shadow: 0 0 0 0   rgba(239,68,68,.5); }
    70% { box-shadow: 0 0 0 8px rgba(239,68,68,0);  }
    100%{ box-shadow: 0 0 0 0   rgba(239,68,68,0);  }
  }
  @keyframes cw-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes cw-launcher-pop {
    0%  { transform: scale(0.6); opacity: 0; }
    70% { transform: scale(1.08); }
    100%{ transform: scale(1);   opacity: 1; }
  }
  @keyframes cw-widget-slide {
    from{ opacity:0; transform: translateY(16px) scale(0.97); }
    to  { opacity:1; transform: translateY(0)    scale(1);    }
  }

  /* Widget shell */
  .cw-widget {
    width: 380px;
    height: 580px;
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(0,0,0,.06);
    animation: cw-widget-slide 0.25s cubic-bezier(.22,.68,0,1.2) both;
    /* ← NO will-change, no transform, so nothing forces GPU rasterisation every frame */
  }

  /* Header */
  .cw-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    flex-shrink: 0;
    background: var(--cw-primary);
    color: #fff;
  }
  .cw-header-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    background: rgba(255,255,255,.18);
    display: flex; align-items: center; justify-content: center;
    font-size: 19px; flex-shrink: 0;
  }
  .cw-header-info { flex: 1; overflow: hidden; }
  .cw-header-title { font-size: 15px; font-weight: 700; margin: 0; letter-spacing: -.015em; }
  .cw-header-sub {
    font-size: 11px; opacity: .85; margin: 2px 0 0;
    display: flex; align-items: center; gap: 5px;
  }
  .cw-online-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #4ade80; flex-shrink: 0;
    /* stable green dot — no animation */
  }
  .cw-close-btn {
    background: rgba(255,255,255,.14); border: none; color: #fff;
    cursor: pointer; padding: 7px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .cw-close-btn:hover { background: rgba(255,255,255,.28); }

  /* Message list */
  .cw-messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 14px 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #f7f7fb;
    /* smooth scrolling without jank */
    scroll-behavior: smooth;
    overscroll-behavior: contain;
  }
  /* thin, non-intrusive scrollbar */
  .cw-messages::-webkit-scrollbar { width: 4px; }
  .cw-messages::-webkit-scrollbar-track { background: transparent; }
  .cw-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

  /* Message rows */
  .cw-msg-row {
    display: flex;
    flex-direction: column;
    animation: cw-fadein .2s ease both;
    /* contain layout changes to this subtree */
    contain: layout style;
  }
  .cw-msg-row--customer { align-items: flex-end; }
  .cw-msg-row--agent    { align-items: flex-start; }
  .cw-msg-row--system   { align-items: center; }

  .cw-sender-label {
    font-size: 10px; color: #9ca3af; margin-bottom: 3px;
    padding-left: 2px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em;
  }

  /* Bubble pair (bubble + reply btn) */
  .cw-bubble-pair {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 82%;
  }
  .cw-msg-row--customer .cw-bubble-pair { flex-direction: row-reverse; }

  /* Bubbles */
  .cw-bubble {
    padding: 10px 14px;
    border-radius: 18px;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-line;
    /* use contain to prevent bubble reflow leaking upward */
    contain: content;
  }
  .cw-bubble--customer {
    background: var(--cw-primary);
    color: #fff;
    border-radius: 18px 18px 4px 18px;
    box-shadow: 0 2px 8px rgba(0,0,0,.12);
  }
  .cw-bubble--agent {
    background: #fff;
    color: #111827;
    border-radius: 18px 18px 18px 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.06);
    border: 1px solid #eff0f6;
  }
  .cw-bubble--system {
    background: #ede9fe;
    color: var(--cw-primary);
    font-size: 11px;
    font-weight: 600;
    padding: 5px 14px;
    border-radius: 20px;
  }

  .cw-bubble-ts {
    font-size: 10px;
    opacity: .48;
    margin-top: 5px;
  }
  .cw-msg-row--customer .cw-bubble-ts { text-align: right; }

  /* Reply button (on hover) */
  .cw-reply-btn {
    background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 50%;
    width: 26px; height: 26px; cursor: pointer;
    display: none; /* controlled by .cw-msg-row:hover */
    align-items: center; justify-content: center;
    color: #6b7280; flex-shrink: 0; padding: 0;
    transition: background .12s, color .12s;
  }
  .cw-reply-btn:hover { background: #ede9fe; color: var(--cw-primary); }
  .cw-msg-row:hover .cw-reply-btn { display: flex; }

  /* Reply quote inside bubble */
  .cw-reply-quote {
    padding: 6px 10px; margin-bottom: 6px;
    border-radius: 4px;
    font-size: 11px; line-height: 1.4;
  }
  .cw-reply-quote--customer {
    border-left: 3px solid rgba(255,255,255,.5);
    background: rgba(255,255,255,.12);
  }
  .cw-reply-quote--agent {
    border-left: 3px solid var(--cw-primary);
    background: #f5f3ff;
  }
  .cw-reply-quote-name {
    font-weight: 700; margin-bottom: 2px; font-size: 11px;
  }
  .cw-reply-quote-name--customer { color: rgba(255,255,255,.85); }
  .cw-reply-quote-name--agent    { color: var(--cw-primary); }
  .cw-reply-quote-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cw-reply-quote-text--customer { color: rgba(255,255,255,.7); }
  .cw-reply-quote-text--agent    { color: #6b7280; }

  /* Typing indicator */
  .cw-typing {
    display: flex; gap: 5px; align-items: center;
    background: #fff; padding: 12px 16px;
    border-radius: 18px 18px 18px 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.06);
    border: 1px solid #eff0f6;
    align-self: flex-start;
    /* fixed size prevents layout shift */
    width: fit-content;
  }
  .cw-typing-dot {
    width: 7px; height: 7px; background: #9ca3af; border-radius: 50%;
  }
  .cw-typing-dot:nth-child(1){ animation: cw-bounce 1.2s 0s   infinite ease-in-out; }
  .cw-typing-dot:nth-child(2){ animation: cw-bounce 1.2s .2s  infinite ease-in-out; }
  .cw-typing-dot:nth-child(3){ animation: cw-bounce 1.2s .4s  infinite ease-in-out; }

  /* Quick replies */
  .cw-qr-wrap {
    padding: 10px 13px 12px;
    display: flex; flex-direction: column; gap: 7px;
    background: #f7f7fb;
    border-top: 1px solid #ebebf5;
    flex-shrink: 0;
  }
  .cw-qr-label {
    font-size: 10px; color: #9ca3af; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
  }
  .cw-qr-btn {
    width: 100%; padding: 10px 14px; border-radius: 12px;
    border: 1.5px solid #e0d9ff; background: #fff;
    color: var(--cw-primary); cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: inherit;
    display: flex; align-items: center; gap: 8px;
    text-align: left; transition: background .12s, border-color .12s;
  }
  .cw-qr-btn:hover { background: #f0effe; border-color: var(--cw-primary); }

  /* Input area */
  .cw-input-area {
    padding: 10px 12px;
    border-top: 1px solid #ebebf5;
    display: flex; gap: 7px; align-items: center;
    background: #fff; flex-shrink: 0;
  }
  .cw-input {
    flex: 1; padding: 10px 14px; border-radius: 22px;
    border: 1.5px solid #e5e7eb;
    font-size: 14px; outline: none; font-family: inherit;
    background: #f9fafb; color: #111827;
    transition: border-color .18s;
  }
  .cw-input:focus { border-color: var(--cw-primary-40); }
  .cw-input:disabled { opacity: .55; cursor: not-allowed; }
  .cw-icon-btn {
    background: none; border: none;
    cursor: pointer; padding: 5px;
    display: flex; align-items: center; justify-content: center;
    opacity: .55; transition: opacity .15s;
    border-radius: 50%;
  }
  .cw-icon-btn:hover:not(:disabled) { opacity: 1; }
  .cw-icon-btn:disabled { opacity: .28; cursor: not-allowed; }
  .cw-record-btn {
    width: 30px; height: 30px; border-radius: 50%;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s, border .15s;
  }
  .cw-record-btn--idle { background: none; }
  .cw-record-btn--active {
    background: #ef4444;
    animation: cw-pulse-rec 1.5s ease-in-out infinite;
  }
  .cw-send-btn {
    width: 40px; height: 40px; border-radius: 50%; border: none;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; cursor: pointer;
    transition: box-shadow .15s, background .15s;
  }
  .cw-send-btn--active {
    background: var(--cw-primary);
    box-shadow: 0 3px 12px var(--cw-primary-40);
  }
  .cw-send-btn--inactive { background: #f3f4f6; cursor: not-allowed; }

  /* Reply banner above input */
  .cw-reply-banner {
    padding: 8px 12px;
    border-top: 1px solid #ebebf5;
    background: #f9fafb;
    display: flex; align-items: center; gap: 8px;
  }
  .cw-reply-banner-bar {
    flex: 1;
    border-left: 3px solid var(--cw-primary);
    padding-left: 10px; overflow: hidden;
  }
  .cw-reply-banner-name {
    font-size: 11px; font-weight: 700; color: var(--cw-primary); margin-bottom: 1px;
  }
  .cw-reply-banner-text {
    font-size: 12px; color: #6b7280;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cw-reply-banner-close {
    background: none; border: none; cursor: pointer;
    color: #9ca3af; font-size: 18px; line-height: 1;
    padding: 2px; flex-shrink: 0;
  }

  /* Escalating / centered screens */
  .cw-center-box {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px; padding: 32px; background: #f7f7fb; text-align: center;
  }
  .cw-esc-dots { display: flex; gap: 8px; }
  .cw-esc-dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--cw-primary);
  }
  .cw-esc-dot:nth-child(1){ animation: cw-bounce 1.2s 0s   infinite ease-in-out; }
  .cw-esc-dot:nth-child(2){ animation: cw-bounce 1.2s .2s  infinite ease-in-out; }
  .cw-esc-dot:nth-child(3){ animation: cw-bounce 1.2s .4s  infinite ease-in-out; }

  /* Pagination markers */
  .cw-load-more {
    display: flex; align-items: center; justify-content: center;
    padding: 8px 0 4px; gap: 8px;
  }
  .cw-spinner {
    width: 16px; height: 16px;
    border: 2.5px solid #e5e7eb;
    border-top-color: var(--cw-primary);
    border-radius: 50%;
    animation: cw-spin .7s linear infinite;
    flex-shrink: 0;
  }
  .cw-convo-start {
    display: flex; align-items: center; justify-content: center;
    padding: 6px 0 10px;
  }
  .cw-convo-start-label {
    font-size: 10px; font-weight: 600; color: #c4b5fd;
    background: #f3eeff; padding: 3px 12px; border-radius: 10px;
  }

  /* Jump-to-bottom button */
  .cw-jump-btn {
    position: absolute; bottom: 10px; right: 14px;
    width: 34px; height: 34px; border-radius: 50%;
    background: #fff; border: 1px solid #e5e7eb;
    box-shadow: 0 2px 8px rgba(0,0,0,.1);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: var(--cw-primary); transition: background .12s, color .12s;
    z-index: 10;
  }
  .cw-jump-btn:hover { background: var(--cw-primary); color: #fff; }

  /* Launcher */
  .cw-launcher {
    width: 56px; height: 56px; border-radius: 50%; border: none;
    background: var(--cw-primary);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 20px var(--cw-primary-40);
    transition: transform .2s, box-shadow .2s;
    position: relative;
    animation: cw-launcher-pop .3s cubic-bezier(.22,.68,0,1.3) both;
  }
  .cw-launcher:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 28px var(--cw-primary-55);
  }
  .cw-badge {
    position: absolute; top: -4px; right: -4px;
    min-width: 20px; height: 20px; border-radius: 10px;
    background: #ef4444; color: #fff;
    font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    padding: 0 5px; border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(239,68,68,.45);
    font-family: system-ui, sans-serif; line-height: 1;
  }

  /* Error banner */
  .cw-error-banner {
    margin: 8px 12px; padding: 10px 14px;
    background: #fef2f2; border: 1px solid #fecaca;
    border-radius: 10px; font-size: 12px; color: #dc2626;
    display: flex; align-items: center; gap: 8px;
  }

  /* Closed session */
  .cw-closed-footer {
    padding: 16px 14px 20px;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    border-top: 1px solid #ebebf5; background: #f7f7fb;
  }
  .cw-new-chat-btn {
    padding: 10px 24px; border-radius: 22px; border: none;
    background: var(--cw-primary); color: #fff;
    font-weight: 700; cursor: pointer; font-size: 13px; font-family: inherit;
    box-shadow: 0 3px 12px var(--cw-primary-40);
    transition: transform .15s, box-shadow .15s;
    letter-spacing: -.01em;
  }
  .cw-new-chat-btn:hover {
    transform: scale(1.04);
    box-shadow: 0 5px 18px var(--cw-primary-55);
  }

  /* Image viewer */
  .cw-viewer-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.86);
    z-index: 100000; display: flex; align-items: center; justify-content: center;
    cursor: zoom-out;
  }
  .cw-viewer-img {
    max-width: 90vw; max-height: 85vh; object-fit: contain;
    border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,.5); cursor: default;
  }
  .cw-viewer-btn {
    position: absolute; top: 16px;
    background: rgba(255,255,255,.15); border: none; border-radius: 50%;
    width: 40px; height: 40px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 22px; font-weight: 700;
    backdrop-filter: blur(4px);
  }
  .cw-viewer-close { right: 16px; }
  .cw-viewer-download { right: 66px; }
  .cw-viewer-name {
    position: absolute; top: 20px; left: 16px; right: 130px;
    color: #fff; font-size: 13px; font-weight: 500; opacity: .8;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Attachment: image */
  .cw-img-attach { max-width: 220px; max-height: 180px; border-radius: 12px; object-fit: cover; display: block; cursor: pointer; }
  .cw-video-attach { max-width: 240px; max-height: 180px; border-radius: 12px; }
  .cw-audio-attach { width: 220px; height: 36px; border-radius: 18px; }
  .cw-audio-attach--invert { filter: invert(1) hue-rotate(180deg) brightness(1.2); }
  .cw-file-attach {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-radius: 10px; font-size: 13px; font-weight: 600; text-decoration: none;
  }
  .cw-file-attach--customer { background: rgba(255,255,255,.15); color: #fff; }
  .cw-file-attach--agent    { background: #f3f4f6; color: var(--cw-primary); }

  /* Prose */
  .cw-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 0 0 6px; }
  .cw-sub   { font-size: 13px; color: #6b7280; line-height: 1.65; margin: 0; }
  .cw-primary-btn {
    padding: 10px 28px; border-radius: 22px; border: none;
    background: var(--cw-primary); color: #fff;
    font-weight: 700; cursor: pointer; font-size: 14px; font-family: inherit;
  }
  .cw-wait-pill {
    padding: 8px 20px; border-radius: 20px;
    background: #ede9fe; color: var(--cw-primary);
    font-size: 12px; font-weight: 700;
  }
`;

// ─── Inject CSS once ──────────────────────────────────────────────────────────

function injectCSS(primaryColor: string) {
  const id = 'cw-styles';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  // Build alpha variants from primary
  const hex = primaryColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  el.textContent = `
    :root {
      --cw-primary: ${primaryColor};
      --cw-primary-40: rgba(${r},${g},${b},.40);
      --cw-primary-55: rgba(${r},${g},${b},.55);
    }
    ${STATIC_CSS}
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeRawId(s?: string) {
  if (!s) return false;
  return /^[0-9a-fA-F-]{20,}$/.test(s);
}

function fmtTime(ts: Date | string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const ChatIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" />
    <circle cx="8"  cy="10" r="1" fill="rgba(255,255,255,.5)" />
    <circle cx="12" cy="10" r="1" fill="rgba(255,255,255,.5)" />
    <circle cx="16" cy="10" r="1" fill="rgba(255,255,255,.5)" />
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

const ChevronDown = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ReplyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>
  </svg>
);

const AttachIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
  </svg>
);

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="1" width="6" height="11" rx="3"/>
    <path d="M19 10v1a7 7 0 01-14 0v-1"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
);

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

const TypingIndicator = React.memo(() => (
  <div className="cw-typing">
    <div className="cw-typing-dot" />
    <div className="cw-typing-dot" />
    <div className="cw-typing-dot" />
  </div>
));

const WidgetHeader = React.memo(({ onClose, subtitle }: {
  onClose: () => void; subtitle: string;
}) => (
  <div className="cw-header">
    <div className="cw-header-avatar">💬</div>
    <div className="cw-header-info">
      <h3 className="cw-header-title">Chat Support</h3>
      <div className="cw-header-sub">
        <span className="cw-online-dot" />
        {subtitle}
      </div>
    </div>
    <button className="cw-close-btn" onClick={onClose} aria-label="Close chat">
      <CloseIcon />
    </button>
  </div>
));

const EscalatingScreen = React.memo(() => (
  <div className="cw-center-box">
    <div style={{ fontSize: 52 }}>👤</div>
    <div>
      <p className="cw-title">Connecting you to an agent</p>
      <p className="cw-sub">You've been added to the support queue.<br />An agent will join shortly.</p>
    </div>
    <div className="cw-esc-dots">
      <div className="cw-esc-dot" />
      <div className="cw-esc-dot" />
      <div className="cw-esc-dot" />
    </div>
    <div className="cw-wait-pill">Est. wait: &lt; 2 min</div>
  </div>
));

// ─── Message bubble ───────────────────────────────────────────────────────────

interface MsgBubbleProps {
  message: ChatMessage;
  onImageClick: (url: string, name: string) => void;
  onReply: (msg: ChatMessage) => void;
  allMessages: ChatMessage[];
}

const MessageBubble = React.memo(({ message, onImageClick, onReply, allMessages }: MsgBubbleProps) => {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isSystem   = message.senderType === 'SYSTEM';
  const isBot      = message.senderType === 'BOT';

  // Drop raw-ID system messages
  if (isSystem && looksLikeRawId(message.content?.trim())) return null;
  if (isSystem) return (
    <div className="cw-msg-row cw-msg-row--system">
      <div className="cw-bubble cw-bubble--system">{message.content}</div>
    </div>
  );

  const rawName   = message.senderName;
  const agentLabel = (rawName && !looksLikeRawId(rawName)) ? rawName : 'Agent';
  const label = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

  // Attachment resolution
  const attachment = message.attachment ?? (message.metadata?.attachment as any) ?? null;
  const contentUrl = message.content ?? '';
  const isCdn      = /^https?:\/\/cdn\./.test(contentUrl);

  let effectiveType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null = null;
  if      (message.messageType === 'IMAGE' || attachment?.mimeType?.startsWith('image/') || (isCdn && /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(contentUrl))) effectiveType = 'IMAGE';
  else if (message.messageType === 'VIDEO' || attachment?.mimeType?.startsWith('video/') || (isCdn && /\.(mp4|webm|mov)(\?.*)?$/i.test(contentUrl)))   effectiveType = 'VIDEO';
  else if (message.messageType === 'AUDIO' || attachment?.mimeType?.startsWith('audio/') || (isCdn && /\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(contentUrl))) effectiveType = 'AUDIO';
  else if (message.messageType === 'FILE'  || attachment) effectiveType = 'FILE';

  const isAudio = effectiveType === 'AUDIO';

  // Reply-to quote
  const replyTo = message.replyToMessage ?? (message.replyToMessageId
    ? allMessages.find(m => m.id === message.replyToMessageId) ?? null
    : null);

  const replyQuote = replyTo ? (() => {
    const replyName = replyTo.senderType === 'CUSTOMER' ? 'You'
      : (replyTo as any).senderName ?? (replyTo.senderType === 'BOT' ? 'AI Assistant' : 'Agent');
    const isMedia = ['IMAGE','VIDEO','AUDIO','FILE'].includes(replyTo.messageType);
    const preview = isMedia
      ? `📎 ${replyTo.messageType.charAt(0) + replyTo.messageType.slice(1).toLowerCase()}`
      : (replyTo.content?.length > 60 ? replyTo.content.slice(0, 60) + '…' : replyTo.content);
    const variant = isCustomer ? 'customer' : 'agent';
    return (
      <div className={`cw-reply-quote cw-reply-quote--${variant}`}>
        <div className={`cw-reply-quote-name cw-reply-quote-name--${variant}`}>{replyName}</div>
        <div className={`cw-reply-quote-text cw-reply-quote-text--${variant}`}>{preview}</div>
      </div>
    );
  })() : null;

  // Attachment content
  const attachContent = (() => {
    if (!effectiveType) return null;
    const url      = attachment?.url ?? contentUrl;
    const fileName = attachment?.fileName ?? url.split('/').pop()?.split('?')[0] ?? 'file';
    const fileSize = attachment?.size;
    if (effectiveType === 'IMAGE') return (
      <img src={url} alt={fileName} className="cw-img-attach" loading="lazy"
        onClick={() => onImageClick(url, fileName)} />
    );
    if (effectiveType === 'VIDEO') return (
      <video src={url} controls className="cw-video-attach" preload="metadata" />
    );
    if (effectiveType === 'AUDIO') return (
      <audio src={url} controls preload="metadata"
        className={`cw-audio-attach${isCustomer ? ' cw-audio-attach--invert' : ''}`} />
    );
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className={`cw-file-attach cw-file-attach--${isCustomer ? 'customer' : 'agent'}`}>
        <AttachIcon />
        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
        {fileSize && <span style={{ fontSize: 10, opacity: .6 }}>{(fileSize / 1024).toFixed(0)}KB</span>}
      </a>
    );
  })();

  const bubbleClass = `cw-bubble cw-bubble--${isCustomer ? 'customer' : 'agent'}`;
  const rowClass    = `cw-msg-row cw-msg-row--${isCustomer ? 'customer' : 'agent'}`;

  return (
    <div className={rowClass}>
      {label && <div className="cw-sender-label">{label}</div>}
      <div className="cw-bubble-pair">
        <div className={bubbleClass}>
          {replyQuote}
          {attachContent ?? message.content}
          {!isAudio && (
            <div className="cw-bubble-ts">{fmtTime(message.timestamp)}</div>
          )}
        </div>
        <button className="cw-reply-btn" onClick={() => onReply(message)} title="Reply">
          <ReplyIcon />
        </button>
      </div>
      {isAudio && <div className="cw-bubble-ts">{fmtTime(message.timestamp)}</div>}
    </div>
  );
});

// ─── Quick replies ────────────────────────────────────────────────────────────

const QuickReplies = React.memo(({ replies, onSelect }: {
  replies: QuickReply[]; onSelect: (r: QuickReply) => void;
}) => (
  <div className="cw-qr-wrap">
    <div className="cw-qr-label">Choose an option</div>
    {replies.map(r => (
      <button key={r.id} className="cw-qr-btn" onClick={() => onSelect(r)}>
        <span style={{ fontSize: 16 }}>{r.icon}</span>
        <span>{r.label}</span>
      </button>
    ))}
  </div>
));

// ─── ChatContent ──────────────────────────────────────────────────────────────

export function ChatContent({ onClose, config, onStartNewChat }: {
  onClose: () => void;
  config: ChatSDKConfig;
  onStartNewChat?: () => void;
}): JSX.Element {
  const { state, actions } = useChat();
  const primaryColor = config.theme?.primaryColor ?? '#5b4fcf';

  const [inputValue, setInputValue]       = useState('');
  const [flowStep, setFlowStep]           = useState<FlowStep>('welcome');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [showTyping, setShowTyping]       = useState(false);
  const [showQR, setShowQR]               = useState(false);
  const [escalationError, setEscalationError] = useState<string | null>(null);
  const [viewerImage, setViewerImage]     = useState<{ url: string; fileName: string } | null>(null);
  const [isRecording, setIsRecording]     = useState(false);
  const [replyTarget, setReplyTarget]     = useState<ReplyTarget | null>(null);
  const [showJumpBtn, setShowJumpBtn]     = useState(false);

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const mediaRecRef     = useRef<MediaRecorder | null>(null);
  const audioChunksRef  = useRef<Blob[]>([]);
  const typingTimerRef  = useRef<ReturnType<typeof setTimeout>>();
  const hasWelcomed     = useRef(false);
  const prevMsgCount    = useRef(0);
  const prevSoundCount  = useRef(0);

  // Scroll state (no useState → no re-renders)
  const shouldScrollBottom   = useRef(true);
  const savedScrollHeightRef = useRef(0);
  const prevMsgLayoutRef     = useRef(0);
  const maxScrollTopRef      = useRef(0);

  // Stable refs
  const stateRef   = useRef(state);
  const actionsRef = useRef(actions);
  const configRef  = useRef(config);
  const botReplyRefFn = useRef<(c: string, d?: number) => Promise<void>>();

  useEffect(() => { stateRef.current   = state;   }, [state]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { configRef.current  = config;  }, [config]);

  // Inject CSS once per primary colour change
  useEffect(() => { injectCSS(primaryColor); }, [primaryColor]);

  // ── Stable addLocal ──
  const addLocal = useCallback((
    msg: Omit<ChatMessage,'id'|'timestamp'|'chatSessionId'|'messageType'> &
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
  }, []);

  // ── Stable botReply ──
  const botReply = useCallback((content: string, delay = 800): Promise<void> => {
    setShowTyping(true);
    return new Promise(resolve => {
      setTimeout(() => {
        setShowTyping(false);
        addLocal({ senderType: 'BOT', senderId: 'bot', senderName: 'AI Assistant', content });
        resolve();
      }, delay);
    });
  }, [addLocal]);

  useEffect(() => { botReplyRefFn.current = botReply; }, [botReply]);

  // ── Welcome flow ──
  useEffect(() => {
    if (!state.connected || state.loading) return;
    if (hasWelcomed.current) return;
    hasWelcomed.current = true;

    const sess = stateRef.current.session;
    const msgs = stateRef.current.messages;

    if (
      sess?.status === 'ASSIGNED' ||
      sess?.status === 'WAITING_FOR_AGENT' ||
      sess?.mode === 'HUMAN'
    ) { setFlowStep('free'); return; }

    const hasRealHistory =
      msgs.some(m => m.senderType === 'CUSTOMER') ||
      msgs.some(m => m.senderType === 'AGENT');

    if (hasRealHistory) { setFlowStep('free'); return; }

    setTimeout(async () => {
      await botReplyRefFn.current!('👋 Hello! Welcome to Support. How can I help you today?', 700);
      setFlowStep('menu');
      setShowQR(true);
    }, 300);
  }, [state.connected, state.loading]);

  // Auto-focus
  useEffect(() => {
    if (flowStep === 'free') inputRef.current?.focus();
  }, [flowStep]);

  // Switch to free when agent joins
  useEffect(() => {
    const newCount = state.messages.length;
    if (newCount > prevMsgCount.current) {
      const newMsgs = state.messages.slice(prevMsgCount.current);
      if (newMsgs.some(m => m.senderType === 'AGENT') && flowStep !== 'free') {
        setFlowStep('free');
        setShowQR(false);
      }
    }
    prevMsgCount.current = newCount;
  }, [state.messages, flowStep]);

  // Notification sound
  useEffect(() => {
    const newCount = state.messages.length;
    if (newCount > prevSoundCount.current) {
      const newMsgs = state.messages.slice(prevSoundCount.current);
      if (newMsgs.some(m => m.senderType === 'AGENT' || m.senderType === 'BOT') && !state.isWidgetOpen) {
        playNotificationSound();
      }
    }
    prevSoundCount.current = newCount;
  }, [state.messages.length, state.isWidgetOpen]);

  // Unlock audio
  useEffect(() => {
    const h = () => { unlockAudio(); window.removeEventListener('click', h); };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  // ── Merged messages ──
  const allMessages = useMemo(() => {
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

  // ── Scroll restoration (before paint) ──
  useLayoutEffect(() => {
    const el = messagesAreaRef.current;
    const cnt = allMessages.length;
    if (el && cnt > prevMsgLayoutRef.current && !shouldScrollBottom.current && savedScrollHeightRef.current > 0) {
      const diff = el.scrollHeight - savedScrollHeightRef.current;
      if (diff > 0) el.scrollTop = diff;
      savedScrollHeightRef.current = 0;
    }
    prevMsgLayoutRef.current = cnt;
  }, [allMessages.length]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (shouldScrollBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages.length, showTyping, state.isTyping]);

  // ── Scroll handler ──
  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    if (el.scrollTop > maxScrollTopRef.current) maxScrollTopRef.current = el.scrollTop;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < 80;
    shouldScrollBottom.current = atBottom;
    setShowJumpBtn(!atBottom);

    if (el.scrollTop < 60 && maxScrollTopRef.current > 60 && !state.loadingMore && state.hasMore) {
      savedScrollHeightRef.current = el.scrollHeight;
      shouldScrollBottom.current = false;
      actions.loadOlderMessages();
    }
  }, [state.loadingMore, state.hasMore, actions]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    shouldScrollBottom.current = true;
    setShowJumpBtn(false);
  }, []);

  // ── Helpers ──
  const waitForSession = useCallback((): Promise<string> => new Promise((res, rej) => {
    if (stateRef.current.session?.id) { res(stateRef.current.session.id); return; }
    let elapsed = 0;
    const t = setInterval(() => {
      elapsed += 200;
      const id = stateRef.current.session?.id;
      if (id) { clearInterval(t); res(id); }
      else if (elapsed >= 8000) { clearInterval(t); rej(new Error('Session not ready — please try again')); }
    }, 200);
  }), []);

  const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/api/v1/chat/sessions/${sessionId}/escalate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
    } catch (e) { console.warn('[Chat] REST escalation failed:', e); }
    actionsRef.current.requestAgent?.(reason);
  }, []);

  // ── Quick reply handler ──
  const handleQuickReply = useCallback(async (reply: QuickReply) => {
    setShowQR(false);
    setEscalationError(null);
    addLocal({ senderType: 'CUSTOMER', senderId: configRef.current.user.id, senderName: configRef.current.user.name, content: reply.label });

    switch (reply.id) {
      case 'order_details':
        await botReply('Sure! Let me pull up your recent orders.', 800);
        await botReply('📦 Order #ORD-2024-1847\nStatus: Delivered ✅\nDate: Feb 10, 2026\nItems: 2x Wireless Headphones\n\n📦 Order #ORD-2024-1831\nStatus: In Transit 🚚\nEst. Delivery: Feb 18, 2026\nItems: 1x Smart Watch', 1400);
        await botReply('Is there anything else I can help you with?', 900);
        setFlowStep('menu'); setShowQR(true); break;

      case 'track_order':
        await botReply('🔍 Fetching tracking info for your latest order...', 800);
        await botReply('📍 Order #ORD-2024-1831 — Live Tracking:\n\n✅ Order Placed — Feb 8, 10:22 AM\n✅ Dispatched from Warehouse — Feb 12, 3:45 PM\n✅ In Transit (Mumbai Hub) — Feb 14, 8:10 AM\n🔄 Out for Delivery — Expected Feb 18', 1600);
        await botReply('Need anything else?', 800);
        setFlowStep('menu'); setShowQR(true); break;

      case 'faq':
        await botReply('📚 Here are answers to common questions:', 800);
        await botReply('🔄 How do I return an item?\nGo to Orders → Select item → Return Request\n\n💰 When will I get my refund?\n5-7 business days after we receive the item\n\n📍 How do I change delivery address?\nProfile → Addresses → Edit (before dispatch only)', 1500);
        await botReply('Still need help?', 700);
        setFlowStep('menu'); setShowQR(true); break;

      case 'human': {
        setFlowStep('escalating');
        await botReply("I'll connect you with a human agent right away. Please hold on!", 800);
        try {
          const sid = await waitForSession();
          await escalateToAgent(sid, 'Customer requested human agent');
          addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '🟢 You are now in the agent queue. An agent will join shortly.' });
          setFlowStep('free');
        } catch (err: any) {
          setEscalationError(err?.message ?? 'Could not connect. Please try again.');
          addLocal({ senderType: 'SYSTEM', senderId: 'system', content: '⚠️ Could not connect to an agent. Please try again.' });
          setFlowStep('menu');
          setTimeout(() => setShowQR(true), 500);
        }
        break;
      }
    }
  }, [addLocal, botReply, waitForSession, escalateToAgent]);

  // ── Send ──
  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      actionsRef.current.sendMessage(content, 'TEXT', replyTarget?.id);
      setInputValue('');
      setReplyTarget(null);
      actionsRef.current.stopTyping?.();
      if (flowStep !== 'free') { setShowQR(false); setFlowStep('free'); }
    } catch (err: any) {
      if (err?.message !== 'TOKEN_EXPIRED') throw err;
    }
  }, [inputValue, flowStep, replyTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleAttachment = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || stateRef.current.tokenExpired) return;
    try { await actionsRef.current.sendAttachment(file); } catch {}
    e.target.value = '';
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec      = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType });
        const ext  = rec.mimeType.includes('webm') ? 'webm' : 'm4a';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: rec.mimeType });
        try { await actionsRef.current.sendAttachment(file); } catch {}
        setIsRecording(false);
      };
      rec.start();
      mediaRecRef.current = rec;
      setIsRecording(true);
    } catch { /* mic denied */ }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    actionsRef.current.startTyping?.();
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => actionsRef.current.stopTyping?.(), 2000);
  }, []);

  // ── Derived ──
  const subtitle = (() => {
    if (state.tokenExpired) return 'Session Expired';
    if (state.loading) return 'Connecting...';
    if (flowStep === 'escalating') return 'Connecting to agent...';
    const agentName = state.session?.assignedAgentName;
    if (agentName && !looksLikeRawId(agentName)) return `Chatting with ${agentName}`;
    if (state.session?.mode === 'HUMAN') return 'Connected to agent';
    return 'AI Support · Online';
  })();

  const isClosed = state.session?.status === 'CLOSED';
  const canType  = !isClosed && !state.tokenExpired && state.connected && flowStep !== 'escalating';
  const isActive = !!inputValue.trim() && canType;

  // ── Loading state ──
  if (state.loading) return (
    <div className="cw-widget">
      <WidgetHeader onClose={onClose} subtitle="Connecting..." />
      <div className="cw-center-box">
        <div className="cw-spinner" style={{ width: 36, height: 36, borderWidth: 3.5 }} />
        <span style={{ fontSize: 13, color: '#9ca3af' }}>Starting chat...</span>
      </div>
    </div>
  );

  // ── Token expired ──
  if (state.tokenExpired) return (
    <div className="cw-widget">
      <WidgetHeader onClose={onClose} subtitle="Session Expired" />
      <div className="cw-center-box">
        <div style={{ fontSize: 40 }}>⏳</div>
        <div><p className="cw-title">Session Expired</p><p className="cw-sub">Your session has expired. Please refresh the page to continue chatting.</p></div>
        <button className="cw-primary-btn" onClick={() => window.location.reload()}>Refresh Page</button>
      </div>
    </div>
  );

  // ── Connection error ──
  if (state.error && !state.connected) return (
    <div className="cw-widget">
      <WidgetHeader onClose={onClose} subtitle="Disconnected" />
      <div className="cw-center-box">
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div><p className="cw-title">Connection Lost</p><p className="cw-sub">{state.error.message}</p></div>
        <button className="cw-primary-btn" onClick={() => actionsRef.current.reconnect?.()}>Retry</button>
      </div>
    </div>
  );

  // ── Main ──
  return (
    <div className="cw-widget">
      <WidgetHeader onClose={onClose} subtitle={subtitle} />

      {flowStep === 'escalating' ? <EscalatingScreen /> : (
        <>
          {/* Messages area — position:relative so jump button can anchor to it */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <div className="cw-messages" ref={messagesAreaRef} onScroll={handleScroll}>
              {state.loadingMore && (
                <div className="cw-load-more">
                  <div className="cw-spinner" />
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Loading older messages…</span>
                </div>
              )}
              {!state.hasMore && allMessages.length > 0 && !state.loadingMore && (
                <div className="cw-convo-start">
                  <span className="cw-convo-start-label">Beginning of conversation</span>
                </div>
              )}
              {allMessages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onImageClick={(url, name) => setViewerImage({ url, fileName: name })}
                  onReply={m => { setReplyTarget({ id: m.id, content: m.content, senderType: m.senderType, senderName: m.senderName }); inputRef.current?.focus(); }}
                  allMessages={allMessages}
                />
              ))}
              {(showTyping || state.isTyping) && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {showJumpBtn && (
              <button className="cw-jump-btn" onClick={scrollToBottom} aria-label="Scroll to latest">
                <ChevronDown />
              </button>
            )}
          </div>

          {escalationError && (
            <div className="cw-error-banner">
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{escalationError}</span>
              <button onClick={() => setEscalationError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          )}

          {showQR && flowStep === 'menu' && (
            <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} />
          )}

          {isClosed ? (
            <div className="cw-closed-footer">
              <div style={{ fontSize: 28 }}>✅</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat Ended</div>
                <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This session has been closed.<br />Need more help?</div>
              </div>
              {onStartNewChat && (
                <button className="cw-new-chat-btn" onClick={onStartNewChat}>+ Start New Chat</button>
              )}
            </div>
          ) : (
            <div style={{ flexShrink: 0 }}>
              {replyTarget && (
                <div className="cw-reply-banner">
                  <div className="cw-reply-banner-bar">
                    <div className="cw-reply-banner-name">
                      {replyTarget.senderType === 'CUSTOMER' ? 'You' : (replyTarget.senderName || 'Agent')}
                    </div>
                    <div className="cw-reply-banner-text">
                      {replyTarget.content?.length > 80 ? replyTarget.content.slice(0, 80) + '…' : replyTarget.content}
                    </div>
                  </div>
                  <button className="cw-reply-banner-close" onClick={() => setReplyTarget(null)}>×</button>
                </div>
              )}
              <div className="cw-input-area">
                <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"
                  onChange={handleAttachment} />
                <button className="cw-icon-btn" disabled={!canType} title="Attach file"
                  onClick={() => fileInputRef.current?.click()}>
                  <AttachIcon />
                </button>
                <button
                  className={`cw-record-btn cw-record-btn--${isRecording ? 'active' : 'idle'}`}
                  disabled={!canType}
                  title={isRecording ? 'Stop recording' : 'Record audio'}
                  onClick={isRecording ? stopRecording : startRecording}
                  style={{ opacity: canType ? (isRecording ? 1 : 0.55) : 0.28 }}
                >
                  {isRecording ? <StopIcon /> : <MicIcon />}
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  className="cw-input"
                  placeholder={canType ? (isRecording ? '🔴 Recording audio...' : 'Type a message...') : 'Connecting...'}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={!canType}
                />
                <button
                  className={`cw-send-btn cw-send-btn--${isActive ? 'active' : 'inactive'}`}
                  onClick={handleSend}
                  disabled={!isActive}
                >
                  <SendIcon active={isActive} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Image viewer */}
      {viewerImage && (
        <div className="cw-viewer-overlay" onClick={() => setViewerImage(null)}>
          <button className="cw-viewer-btn cw-viewer-close" onClick={() => setViewerImage(null)}>×</button>
          <a className="cw-viewer-btn cw-viewer-download" href={viewerImage.url}
            download={viewerImage.fileName} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}><DownloadIcon /></a>
          <div className="cw-viewer-name" onClick={e => e.stopPropagation()}>{viewerImage.fileName}</div>
          <img src={viewerImage.url} alt={viewerImage.fileName} className="cw-viewer-img"
            onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ─── UnreadTracker ────────────────────────────────────────────────────────────

function UnreadTracker({ isOpen, onUnreadChange }: {
  isOpen: boolean; onUnreadChange: (n: number) => void;
}) {
  const { state, actions } = useChat();
  useEffect(() => { actions.setWidgetOpen(isOpen); }, [isOpen, actions]);
  useEffect(() => { onUnreadChange(state.unreadCount); }, [state.unreadCount, onUnreadChange]);
  return null;
}

// ─── ChatWidget (public entry) ────────────────────────────────────────────────

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen]         = useState(defaultOpen);
  const [chatKey, setChatKey]       = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const primaryColor = config.theme?.primaryColor ?? '#5b4fcf';
  const isRight = (config.theme?.position as string) !== 'bottom-left';

  // Inject CSS on mount
  useEffect(() => { injectCSS(primaryColor); }, [primaryColor]);

  const handleUnreadChange = useCallback((n: number) => setUnreadCount(n), []);

  return (
    <div className="cw-root" style={{
      position: 'fixed',
      bottom: 24,
      [isRight ? 'right' : 'left']: 24,
      zIndex: 9999,
    }}>
      {!isOpen && (
        <button className="cw-launcher" onClick={() => setIsOpen(true)} aria-label="Open chat support">
          <ChatIcon />
          {unreadCount > 0 && (
            <span className="cw-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>
      )}

      <ChatProvider config={config} key={chatKey}>
        <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange} />
        {isOpen && (
          <ChatContent
            onClose={() => setIsOpen(false)}
            config={config}
            onStartNewChat={() => setChatKey(k => k + 1)}
          />
        )}
      </ChatProvider>
    </div>
  );
}

export default ChatWidget;