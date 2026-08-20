



import React, {
  createContext, useContext, useReducer, useEffect, useCallback, useRef,
} from 'react';
import type { ChatSDKConfig, ChatSDKState, ChatSDKActions, ChatMessage, ChatSessionSummary, MessageType } from './types';
import { SenderType, toSenderType } from './shared/enums';
import { ChatWebSocketClient } from './client';
import { chatReducer, initialState } from './reducer';
import {
  ACK_TIMEOUT_MS, LOCAL_CODES, attributeServerError, classifySendError, toSendFailure,
} from './sendState';
import { SESSION_PICKER_LIMIT, normalizeSessionSummary } from './sessionHistory';
import type { ChatAction } from './reducer';

const _SDK_BUILD = '2026-06-26-enum-fix';
console.log(`%c[ChatSDK] Build: ${_SDK_BUILD}`, 'background:#7c3aed;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700;font-family:monospace;');

type EventCallback = (...args: unknown[]) => void;

// ── Helper: parse a timestamp safely ────────────────────────────────────────
function safeDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

// ── Normalize backend integer enums → strings ────────────────────────────────
// Backend sends §12 integer enums. These helpers accept both integer and string
// forms so the widget always works regardless of what the deployed client.ts
// build produces. Add at the boundary (fetch + WS handler) so state never
// contains raw integers.
function normSender(v: unknown): string {
  if (v === 'CUSTOMER' || v === 1) return 'CUSTOMER';
  if (v === 'AGENT'    || v === 2) return 'AGENT';
  if (v === 'BOT'      || v === 3) return 'BOT';
  if (v === 'SYSTEM'   || v === 4) return 'SYSTEM';
  const n = Number(v);
  if (n === 1) return 'CUSTOMER';
  if (n === 2) return 'AGENT';
  if (n === 3) return 'BOT';
  return 'SYSTEM';
}
function normMsgType(v: unknown): string {
  if (v === 'TEXT'   || v === 1) return 'TEXT';
  if (v === 'SYSTEM' || v === 2) return 'SYSTEM';
  if (v === 'FILE'   || v === 3) return 'FILE';
  if (v === 'IMAGE'  || v === 4) return 'IMAGE';
  if (v === 'VIDEO'  || v === 5) return 'VIDEO';
  if (v === 'AUDIO'  || v === 6) return 'AUDIO';
  const n = Number(v);
  if (n === 1) return 'TEXT';
  if (n === 2) return 'SYSTEM';
  if (n === 3) return 'FILE';
  if (n === 4) return 'IMAGE';
  if (n === 5) return 'VIDEO';
  if (n === 6) return 'AUDIO';
  return 'TEXT';
}
function normStatus(v: unknown): string {
  if (v === 'OPEN'              || v === 1) return 'OPEN';
  if (v === 'WAITING_FOR_AGENT' || v === 2) return 'WAITING_FOR_AGENT';
  if (v === 'ASSIGNED'          || v === 3) return 'ASSIGNED';
  if (v === 'CLOSED'            || v === 4) return 'CLOSED';
  if (v === 'RESOLVED'          || v === 5) return 'RESOLVED';
  if (v === 'ON_HOLD'           || v === 6) return 'ON_HOLD';
  if (v == null) return 'OPEN';
  const n = Number(v);
  if (n === 1) return 'OPEN';
  if (n === 2) return 'WAITING_FOR_AGENT';
  if (n === 3) return 'ASSIGNED';
  if (n === 4) return 'CLOSED';
  if (n === 5) return 'RESOLVED';
  if (n === 6) return 'ON_HOLD';
  return 'OPEN';
}
function normMode(v: unknown): string {
  if (v === 'BOT'   || v === 1) return 'BOT';
  if (v === 'HUMAN' || v === 2) return 'HUMAN';
  if (v == null) return 'BOT';
  const n = Number(v);
  return n === 2 ? 'HUMAN' : 'BOT';
}

interface ChatContextValue {
  state:   ChatSDKState;
  actions: ChatSDKActions;
  config:  ChatSDKConfig | null;
}
const ChatContext = createContext<ChatContextValue | null>(null);

const _activeConnections = new Map<string, boolean>();

