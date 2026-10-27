// Merchant inbox (US-25) — the rules behind a merchant/outlet's Customers tab
// that are not DOM: which filter a row falls under, what order rows are in,
// what the channel badge says, and when a refresh means "a customer just
// wrote — alert the merchant".
//
// Merchant-only by design. `messages-screen.ts` calls these from its
// `isMerchantUser` branches and nowhere else, so the admin view is untouched.
// Kept DOM-free so every rule is covered by a plain unit test
// (`test/merchant-inbox.test.ts`) rather than through a mounted widget.

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

/** The merchant-inbox fields `widget.ts`'s `portalQueueRowToSummary` adds on top of a summary. */
interface MerchantRowFields {
  readonly orderNumber?: string;
  readonly channel?: number;
  readonly escalated?: boolean;
  readonly awaitingReply?: boolean;
}

function fields(summary: ChatSessionSummary): MerchantRowFields {
  return summary as unknown as MerchantRowFields;
}

/** RESOLVED and CLOSED are the "done" side of the Open/Resolved split. */
export function isResolved(summary: ChatSessionSummary): boolean {
  return summary.status === 'RESOLVED' || summary.status === 'CLOSED';
}

/** Chat passed to Dhaam support — shown as "Escalated" and read-only for the merchant. */
export function isEscalated(summary: ChatSessionSummary): boolean {
  return fields(summary).escalated === true;
}

/**
 * The customer spoke last and nobody has answered yet. Falls back to
 * "has unread messages" when the row carries no explicit sender signal.
 */
export function isUnanswered(summary: ChatSessionSummary): boolean {
  if (isResolved(summary) || isEscalated(summary)) return false;
  const awaiting = fields(summary).awaitingReply;
  if (awaiting !== undefined) return awaiting;
  return summary.unreadCount > 0;
}

function activityTime(summary: ChatSessionSummary): number {
  const t = Date.parse(summary.lastMessageAt ?? summary.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Unanswered chats first, OLDEST first — the customer who has waited longest
 * is at the top. Everything else after, newest activity first. Stable for
 * equal timestamps, and never mutates its input.
 */
export function sortMerchantInbox(sessions: readonly ChatSessionSummary[]): ChatSessionSummary[] {
  return sessions
    .map((summary, index) => ({ summary, index, unanswered: isUnanswered(summary), at: activityTime(summary) }))
    .sort((a, b) => {
      if (a.unanswered !== b.unanswered) return a.unanswered ? -1 : 1;
      if (a.at !== b.at) return a.unanswered ? a.at - b.at : b.at - a.at;
      return a.index - b.index;
    })
    .map((entry) => entry.summary);
}

/** chat-service-node `Channel` (shared/constants/enums.ts). */
const CHANNEL_LABELS: Record<number, string> = {
  1: 'App',
  2: 'WhatsApp',
  3: 'Email',
  4: 'SMS',
  5: 'Social',
  6: 'Web form',
};

/** Human label for the row's channel badge, or `null` when the row has none. */
export function channelLabel(summary: ChatSessionSummary): string | null {
  const channel = fields(summary).channel;
  if (channel === undefined) return null;
  return CHANNEL_LABELS[channel] ?? null;
}

/** `#20345` — the order this chat is about, or `null`. */
export function orderLabel(summary: ChatSessionSummary): string | null {
  const order = fields(summary).orderNumber;
  if (order === undefined || order === null || String(order).trim() === '') return null;
  const text = String(order).trim();
  return text.startsWith('#') ? text : `#${text}`;
}

/** Status shown as TEXT (accessibility AC) — "Escalated" wins over the session status. */
export function merchantStatusText(summary: ChatSessionSummary, fallback: string): string {
  return isEscalated(summary) ? 'Escalated' : fallback;
}

// ── Unread, derived client-side ─────────────────────────────────────────────
//
// `/party/conversations` sends no unread count. Until it does, a conversation
// counts as unread (1) when the customer spoke last AFTER the merchant last
// opened it. "Last opened" is remembered per browser in localStorage. A real
// `unreadCount` from the server, when one arrives, always wins.

const SEEN_KEY_PREFIX = 'dhaam_inbox_seen_';

export function markConversationSeen(sessionId: string, atIso: string | undefined, storage: Storage | null = safeLocalStorage()): void {
  if (storage === null) return;
  try {
    storage.setItem(SEEN_KEY_PREFIX + sessionId, atIso ?? new Date().toISOString());
  } catch {
    // storage full / blocked — unread just stays derived from activity
  }
}

export function deriveUnreadCount(
  sessionId: string,
  serverUnread: number | undefined,
  customerSpokeLast: boolean,
  lastMessageAt: string | undefined,
  storage: Storage | null = safeLocalStorage(),
): number {
  if (typeof serverUnread === 'number') return serverUnread;
  if (!customerSpokeLast || lastMessageAt === undefined) return 0;
  let seen: string | null = null;
  try {
    seen = storage?.getItem(SEEN_KEY_PREFIX + sessionId) ?? null;
  } catch {
    seen = null;
  }
  if (seen === null) return 1;
  return Date.parse(lastMessageAt) > Date.parse(seen) ? 1 : 0;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ── New-message alert ───────────────────────────────────────────────────────

export interface InboxAlert {
  readonly sessionId: string;
  readonly customerName: string;
  readonly preview: string;
  readonly orderNumber: string | null;
}

export interface InboxAlertRow {
  readonly sessionId: string;
  readonly customerName: string;
  readonly preview: string;
  readonly orderNumber: string | null;
  readonly lastMessageAt: string | undefined;
  readonly customerSpokeLast: boolean;
}

/**
 * Compares each refresh against the previous one and returns the rows where a
 * customer has written something new. The FIRST refresh only primes the
 * baseline — logging in to a full inbox must not ring once per old chat.
 */
export function createInboxAlertDetector(): { detect(rows: readonly InboxAlertRow[]): InboxAlert[] } {
  let primed = false;
  const lastSeenAt = new Map<string, number>();

  return {
    detect(rows) {
      const alerts: InboxAlert[] = [];
      for (const row of rows) {
        const at = row.lastMessageAt === undefined ? NaN : Date.parse(row.lastMessageAt);
        if (Number.isNaN(at)) continue;
        const previous = lastSeenAt.get(row.sessionId);
        lastSeenAt.set(row.sessionId, at);
        if (!primed || !row.customerSpokeLast) continue;
        if (previous === undefined || at > previous) {
          alerts.push({
            sessionId: row.sessionId,
            customerName: row.customerName,
            preview: row.preview,
            orderNumber: row.orderNumber,
          });
        }
      }
      primed = true;
      return alerts;
    },
  };
}
