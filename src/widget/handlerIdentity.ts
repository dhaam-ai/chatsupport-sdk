// ==========================================
// Who is talking to the customer right now?
// ==========================================
// The widget header used to hardcode "Chat Support" regardless of who was
// actually on the other end. This module answers the question once so the
// header, and anything else that needs it, cannot disagree.
//
// ── What the v1 socket.io stream genuinely carries ─────────────────────────
// HUMAN agents: yes. `chat.agent.joined` is emitted as
//   { chatSessionId, agentId, agentName }
// by the backend's notifyAgentJoined (websocket-server.ts:1363), and every
// caller passes agentName through sanitizeAgentName (shared/utils/helpers.ts:19)
// which returns the real display name, or the literal string 'Agent' when the
// backend itself has nothing better. `GET /chat/sessions/:id/full` carries the
// same identity as session.assignedAgent.displayName.
//
// The BOT: no. There is no bot display name anywhere in the v1 payloads and no
// per-tenant bot identity in the backend schema — grep for BOT_NAME/botName in
// chat-service-node returns nothing. So the bot's name is an SDK-side constant.
// We reuse the exact label MessageBubble already stamps on BOT messages so the
// header and the bubbles name the same entity.
// ==========================================

import { looksLikeRawId } from './helpers';

/** The bot's name. Client-side constant — v1 carries no bot identity. */
export const BOT_DISPLAY_NAME = 'AI Assistant';

/** Generic fallback, matching the title the header hardcoded before. */
export const DEFAULT_WIDGET_TITLE = 'Chat Support';

/**
 * The backend's own placeholder for "a human is on this, but we have no name
 * for them" (sanitizeAgentName returns exactly this). Used verbatim rather
 * than invented: claiming the bot, or printing a raw id, would both be worse.
 */
const UNNAMED_AGENT = 'Agent';

export type HandlerKind = 'AGENT' | 'BOT' | 'FALLBACK';

export interface HandlerIdentity {
  kind: HandlerKind;
  /** What to render as the widget title. */
  name: string;
}

export interface HandlerIdentityInput {
  /** session.assignedAgent.displayName — the enriched ChatUser profile. */
  assignedAgentDisplayName?: string | null;
  /** session.assignedAgentName — what chat.agent.joined delivered. */
  assignedAgentName?: string | null;
  /** session.assignedAgentId — set even when no name has arrived yet. */
  assignedAgentId?: string | null;
  mode?: string | null;
  status?: string | null;
  /** config.title — the host app's own name for this widget. */
  configuredTitle?: string | null;
}

/**
 * Resolve who is handling this conversation.
 *
 * Precedence, in order:
 *   1. An assigned human agent — their display name (v1 gives us this).
 *   2. The bot, while the bot is the one handling it.
 *   3. The configured title, when neither is true (e.g. queued for an agent
 *      who has not picked it up: nobody is handling it, and saying either
 *      "AI Assistant" or an agent name there would be false).
 */
export function resolveHandlerIdentity(input: HandlerIdentityInput): HandlerIdentity {
  const fallback = input.configuredTitle?.trim() || DEFAULT_WIDGET_TITLE;

  // ── 1. Assigned human agent ─────────────────────────────────────────────
  // assignedAgentId alone is enough to know a human owns this, even before a
  // name has arrived — in that window we say 'Agent' rather than falling
  // through and mislabelling a human conversation as the bot.
  const rawName = input.assignedAgentDisplayName ?? input.assignedAgentName;
  const named   = rawName && !looksLikeRawId(rawName.trim()) ? rawName.trim() : null;

  if (named)                 return { kind: 'AGENT', name: named };
  if (input.assignedAgentId) return { kind: 'AGENT', name: UNNAMED_AGENT };
  if (rawName)               return { kind: 'AGENT', name: UNNAMED_AGENT };

  // ── 2. The bot ───────────────────────────────────────────────────────────
  // Only while the bot is genuinely the one answering. WAITING_FOR_AGENT means
  // the bot has already handed off, so it is NOT handling the chat any more.
  // Explicit if-chain rather than a set lookup, matching the enum-normalisation
  // idiom used throughout this stack.
  const status = input.status ?? null;
  const mode   = input.mode   ?? null;

  const handedOff =
    status === 'WAITING_FOR_AGENT' ||
    status === 'ASSIGNED' ||
    mode   === 'HUMAN';

  if (!handedOff && (mode === 'BOT' || mode == null)) {
    if (status !== 'CLOSED' && status !== 'RESOLVED') {
      return { kind: 'BOT', name: BOT_DISPLAY_NAME };
    }
  }

  // ── 3. Nobody / unknown ──────────────────────────────────────────────────
  return { kind: 'FALLBACK', name: fallback };
}
