// Binding-facing state shapes — PRD §6.4 (`ChatState`), §8.1 (connection
// states), §9.5 (read watermarks).
//
// These are the types every framework binding (React, Vue, Angular, vanilla)
// reads. protocol/domain.ts deliberately keeps the *wire* shapes separate and
// names this module as their consumer: "the richer, binding-facing
// ChatState/ChatSession/ChatMessage types from PRD §6.4, which a later task
// (observable store, §T3) derives from these wire shapes."
//
// Nothing here redefines a protocol enum or wire shape — `ChatStatus`,
// `ChatMode`, `SenderType`, `MessageType`, `MessageMetadata`, and `ErrorCode`
// are all imported from protocol/.

import type {
  AttachmentMetadata,
  ChatMode,
  ChatStatus,
  ErrorCode,
  MessageMetadata,
  MessageType,
  PresenceEntry,
  SenderType,
} from '../protocol/index.js';

/**
 * Cancels a `subscribe` or `on` registration (§6.4).
 *
 * Calling it more than once is a safe no-op — it never cancels an unrelated
 * registration, even one made afterwards with the same function.
 */
export type Unsubscribe = () => void;

/**
 * The seven connection states of §8.1, in lifecycle order.
 *
 * No runtime guard is exported deliberately: unlike the protocol enums, a
 * `ConnectionState` is never parsed off the wire — it is computed by the
 * connection state machine (T8) — so there is no untrusted input to guard.
 */
export const CONNECTION_STATE_VALUES = [
  'idle',
  'connecting',
  'authenticating',
  'connected',
  'reconnecting',
  'suspended',
  'closed',
] as const;

export type ConnectionState = (typeof CONNECTION_STATE_VALUES)[number];

/**
 * A protocol- or transport-level error (§6.5's `error` event, §6.4's
 * `lastError`).
 *
 * Judgment call: §7.4's `ErrorCode` enum only covers errors the server can
 * express in an `error` frame, but §6.5 requires this same type to carry
 * "any protocol- **or transport**-level error" — and a socket that fails to
 * open never produced a frame, so it has no wire code. Rather than invent
 * client-side code names that would collide with whatever T7/T8 later need,
 * `source` makes the origin explicit and `code` is `null` exactly when no
 * wire frame produced it. This adds zero new code names to §7.4.
 */
export interface ChatError {
  /** `'protocol'` when this came from an `error` frame; `'transport'` otherwise. */
  source: 'protocol' | 'transport';

  /** The canonical §7.4 code, or `null` for a transport failure with no frame. */
  code: ErrorCode | null;

  /** Human-readable. Never branch on this — branch on `code` (§12.6). */
  message: string;

  retryable: boolean;

  details?: Record<string, unknown>;
}

/**
 * A message as bindings see it — the state-layer projection of the wire
 * `MessagePayload` (protocol/frames.ts), which is what actually streams in
 * over the socket.
 *
 * `seq` is optional here but required on the wire, and that difference is the
 * whole point: §6.5's `message` event fires for optimistic sends too
 * ("optimistic or server-confirmed"), and an optimistic message has no
 * server-assigned ordering key yet. **Absent `seq` means "not yet
 * server-confirmed"** — so no separate `pending`/`status` field is invented
 * here. `id` is stable from creation under D1 (client ULID, never swapped).
 */
/**
 * Why a queued send will never be retried again.
 *
 * Canonically defined here rather than in `queue/` so `state` stays free of a
 * transitive dependency on transport and storage; `queue` imports it.
 */
export type SendFailureReason =
  /** The server refused it. A retry would be refused identically (§7.4). */
  | 'rejected'
  /** It outlived the queue's configured max age (§9.6). */
  | 'expired'
  /** Pruned to bring the queue under its configured max entries (§9.6). */
  | 'evicted'
  /** The durable write did not land and is not recoverable — `write_failed` (§9.1). */
  | 'storage';

/**
 * Local delivery state of an outgoing message.
 *
 * **Absent means server-confirmed.** This exists because an absent `seq` does
 * not: `seq` is missing both for a message still in flight and for one that
 * will never arrive, so overloading it makes a dead message indistinguishable
 * from a live one. A binding needs that difference to decide between a
 * spinner and a retry affordance.
 *
 * Modeled as a union so a `reason` cannot exist without `failed`, and
 * `failed` cannot exist without a `reason`.
 */