// ── Map customer on first SDK init ────────────────────────────────────────────
async function mapCustomer(config: ChatSDKConfig): Promise<void> {
  try {
    console.log('%c[Chat] 🗺  mapCustomer → calling /customers/map', 'color:#7c3aed;font-weight:bold', {
      app_id:           config.tenantId,
      external_user_id: Number(config.user.id),
      username:         config.user.name,
      email:            config.user.email ?? '',
    });

    const res = await fetch('https://docs-dev.dhaamai.com/customers/map', {
      method: 'POST',
      headers: {
        'accept':        'application/json',
        'Authorization': `Bearer ${config.token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        app_id:           String(config.tenantId),
        external_user_id: Number(config.user.id),
        username:         config.user.name,
        email:            config.user.email ?? '',
        role_id:          4,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[Chat] mapCustomer failed:', res.status, body);
      return;
    }

    const data = await res.json();
    console.log('%c[Chat] ✅ mapCustomer success', 'color:#16a34a;font-weight:bold', data);
  } catch (e) {
    console.warn('[Chat] mapCustomer error (non-blocking):', e);
  }
}

export function ChatProvider({ config, children }: {
  config:   ChatSDKConfig;
  children: React.ReactNode;
}): JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const clientRef         = useRef<ChatWebSocketClient | null>(null);
  const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Used to show a typing indicator while the AI bot is processing a reply
  const botTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionKey     = `${config.tenantId}:${config.user?.id}`;
  const configRef         = useRef<ChatSDKConfig>(config);
  useEffect(() => { configRef.current = config; });

  const pendingReplaces      = useRef<Map<string, string>>(new Map());
  const pendingAttachTempIds = useRef<Set<string>>(new Set());
  // clientMessageId → tempId (for MESSAGE_ACK reconciliation)
  const clientMsgMap         = useRef<Map<string, string>>(new Map());
  // tempId → the send still awaiting chat.message.ack. Insertion-ordered, so
  // [...keys()] is oldest-first — which is what attributeServerError needs to
  // decide whether a chat.error can be blamed on a specific bubble.
  const inFlightSends        = useRef<Map<string, { clientMessageId: string; timer: ReturnType<typeof setTimeout> }>>(new Map());

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const lastTypingDispatch = useRef<{ isTyping: boolean; time: number } | null>(null);

  useEffect(() => {
    if (_activeConnections.get(connectionKey)) return;
    _activeConnections.set(connectionKey, true);
    // Guards against a stale run (e.g. a token refresh re-triggering this effect
    // while the previous connect/fetch is still in flight) dispatching into the
    // reducer after a newer run has already taken over — without this, the two
    // overlapping runs could interleave and make the widget appear to flip
    // between two different chat sessions.
    let cancelled = false;

    const initChat = async () => {
      dispatch({ type: 'INIT_START' });
      try {
        const cfg    = configRef.current;
        const client = new ChatWebSocketClient(cfg);
        clientRef.current = client;

        client.on('message', (msg: unknown) => {
          const _raw = msg as any;
          const message: ChatMessage = { ..._raw, senderType: normSender(_raw.senderType) as any, messageType: normMsgType(_raw.messageType) as any };
          if (message.senderType === 'CUSTOMER' && !message.id.startsWith('temp-')) {
            if (pendingReplaces.current.has(message.content)) {
              console.log('[Chat] Skipping text echo — replaceOptimistic will handle:', message.id);
              return;
            }
            if (pendingAttachTempIds.current.size > 0) {
              console.log('[Chat] Skipping attachment echo — replaceOptimistic will handle:', message.id);
              return;
            }
          }

          // ── Clear bot typing indicator when bot/agent reply arrives ──────────
          // We show a fake typing indicator while the AI processes. Clear it now.
          if (message.senderType === 'BOT' || message.senderType === 'AGENT') {
            if (botTypingTimerRef.current) {
              clearTimeout(botTypingTimerRef.current);
              botTypingTimerRef.current = null;
            }
            dispatch({ type: 'SET_TYPING', isTyping: false });
          }

          dispatch({ type: 'ADD_MESSAGE', message });

          // ── Mark customer-read when widget is open ────────────────────────
          const isFromAgentOrBot = message.senderType === 'AGENT' || message.senderType === 'BOT';
          if (isFromAgentOrBot && stateRef.current.isWidgetOpen && stateRef.current.session?.id) {
            // WS real-time read receipt (updates agent tick to READ)
            client.markRead();
            // REST persistence (updates participant lastReadAt in DB)
            const cfg = configRef.current;
            fetch(
              `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${stateRef.current.session.id}/read`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${cfg.token}`,
                  'X-Tenant-ID':   cfg.tenantId,
                  'Content-Type':  'application/json',
                },
                body: JSON.stringify({ customerId: cfg.user.id }),
              }
            ).catch(() => {}); // fire-and-forget
          }

          // ── Infer agentReadAt from real-time agent replies ─────────────────
          // When the agent sends a message, they have provably read all prior
          // customer messages. Use the message timestamp as the read watermark.
          // This covers the live case; page-refresh is handled by participants.
  
//           if (message.senderType === 'AGENT') {
//   const ts = safeDate(message.timestamp);
//   if (ts) {
//     // Use the later of: message timestamp or current time
//     // This handles clock skew between server and client
//     const readAt = new Date(Math.max(ts.getTime(), Date.now()));
//     console.log('%c[Chat] 📨 Agent reply → inferring agentReadAt', 'color:#7c3aed', readAt.toISOString());
//     dispatch({ type: 'SET_AGENT_READ_AT', readAt });
//   }
// }
 if (message.senderType === 'AGENT') {
  const ts = safeDate(message.timestamp);
  if (ts) {
    // Agent sending a message means they've read everything up to this point
    // Use the message timestamp — no artificial Date.now() floor
    dispatch({ type: 'SET_AGENT_READ_AT', readAt: ts });
  }
}


        });

        client.on('typing', ((rawData: any) => {
          const isTyping   = rawData?.isTyping ?? false;
          const senderId   = rawData?.senderId ?? '';
          const rawSender  = rawData?.senderType ?? rawData?.sender_type ?? '';
          const senderType = toSenderType(rawSender);

          console.log(`%c[Chat:TYPING] 📨 event received`, 'color:#f59e0b;font-weight:bold',
            { isTyping, senderId, senderType, raw: rawData?.senderType });

          if (senderType === SenderType.CUSTOMER) {
            console.log('[Chat:TYPING] Skipping — explicit CUSTOMER echo');
            return;
          }

          const now  = Date.now();
          const last = lastTypingDispatch.current;
          if (last !== null && last.isTyping === isTyping && (now - last.time) < 300) {
            console.log(`%c[Chat:TYPING] Suppressed same-value duplicate (${isTyping}) within 300ms`, 'color:#9ca3af');
            return;
          }

          lastTypingDispatch.current = { isTyping, time: now };
          if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
          dispatch({ type: 'SET_TYPING', isTyping, typingUser: senderId });

          if (isTyping) {
            typingTimerRef.current = setTimeout(() => {
              dispatch({ type: 'SET_TYPING', isTyping: false });
              typingTimerRef.current     = null;
              lastTypingDispatch.current = null;
            }, 5000);
          } else {
            lastTypingDispatch.current = null;
          }
        }) as EventCallback);

        client.on('statusChange', ((data: any) => {
          const status = normStatus(data.status);
          // Only the CURRENT session's status may move the current session.
          // Reactivating a past session can close the customer's other active
          // session (closeReason SWITCHED) — that arrives as a status change
          // for a DIFFERENT chatSessionId, and applying it here would mark the
          // session the customer is actually looking at as closed.
          const isCurrent = !data.chatSessionId || data.chatSessionId === stateRef.current.session?.id;
          if (isCurrent) {
            dispatch({ type: 'UPDATE_SESSION', session: { status: status as any, mode: normMode(data.mode) as any } });

            // Back to the queue means the assigned agent is gone. v1 never
            // emits chat.agent.left (declared in the backend's constants, but
            // no emit site exists — see notes on the agentLeft handler below),
            // so this status transition is the only signal v1 gives us that the
            // header must stop naming an agent who has left. Deliberately NOT
            // done for CLOSED/RESOLVED: naming whoever handled a finished
            // conversation is still correct.
            if (status === 'WAITING_FOR_AGENT' && stateRef.current.session?.assignedAgentId) {
              dispatch({
                type:    'UPDATE_SESSION',
                session: { assignedAgentId: undefined, assignedAgentName: undefined, assignedAgent: null },
              });
            }
          }
          // Normalised, not raw: the summary list is string-compared by the
          // picker, and the wire may carry integer enums. `closedAt: null` is
          // only correct for a session that is no longer terminal.
          if (data.chatSessionId) {
            dispatch({
              type:      'UPDATE_PAST_SESSION',
              sessionId: data.chatSessionId,
              updates:   {
                status: status as any,
                mode:   normMode(data.mode) as any,
                ...(status === 'CLOSED' || status === 'RESOLVED' ? {} : { closedAt: null }),
              },
            });
          }
          if (isCurrent && status === 'CLOSED' && data.closeReason) {
            dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
          }
          // Clear bot typing indicator when session changes status (escalation, assigned, etc.)
          if (botTypingTimerRef.current) {
            clearTimeout(botTypingTimerRef.current);
            botTypingTimerRef.current = null;
          }
          dispatch({ type: 'SET_TYPING', isTyping: false });
        }) as EventCallback);

        client.on('agentJoined', ((data: any) => {
          dispatch({
            type: 'UPDATE_SESSION',
            session: {
              assignedAgentId:   data.agentId,
              assignedAgentName: data.agentName,
              assignedAgent: data.agentName ? {
                displayName: data.agentName,
                email:       data.agentEmail || null,
                avatarUrl:   data.avatarUrl  || null,
                isOnline:    true,
              } : undefined,
              mode:   'HUMAN',
              status: 'ASSIGNED',
            },
          });

          // Inject a local system message so the customer immediately sees
          // who joined — the backend also persists this message and it arrives
          // via the 'message' event, but that may race with agentJoined.
          // ADD_MESSAGE deduplicates by id so no duplicate will appear.
          if (data.agentName) {
            const localSysMsg: any = {
              id:            `agentjoined-local-${data.agentId}-${Date.now()}`,
              chatSessionId: stateRef.current.session?.id ?? '',
              senderType:    'SYSTEM',
              senderId:      'system',
              content:       `${data.agentName} has joined the chat.`,
              messageType:   'TEXT',
              timestamp:     new Date(),
            };
            dispatch({ type: 'ADD_MESSAGE', message: localSysMsg });
          }
        }) as EventCallback);

        // ── agentLeft ────────────────────────────────────────────────────────
        // NOTE ON v1: this never fires today. `chat.agent.left` is declared in
        // the backend's WS_EVENTS constants, but websocket-server.ts has no
        // emit site for it — `escalationService.agentLeave` nulls
        // assignedAgentId and sets WAITING_FOR_AGENT in the DB and broadcasts
        // nothing. Wired anyway because the handler is free and correct the
        // moment the backend emits it; until then the header stops naming a
        // departed agent via the WAITING_FOR_AGENT transition in statusChange
        // above, or on the next /full refetch.
        client.on('agentLeft', ((data: any) => {
          const current = stateRef.current.session;
          if (!current) return;
          if (data?.chatSessionId && data.chatSessionId !== current.id) return;
          if (data?.agentId && current.assignedAgentId && data.agentId !== current.assignedAgentId) return;
          dispatch({
            type:    'UPDATE_SESSION',
            session: { assignedAgentId: undefined, assignedAgentName: undefined, assignedAgent: null },
          });
        }) as EventCallback);

        client.on('sessionClosed', ((data: any) => {
          // Reactivating a past session can close the customer's OTHER active
          // session with closeReason SWITCHED, so this fires for a session that
          // is not the one on screen. Keep the history row accurate either way…
          if (data?.chatSessionId) {
            dispatch({
              type:      'UPDATE_PAST_SESSION',
              sessionId: data.chatSessionId,
              updates:   { status: 'CLOSED' },
            });
          }
          // …but only park the CURRENT session. Without this guard the other
          // session's close would show the customer a "Chat Ended" panel over
          // the conversation they just switched into.
          if (data?.chatSessionId && data.chatSessionId !== stateRef.current.session?.id) return;
          if (data?.closeReason) {
            dispatch({ type: 'SET_CLOSE_REASON', reason: data.closeReason });
          }
        }) as EventCallback);

        client.on('disconnect', () => {
          console.log('[Chat] Disconnected — disabling input until reconnect ACK');
          dispatch({ type: 'SET_CONNECTED', connected: false });
        });

        client.on('reconnect', () => {
          console.log('[Chat] Transport reconnected — re-enabling input');
          dispatch({ type: 'SET_CONNECTED', connected: true });
          const sid = stateRef.current.session?.id;
          if (sid && !stateRef.current.tokenExpired) {
            console.log('[Chat] Fetching missed messages after reconnect for session:', sid);
            fetchMessages(configRef.current, sid, dispatch, true).catch(() => {});
          }
        });

        client.on('connectionAck', ((data: any) => {
          console.log('[Chat] connectionAck received — ensuring connected=true', data);
          dispatch({ type: 'SET_CONNECTED', connected: true });
          if (data?.status || data?.mode) {
            dispatch({ type: 'UPDATE_SESSION', session: { status: normStatus(data.status) as any, mode: normMode(data.mode) as any } });
          }
        }) as EventCallback);

        client.on('error', (error: unknown) => {
          dispatch({ type: 'SET_ERROR', error: error as Error });

          // v1's chat.error carries no clientMessageId, so it can only be
          // pinned on a bubble when exactly one send is in flight. With two or
          // more, guessing would fail the wrong message — each one's own ack
          // timeout is the safer answer. (Correlating errors to sends is a
          // backend follow-up: add clientMessageId to the v1 error frame.)
          const blamed = attributeServerError([...inFlightSends.current.keys()]);
          if (!blamed) return;
          const flight = inFlightSends.current.get(blamed);
          if (flight) { clearTimeout(flight.timer); inFlightSends.current.delete(blamed); }
          dispatch({ type: 'MARK_SEND_FAILED', tempId: blamed, failure: classifySendError(error) });
        });

        client.on('tokenExpired', () => {
          console.warn('[Chat] Token expired — blocking further messages');
          dispatch({ type: 'TOKEN_EXPIRED' });
          // Nothing in flight can land now, and no retry can fix it without a
          // refresh — so fail them with NO retry affordance rather than leaving
          // them on "sending" forever.
          for (const [tempId, flight] of inFlightSends.current) {
            clearTimeout(flight.timer);
            dispatch({ type: 'MARK_SEND_FAILED', tempId, failure: toSendFailure(LOCAL_CODES.TOKEN_EXPIRED) });
          }
          inFlightSends.current.clear();
        });

        // ── messageRead: handles explicit server read receipts ────────────────
        // The server sends readBy=SenderType.CUSTOMER when the customer calls /read.
        // We also handle readBy='AGENT' for future-proofing, and any non-standard
        // value (e.g. the server sends an agentId string instead of 'AGENT').
      
      
        // client.on('messageRead', ((data: any) => {
        //   if (!data?.readAt) return;

        //   const readBy = String(data.readBy ?? '').toUpperCase().trim();
        //   console.log('[Chat] messageRead event:', { readBy: data.readBy, readAt: data.readAt });

        //   const isAgentRead =
        //     readBy === SenderType.AGENT ||
        //     (readBy.length > 0 &&
        //       readBy !== SenderType.CUSTOMER &&
        //       readBy !== SenderType.SYSTEM &&
        //       readBy !== 'BOT');

        //   if (isAgentRead) {
        //     const ts = safeDate(data.readAt);
        //     if (ts) {
        //       console.log('%c[Chat] ✅ SET_AGENT_READ_AT from messageRead', 'color:#10b981', ts.toISOString());
        //       dispatch({ type: 'SET_AGENT_READ_AT', readAt: ts });
        //     }
        //   }
        // }) as EventCallback);


