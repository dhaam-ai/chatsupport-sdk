// ==========================================
// chatsupport-sdk - Integer Enum Standard (mirror of chat-service §12)
// ==========================================
// The backend stores/transmits enums as INTEGERS. These named constants are the
// readability layer; coercion helpers map any legacy STRING payloads (seen during
// rollout) to the canonical integer at the WS/REST boundary so the rest of the
// widget only ever deals with integers.
// ==========================================

export const SenderType = { CUSTOMER: 1, AGENT: 2, BOT: 3, SYSTEM: 4 } as const;
export const MessageType = { TEXT: 1, SYSTEM: 2, FILE: 3, IMAGE: 4, VIDEO: 5, AUDIO: 6, TYPING: 7 } as const;
export const ChatStatus = { OPEN: 1, WAITING_FOR_AGENT: 2, ASSIGNED: 3, CLOSED: 4, RESOLVED: 5, ON_HOLD: 6 } as const;
export const ChatMode = { BOT: 1, HUMAN: 2 } as const;
export const DeliveryStatus = { SENT: 1, DELIVERED: 2, READ: 3 } as const;
export const PresenceStatus = { ONLINE: 1, OFFLINE: 2, AWAY: 3, DND: 4 } as const;
export const MessageVisibility = { PUBLIC: 1, INTERNAL: 2 } as const;
export const ParticipantType = { CUSTOMER: 1, AGENT: 2, BOT: 3 } as const;

type EnumMap = Record<string, number>;

/** Coerce a number | numeric-string | legacy-name to the integer enum value. */
function coerce(enumObj: EnumMap, value: unknown, fallback: number): number {
  if (typeof value === 'number' && Object.values(enumObj).includes(value)) return value;
  if (typeof value === 'string') {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && Object.values(enumObj).includes(asNum)) return asNum;
    const byName = enumObj[value.toUpperCase().trim()];
    if (byName !== undefined) return byName;
  }
  return fallback;
}

export const toSenderType = (v: unknown): number => coerce(SenderType, v, SenderType.SYSTEM);
export const toMessageType = (v: unknown): number => coerce(MessageType, v, MessageType.TEXT);
export const toChatStatus = (v: unknown): number => coerce(ChatStatus, v, ChatStatus.OPEN);
export const toChatMode = (v: unknown): number => coerce(ChatMode, v, ChatMode.BOT);
export const toPresenceStatus = (v: unknown): number => coerce(PresenceStatus, v, PresenceStatus.OFFLINE);
export const toDeliveryStatus = (v: unknown): number => coerce(DeliveryStatus, v, DeliveryStatus.SENT);
