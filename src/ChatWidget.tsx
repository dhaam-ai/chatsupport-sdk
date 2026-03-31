

// // ═══════════════════════════════════════════════════════════════════
// // ChatWidget.tsx  ·  PATCHED BUILD  ·  v2026-03-20-menu-fix
// // Changes vs previous:
// //   - Removed dummy welcome bot message (backend sends its own)
// //   - flowStep starts at 'menu', not 'welcome'
// //   - Removed localMessages / botReply — no fake data shown
// //   - Menu options (order_details, track_order) → sendRealMessage()
// //   - faq option → shows FAQ screen; each FAQ item → sendRealMessage()
// //   - human option → escalation flow unchanged
// // ═══════════════════════════════════════════════════════════════════
// import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
// import { ChatProvider, useChat } from './context';
// import type { ChatSDKConfig, ChatMessage, ChatTheme, ChatSessionSummary } from './types';
// import { playNotificationSound, unlockAudio } from './notificationSound';
// import { buildTickMap, MessageTicks, type TickStatus } from './Messageticks';

// // ==========================================
// // Flow Types
// // ==========================================

// // 'menu'      → show quick-reply menu below messages
// // 'faq'       → show FAQ list panel (replaces quick-replies slot)
// // 'escalating'→ connecting to agent screen
// // 'free'      → normal free-text chat
// type FlowStep = 'menu' | 'faq' | 'escalating' | 'free';

// interface QuickReply { id: string; label: string; icon: string; }
// interface ReplyTarget { id: string; content: string; senderType: string; senderName?: string; }

// const MAIN_MENU: QuickReply[] = [
//   { id: 'order_details', icon: '📦', label: 'Check Order Details' },
//   { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
//   { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
//   { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
// ];

// // FAQ items — clicking any of them sends the label to the AI agent as a message
// const FAQ_ITEMS: QuickReply[] = [
//   { id: 'faq_return',   icon: '🔄', label: 'How do I return an item?' },
//   { id: 'faq_refund',   icon: '💰', label: 'When will I get my refund?' },
//   { id: 'faq_address',  icon: '📍', label: 'How do I change my delivery address?' },
//   { id: 'faq_cancel',   icon: '❌', label: 'How do I cancel my order?' },
//   { id: 'faq_track',    icon: '🚚', label: 'How do I track my order?' },
//   { id: 'faq_payment',  icon: '💳', label: 'What payment methods are accepted?' },
//   { id: 'faq_contact',  icon: '📞', label: 'How do I contact support?' },
// ];

// // ==========================================
// // Theme
// // ==========================================

// const defaultTheme = {
//   primaryColor:        '#5b4fcf',
//   headerBackground:    '#5b4fcf',
//   headerText:          '#ffffff',
//   customerBubbleColor: '#5b4fcf',
//   agentBubbleColor:    '#f0effe',
//   fontFamily:          '"Outfit", "DM Sans", system-ui, sans-serif',
//   borderRadius:        '16px',
//   position:            'bottom-right' as 'bottom-right' | 'bottom-left',
// };
// type FullTheme = typeof defaultTheme;

// function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
//   const t: FullTheme = { ...defaultTheme, ...theme };
//   const isRight = (t.position as string) !== 'bottom-left';
//   return {
//     container:         { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
//     launcher:          { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
//     widget:            { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
//     header:            { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
//     headerAvatar:      { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
//     headerInfo:        { flex: 1 },
//     headerTitle:       { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
//     headerSub:         { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
//     onlineDot:         { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
//     closeBtn:          { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
//     messages:          { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
//     bubbleCustomer:    { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
//     bubbleAgent:       { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
//     bubbleSystem:      { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
//     senderLabel:       { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
//     timestamp:         { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
//     typingWrap:        { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
//     typingDot:         { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
//     inputArea:         { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0, position: 'relative' as const },
//     input:             { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
//     sendBtn:           { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
//     centeredBox:       { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
//   };
// }

// // ==========================================
// // Icons
// // ==========================================

// const ChatIcon = () => (
//   <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
//     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" opacity="0.95" />
//     <circle cx="8" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
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
// const BackIcon = () => (
//   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
//     <polyline points="15 18 9 12 15 6" />
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
// const PhoneDownIcon = () => (
//   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
//     <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-3.33"/>
//     <line x1="1" y1="1" x2="23" y2="23"/>
//   </svg>
// );

// // ==========================================
// // Helpers
// // ==========================================

// function looksLikeRawId(s: string | undefined): boolean {
//   if (!s) return false;
//   return /^[0-9a-fA-F-]{20,}$/.test(s);
// }
// function formatTime(date: Date | string): string {
//   return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
// }

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

// const CompactAudioPlayer = React.memo(function CompactAudioPlayer({ src, isCustomer }: { src: string; isCustomer: boolean }) {
//   const audioRef = useRef<HTMLAudioElement>(null);
//   const [playing, setPlaying]   = React.useState(false);
//   const [progress, setProgress] = React.useState(0);
//   const [duration, setDuration] = React.useState(0);
//   const [current, setCurrent]   = React.useState(0);
//   const toggle = () => { const a = audioRef.current; if (!a) return; playing ? a.pause() : a.play(); };
//   const fmt = (s: number) => (!isFinite(s) || isNaN(s)) ? '0:00' : `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
//   const accent  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';
//   const trackBg = isCustomer ? 'rgba(255,255,255,0.25)' : '#e5e7eb';
//   const fillBg  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';
//   return (
//     <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '210px', height: '40px' }}>
//       <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }}
//         onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
//         onEnded={() => { setPlaying(false); setProgress(0); setCurrent(0); }}
//         onTimeUpdate={() => { const a = audioRef.current; if (!a?.duration) return; setCurrent(a.currentTime); setProgress(a.currentTime/a.duration); }}
//         onLoadedMetadata={() => { const a = audioRef.current; if (a) setDuration(a.duration); }} />
//       <button onClick={toggle} style={{ flexShrink: 0, width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${accent}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, padding: 0 }}>
//         {playing
//           ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
//           : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
//       </button>
//       <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
//         <div style={{ height: '3px', borderRadius: '2px', background: trackBg, cursor: 'pointer', position: 'relative' }}
//           onClick={e => { const a = audioRef.current; if (!a?.duration) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * a.duration; }}>
//           <div style={{ height: '100%', width: `${progress*100}%`, background: fillBg, borderRadius: '2px', transition: 'width 0.1s linear' }} />
//         </div>
//         <div style={{ fontSize: '9px', color: accent, opacity: 0.8, lineHeight: 1 }}>{fmt(current)} / {fmt(duration||0)}</div>
//       </div>
//     </div>
//   );
// });

// function CustomerTick({ status }: { status: TickStatus }) {
//   if (status === 'none') return null;
//   const W = 'rgba(255,255,255,0.95)', Wm = 'rgba(255,255,255,0.65)';
//   const Single = () => <svg width="14" height="10" viewBox="0 0 14 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}><polyline points="1,5 5,9 13,1" stroke={Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
//   const Double = ({ bright }: { bright: boolean }) => <svg width="18" height="10" viewBox="0 0 18 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}><polyline points="5,5 9,9 17,1" stroke={bright?W:Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><polyline points="1,5 5,9 13,1" stroke={bright?W:Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
//   if (status === 'sent')      return <Single />;
//   if (status === 'delivered') return <Double bright={false} />;
//   return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Double bright /><span style={{ fontSize: 9, fontWeight: 700, color: W, lineHeight: 1 }}>Seen</span></span>;
// }

// const MessageBubble = React.memo(function MessageBubble({
//   message, styles, onImageClick, onReply, replyToResolved, tickStatus, primaryColor,
// }: {
//   message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string;
//   onImageClick?: (url: string, fn: string) => void; onReply?: (m: ChatMessage) => void;
//   replyToResolved?: ChatMessage | null; tickStatus: TickStatus; primaryColor: string;
// }) {
//   const isCustomer = message.senderType === 'CUSTOMER';
//   const isSystem   = message.senderType === 'SYSTEM';
//   const isBot      = message.senderType === 'BOT';
//   const time = formatTime(message.timestamp);
//   const [hovered, setHovered] = useState(false);

//   if (isSystem && looksLikeRawId(message.content?.trim())) return null;
//   if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

//   const rawName    = message.senderName;
//   const agentLabel = (rawName && !looksLikeRawId(rawName)) ? rawName : 'Agent';
//   const label      = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

//   const attachment = message.attachment ?? (message.metadata?.attachment as any) ?? null;
//   const contentUrl = message.content ?? '';
//   const isImageUrl = /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(contentUrl);
//   const isVideoUrl = /\.(mp4|mov|avi|mkv|flv|wmv)(\?.*)?$/i.test(contentUrl);
//   const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)(\?.*)?$/i.test(contentUrl) || /\/audio\//i.test(contentUrl);
//   const isFileUrl  = /^https?:\/\//i.test(contentUrl);

//   let effectiveType: 'IMAGE'|'VIDEO'|'AUDIO'|'FILE'|null = null;
//   if      (message.messageType==='IMAGE') effectiveType='IMAGE';
//   else if (message.messageType==='VIDEO') effectiveType='VIDEO';
//   else if (message.messageType==='AUDIO') effectiveType='AUDIO';
//   else if (message.messageType==='FILE')  effectiveType='FILE';
//   else if (attachment?.mimeType?.startsWith('image/')) effectiveType='IMAGE';
//   else if (attachment?.mimeType?.startsWith('video/')) effectiveType='VIDEO';
//   else if (attachment?.mimeType?.startsWith('audio/')) effectiveType='AUDIO';
//   else if (isImageUrl) effectiveType='IMAGE';
//   else if (isVideoUrl) effectiveType='VIDEO';
//   else if (isAudioUrl) effectiveType='AUDIO';
//   else if (attachment||(isFileUrl&&contentUrl.includes('/')&&!contentUrl.includes(' '))) effectiveType='FILE';

//   const isAttachment = effectiveType !== null;
//   const isAudio = effectiveType === 'AUDIO';
//   const replyTo = message.replyToMessage ?? replyToResolved ?? null;

//   const renderReplyQuote = () => {
//     if (!replyTo) return null;
//     const rName = replyTo.senderType==='CUSTOMER' ? 'You' : ((replyTo as any).senderName ?? (replyTo.senderType==='BOT' ? 'AI Assistant' : 'Agent'));
//     const isMedia = ['IMAGE','VIDEO','AUDIO','FILE'].includes(replyTo.messageType);
//     const preview = isMedia ? `📎 ${replyTo.messageType.charAt(0)+replyTo.messageType.slice(1).toLowerCase()}` : (replyTo.content?.length>60?replyTo.content.slice(0,60)+'…':replyTo.content);
//     return (
//       <div style={{ padding:'6px 10px', marginBottom:'6px', borderLeft:`3px solid ${isCustomer?'rgba(255,255,255,0.5)':'#7c3aed'}`, borderRadius:'4px', backgroundColor:isCustomer?'rgba(255,255,255,0.12)':'#f5f3ff', fontSize:'11px', lineHeight:'1.4', cursor:'pointer' }}
//         onClick={e => { e.stopPropagation(); const el=document.getElementById(`chat-msg-${replyTo!.id}`); if(el){el.scrollIntoView({behavior:'smooth',block:'center'}); el.animate([{backgroundColor:'transparent'},{backgroundColor:isCustomer?'rgba(124,58,237,0.15)':'#ede9fe'},{backgroundColor:isCustomer?'rgba(124,58,237,0.15)':'#ede9fe'},{backgroundColor:'transparent'}],{duration:2000,easing:'ease-in-out'});}}}>
//         <div style={{ fontWeight:700, color:isCustomer?'rgba(255,255,255,0.85)':'#7c3aed', marginBottom:'2px' }}>{rName}</div>
//         <div style={{ color:isCustomer?'rgba(255,255,255,0.7)':'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{preview}</div>
//       </div>
//     );
//   };

//   const renderAttachment = () => {
//     const url = attachment?.url ?? contentUrl;
//     const fileName = attachment?.fileName ?? url.split('/').pop()?.split('?')[0] ?? 'file';
//     if (effectiveType==='IMAGE') return <div style={{cursor:'pointer'}} onClick={()=>onImageClick?.(url,fileName)}><img src={url} alt={fileName} style={{maxWidth:'220px',maxHeight:'180px',borderRadius:'12px',objectFit:'cover',display:'block'}} loading="lazy"/></div>;
//     if (effectiveType==='VIDEO') return <video src={url} controls style={{maxWidth:'240px',maxHeight:'180px',borderRadius:'12px'}} preload="metadata"/>;
//     if (effectiveType==='AUDIO') return <CompactAudioPlayer src={url} isCustomer={isCustomer}/>;
//     return <a href={url} target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px',borderRadius:'10px',backgroundColor:isCustomer?'rgba(255,255,255,0.15)':'#f3f4f6',color:isCustomer?'#fff':'#5b4fcf',fontSize:'13px',fontWeight:600,textDecoration:'none'}}>
//       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
//       <span style={{maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fileName}</span>
//     </a>;
//   };

//   const bubbleStyle: React.CSSProperties = isAudio
//     ? { ...(isCustomer?{background:styles.bubbleCustomer.background??'#5b4fcf',borderRadius:'18px 18px 4px 18px'}:{background:'#ffffff',border:'1px solid #ede9fe',borderRadius:'18px 18px 18px 4px'}), padding:'8px 10px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', display:'flex', flexDirection:'column' as const, gap:'2px' }
//     : (isCustomer ? styles.bubbleCustomer : styles.bubbleAgent);

//   const Timestamps = () => isCustomer
//     ? <div style={{...styles.timestamp,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:3}}><span>{time}</span><CustomerTick status={tickStatus}/></div>
//     : <div style={{...styles.timestamp,textAlign:'left'}}>{time}</div>;

//   return (
//     <div style={{display:'flex',flexDirection:'column',alignItems:isCustomer?'flex-end':'flex-start'}} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
//       {label && <div style={styles.senderLabel}>{label}</div>}
//       <div style={{position:'relative',...(isAudio?{width:'fit-content'}:{maxWidth:'82%'})}}>
//         <div style={{...bubbleStyle,...(isAudio?{}:{maxWidth:'100%'})}}>
//           {renderReplyQuote()}
//           {isAttachment ? renderAttachment() : message.content}
//           <Timestamps />
//         </div>
//         {onReply && (
//           <button onClick={()=>onReply(message)} title="Reply"
//             style={{position:'absolute',top:'50%',...(isCustomer?{left:'-32px'}:{right:'-32px'}),transform:'translateY(-50%)',background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:'50%',width:26,height:26,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#6b7280',flexShrink:0,transition:'opacity 0.15s',padding:0,opacity:hovered?1:0,pointerEvents:hovered?'auto' as const:'none' as const}}
//             onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#ede9fe';(e.currentTarget as HTMLElement).style.color='#5b4fcf';}}
//             onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#f3f4f6';(e.currentTarget as HTMLElement).style.color='#6b7280';}}>
//             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
//           </button>
//         )}
//       </div>
//     </div>
//   );
// });

// // ── Main menu quick replies ────────────────────────────────────────────────────
// function QuickReplies({ replies, onSelect, primaryColor }: {
//   replies: QuickReply[]; onSelect: (r: QuickReply) => void; primaryColor: string;
// }) {
//   return (
//     <div style={{ padding:'10px 14px 12px', display:'flex', flexDirection:'column', gap:'8px', backgroundColor:'#fafafa', borderTop:'1px solid #f0f0f0', flexShrink: 0 }}>
//       <div style={{ fontSize:'11px', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>How can we help?</div>
//       {replies.map(r => (
//         <button key={r.id}
//           style={{ width:'100%', padding:'10px 16px', borderRadius:'12px', border:'1.5px solid #e0d9ff', backgroundColor:'#ffffff', color: primaryColor, cursor:'pointer', fontSize:'13px', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:'8px', textAlign:'left', transition:'all 0.15s' }}
//           onClick={() => onSelect(r)}
//           onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor=primaryColor; }}
//           onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ffffff'; (e.currentTarget as HTMLElement).style.borderColor='#e0d9ff'; }}>
//           <span style={{ fontSize:16 }}>{r.icon}</span>
//           <span>{r.label}</span>
//         </button>
//       ))}
//     </div>
//   );
// }