//         client.on('messageRead', ((data: any) => {
//   if (!data?.readAt) return;

//   const readBy = String(data.readBy ?? '').toUpperCase().trim();

//   const isAgentRead =
//     readBy === SenderType.AGENT ||
//     (readBy.length > 0 &&
//       readBy !== SenderType.CUSTOMER &&
//       readBy !== SenderType.SYSTEM &&
//       readBy !== 'BOT');

//   if (isAgentRead) {
//     const ts = safeDate(data.readAt);
//     if (ts) {
//       // ✅ Use max of server timestamp and now — covers clock skew
//       // but do NOT use Date.now() - 5000 as that creates a stale floor
//       const readAt = new Date(Math.max(ts.getTime(), Date.now()));
//       dispatch({ type: 'SET_AGENT_READ_AT', readAt });
//     }
//   }
// }) as EventCallback);


client.on('messageRead', ((data: any) => {
  if (!data?.readAt) return;

  // readBy is an integer (ParticipantType/SenderType) from the backend.
  const readBy = toSenderType(data.readBy);
  const isAgentRead = readBy === SenderType.AGENT;

  if (isAgentRead) {
    const ts = safeDate(data.readAt);
    if (ts) {
      const readAt = new Date(Math.max(ts.getTime(), Date.now()));
      dispatch({ type: 'SET_AGENT_READ_AT', readAt });
    }
  }
}) as EventCallback);