export type MessageDelivery =
  | { readonly state: 'queued' }
  | { readonly state: 'failed'; readonly reason: SendFailureReason };

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderType: SenderType;
  type: MessageType;
  content: string;
  replyToMessageId?: string;

  /** Top-level, never under `metadata` — one canonical location (D4). */
  attachment?: AttachmentMetadata;

  metadata?: MessageMetadata;

  /** Server-assigned ordering key (D2). Absent until the server confirms. */
  seq?: number;

  /**
   * Local delivery state. Absent means the server confirmed this message.
   * See {@link MessageDelivery} for why an absent `seq` cannot carry this.
   */
  delivery?: MessageDelivery;

  /** ISO-8601. One canonical name per concept (§12.2). */
  createdAt: string;
}

/** Enriched participant profile — the `Profile` schema in T2's OpenAPI. */
export interface ChatParticipantProfile {
  /**
   * Correlation key. Without this a `presence.update` frame — which is keyed
   * by `participantId` — has no profile to bind to, and `readWatermarks`
   * (also participant-keyed) cannot be resolved to a person either.
   */
  participantId: string;

  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

/** A linked CRM/support ticket — the `Ticket` schema in T2's OpenAPI. */
export interface ChatTicket {
  id: string;
  url: string | null;
}

/**
 * The active session. Field-for-field the `ChatSession` schema in
 * openapi/chat-api.yaml (T2), which named its schema after this exact §6.4
 * state field — participants are deliberately absent because §6.4 already
 * surfaces their watermarks as the separate `readWatermarks` map.
 */
export interface ChatSession {
  id: string;
  status: ChatStatus;
  mode: ChatMode;

  /** ISO-8601. */
  createdAt: string;

  /** ISO-8601, or `null` while the session is still open. */
  closedAt: string | null;

  assignedAgent: ChatParticipantProfile | null;
  customer: ChatParticipantProfile | null;
  ticket: ChatTicket | null;
}

/**
 * Lightweight session projection for history lists (§6.4's `pastSessions`).
 * Field-for-field T2's `ChatSessionSummary` schema, hydrated by
 * `GET /sessions`.
 */
export interface ChatSessionSummary {
  id: string;
  status: ChatStatus;
  mode: ChatMode;

  /** ISO-8601. */
  createdAt: string;

  /** ISO-8601, or `null` while still open. */
  closedAt: string | null;

  /** ISO-8601 of the most recent message, or `null` if the session has none. */
  lastMessageAt: string | null;

  lastMessagePreview?: string;

  unreadCount: number;
}

/**
 * The observable state surface — exactly the ten fields of §6.4, in the
 * order that section lists them.
 *
 * Every value reachable from a `ChatState` handed out by the store is deeply
 * frozen (see freeze.ts), so this type is read-only in practice even though
 * it is not spelled `Readonly<...>`: the runtime, not just the compiler,
 * refuses external mutation.
 */
export interface ChatState {
  connectionState: ConnectionState;
  session: ChatSession | null;
  messages: ChatMessage[];
  typing: { isTyping: boolean; participantId?: string };
  unreadCount: number;
  pagination: { hasMore: boolean; loadingMore: boolean };
  uploading: boolean;
  pastSessions: ChatSessionSummary[];

  /** participantId → ISO-8601 watermark (§9.5, generalized from v1's single `agentReadAt`). */
  readWatermarks: Record<string, string>;

  /**
   * participantId → live presence. The one canonical location for presence
   * (D4): it deliberately replaces an `isOnline` flag on
   * {@link ChatParticipantProfile}, so there is never a second place to read
   * the same fact from — the mistake v1 made with attachments (§12.2).
   *
   * A participant absent from this map has unknown presence, which is not the
   * same as being offline.
   */
  presence: Record<string, PresenceEntry>;

  lastError: ChatError | null;
}

/**
 * The state a store starts in: `idle` (§8.1 — "no connection attempted yet")
 * with every collection empty and no error.
 *
 * A factory, not a shared constant, because the store freezes whatever it is
 * given — handing every store the same object would make two stores share
 * one frozen graph.
 */
export function createInitialChatState(): ChatState {
  return {
    connectionState: 'idle',
    session: null,
    messages: [],
    typing: { isTyping: false },
    unreadCount: 0,
    pagination: { hasMore: false, loadingMore: false },
    uploading: false,
    pastSessions: [],
    readWatermarks: {},
    presence: {},
    lastError: null,
  };
}
