// Raw Prisma rows → the shapes core's state layer holds.
//
// ── Why this module exists ──
//
// chat-service is internally consistent, but its two paths are not the same
// shape. The WebSocket path emits *projected* payloads: enum names, attachments
// lifted to the top level, `chatSessionId` renamed `sessionId`
// (`api/websocket/v2/projection.ts`). The REST path emits *raw rows* —
// `message.service.ts:285-296` and `:470-482` hand Prisma's output straight to
// the route, which sends it as-is.
//
// Core's `ChatMessage`/`ChatSession` are the projected shape, because that is
// what the socket delivers all day. So the REST path has to be projected too,
// and this package is where that happens: core's public seam signatures do not
// bend to accommodate one backend's row layout.
//
// The types below deliberately mirror `@dhaam-ccrm/core`'s rather than
// importing them, which is what keeps this package installable without a
// value-level dependency on core. The compiler still checks the match — at the
// consumer's `createChatClient({ history, uploader, sessionActions })` call,
// which is where a divergence between the two packages belongs.

import { RestApiError } from './errors.js';

// ── Core-mirroring shapes ───────────────────────────────────────────────────

/** Mirrors core's `SenderType` (packages/core/src/protocol/enums.ts). */
export type RestSenderType = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';

/** Mirrors core's `MessageType`. */
export type RestMessageType =
  | 'TEXT'
  | 'SYSTEM'
  | 'FILE'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'TYPING';

/** Mirrors core's `ChatStatus` — all six real backend values. */
export type RestChatStatus =
  | 'OPEN'
  | 'WAITING_FOR_AGENT'
  | 'ASSIGNED'
  | 'CLOSED'
  | 'RESOLVED'
  | 'ON_HOLD';

/** Mirrors core's `ChatMode`. */
export type RestChatMode = 'BOT' | 'HUMAN';

/** Mirrors core's `AttachmentMetadata`. */
export interface RestAttachmentMetadata {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  mediaType: string;
}

/** Mirrors core's binding-facing `ChatMessage` (packages/core/src/state/types.ts). */
export interface RestChatMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderType: RestSenderType;
  type: RestMessageType;
  content: string;
  replyToMessageId?: string;
  /** Top-level, never under `metadata` — one canonical location (D4). */
  attachment?: RestAttachmentMetadata;
  metadata?: Record<string, unknown>;
  seq?: number;
  /** ISO-8601. */
  createdAt: string;
}

