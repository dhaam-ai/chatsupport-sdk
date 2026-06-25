import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatProvider, useChat } from './context';
import type { ChatSDKConfig } from './types';
import { defaultTheme, type FullTheme } from './widget/constants';
import { getStyles } from './widget/theme';
import { ChatIcon } from './widget/icons';
import { ChatContentWithScrollRef } from './widget/ChatContentInner';

// ── Public props ──────────────────────────────────────────────────────────────

export interface ChatWidgetProps {
  config: ChatSDKConfig;
  defaultOpen?: boolean;
}

// ── Unread / ticket tracker (renders nothing) ─────────────────────────────────

function UnreadTracker({ isOpen, onUnreadChange, onTicketChange }: {
  isOpen: boolean;
  onUnreadChange: (c: number) => void;
  onTicketChange: (id: string | null) => void;
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

// ── ChatWidget — public entry point ───────────────────────────────────────────

export function ChatWidget({ config, defaultOpen = false }: ChatWidgetProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [launchHover, setLaunchHover] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const handleTicketChange = useCallback((id: string | null) => setTicketId(id), []);
  const handleUnreadChange = useCallback((count: number) => setUnreadCount(count), []);

  const theme: FullTheme = { ...defaultTheme, ...config.theme };
  const styles = getStyles(config.theme);
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const handleStartNewChat = () => setChatKey(k => k + 1);

  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      requestAnimationFrame(() => requestAnimationFrame(() => { scrollToBottomRef.current?.(); }));
    }
    prevIsOpen.current = isOpen;
  }, [isOpen]);

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
            <span style={{ position: 'absolute', top: '-4px', right: '-4px', minWidth: '20px', height: '20px', borderRadius: '10px', backgroundColor: '#ef4444', color: '#ffffff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', boxShadow: '0 2px 6px rgba(239,68,68,0.5)', border: '2px solid #ffffff', fontFamily: 'system-ui,sans-serif', lineHeight: 1 }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {ticketId && (
            <span style={{ position: 'absolute', bottom: '-4px', left: '-4px', backgroundColor: '#7c3aed', color: '#fff', fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '8px', border: '2px solid #fff', lineHeight: 1.2, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(124,58,237,0.5)' }}>
              🎫 #{ticketId}
            </span>
          )}
        </button>
      )}

      <ChatProvider config={config} key={chatKey}>
        <UnreadTracker isOpen={isOpen} onUnreadChange={handleUnreadChange} onTicketChange={handleTicketChange} />
        <div style={{ display: isOpen ? 'block' : 'none' }}>
          <ChatContentWithScrollRef
            onClose={() => setIsOpen(false)}
            styles={styles}
            config={config}
            theme={theme}
            onStartNewChat={handleStartNewChat}
            scrollToBottomRef={scrollToBottomRef}
          />
        </div>
      </ChatProvider>
    </div>
  );
}

export default ChatWidget;