// // ── FAQ screen ────────────────────────────────────────────────────────────────
// function FAQScreen({ primaryColor, onSelect, onBack }: {
//   primaryColor: string; onSelect: (faq: QuickReply) => void; onBack: () => void;
// }) {
//   return (
//     <div style={{ borderTop:'1px solid #f0f0f0', flexShrink:0, backgroundColor:'#fafafa' }}>
//       <button onClick={onBack}
//         style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px 4px', background:'none', border:'none', cursor:'pointer', color:primaryColor, fontSize:'12px', fontWeight:600, fontFamily:'inherit' }}>
//         <BackIcon /> Back to menu
//       </button>
//       <div style={{ padding:'2px 14px 6px', fontSize:'11px', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>
//         Frequently Asked Questions
//       </div>
//       <div style={{ maxHeight:'230px', overflowY:'auto', padding:'0 14px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
//         {FAQ_ITEMS.map(faq => (
//           <button key={faq.id}
//             style={{ width:'100%', padding:'9px 14px', borderRadius:'10px', border:'1.5px solid #e0d9ff', backgroundColor:'#ffffff', color:primaryColor, cursor:'pointer', fontSize:'13px', fontWeight:500, fontFamily:'inherit', display:'flex', alignItems:'center', gap:'8px', textAlign:'left', transition:'all 0.15s' }}
//             onClick={() => onSelect(faq)}
//             onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor=primaryColor; }}
//             onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ffffff'; (e.currentTarget as HTMLElement).style.borderColor='#e0d9ff'; }}>
//             <span style={{ fontSize:15 }}>{faq.icon}</span>
//             <span>{faq.label}</span>
//           </button>
//         ))}
//       </div>
//     </div>
//   );
// }

// function EscalatingScreen({ primaryColor }: { primaryColor: string }) {
//   return (
//     <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'16px', padding:'32px', backgroundColor:'#fafafa', textAlign:'center' }}>
//       <div style={{ fontSize:52 }}>👤</div>
//       <div>
//         <div style={{ fontWeight:700, fontSize:16, color:'#1a1a2e', marginBottom:8 }}>Connecting you to an agent</div>
//         <div style={{ fontSize:13, color:'#6b7280', lineHeight:1.7 }}>You've been added to the support queue.<br/>An agent will join shortly.</div>
//       </div>
//       <div style={{ display:'flex', gap:8 }}>
//         {[0,0.2,0.4].map((d,i)=><div key={i} style={{width:9,height:9,borderRadius:'50%',backgroundColor:primaryColor,animation:`chatTypingBounce 1.2s ${d}s infinite ease-in-out`}}/>)}
//       </div>
//       <div style={{ padding:'8px 20px', borderRadius:20, backgroundColor:'#ede9fe', color:primaryColor, fontSize:12, fontWeight:700 }}>Est. wait: &lt; 2 min</div>
//     </div>
//   );
// }

// function FeedbackModal({ primaryColor, onSubmit, onSkip }: { primaryColor:string; onSubmit:(r:number,c:string)=>void; onSkip:()=>void; }) {
//   const [rating,setRating]=React.useState(0);
//   const [hovered,setHovered]=React.useState(0);
//   const [comment,setComment]=React.useState('');
//   const [submitted,setSubmitted]=React.useState(false);
//   const labels=['Terrible','Bad','Okay','Good','Excellent'];
//   const handleSubmit=()=>{if(rating===0)return;setSubmitted(true);setTimeout(()=>onSubmit(rating,comment),900);};
//   if(submitted) return <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'14px',padding:'32px',backgroundColor:'#fafafa'}}><div style={{fontSize:52}}>🎉</div><div style={{textAlign:'center'}}><div style={{fontSize:16,fontWeight:700,color:'#1a1a2e',marginBottom:6}}>Thank you!</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.6}}>Your feedback helps us improve.</div></div></div>;
//   const active=hovered||rating;
//   return (
//     <div style={{flex:1,display:'flex',flexDirection:'column',backgroundColor:'#fafafa',padding:'28px 24px 20px',gap:'20px'}}>
//       <div style={{textAlign:'center'}}><div style={{fontSize:28,marginBottom:'10px'}}>⭐</div><div style={{fontSize:16,fontWeight:700,color:'#1a1a2e',marginBottom:4}}>How was your experience?</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>Your feedback helps us serve you better</div></div>
//       <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
//         <div style={{display:'flex',gap:'10px'}}>{[1,2,3,4,5].map(star=><button key={star} onClick={()=>setRating(star)} onMouseEnter={()=>setHovered(star)} onMouseLeave={()=>setHovered(0)} style={{background:'none',border:'none',cursor:'pointer',padding:'2px',fontSize:'32px',lineHeight:1,transition:'transform 0.15s',transform:active>=star?'scale(1.15)':'scale(1)',filter:active>=star?'drop-shadow(0 2px 4px rgba(234,179,8,0.4))':'grayscale(1) opacity(0.35)'}}>⭐</button>)}</div>
//         {active>0 && <div style={{fontSize:'12px',fontWeight:600,color:primaryColor}}>{labels[active-1]}</div>}
//       </div>
//       <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
//         <label style={{fontSize:'11px',fontWeight:600,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>Tell us more (optional)</label>
//         <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="What could we do better?" rows={3} style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',borderRadius:'12px',border:`1.5px solid ${comment?primaryColor+'88':'#e5e7eb'}`,fontSize:'13px',fontFamily:'inherit',resize:'none',backgroundColor:'#ffffff',color:'#111827',outline:'none',transition:'border-color 0.2s',lineHeight:1.5}}/>
//       </div>
//       <div style={{display:'flex',gap:'10px'}}>
//         <button onClick={onSkip} style={{flex:1,padding:'10px',borderRadius:'22px',border:'1.5px solid #e5e7eb',background:'#ffffff',color:'#6b7280',fontSize:'13px',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Skip</button>
//         <button onClick={handleSubmit} disabled={rating===0} style={{flex:2,padding:'10px',borderRadius:'22px',border:'none',background:rating>0?`linear-gradient(135deg,${primaryColor},${primaryColor}cc)`:'#f3f4f6',color:rating>0?'#ffffff':'#9ca3af',fontSize:'13px',fontWeight:700,cursor:rating>0?'pointer':'not-allowed',fontFamily:'inherit'}}>Submit Feedback</button>
//       </div>
//     </div>
//   );
// }

// function EndChatConfirmModal({ primaryColor, onConfirm, onCancel }: { primaryColor:string; onConfirm:()=>void; onCancel:()=>void; }) {
//   return (
//     <div style={{position:'absolute',inset:0,zIndex:50,backgroundColor:'rgba(0,0,0,0.35)',backdropFilter:'blur(2px)',display:'flex',alignItems:'flex-end'}}>
//       <div style={{width:'100%',backgroundColor:'#ffffff',borderRadius:'20px 20px 0 0',padding:'24px 20px 28px',boxShadow:'0 -8px 32px rgba(0,0,0,0.15)',display:'flex',flexDirection:'column',gap:'16px',animation:'chatFadeIn 0.2s ease'}}>
//         <div style={{width:36,height:4,borderRadius:2,backgroundColor:'#e5e7eb',alignSelf:'center',marginBottom:2}}/>
//         <div style={{textAlign:'center'}}><div style={{fontSize:36,marginBottom:'10px'}}>👋</div><div style={{fontSize:15,fontWeight:700,color:'#1a1a2e',marginBottom:6}}>End this chat?</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.6}}>This will close your current session.<br/>You'll have a chance to leave feedback.</div></div>
//         <div style={{display:'flex',gap:'10px',marginTop:4}}>
//           <button onClick={onCancel} style={{flex:1,padding:'12px',borderRadius:'14px',border:'1.5px solid #e5e7eb',background:'#f9fafb',color:'#374151',fontSize:'14px',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Keep Chatting</button>
//           <button onClick={onConfirm} style={{flex:1,padding:'12px',borderRadius:'14px',border:'none',background:'linear-gradient(135deg,#ef4444,#dc2626)',color:'#ffffff',fontSize:'14px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>End Chat</button>
//         </div>
//       </div>
//     </div>
//   );
// }

// function WidgetHeader({ onClose, styles, subtitle, theme, onEndChat, showEndChat, onHistory, showHistory }: {
//   onClose:()=>void; styles:Record<string,React.CSSProperties>; subtitle:string; theme:FullTheme;
//   onEndChat?:()=>void; showEndChat?:boolean; onHistory?:()=>void; showHistory?:boolean;
// }) {
//   return (
//     <div style={styles.header}>
//       <div style={styles.headerAvatar}>💬</div>
//       <div style={styles.headerInfo}><h3 style={styles.headerTitle}>Chat Support</h3><div style={styles.headerSub}><span style={styles.onlineDot}/>{subtitle}</div></div>
//       {onHistory && <button onClick={onHistory} title={showHistory?'Back to chat':'Chat history'} style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:theme.headerText,cursor:'pointer',padding:'6px 8px',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',marginRight:'4px',transition:'all 0.15s'}} onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.22)';}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.12)';}}>
//         {showHistory?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
//       </button>}
//       {showEndChat && onEndChat && <button onClick={onEndChat} title="End chat" style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:theme.headerText,cursor:'pointer',padding:'6px 10px',borderRadius:'8px',display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',fontWeight:600,marginRight:'6px',transition:'all 0.15s',letterSpacing:'0.02em'}} onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(239,68,68,0.3)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(239,68,68,0.5)';}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.12)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.25)';}}>
//         <PhoneDownIcon/> End
//       </button>}
//       <button style={styles.closeBtn} onClick={onClose}><CloseIcon/></button>
//     </div>
//   );
// }

// function SessionHistoryPanel({ primaryColor, sessions, currentSessionId, onSelectActive, onReopen, onBack }: {
//   primaryColor:string; sessions:ChatSessionSummary[]; currentSessionId?:string|null;
//   onSelectActive:()=>void; onReopen:(id:string)=>Promise<void>; onBack:()=>void;
// }) {
//   const [reopening,setReopening]=useState<string|null>(null);
//   const active=sessions.filter(s=>s.status!=='CLOSED');
//   const closed=sessions.filter(s=>s.status==='CLOSED').slice(0,5);
//   const formatDate=(d:string|Date|null|undefined)=>{if(!d)return'';const date=new Date(d);if(isNaN(date.getTime()))return'';const diff=Date.now()-date.getTime();if(diff<60000)return'Just now';if(diff<3600000)return`${Math.round(diff/60000)}m ago`;if(diff<86400000)return`${Math.round(diff/3600000)}h ago`;if(diff<7*86400000)return`${Math.round(diff/86400000)}d ago`;return date.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
//   const handleReopen=async(id:string)=>{setReopening(id);try{await onReopen(id);}finally{setReopening(null);}};
//   const badge=(status:string)=>{const map:Record<string,{label:string;bg:string;color:string}>={OPEN:{label:'Open',bg:'#dcfce7',color:'#166534'},WAITING_FOR_AGENT:{label:'Waiting',bg:'#fef9c3',color:'#854d0e'},ASSIGNED:{label:'Active',bg:'#dbeafe',color:'#1e40af'},CLOSED:{label:'Closed',bg:'#f3f4f6',color:'#6b7280'}};const s=map[status]??{label:status,bg:'#f3f4f6',color:'#6b7280'};return<span style={{display:'inline-block',padding:'2px 8px',borderRadius:'10px',fontSize:'10px',fontWeight:700,background:s.bg,color:s.color,letterSpacing:'0.03em'}}>{s.label}</span>;};
//   const renderRow=(s:ChatSessionSummary,isAct:boolean)=>{const preview=s.lastMessage?.content?.trim();const previewText=preview?(preview.length>55?preview.slice(0,55)+'…':preview):'(no messages yet)';const isCurrent=s.id===currentSessionId;return(<div key={s.id} style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f5',display:'flex',flexDirection:'column',gap:'6px',backgroundColor:isCurrent?'#f9f7ff':'#ffffff'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px'}}><div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>{badge(s.status)}<span style={{fontSize:'11px',color:'#9ca3af'}}>{formatDate(s.closedAt??s.createdAt)}</span></div>{isAct?<button onClick={onSelectActive} style={{padding:'5px 12px',borderRadius:'14px',border:`1.5px solid ${primaryColor}`,background:isCurrent?primaryColor:'transparent',color:isCurrent?'#ffffff':primaryColor,fontSize:'11px',fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>{isCurrent?'Current ✓':'Continue'}</button>:<button onClick={()=>handleReopen(s.id)} disabled={reopening===s.id} style={{padding:'5px 12px',borderRadius:'14px',border:`1.5px solid ${primaryColor}`,background:'transparent',color:primaryColor,fontSize:'11px',fontWeight:700,cursor:reopening===s.id?'not-allowed':'pointer',fontFamily:'inherit',opacity:reopening===s.id?0.6:1,whiteSpace:'nowrap'}}>{reopening===s.id?'…':'Reopen'}</button>}</div><div style={{fontSize:'12px',color:'#6b7280',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{previewText}</div></div>);};
//   return (
//     <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',backgroundColor:'#fafafa'}}>
//       <div style={{padding:'12px 16px 4px',fontSize:'11px',fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',backgroundColor:'#fafafa'}}>Active</div>
//       {active.length===0&&<div style={{padding:'12px 16px',fontSize:'13px',color:'#c4b5fd',textAlign:'center'}}>No active sessions</div>}
//       {active.map(s=>renderRow(s,true))}
//       <div style={{padding:'12px 16px 4px',fontSize:'11px',fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',backgroundColor:'#fafafa',borderTop:'1px solid #f0f0f5',marginTop:'4px'}}>Closed</div>
//       <div style={{flex:1,overflowY:'auto' as const}}>
//         {closed.length===0&&<div style={{padding:'16px',fontSize:'13px',color:'#c4b5fd',textAlign:'center'}}>No closed sessions yet</div>}
//         {closed.map(s=>renderRow(s,false))}
//       </div>
//     </div>
//   );
// }

// // ==========================================
// // ChatWidget — public entry point
// // ==========================================

// export interface ChatWidgetProps { config: ChatSDKConfig; defaultOpen?: boolean; }

// export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
//   const [isOpen, setIsOpen]           = useState(defaultOpen);
//   const [launchHover, setLaunchHover] = useState(false);
//   const [chatKey, setChatKey]         = useState(0);
//   const [unreadCount, setUnreadCount] = useState(0);
//   const theme: FullTheme = { ...defaultTheme, ...config.theme };
//   const styles = getStyles(config.theme);
//   const scrollToBottomRef = useRef<(()=>void)|null>(null);
//   const handleStartNewChat = () => setChatKey(k => k+1);
//   const handleUnreadChange = useCallback((count: number) => setUnreadCount(count), []);
//   const prevIsOpen = useRef(isOpen);
//   useEffect(() => {
//     if (isOpen && !prevIsOpen.current) requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(scrollToBottomRef.current) scrollToBottomRef.current(); }));
//     prevIsOpen.current = isOpen;
//   }, [isOpen]);
//   return (
//     <div style={styles.container}>
//       {!isOpen && (
//         <button style={{...styles.launcher,transform:launchHover?'scale(1.1)':'scale(1)',boxShadow:launchHover?`0 6px 28px ${theme.primaryColor}77`:`0 4px 20px ${theme.primaryColor}44`,position:'relative' as const}}
//           onClick={()=>setIsOpen(true)} onMouseEnter={()=>setLaunchHover(true)} onMouseLeave={()=>setLaunchHover(false)} aria-label="Open chat support">
//           <ChatIcon/>
//           {unreadCount>0&&<span style={{position:'absolute',top:'-4px',right:'-4px',minWidth:'20px',height:'20px',borderRadius:'10px',backgroundColor:'#ef4444',color:'#ffffff',fontSize:'11px',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px',boxShadow:'0 2px 6px rgba(239,68,68,0.5)',border:'2px solid #ffffff',fontFamily:'system-ui,sans-serif',lineHeight:1}}>{unreadCount>99?'99+':unreadCount}</span>}
//         </button>
//       )}
//       <ChatProvider config={config} key={chatKey}>
//         <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange}/>
//         <div style={{display:isOpen?'block':'none'}}>
//           <ChatContentWithScrollRef onClose={()=>setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} scrollToBottomRef={scrollToBottomRef}/>
//         </div>
//       </ChatProvider>
//     </div>
//   );
// }

// function UnreadTracker({ isOpen, onUnreadChange }: { isOpen:boolean; onUnreadChange:(c:number)=>void; }) {
//   const { state, actions } = useChat();
//   const setWidgetOpenRef = useRef(actions.setWidgetOpen);
//   setWidgetOpenRef.current = actions.setWidgetOpen;
//   useEffect(() => { setWidgetOpenRef.current(isOpen); }, [isOpen]);
//   useEffect(() => { onUnreadChange(state.unreadCount); }, [state.unreadCount, onUnreadChange]);
//   return null;
// }