/** Mirrors core's `ChatParticipantProfile`. */
export interface RestChatParticipantProfile {
  participantId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

/** Mirrors core's `ChatTicket`. */
export interface RestChatTicket {
  id: string;
  url: string | null;
}

/** Mirrors core's `ChatSession`. */
export interface RestChatSession {
  id: string;
  status: RestChatStatus;
  mode: RestChatMode;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, or `null` while the session is still open. */
  closedAt: string | null;
  assignedAgent: RestChatParticipantProfile | null;
  customer: RestChatParticipantProfile | null;
  ticket: RestChatTicket | null;
}

// ── Integer enums ───────────────────────────────────────────────────────────
//
// Mirrored EXACTLY from chat-service-node/src/shared/constants/enums.ts, which
// states the org-wide rule these tables encode: "enums are stored in the DB and
// transmitted over APIs/WS as INTEGERS", 1-based and append-only, never
// renumbered or reused. The WS path converts them via `toSenderType` /
// `toMessageType` (api/websocket/v2/projection.ts:205-206); the REST path never
// did, which is why history arrived with `senderType: 1` where core's union
// required `'CUSTOMER'`.
//
// Line references are to that file, so the origin of each table stays checkable
// against the source rather than against this comment.

/** `SenderType` — enums.ts:29-34. */
const SENDER_TYPE_BY_INT: Readonly<Record<number, RestSenderType>> = {
  1: 'CUSTOMER',
  2: 'AGENT',
  3: 'BOT',
  4: 'SYSTEM',
};

/** `MessageType` — enums.ts:36-44. */
const MESSAGE_TYPE_BY_INT: Readonly<Record<number, RestMessageType>> = {
  1: 'TEXT',
  2: 'SYSTEM',
  3: 'FILE',
  4: 'IMAGE',
  5: 'VIDEO',
  6: 'AUDIO',
  7: 'TYPING',
};

/** `ChatStatus` — enums.ts:15-22. */
const CHAT_STATUS_BY_INT: Readonly<Record<number, RestChatStatus>> = {
  1: 'OPEN',
  2: 'WAITING_FOR_AGENT',
  3: 'ASSIGNED',
  4: 'CLOSED',
  5: 'RESOLVED',
  6: 'ON_HOLD',
};

/** `ChatMode` — enums.ts:24-27. */
const CHAT_MODE_BY_INT: Readonly<Record<number, RestChatMode>> = {
  1: 'BOT',
  2: 'HUMAN',
};

/**
 * Decodes one integer enum, or throws.
 *
 * Guessing is not an option for these fields: coercing an unmapped `senderType`
 * to a default would attribute an agent's message to the customer who is
 * reading it. The backend's own WS projection throws on the same input
 * (`ProjectionError`, projection.ts:68-77), and since the enums are append-only
 * an unknown integer always means this package is behind the service — a code
 * change, not something a retry or a fallback can fix.
 */
function decode<T extends string>(
  table: Readonly<Record<number, T>>,
  value: unknown,
  field: string,
): T {
  const name = typeof value === 'number' ? table[value] : undefined;
  if (name === undefined) {
    throw malformed(`unmappable ${field} on a message or session row`);
  }
  return name;
}

/** The one failure this module raises. Mirrors `unwrapEnvelope`'s taxonomy. */
function malformed(detail: string): RestApiError {
  return new RestApiError({
    code: 'MALFORMED_RESPONSE',
    // No row content is interpolated — rows carry customer message bodies and
    // signed attachment URLs (§14). The field name is a constant from this file.
    message: `unexpected response shape: ${detail}`,
    status: 200,
    retryable: false,
  });
}

// ── Field readers ───────────────────────────────────────────────────────────

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed(`expected an object for ${what}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw malformed(`missing ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Normalizes a timestamp to ISO-8601.
 *
 * Defensive for the same reason the backend's own `toIso` is
 * (projection.ts:94-106): the service returns real `Date`s on a cache miss but
 * ISO strings on a Redis cache hit, and over HTTP a `Date` has already been
 * JSON-stringified. All three arrive here.
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requireIso(value: unknown, field: string): string {
  const iso = toIso(value);
  if (iso === null) throw malformed(`missing or unparseable ${field}`);
  return iso;
}

// ── Attachment safety ───────────────────────────────────────────────────────

/**
 * Only `http:` and `https:` reach an `<img src>` or an `<a href>` as an inert
 * network fetch. `javascript:`, `data:`, and `blob:` do not, and a `mediaType`
 * of `IMAGE` is enough for a binding to render the URL without asking further.
 */
const HTTP_URL = /^https?:\/\//i;

/**
 * Is this a well-formed attachment?
 *
 * ── Why REST validates what the socket does not have to ──
 *
 * On the WebSocket path core validates the identical object through
 * `validateAttachmentMetadata` (packages/core/src/protocol/validate.ts), because
 * everything arriving there is a frame and every frame is validated. A fetch
 * response is not a frame and never passes through that check, so without this
 * the REST path is the one way into `ChatState` with no validation at all.
 *
 * That gap is reachable. chat-service validates an inbound `message.send`
 * attachment only when the field is top-level
 * (`api/websocket/v2/protocol/validate.ts:223` tests `'attachment' in d`), so a
 * client that sends NO top-level attachment and a forged
 * `d.metadata.attachment` skips validation on both sides and is persisted
 * verbatim (`handlers.ts:902-903`). On reload it comes back here. Casting it
 * would put an attacker-chosen URL into a rendered `<img>` — a zero-click
 * beacon reporting every viewer's IP and User-Agent on every history load.
 *
 * The field checks mirror core's `validateAttachmentMetadata` exactly, plus the
 * scheme check core does not currently make. See this module's note on why the
 * two are not one function today.
 */
export function isAttachmentMetadata(value: unknown): value is RestAttachmentMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['url'] === 'string' &&
    HTTP_URL.test(candidate['url']) &&
    isNonEmptyString(candidate['fileName']) &&
    isNonEmptyString(candidate['mimeType']) &&
    isNonEmptyString(candidate['mediaType']) &&
    typeof candidate['size'] === 'number' &&
    Number.isFinite(candidate['size'])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Keys never copied into the metadata bag core publishes.
 *
 * `attachment` because it has exactly one canonical home and that is the
 * top-level field (D4). The other three because `JSON.parse` makes
 * `__proto__` an OWN property — unlike an object literal, where it sets the
 * prototype — so a response body can carry one through to here. This module's
 * own copy is built with `CreateDataProperty` semantics and is not itself
 * polluted, but `metadata` crosses the SDK's public boundary as documented
 * opaque application data, and a host app that does
 * `Object.assign(target, message.metadata)` or runs it through a deep-merge
 * gets its prototype detached. `constructor`/`prototype` are the standard
 * second hop for the same trick.
 */
const UNSAFE_METADATA_KEYS: ReadonlySet<string> = new Set([
  'attachment',
  '__proto__',
  'constructor',
  'prototype',
]);

/** Copies a metadata bag, key by key, skipping the ones above. */
function withoutUnsafeKeys(source: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (UNSAFE_METADATA_KEYS.has(key)) continue;
    safe[key] = source[key];
  }
  return safe;
}

// ── Message ─────────────────────────────────────────────────────────────────

/**
 * One row from `GET /chat/sessions/{id}/messages` → core's `ChatMessage`.
 *
 * Three things happen here that the REST service does not do for itself, each
 * matching what `projectMessage` (projection.ts:197-224) does for the socket:
 *
 *  1. Integer enums are decoded (`senderType`, `messageType`).
 *  2. Fields are renamed: `chatSessionId` → `sessionId`, `messageType` → `type`.
 *  3. An attachment stored in the legacy `metadata` column is lifted to the top
 *     level and stripped from the metadata that survives.
 *
 * Fields core does not model are dropped rather than passed along — notably
 * `replyToMessage`, the nested copy of the parent message the row carries next
 * to `replyToMessageId`.
 */
export function toChatMessage(row: unknown): RestChatMessage {
  const source = asRecord(row, 'a message row');

  const message: RestChatMessage = {
    id: requireString(source['id'], 'message.id'),
    // Rename: the row keys this `chatSessionId`, core calls it `sessionId`.
    sessionId: requireString(source['chatSessionId'], 'message.chatSessionId'),
    // Nullable on the row (a SYSTEM message has no sender), required by core.
    // Empty string is what the WS projection substitutes (projection.ts:204).
    senderId: optionalString(source['senderId']) ?? '',
    senderType: decode(SENDER_TYPE_BY_INT, source['senderType'], 'senderType'),
    // Rename: the row keys this `messageType`, core calls it `type`.
    type: decode(MESSAGE_TYPE_BY_INT, source['messageType'], 'messageType'),
    content: typeof source['content'] === 'string' ? source['content'] : '',
    createdAt: requireIso(source['createdAt'], 'message.createdAt'),
  };

  const replyToMessageId = optionalString(source['replyToMessageId']);
  if (replyToMessageId !== null) message.replyToMessageId = replyToMessageId;

  // `seq` is required by the WS schema and that path throws without it, but
  // core's state-layer `ChatMessage` types it optional, and rows that predate
  // sequencing legitimately have none. Failing a whole page of history over a
  // legacy row would be a worse outcome than an unordered one, so it is simply
  // omitted — `exactOptionalPropertyTypes` makes omitted and undefined
  // different things, and core reads absence as "no server ordering key".
  if (typeof source['seq'] === 'number') message.seq = source['seq'];

  // The database keeps attachments inside the legacy `metadata` column; core
  // carries them top-level (D4: one canonical location). Lift and strip, so an
  // attachment never appears in both places — the exact ambiguity v1 clients
  // had to defend against (§12.2). Mirrors projection.ts:217-222.
  const metadata = source['metadata'];
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const candidate = (metadata as Record<string, unknown>)['attachment'];
    if (isAttachmentMetadata(candidate)) {
      // Rebuilt field by field rather than forwarded: the stored object can
      // carry keys nobody validated, including a polluting one.
      message.attachment = {
        url: candidate.url,
        fileName: candidate.fileName,
        mimeType: candidate.mimeType,
        size: candidate.size,
        mediaType: candidate.mediaType,
      };
    }
    const rest = withoutUnsafeKeys(metadata as Record<string, unknown>);
    // Only when something is left: a metadata bag that held nothing but the
    // attachment must come back absent, not as an empty object.
    if (Object.keys(rest).length > 0) message.metadata = rest;
  }

