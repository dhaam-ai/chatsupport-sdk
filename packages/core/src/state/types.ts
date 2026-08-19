// Binding-facing observable state surface — PRD §6.4 (`ChatState`, a hard
// requirement) and §6.5 (`ChatEventMap`, discrete events).
//
// These are deliberately distinct from the wire-level shapes in
// protocol/domain.ts and protocol/frames.ts (see domain.ts's own header
// comment) — even where a shape here is currently identical to its wire
// counterpart, keeping the two separate lets the wire contract and the
// state/binding contract evolve independently. That separation not existing
// is exactly what produced v1's client-side coercion sprawl (§12.2): nothing
// enforced it, so every wire drift leaked straight into the shape bindings
// consumed.
//
// Judgment call: `ChatSession`/`ChatSessionSummary`/`ChatMessage` mirror the
// already-reviewed OpenAPI schemas of the same names (openapi/chat-api.yaml)
// rather than the leaner WS-only `SessionSnapshot`/`MessagePayload`. The REST
// surface (T2) is richer — resolved `assignedAgent`/`customer`/`ticket`
// profiles on `ChatSession`, a paged badge-ready projection on
// `ChatSessionSummary` — and is what actually hydrates `ChatState.session` /
// `.pastSessions` (`GET /sessions/{id}/full`, `GET /sessions`). WS pushes
// (`session.updated`, `message.new`, ...) patch this richer state
// incrementally; the reducer logic that does that patching belongs to later
// tasks (T8 connection state machine, T11 messages) that own those frames —
// this module only defines the shape being patched and the store it lives in.
//
// Nullability follows the OpenAPI spec's own convention throughout this
// file: a property typed `[X, "null"]` there is modeled as `X | null` here
// (always present, may be null); a property with no null variant and absent
// from the schema's `required` list is modeled as optional (`?:`).

import type {
  AttachmentMetadata,
  ChatMode,
  ChatStatus,
  CloseReason,
  EmptyPayload,
  ErrorCode,
  MessageMetadata,
  MessageType,
  PresenceStatus,
  SenderType,
} from '../protocol/index.js';

// ---------------------------------------------------------------------------
// Connection state — PRD §8.1.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session domain shapes — mirrors openapi/chat-api.yaml's Profile / Ticket /
// ChatSession / ChatSessionSummary schemas.
// ---------------------------------------------------------------------------

/** Mirrors OpenAPI `Profile` — an enriched agent or customer profile. */
export interface ChatProfile {
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  isOnline: boolean;
}

/** Mirrors OpenAPI `Ticket` — a linked CRM/support ticket. */
export interface ChatTicket {
  id: string;
  url: string | null;
}

export interface ChatSession {
  id: string;
  status: ChatStatus;
  mode: ChatMode;

  /** ISO-8601. */
  createdAt: string;

  /** ISO-8601, or `null` while the session is still open. */
  closedAt: string | null;

  assignedAgent: ChatProfile | null;
  customer: ChatProfile | null;
  ticket: ChatTicket | null;
}

/**
 * Lightweight session projection for history lists (`ChatState.pastSessions`).
 * Deliberately smaller than `ChatSession` — mirrors OpenAPI
 * `ChatSessionSummary`.
 */
export interface ChatSessionSummary {
  id: string;
  status: ChatStatus;
  mode: ChatMode;

  /** ISO-8601. */
  createdAt: string;

  /** ISO-8601, or `null` while the session is still open. */
  closedAt: string | null;

  /** ISO-8601, or `null` if the session has no messages yet. */
  lastMessageAt: string | null;

  /** Truncated plain-text preview of the most recent message, if any. */
  lastMessagePreview?: string;

  /** Messages after this customer's read watermark (PRD §9.5). */
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// Message domain shapes — mirrors OpenAPI `Message` / `MessageReplyPreview`.
// ---------------------------------------------------------------------------

/** Mirrors OpenAPI `MessageReplyPreview` — a denormalized reply-target preview. */
export interface ChatReplyPreview {
  id: string;
  content: string;
  senderType: SenderType;
  senderId: string | null;
  senderName: string | null;
  messageType: MessageType;
}

export interface ChatMessage {
  /** Permanent id — the client-generated ULID for a customer-sent message (D1). */
  id: string;
  chatSessionId: string;
  senderType: SenderType;
  senderId: string | null;
  senderName: string | null;
  content: string;
  messageType: MessageType;

  /** ISO-8601. The one canonical timestamp field for this concept (D4). */
  createdAt: string;

  /** The one canonical location for attachment data (D4) — never `metadata.attachment`. */
  attachment: AttachmentMetadata | null;
  replyToMessageId: string | null;
  replyToMessage: ChatReplyPreview | null;

  /** Free-form additional context. Never used for attachment data. */
  metadata?: MessageMetadata;
}

// ---------------------------------------------------------------------------
// Error shape — PRD §7.4 / §6.5's `error` event.
// ---------------------------------------------------------------------------

/**
 * Binding-facing error shape. Currently field-identical to the wire-level
 * `ErrorPayload` (protocol/envelope.ts) — kept as its own type per this
 * file's header note on why wire and binding shapes stay separate even when
 * they coincide today.
 */
export interface ChatError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The observable state surface itself — PRD §6.4, specified precisely.
// ---------------------------------------------------------------------------

export interface TypingState {
  isTyping: boolean;
  participantId?: string;
}

export interface PaginationState {
  hasMore: boolean;
  loadingMore: boolean;
}

export interface ChatState {
  connectionState: ConnectionState;
  session: ChatSession | null;
  messages: ChatMessage[];
  typing: TypingState;
  unreadCount: number;
  pagination: PaginationState;
  uploading: boolean;
  pastSessions: ChatSessionSummary[];

  /** Keyed by `participantId`. ISO-8601 values. Generalized from v1's single `agentReadAt` field. */
  readWatermarks: Record<string, string>;

  lastError: ChatError | null;
}

// ---------------------------------------------------------------------------
// Discrete event catalog — PRD §6.5. Distinct from `ChatState`: these are
// one-shot occurrences, not continuous state a snapshot can capture.
// ---------------------------------------------------------------------------

export interface ChatEventMap {
  connected: { session: ChatSession };
  reconnecting: { attempt: number; delayMs: number };
  suspended: { reason: 'auth' | 'maxAttempts' };
  disconnected: { reason: string };
  message: ChatMessage;
  messageAck: { id: string; seq?: number };
  typing: { isTyping: boolean; participantId: string };
  agentJoined: { agentId: string; agentName?: string };
  agentLeft: { agentId: string; agentName?: string };
  statusChange: { status: ChatStatus; mode: ChatMode };
  sessionClosed: { closeReason: CloseReason };
  presenceUpdate: { participantId: string; status: PresenceStatus; lastSeen?: string };
  ticketLinked: { ticketId: string; ticketUrl?: string };
  tokenRefreshed: EmptyPayload;
  error: ChatError;
}

export type Unsubscribe = () => void;