client.on('messageAck', ((data: any) => {
  const tempId = clientMsgMap.current.get(data?.clientMessageId);
  if (!tempId || !data?.messageId) return;
  // The send is settled — disarm the ack timeout so it cannot later mark a
  // message that did arrive as failed.
  const flight = inFlightSends.current.get(tempId);
  if (flight) { clearTimeout(flight.timer); inFlightSends.current.delete(tempId); }
  clientMsgMap.current.delete(data.clientMessageId);
  pendingReplaces.current.delete(stateRef.current.messages.find(m => m.id === tempId)?.content ?? '');
  const existing = stateRef.current.messages.find(m => m.id === tempId);
  if (!existing) return;
  dispatch({ type: 'REPLACE_TEMP', tempId, message: { ...existing, id: data.messageId } });
}) as EventCallback);

client.on('presenceUpdate', ((data: any) => {
  const session = stateRef.current.session;
  if (!session || !data?.userId) return;
  if (data.userId !== session.assignedAgentId) return;
  const isOnline = data.status === 1; // PresenceStatus.ONLINE
  if (!session.assignedAgent) return;
  dispatch({
    type:    'UPDATE_SESSION',
    session: { assignedAgent: { ...session.assignedAgent, isOnline } } as any,
  });
}) as EventCallback);

// ← ADD THIS RIGHT HERE ↓
// NEW_MESSAGE_NOTIFICATION — customer widget receives this when online.
// Unread badge is already handled by ADD_MESSAGE (triggered by MESSAGE_RECEIVE).
// This handler is a no-op stub; future: add vibration/sound for mobile widget.
client.on('newMessageNotification', ((_data: any) => {
  // no-op: ADD_MESSAGE handles badge; no push/Firebase for customer ever
}) as EventCallback);

