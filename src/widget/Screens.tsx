import React, { useEffect } from 'react';
import type { ChatSessionSummary } from '../types';
import { partitionSessions, isTerminalStatus, handledByLabel } from '../sessionHistory';
import { formatRelative } from './helpers';

// ── Escalating screen ─────────────────────────────────────────────────────────

interface EscalatingScreenProps {
  primaryColor: string;
  onTimeout: () => void;
}

export function EscalatingScreen({ primaryColor, onTimeout }: EscalatingScreenProps) {
  useEffect(() => {
    const t = setTimeout(onTimeout, 5000);
    return () => clearTimeout(t);
  }, [onTimeout]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' }}>
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

// ── Feedback modal ────────────────────────────────────────────────────────────

interface FeedbackModalProps {
  primaryColor: string;
  onSubmit: (rating: number, comment: string) => void;
  onSkip: () => void;
}

export function FeedbackModal({ primaryColor, onSubmit, onSkip }: FeedbackModalProps) {
  const [rating, setRating] = React.useState(0);
  const [hovered, setHovered] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const labels = ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'];

  const handleSubmit = () => {
    if (rating === 0) return;
    setSubmitted(true);
    setTimeout(() => onSubmit(rating, comment), 900);
  };

  if (submitted) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '32px', backgroundColor: '#fafafa' }}>
      <div style={{ fontSize: 52 }}>🎉</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>Thank you!</div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>Your feedback helps us improve.</div>
      </div>
    </div>
  );

  const active = hovered || rating;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fafafa', padding: '28px 24px 20px', gap: '20px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: '10px' }}>⭐</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>How was your experience?</div>
        <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>Your feedback helps us serve you better</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          {[1, 2, 3, 4, 5].map(star => (
            <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHovered(star)} onMouseLeave={() => setHovered(0)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '32px', lineHeight: 1, transition: 'transform 0.15s', transform: active >= star ? 'scale(1.15)' : 'scale(1)', filter: active >= star ? 'drop-shadow(0 2px 4px rgba(234,179,8,0.4))' : 'grayscale(1) opacity(0.35)' }}>
              ⭐
            </button>
          ))}
        </div>
        {active > 0 && <div style={{ fontSize: '12px', fontWeight: 600, color: primaryColor }}>{labels[active - 1]}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tell us more (optional)</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="What could we do better?" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '12px', border: `1.5px solid ${comment ? primaryColor + '88' : '#e5e7eb'}`, fontSize: '13px', fontFamily: 'inherit', resize: 'none', backgroundColor: '#ffffff', color: '#111827', outline: 'none', transition: 'border-color 0.2s', lineHeight: 1.5 }} />
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={onSkip} style={{ flex: 1, padding: '10px', borderRadius: '22px', border: '1.5px solid #e5e7eb', background: '#ffffff', color: '#6b7280', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Skip</button>
        <button onClick={handleSubmit} disabled={rating === 0}
          style={{ flex: 2, padding: '10px', borderRadius: '22px', border: 'none', background: rating > 0 ? `linear-gradient(135deg,${primaryColor},${primaryColor}cc)` : '#f3f4f6', color: rating > 0 ? '#ffffff' : '#9ca3af', fontSize: '13px', fontWeight: 700, cursor: rating > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
          Submit Feedback
        </button>
      </div>
    </div>
  );
}

// ── End chat confirm modal ────────────────────────────────────────────────────

interface EndChatConfirmModalProps {
  primaryColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EndChatConfirmModal({ onConfirm, onCancel }: EndChatConfirmModalProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', backgroundColor: '#ffffff', borderRadius: '20px 20px 0 0', padding: '24px 20px 28px', boxShadow: '0 -8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '16px', animation: 'chatFadeIn 0.2s ease' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginBottom: 2 }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: '10px' }}>👋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>End this chat?</div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>This will close your current session.<br />You'll have a chance to leave feedback.</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: 4 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px', borderRadius: '14px', border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Keep Chatting</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '12px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#ffffff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>End Chat</button>
        </div>
      </div>
    </div>
  );
}

// ── Session picker (pre-chat) ─────────────────────────────────────────────────
// Shown when the widget opens and the customer has past conversations.
//
// GUEST HANDLING: none here, on purpose. The backend returns an empty
// sessions[] for a caller it has not identified, so the caller simply does not
// render this screen when the list is empty (shouldShowSessionPicker). A second
// client-side guest check would be a second source of truth for the same
// question.

interface SessionPickerScreenProps {
  primaryColor: string;
  sessions: ChatSessionSummary[];
  /** Whether typing into a terminal session can bring it back. Both this and
   *  the backend's FEATURE_SESSION_REACTIVATE_ON_CUSTOMER_MESSAGE must be on. */
  canReactivate: boolean;
  onSelect: (sessionId: string) => void;
  onStartNew: () => void;
}

export function SessionPickerScreen({
  primaryColor, sessions, canReactivate, onSelect, onStartNew,
}: SessionPickerScreenProps) {
  const { active, terminal } = partitionSessions(sessions);

  const row = (s: ChatSessionSummary) => {
    const isTerminal = isTerminalStatus(s.status);
    const handler    = handledByLabel(s);
    const preview    = s.lastMessagePreview?.trim();
    return (
      <button
        key={s.id}
        onClick={() => onSelect(s.id)}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, width: '100%', textAlign: 'left', padding: '12px 14px', border: '1px solid #ece9f7', borderRadius: 12, background: '#ffffff', cursor: 'pointer', fontFamily: 'inherit' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = primaryColor; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#ece9f7'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {handler ?? (isTerminal ? 'Past conversation' : 'Conversation')}
          </span>
          {s.unreadCount > 0 && (
            <span style={{ minWidth: 18, padding: '1px 6px', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center' }}>
              {s.unreadCount > 99 ? '99+' : s.unreadCount}
            </span>
          )}
          <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{formatRelative(s.lastMessageAt ?? s.closedAt ?? s.createdAt)}</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview ?? 'No messages yet'}
        </div>
        {isTerminal && (
          <div style={{ fontSize: 10, color: '#9ca3af' }}>
            {canReactivate ? 'Closed · send a message to reopen' : 'Closed · view only'}
          </div>
        )}
      </button>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 14px', backgroundColor: '#fafafa' }}>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
        Pick up where you left off, or start something new.
      </div>

      {active.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Active</div>
          {active.map(row)}
        </>
      )}

      {terminal.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: active.length > 0 ? 6 : 0 }}>Recent</div>
          {terminal.map(row)}
        </>
      )}

      <button
        onClick={onStartNew}
        style={{ marginTop: 6, padding: '12px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg,${primaryColor},${primaryColor}cc)`, color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
      >
        + Start new conversation
      </button>
    </div>
  );
}
