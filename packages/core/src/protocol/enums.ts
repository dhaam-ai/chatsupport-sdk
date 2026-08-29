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
 * The three states a message passes through, as the backend enumerates them
 * (§12.1).
 *
 * ── Correction: this DOES have a wire carrier ────────────────────────────
 *
 * This comment used to say per-message delivery status "has no wire carrier
 * yet" and warned against wiring it into a frame payload. That stopped being
 * true when the delivery watermark pair landed: `message.markDelivered`
 * (client→server) and `message.delivered` (server→client) both exist in
 * frames.ts, chat-service dispatches the former, and the widget renders all
 * four tick states off it.
 *
 * What remains true is the SHAPE. v2 keeps v1's watermark model — one
 * `deliveredUpToSeq` per participant, not a receipt per message — so this
 * enum describes a message's status as DERIVED from a watermark, and is
 * still not itself a field on any frame. Deriving it is the binding's job;
 * see `@dhaam-ccrm/js`'s tick derivation and its conformance oracle.
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
 * Still not referenced by any §7.3 frame payload, and now deliberately so.
 *
 * ── Status: INTERNAL notes are EXPLICITLY DEFERRED, not merely unbuilt ────
 * v2 now labels a sender from the connection's verified identity, so a staff
 * member CAN send on this endpoint. Internal notes were considered as part of
 * that and left out on purpose. The reasoning, so nobody has to re-derive it:
 *
 *   • Every message v2 writes is PUBLIC. The server passes no `visibility` to
 *     `sendMessage`, which defaults to PUBLIC, and no client→server frame
 *     carries the field — so there is no way to author an INTERNAL note here.
 *   • The live fan-out is the reason that matters. `message.new` is broadcast
 *     to every connection joined to the session, with no visibility filter of
 *     any kind. Replay is filtered (`findSince` is PUBLIC-only by default,
 *     which is B2's fix), but the live path is not — so the moment an
 *     INTERNAL note could be authored on this endpoint, it would be pushed
 *     straight to the customer sitting in the same session. The filter has to
 *     exist on the fan-out BEFORE the field is writable, not after.
 *
 * So: wiring `visibility` into `MessageSendPayload` or `MessagePayload` is a
 * two-part change — a per-recipient visibility filter in the server's session
 * fan-out first, then this enum on the wire. Adding the field alone turns a
 * deferred feature into a data leak. That is the spec update this comment
 * previously asked for, now stated as the actual precondition.
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