  return message;
}

/**
 * Marks a message this SDK could not decode. Bindings key their "unsupported
 * message" notice off it; core never reads it.
 *
 * It travels in `metadata` because that is the only field in core's
 * `ChatMessage` meant to carry data core does not interpret, and adding an
 * SDK-level field to that shape would change a seam every binding implements.
 * No collision with a host application's own metadata is possible: a
 * placeholder discards the row's metadata entirely — a row that cannot be
 * decoded is not a row whose other fields are worth trusting.
 */
export const UNSUPPORTED_MESSAGE_MARKER = 'unsupportedMessage';

/**
 * One history row → a message, a placeholder, or nothing.
 *
 * ── Why a bad row must not fail the page ──
 *
 * `toChatMessage` throws on an enum it cannot decode, and enums.ts:8 documents
 * appending new values as routine. Mapping a page with `rows.map(toChatMessage)`
 * therefore turns ONE newer-typed message into ZERO history for that customer —
 * the same user-facing outcome as the empty-page bug this adapter exists to fix.
 * The backend's own socket path already scopes the blast radius this way: a
 * `ProjectionError` drops one push, not a conversation.
 *
 * The placeholder is deliberately attributed to `SYSTEM`, never to a
 * participant. Refusing to guess a sender is the whole reason `decode` throws;
 * a placeholder that named an author would reintroduce exactly the
 * misattribution being avoided — showing an agent's message as the customer's
 * own. `SYSTEM` claims no person, and bindings already render it as a notice
 * rather than as somebody's bubble. When only the message TYPE failed to decode
 * this understates a known sender, which is the safe direction to be wrong in.
 *
 * `content` is dropped rather than passed through: an unrecognized message type
 * is precisely the case where the content field may hold something not meant to
 * be read as prose, and rendering a future card format's payload as raw text is
 * a worse answer than rendering a notice.
 *
 * Returns `null` when not even a placeholder can be built — without a stable id
 * there is nothing for a list to key on, and without a timestamp nothing to
 * order it by.
 */