// function ChatContentWithScrollRef({ scrollToBottomRef, ...props }: {
//   onClose:()=>void; styles:Record<string,React.CSSProperties>;
//   config:ChatSDKConfig; theme:FullTheme; onStartNewChat?:()=>void;
//   scrollToBottomRef:React.MutableRefObject<(()=>void)|null>;
// }) {
//   const localMessagesAreaRef = useRef<HTMLDivElement|null>(null);
//   useEffect(() => {
//     scrollToBottomRef.current = () => { const el=localMessagesAreaRef.current; if(el) el.scrollTop=el.scrollHeight; };
//     return () => { scrollToBottomRef.current=null; };
//   }, [scrollToBottomRef]);
//   return <ChatContentInner {...props} externalMessagesAreaRef={localMessagesAreaRef}/>;
// }

// // ==========================================
// // ChatContentInner — main logic
// // ==========================================

// function ChatContentInner({ onClose, styles, config, theme, onStartNewChat, externalMessagesAreaRef }: {
//   onClose:()=>void; styles:Record<string,React.CSSProperties>;
//   config:ChatSDKConfig; theme:FullTheme; onStartNewChat?:()=>void;
//   externalMessagesAreaRef:React.MutableRefObject<HTMLDivElement|null>;
// }): JSX.Element {
//   const { state, actions } = useChat();

//   const [inputValue, setInputValue]              = useState('');
//   // Start at 'menu' — no fake welcome message. Backend sends its own welcome.
//   // Switch to 'free' once we detect existing history or an agent is assigned.
//   const [flowStep, setFlowStep]                  = useState<FlowStep>('menu');
//   const [showQuickReplies, setShowQuickReplies]  = useState(true);
//   const [escalationError, setEscalationError]    = useState<string|null>(null);
//   const [viewerImage, setViewerImage]            = useState<{url:string;fileName:string}|null>(null);
//   const [isRecording, setIsRecording]            = useState(false);
//   const [replyTarget, setReplyTarget]            = useState<ReplyTarget|null>(null);
//   const [showEndConfirm, setShowEndConfirm]      = useState(false);
//   const [showFeedback, setShowFeedback]          = useState(false);
//   const [endingChat, setEndingChat]              = useState(false);
//   const [showHistory, setShowHistory]            = useState(false);

//   const inputRef         = useRef<HTMLInputElement>(null);
//   const fileInputRef     = useRef<HTMLInputElement>(null);
//   const mediaRecorderRef = useRef<MediaRecorder|null>(null);
//   const audioChunksRef   = useRef<Blob[]>([]);
//   const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
//   const hasInited        = useRef(false);
//   const prevMsgCount     = useRef(0);
//   const prevSoundCount   = useRef(0);

//   const messagesAreaRef = externalMessagesAreaRef;
//   const messagesEndRef  = useRef<HTMLDivElement>(null);

//   const shouldScrollBottom    = useRef(true);
//   const savedScrollHeightRef  = useRef(0);
//   const prevMsgCountLayoutRef = useRef(0);
//   const maxScrollTopRef       = useRef(0);
//   const isRestoringScroll     = useRef(false);
//   const [showJumpToBottom, setShowJumpToBottom]       = useState(false);
//   const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

//   const renderedMsgIds  = useRef(new Set<string>());
//   const hasRenderedOnce = useRef(false);

//   const stateRef   = useRef(state);
//   const actionsRef = useRef(actions);
//   const configRef  = useRef(config);
//   useEffect(() => { stateRef.current   = state;   }, [state]);
//   useEffect(() => { actionsRef.current = actions; }, [actions]);
//   useEffect(() => { configRef.current  = config;  }, [config]);

//   useEffect(() => {
//     console.log('%c[ChatWidget] ✅ PATCHED BUILD LOADED v2026-03-20-menu-fix', 'background:#5b4fcf;color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold');
//   }, []);

//   useEffect(() => {
//     const id = 'chat-sdk-kf';
//     if (document.getElementById(id)) return;
//     const s = document.createElement('style');
//     s.id = id;
//     s.textContent = `
//       @keyframes chatTypingBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}
//       @keyframes chatFadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
//       @keyframes pulse-recording{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
//       @keyframes chatUploadPulse{0%{width:0%;margin-left:0%}50%{width:60%;margin-left:20%}100%{width:0%;margin-left:100%}}
//     `;
//     document.head.appendChild(s);
//   }, []);

//   // ── Decide initial flowStep once data loads ───────────────────────────────
//   // If there's existing chat history or an agent is assigned → go straight to
//   // 'free'. Otherwise show the menu immediately (backend already sent its own
//   // welcome message so we don't add another one).
//   useEffect(() => {
//     if (!state.connected || state.loading) return;
//     if (hasInited.current) return;
//     hasInited.current = true;

//     const sess = stateRef.current.session;
//     const msgs = stateRef.current.messages;

//     const hasAgentSession =
//       sess?.status === 'ASSIGNED' ||
//       sess?.status === 'WAITING_FOR_AGENT' ||
//       sess?.mode   === 'HUMAN';

//     const hasHistory =
//       msgs.some(m => m.senderType === 'CUSTOMER') ||
//       msgs.some(m => m.senderType === 'AGENT');

//     if (hasAgentSession || hasHistory) {
//       setFlowStep('free');
//       setShowQuickReplies(false);
//     } else {
//       // Fresh session — show quick-reply menu, no fake message
//       setFlowStep('menu');
//       setShowQuickReplies(true);
//     }
//   }, [state.connected, state.loading]);

//   useEffect(() => {
//     if (flowStep === 'free') inputRef.current?.focus();
//   }, [flowStep]);

//   // Switch to free when any agent/bot reply arrives
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

//   // Notification sound
//   useEffect(() => {
//     const newCount = state.messages.length;
//     if (newCount > prevSoundCount.current) {
//       const newMsgs = state.messages.slice(prevSoundCount.current);
//       if (newMsgs.some(m => m.senderType==='AGENT'||m.senderType==='BOT') && !state.isWidgetOpen) playNotificationSound();
//     }
//     prevSoundCount.current = newCount;
//   }, [state.messages.length, state.isWidgetOpen]);

//   useEffect(() => {
//     const unlock = () => { unlockAudio(); window.removeEventListener('click', unlock); };
//     window.addEventListener('click', unlock);
//     return () => window.removeEventListener('click', unlock);
//   }, []);

//   useEffect(() => {
//     if (state.isWidgetOpen && state.session?.id) actionsRef.current.markMessagesRead?.().catch(()=>{});
//   }, [state.isWidgetOpen, state.session?.id]);

//   useEffect(() => {
//     if (!state.isWidgetOpen || !state.session?.id) return;
//     const last = state.messages[state.messages.length-1];
//     if (last?.senderType==='AGENT'||last?.senderType==='BOT') actionsRef.current.markMessagesRead?.().catch(()=>{});
//   }, [state.messages.length]);

//   useEffect(() => {
//     if (showHistory) actionsRef.current.fetchPastSessions?.().catch(()=>{});
//   }, [showHistory]);

//   const waitForSession = useCallback((): Promise<string> => {
//     return new Promise((resolve,reject) => {
//       if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
//       const max=8000; const step=200; let elapsed=0;
//       const t = setInterval(()=>{
//         elapsed+=step;
//         const id=stateRef.current.session?.id;
//         if(id){clearInterval(t);resolve(id);}
//         else if(elapsed>=max){clearInterval(t);reject(new Error('Session not ready — please try again'));}
//       },step);
//     });
//   }, []);

//   const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
//     const cfg = configRef.current;
//     try {
//       await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/escalate`, {
//         method: 'POST',
//         headers: { 'Authorization':`Bearer ${cfg.token}`, 'X-Tenant-ID':cfg.tenantId, 'Content-Type':'application/json' },
//         body: JSON.stringify({ reason }),
//       });
//     } catch(e) { console.warn('[Chat] REST escalation failed:', e); }
//     actionsRef.current.requestAgent?.(reason);
//   }, []);

//   // All messages are purely from the real WS — no localMessages merging
//   const allMessages = useMemo(() => {
//     const seen = new Set<string>();
//     const result: ChatMessage[] = [];
//     for (const m of state.messages) { seen.add(m.id); result.push(m); }
//     return result.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
//   }, [state.messages]);

//   useLayoutEffect(() => {
//     const el = messagesAreaRef.current;
//     const msgCount = allMessages.length;
//     if (el && msgCount > prevMsgCountLayoutRef.current && !shouldScrollBottom.current && savedScrollHeightRef.current>0) {
//       const diff = el.scrollHeight - savedScrollHeightRef.current;
//       if (diff>0) {
//         isRestoringScroll.current=true;
//         el.scrollTop=diff;
//         shouldScrollBottom.current=false;
//         maxScrollTopRef.current=diff;
//         requestAnimationFrame(()=>requestAnimationFrame(()=>{
//           isRestoringScroll.current=false;
//           const el2=messagesAreaRef.current;
//           if(el2){const atBottom=el2.scrollHeight-el2.scrollTop-el2.clientHeight<60;shouldScrollBottom.current=atBottom;}
//         }));
//       }
//       savedScrollHeightRef.current=0;
//     }
//     prevMsgCountLayoutRef.current=msgCount;
//   }, [allMessages.length, messagesAreaRef]);

//   useEffect(() => { allMessages.forEach(m=>renderedMsgIds.current.add(m.id)); hasRenderedOnce.current=true; }, [allMessages]);

//   const msgByIdMap = useMemo(()=>{ const map=new Map<string,ChatMessage>(); for(const m of allMessages) map.set(m.id,m); return map; },[allMessages]);

//   const agentOnline = useMemo(()=>{
//     if (state.session?.assignedAgent?.isOnline===true) return true;
//     if (state.session?.assignedAgentId) return true;
//     return allMessages.some(m=>m.senderType==='AGENT');
//   },[state.session?.assignedAgent?.isOnline, state.session?.assignedAgentId, allMessages]);

//   const agentReadAt = useMemo<Date|null>(()=>{
//     const raw=(state as any).agentReadAt;
//     if(!raw)return null;
//     const d=new Date(raw);
//     return isNaN(d.getTime())?null:d;
//   },[(state as any).agentReadAt]);

//   const tickMap = useMemo(()=>buildTickMap({
//     messages: allMessages.map(m=>{ const ts=m.timestamp instanceof Date?m.timestamp:new Date(m.timestamp as any); return{id:m.id,createdAt:isNaN(ts.getTime())?new Date().toISOString():ts.toISOString(),senderType:m.senderType}; }),
//     viewerSenderType: 'CUSTOMER',
//     readAt: agentReadAt,
//     otherPartyOnline: agentOnline,
//   }),[allMessages, agentReadAt, agentOnline]);

//   const handleImageClick = useCallback((url:string,fileName:string)=>setViewerImage({url,fileName}),[]);
//   const handleReply = useCallback((m:ChatMessage)=>{ setReplyTarget({id:m.id,content:m.content,senderType:m.senderType,senderName:m.senderName}); inputRef.current?.focus(); },[]);

//   const scrollToBottomNow = useCallback((behavior:ScrollBehavior='smooth')=>{
//     const el=messagesAreaRef.current;
//     if(el){el.scrollTop=el.scrollHeight;} else{messagesEndRef.current?.scrollIntoView({behavior});}
//     shouldScrollBottom.current=true;
//     setShowJumpToBottom(false);
//     setUnreadWhileScrolled(0);
//   },[messagesAreaRef]);

//   const lastMsgId   = allMessages.length>0?allMessages[allMessages.length-1].id:null;
//   const lastMsgType = allMessages.length>0?allMessages[allMessages.length-1].senderType:null;
//   const lastMessageIdRef = useRef<string|null>(null);
//   const scrollInitSeeded = useRef(false);

//   useEffect(()=>{
//     if(!lastMsgId)return;
//     if(!scrollInitSeeded.current){lastMessageIdRef.current=lastMsgId;scrollInitSeeded.current=true;return;}
//     if(lastMsgId===lastMessageIdRef.current)return;
//     lastMessageIdRef.current=lastMsgId;
//     if(shouldScrollBottom.current){scrollToBottomNow('smooth');}
//     else{if(lastMsgType!=='CUSTOMER'){setUnreadWhileScrolled(c=>c+1);setShowJumpToBottom(true);}}
//   },[lastMsgId,scrollToBottomNow]);

//   useEffect(()=>{ if(state.isTyping&&shouldScrollBottom.current) scrollToBottomNow('smooth'); },[state.isTyping,scrollToBottomNow]);

//   const handleMessagesScroll = useCallback(()=>{
//     const el=messagesAreaRef.current;
//     if(!el)return;
//     if(el.scrollTop>maxScrollTopRef.current) maxScrollTopRef.current=el.scrollTop;
//     const isAtBottom=el.scrollHeight-el.scrollTop-el.clientHeight<80;
//     if(!isRestoringScroll.current){shouldScrollBottom.current=isAtBottom;setShowJumpToBottom(!isAtBottom);}
//     if(el.scrollTop<60&&maxScrollTopRef.current>200&&el.scrollTop<maxScrollTopRef.current-100&&!state.loadingMore&&state.hasMore){
//       savedScrollHeightRef.current=el.scrollHeight;
//       shouldScrollBottom.current=false;
//       void actions.loadOlderMessages();
//     }
//   },[state.loadingMore,state.hasMore,messagesAreaRef]);

//   const scrollToBottom = useCallback(()=>scrollToBottomNow('smooth'),[scrollToBottomNow]);

//   // ── sendRealMessage: send via real WS, switch to free flow ────────────────
//   const sendRealMessage = useCallback((content: string) => {
//     if (!stateRef.current.connected || stateRef.current.tokenExpired) return;
//     try {
//       void actionsRef.current.sendMessage(content, 'TEXT');
//       setFlowStep('free');
//       setShowQuickReplies(false);
//     } catch(err: any) {
//       if (err?.message==='TOKEN_EXPIRED') return;
//       throw err;
//     }
//   }, []);

//   // ── Handle main menu selection ────────────────────────────────────────────
//   const handleQuickReply = useCallback(async (reply: QuickReply) => {
//     setShowQuickReplies(false);
//     setEscalationError(null);

//     switch (reply.id) {
//       // These two → send the label text to the AI agent as a real message
//       case 'order_details':
//       case 'track_order':
//         sendRealMessage(reply.label);
//         break;

//       // FAQ → show the FAQ screen (no message sent yet, user picks a question)
//       case 'faq':
//         setFlowStep('faq');
//         break;

//       // Human agent → escalation flow (unchanged)
//       case 'human': {
//         setFlowStep('escalating');
//         try {
//           const sessionId = await waitForSession();
//           await escalateToAgent(sessionId, 'Customer requested human agent');
//           setFlowStep('free');
//         } catch(err: any) {
//           setEscalationError(err?.message ?? 'Could not connect. Please try again.');
//           setFlowStep('menu');
//           setTimeout(()=>setShowQuickReplies(true), 500);
//         }
//         break;
//       }
//     }
//   }, [sendRealMessage, waitForSession, escalateToAgent]);

//   // ── Handle FAQ item selection → send to AI as a real message ─────────────
//   const handleFaqSelect = useCallback((faq: QuickReply) => {
//     sendRealMessage(faq.label);
//   }, [sendRealMessage]);

//   const handleSend = useCallback(()=>{
//     const content=inputValue.trim();
//     if(!content||!stateRef.current.connected||stateRef.current.tokenExpired)return;
//     try{
//       void actionsRef.current.sendMessage(content,'TEXT',replyTarget?.id);
//       setInputValue('');
//       setReplyTarget(null);
//       actionsRef.current.stopTyping?.();
//       if(flowStep!=='free'){setShowQuickReplies(false);setFlowStep('free');}
//     }catch(err:any){if(err?.message==='TOKEN_EXPIRED')return;throw err;}
//   },[inputValue,flowStep,replyTarget]);

//   const handleEndChat = useCallback(async()=>{
//     setShowEndConfirm(false);setEndingChat(true);
//     const sessionId=stateRef.current.session?.id;
//     const cfg=configRef.current;
//     if(sessionId){try{await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/close`,{method:'POST',headers:{'Authorization':`Bearer ${cfg.token}`,'X-Tenant-ID':cfg.tenantId,'Content-Type':'application/json'},body:JSON.stringify({closeReason:'MANUAL'})});}catch(e){console.warn('[Chat] End chat REST failed:',e);}}
//     setEndingChat(false);setShowFeedback(true);
//   },[]);

