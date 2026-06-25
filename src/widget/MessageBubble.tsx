import React, { useState } from 'react';
import type { ChatMessage } from '../types';
import type { TickStatus } from '../Messageticks';
import { looksLikeRawId, formatTime } from './helpers';
import { CompactAudioPlayer } from './AudioPlayer';
import { ReplyIcon } from './icons';
import { SenderType, MessageType } from '../shared/enums';

// Media MessageType → human label (notes/previews).
const MEDIA_LABEL: Record<number, string> = {
  [MessageType.IMAGE]: 'Image',
  [MessageType.VIDEO]: 'Video',
  [MessageType.AUDIO]: 'Audio',
  [MessageType.FILE]: 'File',
};

// ── Typing indicator ──────────────────────────────────────────────────────────

export function TypingIndicator({ styles }: { styles: Record<string, React.CSSProperties> }) {
  return (
    <div style={styles.typingWrap}>
      {[0, 0.2, 0.4].map((d, i) => (
        <div key={i} style={{ ...styles.typingDot, animation: `chatTypingBounce 1.2s ${d}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

// ── Message tick (sent / delivered / seen) ────────────────────────────────────

export function CustomerTick({ status }: { status: TickStatus }) {
  if (status === 'none') return null;
  const W  = 'rgba(255,255,255,0.95)';
  const Wm = 'rgba(255,255,255,0.65)';

  const Single = () => (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="1,5 5,9 13,1" stroke={Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const Double = ({ bright }: { bright: boolean }) => (
    <svg width="18" height="10" viewBox="0 0 18 10" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="5,5 9,9 17,1" stroke={bright ? W : Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="1,5 5,9 13,1" stroke={bright ? W : Wm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (status === 'sent')      return <Single />;
  if (status === 'delivered') return <Double bright={false} />;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Double bright />
      <span style={{ fontSize: 9, fontWeight: 700, color: W, lineHeight: 1 }}>Seen</span>
    </span>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  styles: Record<string, React.CSSProperties>;
  userName?: string;
  onImageClick?: (url: string, fileName: string) => void;
  onReply?: (m: ChatMessage) => void;
  replyToResolved?: ChatMessage | null;
  tickStatus: TickStatus;
  primaryColor: string;
}

export const MessageBubble = React.memo(function MessageBubble({
  message, styles, onImageClick, onReply, replyToResolved, tickStatus, primaryColor,
}: MessageBubbleProps) {
  const isCustomer = message.senderType === SenderType.CUSTOMER;
  const isSystem   = message.senderType === SenderType.SYSTEM;
  const isBot      = message.senderType === SenderType.BOT;
  const time       = formatTime(message.timestamp);
  const [hovered, setHovered] = useState(false);

  if (isSystem && looksLikeRawId(message.content?.trim())) return null;
  if (isSystem) return <div style={styles.bubbleSystem}>{message.content}</div>;

  const rawName    = message.senderName;
  const agentLabel = rawName && !looksLikeRawId(rawName) ? rawName : 'Agent';
  const label      = isCustomer ? null : isBot ? 'AI Assistant' : agentLabel;

  const attachment = message.attachment ?? (message.metadata?.attachment as any) ?? null;
  const contentUrl = message.content ?? '';
  const isImageUrl = /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(contentUrl);
  const isVideoUrl = /\.(mp4|mov|avi|mkv|flv|wmv)(\?.*)?$/i.test(contentUrl);
  const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)(\?.*)?$/i.test(contentUrl) || /\/audio\//i.test(contentUrl);
  const isFileUrl  = /^https?:\/\//i.test(contentUrl);

  let effectiveType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null = null;
  if      (message.messageType === MessageType.IMAGE) effectiveType = 'IMAGE';
  else if (message.messageType === MessageType.VIDEO) effectiveType = 'VIDEO';
  else if (message.messageType === MessageType.AUDIO) effectiveType = 'AUDIO';
  else if (message.messageType === MessageType.FILE)  effectiveType = 'FILE';
  else if (attachment?.mimeType?.startsWith('image/')) effectiveType = 'IMAGE';
  else if (attachment?.mimeType?.startsWith('video/')) effectiveType = 'VIDEO';
  else if (attachment?.mimeType?.startsWith('audio/')) effectiveType = 'AUDIO';
  else if (isImageUrl) effectiveType = 'IMAGE';
  else if (isVideoUrl) effectiveType = 'VIDEO';
  else if (isAudioUrl) effectiveType = 'AUDIO';
  else if (attachment || (isFileUrl && contentUrl.includes('/') && !contentUrl.includes(' '))) effectiveType = 'FILE';

  const isAttachment = effectiveType !== null;
  const isAudio      = effectiveType === 'AUDIO';
  const replyTo      = message.replyToMessage ?? replyToResolved ?? null;

  const renderReplyQuote = () => {
    if (!replyTo) return null;
    const rName   = replyTo.senderType === SenderType.CUSTOMER ? 'You' : ((replyTo as any).senderName ?? (replyTo.senderType === SenderType.BOT ? 'AI Assistant' : 'Agent'));
    const mediaLabel = MEDIA_LABEL[replyTo.messageType];
    const preview = mediaLabel
      ? `📎 ${mediaLabel}`
      : (replyTo.content?.length > 60 ? replyTo.content.slice(0, 60) + '…' : replyTo.content);
    return (
      <div
        style={{ padding: '6px 10px', marginBottom: '6px', borderLeft: `3px solid ${isCustomer ? 'rgba(255,255,255,0.5)' : '#7c3aed'}`, borderRadius: '4px', backgroundColor: isCustomer ? 'rgba(255,255,255,0.12)' : '#f5f3ff', fontSize: '11px', lineHeight: '1.4', cursor: 'pointer' }}
        onClick={e => {
          e.stopPropagation();
          const el = document.getElementById(`chat-msg-${replyTo!.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.animate(
              [{ backgroundColor: 'transparent' }, { backgroundColor: isCustomer ? 'rgba(124,58,237,0.15)' : '#ede9fe' }, { backgroundColor: isCustomer ? 'rgba(124,58,237,0.15)' : '#ede9fe' }, { backgroundColor: 'transparent' }],
              { duration: 2000, easing: 'ease-in-out' }
            );
          }
        }}
      >
        <div style={{ fontWeight: 700, color: isCustomer ? 'rgba(255,255,255,0.85)' : '#7c3aed', marginBottom: '2px' }}>{rName}</div>
        <div style={{ color: isCustomer ? 'rgba(255,255,255,0.7)' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</div>
      </div>
    );
  };

  const renderAttachment = () => {
    const url      = attachment?.url ?? contentUrl;
    const fileName = attachment?.fileName ?? url.split('/').pop()?.split('?')[0] ?? 'file';
    if (effectiveType === 'IMAGE') return (
      <div style={{ cursor: 'pointer' }} onClick={() => onImageClick?.(url, fileName)}>
        <img src={url} alt={fileName} style={{ maxWidth: '220px', maxHeight: '180px', borderRadius: '12px', objectFit: 'cover', display: 'block' }} loading="lazy" />
      </div>
    );
    if (effectiveType === 'VIDEO') return <video src={url} controls style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '12px' }} preload="metadata" />;
    if (effectiveType === 'AUDIO') return <CompactAudioPlayer src={url} isCustomer={isCustomer} />;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '10px', backgroundColor: isCustomer ? 'rgba(255,255,255,0.15)' : '#f3f4f6', color: isCustomer ? '#fff' : '#5b4fcf', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
        <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
      </a>
    );
  };

  const bubbleStyle: React.CSSProperties = isAudio
    ? { ...(isCustomer ? { background: styles.bubbleCustomer.background ?? '#5b4fcf', borderRadius: '18px 18px 4px 18px' } : { background: '#ffffff', border: '1px solid #ede9fe', borderRadius: '18px 18px 18px 4px' }), padding: '8px 10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '2px' }
    : (isCustomer ? styles.bubbleCustomer : styles.bubbleAgent);

  const Timestamps = () => isCustomer
    ? <div style={{ ...styles.timestamp, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}><span>{time}</span><CustomerTick status={tickStatus} /></div>
    : <div style={{ ...styles.timestamp, textAlign: 'left' }}>{time}</div>;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-end' : 'flex-start' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label && <div style={styles.senderLabel}>{label}</div>}
      <div style={{ position: 'relative', ...(isAudio ? { width: 'fit-content' } : { maxWidth: '82%' }) }}>
        <div style={{ ...bubbleStyle, ...(isAudio ? {} : { maxWidth: '100%' }) }}>
          {renderReplyQuote()}
          {isAttachment ? renderAttachment() : message.content}
          <Timestamps />
        </div>
        {onReply && (
          <button
            onClick={() => onReply(message)}
            title="Reply"
            style={{ position: 'absolute', top: '50%', ...(isCustomer ? { left: '-32px' } : { right: '-32px' }), transform: 'translateY(-50%)', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', flexShrink: 0, transition: 'opacity 0.15s', padding: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' as const : 'none' as const }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ede9fe'; (e.currentTarget as HTMLElement).style.color = '#5b4fcf'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
          >
            <ReplyIcon />
          </button>
        )}
      </div>
    </div>
  );
});