export function projectHistoryRow(row: unknown): RestChatMessage | null {
  try {
    return toChatMessage(row);
  } catch (error) {
    // Only this module's own verdict is recoverable. A TypeError is a bug here
    // and must not be quietly turned into a placeholder.
    if (!(error instanceof RestApiError) || error.code !== 'MALFORMED_RESPONSE') throw error;
  }

  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;

  const id = optionalString(source['id']);
  const sessionId = optionalString(source['chatSessionId']);
  const createdAt = toIso(source['createdAt']);
  if (id === null || sessionId === null || createdAt === null) return null;

  const placeholder: RestChatMessage = {
    id,
    sessionId,
    senderId: '',
    senderType: 'SYSTEM',
    type: 'SYSTEM',
    content: '',
    createdAt,
    metadata: { [UNSUPPORTED_MESSAGE_MARKER]: true },
  };
  // Kept when present so the placeholder still orders and de-duplicates against
  // the live socket stream like any other message.
  if (typeof source['seq'] === 'number') placeholder.seq = source['seq'];
  return placeholder;
}

// ── Session ─────────────────────────────────────────────────────────────────

/**
 * Builds core's `ChatParticipantProfile` from an enriched user block.
 *
 * `enrichSessionWithUsers` (application/services/chat-user.service.ts:189-231)
 * attaches `{displayName, email, avatarUrl, isOnline}` — and no id. Core
 * requires `participantId`, because a `presence.update` frame and a read
 * watermark are both keyed by it and have nothing to bind to without it. The id
 * therefore comes from the outer row's `assignedAgentId` / `customerId`, which
 * is where the enrichment read it from in the first place.
 *
 * No id means no profile: a nameplate that cannot be correlated to presence is
 * worse than none, and core models `null` for exactly this case.
 */
function toProfile(block: unknown, participantId: unknown): RestChatParticipantProfile | null {
  const id = optionalString(participantId);
  if (id === null) return null;
  if (typeof block !== 'object' || block === null) return null;

  const source = block as Record<string, unknown>;
  return {
    participantId: id,
    displayName: optionalString(source['displayName']) ?? id,
    // ── Deliberately not populated, even though /full returns it ──
    //
    // This read is the first thing in the SDK that could put a real customer
    // email into `ChatState`: the WebSocket path always writes null
    // (packages/core/src/client/session.ts:83,142), and `bestEffortProfile`
    // carries whatever lands here forward for the rest of the session. Nothing
    // in the SDK renders it, so populating it buys no feature — it only widens
    // where the address exists. The widget runs inside third-party merchant
    // pages, where session-replay and error-reporting tools serialize
    // application state wholesale, so an unused address in `ChatState` is an
    // address in someone else's recording.
    //
    // A consumer that genuinely needs it should read it from its own backend,
    // where it is already authorized to.
    email: null,
    avatarUrl: optionalString(source['avatarUrl']),
  };
}

/**
 * The `session` object from `GET /chat/sessions/{id}/full` → core's `ChatSession`.
 *
 * Integer `status` and `mode` are decoded the same way message enums are. The
 * row's `ticketId` is a bare `string | null`; core models a `{id, url}` object,
 * and there is no URL on this service to fill in.
 */
export function toChatSession(row: unknown): RestChatSession {
  const source = asRecord(row, 'a session row');
  const ticketId = optionalString(source['ticketId']);

  return {
    id: requireString(source['id'], 'session.id'),
    status: decode(CHAT_STATUS_BY_INT, source['status'], 'session.status'),
    mode: decode(CHAT_MODE_BY_INT, source['mode'], 'session.mode'),
    createdAt: requireIso(source['createdAt'], 'session.createdAt'),
    // Absent while the session is still open — not an error.
    closedAt: toIso(source['closedAt']),
    assignedAgent: toProfile(source['assignedAgent'], source['assignedAgentId']),
    customer: toProfile(source['customer'], source['customerId']),
    ticket: ticketId === null ? null : { id: ticketId, url: null },
  };
}
