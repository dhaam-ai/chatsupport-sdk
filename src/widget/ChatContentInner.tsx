import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useChat } from '../context';
import type { ChatSDKConfig, ChatMessage } from '../types';
import { playNotificationSound, unlockAudio } from '../notificationSound';
import { buildTickMap } from '../Messageticks';
import type { FlowStep, ReplyTarget } from './types';
import { MAIN_MENU } from './constants';
import type { FullTheme } from './constants';
import { getStyles } from './theme';
import { SpinnerIcon, ChevronDownIcon, SendIcon } from './icons';
import { TypingIndicator, MessageBubble } from './MessageBubble';
import { QuickReplies, FAQScreen } from './QuickReplies';
import { EscalatingScreen, FeedbackModal, EndChatConfirmModal } from './Screens';
import { WidgetHeader } from './WidgetHeader';
import { SessionHistoryPanel } from './SessionHistoryPanel';
import { looksLikeRawId } from './helpers';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatContentInnerProps {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  config: ChatSDKConfig;
  theme: FullTheme;
  onStartNewChat?: () => void;
  externalMessagesAreaRef: React.MutableRefObject<HTMLDivElement | null>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatContentInner({ onClose, styles, config, theme, onStartNewChat, externalMessagesAreaRef }: ChatContentInnerProps): JSX.Element {
  const { state, actions } = useChat();

  const [inputValue, setInputValue] = useState('');
  const [flowStep, setFlowStep] = useState<FlowStep>('menu');
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [escalationError, setEscalationError] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<{ url: string; fileName: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [endingChat, setEndingChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasInited = useRef(false);
  const prevMsgCount = useRef(0);
  const prevSoundCount = useRef(0);

  const messagesAreaRef = externalMessagesAreaRef;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const shouldScrollBottom = useRef(true);
  const savedScrollHeightRef = useRef(0);
  const prevMsgCountLayoutRef = useRef(0);
  const maxScrollTopRef = useRef(0);
  const isRestoringScroll = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

  const renderedMsgIds = useRef(new Set<string>());
  const hasRenderedOnce = useRef(false);

  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  const configRef = useRef(config);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { configRef.current = config; }, [config]);

  // ── Inject keyframe animations once ──────────────────────────────────────────
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

  // ── Decide initial flowStep once connected ────────────────────────────────────
  useEffect(() => {
    if (!state.connected || state.loading) return;
    if (hasInited.current) return;
    hasInited.current = true;

    const sess = stateRef.current.session;
    const msgs = stateRef.current.messages;

    const hasAgentSession =
      sess?.status === 'ASSIGNED' ||
      sess?.status === 'WAITING_FOR_AGENT' ||
      sess?.mode === 'HUMAN';

    const hasHistory =
      msgs.some(m => m.senderType === 'CUSTOMER') ||
      msgs.some(m => m.senderType === 'AGENT');

    if (hasAgentSession || hasHistory) {
      setFlowStep('free');
      setShowQuickReplies(false);
    } else {
      setFlowStep('menu');
      setShowQuickReplies(true);
    }
  }, [state.connected, state.loading]);

  useEffect(() => {
    if (flowStep === 'free') inputRef.current?.focus();
  }, [flowStep]);

  // Switch to free when any agent reply arrives
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
    const mode = state.session?.mode;
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
      if (newMsgs.some(m => m.senderType === 'AGENT' || m.senderType === 'BOT') && !state.isWidgetOpen) playNotificationSound();
    }
    prevSoundCount.current = newCount;
  }, [state.messages.length, state.isWidgetOpen]);

  useEffect(() => {
    const unlock = () => { unlockAudio(); window.removeEventListener('click', unlock); };
    window.addEventListener('click', unlock);
    return () => window.removeEventListener('click', unlock);
  }, []);

  // Mark messages read after small delay once widget is open
  useEffect(() => {
    if (!state.isWidgetOpen || !state.session?.id) return;
    const t = setTimeout(() => {
      actionsRef.current.markMessagesRead?.().catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [state.isWidgetOpen, state.session?.id, state.messages.length]);

  useEffect(() => {
    if (showHistory) actionsRef.current.fetchPastSessions?.().catch(() => {});
  }, [showHistory]);

  // ── Session ready promise ─────────────────────────────────────────────────────
  const waitForSession = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (stateRef.current.session?.id) { resolve(stateRef.current.session.id); return; }
      const max = 8000; const step = 200; let elapsed = 0;
      const t = setInterval(() => {
        elapsed += step;
        const id = stateRef.current.session?.id;
        if (id) { clearInterval(t); resolve(id); }
        else if (elapsed >= max) { clearInterval(t); reject(new Error('Session not ready — please try again')); }
      }, step);
    });
  }, []);

  // ── REST escalation ───────────────────────────────────────────────────────────
  const escalateToAgent = useCallback(async (sessionId: string, reason: string) => {
    const cfg = configRef.current;
    const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/escalate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Escalation failed (${res.status}): ${body}`);
    }
  }, []);

  // ── Message list (deduped + sorted) ──────────────────────────────────────────
  const allMessages = useMemo(() => {
    const seen = new Set<string>();
    const result: ChatMessage[] = [];
    for (const m of state.messages) { seen.add(m.id); result.push(m); }
    return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [state.messages]);

  // ── Scroll restoration after load-older-messages ──────────────────────────────
  useLayoutEffect(() => {
    const el = messagesAreaRef.current;
    const msgCount = allMessages.length;
    if (el && msgCount > prevMsgCountLayoutRef.current && !shouldScrollBottom.current && savedScrollHeightRef.current > 0) {
      const diff = el.scrollHeight - savedScrollHeightRef.current;
      if (diff > 0) {
        isRestoringScroll.current = true;
        el.scrollTop = diff;
        shouldScrollBottom.current = false;
        maxScrollTopRef.current = diff;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          isRestoringScroll.current = false;
          const el2 = messagesAreaRef.current;
          if (el2) {
            const atBottom = el2.scrollHeight - el2.scrollTop - el2.clientHeight < 60;
            shouldScrollBottom.current = atBottom;
          }
        }));
      }
      savedScrollHeightRef.current = 0;
    }
    prevMsgCountLayoutRef.current = msgCount;
  }, [allMessages.length, messagesAreaRef]);

  useEffect(() => { allMessages.forEach(m => renderedMsgIds.current.add(m.id)); hasRenderedOnce.current = true; }, [allMessages]);

  const msgByIdMap = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of allMessages) map.set(m.id, m);
    return map;
  }, [allMessages]);

  const agentOnline = useMemo(() => {
    if (state.session?.assignedAgent?.isOnline === true) return true;
    if (state.session?.assignedAgentId) return true;
    return allMessages.some(m => m.senderType === 'AGENT');
  }, [state.session?.assignedAgent?.isOnline, state.session?.assignedAgentId, allMessages]);

  const agentReadAt = useMemo<Date | null>(() => {
    const raw = (state as any).agentReadAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const latestAgentMsg = [...allMessages].reverse().find(m => m.senderType === 'AGENT');
    if (latestAgentMsg) {
      const agentMsgTime = new Date(latestAgentMsg.timestamp);
      return new Date(Math.max(d.getTime(), agentMsgTime.getTime()));
    }
    return d;
  }, [(state as any).agentReadAt, allMessages]);

  const tickMap = useMemo(() => buildTickMap({
    messages: allMessages.map(m => {
      const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as any);
      return { id: m.id, createdAt: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(), senderType: m.senderType };
    }),
    viewerSenderType: 'CUSTOMER',
    readAt: agentReadAt,
    otherPartyOnline: agentOnline,
  }), [allMessages, agentReadAt, agentOnline]);

  // ── Scroll helpers ────────────────────────────────────────────────────────────
  const handleImageClick = useCallback((url: string, fileName: string) => setViewerImage({ url, fileName }), []);
  const handleReply = useCallback((m: ChatMessage) => {
    setReplyTarget({ id: m.id, content: m.content, senderType: m.senderType, senderName: m.senderName });
    inputRef.current?.focus();
  }, []);

  const scrollToBottomNow = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesAreaRef.current;
    if (el) { el.scrollTop = el.scrollHeight; } else { messagesEndRef.current?.scrollIntoView({ behavior }); }
    shouldScrollBottom.current = true;
    setShowJumpToBottom(false);
    setUnreadWhileScrolled(0);
  }, [messagesAreaRef]);

  const lastMsgId = allMessages.length > 0 ? allMessages[allMessages.length - 1].id : null;
  const lastMsgType = allMessages.length > 0 ? allMessages[allMessages.length - 1].senderType : null;
  const lastMessageIdRef = useRef<string | null>(null);
  const scrollInitSeeded = useRef(false);

  useEffect(() => {
    if (!lastMsgId) return;
    if (!scrollInitSeeded.current) { lastMessageIdRef.current = lastMsgId; scrollInitSeeded.current = true; return; }
    if (lastMsgId === lastMessageIdRef.current) return;
    lastMessageIdRef.current = lastMsgId;
    if (shouldScrollBottom.current) { scrollToBottomNow('smooth'); }
    else { if (lastMsgType !== 'CUSTOMER') { setUnreadWhileScrolled(c => c + 1); setShowJumpToBottom(true); } }
  }, [lastMsgId, scrollToBottomNow]);

  useEffect(() => {
    if (state.isTyping && shouldScrollBottom.current) scrollToBottomNow('smooth');
  }, [state.isTyping, scrollToBottomNow]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    if (el.scrollTop > maxScrollTopRef.current) maxScrollTopRef.current = el.scrollTop;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!isRestoringScroll.current) { shouldScrollBottom.current = isAtBottom; setShowJumpToBottom(!isAtBottom); }
    if (el.scrollTop < 60 && maxScrollTopRef.current > 200 && el.scrollTop < maxScrollTopRef.current - 100 && !state.loadingMore && state.hasMore) {
      savedScrollHeightRef.current = el.scrollHeight;
      shouldScrollBottom.current = false;
      void actions.loadOlderMessages();
    }
  }, [state.loadingMore, state.hasMore, messagesAreaRef]);

  const scrollToBottom = useCallback(() => scrollToBottomNow('smooth'), [scrollToBottomNow]);

  // ── Message send ──────────────────────────────────────────────────────────────
  const sendRealMessage = useCallback((content: string) => {
    if (!stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      void actionsRef.current.sendMessage(content, 'TEXT');
      setFlowStep('free');
      setShowQuickReplies(false);
    } catch (err: any) {
      if (err?.message === 'TOKEN_EXPIRED') return;
      throw err;
    }
  }, []);

  // ── Main menu handler ─────────────────────────────────────────────────────────
  const handleQuickReply = useCallback(async (reply: { id: string; label: string }) => {
    setShowQuickReplies(false);
    setEscalationError(null);

    switch (reply.id) {
      case 'order_details':
      case 'track_order':
        sendRealMessage(reply.label);
        break;

      case 'faq':
        setFlowStep('faq');
        break;

      case 'human': {
        setFlowStep('escalating');
        const sessionId = stateRef.current.session?.id;
        if (!sessionId) {
          setEscalationError('Session not ready. Please try again.');
          setFlowStep('menu');
          setTimeout(() => setShowQuickReplies(true), 500);
          break;
        }
        const forceFreetimer = setTimeout(() => { setFlowStep('free'); setShowQuickReplies(false); }, 5000);
        escalateToAgent(sessionId, 'Customer requested human agent')
          .then(() => clearTimeout(forceFreetimer))
          .catch((err: any) => {
            clearTimeout(forceFreetimer);
            if (stateRef.current.session?.status !== 'ASSIGNED' && stateRef.current.session?.mode !== 'HUMAN') {
              setEscalationError(err?.message ?? 'Could not connect. Please try again.');
              setFlowStep('menu');
              setTimeout(() => setShowQuickReplies(true), 500);
            }
          });
        break;
      }
    }
  }, [sendRealMessage, waitForSession, escalateToAgent]);

  const handleFaqSelect = useCallback((faq: { label: string }) => {
    sendRealMessage(faq.label);
  }, [sendRealMessage]);

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !stateRef.current.connected || stateRef.current.tokenExpired) return;
    try {
      void actionsRef.current.sendMessage(content, 'TEXT', replyTarget?.id);
      setInputValue('');
      setReplyTarget(null);
      actionsRef.current.stopTyping?.();
      if (flowStep !== 'free') { setShowQuickReplies(false); setFlowStep('free'); }
    } catch (err: any) { if (err?.message === 'TOKEN_EXPIRED') return; throw err; }
  }, [inputValue, flowStep, replyTarget]);

  const handleEndChat = useCallback(async () => {
    setShowEndConfirm(false); setEndingChat(true);
    const sessionId = stateRef.current.session?.id;
    const cfg = configRef.current;
    if (sessionId) {
      try {
        await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ closeReason: 'MANUAL' }),
        });
      } catch { /* non-fatal */ }
    }
    setEndingChat(false); onClose(); onStartNewChat?.();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleAttachment = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || stateRef.current.tokenExpired) return;
    try { await actionsRef.current.sendAttachment(file); } catch { /* non-fatal */ }
    e.target.value = '';
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes('webm') ? 'webm' : 'm4a';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: recorder.mimeType });
        try { await actionsRef.current.sendAttachment(file); } catch { /* non-fatal */ }
        setIsRecording(false);
      };
      recorder.start(); mediaRecorderRef.current = recorder; setIsRecording(true);
    } catch { /* microphone denied */ }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
  }, []);

  // Typing dedup — only fire startTyping on leading edge
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    } else {
      actionsRef.current.startTyping?.();
    }
    typingTimeoutRef.current = setTimeout(() => {
      actionsRef.current.stopTyping?.();
      typingTimeoutRef.current = undefined;
    }, 2000);
  }, []);

  // ── Computed values ───────────────────────────────────────────────────────────
  const subtitle = (() => {
    if (state.tokenExpired) return 'Session Expired';
    if (state.loading) return 'Connecting...';
    if (flowStep === 'escalating') return 'Connecting to agent...';
    const agentDisplayName = state.session?.assignedAgent?.displayName ?? state.session?.assignedAgentName;
    if (agentDisplayName && !looksLikeRawId(agentDisplayName)) return `Chatting with ${agentDisplayName}`;
    if (state.session?.mode === 'HUMAN') return 'Connected to agent';
    return 'AI Support · Online';
  })();

  const isClosed = state.session?.status === 'CLOSED';
  const canType = !isClosed && !state.tokenExpired && state.connected && flowStep !== 'escalating';
  const isActive = !!inputValue.trim() && canType;

  // ── Loading / error states ────────────────────────────────────────────────────
  if (state.loading) return (
    <div style={styles.widget}>
      <WidgetHeader onClose={onClose} styles={styles} subtitle="Connecting..." theme={theme} />
      <div style={styles.centeredBox}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
          </path>
        </svg>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>Starting chat...</span>
      </div>
    </div>
  );

  if (state.tokenExpired) return (
    <div style={styles.widget}>
      <WidgetHeader onClose={onClose} styles={styles} subtitle="Session Expired" theme={theme} />
      <div style={styles.centeredBox}>
        <div style={{ fontSize: 40 }}>⏳</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Session Expired</div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>Your session has expired. Please refresh to continue chatting.</div>
        </div>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Refresh Page</button>
      </div>
    </div>
  );

  if (state.error && !state.connected) return (
    <div style={styles.widget}>
      <WidgetHeader onClose={onClose} styles={styles} subtitle="Disconnected" theme={theme} />
      <div style={styles.centeredBox}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e', marginBottom: 6 }}>Connection Lost</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{state.error.message}</div>
        </div>
        <button onClick={() => actionsRef.current.reconnect?.()} style={{ padding: '10px 28px', borderRadius: 22, border: 'none', background: theme.primaryColor, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Retry</button>
      </div>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ ...styles.widget, position: 'relative' as const }}>
      <WidgetHeader
        onClose={onClose} styles={styles}
        subtitle={showHistory ? 'Chat History' : (endingChat ? 'Ending session…' : subtitle)} theme={theme}
        showEndChat={!showHistory && !isClosed && !showFeedback && state.connected && flowStep !== 'escalating'}
        onEndChat={() => setShowEndConfirm(true)}
        onHistory={() => setShowHistory(p => !p)} showHistory={showHistory}
      />

      {showHistory && (
        <SessionHistoryPanel
          primaryColor={theme.primaryColor} sessions={state.pastSessions} currentSessionId={state.session?.id}
          onSelectActive={() => setShowHistory(false)}
          onReopen={async (sessionId) => { await actionsRef.current.reopenSession?.(sessionId); setShowHistory(false); }}
          onBack={() => setShowHistory(false)}
        />
      )}

      {!showHistory && (
        <>
          {showEndConfirm && <EndChatConfirmModal primaryColor={theme.primaryColor} onConfirm={handleEndChat} onCancel={() => setShowEndConfirm(false)} />}

          {showFeedback ? (
            <FeedbackModal primaryColor={theme.primaryColor}
              onSubmit={() => { setShowFeedback(false); onClose(); onStartNewChat?.(); }}
              onSkip={() => { setShowFeedback(false); onClose(); onStartNewChat?.(); }}
            />
          ) : flowStep === 'escalating' ? (
            <EscalatingScreen primaryColor={theme.primaryColor} onTimeout={() => { setFlowStep('free'); setShowQuickReplies(false); }} />
          ) : (
            <>
              {/* ── Message list ── */}
              <div style={{ ...styles.messages, position: 'relative' as const }} ref={messagesAreaRef} onScroll={handleMessagesScroll}>
                {state.loadingMore && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0 6px', gap: '8px' }}>
                    <SpinnerIcon color={theme.primaryColor} size={16} />
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>Loading older messages…</span>
                  </div>
                )}
                {!state.hasMore && allMessages.length > 0 && !state.loadingMore && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0 12px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', backgroundColor: '#f3eeff', padding: '3px 12px', borderRadius: '10px' }}>Beginning of conversation</span>
                  </div>
                )}
                {allMessages.map(msg => {
                  const isNew = hasRenderedOnce.current && !renderedMsgIds.current.has(msg.id);
                  return (
                    <div key={msg.id} id={`chat-msg-${msg.id}`} style={isNew ? { animation: 'chatFadeIn 0.2s ease', borderRadius: '12px' } : { borderRadius: '12px' }}>
                      <MessageBubble
                        message={msg} styles={styles} userName={config.user.name}
                        onImageClick={handleImageClick} onReply={handleReply}
                        replyToResolved={msg.replyToMessageId ? msgByIdMap.get(msg.replyToMessageId) ?? null : null}
                        tickStatus={tickMap.get(msg.id) ?? 'none'} primaryColor={theme.primaryColor}
                      />
                    </div>
                  );
                })}
                {state.isTyping && <TypingIndicator styles={styles} />}
                <div ref={messagesEndRef} />
              </div>

              {showJumpToBottom && (
                <div style={{ position: 'relative' as const, height: 0, zIndex: 10 }}>
                  <button
                    onClick={scrollToBottom} aria-label="Scroll to latest messages"
                    style={{ position: 'absolute', bottom: '8px', right: '16px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.primaryColor, transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = theme.primaryColor; (e.currentTarget as HTMLElement).style.color = '#ffffff'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff'; (e.currentTarget as HTMLElement).style.color = theme.primaryColor; }}
                  >
                    <ChevronDownIcon />
                  </button>
                  {unreadWhileScrolled > 0 && (
                    <div style={{ position: 'absolute', bottom: '38px', right: '12px', background: theme.primaryColor, color: '#fff', fontSize: '10px', fontWeight: 700, lineHeight: 1, padding: '3px 6px', borderRadius: '10px', minWidth: '18px', textAlign: 'center', boxShadow: `0 2px 6px ${theme.primaryColor}55`, pointerEvents: 'none' }}>
                      {unreadWhileScrolled > 99 ? '99+' : unreadWhileScrolled}
                    </div>
                  )}
                </div>
              )}

              {escalationError && (
                <div style={{ margin: '8px 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚠️</span>
                  <span style={{ flex: 1 }}>{escalationError}</span>
                  <button onClick={() => setEscalationError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1 }}>×</button>
                </div>
              )}

              {flowStep === 'faq' && (
                <FAQScreen primaryColor={theme.primaryColor} onSelect={handleFaqSelect} onBack={() => { setFlowStep('menu'); setShowQuickReplies(true); }} />
              )}

              {flowStep === 'menu' && showQuickReplies && (
                <QuickReplies replies={MAIN_MENU} onSelect={handleQuickReply} primaryColor={theme.primaryColor} />
              )}

              {/* ── Closed / input area ── */}
              {isClosed ? (
                (state as any).closeReason === 'SWITCHED' ? (
                  <div style={{ padding: '16px 14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#fafafa' }}>
                    <div style={{ fontSize: 28 }}>⏸</div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat on Hold</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This chat was put on hold while you switched to another session.<br />You can resume it from your chat history.</div>
                    </div>
                    {onStartNewChat && <button onClick={onStartNewChat} style={{ padding: '10px 24px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>+ Start New Chat</button>}
                  </div>
                ) : (
                  <div style={{ padding: '16px 14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#fafafa' }}>
                    <div style={{ fontSize: 28 }}>✅</div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Chat Ended</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>This session has been closed.<br />Need more help?</div>
                    </div>
                    {onStartNewChat && <button onClick={onStartNewChat} style={{ padding: '10px 24px', borderRadius: 22, border: 'none', background: `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)`, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>+ Start New Chat</button>}
                  </div>
                )
              ) : (
                <div style={{ flexShrink: 0 }}>
                  {state.uploading && (
                    <div style={{ padding: '8px 14px', backgroundColor: theme.primaryColor + '10', borderTop: `1px solid ${theme.primaryColor}30`, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke={theme.primaryColor} strokeWidth="3" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                        </path>
                      </svg>
                      <div style={{ flex: 1, height: '3px', borderRadius: '2px', backgroundColor: theme.primaryColor + '25', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: '2px', backgroundColor: theme.primaryColor, animation: 'chatUploadPulse 1.4s ease-in-out infinite' }} />
                      </div>
                      <span style={{ fontSize: '11px', color: theme.primaryColor, fontWeight: 600, flexShrink: 0 }}>Uploading…</span>
                    </div>
                  )}
                  {replyTarget && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f5', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, borderLeft: `3px solid ${theme.primaryColor}`, paddingLeft: '10px', overflow: 'hidden' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: theme.primaryColor, marginBottom: '1px' }}>{replyTarget.senderType === 'CUSTOMER' ? 'You' : (replyTarget.senderName || 'Agent')}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyTarget.content?.length > 80 ? replyTarget.content.slice(0, 80) + '…' : replyTarget.content}</div>
                      </div>
                      <button onClick={() => setReplyTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', lineHeight: 1, padding: '2px', flexShrink: 0 }}>×</button>
                    </div>
                  )}
                  <div style={styles.inputArea}>
                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={handleAttachment} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={!canType || state.uploading} title="Attach file"
                      style={{ background: 'none', border: 'none', cursor: (canType && !state.uploading) ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', opacity: (canType && !state.uploading) ? 0.6 : 0.3 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                    </button>
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={!canType || state.uploading}
                      title={isRecording ? 'Stop recording' : (state.uploading ? 'Uploading…' : 'Record audio')}
                      style={{ background: isRecording ? '#ef4444' : 'none', border: isRecording ? '2px solid #ef4444' : 'none', borderRadius: '50%', cursor: (canType && !state.uploading) ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (canType && !state.uploading) ? (isRecording ? 1 : 0.6) : 0.3, width: 28, height: 28, animation: isRecording ? 'pulse-recording 1.5s ease-in-out infinite' : 'none', transition: 'all 0.2s' }}
                    >
                      {isRecording
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="11" rx="3" /><path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>}
                    </button>
                    <input ref={inputRef} type="text"
                      placeholder={state.uploading ? '⏳ Uploading file, please wait...' : canType ? (isRecording ? '🔴 Recording audio...' : 'Type a message...') : 'Connecting...'}
                      value={inputValue} onChange={handleInputChange} onKeyDown={handleKeyDown} disabled={!canType}
                      style={{ ...styles.input, borderColor: inputValue ? theme.primaryColor + '88' : '#e5e7eb', opacity: canType ? 1 : 0.6 }}
                    />
                    <button onClick={handleSend} disabled={!isActive}
                      style={{ ...styles.sendBtn, background: isActive ? `linear-gradient(135deg,${theme.primaryColor},${theme.primaryColor}cc)` : '#f3f4f6', boxShadow: isActive ? `0 3px 12px ${theme.primaryColor}44` : 'none', cursor: isActive ? 'pointer' : 'not-allowed' }}>
                      <SendIcon active={!!isActive} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {viewerImage && (
        <div onClick={() => setViewerImage(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <button onClick={() => setViewerImage(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 700, backdropFilter: 'blur(4px)' }} aria-label="Close">×</button>
          <a href={viewerImage.url} download={viewerImage.fileName} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, right: 68, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', backdropFilter: 'blur(4px)', textDecoration: 'none' }} aria-label="Download">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </a>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 20, left: 16, right: 120, color: '#fff', fontSize: 13, fontWeight: 500, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewerImage.fileName}</div>
          <img src={viewerImage.url} alt={viewerImage.fileName} onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', cursor: 'default' }} />
        </div>
      )}
    </div>
  );
}

// ── ChatContentWithScrollRef — wires external scroll ref ──────────────────────

interface ChatContentWithScrollRefProps {
  onClose: () => void;
  styles: Record<string, React.CSSProperties>;
  config: ChatSDKConfig;
  theme: FullTheme;
  onStartNewChat?: () => void;
  scrollToBottomRef: React.MutableRefObject<(() => void) | null>;
}

export function ChatContentWithScrollRef({ scrollToBottomRef, ...props }: ChatContentWithScrollRefProps) {
  const localMessagesAreaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollToBottomRef.current = () => { const el = localMessagesAreaRef.current; if (el) el.scrollTop = el.scrollHeight; };
    return () => { scrollToBottomRef.current = null; };
  }, [scrollToBottomRef]);
  return <ChatContentInner {...props} externalMessagesAreaRef={localMessagesAreaRef} />;
}

// re-export getStyles so ChatWidget.tsx doesn't need to import from widget/theme directly
export { getStyles };