//   const handleKeyDown = useCallback((e:React.KeyboardEvent)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();} },[handleSend]);

//   const handleAttachment = useCallback(async(e:React.ChangeEvent<HTMLInputElement>)=>{
//     const file=e.target.files?.[0];
//     if(!file||stateRef.current.tokenExpired)return;
//     try{await actionsRef.current.sendAttachment(file);}catch(err:any){console.error('[Chat] Attachment upload failed:',err);}
//     e.target.value='';
//   },[]);

//   const startRecording = useCallback(async()=>{
//     try{
//       const stream=await navigator.mediaDevices.getUserMedia({audio:true});
//       const recorder=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'audio/mp4'});
//       audioChunksRef.current=[];
//       recorder.ondataavailable=(e)=>{if(e.data.size>0)audioChunksRef.current.push(e.data);};
//       recorder.onstop=async()=>{
//         stream.getTracks().forEach(t=>t.stop());
//         const blob=new Blob(audioChunksRef.current,{type:recorder.mimeType});
//         const ext=recorder.mimeType.includes('webm')?'webm':'m4a';
//         const file=new File([blob],`voice-${Date.now()}.${ext}`,{type:recorder.mimeType});
//         try{await actionsRef.current.sendAttachment(file);}catch(err:any){console.error('[Chat] Audio upload failed:',err);}
//         setIsRecording(false);
//       };
//       recorder.start();mediaRecorderRef.current=recorder;setIsRecording(true);
//     }catch(err){console.error('[Chat] Microphone access denied:',err);}
//   },[]);

//   const stopRecording = useCallback(()=>{ if(mediaRecorderRef.current&&mediaRecorderRef.current.state!=='inactive') mediaRecorderRef.current.stop(); },[]);

//   // Typing dedup fix: only fire startTyping on the leading edge
//   const handleInputChange = useCallback((e:React.ChangeEvent<HTMLInputElement>)=>{
//     setInputValue(e.target.value);
//     if(typingTimeoutRef.current){
//       clearTimeout(typingTimeoutRef.current);
//     } else {
//       actionsRef.current.startTyping?.();
//     }
//     typingTimeoutRef.current=setTimeout(()=>{
//       actionsRef.current.stopTyping?.();
//       typingTimeoutRef.current=undefined;
//     },2000);
//   },[]);

//   const subtitle = (()=>{
//     if(state.tokenExpired)return'Session Expired';
//     if(state.loading)return'Connecting...';
//     if(flowStep==='escalating')return'Connecting to agent...';
//     const agentDisplayName=state.session?.assignedAgent?.displayName??state.session?.assignedAgentName;
//     if(agentDisplayName&&!looksLikeRawId(agentDisplayName))return`Chatting with ${agentDisplayName}`;
//     if(state.session?.mode==='HUMAN')return'Connected to agent';
//     return'AI Support · Online';
//   })();

//   const isClosed = state.session?.status==='CLOSED';
//   const canType  = !isClosed&&!state.tokenExpired&&state.connected&&flowStep!=='escalating';
//   const isActive = !!inputValue.trim()&&canType;

//   if(state.loading) return(
//     <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme}/>
//       <div style={styles.centeredBox}><svg width="36" height="36" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg><span style={{fontSize:13,color:'#9ca3af'}}>Starting chat...</span></div>
//     </div>
//   );
//   if(state.tokenExpired) return(
//     <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Session Expired" theme={theme}/>
//       <div style={styles.centeredBox}><div style={{fontSize:40}}>⏳</div><div><div style={{fontWeight:700,fontSize:15,color:'#1a1a2e',marginBottom:6}}>Session Expired</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.5}}>Your session has expired. Please refresh to continue chatting.</div></div><button onClick={()=>window.location.reload()} style={{padding:'10px 28px',borderRadius:22,border:'none',background:theme.primaryColor,color:'white',fontWeight:700,cursor:'pointer',fontSize:14,fontFamily:'inherit'}}>Refresh Page</button></div>
//     </div>
//   );
//   if(state.error&&!state.connected) return(
//     <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme}/>
//       <div style={styles.centeredBox}><div style={{fontSize:40}}>⚠️</div><div><div style={{fontWeight:700,fontSize:15,color:'#1a1a2e',marginBottom:6}}>Connection Lost</div><div style={{fontSize:13,color:'#6b7280'}}>{state.error.message}</div></div><button onClick={()=>actionsRef.current.reconnect?.()} style={{padding:'10px 28px',borderRadius:22,border:'none',background:theme.primaryColor,color:'white',fontWeight:700,cursor:'pointer',fontSize:14,fontFamily:'inherit'}}>Retry</button></div>
//     </div>
//   );

//   return (
//     <div style={{...styles.widget,position:'relative' as const}}>
//       <WidgetHeader onClose={onClose} styles={styles}
//         subtitle={showHistory?'Chat History':(endingChat?'Ending session…':subtitle)} theme={theme}
//         showEndChat={!showHistory&&!isClosed&&!showFeedback&&state.connected&&flowStep!=='escalating'}
//         onEndChat={()=>setShowEndConfirm(true)}
//         onHistory={()=>setShowHistory(p=>!p)} showHistory={showHistory}/>

//       {showHistory&&(
//         <SessionHistoryPanel primaryColor={theme.primaryColor} sessions={state.pastSessions} currentSessionId={state.session?.id}
//           onSelectActive={()=>setShowHistory(false)}
//           onReopen={async(sessionId)=>{await actionsRef.current.reopenSession?.(sessionId);setShowHistory(false);}}
//           onBack={()=>setShowHistory(false)}/>
//       )}

//       {!showHistory&&(
//         <>
//           {showEndConfirm&&<EndChatConfirmModal primaryColor={theme.primaryColor} onConfirm={handleEndChat} onCancel={()=>setShowEndConfirm(false)}/>}

//           {showFeedback?(
//             <FeedbackModal primaryColor={theme.primaryColor}
//               onSubmit={()=>{setShowFeedback(false);onClose();onStartNewChat?.();}}
//               onSkip={()=>{setShowFeedback(false);onClose();onStartNewChat?.();}}/>
//           ):flowStep==='escalating'?(
//             <EscalatingScreen primaryColor={theme.primaryColor}/>
//           ):(
//             <>
//               {/* ── Message list ──────────────────────────────────────── */}
//               <div style={{...styles.messages,position:'relative' as const}} ref={messagesAreaRef} onScroll={handleMessagesScroll}>
//                 {state.loadingMore&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'10px 0 6px',gap:'8px'}}><SpinnerIcon color={theme.primaryColor} size={16}/><span style={{fontSize:'11px',color:'#9ca3af'}}>Loading older messages…</span></div>}
//                 {!state.hasMore&&allMessages.length>0&&!state.loadingMore&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 0 12px'}}><span style={{fontSize:'10px',fontWeight:600,color:'#c4b5fd',backgroundColor:'#f3eeff',padding:'3px 12px',borderRadius:'10px'}}>Beginning of conversation</span></div>}
//                 {allMessages.map(msg=>{
//                   const isNew=hasRenderedOnce.current&&!renderedMsgIds.current.has(msg.id);
//                   return(
//                     <div key={msg.id} id={`chat-msg-${msg.id}`} style={isNew?{animation:'chatFadeIn 0.2s ease',borderRadius:'12px'}:{borderRadius:'12px'}}>
//                       <MessageBubble message={msg} styles={styles} userName={config.user.name} onImageClick={handleImageClick} onReply={handleReply}
//                         replyToResolved={msg.replyToMessageId?msgByIdMap.get(msg.replyToMessageId)??null:null}
//                         tickStatus={tickMap.get(msg.id)??'none'} primaryColor={theme.primaryColor}/>
//                     </div>
//                   );
//                 })}
//                 {state.isTyping&&<TypingIndicator styles={styles}/>}
//                 <div ref={messagesEndRef}/>
//               </div>

//               {showJumpToBottom&&(
//                 <div style={{position:'relative' as const,height:0,zIndex:10}}>
//                   <button onClick={scrollToBottom} aria-label="Scroll to latest messages"
//                     style={{position:'absolute',bottom:'8px',right:'16px',width:'36px',height:'36px',borderRadius:'50%',backgroundColor:'#ffffff',border:'1px solid #e5e7eb',boxShadow:'0 2px 8px rgba(0,0,0,0.12)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:theme.primaryColor,transition:'all 0.15s'}}
//                     onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.backgroundColor=theme.primaryColor;(e.currentTarget as HTMLElement).style.color='#ffffff';}}
//                     onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.backgroundColor='#ffffff';(e.currentTarget as HTMLElement).style.color=theme.primaryColor;}}>
//                     <ChevronDownIcon/>
//                   </button>
//                   {unreadWhileScrolled>0&&<div style={{position:'absolute',bottom:'38px',right:'12px',background:theme.primaryColor,color:'#fff',fontSize:'10px',fontWeight:700,lineHeight:1,padding:'3px 6px',borderRadius:'10px',minWidth:'18px',textAlign:'center',boxShadow:`0 2px 6px ${theme.primaryColor}55`,pointerEvents:'none'}}>{unreadWhileScrolled>99?'99+':unreadWhileScrolled}</div>}
//                 </div>
//               )}

//               {escalationError&&(
//                 <div style={{margin:'8px 12px',padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,fontSize:12,color:'#dc2626',display:'flex',alignItems:'center',gap:8}}>
//                   <span>⚠️</span><span style={{flex:1}}>{escalationError}</span>
//                   <button onClick={()=>setEscalationError(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,lineHeight:1}}>×</button>
//                 </div>
//               )}

//               {/* ── FAQ screen ─────────────────────────────────────────── */}
//               {flowStep==='faq'&&(
//                 <FAQScreen primaryColor={theme.primaryColor} onSelect={handleFaqSelect} onBack={()=>{setFlowStep('menu');setShowQuickReplies(true);}}/>
//               )}

//               {/* ── Main menu ──────────────────────────────────────────── */}
//               {flowStep==='menu'&&showQuickReplies&&(
//                 <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} primaryColor={theme.primaryColor}/>
//               )}

//               {/* ── Closed / input area ─────────────────────────────────── */}
//               {isClosed?(
//                 (state as any).closeReason==='SWITCHED'?(
//                   <div style={{padding:'16px 14px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#fafafa'}}>
//                     <div style={{fontSize:28}}>⏸</div>
//                     <div style={{textAlign:'center'}}><div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:4}}>Chat on Hold</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>This chat was put on hold while you switched to another session.<br/>You can resume it from your chat history.</div></div>
//                     {onStartNewChat&&<button onClick={onStartNewChat} style={{padding:'10px 24px',borderRadius:22,border:'none',background:`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`,color:'white',fontWeight:700,cursor:'pointer',fontSize:13,fontFamily:'inherit'}}>+ Start New Chat</button>}
//                   </div>
//                 ):(
//                   <div style={{padding:'16px 14px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#fafafa'}}>
//                     <div style={{fontSize:28}}>✅</div>
//                     <div style={{textAlign:'center'}}><div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:4}}>Chat Ended</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>This session has been closed.<br/>Need more help?</div></div>
//                     {onStartNewChat&&<button onClick={onStartNewChat} style={{padding:'10px 24px',borderRadius:22,border:'none',background:`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`,color:'white',fontWeight:700,cursor:'pointer',fontSize:13,fontFamily:'inherit'}}>+ Start New Chat</button>}
//                   </div>
//                 )
//               ):(
//                 <div style={{flexShrink:0}}>
//                   {state.uploading&&<div style={{padding:'8px 14px',backgroundColor:theme.primaryColor+'10',borderTop:`1px solid ${theme.primaryColor}30`,display:'flex',alignItems:'center',gap:'8px'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}><circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg><div style={{flex:1,height:'3px',borderRadius:'2px',backgroundColor:theme.primaryColor+'25',overflow:'hidden'}}><div style={{height:'100%',borderRadius:'2px',backgroundColor:theme.primaryColor,animation:'chatUploadPulse 1.4s ease-in-out infinite'}}/></div><span style={{fontSize:'11px',color:theme.primaryColor,fontWeight:600,flexShrink:0}}>Uploading…</span></div>}
//                   {replyTarget&&(
//                     <div style={{padding:'8px 12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#f9fafb',display:'flex',alignItems:'center',gap:'8px'}}>
//                       <div style={{flex:1,borderLeft:`3px solid ${theme.primaryColor}`,paddingLeft:'10px',overflow:'hidden'}}>
//                         <div style={{fontSize:'11px',fontWeight:700,color:theme.primaryColor,marginBottom:'1px'}}>{replyTarget.senderType==='CUSTOMER'?'You':(replyTarget.senderName||'Agent')}</div>
//                         <div style={{fontSize:'12px',color:'#6b7280',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{replyTarget.content?.length>80?replyTarget.content.slice(0,80)+'…':replyTarget.content}</div>
//                       </div>
//                       <button onClick={()=>setReplyTarget(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:'18px',lineHeight:1,padding:'2px',flexShrink:0}}>×</button>
//                     </div>
//                   )}
//                   <div style={styles.inputArea}>
//                     <input type="file" ref={fileInputRef} style={{display:'none'}} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={handleAttachment}/>
//                     <button onClick={()=>fileInputRef.current?.click()} disabled={!canType||state.uploading} title="Attach file"
//                       style={{background:'none',border:'none',cursor:(canType&&!state.uploading)?'pointer':'not-allowed',padding:'4px',display:'flex',alignItems:'center',opacity:(canType&&!state.uploading)?0.6:0.3}}>
//                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
//                     </button>
//                     <button onClick={isRecording?stopRecording:startRecording} disabled={!canType||state.uploading}
//                       title={isRecording?'Stop recording':(state.uploading?'Uploading…':'Record audio')}
//                       style={{background:isRecording?'#ef4444':'none',border:isRecording?'2px solid #ef4444':'none',borderRadius:'50%',cursor:(canType&&!state.uploading)?'pointer':'not-allowed',padding:'4px',display:'flex',alignItems:'center',justifyContent:'center',opacity:(canType&&!state.uploading)?(isRecording?1:0.6):0.3,width:28,height:28,animation:isRecording?'pulse-recording 1.5s ease-in-out infinite':'none',transition:'all 0.2s'}}>
//                       {isRecording
//                         ?<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
//                         :<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
//                     </button>
//                     <input ref={inputRef} type="text"
//                       placeholder={state.uploading?'⏳ Uploading file, please wait...':canType?(isRecording?'🔴 Recording audio...':'Type a message...'):'Connecting...'}
//                       value={inputValue} onChange={handleInputChange} onKeyDown={handleKeyDown} disabled={!canType}
//                       style={{...styles.input,borderColor:inputValue?theme.primaryColor+'88':'#e5e7eb',opacity:canType?1:0.6}}/>
//                     <button onClick={handleSend} disabled={!isActive}
//                       style={{...styles.sendBtn,background:isActive?`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`:'#f3f4f6',boxShadow:isActive?`0 3px 12px ${theme.primaryColor}44`:'none',cursor:isActive?'pointer':'not-allowed'}}>
//                       <SendIcon active={!!isActive}/>
//                     </button>
//                   </div>
//                 </div>
//               )}
//             </>
//           )}
//         </>
//       )}

//       {viewerImage&&(
//         <div onClick={()=>setViewerImage(null)} style={{position:'fixed',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.85)',zIndex:100000,display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out'}}>
//           <button onClick={()=>setViewerImage(null)} style={{position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'50%',width:40,height:40,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:22,fontWeight:700,backdropFilter:'blur(4px)'}} aria-label="Close">×</button>
//           <a href={viewerImage.url} download={viewerImage.fileName} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{position:'absolute',top:16,right:68,background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'50%',width:40,height:40,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',backdropFilter:'blur(4px)',textDecoration:'none'}} aria-label="Download">
//             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
//           </a>
//           <div onClick={e=>e.stopPropagation()} style={{position:'absolute',top:20,left:16,right:120,color:'#fff',fontSize:13,fontWeight:500,opacity:0.8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{viewerImage.fileName}</div>
//           <img src={viewerImage.url} alt={viewerImage.fileName} onClick={e=>e.stopPropagation()} style={{maxWidth:'90vw',maxHeight:'85vh',objectFit:'contain',borderRadius:8,boxShadow:'0 8px 40px rgba(0,0,0,0.5)',cursor:'default'}}/>
//         </div>
//       )}
//     </div>
//   );
// }

// export default ChatWidget;




