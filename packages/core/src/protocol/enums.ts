// Domain enums — string-literal unions per D4 (§0.5).
//
// Wire values are canonical string names, never the backend's internal
// integer representation (§12.1). v1's `normalizeSenderType` /
// `normalizeMessageType` / `normalizeChatStatus` / `normalizeChatMode`
// functions — which accepted EITHER the integer value OR the string name
// because the backend has historically sent both (§12.2) — are deleted,
// not ported. This module writes zero integer→string coercion.
//
// Each enum follows the same pattern: a `const` array of the exact string
// values (single source of truth), a type derived from it, and a runtime
// guard derived from the same array — so the compile-time union and the
// runtime membership check can never drift apart.

function enumGuard<T extends string>(values: readonly T[]): (value: unknown) => value is T {
  const set: ReadonlySet<string> = new Set(values);
  return (value: unknown): value is T => typeof value === 'string' && set.has(value);
}

// ---------------------------------------------------------------------------

export const SENDER_TYPE_VALUES = ['CUSTOMER', 'AGENT', 'BOT', 'SYSTEM'] as const;
export type SenderType = (typeof SENDER_TYPE_VALUES)[number];
export const isSenderType = enumGuard(SENDER_TYPE_VALUES);

// ---------------------------------------------------------------------------

export const MESSAGE_TYPE_VALUES = [
  'TEXT',
  'SYSTEM',
  'FILE',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'TYPING',
] as const;
export type MessageType = (typeof MESSAGE_TYPE_VALUES)[number];
export const isMessageType = enumGuard(MESSAGE_TYPE_VALUES);

// ---------------------------------------------------------------------------

/**
 * All six real backend values (§12.1). v1's `src/types.ts` string union
 * modeled only four (`OPEN | WAITING_FOR_AGENT | ASSIGNED | CLOSED`) and
 * silently collapsed `RESOLVED`/`ON_HOLD` into `OPEN` — this is the
 * specific, named gap D4 closes. Do not remove a value from this array
 * without a spec change; a v2 client that doesn't know `RESOLVED`/
 * `ON_HOLD` exist reintroduces the exact bug D4 was written to kill.
 */
export const CHAT_STATUS_VALUES = [
  'OPEN',
  'WAITING_FOR_AGENT',
  'ASSIGNED',
  'CLOSED',
  'RESOLVED',
  'ON_HOLD',
] as const;
export type ChatStatus = (typeof CHAT_STATUS_VALUES)[number];
export const isChatStatus = enumGuard(CHAT_STATUS_VALUES);

// ---------------------------------------------------------------------------

export const CHAT_MODE_VALUES = ['BOT', 'HUMAN'] as const;
export type ChatMode = (typeof CHAT_MODE_VALUES)[number];
export const isChatMode = enumGuard(CHAT_MODE_VALUES);

// ---------------------------------------------------------------------------

/**
 * Not currently referenced by any §7.3 frame payload in this module. v2
 * keeps v1's confirmed watermark-based read model — per-participant
 * `lastReadAt`, not per-message receipts (§9.5, Open Question 8) — so
 * per-message delivery status has no wire carrier yet. Modeled here
 * because it is a real, confirmed backend enum (§12.1) and Open Question 8
 * leaves per-message receipts open as a possible future direction; do not
 * wire this into a frame payload without a corresponding PRD update.
 */
export const DELIVERY_STATUS_VALUES = ['SENT', 'DELIVERED', 'READ'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS_VALUES)[number];
export const isDeliveryStatus = enumGuard(DELIVERY_STATUS_VALUES);

// ---------------------------------------------------------------------------

export const PRESENCE_STATUS_VALUES = ['ONLINE', 'OFFLINE', 'AWAY', 'DND'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUS_VALUES)[number];
export const isPresenceStatus = enumGuard(PRESENCE_STATUS_VALUES);

// ---------------------------------------------------------------------------

/**
 * Not currently referenced by any §7.3 frame payload. This PRD scopes the
 * customer/end-user-facing chat client only — agent-internal notes
 * (`INTERNAL` visibility) are an agent-console concern, explicitly out of
 * scope except where they define a wire event this SDK must consume (§2
 * Non-Goals). Modeled here because it is a real, confirmed backend enum
 * (§12.1); wiring it into a message payload would require a spec update
 * establishing that the customer-facing socket ever receives
 * `INTERNAL`-visibility messages at all.
 */
export const MESSAGE_VISIBILITY_VALUES = ['PUBLIC', 'INTERNAL'] as const;
export type MessageVisibility = (typeof MESSAGE_VISIBILITY_VALUES)[number];
export const isMessageVisibility = enumGuard(MESSAGE_VISIBILITY_VALUES);

// ---------------------------------------------------------------------------

export const PARTICIPANT_TYPE_VALUES = ['CUSTOMER', 'AGENT', 'BOT'] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPE_VALUES)[number];
export const isParticipantType = enumGuard(PARTICIPANT_TYPE_VALUES);

// ---------------------------------------------------------------------------

/**
 * Net-new, first-class enum — v1 had no `CloseReason` type at all, only a
 * loose `'SWITCHED' | 'MANUAL' | null` code comment (§12.5). `CLOSED` status
 * is overloaded in v1 to mean both "genuinely ended" and "parked because
 * the customer switched to a different active session" — this enum makes
 * that distinction structural instead of a string an integrator has to
 * already know to check for.
 *
 * `RESOLVED` and `MANUAL` are genuinely-ended reasons (confirmed: `MANUAL`
 * directly from v1's comment; `RESOLVED` from `ChatStatus.RESOLVED` being a
 * distinct terminal status per §12.1/§12.5's observed lifecycle). `SWITCHED`
 * is the parked-not-ended reason (confirmed, §12.5). See
 * `isParkedCloseReason` below for the structural distinction the task
 * requires.
 */
export const CLOSE_REASON_VALUES = ['RESOLVED', 'MANUAL', 'SWITCHED'] as const;
export type CloseReason = (typeof CLOSE_REASON_VALUES)[number];
export const isCloseReason = enumGuard(CLOSE_REASON_VALUES);

/** `CloseReason` values that park a session without ending it (§12.5). */
export const PARKED_CLOSE_REASONS: ReadonlySet<CloseReason> = new Set(['SWITCHED']);

/**
 * True for a close reason that merely parks the session (the customer
 * switched to a different active session) rather than genuinely ending it.
 * This is the structural distinction §12.5 requires `CloseReason` to make.
 */
export function isParkedCloseReason(reason: CloseReason): boolean {
  return PARKED_CLOSE_REASONS.has(reason);
}
