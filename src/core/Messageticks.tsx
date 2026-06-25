// ============================================================
// MessageTicks.tsx  —  shared WhatsApp-style tick indicators
// ============================================================
// Used by both ChatPanel (agent dashboard) and ChatWidget (customer widget).
//
// Rules (mirrors WhatsApp exactly):
//   CUSTOMER messages (sent by customer, shown on right in widget):
//     - Single grey tick  = message saved to DB (optimistic gone, real ID exists)
//     - Double grey tick  = agent has opened the conversation (session ASSIGNED)
//     - Double PURPLE tick = agent has explicitly read (agentReadAt >= msg timestamp)
//
//   AGENT / BOT messages (sent by agent, shown on right in ChatPanel):
//     - Single grey tick  = message sent to server
//     - Double grey tick  = customer is connected / session active
//     - Double PURPLE tick = customer has explicitly read (customerReadAt >= msg timestamp)
//
// Persistence:
//   Read timestamps come from WS events (MESSAGE_READ) and are stored in
//   React state in the parent. We compute tick status purely from timestamps
//   so re-renders always produce the same result — no local tick state needed.
// ============================================================

import React from 'react';

// ── Colours ───────────────────────────────────────────────────────────────────
const PURPLE = '#7c3aed';
const GREY   = '#a0aec0';   // single / unread double

// ── SVG primitives ────────────────────────────────────────────────────────────

/** Single thin check — "sent to server" */
export const SingleTick = ({ color = GREY }: { color?: string }) => (
  <svg
    width="14" height="10" viewBox="0 0 14 10"
    fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
  >
    <polyline
      points="1,5 5,9 13,1"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Double overlapping checks — "delivered / seen" */
export const DoubleTick = ({ color = GREY }: { color?: string }) => (
  <svg
    width="18" height="10" viewBox="0 0 18 10"
    fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
  >
    {/* Back check */}
    <polyline
      points="5,5 9,9 17,1"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Front check (offset left) */}
    <polyline
      points="1,5 5,9 13,1"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ── Tick status derivation ─────────────────────────────────────────────────────

export type TickStatus =
  | 'none'          // optimistic / system / not a trackable message
  | 'sent'          // single grey  — on server
  | 'delivered'     // double grey  — other party connected
  | 'seen';         // double purple — other party has read

/**
 * Compute the tick status for a single message.
 *
 * @param msgTimestamp   ISO string or Date of the message
 * @param msgId          Used to detect optimistic messages (start with "optimistic-" / "opt-" / "temp-")
 * @param senderType     'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM'
 * @param isOwnMessage   true when this is a message sent by the current viewer
 *                       (agent for ChatPanel, customer for ChatWidget)
 * @param readAt         The read watermark from the OTHER party.
 *                       For agent msgs: customerReadAt (customer saw agent's message)
 *                       For customer msgs: agentReadAt   (agent saw customer's message)
 * @param otherPartyOnline  Whether the other party is currently connected/active
 */
export function getTickStatus(params: {
  msgTimestamp:     string | Date;
  msgId:            string;
  senderType:       string;
  isOwnMessage:     boolean;
  readAt:           Date | null;
  otherPartyOnline: boolean;
}): TickStatus {
  const { msgTimestamp, msgId, senderType, isOwnMessage, readAt, otherPartyOnline } = params;

  // Only show ticks on own messages (sent by the current viewer)
  if (!isOwnMessage) return 'none';

  // Never show on SYSTEM messages
  if (senderType === 'SYSTEM') return 'none';

  // Optimistic / temp messages: no tick yet (not on server)
  if (
    msgId.startsWith('optimistic-') ||
    msgId.startsWith('opt-') ||
    msgId.startsWith('temp-') ||
    msgId.startsWith('local-')
  ) return 'none';

  // Parse message timestamp
  const msgTime = msgTimestamp instanceof Date ? msgTimestamp : new Date(msgTimestamp);
  if (isNaN(msgTime.getTime())) return 'sent';

  // SEEN — read watermark covers this message
  if (readAt && msgTime <= readAt) return 'seen';

  // DELIVERED — other party is active/connected
  if (otherPartyOnline) return 'delivered';

  // Default: message is on server, other party not yet seen
  return 'sent';
}

// ── The rendered component ────────────────────────────────────────────────────

interface MessageTicksProps {
  status:   TickStatus;
  /** Override the purple colour (matches brand colour of the host UI) */
  purple?:  string;
  /** Extra wrapper style */
  style?:   React.CSSProperties;
  /** Show a text label next to the ticks ("Seen", "Sent") */
  showLabel?: boolean;
  labelStyle?: React.CSSProperties;
}

export const MessageTicks = React.memo(function MessageTicks({
  status,
  purple   = PURPLE,
  style,
  showLabel = false,
  labelStyle,
}: MessageTicksProps) {
  if (status === 'none') return null;

  const wrapper: React.CSSProperties = {
    display:    'inline-flex',
    alignItems: 'center',
    gap:        '2px',
    lineHeight: 1,
    ...style,
  };

  if (status === 'sent') {
    return (
      <span style={wrapper}>
        <SingleTick color={GREY} />
        {showLabel && (
          <span style={{ fontSize: 10, color: GREY, fontWeight: 500, ...labelStyle }}>Sent</span>
        )}
      </span>
    );
  }

  if (status === 'delivered') {
    return (
      <span style={wrapper}>
        <DoubleTick color={GREY} />
        {showLabel && (
          <span style={{ fontSize: 10, color: GREY, fontWeight: 500, ...labelStyle }}>Delivered</span>
        )}
      </span>
    );
  }

  // seen
  return (
    <span style={wrapper}>
      <DoubleTick color={purple} />
      {showLabel && (
        <span style={{ fontSize: 10, color: purple, fontWeight: 700, ...labelStyle }}>Seen</span>
      )}
    </span>
  );
});

// ── Hook: compute all tick statuses for a message list in one pass ─────────────
// This is O(n) and memoisation-friendly: only recomputes when messages or
// readAt timestamps change.

export interface TickMap {
  /** Map<messageId, TickStatus> */
  ticks: Map<string, TickStatus>;
}

/**
 * Compute tick statuses for every message in the list.
 * Call this once in the parent component, pass the resulting map down.
 */
export function buildTickMap(params: {
  messages:          Array<{ id: string; createdAt?: string; timestamp?: Date | string; senderType: string }>;
  viewerSenderType:  'AGENT' | 'CUSTOMER';   // who is looking at the chat
  readAt:            Date | null;             // read watermark from the OTHER party
  otherPartyOnline:  boolean;
}): Map<string, TickStatus> {
  const { messages, viewerSenderType, readAt, otherPartyOnline } = params;
  const map = new Map<string, TickStatus>();

  for (const msg of messages) {
    const isOwnMessage = msg.senderType === viewerSenderType ||
      // BOT messages are "owned" by the agent side (agent dashboard shows them)
      (viewerSenderType === 'AGENT' && msg.senderType === 'BOT');

    const ts = msg.createdAt ?? (msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp) ?? '';

    map.set(msg.id, getTickStatus({
      msgTimestamp:     ts,
      msgId:            msg.id,
      senderType:       msg.senderType,
      isOwnMessage,
      readAt,
      otherPartyOnline,
    }));
  }

  return map;
}