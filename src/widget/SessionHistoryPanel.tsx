import React, { useState } from 'react';
import type { ChatSessionSummary } from '../types';
import { ChatStatus } from '../shared/enums';

interface SessionHistoryPanelProps {
  primaryColor: string;
  sessions: ChatSessionSummary[];
  currentSessionId?: string | null;
  onSelectActive: () => void;
  onReopen: (id: string) => Promise<void>;
  onBack: () => void;
}

export function SessionHistoryPanel({ primaryColor, sessions, currentSessionId, onSelectActive, onReopen }: SessionHistoryPanelProps) {
  const [reopening, setReopening] = useState<string | null>(null);

  const active = sessions.filter(s => s.status !== ChatStatus.CLOSED);
  const closed = sessions.filter(s => s.status === ChatStatus.CLOSED).slice(0, 5);

  const formatDate = (d: string | Date | null | undefined) => {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleReopen = async (id: string) => {
    setReopening(id);
    try { await onReopen(id); } finally { setReopening(null); }
  };

  const badge = (status: number) => {
    const map: Record<number, { label: string; bg: string; color: string }> = {
      [ChatStatus.OPEN]:              { label: 'Open',    bg: '#dcfce7', color: '#166534' },
      [ChatStatus.WAITING_FOR_AGENT]: { label: 'Waiting', bg: '#fef9c3', color: '#854d0e' },
      [ChatStatus.ASSIGNED]:          { label: 'Active',  bg: '#dbeafe', color: '#1e40af' },
      [ChatStatus.CLOSED]:            { label: 'Closed',  bg: '#f3f4f6', color: '#6b7280' },
    };
    const s = map[status] ?? { label: String(status), bg: '#f3f4f6', color: '#6b7280' };
    return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700, background: s.bg, color: s.color, letterSpacing: '0.03em' }}>{s.label}</span>;
  };

  const renderRow = (s: ChatSessionSummary, isAct: boolean) => {
    const preview = s.lastMessage?.content?.trim();
    const previewText = preview ? (preview.length > 55 ? preview.slice(0, 55) + '…' : preview) : '(no messages yet)';
    const isCurrent = s.id === currentSessionId;
    return (
      <div key={s.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f5', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: isCurrent ? '#f9f7ff' : '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {badge(s.status)}
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{formatDate(s.closedAt ?? s.createdAt)}</span>
          </div>
          {isAct ? (
            <button
              onClick={onSelectActive}
              style={{ padding: '5px 12px', borderRadius: '14px', border: `1.5px solid ${primaryColor}`, background: isCurrent ? primaryColor : 'transparent', color: isCurrent ? '#ffffff' : primaryColor, fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {isCurrent ? 'Current ✓' : 'Continue'}
            </button>
          ) : (
            <button
              onClick={() => handleReopen(s.id)}
              disabled={reopening === s.id}
              style={{ padding: '5px 12px', borderRadius: '14px', border: `1.5px solid ${primaryColor}`, background: 'transparent', color: primaryColor, fontSize: '11px', fontWeight: 700, cursor: reopening === s.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: reopening === s.id ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {reopening === s.id ? '…' : 'Reopen'}
            </button>
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewText}</div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: '#fafafa' }}>
      <div style={{ padding: '12px 16px 4px', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', backgroundColor: '#fafafa' }}>Active</div>
      {active.length === 0 && <div style={{ padding: '12px 16px', fontSize: '13px', color: '#c4b5fd', textAlign: 'center' }}>No active sessions</div>}
      {active.map(s => renderRow(s, true))}
      <div style={{ padding: '12px 16px 4px', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f5', marginTop: '4px' }}>Closed</div>
      <div style={{ flex: 1, overflowY: 'auto' as const }}>
        {closed.length === 0 && <div style={{ padding: '16px', fontSize: '13px', color: '#c4b5fd', textAlign: 'center' }}>No closed sessions yet</div>}
        {closed.map(s => renderRow(s, false))}
      </div>
    </div>
  );
}
