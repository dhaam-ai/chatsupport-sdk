import React, { useState } from 'react';
import type { ChatSessionSummary } from '../types';
import { partitionSessions, isTerminalStatus, handledByLabel } from '../sessionHistory';
import { formatRelative } from './helpers';

// The in-chat switcher — the second of the picker's two surfaces (the other is
// SessionPickerScreen, shown before the chat starts). It exists so a customer
// is never stuck inside one conversation.
//
// GUEST HANDLING: none here. The backend returns [] for a guest, so the list is
// simply empty — see sessionHistory.shouldShowSessionPicker.

interface SessionHistoryPanelProps {
  primaryColor: string;
  sessions: ChatSessionSummary[];
  currentSessionId?: string | null;
  /** Whether typing into a terminal session can bring it back. */
  canReactivate: boolean;
  /** Switch the widget to this session. Never mutates it server-side. */
  onSelect: (id: string) => Promise<void>;
  onBack: () => void;
}

export function SessionHistoryPanel({
  primaryColor, sessions, currentSessionId, canReactivate, onSelect,
}: SessionHistoryPanelProps) {
  const [switching, setSwitching] = useState<string | null>(null);

  const { active, terminal } = partitionSessions(sessions);

  const handleSelect = async (id: string) => {
    setSwitching(id);
    try { await onSelect(id); } finally { setSwitching(null); }
  };

  const badge = (status: string) => {
    // Explicit if-chain over a lookup, matching this stack's enum idiom — and
    // RESOLVED / ON_HOLD are real statuses the normalisers produce, which the
    // previous CLOSED-only map rendered as a raw enum name.
    let label = status;
    let bg = '#f3f4f6';
    let color = '#6b7280';
    if (status === 'OPEN')              { label = 'Open';     bg = '#dcfce7'; color = '#166534'; }
    if (status === 'WAITING_FOR_AGENT') { label = 'Waiting';  bg = '#fef9c3'; color = '#854d0e'; }
    if (status === 'ASSIGNED')          { label = 'Active';   bg = '#dbeafe'; color = '#1e40af'; }
    if (status === 'ON_HOLD')           { label = 'On hold';  bg = '#ede9fe'; color = '#5b21b6'; }
    if (status === 'CLOSED')            { label = 'Closed';   bg = '#f3f4f6'; color = '#6b7280'; }
    if (status === 'RESOLVED')          { label = 'Resolved'; bg = '#f3f4f6'; color = '#6b7280'; }
    return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700, background: bg, color, letterSpacing: '0.03em' }}>{label}</span>;
  };

  const renderRow = (s: ChatSessionSummary) => {
    const preview     = s.lastMessagePreview?.trim();
    const previewText = preview ? (preview.length > 55 ? preview.slice(0, 55) + '…' : preview) : '(no messages yet)';
    const isCurrent   = s.id === currentSessionId;
    const isTerminal  = isTerminalStatus(s.status);
    const handler     = handledByLabel(s);
    const busy        = switching === s.id;

    return (
      <div key={s.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f5', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: isCurrent ? '#f9f7ff' : '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {badge(s.status)}
            {handler && <span style={{ fontSize: '11px', fontWeight: 600, color: '#4b5563' }}>{handler}</span>}
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{formatRelative(s.lastMessageAt ?? s.closedAt ?? s.createdAt)}</span>
            {s.unreadCount > 0 && (
              <span style={{ minWidth: 16, padding: '1px 5px', borderRadius: 8, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>
                {s.unreadCount > 99 ? '99+' : s.unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={() => { if (!isCurrent) void handleSelect(s.id); }}
            disabled={busy || isCurrent}
            style={{ padding: '5px 12px', borderRadius: '14px', border: `1.5px solid ${primaryColor}`, background: isCurrent ? primaryColor : 'transparent', color: isCurrent ? '#ffffff' : primaryColor, fontSize: '11px', fontWeight: 700, cursor: (busy || isCurrent) ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {busy ? '…' : isCurrent ? 'Current ✓' : isTerminal ? 'Open' : 'Continue'}
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewText}</div>
        {isTerminal && !isCurrent && (
          <div style={{ fontSize: '10px', color: '#9ca3af' }}>
            {canReactivate ? 'Send a message to reopen this conversation' : 'View only'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: '#fafafa' }}>
      <div style={{ padding: '12px 16px 4px', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', backgroundColor: '#fafafa' }}>Active</div>
      {active.length === 0 && <div style={{ padding: '12px 16px', fontSize: '13px', color: '#c4b5fd', textAlign: 'center' }}>No active sessions</div>}
      {active.map(renderRow)}
      <div style={{ padding: '12px 16px 4px', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f5', marginTop: '4px' }}>Recent</div>
      <div style={{ flex: 1, overflowY: 'auto' as const }}>
        {terminal.length === 0 && <div style={{ padding: '16px', fontSize: '13px', color: '#c4b5fd', textAlign: 'center' }}>No past conversations yet</div>}
        {terminal.map(renderRow)}
      </div>
    </div>
  );
}
