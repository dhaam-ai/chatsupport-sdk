import React from 'react';
import type { FullTheme } from './constants';
import { CloseIcon, PhoneDownIcon } from './icons';
import { DEFAULT_WIDGET_TITLE } from './handlerIdentity';

interface WidgetHeaderProps {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  subtitle: string;
  theme: FullTheme;
  /** Who is talking to the customer — see resolveHandlerIdentity. Falls back
   *  to the generic title so an unwired caller still renders something sane. */
  title?: string;
  onEndChat?: () => void;
  showEndChat?: boolean;
  onHistory?: () => void;
  showHistory?: boolean;
}

export function WidgetHeader({ onClose, styles, subtitle, theme, title, onEndChat, showEndChat, onHistory, showHistory }: WidgetHeaderProps) {
  return (
    <div style={styles.header}>
      <div style={styles.headerAvatar}>💬</div>
      <div style={styles.headerInfo}>
        <h3 style={styles.headerTitle}>{title || DEFAULT_WIDGET_TITLE}</h3>
        <div style={styles.headerSub}><span style={styles.onlineDot} />{subtitle}</div>
      </div>
      {onHistory && (
        <button
          onClick={onHistory}
          title={showHistory ? 'Back to chat' : 'Chat history'}
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: theme.headerText, cursor: 'pointer', padding: '6px 8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '4px', transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.22)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)'; }}
        >
          {showHistory
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
        </button>
      )}
      {showEndChat && onEndChat && (
        <button
          onClick={onEndChat}
          title="End chat"
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: theme.headerText, cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, marginRight: '6px', transition: 'all 0.15s', letterSpacing: '0.02em' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.5)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.25)'; }}
        >
          <PhoneDownIcon /> End
        </button>
      )}
      <button style={styles.closeBtn} onClick={onClose}><CloseIcon /></button>
    </div>
  );
}
