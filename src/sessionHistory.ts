// ==========================================
// Chat SDK - Session history / picker
// ==========================================
// Backs both surfaces of the "your last N conversations" picker: the pre-chat
// screen shown when the widget opens, and the switcher in the chat header.
//
// ── Guest vs logged-in: ONE source of truth ────────────────────────────────
// GET /chat/sessions/customer decides that server-side and returns an empty
// array for a caller it has not identified (openapi/chat-api.yaml: "Guests get
// [], not an error"). The client rule is therefore just "empty list ⇒ no
// picker" — see shouldShowSessionPicker. Deliberately NO second client-side
// guest heuristic: two sources of truth for the same question is two answers
// that can disagree.
//
// ── Terminal is not final ──────────────────────────────────────────────────
// A CLOSED/RESOLVED session can come back: a CUSTOMER message into one
// reactivates it to WAITING_FOR_AGENT server-side. Nothing here may treat a
// terminal status as an end state — see isTerminalStatus's callers.
// ==========================================

import type { ChatSessionSummary, ChatStatus, ChatMode } from './types';

/** Sessions shown in the picker. The endpoint's own default is 5. */
export const SESSION_PICKER_LIMIT = 5;

/**
 * Does this status mean the conversation is over *for now*?
 *
 * "For now" is load-bearing: a customer message reactivates one of these.
 * Explicit if-chain, matching this stack's enum-normalisation idiom.
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  if (status === 'CLOSED')   return true;
  if (status === 'RESOLVED') return true;
  return false;
}

/**
 * Show the picker at all?
 *
 * The backend already applied the guest rule, so a non-empty list means a
 * logged-in customer with history and an empty one means "no picker" —
 * whether that is because they are a guest or simply have no past sessions.
 * Both answers are the same UI, which is why one check covers both.
 */
export function shouldShowSessionPicker(sessions: readonly ChatSessionSummary[] | null | undefined): boolean {
  return !!sessions && sessions.length > 0;
}

/** Best timestamp to order a session by: last activity, falling back to birth. */
export function lastActivityAt(s: ChatSessionSummary): number {
  const raw = s.lastMessageAt ?? s.closedAt ?? s.createdAt;
  if (!raw) return 0;
  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Most-recent-first. The endpoint already promises this order; re-sorting
 * makes the picker independent of that promise (and of a merge with a locally
 * updated row) rather than silently depending on it.
 */
export function sortByRecency(sessions: readonly ChatSessionSummary[]): ChatSessionSummary[] {
  return [...sessions].sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

export interface PartitionedSessions {
  /** Still live — continue, do not reopen. */
  active: ChatSessionSummary[];
  /** Terminal for now. Picking one and typing brings it back. */
  terminal: ChatSessionSummary[];
}

/** Split for display, most-recent-first within each group. */
export function partitionSessions(
  sessions: readonly ChatSessionSummary[],
  limit: number = SESSION_PICKER_LIMIT,
): PartitionedSessions {
  const ordered = sortByRecency(sessions);
  return {
    active:   ordered.filter(s => !isTerminalStatus(s.status)),
    terminal: ordered.filter(s => isTerminalStatus(s.status)).slice(0, limit),
  };
}

/**
 * Wire → typed summary.
 *
 * `status`/`mode` arrive as canonical v2 STRING enums from the corrected
 * endpoint, but this stack has met integer enums on every other surface, so
 * the caller normalises them and passes the result in. Everything else is
 * shape-mapping, tolerant of the pre-T3 `lastMessage: {content}` nesting that
 * an older deployment still sends.
 */
export function normalizeSessionSummary(
  raw: any,
  normalizedStatus: string,
  normalizedMode: string,
): ChatSessionSummary {
  const legacyPreview = raw?.lastMessage?.content;
  const legacyAt      = raw?.lastMessage?.createdAt;

  const handledByRaw = raw?.handledBy;
  const handledBy =
    handledByRaw && (handledByRaw.kind === 'AGENT' || handledByRaw.kind === 'BOT')
      ? {
          kind:        handledByRaw.kind as 'AGENT' | 'BOT',
          id:          String(handledByRaw.id ?? ''),
          displayName: String(handledByRaw.displayName ?? ''),
        }
      : undefined;

  return {
    id:            String(raw?.id ?? ''),
    status:        normalizedStatus as ChatStatus,
    mode:          normalizedMode as ChatMode,
    createdAt:     raw?.createdAt ?? null,
    closedAt:      raw?.closedAt ?? null,
    lastMessageAt: raw?.lastMessageAt ?? legacyAt ?? null,
    // Absent, never empty-string, when there is no public message yet — the
    // endpoint documents that, and it is how "no preview" is told apart from
    // "the preview happens to be empty".
    ...(raw?.lastMessagePreview ?? legacyPreview
      ? { lastMessagePreview: String(raw?.lastMessagePreview ?? legacyPreview) }
      : {}),
    unreadCount:   Number.isFinite(raw?.unreadCount) ? Number(raw.unreadCount) : 0,
    ...(handledBy ? { handledBy } : {}),
  };
}

/**
 * What the picker should say a session was handled by.
 * Falls back to nothing rather than guessing — `handledBy` is absent (never a
 * placeholder) when the backend genuinely does not know who has it.
 */
export function handledByLabel(s: ChatSessionSummary): string | null {
  if (!s.handledBy) return null;
  const name = s.handledBy.displayName?.trim();
  if (!name) return null;
  return name;
}