// ═══════════════════════════════════════════════════════════════════
// ChatWidget.tsx  ·  PATCHED BUILD  ·  v2026-03-20-menu-fix
// Changes vs previous:
//   - Removed dummy welcome bot message (backend sends its own)
//   - flowStep starts at 'menu', not 'welcome'
//   - Removed localMessages / botReply — no fake data shown
//   - Menu options (order_details, track_order) → sendRealMessage()
//   - faq option → shows FAQ screen; each FAQ item → sendRealMessage()
//   - human option → escalation flow unchanged
// ═══════════════════════════════════════════════════════════════════
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig, ChatMessage, ChatTheme, ChatSessionSummary } from './types';
import { playNotificationSound, unlockAudio } from './notificationSound';
import { buildTickMap, MessageTicks, type TickStatus } from './Messageticks';

// ==========================================
// Flow Types
// ==========================================

// 'menu'      → show quick-reply menu below messages
// 'faq'       → show FAQ list panel (replaces quick-replies slot)
// 'escalating'→ connecting to agent screen
// 'free'      → normal free-text chat
type FlowStep = 'menu' | 'faq' | 'escalating' | 'free';

interface QuickReply { id: string; label: string; icon: string; }
interface ReplyTarget { id: string; content: string; senderType: string; senderName?: string; }