client.on('ticketLinked', ((data: any) => {
  const ticketId   = data?.ticketId   ?? data?.ticket_id   ?? data?.id   ?? '';
  const ticketUrl  = data?.ticketUrl  ?? data?.ticket_url  ?? null;
  const ticketCode = data?.ticketCode ?? data?.code        ?? ticketId;

  // Update session so the launcher badge shows the ticket ID
  dispatch({
    type:    'UPDATE_SESSION',
    session: { ticketId: ticketCode, ticketUrl } as any,
  });

  // Inject a chat announcement
  const sysMsg: any = {
    id:            `ticket-linked-${ticketId}-${Date.now()}`,
    chatSessionId: stateRef.current.session?.id ?? '',
    senderType:    'SYSTEM',
    senderId:      'system',
    content:       `🎫 Ticket #${ticketCode} has been created for this chat.${ticketUrl ? ` Track it at: ${ticketUrl}` : ''}`,
    messageType:   'TEXT',
    timestamp:     new Date(),
  };
  dispatch({ type: 'ADD_MESSAGE', message: sysMsg });
}) as EventCallback);

        let _rawSession = await client.connect();
        if (cancelled) return;
        let session = { ..._rawSession, mode: normMode(_rawSession.mode) as any, status: normStatus(_rawSession.status) as any };

        mapCustomer(cfg);

        if (session.status === 'CLOSED') {
          console.log('[Chat] Got CLOSED session — creating fresh session via REST');
          try {
            const res = await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions`, {
              method:  'POST',
              headers: {
                'Authorization': `Bearer ${cfg.token}`,
                'X-Tenant-ID':   cfg.tenantId,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({
                tenantId:      cfg.tenantId,
                customerId:    cfg.user.id,
                customerName:  cfg.user.name,
                customerEmail: cfg.user.email,
              }),
            });
            if (res.ok) {
              const json      = await res.json();
              const newId     = json.data?.sessionId ?? json.data?.id;
              const newMode   = normMode(json.data?.mode   ?? 'BOT');
              const newStatus = normStatus(json.data?.status ?? 'OPEN');
              if (newId) {
                client.joinSession(newId);
                session = { id: newId, mode: newMode as any, status: newStatus as any };
                console.log('[Chat] Switched to fresh session:', newId);
              }
            }
          } catch (e) {
            console.warn('[Chat] Could not create fresh session:', e);
          }
        }

        await fetchMessages(configRef.current, session.id, dispatch, false);
        if (cancelled) return;
        dispatch({ type: 'INIT_SUCCESS', session });
        configRef.current.callbacks?.onConnected?.(session.id);

        // Hydrate assigned agent presence on session start
        if (session.assignedAgentId) {
          client.presenceQuery([session.assignedAgentId]);
        }

      } catch (error) {
        if (cancelled) return;
        _activeConnections.delete(connectionKey);
        dispatch({ type: 'INIT_ERROR', error: error as Error });
        configRef.current.callbacks?.onError?.(error as Error);
      }
    };

    initChat();

    return () => {
      cancelled = true;
      _activeConnections.delete(connectionKey);
      pendingReplaces.current.clear();
      clientMsgMap.current.clear();
      for (const flight of inFlightSends.current.values()) clearTimeout(flight.timer);
      inFlightSends.current.clear();
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (botTypingTimerRef.current) {
        clearTimeout(botTypingTimerRef.current);
        botTypingTimerRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [connectionKey, config.serviceUrl, config.token]);

  // ── Actions ───────────────────────────────────────────────────────────────

  // ── beginSend ─────────────────────────────────────────────────────────────
  // The ONE place a customer message is put on the wire. Both the first attempt
  // and every retry go through here, so the two cannot drift — and crucially a
  // retry passes the SAME clientMessageId, which the backend dedupes on
  // (prisma: @@unique([chatSessionId, clientMessageId]); message.service.ts:78
  // returns the existing message for a repeat). Minting a fresh id on retry is
  // what made each click create another message instead of retrying the first.
  //
  // Every send either gets acked or is marked failed by the ack timeout — there
  // is no third outcome, which is what stops a bubble sitting on "sending"
  // forever.
  const beginSend = useCallback((args: {
    tempId: string;
    clientMessageId: string;
    content: string;
    type: MessageType;
    replyToMessageId?: string;
  }) => {
    const { tempId, clientMessageId, content, type, replyToMessageId } = args;

    clientMsgMap.current.set(clientMessageId, tempId);
    const prev = inFlightSends.current.get(tempId);
    if (prev) clearTimeout(prev.timer);

    const timer = setTimeout(() => {
      inFlightSends.current.delete(tempId);
      dispatch({ type: 'MARK_SEND_FAILED', tempId, failure: toSendFailure(LOCAL_CODES.ACK_TIMEOUT) });
    }, ACK_TIMEOUT_MS);
    inFlightSends.current.set(tempId, { clientMessageId, timer });

    dispatch({ type: 'MARK_SENDING', tempId });

    try {
      clientRef.current!.sendMessage(content, type, replyToMessageId, clientMessageId);
    } catch (err) {
      // Synchronous refusal (not connected / token expired). Fail it NOW rather
      // than letting the caller's floating promise reject unobserved and the
      // bubble hang on "sending" until the timeout.
      clearTimeout(timer);
      inFlightSends.current.delete(tempId);
      dispatch({ type: 'MARK_SEND_FAILED', tempId, failure: classifySendError(err) });
    }
  }, []);

  const sendMessage = useCallback(async (content: string, type: MessageType = 'TEXT', replyToMessageId?: string) => {
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

    const clientMessageId = crypto.randomUUID();
    const tempId          = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const optimistic: ChatMessage = {
      id:            tempId,
      chatSessionId: s.session.id,
      senderType:    'CUSTOMER',
      senderId:      configRef.current.user.id,
      senderName:    configRef.current.user.name,
      content,
      messageType:   type,
      timestamp:     new Date(),
      clientKey:     tempId,
      clientMessageId,
      sendStatus:    'sending',
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };

    pendingReplaces.current.set(content, tempId);
    dispatch({ type: 'ADD_MESSAGE', message: optimistic });
    beginSend({ tempId, clientMessageId, content, type, replyToMessageId });

    // ── Show bot typing indicator while AI processes the message ─────────────
    // Only in BOT mode sessions — if an agent is assigned, they have their
    // own real typing events. We auto-clear after 15 s as a safety fallback.
    const currentMode   = stateRef.current.session?.mode;
    const currentStatus = stateRef.current.session?.status;
    const isBotSession  = currentMode !== 'HUMAN' && currentStatus !== 'ASSIGNED' && currentStatus !== 'WAITING_FOR_AGENT';
    if (isBotSession) {
      // Clear any existing bot typing timer
      if (botTypingTimerRef.current) clearTimeout(botTypingTimerRef.current);
      dispatch({ type: 'SET_TYPING', isTyping: true, typingUser: 'AI Assistant' });
      // Safety fallback: clear after 15 s if bot reply never arrives
      botTypingTimerRef.current = setTimeout(() => {
        dispatch({ type: 'SET_TYPING', isTyping: false });
        botTypingTimerRef.current = null;
      }, 15_000);
    }

    const replaceOptimistic: EventCallback = (rawEvt: unknown) => {
      const _r = rawEvt as any;
      const msg: ChatMessage = { ..._r, senderType: normSender(_r.senderType) as any, messageType: normMsgType(_r.messageType) as any };
      if (msg.senderType === 'CUSTOMER' && msg.content === content && !msg.id.startsWith('temp-')) {
        dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
        pendingReplaces.current.delete(content);
        clientRef.current?.off?.('message', replaceOptimistic);
      }
    };
    clientRef.current.on('message', replaceOptimistic);
    setTimeout(() => {
      clientRef.current?.off?.('message', replaceOptimistic);
      pendingReplaces.current.delete(content);
    }, 10_000);
  }, []);

  // ── retryMessage ──────────────────────────────────────────────────────────
  // Replays the ORIGINAL clientMessageId. That is the whole fix for "retry
  // creates a duplicate": the server dedupes on (chatSessionId,
  // clientMessageId), so replaying reconciles onto the same row, while minting
  // a new id writes a second message every click.
  const retryMessage = useCallback(async (messageId: string) => {
    const s      = stateRef.current;
    const target = s.messages.find(m => m.id === messageId);
    if (!target) return;
    if (target.sendStatus !== 'failed') return;
    // Defence in depth: the UI does not render a retry control for these, but
    // a programmatic caller must not be able to hammer a refusal either.
    if (target.sendFailure && !target.sendFailure.retryable) return;
    if (!target.clientMessageId) return;   // nothing to replay onto
    if (!clientRef.current || !s.session) return;
    if (clientRef.current.tokenExpired || s.tokenExpired) return;

    pendingReplaces.current.set(target.content, messageId);
    beginSend({
      tempId:           messageId,
      clientMessageId:  target.clientMessageId,
      content:          target.content,
      type:             target.messageType,
      replyToMessageId: target.replyToMessageId ?? undefined,
    });
  }, [beginSend]);

  const startTyping = useCallback(() => { clientRef.current?.startTyping?.(); }, []);
  const stopTyping  = useCallback(() => { clientRef.current?.stopTyping?.();  }, []);

  const requestAgent = useCallback(async (reason?: string) => {
    clientRef.current?.requestAgent?.(reason);
  }, []);

  const closeSession = useCallback(async () => {
    const session = stateRef.current.session;
    if (!session) return;
    const cfg = configRef.current;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${session.id}/close`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
      });
      dispatch({ type: 'UPDATE_SESSION', session: { status: 'CLOSED' } });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', error: error as Error });
    }
  }, []);

  const reconnect = useCallback(async () => {
    if (clientRef.current) { clientRef.current.disconnect(); clientRef.current = null; }
    _activeConnections.delete(connectionKey);
    pendingReplaces.current.clear();
    dispatch({ type: 'INIT_START' });
    try {
      const client  = new ChatWebSocketClient(configRef.current);
      clientRef.current = client;
      const session = await client.connect();
      dispatch({ type: 'INIT_SUCCESS', session });
    } catch (error) {
      dispatch({ type: 'INIT_ERROR', error: error as Error });
    }
  }, [connectionKey]);

  const setWidgetOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_WIDGET_OPEN', open });
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const s = stateRef.current;
    if (!s.session || s.loadingMore || !s.hasMore) return;
    const oldest = s.messages[0];
    if (!oldest) return;

    dispatch({ type: 'SET_LOADING_MORE', loading: true });
    try {
      const cfg = configRef.current;
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/messages?limit=20&before=${oldest.id}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
      });
      if (!res.ok) { dispatch({ type: 'SET_LOADING_MORE', loading: false }); return; }
      const json = await res.json();
      const data = json.data ?? {};
      const messages: ChatMessage[] = (data.messages ?? []).map((m: any) => {
        const d = new Date(m.createdAt ?? m.timestamp);
        return {
          id:               m.id,
          chatSessionId:    m.chatSessionId,
          senderType:       normSender(m.senderType)   as any,
          senderId:         m.senderId,
          senderName:       m.senderName,
          content:          m.content,
          messageType:      normMsgType(m.messageType) as any,
          timestamp:        isNaN(d.getTime()) ? new Date() : d,
          metadata:         m.metadata,
          attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
          replyToMessageId: m.replyToMessageId ?? undefined,
          replyToMessage:   m.replyToMessage   ?? undefined,
        };
      });
      dispatch({ type: 'PREPEND_MESSAGES', messages, hasMore: data.hasMore ?? false });
    } catch (err) {
      console.error('[Chat] loadOlderMessages failed:', err);
      dispatch({ type: 'SET_LOADING_MORE', loading: false });
    }
  }, []);

  const sendAttachment = useCallback(async (file: File) => {
    const s = stateRef.current;
    if (!clientRef.current || !s.session) throw new Error('Chat not initialized');
    if (clientRef.current.tokenExpired || s.tokenExpired) throw new Error('TOKEN_EXPIRED');

    let optType: MessageType = 'FILE';
    if (file.type.startsWith('image/'))       optType = 'IMAGE';
    else if (file.type.startsWith('video/'))  optType = 'VIDEO';
    else if (file.type.startsWith('audio/'))  optType = 'AUDIO';

    const tempId = `temp-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id:            tempId,
      chatSessionId: s.session.id,
      senderType:    'CUSTOMER',
      senderId:      configRef.current.user.id,
      senderName:    configRef.current.user.name,
      content:       file.name,
      messageType:   optType,
      timestamp:     new Date(),
      clientKey:     tempId,
      sendStatus:    'sending',
    };

    dispatch({ type: 'SET_UPLOADING', uploading: true });
    dispatch({ type: 'ADD_MESSAGE', message: optimistic });
    pendingAttachTempIds.current.add(tempId);

    try {
      await clientRef.current.sendAttachment(file);
      const replaceOptimistic: EventCallback = (rawEvt: unknown) => {
        const _r = rawEvt as any;
        const msg: ChatMessage = { ..._r, senderType: normSender(_r.senderType) as any, messageType: normMsgType(_r.messageType) as any };
        if (
          msg.senderType === 'CUSTOMER' &&
          !msg.id.startsWith('temp-') &&
          (msg.messageType === optType || msg.messageType === 'FILE')
        ) {
          dispatch({ type: 'REPLACE_TEMP', tempId, message: msg });
          pendingAttachTempIds.current.delete(tempId);
          clientRef.current?.off?.('message', replaceOptimistic);
        }
      };
      clientRef.current.on('message', replaceOptimistic);
      setTimeout(() => {
        clientRef.current?.off?.('message', replaceOptimistic);
        pendingAttachTempIds.current.delete(tempId);
      }, 15_000);
    } catch (err) {
      console.error('[Chat] Attachment upload failed:', err);
      dispatch({ type: 'SET_ERROR', error: err as Error });
      // The optimistic attachment bubble used to sit here forever with no tick
      // and no error. Mark it failed — non-retryable, because the File is gone
      // by now and a "Retry" that has nothing to resend is a lie.
      pendingAttachTempIds.current.delete(tempId);
      dispatch({ type: 'MARK_SEND_FAILED', tempId, failure: toSendFailure(LOCAL_CODES.UPLOAD_FAILED) });
    } finally {
      dispatch({ type: 'SET_UPLOADING', uploading: false });
    }
  }, []);

  // ── fetchPastSessions ─────────────────────────────────────────────────────
  // GET /chat/sessions/customer?limit=5. Identity comes entirely from the
  // token — the tenantId/customerId query params this used to send are not
  // parameters of this operation (customerSessionsQuerySchema accepts `limit`
  // only) and were ignored. The limit was 6; the endpoint's own default is 5.
  //
  // The backend decides guest-vs-logged-in and returns [] for a guest, so
  // there is no client-side guest check here or anywhere else — an empty list
  // is the whole signal (see sessionHistory.shouldShowSessionPicker).
  const fetchPastSessions = useCallback(async () => {
    const cfg = configRef.current;
    try {
      const url = `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/customer?limit=${SESSION_PICKER_LIMIT}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.token}`, 'X-Tenant-ID': cfg.tenantId },
      });
      if (!res.ok) return;
      const json = await res.json();
      const sessions: ChatSessionSummary[] = (json.data?.sessions ?? []).map((s: any) =>
        normalizeSessionSummary(s, normStatus(s.status), normMode(s.mode)));
      dispatch({ type: 'SET_PAST_SESSIONS', sessions });
    } catch (e) {
      console.warn('[Chat] fetchPastSessions failed:', e);
    }
  }, []);

  // ── selectSession ─────────────────────────────────────────────────────────
  // Switch the widget to an existing session and show its transcript. Purely
  // client-side: it joins the room and refetches, and mutates nothing.
  //
  // WHY NOT POST /chat/sessions/{id}/reopen HERE — this is the load-bearing
  // decision for the picker. That endpoint converges rather than switching: if
  // the customer already has a *different* active session it ignores the id you
  // asked for and returns that other session instead
  // (chat-session.service.ts:364-371, documented in openapi/chat-api.yaml under
  // "Convergence behavior"). For a picker whose entire contract is "put me in
  // THIS conversation", silently landing the customer in a different one is the
  // one failure it cannot have. /reopen stays available as `reopenSession` for
  // callers that genuinely want converge-onto-my-active-session semantics.
  //
  // A terminal session picked this way comes back when the customer TYPES:
  // the backend reactivates a CLOSED/RESOLVED session on a CUSTOMER message
  // (behind FEATURE_SESSION_REACTIVATE_ON_CUSTOMER_MESSAGE). We do not
  // pre-emptively transition it here — we let the server decide and observe the
  // resulting chat.status.changed, so the widget never shows a session as
  // reopened that the server did not in fact reopen.
  const selectSession = useCallback(async (sessionId: string) => {
    const cfg = configRef.current;
    if (!sessionId) return;
    if (stateRef.current.session?.id === sessionId) return;

    const picked = stateRef.current.pastSessions.find(s => s.id === sessionId);
    clientRef.current?.joinSession(sessionId, picked?.status);
    dispatch({ type: 'SET_CLOSE_REASON', reason: null });
    dispatch({ type: 'SET_MESSAGES', messages: [], hasMore: false });

    // Carry over what the summary already told us, so the header names the
    // right handler before /full comes back. Status stays whatever the summary
    // said — including terminal: terminal is not final, and claiming otherwise
    // before the server has reactivated anything would be a lie.
    const summary = picked;
    dispatch({
      type: 'INIT_SUCCESS',
      session: {
        id:     sessionId,
        mode:   (summary?.mode   ?? 'BOT')  as any,
        status: (summary?.status ?? 'OPEN') as any,
        ...(summary?.handledBy?.kind === 'AGENT'
          ? { assignedAgentId: summary.handledBy.id, assignedAgentName: summary.handledBy.displayName }
          : {}),
      },
    });

    await fetchMessages(cfg, sessionId, dispatch, false);
  }, []);

  const reopenSession = useCallback(async (sessionId: string) => {
    const cfg              = configRef.current;
    const currentSessionId = stateRef.current.session?.id;
    const currentStatus    = stateRef.current.session?.status;

    if (currentSessionId && currentStatus !== 'CLOSED' && currentSessionId !== sessionId) {
      try {
        await fetch(
          `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${currentSessionId}/close`,
          {
            method:  'POST',
            headers: {
              'Authorization': `Bearer ${cfg.token}`,
              'X-Tenant-ID':   cfg.tenantId,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ customerId: cfg.user.id, closeReason: 'SWITCHED' }),
          }
        );
        console.log('[Chat] Previous session put on hold:', currentSessionId);
      } catch (e) {
        console.warn('[Chat] Could not put previous session on hold:', e);
      }

      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          id:            `system-hold-${Date.now()}`,
          chatSessionId: currentSessionId,
          senderType:    'SYSTEM',
          senderId:      'system',
          content:       '⏸ Your chat has been put on hold because you switched to another session.',
          messageType:   'TEXT',
          timestamp:     new Date(),
        } as any,
      });

      dispatch({ type: 'SET_CLOSE_REASON', reason: 'SWITCHED' });
    }

    const res = await fetch(
      `${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/reopen`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ customerId: cfg.user.id }),
      },
    );
    if (!res.ok) throw new Error('Failed to reopen session');
    const json = await res.json();
    const data = json.data;

    dispatch({ type: 'SET_CLOSE_REASON', reason: null });
    clientRef.current?.joinSession(data.sessionId ?? sessionId);
    dispatch({
      type:    'INIT_SUCCESS',
      session: { id: data.sessionId ?? sessionId, mode: 'HUMAN', status: 'WAITING_FOR_AGENT' },
    });
    dispatch({ type: 'SET_MESSAGES', messages: [], hasMore: false });
    await fetchMessages(cfg, data.sessionId ?? sessionId, dispatch, false);

    return { sessionId: data.sessionId ?? sessionId, status: data.status, mode: data.mode };
  }, []);

  const markMessagesRead = useCallback(async () => {
    const s   = stateRef.current;
    const cfg = configRef.current;
    if (!s.session) return;
    try {
      await fetch(`${cfg.serviceUrl}/chat-services/api/v1/chat/sessions/${s.session.id}/read`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'X-Tenant-ID':   cfg.tenantId,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ customerId: cfg.user.id }),
      });
    } catch (e) {
      console.warn('[Chat] markMessagesRead failed:', e);
    }
  }, []);

  const actions: ChatSDKActions = {
    sendMessage, sendAttachment, startTyping, stopTyping,
    closeSession, requestAgent, reconnect, setWidgetOpen, loadOlderMessages,
    fetchPastSessions, reopenSession, selectSession, markMessagesRead, retryMessage,
  };

  return (
    <ChatContext.Provider value={{ state, actions, config }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
export const useChatMessages = () => useChat().state.messages;
export const useChatSession  = () => useChat().state.session;
export const useChatActions  = () => useChat().actions;
export const useChatState    = () => useChat().state;

async function fetchMessages(
  config:    ChatSDKConfig,
  sessionId: string,
  dispatch:  React.Dispatch<ChatAction>,
  mergeOnly: boolean = false,
): Promise<void> {
  try {
    const res = await fetch(
      `${config.serviceUrl}/chat-services/api/v1/chat/sessions/${sessionId}/full`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Tenant-ID':   config.tenantId,
        },
      },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.data?.messages) return;

    const messages: ChatMessage[] = data.data.messages.map((m: any) => {
      const d           = new Date(m.createdAt ?? m.timestamp);
      const msgType     = normMsgType(m.messageType);
      const hasMediaContent = m.content && (
        m.content.includes('/audio/') ||
        m.content.includes('/video/') ||
        /\.(mp3|wav|ogg|m4a|aac|mp4|webm|mov)(\?|$)/i.test(m.content)
      );
      if (msgType !== 'TEXT' || hasMediaContent || m.metadata?.attachment) {
        console.log('[Chat] fetchMessages MEDIA message RAW:', JSON.stringify(m, null, 2));
      }
      return {
        id:               m.id,
        chatSessionId:    m.chatSessionId,
        senderType:       normSender(m.senderType) as any,
        senderId:         m.senderId,
        senderName:       m.senderName,
        content:          m.content,
        messageType:      msgType as any,
        timestamp:        isNaN(d.getTime()) ? new Date() : d,
        metadata:         m.metadata,
        attachment:       m.attachment ?? m.metadata?.attachment ?? undefined,
        replyToMessageId: m.replyToMessageId ?? undefined,
        replyToMessage:   m.replyToMessage   ?? undefined,
      };
    });

    const hasMore = data.data.hasMore ?? false;

    if (mergeOnly) {
      for (const msg of messages) {
        dispatch({ type: 'ADD_MESSAGE', message: msg });
      }
    } else {
      dispatch({ type: 'SET_MESSAGES', messages, hasMore });
    }

    // ── Session metadata ──────────────────────────────────────────────────
    const sess = data.data.session;
    if (sess) {
      dispatch({
        type: 'UPDATE_SESSION',
        session: {
          ...(sess.assignedAgentId            && { assignedAgentId:   sess.assignedAgentId }),
          ...(sess.assignedAgent              && { assignedAgent:     sess.assignedAgent }),
          ...(sess.assignedAgent?.displayName && { assignedAgentName: sess.assignedAgent.displayName }),
          ...(sess.customer                   && { customer:          sess.customer }),
        },
      });
    }

    // ── Restore read watermarks from participants ──────────────────────────
    // participants[].lastReadAt is persisted by the backend, so it survives
    // page refreshes. We use it as the source of truth instead of seeding
    // an artificial "now" timestamp.
    const participants: any[] = data.data.participants ?? [];

 // Use the LATEST lastReadAt across all agent participants
// (there may be multiple agents in a session)
const agentParticipants = participants.filter(
  (p: any) => p.participantType === SenderType.AGENT && p.lastReadAt
);
if (agentParticipants.length > 0) {
  const latestReadAt = agentParticipants.reduce((latest: Date | null, p: any) => {
    const ts = new Date(p.lastReadAt);
    if (isNaN(ts.getTime())) return latest;
    return latest === null || ts > latest ? ts : latest;
  }, null as Date | null);

  if (latestReadAt) {
    console.log('%c[Chat] ✅ Restored agentReadAt from participants', 'color:#16a34a', latestReadAt.toISOString());
    dispatch({ type: 'SET_AGENT_READ_AT', readAt: latestReadAt });
  }
}

    const customerParticipant = participants.find(
      (p: any) => p.participantType === SenderType.CUSTOMER && p.lastReadAt
    );
    if (customerParticipant?.lastReadAt) {
      const ts = new Date(customerParticipant.lastReadAt);
      if (!isNaN(ts.getTime())) {
        console.log('%c[Chat] ✅ Restored customerReadAt from participants', 'color:#16a34a', ts.toISOString());
        dispatch({ type: 'UPDATE_SESSION', session: { customerReadAt: ts } as any });
      }
    }

  } catch (e) {
    console.error('[Chat] fetchMessages failed:', e);
  }
}