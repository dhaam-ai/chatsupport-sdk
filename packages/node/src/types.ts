// Domain shapes, transcribed from `openapi/chat-api.yaml`.
//
// ── Why these are duplicated rather than imported ────────────────────────
//
// `@dhaam-ccrm/core` already declares most of these. Importing them from
// there would create a dependency edge from the package that HOLDS THE SECRET
// KEY to the package that ships in a browser bundle — and edges are followed
// in both directions by bundlers, by `npm ls`, and by anyone reading the
// dependency graph to decide what is safe to include client-side. That edge is
// exactly the mechanism by which a secret key ends up in a bundle (§14), so
// the duplication is the deliberate, cheaper mistake.
//
// These are structural types with no runtime footprint: they disappear at
// compile time, so the duplication costs nothing at run time and cannot drift
// into divergent BEHAVIOUR — only into divergent documentation, which the
// shared OpenAPI document is the cure for. T19 generates Python and Go clients
// from that same document; this file is the hand-written TypeScript analogue.

/** PRD §12.1, D4. The full six-value set — v1 modeled only four. */
export type ChatStatus =
  | 'OPEN'
  | 'WAITING_FOR_AGENT'
  | 'ASSIGNED'
  | 'CLOSED'
  | 'RESOLVED'
  | 'ON_HOLD';

export type ChatMode = 'BOT' | 'HUMAN';

export type SenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';

export type MessageType = 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE' | 'VIDEO' | 'AUDIO';

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

/** Why a session entered CLOSED (PRD §12.5). */
export type CloseReason = 'MANUAL' | 'SWITCHED';

export interface Attachment {
  readonly url: string;
  readonly fileName: string;
  readonly mimeType: string;
  /** Size in bytes. */
  readonly size: number;
  readonly mediaType: MediaType;
}

export interface Profile {
  /** Correlation key — presence frames and read watermarks are both keyed by this. */
  readonly participantId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

/** A linked CRM/support ticket. */
export interface Ticket {
  readonly id: string;
  readonly url?: string | null;
}

export interface MessageReplyPreview {
  readonly id: string;
  readonly content: string;
  readonly senderType: SenderType;
}

export interface ChatMessage {
  /**
   * Opaque message identifier, and the pagination cursor. Under D1 this is
   * the client-generated ULID for customer-sent messages and never changes
   * after creation — there is no server-assigned id swapped in later, which
   * is what makes it safe to use as a `before` cursor.
   */
  readonly id: string;
  readonly chatSessionId: string;
  readonly senderType: SenderType;
  readonly senderId?: string | null;
  readonly senderName?: string | null;
  readonly content: string;
  readonly messageType: MessageType;
  /** The one canonical timestamp field (D4) — v1 aliased this across four names. */
  readonly createdAt: string;
  /** The ONE canonical location for attachment data (D4). Never `metadata.attachment`. */
  readonly attachment?: Attachment | null;
  readonly replyToMessageId?: string | null;
  readonly replyToMessage?: MessageReplyPreview | null;
  readonly metadata?: Record<string, unknown>;
}

export interface ChatSession {
  readonly id: string;
  readonly status: ChatStatus;
  readonly mode: ChatMode;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly assignedAgent: Profile | null;
  readonly customer: Profile | null;
  readonly ticket: Ticket | null;
}

export interface ChatSessionSummary {
  readonly id: string;
  readonly status: ChatStatus;
  readonly mode: ChatMode;
  readonly createdAt: string;
  readonly lastMessageAt?: string | null;
  readonly lastMessagePreview?: string;
  readonly unreadCount?: number;
}

/** `MessagePage` — the cursor-paginated shape the iterators in `pagination.ts` walk. */
export interface MessagePage {
  /** Ascending chronological order (oldest first), so a page prepends without re-sorting. */
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
}

/** `SessionSummaryPage`. See `pagination.ts` for why this one cannot actually be paged. */
export interface SessionSummaryPage {
  readonly sessions: readonly ChatSessionSummary[];
  readonly hasMore: boolean;
}

/** Request body for `POST /tokens`. */
export interface MintTokenRequest {
  /**
   * Stable identifier for the end user in the customer's own system. Becomes
   * the token's `sub` claim and the resulting session's customer identity.
   */
  readonly userId: string;
  readonly name?: string;
  readonly email?: string;
  /**
   * Arbitrary customer-defined claims embedded in the minted JWT (e.g. plan
   * tier, account region).
   *
   * Modeled as an explicit nested bag rather than as `additionalProperties`
   * spread across the top level, even though the wire format is flat. A flat
   * type would make `userId` and a claim named `userId` indistinguishable at
   * the call site, and would silently accept a typo'd `usrId` as a custom
   * claim — minting a token whose `sub` is not the user the caller meant.
   * The flattening happens once, in `tokens.ts`, where the reserved-name
   * check sits next to it.
   */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Response body for `POST /tokens`. */
export interface MintTokenResponse {
  /** Short-lived JWT. Relay to the browser and pass to the SDK via `getToken()`. */
  readonly accessToken: string;
  /** Token lifetime in seconds from the moment of minting. */
  readonly expiresIn: number;
}