const MAIN_MENU: QuickReply[] = [
  { id: 'order_details', icon: '📦', label: 'Check Order Details' },
  { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
  { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
  { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
];

// FAQ items — clicking any of them sends the label to the AI agent as a message
const FAQ_ITEMS: QuickReply[] = [
  { id: 'faq_return',   icon: '🔄', label: 'How do I return an item?' },
  { id: 'faq_refund',   icon: '💰', label: 'When will I get my refund?' },
  { id: 'faq_address',  icon: '📍', label: 'How do I change my delivery address?' },
  { id: 'faq_cancel',   icon: '❌', label: 'How do I cancel my order?' },
  { id: 'faq_track',    icon: '🚚', label: 'How do I track my order?' },
  { id: 'faq_payment',  icon: '💳', label: 'What payment methods are accepted?' },
  { id: 'faq_contact',  icon: '📞', label: 'How do I contact support?' },
];

// ==========================================
// Theme
// ==========================================

const defaultTheme = {
  primaryColor:        '#5b4fcf',
  headerBackground:    '#5b4fcf',
  headerText:          '#ffffff',
  customerBubbleColor: '#5b4fcf',
  agentBubbleColor:    '#f0effe',
  fontFamily:          '"Outfit", "DM Sans", system-ui, sans-serif',
  borderRadius:        '16px',
  position:            'bottom-right' as 'bottom-right' | 'bottom-left',
};
type FullTheme = typeof defaultTheme;

function getStyles(theme: ChatTheme = {}): Record<string, React.CSSProperties> {
  const t: FullTheme = { ...defaultTheme, ...theme };
  const isRight = (t.position as string) !== 'bottom-left';
  return {
    container:         { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
    launcher:          { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
    widget:            { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
    header:            { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
    headerAvatar:      { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
    headerInfo:        { flex: 1 },
    headerTitle:       { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
    headerSub:         { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
    onlineDot:         { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
    closeBtn:          { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    messages:          { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
    bubbleCustomer:    { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
    bubbleAgent:       { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
    bubbleSystem:      { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
    senderLabel:       { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
    timestamp:         { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
    typingWrap:        { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
    typingDot:         { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
    inputArea:         { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0, position: 'relative' as const },
    input:             { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
    sendBtn:           { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
    centeredBox:       { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
  };
}

// ==========================================
// Icons
// ==========================================

const ChatIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="white" opacity="0.95" />
    <circle cx="8" cy="10" r="1" fill="rgba(255,255,255,0.5)" />
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
const BackIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
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
const PhoneDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-3.33"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

// ==========================================
// Helpers
// ==========================================

// function looksLikeRawId(s: string | undefined): boolean {
//   if (!s) return false;
//   // Long hex/UUID strings (Cognito sub, UUID without hyphens)
//   if (/^[0-9a-fA-F-]{20,}$/.test(s)) return true;
//   // Pure numeric strings — phone numbers, user IDs (e.g. "8585081497")
//   if (/^\d{6,}$/.test(s)) return true;
//   // Cognito given_name encoded format: "tenantId::roleId::userId" or "3::1::12775"
//   if (/^\d+::\d+::\d+$/.test(s)) return true;
//   // Email addresses that leaked through
//   if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
//   return false;
// }

function looksLikeRawId(s: string | undefined): boolean {
  if (!s) return false;
  if (/^[0-9a-fA-F-]{20,}$/.test(s)) return true;
  if (/^\d{6,}$/.test(s)) return true;
  if (/^\d+::\d+::\d+$/.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^(ADMIN|AGENT|BOT|SYSTEM)\d*$/i.test(s)) return true;
  return false;
}

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

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

const CompactAudioPlayer = React.memo(function CompactAudioPlayer({ src, isCustomer }: { src: string; isCustomer: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]   = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [current, setCurrent]   = React.useState(0);
  const toggle = () => { const a = audioRef.current; if (!a) return; playing ? a.pause() : a.play(); };
  const fmt = (s: number) => (!isFinite(s) || isNaN(s)) ? '0:00' : `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  const accent  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';
  const trackBg = isCustomer ? 'rgba(255,255,255,0.25)' : '#e5e7eb';
  const fillBg  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '210px', height: '40px' }}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrent(0); }}
        onTimeUpdate={() => { const a = audioRef.current; if (!a?.duration) return; setCurrent(a.currentTime); setProgress(a.currentTime/a.duration); }}
        onLoadedMetadata={() => { const a = audioRef.current; if (a) setDuration(a.duration); }} />
      <button onClick={toggle} style={{ flexShrink: 0, width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${accent}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, padding: 0 }}>
        {playing
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ height: '3px', borderRadius: '2px', background: trackBg, cursor: 'pointer', position: 'relative' }}
          onClick={e => { const a = audioRef.current; if (!a?.duration) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * a.duration; }}>
          <div style={{ height: '100%', width: `${progress*100}%`, background: fillBg, borderRadius: '2px', transition: 'width 0.1s linear' }} />
        </div>
        <div style={{ fontSize: '9px', color: accent, opacity: 0.8, lineHeight: 1 }}>{fmt(current)} / {fmt(duration||0)}</div>
      </div>
    </div>
  );
});

function CustomerTick({ status }: { status: TickStatus }) {
  if (status === 'none') return null;
  const W = 'rgba(255,255,255,0.95)', Wm = 'rgba(255,255,255,0.65)';
  const Single = () => <svg width="14" height="10" viewBox="0 0 14 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}><polyline points="1,5 5,9 13,1" stroke={Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  const Double = ({ bright }: { bright: boolean }) => <svg width="18" height="10" viewBox="0 0 18 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}><polyline points="5,5 9,9 17,1" stroke={bright?W:Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><polyline points="1,5 5,9 13,1" stroke={bright?W:Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (status === 'sent')      return <Single />;
  if (status === 'delivered') return <Double bright={false} />;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Double bright /><span style={{ fontSize: 9, fontWeight: 700, color: W, lineHeight: 1 }}>Seen</span></span>;
}

const MessageBubble = React.memo(function MessageBubble({
  message, styles, onImageClick, onReply, replyToResolved, tickStatus, primaryColor,
}: {
  message: ChatMessage; styles: Record<string, React.CSSProperties>; userName?: string;
  onImageClick?: (url: string, fn: string) => void; onReply?: (m: ChatMessage) => void;
  replyToResolved?: ChatMessage | null; tickStatus: TickStatus; primaryColor: string;
}) {
  const isCustomer = message.senderType === 'CUSTOMER';
  const isSystem   = message.senderType === 'SYSTEM';
  const isBot      = message.senderType === 'BOT';
  const time = formatTime(message.timestamp);
  const [hovered, setHovered] = useState(false);

  if (isSystem && looksLikeRawId(message.content?.trim())) return null;
  if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

  const rawName    = message.senderName;
  const agentLabel = (rawName && !looksLikeRawId(rawName)) ? rawName : 'Agent';
  const label      = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

  const attachment = message.attachment ?? (message.metadata?.attachment as any) ?? null;
  const contentUrl = message.content ?? '';
  const isImageUrl = /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(contentUrl);
  const isVideoUrl = /\.(mp4|mov|avi|mkv|flv|wmv)(\?.*)?$/i.test(contentUrl);
  const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)(\?.*)?$/i.test(contentUrl) || /\/audio\//i.test(contentUrl);
  const isFileUrl  = /^https?:\/\//i.test(contentUrl);

  let effectiveType: 'IMAGE'|'VIDEO'|'AUDIO'|'FILE'|null = null;
  if      (message.messageType==='IMAGE') effectiveType='IMAGE';
  else if (message.messageType==='VIDEO') effectiveType='VIDEO';
  else if (message.messageType==='AUDIO') effectiveType='AUDIO';
  else if (message.messageType==='FILE')  effectiveType='FILE';
  else if (attachment?.mimeType?.startsWith('image/')) effectiveType='IMAGE';
  else if (attachment?.mimeType?.startsWith('video/')) effectiveType='VIDEO';
  else if (attachment?.mimeType?.startsWith('audio/')) effectiveType='AUDIO';
  else if (isImageUrl) effectiveType='IMAGE';
  else if (isVideoUrl) effectiveType='VIDEO';
  else if (isAudioUrl) effectiveType='AUDIO';
  else if (attachment||(isFileUrl&&contentUrl.includes('/')&&!contentUrl.includes(' '))) effectiveType='FILE';

  const isAttachment = effectiveType !== null;
  const isAudio = effectiveType === 'AUDIO';
  const replyTo = message.replyToMessage ?? replyToResolved ?? null;

  const renderReplyQuote = () => {
    if (!replyTo) return null;
    const rName = replyTo.senderType==='CUSTOMER' ? 'You' : ((replyTo as any).senderName ?? (replyTo.senderType==='BOT' ? 'AI Assistant' : 'Agent'));
    const isMedia = ['IMAGE','VIDEO','AUDIO','FILE'].includes(replyTo.messageType);
    const preview = isMedia ? `📎 ${replyTo.messageType.charAt(0)+replyTo.messageType.slice(1).toLowerCase()}` : (replyTo.content?.length>60?replyTo.content.slice(0,60)+'…':replyTo.content);
    return (
      <div style={{ padding:'6px 10px', marginBottom:'6px', borderLeft:`3px solid ${isCustomer?'rgba(255,255,255,0.5)':'#7c3aed'}`, borderRadius:'4px', backgroundColor:isCustomer?'rgba(255,255,255,0.12)':'#f5f3ff', fontSize:'11px', lineHeight:'1.4', cursor:'pointer' }}
        onClick={e => { e.stopPropagation(); const el=document.getElementById(`chat-msg-${replyTo!.id}`); if(el){el.scrollIntoView({behavior:'smooth',block:'center'}); el.animate([{backgroundColor:'transparent'},{backgroundColor:isCustomer?'rgba(124,58,237,0.15)':'#ede9fe'},{backgroundColor:isCustomer?'rgba(124,58,237,0.15)':'#ede9fe'},{backgroundColor:'transparent'}],{duration:2000,easing:'ease-in-out'});}}}>
        <div style={{ fontWeight:700, color:isCustomer?'rgba(255,255,255,0.85)':'#7c3aed', marginBottom:'2px' }}>{rName}</div>
        <div style={{ color:isCustomer?'rgba(255,255,255,0.7)':'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{preview}</div>
      </div>
    );
  };

  const renderAttachment = () => {
    const url = attachment?.url ?? contentUrl;
    const fileName = attachment?.fileName ?? url.split('/').pop()?.split('?')[0] ?? 'file';
    if (effectiveType==='IMAGE') return <div style={{cursor:'pointer'}} onClick={()=>onImageClick?.(url,fileName)}><img src={url} alt={fileName} style={{maxWidth:'220px',maxHeight:'180px',borderRadius:'12px',objectFit:'cover',display:'block'}} loading="lazy"/></div>;
    if (effectiveType==='VIDEO') return <video src={url} controls style={{maxWidth:'240px',maxHeight:'180px',borderRadius:'12px'}} preload="metadata"/>;
    if (effectiveType==='AUDIO') return <CompactAudioPlayer src={url} isCustomer={isCustomer}/>;
    return <a href={url} target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px',borderRadius:'10px',backgroundColor:isCustomer?'rgba(255,255,255,0.15)':'#f3f4f6',color:isCustomer?'#fff':'#5b4fcf',fontSize:'13px',fontWeight:600,textDecoration:'none'}}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
      <span style={{maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fileName}</span>
    </a>;
  };

  const bubbleStyle: React.CSSProperties = isAudio
    ? { ...(isCustomer?{background:styles.bubbleCustomer.background??'#5b4fcf',borderRadius:'18px 18px 4px 18px'}:{background:'#ffffff',border:'1px solid #ede9fe',borderRadius:'18px 18px 18px 4px'}), padding:'8px 10px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', display:'flex', flexDirection:'column' as const, gap:'2px' }
    : (isCustomer ? styles.bubbleCustomer : styles.bubbleAgent);

  const Timestamps = () => isCustomer
    ? <div style={{...styles.timestamp,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:3}}><span>{time}</span><CustomerTick status={tickStatus}/></div>
    : <div style={{...styles.timestamp,textAlign:'left'}}>{time}</div>;

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:isCustomer?'flex-end':'flex-start'}} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
      {label && <div style={styles.senderLabel}>{label}</div>}
      <div style={{position:'relative',...(isAudio?{width:'fit-content'}:{maxWidth:'82%'})}}>
        <div style={{...bubbleStyle,...(isAudio?{}:{maxWidth:'100%'})}}>
          {renderReplyQuote()}
          {isAttachment ? renderAttachment() : message.content}
          <Timestamps />
        </div>
        {onReply && (
          <button onClick={()=>onReply(message)} title="Reply"
            style={{position:'absolute',top:'50%',...(isCustomer?{left:'-32px'}:{right:'-32px'}),transform:'translateY(-50%)',background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:'50%',width:26,height:26,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#6b7280',flexShrink:0,transition:'opacity 0.15s',padding:0,opacity:hovered?1:0,pointerEvents:hovered?'auto' as const:'none' as const}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#ede9fe';(e.currentTarget as HTMLElement).style.color='#5b4fcf';}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#f3f4f6';(e.currentTarget as HTMLElement).style.color='#6b7280';}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
          </button>
        )}
      </div>
    </div>
  );
});

// ── Main menu quick replies ────────────────────────────────────────────────────
function QuickReplies({ replies, onSelect, primaryColor }: {
  replies: QuickReply[]; onSelect: (r: QuickReply) => void; primaryColor: string;
}) {
  return (
    <div style={{ padding:'10px 14px 12px', display:'flex', flexDirection:'column', gap:'8px', backgroundColor:'#fafafa', borderTop:'1px solid #f0f0f0', flexShrink: 0 }}>
      <div style={{ fontSize:'11px', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>How can we help?</div>
      {replies.map(r => (
        <button key={r.id}
          style={{ width:'100%', padding:'10px 16px', borderRadius:'12px', border:'1.5px solid #e0d9ff', backgroundColor:'#ffffff', color: primaryColor, cursor:'pointer', fontSize:'13px', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:'8px', textAlign:'left', transition:'all 0.15s' }}
          onClick={() => onSelect(r)}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor=primaryColor; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ffffff'; (e.currentTarget as HTMLElement).style.borderColor='#e0d9ff'; }}>
          <span style={{ fontSize:16 }}>{r.icon}</span>
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── FAQ screen ────────────────────────────────────────────────────────────────
function FAQScreen({ primaryColor, onSelect, onBack }: {
  primaryColor: string; onSelect: (faq: QuickReply) => void; onBack: () => void;
}) {
  return (
    <div style={{ borderTop:'1px solid #f0f0f0', flexShrink:0, backgroundColor:'#fafafa' }}>
      <button onClick={onBack}
        style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px 4px', background:'none', border:'none', cursor:'pointer', color:primaryColor, fontSize:'12px', fontWeight:600, fontFamily:'inherit' }}>
        <BackIcon /> Back to menu
      </button>
      <div style={{ padding:'2px 14px 6px', fontSize:'11px', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>
        Frequently Asked Questions
      </div>
      <div style={{ maxHeight:'230px', overflowY:'auto', padding:'0 14px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
        {FAQ_ITEMS.map(faq => (
          <button key={faq.id}
            style={{ width:'100%', padding:'9px 14px', borderRadius:'10px', border:'1.5px solid #e0d9ff', backgroundColor:'#ffffff', color:primaryColor, cursor:'pointer', fontSize:'13px', fontWeight:500, fontFamily:'inherit', display:'flex', alignItems:'center', gap:'8px', textAlign:'left', transition:'all 0.15s' }}
            onClick={() => onSelect(faq)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor=primaryColor; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor='#ffffff'; (e.currentTarget as HTMLElement).style.borderColor='#e0d9ff'; }}>
            <span style={{ fontSize:15 }}>{faq.icon}</span>
            <span>{faq.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EscalatingScreen({ primaryColor }: { primaryColor: string }) {
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'16px', padding:'32px', backgroundColor:'#fafafa', textAlign:'center' }}>
      <div style={{ fontSize:52 }}>👤</div>
      <div>
        <div style={{ fontWeight:700, fontSize:16, color:'#1a1a2e', marginBottom:8 }}>Connecting you to an agent</div>
        <div style={{ fontSize:13, color:'#6b7280', lineHeight:1.7 }}>You've been added to the support queue.<br/>An agent will join shortly.</div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        {[0,0.2,0.4].map((d,i)=><div key={i} style={{width:9,height:9,borderRadius:'50%',backgroundColor:primaryColor,animation:`chatTypingBounce 1.2s ${d}s infinite ease-in-out`}}/>)}
      </div>
      <div style={{ padding:'8px 20px', borderRadius:20, backgroundColor:'#ede9fe', color:primaryColor, fontSize:12, fontWeight:700 }}>Est. wait: &lt; 2 min</div>
    </div>
  );
}

function FeedbackModal({ primaryColor, onSubmit, onSkip }: { primaryColor:string; onSubmit:(r:number,c:string)=>void; onSkip:()=>void; }) {
  const [rating,setRating]=React.useState(0);
  const [hovered,setHovered]=React.useState(0);
  const [comment,setComment]=React.useState('');
  const [submitted,setSubmitted]=React.useState(false);
  const labels=['Terrible','Bad','Okay','Good','Excellent'];
  const handleSubmit=()=>{if(rating===0)return;setSubmitted(true);setTimeout(()=>onSubmit(rating,comment),900);};
  if(submitted) return <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'14px',padding:'32px',backgroundColor:'#fafafa'}}><div style={{fontSize:52}}>🎉</div><div style={{textAlign:'center'}}><div style={{fontSize:16,fontWeight:700,color:'#1a1a2e',marginBottom:6}}>Thank you!</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.6}}>Your feedback helps us improve.</div></div></div>;
  const active=hovered||rating;
  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',backgroundColor:'#fafafa',padding:'28px 24px 20px',gap:'20px'}}>
      <div style={{textAlign:'center'}}><div style={{fontSize:28,marginBottom:'10px'}}>⭐</div><div style={{fontSize:16,fontWeight:700,color:'#1a1a2e',marginBottom:4}}>How was your experience?</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>Your feedback helps us serve you better</div></div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
        <div style={{display:'flex',gap:'10px'}}>{[1,2,3,4,5].map(star=><button key={star} onClick={()=>setRating(star)} onMouseEnter={()=>setHovered(star)} onMouseLeave={()=>setHovered(0)} style={{background:'none',border:'none',cursor:'pointer',padding:'2px',fontSize:'32px',lineHeight:1,transition:'transform 0.15s',transform:active>=star?'scale(1.15)':'scale(1)',filter:active>=star?'drop-shadow(0 2px 4px rgba(234,179,8,0.4))':'grayscale(1) opacity(0.35)'}}>⭐</button>)}</div>
        {active>0 && <div style={{fontSize:'12px',fontWeight:600,color:primaryColor}}>{labels[active-1]}</div>}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
        <label style={{fontSize:'11px',fontWeight:600,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>Tell us more (optional)</label>
        <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="What could we do better?" rows={3} style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',borderRadius:'12px',border:`1.5px solid ${comment?primaryColor+'88':'#e5e7eb'}`,fontSize:'13px',fontFamily:'inherit',resize:'none',backgroundColor:'#ffffff',color:'#111827',outline:'none',transition:'border-color 0.2s',lineHeight:1.5}}/>
      </div>
      <div style={{display:'flex',gap:'10px'}}>
        <button onClick={onSkip} style={{flex:1,padding:'10px',borderRadius:'22px',border:'1.5px solid #e5e7eb',background:'#ffffff',color:'#6b7280',fontSize:'13px',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Skip</button>
        <button onClick={handleSubmit} disabled={rating===0} style={{flex:2,padding:'10px',borderRadius:'22px',border:'none',background:rating>0?`linear-gradient(135deg,${primaryColor},${primaryColor}cc)`:'#f3f4f6',color:rating>0?'#ffffff':'#9ca3af',fontSize:'13px',fontWeight:700,cursor:rating>0?'pointer':'not-allowed',fontFamily:'inherit'}}>Submit Feedback</button>
      </div>
    </div>
  );
}

function EndChatConfirmModal({ primaryColor, onConfirm, onCancel }: { primaryColor:string; onConfirm:()=>void; onCancel:()=>void; }) {
  return (
    <div style={{position:'absolute',inset:0,zIndex:50,backgroundColor:'rgba(0,0,0,0.35)',backdropFilter:'blur(2px)',display:'flex',alignItems:'flex-end'}}>
      <div style={{width:'100%',backgroundColor:'#ffffff',borderRadius:'20px 20px 0 0',padding:'24px 20px 28px',boxShadow:'0 -8px 32px rgba(0,0,0,0.15)',display:'flex',flexDirection:'column',gap:'16px',animation:'chatFadeIn 0.2s ease'}}>
        <div style={{width:36,height:4,borderRadius:2,backgroundColor:'#e5e7eb',alignSelf:'center',marginBottom:2}}/>
        <div style={{textAlign:'center'}}><div style={{fontSize:36,marginBottom:'10px'}}>👋</div><div style={{fontSize:15,fontWeight:700,color:'#1a1a2e',marginBottom:6}}>End this chat?</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.6}}>This will close your current session.<br/>You'll have a chance to leave feedback.</div></div>
        <div style={{display:'flex',gap:'10px',marginTop:4}}>
          <button onClick={onCancel} style={{flex:1,padding:'12px',borderRadius:'14px',border:'1.5px solid #e5e7eb',background:'#f9fafb',color:'#374151',fontSize:'14px',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Keep Chatting</button>
          <button onClick={onConfirm} style={{flex:1,padding:'12px',borderRadius:'14px',border:'none',background:'linear-gradient(135deg,#ef4444,#dc2626)',color:'#ffffff',fontSize:'14px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>End Chat</button>
        </div>
      </div>
    </div>
  );
}

function WidgetHeader({ onClose, styles, subtitle, theme, onEndChat, showEndChat, onHistory, showHistory }: {
  onClose:()=>void; styles:Record<string,React.CSSProperties>; subtitle:string; theme:FullTheme;
  onEndChat?:()=>void; showEndChat?:boolean; onHistory?:()=>void; showHistory?:boolean;
}) {
  return (
    <div style={styles.header}>
      <div style={styles.headerAvatar}>💬</div>
      <div style={styles.headerInfo}><h3 style={styles.headerTitle}>Chat Support</h3><div style={styles.headerSub}><span style={styles.onlineDot}/>{subtitle}</div></div>
      {onHistory && <button onClick={onHistory} title={showHistory?'Back to chat':'Chat history'} style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:theme.headerText,cursor:'pointer',padding:'6px 8px',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',marginRight:'4px',transition:'all 0.15s'}} onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.22)';}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.12)';}}>
        {showHistory?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
      </button>}
      {showEndChat && onEndChat && <button onClick={onEndChat} title="End chat" style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:theme.headerText,cursor:'pointer',padding:'6px 10px',borderRadius:'8px',display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',fontWeight:600,marginRight:'6px',transition:'all 0.15s',letterSpacing:'0.02em'}} onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(239,68,68,0.3)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(239,68,68,0.5)';}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.12)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.25)';}}>
        <PhoneDownIcon/> End
      </button>}
      <button style={styles.closeBtn} onClick={onClose}><CloseIcon/></button>
    </div>
  );
}

function SessionHistoryPanel({ primaryColor, sessions, currentSessionId, onSelectActive, onReopen, onBack }: {
  primaryColor:string; sessions:ChatSessionSummary[]; currentSessionId?:string|null;
  onSelectActive:()=>void; onReopen:(id:string)=>Promise<void>; onBack:()=>void;
}) {
  const [reopening,setReopening]=useState<string|null>(null);
  const active=sessions.filter(s=>s.status!=='CLOSED');
  const closed=sessions.filter(s=>s.status==='CLOSED').slice(0,5);
  const formatDate=(d:string|Date|null|undefined)=>{if(!d)return'';const date=new Date(d);if(isNaN(date.getTime()))return'';const diff=Date.now()-date.getTime();if(diff<60000)return'Just now';if(diff<3600000)return`${Math.round(diff/60000)}m ago`;if(diff<86400000)return`${Math.round(diff/3600000)}h ago`;if(diff<7*86400000)return`${Math.round(diff/86400000)}d ago`;return date.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
  const handleReopen=async(id:string)=>{setReopening(id);try{await onReopen(id);}finally{setReopening(null);}};
  const badge=(status:string)=>{const map:Record<string,{label:string;bg:string;color:string}>={OPEN:{label:'Open',bg:'#dcfce7',color:'#166534'},WAITING_FOR_AGENT:{label:'Waiting',bg:'#fef9c3',color:'#854d0e'},ASSIGNED:{label:'Active',bg:'#dbeafe',color:'#1e40af'},CLOSED:{label:'Closed',bg:'#f3f4f6',color:'#6b7280'}};const s=map[status]??{label:status,bg:'#f3f4f6',color:'#6b7280'};return<span style={{display:'inline-block',padding:'2px 8px',borderRadius:'10px',fontSize:'10px',fontWeight:700,background:s.bg,color:s.color,letterSpacing:'0.03em'}}>{s.label}</span>;};
  const renderRow=(s:ChatSessionSummary,isAct:boolean)=>{const preview=s.lastMessage?.content?.trim();const previewText=preview?(preview.length>55?preview.slice(0,55)+'…':preview):'(no messages yet)';const isCurrent=s.id===currentSessionId;return(<div key={s.id} style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f5',display:'flex',flexDirection:'column',gap:'6px',backgroundColor:isCurrent?'#f9f7ff':'#ffffff'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px'}}><div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>{badge(s.status)}<span style={{fontSize:'11px',color:'#9ca3af'}}>{formatDate(s.closedAt??s.createdAt)}</span></div>{isAct?<button onClick={onSelectActive} style={{padding:'5px 12px',borderRadius:'14px',border:`1.5px solid ${primaryColor}`,background:isCurrent?primaryColor:'transparent',color:isCurrent?'#ffffff':primaryColor,fontSize:'11px',fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>{isCurrent?'Current ✓':'Continue'}</button>:<button onClick={()=>handleReopen(s.id)} disabled={reopening===s.id} style={{padding:'5px 12px',borderRadius:'14px',border:`1.5px solid ${primaryColor}`,background:'transparent',color:primaryColor,fontSize:'11px',fontWeight:700,cursor:reopening===s.id?'not-allowed':'pointer',fontFamily:'inherit',opacity:reopening===s.id?0.6:1,whiteSpace:'nowrap'}}>{reopening===s.id?'…':'Reopen'}</button>}</div><div style={{fontSize:'12px',color:'#6b7280',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{previewText}</div></div>);};
  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',backgroundColor:'#fafafa'}}>
      <div style={{padding:'12px 16px 4px',fontSize:'11px',fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',backgroundColor:'#fafafa'}}>Active</div>
      {active.length===0&&<div style={{padding:'12px 16px',fontSize:'13px',color:'#c4b5fd',textAlign:'center'}}>No active sessions</div>}
      {active.map(s=>renderRow(s,true))}
      <div style={{padding:'12px 16px 4px',fontSize:'11px',fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',backgroundColor:'#fafafa',borderTop:'1px solid #f0f0f5',marginTop:'4px'}}>Closed</div>
      <div style={{flex:1,overflowY:'auto' as const}}>
        {closed.length===0&&<div style={{padding:'16px',fontSize:'13px',color:'#c4b5fd',textAlign:'center'}}>No closed sessions yet</div>}
        {closed.map(s=>renderRow(s,false))}
      </div>
    </div>
  );
}

// ==========================================
// ChatWidget — public entry point
// ==========================================

export interface ChatWidgetProps { config: ChatSDKConfig; defaultOpen?: boolean; }

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen]           = useState(defaultOpen);
  const [launchHover, setLaunchHover] = useState(false);
  const [chatKey, setChatKey]         = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [ticketId, setTicketId] = useState<string|null>(null);
const handleTicketChange = useCallback((id: string|null) => setTicketId(id), []);
  const theme: FullTheme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);
  const scrollToBottomRef = useRef<(()=>void)|null>(null);
  const handleStartNewChat = () => setChatKey(k => k+1);
  const handleUnreadChange = useCallback((count: number) => setUnreadCount(count), []);
  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(scrollToBottomRef.current) scrollToBottomRef.current(); }));
    prevIsOpen.current = isOpen;
  }, [isOpen]);
  return (
    <div style={styles.container}>
      {!isOpen && (
        <button style={{...styles.launcher,transform:launchHover?'scale(1.1)':'scale(1)',boxShadow:launchHover?`0 6px 28px ${theme.primaryColor}77`:`0 4px 20px ${theme.primaryColor}44`,position:'relative' as const}}
          onClick={()=>setIsOpen(true)} onMouseEnter={()=>setLaunchHover(true)} onMouseLeave={()=>setLaunchHover(false)} aria-label="Open chat support">
          <ChatIcon/>
          {unreadCount>0&&<span style={{position:'absolute',top:'-4px',right:'-4px',minWidth:'20px',height:'20px',borderRadius:'10px',backgroundColor:'#ef4444',color:'#ffffff',fontSize:'11px',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px',boxShadow:'0 2px 6px rgba(239,68,68,0.5)',border:'2px solid #ffffff',fontFamily:'system-ui,sans-serif',lineHeight:1}}>{unreadCount>99?'99+':unreadCount}</span>}


          {ticketId && (
  <span style={{
    position:'absolute', bottom:'-4px', left:'-4px',
    backgroundColor:'#7c3aed', color:'#fff',
    fontSize:'9px', fontWeight:700,
    padding:'2px 5px', borderRadius:'8px',
    border:'2px solid #fff', lineHeight:1.2,
    whiteSpace:'nowrap',
    boxShadow:'0 2px 6px rgba(124,58,237,0.5)',
  }}>
    🎫 #{ticketId}
  </span>
)}
        </button>
      )}
      <ChatProvider config={config} key={chatKey}>
       <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange} onTicketChange={handleTicketChange}/>
        <div style={{display:isOpen?'block':'none'}}>
          <ChatContentWithScrollRef onClose={()=>setIsOpen(false)} styles={styles} config={config} theme={theme} onStartNewChat={handleStartNewChat} scrollToBottomRef={scrollToBottomRef}/>
        </div>
      </ChatProvider>
    </div>
  );
}

// function UnreadTracker({ isOpen, onUnreadChange }: { isOpen:boolean; onUnreadChange:(c:number)=>void; }) {
//   const { state, actions } = useChat();
//   const setWidgetOpenRef = useRef(actions.setWidgetOpen);
//   setWidgetOpenRef.current = actions.setWidgetOpen;
//   useEffect(() => { setWidgetOpenRef.current(isOpen); }, [isOpen]);
//   useEffect(() => { onUnreadChange(state.unreadCount); }, [state.unreadCount, onUnreadChange]);
//   return null;
// }

function UnreadTracker({ isOpen, onUnreadChange, onTicketChange }: {
  isOpen: boolean;
  onUnreadChange: (c: number) => void;
  onTicketChange: (id: string|null) => void;
}) {
  const { state, actions } = useChat();
  const setWidgetOpenRef = useRef(actions.setWidgetOpen);
  setWidgetOpenRef.current = actions.setWidgetOpen;
  useEffect(() => { setWidgetOpenRef.current(isOpen); }, [isOpen]);
  useEffect(() => { onUnreadChange(state.unreadCount); }, [state.unreadCount, onUnreadChange]);
  useEffect(() => {
    onTicketChange((state.session as any)?.ticketId ?? null);
  }, [(state.session as any)?.ticketId, onTicketChange]);
  return null;
}

function ChatContentWithScrollRef({ scrollToBottomRef, ...props }: {
  onClose:()=>void; styles:Record<string,React.CSSProperties>;
  config:ChatSDKConfig; theme:FullTheme; onStartNewChat?:()=>void;
  scrollToBottomRef:React.MutableRefObject<(()=>void)|null>;
}) {
  const localMessagesAreaRef = useRef<HTMLDivElement|null>(null);
  useEffect(() => {
    scrollToBottomRef.current = () => { const el=localMessagesAreaRef.current; if(el) el.scrollTop=el.scrollHeight; };
    return () => { scrollToBottomRef.current=null; };
  }, [scrollToBottomRef]);
  return <ChatContentInner {...props} externalMessagesAreaRef={localMessagesAreaRef}/>;
}

// ==========================================
// ChatContentInner — main logic
// ==========================================

function ChatContentInner({ onClose, styles, config, theme, onStartNewChat, externalMessagesAreaRef }: {
  onClose:()=>void; styles:Record<string,React.CSSProperties>;
  config:ChatSDKConfig; theme:FullTheme; onStartNewChat?:()=>void;
  externalMessagesAreaRef:React.MutableRefObject<HTMLDivElement|null>;
}): JSX.Element {
  const { state, actions } = useChat();

  const [inputValue, setInputValue]              = useState('');
  // Start at 'menu' — no fake welcome message. Backend sends its own welcome.
  // Switch to 'free' once we detect existing history or an agent is assigned.
  const [flowStep, setFlowStep]                  = useState<FlowStep>('menu');
  const [showQuickReplies, setShowQuickReplies]  = useState(true);
  const [escalationError, setEscalationError]    = useState<string|null>(null);
  const [viewerImage, setViewerImage]            = useState<{url:string;fileName:string}|null>(null);
  const [isRecording, setIsRecording]            = useState(false);
  const [replyTarget, setReplyTarget]            = useState<ReplyTarget|null>(null);
  const [showEndConfirm, setShowEndConfirm]      = useState(false);
  const [showFeedback, setShowFeedback]          = useState(false);
  const [endingChat, setEndingChat]              = useState(false);
  const [showHistory, setShowHistory]            = useState(false);

  const inputRef         = useRef<HTMLInputElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder|null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasInited        = useRef(false);
  const prevMsgCount     = useRef(0);
  const prevSoundCount   = useRef(0);

  const messagesAreaRef = externalMessagesAreaRef;
  const messagesEndRef  = useRef<HTMLDivElement>(null);

  const shouldScrollBottom    = useRef(true);
  const savedScrollHeightRef  = useRef(0);
  const prevMsgCountLayoutRef = useRef(0);
  const maxScrollTopRef       = useRef(0);
  const isRestoringScroll     = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom]       = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

  const renderedMsgIds  = useRef(new Set<string>());
  const hasRenderedOnce = useRef(false);

  const stateRef   = useRef(state);
  const actionsRef = useRef(actions);
  const configRef  = useRef(config);
  useEffect(() => { stateRef.current   = state;   }, [state]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { configRef.current  = config;  }, [config]);

  useEffect(() => {
    console.log('%c[ChatWidget] ✅ PATCHED BUILD LOADED v2026-03-20-menu-fix', 'background:#5b4fcf;color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold');
  }, []);

  useEffect(() => {
    const id = 'chat-sdk-kf';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      @keyframes chatTypingBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}
      @keyframes chatFadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse-recording{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
      @keyframes chatUploadPulse{0%{width:0%;margin-left:0%}50%{width:60%;margin-left:20%}100%{width:0%;margin-left:100%}}
    `;
    document.head.appendChild(s);
  }, []);

  // ── Decide initial flowStep once data loads ───────────────────────────────
  // If there's existing chat history or an agent is assigned → go straight to
  // 'free'. Otherwise show the menu immediately (backend already sent its own
  // welcome message so we don't add another one).
  useEffect(() => {
    if (!state.connected || state.loading) return;
    if (hasInited.current) return;
    hasInited.current = true;

    const sess = stateRef.current.session;
    const msgs = stateRef.current.messages;

    const hasAgentSession =
      sess?.status === 'ASSIGNED' ||
      sess?.status === 'WAITING_FOR_AGENT' ||
      sess?.mode   === 'HUMAN';

    const hasHistory =
      msgs.some(m => m.senderType === 'CUSTOMER') ||
      msgs.some(m => m.senderType === 'AGENT');

    if (hasAgentSession || hasHistory) {
      setFlowStep('free');
      setShowQuickReplies(false);
    } else {
      // Fresh session — show quick-reply menu, no fake message
      setFlowStep('menu');
      setShowQuickReplies(true);
    }
  }, [state.connected, state.loading]);

  useEffect(() => {
    if (flowStep === 'free') inputRef.current?.focus();
  }, [flowStep]);

  // Switch to free when any agent/bot reply arrives
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


  useEffect(() => {
  if (flowStep !== 'escalating') return;
  const status = state.session?.status;
  const mode   = state.session?.mode;
  if (status === 'ASSIGNED' || status === 'WAITING_FOR_AGENT' || mode === 'HUMAN') {
    setFlowStep('free');
    setShowQuickReplies(false);
  }
}, [state.session?.status, state.session?.mode, flowStep]);

  // Notification sound
  useEffect(() => {
    const newCount = state.messages.length;
    if (newCount > prevSoundCount.current) {
      const newMsgs = state.messages.slice(prevSoundCount.current);
      if (newMsgs.some(m => m.senderType==='AGENT'||m.senderType==='BOT') && !state.isWidgetOpen) playNotificationSound();
    }
    prevSoundCount.current = newCount;
  }, [state.messages.length, state.isWidgetOpen]);

  useEffect(() => {
    const unlock = () => { unlockAudio(); window.removeEventListener('click', unlock); };
    window.addEventListener('click', unlock);
    return () => window.removeEventListener('click', unlock);
  }, []);

  // useEffect(() => {
  //   if (state.isWidgetOpen && state.session?.id) actionsRef.current.markMessagesRead?.().catch(()=>{});
  // }, [state.isWidgetOpen, state.session?.id]);


//   useEffect(() => {
//   if (!state.isWidgetOpen || !state.session?.id) return;
//   const last = state.messages[state.messages.length - 1];
//   if (!last || (last.senderType !== 'AGENT' && last.senderType !== 'BOT')) return;
//   actionsRef.current.markMessagesRead?.().catch(() => {});
// }, [state.isWidgetOpen, state.session?.id, state.messages.length]);

//   useEffect(() => {
//     if (!state.isWidgetOpen || !state.session?.id) return;
//     const last = state.messages[state.messages.length-1];
//     if (last?.senderType==='AGENT'||last?.senderType==='BOT') actionsRef.current.markMessagesRead?.().catch(()=>{});
//   }, [state.messages.length]);


useEffect(() => {
  if (!state.isWidgetOpen || !state.session?.id) return;
  const t = setTimeout(() => {
    actionsRef.current.markMessagesRead?.().catch(() => {});
  }, 200);
  return () => clearTimeout(t);
}, [state.isWidgetOpen, state.session?.id, state.messages.length]);

  useEffect(() => {
    if (showHistory) actionsRef.current.fetchPastSessions?.().catch(()=>{});
  }, [showHistory]);

  const waitForSession = useCallback((): Promise<string> => {
    return new Promise((resolve,reject) => {
      if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
      const max=8000; const step=200; let elapsed=0;
      const t = setInterval(()=>{
        elapsed+=step;
        const id=stateRef.current.session?.id;
        if(id){clearInterval(t);resolve(id);}
        else if(elapsed>=max){clearInterval(t);reject(new Error('Session not ready — please try again'));}
      },step);
    });
  }, []);

  const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/escalate`, {
        method: 'POST',
        headers: { 'Authorization':`Bearer ${cfg.token}`, 'X-Tenant-ID':cfg.tenantId, 'Content-Type':'application/json' },
        body: JSON.stringify({ reason }),
      });
    } catch(e) { console.warn('[Chat] REST escalation failed:', e); }
   
  }, []);

  // All messages are purely from the real WS — no localMessages merging
  const allMessages = useMemo(() => {
    const seen = new Set<string>();
    const result: ChatMessage[] = [];
    for (const m of state.messages) { seen.add(m.id); result.push(m); }
    return result.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
  }, [state.messages]);

  useLayoutEffect(() => {
    const el = messagesAreaRef.current;
    const msgCount = allMessages.length;
    if (el && msgCount > prevMsgCountLayoutRef.current && !shouldScrollBottom.current && savedScrollHeightRef.current>0) {
      const diff = el.scrollHeight - savedScrollHeightRef.current;
      if (diff>0) {
        isRestoringScroll.current=true;
        el.scrollTop=diff;
        shouldScrollBottom.current=false;
        maxScrollTopRef.current=diff;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          isRestoringScroll.current=false;
          const el2=messagesAreaRef.current;
          if(el2){const atBottom=el2.scrollHeight-el2.scrollTop-el2.clientHeight<60;shouldScrollBottom.current=atBottom;}
        }));
      }
      savedScrollHeightRef.current=0;
    }
    prevMsgCountLayoutRef.current=msgCount;
  }, [allMessages.length, messagesAreaRef]);

  useEffect(() => { allMessages.forEach(m=>renderedMsgIds.current.add(m.id)); hasRenderedOnce.current=true; }, [allMessages]);

  const msgByIdMap = useMemo(()=>{ const map=new Map<string,ChatMessage>(); for(const m of allMessages) map.set(m.id,m); return map; },[allMessages]);

  const agentOnline = useMemo(()=>{
    if (state.session?.assignedAgent?.isOnline===true) return true;
    if (state.session?.assignedAgentId) return true;
    return allMessages.some(m=>m.senderType==='AGENT');
  },[state.session?.assignedAgent?.isOnline, state.session?.assignedAgentId, allMessages]);



//   const agentReadAt = useMemo<Date|null>(()=>{
//   const raw=(state as any).agentReadAt;
//   if(!raw)return null;
//   const d=new Date(raw);
//   if(isNaN(d.getTime())) return null;

//   // If agent has sent a message, they've read everything up to NOW
//   // Find the latest agent message timestamp and use whichever is later
//   const latestAgentMsg = [...allMessages]
//     .reverse()
//     .find(m => m.senderType === 'AGENT');

//   if (latestAgentMsg) {
//     const agentMsgTime = new Date(latestAgentMsg.timestamp);
//     // Use the max of stored readAt and latest agent message time
//     // This ensures customer messages sent BEFORE agent reply show as Seen
//     return new Date(Math.max(d.getTime(), agentMsgTime.getTime(), Date.now() - 5000));
//   }

//   return d;
// },[(state as any).agentReadAt, allMessages]);

// AFTER — trust the server's readAt timestamp directly


const agentReadAt = useMemo<Date|null>(()=>{
  const raw=(state as any).agentReadAt;
  if(!raw)return null;
  const d=new Date(raw);
  if(isNaN(d.getTime())) return null;

  // If agent has replied, their reply timestamp is a lower bound on readAt
  // (they must have read everything before they could reply)
  const latestAgentMsg = [...allMessages]
    .reverse()
    .find(m => m.senderType === 'AGENT');

  if (latestAgentMsg) {
    const agentMsgTime = new Date(latestAgentMsg.timestamp);
    return new Date(Math.max(d.getTime(), agentMsgTime.getTime()));
    // No Date.now() floor — that was blocking new messages from ever showing Seen
  }

  return d;
},[(state as any).agentReadAt, allMessages]);

  const tickMap = useMemo(()=>buildTickMap({
    messages: allMessages.map(m=>{ const ts=m.timestamp instanceof Date?m.timestamp:new Date(m.timestamp as any); return{id:m.id,createdAt:isNaN(ts.getTime())?new Date().toISOString():ts.toISOString(),senderType:m.senderType}; }),
    viewerSenderType: 'CUSTOMER',
    readAt: agentReadAt,
    otherPartyOnline: agentOnline,
  }),[allMessages, agentReadAt, agentOnline]);

  const handleImageClick = useCallback((url:string,fileName:string)=>setViewerImage({url,fileName}),[]);
  const handleReply = useCallback((m:ChatMessage)=>{ setReplyTarget({id:m.id,content:m.content,senderType:m.senderType,senderName:m.senderName}); inputRef.current?.focus(); },[]);

  const scrollToBottomNow = useCallback((behavior:ScrollBehavior='smooth')=>{
    const el=messagesAreaRef.current;
    if(el){el.scrollTop=el.scrollHeight;} else{messagesEndRef.current?.scrollIntoView({behavior});}
    shouldScrollBottom.current=true;
    setShowJumpToBottom(false);
    setUnreadWhileScrolled(0);
  },[messagesAreaRef]);

  const lastMsgId   = allMessages.length>0?allMessages[allMessages.length-1].id:null;
  const lastMsgType = allMessages.length>0?allMessages[allMessages.length-1].senderType:null;
  const lastMessageIdRef = useRef<string|null>(null);
  const scrollInitSeeded = useRef(false);

  useEffect(()=>{
    if(!lastMsgId)return;
    if(!scrollInitSeeded.current){lastMessageIdRef.current=lastMsgId;scrollInitSeeded.current=true;return;}
    if(lastMsgId===lastMessageIdRef.current)return;
    lastMessageIdRef.current=lastMsgId;
    if(shouldScrollBottom.current){scrollToBottomNow('smooth');}
    else{if(lastMsgType!=='CUSTOMER'){setUnreadWhileScrolled(c=>c+1);setShowJumpToBottom(true);}}
  },[lastMsgId,scrollToBottomNow]);

  useEffect(()=>{ if(state.isTyping&&shouldScrollBottom.current) scrollToBottomNow('smooth'); },[state.isTyping,scrollToBottomNow]);

  const handleMessagesScroll = useCallback(()=>{
    const el=messagesAreaRef.current;
    if(!el)return;
    if(el.scrollTop>maxScrollTopRef.current) maxScrollTopRef.current=el.scrollTop;
    const isAtBottom=el.scrollHeight-el.scrollTop-el.clientHeight<80;
    if(!isRestoringScroll.current){shouldScrollBottom.current=isAtBottom;setShowJumpToBottom(!isAtBottom);}
    if(el.scrollTop<60&&maxScrollTopRef.current>200&&el.scrollTop<maxScrollTopRef.current-100&&!state.loadingMore&&state.hasMore){
      savedScrollHeightRef.current=el.scrollHeight;
      shouldScrollBottom.current=false;
      void actions.loadOlderMessages();
    }
  },[state.loadingMore,state.hasMore,messagesAreaRef]);

  const scrollToBottom = useCallback(()=>scrollToBottomNow('smooth'),[scrollToBottomNow]);

  // ── sendRealMessage: send via real WS, switch to free flow ────────────────
  const sendRealMessage = useCallback((content: string) => {
    if (!stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      void actionsRef.current.sendMessage(content, 'TEXT');
      setFlowStep('free');
      setShowQuickReplies(false);
    } catch(err: any) {
      if (err?.message==='TOKEN_EXPIRED') return;
      throw err;
    }
  }, []);

  // ── Handle main menu selection ────────────────────────────────────────────
  const handleQuickReply = useCallback(async (reply: QuickReply) => {
    setShowQuickReplies(false);
    setEscalationError(null);

    switch (reply.id) {
      // These two → send the label text to the AI agent as a real message
      case 'order_details':
      case 'track_order':
        sendRealMessage(reply.label);
        break;

      // FAQ → show the FAQ screen (no message sent yet, user picks a question)
      case 'faq':
        setFlowStep('faq');
        break;

      // Human agent → escalation flow (unchanged)
      case 'human': {
        setFlowStep('escalating');
        try {
          const sessionId = await waitForSession();
          await escalateToAgent(sessionId, 'Customer requested human agent');
         
        } catch(err: any) {
          setEscalationError(err?.message ?? 'Could not connect. Please try again.');
          setFlowStep('menu');
          setTimeout(()=>setShowQuickReplies(true), 500);
        }
        break;
      }
    }
  }, [sendRealMessage, waitForSession, escalateToAgent]);

  // ── Handle FAQ item selection → send to AI as a real message ─────────────
  const handleFaqSelect = useCallback((faq: QuickReply) => {
    sendRealMessage(faq.label);
  }, [sendRealMessage]);

  const handleSend = useCallback(()=>{
    const content=inputValue.trim();
    if(!content||!stateRef.current.connected||stateRef.current.tokenExpired)return;
    try{
      void actionsRef.current.sendMessage(content,'TEXT',replyTarget?.id);
      setInputValue('');
      setReplyTarget(null);
      actionsRef.current.stopTyping?.();
      if(flowStep!=='free'){setShowQuickReplies(false);setFlowStep('free');}
    }catch(err:any){if(err?.message==='TOKEN_EXPIRED')return;throw err;}
  },[inputValue,flowStep,replyTarget]);

  const handleEndChat = useCallback(async()=>{
    setShowEndConfirm(false);setEndingChat(true);
    const sessionId=stateRef.current.session?.id;
    const cfg=configRef.current;
    if(sessionId){try{await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/close`,{method:'POST',headers:{'Authorization':`Bearer ${cfg.token}`,'X-Tenant-ID':cfg.tenantId,'Content-Type':'application/json'},body:JSON.stringify({closeReason:'MANUAL'})});}catch(e){console.warn('[Chat] End chat REST failed:',e);}}
    setEndingChat(false);setShowFeedback(true);
  },[]);

  const handleKeyDown = useCallback((e:React.KeyboardEvent)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();} },[handleSend]);

  const handleAttachment = useCallback(async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file||stateRef.current.tokenExpired)return;
    try{await actionsRef.current.sendAttachment(file);}catch(err:any){console.error('[Chat] Attachment upload failed:',err);}
    e.target.value='';
  },[]);

  const startRecording = useCallback(async()=>{
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'audio/mp4'});
      audioChunksRef.current=[];
      recorder.ondataavailable=(e)=>{if(e.data.size>0)audioChunksRef.current.push(e.data);};
      recorder.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(audioChunksRef.current,{type:recorder.mimeType});
        const ext=recorder.mimeType.includes('webm')?'webm':'m4a';
        const file=new File([blob],`voice-${Date.now()}.${ext}`,{type:recorder.mimeType});
        try{await actionsRef.current.sendAttachment(file);}catch(err:any){console.error('[Chat] Audio upload failed:',err);}
        setIsRecording(false);
      };
      recorder.start();mediaRecorderRef.current=recorder;setIsRecording(true);
    }catch(err){console.error('[Chat] Microphone access denied:',err);}
  },[]);

  const stopRecording = useCallback(()=>{ if(mediaRecorderRef.current&&mediaRecorderRef.current.state!=='inactive') mediaRecorderRef.current.stop(); },[]);

  // Typing dedup fix: only fire startTyping on the leading edge
  const handleInputChange = useCallback((e:React.ChangeEvent<HTMLInputElement>)=>{
    setInputValue(e.target.value);
    if(typingTimeoutRef.current){
      clearTimeout(typingTimeoutRef.current);
    } else {
      actionsRef.current.startTyping?.();
    }
    typingTimeoutRef.current=setTimeout(()=>{
      actionsRef.current.stopTyping?.();
      typingTimeoutRef.current=undefined;
    },2000);
  },[]);

  const subtitle = (()=>{
    if(state.tokenExpired)return'Session Expired';
    if(state.loading)return'Connecting...';
    if(flowStep==='escalating')return'Connecting to agent...';
    const agentDisplayName=state.session?.assignedAgent?.displayName??state.session?.assignedAgentName;
    if(agentDisplayName&&!looksLikeRawId(agentDisplayName))return`Chatting with ${agentDisplayName}`;
    if(state.session?.mode==='HUMAN')return'Connected to agent';
    return'AI Support · Online';
  })();

  const isClosed = state.session?.status==='CLOSED';
  const canType  = !isClosed&&!state.tokenExpired&&state.connected&&flowStep!=='escalating';
  const isActive = !!inputValue.trim()&&canType;

  if(state.loading) return(
    <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme}/>
      <div style={styles.centeredBox}><svg width="36" height="36" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg><span style={{fontSize:13,color:'#9ca3af'}}>Starting chat...</span></div>
    </div>
  );
  if(state.tokenExpired) return(
    <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Session Expired" theme={theme}/>
      <div style={styles.centeredBox}><div style={{fontSize:40}}>⏳</div><div><div style={{fontWeight:700,fontSize:15,color:'#1a1a2e',marginBottom:6}}>Session Expired</div><div style={{fontSize:13,color:'#6b7280',lineHeight:1.5}}>Your session has expired. Please refresh to continue chatting.</div></div><button onClick={()=>window.location.reload()} style={{padding:'10px 28px',borderRadius:22,border:'none',background:theme.primaryColor,color:'white',fontWeight:700,cursor:'pointer',fontSize:14,fontFamily:'inherit'}}>Refresh Page</button></div>
    </div>
  );
  if(state.error&&!state.connected) return(
    <div style={styles.widget}><WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme}/>
      <div style={styles.centeredBox}><div style={{fontSize:40}}>⚠️</div><div><div style={{fontWeight:700,fontSize:15,color:'#1a1a2e',marginBottom:6}}>Connection Lost</div><div style={{fontSize:13,color:'#6b7280'}}>{state.error.message}</div></div><button onClick={()=>actionsRef.current.reconnect?.()} style={{padding:'10px 28px',borderRadius:22,border:'none',background:theme.primaryColor,color:'white',fontWeight:700,cursor:'pointer',fontSize:14,fontFamily:'inherit'}}>Retry</button></div>
    </div>
  );

  return (
    <div style={{...styles.widget,position:'relative' as const}}>
      <WidgetHeader onClose={onClose} styles={styles}
        subtitle={showHistory?'Chat History':(endingChat?'Ending session…':subtitle)} theme={theme}
        showEndChat={!showHistory&&!isClosed&&!showFeedback&&state.connected&&flowStep!=='escalating'}
        onEndChat={()=>setShowEndConfirm(true)}
        onHistory={()=>setShowHistory(p=>!p)} showHistory={showHistory}/>

      {showHistory&&(
        <SessionHistoryPanel primaryColor={theme.primaryColor} sessions={state.pastSessions} currentSessionId={state.session?.id}
          onSelectActive={()=>setShowHistory(false)}
          onReopen={async(sessionId)=>{await actionsRef.current.reopenSession?.(sessionId);setShowHistory(false);}}
          onBack={()=>setShowHistory(false)}/>
      )}

      {!showHistory&&(
        <>
          {showEndConfirm&&<EndChatConfirmModal primaryColor={theme.primaryColor} onConfirm={handleEndChat} onCancel={()=>setShowEndConfirm(false)}/>}

          {showFeedback?(
            <FeedbackModal primaryColor={theme.primaryColor}
              onSubmit={()=>{setShowFeedback(false);onClose();onStartNewChat?.();}}
              onSkip={()=>{setShowFeedback(false);onClose();onStartNewChat?.();}}/>
          ):flowStep==='escalating'?(
            <EscalatingScreen primaryColor={theme.primaryColor}/>
          ):(
            <>
              {/* ── Message list ──────────────────────────────────────── */}
              <div style={{...styles.messages,position:'relative' as const}} ref={messagesAreaRef} onScroll={handleMessagesScroll}>
                {state.loadingMore&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'10px 0 6px',gap:'8px'}}><SpinnerIcon color={theme.primaryColor} size={16}/><span style={{fontSize:'11px',color:'#9ca3af'}}>Loading older messages…</span></div>}
                {!state.hasMore&&allMessages.length>0&&!state.loadingMore&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 0 12px'}}><span style={{fontSize:'10px',fontWeight:600,color:'#c4b5fd',backgroundColor:'#f3eeff',padding:'3px 12px',borderRadius:'10px'}}>Beginning of conversation</span></div>}
                {allMessages.map(msg=>{
                  const isNew=hasRenderedOnce.current&&!renderedMsgIds.current.has(msg.id);
                  return(
                    <div key={msg.id} id={`chat-msg-${msg.id}`} style={isNew?{animation:'chatFadeIn 0.2s ease',borderRadius:'12px'}:{borderRadius:'12px'}}>
                      <MessageBubble message={msg} styles={styles} userName={config.user.name} onImageClick={handleImageClick} onReply={handleReply}
                        replyToResolved={msg.replyToMessageId?msgByIdMap.get(msg.replyToMessageId)??null:null}
                        tickStatus={tickMap.get(msg.id)??'none'} primaryColor={theme.primaryColor}/>
                    </div>
                  );
                })}
                {state.isTyping&&<TypingIndicator styles={styles}/>}
                <div ref={messagesEndRef}/>
              </div>

              {showJumpToBottom&&(
                <div style={{position:'relative' as const,height:0,zIndex:10}}>
                  <button onClick={scrollToBottom} aria-label="Scroll to latest messages"
                    style={{position:'absolute',bottom:'8px',right:'16px',width:'36px',height:'36px',borderRadius:'50%',backgroundColor:'#ffffff',border:'1px solid #e5e7eb',boxShadow:'0 2px 8px rgba(0,0,0,0.12)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:theme.primaryColor,transition:'all 0.15s'}}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.backgroundColor=theme.primaryColor;(e.currentTarget as HTMLElement).style.color='#ffffff';}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.backgroundColor='#ffffff';(e.currentTarget as HTMLElement).style.color=theme.primaryColor;}}>
                    <ChevronDownIcon/>
                  </button>
                  {unreadWhileScrolled>0&&<div style={{position:'absolute',bottom:'38px',right:'12px',background:theme.primaryColor,color:'#fff',fontSize:'10px',fontWeight:700,lineHeight:1,padding:'3px 6px',borderRadius:'10px',minWidth:'18px',textAlign:'center',boxShadow:`0 2px 6px ${theme.primaryColor}55`,pointerEvents:'none'}}>{unreadWhileScrolled>99?'99+':unreadWhileScrolled}</div>}
                </div>
              )}

              {escalationError&&(
                <div style={{margin:'8px 12px',padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,fontSize:12,color:'#dc2626',display:'flex',alignItems:'center',gap:8}}>
                  <span>⚠️</span><span style={{flex:1}}>{escalationError}</span>
                  <button onClick={()=>setEscalationError(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,lineHeight:1}}>×</button>
                </div>
              )}

              {/* ── FAQ screen ─────────────────────────────────────────── */}
              {flowStep==='faq'&&(
                <FAQScreen primaryColor={theme.primaryColor} onSelect={handleFaqSelect} onBack={()=>{setFlowStep('menu');setShowQuickReplies(true);}}/>
              )}

              {/* ── Main menu ──────────────────────────────────────────── */}
              {flowStep==='menu'&&showQuickReplies&&(
                <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} primaryColor={theme.primaryColor}/>
              )}

              {/* ── Closed / input area ─────────────────────────────────── */}
              {isClosed?(
                (state as any).closeReason==='SWITCHED'?(
                  <div style={{padding:'16px 14px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#fafafa'}}>
                    <div style={{fontSize:28}}>⏸</div>
                    <div style={{textAlign:'center'}}><div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:4}}>Chat on Hold</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>This chat was put on hold while you switched to another session.<br/>You can resume it from your chat history.</div></div>
                    {onStartNewChat&&<button onClick={onStartNewChat} style={{padding:'10px 24px',borderRadius:22,border:'none',background:`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`,color:'white',fontWeight:700,cursor:'pointer',fontSize:13,fontFamily:'inherit'}}>+ Start New Chat</button>}
                  </div>
                ):(
                  <div style={{padding:'16px 14px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#fafafa'}}>
                    <div style={{fontSize:28}}>✅</div>
                    <div style={{textAlign:'center'}}><div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:4}}>Chat Ended</div><div style={{fontSize:12,color:'#9ca3af',lineHeight:1.5}}>This session has been closed.<br/>Need more help?</div></div>
                    {onStartNewChat&&<button onClick={onStartNewChat} style={{padding:'10px 24px',borderRadius:22,border:'none',background:`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`,color:'white',fontWeight:700,cursor:'pointer',fontSize:13,fontFamily:'inherit'}}>+ Start New Chat</button>}
                  </div>
                )
              ):(
                <div style={{flexShrink:0}}>
                  {state.uploading&&<div style={{padding:'8px 14px',backgroundColor:theme.primaryColor+'10',borderTop:`1px solid ${theme.primaryColor}30`,display:'flex',alignItems:'center',gap:'8px'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}><circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg><div style={{flex:1,height:'3px',borderRadius:'2px',backgroundColor:theme.primaryColor+'25',overflow:'hidden'}}><div style={{height:'100%',borderRadius:'2px',backgroundColor:theme.primaryColor,animation:'chatUploadPulse 1.4s ease-in-out infinite'}}/></div><span style={{fontSize:'11px',color:theme.primaryColor,fontWeight:600,flexShrink:0}}>Uploading…</span></div>}
                  {replyTarget&&(
                    <div style={{padding:'8px 12px',borderTop:'1px solid #f0f0f5',backgroundColor:'#f9fafb',display:'flex',alignItems:'center',gap:'8px'}}>
                      <div style={{flex:1,borderLeft:`3px solid ${theme.primaryColor}`,paddingLeft:'10px',overflow:'hidden'}}>
                        <div style={{fontSize:'11px',fontWeight:700,color:theme.primaryColor,marginBottom:'1px'}}>{replyTarget.senderType==='CUSTOMER'?'You':(replyTarget.senderName||'Agent')}</div>
                        <div style={{fontSize:'12px',color:'#6b7280',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{replyTarget.content?.length>80?replyTarget.content.slice(0,80)+'…':replyTarget.content}</div>
                      </div>
                      <button onClick={()=>setReplyTarget(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:'18px',lineHeight:1,padding:'2px',flexShrink:0}}>×</button>
                    </div>
                  )}
                  <div style={styles.inputArea}>
                    <input type="file" ref={fileInputRef} style={{display:'none'}} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={handleAttachment}/>
                    <button onClick={()=>fileInputRef.current?.click()} disabled={!canType||state.uploading} title="Attach file"
                      style={{background:'none',border:'none',cursor:(canType&&!state.uploading)?'pointer':'not-allowed',padding:'4px',display:'flex',alignItems:'center',opacity:(canType&&!state.uploading)?0.6:0.3}}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                    <button onClick={isRecording?stopRecording:startRecording} disabled={!canType||state.uploading}
                      title={isRecording?'Stop recording':(state.uploading?'Uploading…':'Record audio')}
                      style={{background:isRecording?'#ef4444':'none',border:isRecording?'2px solid #ef4444':'none',borderRadius:'50%',cursor:(canType&&!state.uploading)?'pointer':'not-allowed',padding:'4px',display:'flex',alignItems:'center',justifyContent:'center',opacity:(canType&&!state.uploading)?(isRecording?1:0.6):0.3,width:28,height:28,animation:isRecording?'pulse-recording 1.5s ease-in-out infinite':'none',transition:'all 0.2s'}}>
                      {isRecording
                        ?<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                        :<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
                    </button>
                    <input ref={inputRef} type="text"
                      placeholder={state.uploading?'⏳ Uploading file, please wait...':canType?(isRecording?'🔴 Recording audio...':'Type a message...'):'Connecting...'}
                      value={inputValue} onChange={handleInputChange} onKeyDown={handleKeyDown} disabled={!canType}
                      style={{...styles.input,borderColor:inputValue?theme.primaryColor+'88':'#e5e7eb',opacity:canType?1:0.6}}/>
                    <button onClick={handleSend} disabled={!isActive}
                      style={{...styles.sendBtn,background:isActive?`linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`:'#f3f4f6',boxShadow:isActive?`0 3px 12px ${theme.primaryColor}44`:'none',cursor:isActive?'pointer':'not-allowed'}}>
                      <SendIcon active={!!isActive}/>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {viewerImage&&(
        <div onClick={()=>setViewerImage(null)} style={{position:'fixed',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.85)',zIndex:100000,display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out'}}>
          <button onClick={()=>setViewerImage(null)} style={{position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'50%',width:40,height:40,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:22,fontWeight:700,backdropFilter:'blur(4px)'}} aria-label="Close">×</button>
          <a href={viewerImage.url} download={viewerImage.fileName} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{position:'absolute',top:16,right:68,background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'50%',width:40,height:40,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',backdropFilter:'blur(4px)',textDecoration:'none'}} aria-label="Download">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <div onClick={e=>e.stopPropagation()} style={{position:'absolute',top:20,left:16,right:120,color:'#fff',fontSize:13,fontWeight:500,opacity:0.8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{viewerImage.fileName}</div>
          <img src={viewerImage.url} alt={viewerImage.fileName} onClick={e=>e.stopPropagation()} style={{maxWidth:'90vw',maxHeight:'85vh',objectFit:'contain',borderRadius:8,boxShadow:'0 8px 40px rgba(0,0,0,0.5)',cursor:'default'}}/>
        </div>
      )}
    </div>
  );
}

export default ChatWidget;