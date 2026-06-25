import React from 'react';
import type { QuickReply } from './types';
import { FAQ_ITEMS } from './constants';
import { BackIcon } from './icons';

// ── Main menu quick replies ───────────────────────────────────────────────────

interface QuickRepliesProps {
  replies: QuickReply[];
  onSelect: (r: QuickReply) => void;
  primaryColor: string;
}

export function QuickReplies({ replies, onSelect, primaryColor }: QuickRepliesProps) {
  return (
    <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#fafafa', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
      <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>How can we help?</div>
      {replies.map(r => (
        <button
          key={r.id}
          style={{ width: '100%', padding: '10px 16px', borderRadius: '12px', border: '1.5px solid #e0d9ff', backgroundColor: '#ffffff', color: primaryColor, cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left', transition: 'all 0.15s' }}
          onClick={() => onSelect(r)}
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

// ── FAQ screen ────────────────────────────────────────────────────────────────

interface FAQScreenProps {
  primaryColor: string;
  onSelect: (faq: QuickReply) => void;
  onBack: () => void;
}

export function FAQScreen({ primaryColor, onSelect, onBack }: FAQScreenProps) {
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', flexShrink: 0, backgroundColor: '#fafafa' }}>
      <button
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px 4px', background: 'none', border: 'none', cursor: 'pointer', color: primaryColor, fontSize: '12px', fontWeight: 600, fontFamily: 'inherit' }}
      >
        <BackIcon /> Back to menu
      </button>
      <div style={{ padding: '2px 14px 6px', fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Frequently Asked Questions
      </div>
      <div style={{ maxHeight: '230px', overflowY: 'auto', padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {FAQ_ITEMS.map(faq => (
          <button
            key={faq.id}
            style={{ width: '100%', padding: '9px 14px', borderRadius: '10px', border: '1.5px solid #e0d9ff', backgroundColor: '#ffffff', color: primaryColor, cursor: 'pointer', fontSize: '13px', fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left', transition: 'all 0.15s' }}
            onClick={() => onSelect(faq)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ede9fe'; (e.currentTarget as HTMLElement).style.borderColor = primaryColor; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e0d9ff'; }}
          >
            <span style={{ fontSize: 15 }}>{faq.icon}</span>
            <span>{faq.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
