import type { CSSProperties } from 'react';
import type { ChatTheme } from '../types';
import { defaultTheme, type FullTheme } from './constants';

export function getStyles(theme: ChatTheme = {}): Record<string, CSSProperties> {
  const t: FullTheme = { ...defaultTheme, ...theme };
  const isRight = (t.position as string) !== 'bottom-left';
  return {
    container:      { position: 'fixed', bottom: '24px', [isRight ? 'right' : 'left']: '24px', zIndex: 9999, fontFamily: t.fontFamily },
    launcher:       { width: '56px', height: '56px', borderRadius: '50%', background: `linear-gradient(135deg, ${t.primaryColor}, ${t.primaryColor}cc)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${t.primaryColor}55`, transition: 'transform 0.2s, box-shadow 0.2s' },
    widget:         { width: '380px', height: '560px', backgroundColor: '#ffffff', borderRadius: t.borderRadius, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)' },
    header:         { background: `linear-gradient(135deg, ${t.headerBackground}, ${t.headerBackground}ee)`, color: t.headerText, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
    headerAvatar:   { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
    headerInfo:     { flex: 1 },
    headerTitle:    { fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
    headerSub:      { fontSize: '11px', opacity: 0.85, margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' },
    onlineDot:      { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block', flexShrink: 0 },
    closeBtn:       { background: 'rgba(255,255,255,0.15)', border: 'none', color: t.headerText, cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    messages:       { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#fafafa' },
    bubbleCustomer: { alignSelf: 'flex-end', background: `linear-gradient(135deg, ${t.customerBubbleColor}, ${t.customerBubbleColor}cc)`, color: '#ffffff', padding: '10px 14px', borderRadius: '18px 18px 4px 18px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: `0 2px 8px ${t.customerBubbleColor}33` },
    bubbleAgent:    { alignSelf: 'flex-start', backgroundColor: '#ffffff', color: '#1a1a2e', padding: '10px 14px', borderRadius: '18px 18px 18px 4px', maxWidth: '78%', wordBreak: 'break-word', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5', whiteSpace: 'pre-line' },
    bubbleSystem:   { alignSelf: 'center', backgroundColor: '#ede9fe', color: '#5b4fcf', padding: '5px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const },
    senderLabel:    { fontSize: '10px', color: '#9ca3af', marginBottom: '3px', paddingLeft: '2px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
    timestamp:      { fontSize: '10px', opacity: 0.5, marginTop: '4px' },
    typingWrap:     { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: '1px solid #f0f0f5' },
    typingDot:      { width: '7px', height: '7px', backgroundColor: '#9ca3af', borderRadius: '50%' },
    inputArea:      { padding: '10px 12px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#ffffff', flexShrink: 0, position: 'relative' as const },
    input:          { flex: 1, padding: '10px 14px', borderRadius: '22px', border: '1.5px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#f9fafb', color: '#111827', transition: 'border-color 0.2s' },
    sendBtn:        { width: '40px', height: '40px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' },
    centeredBox:    { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', backgroundColor: '#fafafa', textAlign: 'center' as const },
  };
}
