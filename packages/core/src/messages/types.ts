// The seams message operations are built on — PRD §6.3.
//
// Everything this module needs from the outside world is a function or a
// small interface declared here, for the same reason the rest of core injects
// its clock and its socket factory: nothing below reaches for a global, a
// `fetch`, a `window`, or a timer it did not receive.

import type {
  AttachmentMetadata,
  MessageSendPayload,
  MessageType,
  SenderType,
} from '../protocol/index.js';
import type { QueuedSend } from '../queue/index.js';
import type { ChatMessage } from '../state/index.js';

/**
 * Who this client sends as.
 *
 * Resolved per send rather than fixed at construction, because a session is
 * established after the controller is built — the identity is not known yet
 * when T13 wires things together.
 *
 * §6.3 does not say where an optimistic message's `senderId`/`senderType`
 * come from: `sendMessage(content, opts)` takes neither, and `ChatSession`
 * carries both a `customer` and an `assignedAgent`, so core cannot infer
 * which one "this client" is. Rather than guess `CUSTOMER` and quietly
 * mislabel every message an agent-side embed sends, it is required input.
 */
export interface LocalSender {
  readonly senderId: string;
  readonly senderType: SenderType;
}

/** §6.3's `sendMessage(content, opts?)` options. */
export interface SendMessageOptions {
  /** Defaults to `'TEXT'`, which is the default the wire frame requires core to fill in. */
  readonly type?: MessageType;

  readonly replyToMessageId?: string;

  /** Opaque application data. Attachments do NOT go in here (D4). */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Durably queues one send and resolves with its entry (§9.1).
 *
 * A function rather than the whole `SendQueue` so that the two can be wired
 * in either order: the queue needs this controller's `onAck`/`onFailed` at
 * *its* construction, and a controller that demanded the queue object back
 * would force the assembling code into a mutable `let` to break the cycle.
 *
 * Contract inherited from `SendQueue.enqueue`, and both halves matter here:
 * resolving means the send is durably queued and its `id` is the message's
 * permanent id from that moment (D1); rejecting means it was *not* queued,
 * and the caller must not show it as sent.
 */
export type EnqueueSend = (
  sessionId: string,
  payload: MessageSendPayload,
) => Promise<QueuedSend>;

/**
 * One page of history — the `MessagePage` schema in openapi/chat-api.yaml.
 *
 * There is no forward cursor and no `after`: live messages arrive over the
 * WebSocket, never by polling (§12.10, and the endpoint's own description).
 */
export interface MessagePage {
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
}

/**
 * Reads message history — `GET /chat-services/api/v1/chat/sessions/{sessionId}/messages`.
 *
 * The route named here used to be `GET /sessions/{sessionId}/messages`, an
 * unprefixed path chat-service does not serve. Corrected in the spec and in
 * `@dhaam-ccrm/rest`; recorded here only so the comment stops pointing at a
 * dead route. Which URL a history source reads is the adapter's business —
 * that is the point of the seam.
 *
 * A seam rather than a `fetch` call, for the reason the whole package is built
 * this way: core has zero runtime dependencies and touches no DOM. The binding
 * owns the HTTP client, its auth headers, and its retry policy; this module
 * owns only what to ask for and what to do with the answer.
 *
 * The adapter is also the right place to surface transport detail. What comes
 * back here is a page or a thrown error — core deliberately does not copy an
 * adapter's error text into `ChatError.message`, because a failed request's
 * message can carry a URL with a token in it (§14).
 */
export interface MessageHistorySource {
  listMessages(query: {
    readonly sessionId: string;

    /** Opaque message-id cursor. Absent means "the most recent page". */
    readonly before?: string;

    readonly limit: number;
  }): Promise<MessagePage>;
}

/**
 * Page size for `loadMore`. v1's proven value (§12.10); the endpoint caps
 * `limit` at 100.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Uploads one file — `POST /chat-services/api/v1/upload`, step 1 of the
 * two-step upload-then-announce flow (§6.3, §12.10).
 *
 * The route named here used to be `POST /sessions/{sessionId}/attachments`,
 * which chat-service has never served; the real endpoint is tenant-wide and
 * takes the session as a query parameter. Corrected in the spec and in
 * `@dhaam-ccrm/rest`; recorded here only so this comment stops pointing at a
 * route that does not exist. Nothing in core changes — which route an uploader
 * calls is entirely the adapter's business, and that is the point of the seam.
 *
 * A seam for the same reason history is: core does no HTTP and touches no
 * DOM. `Blob` appears here only as a type — §6.3 specifies it, and nothing in
 * core reads, slices, or constructs one; the value is handed straight to the
 * adapter. That keeps the "no DOM" rule about runtime behaviour, which is
 * where it matters.
 *
 * Open Question 7 asks whether uploads stay proxied or move to presigned
 * URLs. That choice lives entirely behind this interface: either way the
 * adapter returns finished attachment metadata, so core's announce step does
 * not change.
 */
export interface AttachmentUploader {
  upload(request: {
    readonly sessionId: string;
    readonly file: Blob;

    /** Falls back to whatever the adapter can derive from the file. */
    readonly fileName?: string;
  }): Promise<AttachmentMetadata>;
}

/** §6.3's `sendAttachment(file, opts?)` options. */
export interface SendAttachmentOptions {
  readonly fileName?: string;

  /** Opaque application data. The attachment itself is never in here (D4). */
  readonly metadata?: Record<string, unknown>;

  readonly replyToMessageId?: string;
}

/** Raised when an operation needs a session and none is established yet. */
export class NoActiveSessionError extends Error {
  constructor(operation: string) {
    // Names the operation, never the message content (§14).
    super(`${operation} requires an active session`);
    this.name = 'NoActiveSessionError';
  }
}
