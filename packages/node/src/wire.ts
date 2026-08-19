// The chat routes' wire format: the `{ success, data }` envelope, and the raw
// Prisma row that sits inside it.
//
// ── Why this file exists at all ──
//
// `POST /tokens` returns its body bare (`token.routes.ts:260` — `reply.status(201)
// .send(minted)`). Every route under `/chat/...` does not: it replies
// `{ success: true, data: … }` (`chat.routes.ts:270-276`). And what `data`
// carries for history is not the projected payload the WebSocket emits — it is
// Prisma's row, handed to the route untouched (`message.service.ts:285-296`,
// `:470-482`). So a row arrives with integer enums, the column name
// `chatSessionId`, and — the one that silently loses data — the attachment still
// nested at `metadata.attachment`, where `api/websocket/v2/projection.ts:213-222`
// lifts it to the top level for the socket path.
//
// This package's own `ChatMessage` (types.ts) declares the LIFTED, decoded
// shape: `senderType: SenderType` not `1`, `attachment` top-level and
// "Never `metadata.attachment`". Nothing was making that true. This module is
// what makes it true.
//
// ── Why this is not imported from `@dhaam-ccrm/rest` ──
//
// Two independent reasons, and the first is the one that decides it.
//
// 1. The edge is banned, structurally and by test. `test/packaging.test.ts`
//    asserts this package declares no `@dhaam-ccrm/*` dependency in ANY of
//    `dependencies`/`peerDependencies`/`devDependencies`, and that no file in
//    `src/` names one in an import specifier. That ban is §14: `@dhaam-ccrm/rest`
//    ships inside a browser bundle, this package holds the secret key, and an
//    edge between them is precisely how the second ends up inside the first.
//
// 2. Even if the edge were allowed, `rest.toChatMessage` is the wrong function.
//    It targets `@dhaam-ccrm/core`'s vocabulary: it renames `chatSessionId` to
//    `sessionId` and `messageType` to `type`, and it DROPS `replyToMessage`
//    because core does not model it. This package's `ChatMessage` keeps the
//    first two names and does model `replyToMessage` (types.ts:87), because it
//    is transcribed from `openapi/chat-api.yaml` rather than from core's state
//    layer. Reusing rest's projection here would quietly rename two public
//    fields and delete a third.
//
// What IS genuinely common between the two packages is the integer enum tables,
// and both mirror the same upstream file rather than each other — see below.

import { ChatApiError } from './errors.js';
import type {
  Attachment,
  ChatMessage,
  MediaType,
  MessagePage,
  MessageReplyPreview,
  MessageType,
  SenderType,
} from './types.js';

/**
 * The one route in this package that answers with an envelope.
 *
 * `POST /tokens` deliberately does not (`token.routes.ts:260`), which is why
 * unwrapping lives here per-route rather than inside `HttpClient`: a client
 * that unwrapped globally would need a route-exception list inside the one
 * module whose job is to know about no routes at all.
 */
const MESSAGES_ROUTE = 'GET /chat/sessions/{sessionId}/messages';

// ── Failure ─────────────────────────────────────────────────────────────────

/**
 * The one failure this module raises.
 *
 * `status: 200` is honest: the transport succeeded and the server reported no
 * error — the body simply is not what the route documents. `retryable: false`
 * because no retry changes a response shape; a mismatch here is contract drift
 * between this package and the service, and it needs a code change.
 */
function malformed(detail: string): ChatApiError {
  return new ChatApiError({
    code: 'MALFORMED_RESPONSE',
    // Nothing from the body is interpolated. Rows carry customer message
    // bodies and signed attachment URLs (§14), and an error from this package
    // is one `console.error` away from an error tracker. Every string that
    // reaches this message is a constant from this file.
    message: `unexpected response shape: ${detail}`,
    status: 200,
    retryable: false,
  });
}

// ── Envelope ────────────────────────────────────────────────────────────────

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
}

/**
 * Returns `body.data`, or throws if `body` is not a successful envelope.
 *
 * Strict rather than a tolerant pass-through, for the same reason the REST
 * package's equivalent is: handing the envelope back unchanged when it does not
 * match would type a `{ success, data }` object as the payload itself. Nothing
 * would throw — `wire.messages` would read `undefined`, the page would come back
 * empty, and a caller would conclude the session has no history. A silently
 * empty conversation is far worse to diagnose than a rejected promise.
 *
 * @param context Names the route, for the message. Must be a caller-side
 *   constant — it is the only detail that reaches the error (§14).
 */
export function unwrapEnvelope<T>(body: unknown, context: string): T {
  const envelope = body as Envelope | null;

  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    envelope.success !== true ||
    typeof envelope.data !== 'object' ||
    envelope.data === null ||
    // No route this package calls returns an array under `data`. One that did
    // would be as broken for the caller as a missing `data`, so it is rejected
    // rather than passed through as though it were the expected object.
    Array.isArray(envelope.data)
  ) {
    throw malformed(`${context} did not return a { success: true, data } envelope`);
  }

  return envelope.data as T;
}

// ── Integer enums ───────────────────────────────────────────────────────────
//
// Mirrored from `chat-service-node/src/shared/constants/enums.ts`, which states
// the org-wide rule these tables encode: enums are stored in the database and
// transmitted over APIs and the WebSocket as INTEGERS — 1-based, append-only,
// never renumbered and never reused.
//
// `@dhaam-ccrm/rest` carries the same tables. Neither package is derived from
// the other: both mirror that one upstream file, which is what keeps them
// consistent without a dependency edge (see the header). Line references below
// point at the upstream file so each table stays checkable against its source
// rather than against this comment, and `test/wire.test.ts` pins every entry as
// a literal so a silent edit here fails rather than misattributes a message.

/** `SenderType` — enums.ts:29-34. */
const SENDER_TYPE_BY_INT: Readonly<Record<number, SenderType>> = {
  1: 'CUSTOMER',
  2: 'AGENT',
  3: 'BOT',
  4: 'SYSTEM',
};

/** `MessageType` — enums.ts:36-44. */
const MESSAGE_TYPE_BY_INT: Readonly<Record<number, MessageType>> = {
  1: 'TEXT',
  2: 'SYSTEM',
  3: 'FILE',
  4: 'IMAGE',
  5: 'VIDEO',
  6: 'AUDIO',
  7: 'TYPING',
};

/**
 * Decodes one integer enum, or throws.
 *
 * Guessing is not available here. Coercing an unmapped `senderType` to a
 * default would attribute an agent's message to the customer reading it, and
 * defaulting `messageType` would render an image as text. The service's own
 * WebSocket projection throws on the same input (`projection.ts:68-77`), and
 * because the enums are append-only an unknown integer always means this
 * package is behind the service — a code change, not something a retry or a
 * fallback can repair.
 */
function decode<T extends string>(
  table: Readonly<Record<number, T>>,
  value: unknown,
  field: string,
): T {
  const name = typeof value === 'number' ? table[value] : undefined;
  if (name === undefined) throw malformed(`unmappable ${field} on a message row`);
  return name;
}

// ── Media type ──────────────────────────────────────────────────────────────

/**
 * Lowercased wire value → this package's {@link MediaType}.
 *
 * `/upload` reports s3-client's `mediaFolder` verbatim (`upload.routes.ts:172`),
 * which is an S3 sub-folder name — lowercase and mostly plural. That value is
 * what gets stored inside `metadata.attachment` and what comes back out of
 * history, so an unnormalized `images` would land in a field this package
 * declares as `'IMAGE'`.
 *
 * Both the plural folder name and the singular form are listed so an
 * already-correct `IMAGE` survives the round trip: the lookup runs on the
 * lowercased input, which turns `IMAGE` into `image`.
 */
const MEDIA_TYPE_BY_WIRE_VALUE: Readonly<Record<string, MediaType>> = {
  images: 'IMAGE',
  image: 'IMAGE',
  videos: 'VIDEO',
  video: 'VIDEO',
  audio: 'AUDIO',
  documents: 'DOCUMENT',
  document: 'DOCUMENT',
};

/**
 * Maps an attachment's stored `mediaType` onto a name this package declares.
 *
 * Unrecognized input becomes `DOCUMENT` rather than throwing, mirroring
 * s3-client's own fallback for an unclassified MIME type (`s3-client.ts:43`).
 * Unlike the integer enums, there is nothing to misattribute: the file is still
 * the file, and losing a whole page of history over a label the service itself
 * treats as a default would be the worse outcome.
 */
export function normalizeMediaType(value: unknown): MediaType {
  if (typeof value !== 'string') return 'DOCUMENT';
  return MEDIA_TYPE_BY_WIRE_VALUE[value.trim().toLowerCase()] ?? 'DOCUMENT';
}

// ── Field readers ───────────────────────────────────────────────────────────

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed(`expected an object for ${what}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw malformed(`missing ${field}`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Normalizes a timestamp to ISO-8601.
 *
 * Defensive for the same reason the service's own `toIso` is
 * (`projection.ts:94-106`): it returns real `Date`s on a cache miss but ISO
 * strings on a Redis cache hit, and over HTTP a `Date` has already been
 * JSON-stringified on its way out. All three shapes arrive here.
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

// ── Attachment ──────────────────────────────────────────────────────────────

/**
 * The stored attachment blob → {@link Attachment}.
 *
 * `size` is coerced from a string because the value originates in an upload
 * response and survives a JSON round trip through the `metadata` column; a
 * numeric string there should not cost the caller the attachment.
 */
function toAttachment(value: unknown): Attachment | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;

  const url = optionalString(source['url']);
  // No URL, no attachment. A bubble that renders a file name pointing nowhere
  // is worse than one that reports no attachment at all.
  if (url === null) return null;

  const size = Number(source['size']);

  return {
    url,
    fileName: optionalString(source['fileName']) ?? '',
    mimeType: optionalString(source['mimeType']) ?? 'application/octet-stream',
    size: Number.isFinite(size) ? size : 0,
    mediaType: normalizeMediaType(source['mediaType']),
  };
}

// ── Reply preview ───────────────────────────────────────────────────────────

/**
 * The nested `replyToMessage` row → {@link MessageReplyPreview}.
 *
 * `message.repository.ts:29-33` selects `{id, content, senderType, senderId,
 * messageType}` for this block, so its `senderType` is an integer like the
 * outer row's. The three fields this package models are taken; the rest are
 * dropped.
 *
 * Returns `null` rather than throwing on a malformed block: the preview is
 * decoration on a message whose own content is intact, and failing the page
 * over it would trade a missing quote for a missing conversation.
 */
function toReplyPreview(value: unknown): MessageReplyPreview | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;

  const id = optionalString(source['id']);
  if (id === null) return null;

  const senderType =
    typeof source['senderType'] === 'number'
      ? SENDER_TYPE_BY_INT[source['senderType']]
      : undefined;
  if (senderType === undefined) return null;

  return {
    id,
    content: typeof source['content'] === 'string' ? source['content'] : '',
    senderType,
  };
}

// ── Message ─────────────────────────────────────────────────────────────────

/**
 * One raw row from `GET /chat/sessions/{sessionId}/messages` → {@link ChatMessage}.
 *
 * Three things happen here that the REST path does not do for itself, each
 * matching what the socket's `projectMessage` does (`projection.ts:197-224`):
 *
 *  1. Integer enums are decoded — `senderType`, `messageType`, and the nested
 *     preview's `senderType`.
 *  2. An attachment stored in the legacy `metadata` column is LIFTED to the top
 *     level and stripped from the metadata that survives, so it never appears
 *     in both places. Without this every reloaded image loses its attachment,
 *     because `ChatMessage.attachment` is where this package promises it lives
 *     (types.ts:84) and nothing was putting it there.
 *  3. Timestamps are normalized to ISO-8601.
 *
 * Field NAMES are kept as the row and `openapi/chat-api.yaml` have them —
 * `chatSessionId`, `messageType` — because that is what this package's public
 * `ChatMessage` declares. This is the deliberate difference from
 * `@dhaam-ccrm/rest`, which renames both to core's vocabulary.
 */
export function toChatMessage(row: unknown): ChatMessage {
  const source = asRecord(row, 'a message row');

  const message: {
    -readonly [K in keyof ChatMessage]: ChatMessage[K];
  } = {
    id: requireString(source['id'], 'message.id'),
    chatSessionId: requireString(source['chatSessionId'], 'message.chatSessionId'),
    senderType: decode(SENDER_TYPE_BY_INT, source['senderType'], 'senderType'),
    content: typeof source['content'] === 'string' ? source['content'] : '',
    messageType: decode(MESSAGE_TYPE_BY_INT, source['messageType'], 'messageType'),
    createdAt: requireIso(source['createdAt'], 'message.createdAt'),
  };

  // Nullable on the row — a SYSTEM message has no sender — and optional here,
  // so absence stays absence. `exactOptionalPropertyTypes` makes an omitted
  // property and an explicit `undefined` different things.
  const senderId = optionalString(source['senderId']);
  if (senderId !== null) message.senderId = senderId;

  const replyToMessageId = optionalString(source['replyToMessageId']);
  if (replyToMessageId !== null) message.replyToMessageId = replyToMessageId;

  const replyToMessage = toReplyPreview(source['replyToMessage']);
  if (replyToMessage !== null) message.replyToMessage = replyToMessage;

  // The lift. Mirrors `projection.ts:217-222`.
  const metadata = source['metadata'];
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const { attachment, ...rest } = metadata as Record<string, unknown>;

    const lifted = toAttachment(attachment);
    if (lifted !== null) message.attachment = lifted;

    // Only when something is left. A metadata bag that held nothing but the
    // attachment must come back absent, not as an empty object.
    if (Object.keys(rest).length > 0) message.metadata = rest;
  }

  return message;
}

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * The body of `GET /chat/sessions/{sessionId}/messages` → {@link MessagePage}.
 *
 * The whole wire contract for that route in one call: unwrap the envelope,
 * insist on a `messages` array, and project every row. Both branches of the
 * handler put `{ messages, hasMore }` inside `data` — the cursor branch via
 * `getMessagesPaginated` and the first-page branch inline
 * (`chat.routes.ts:262-276`) — so one shape covers both.
 *
 * `hasMore` is read as `=== true` rather than coerced: a missing field must
 * mean "stop", never "keep asking".
 */
export function toMessagePage(body: unknown): MessagePage {
  const page = unwrapEnvelope<{ messages?: unknown; hasMore?: unknown }>(body, MESSAGES_ROUTE);

  if (!Array.isArray(page.messages)) {
    throw malformed(`${MESSAGES_ROUTE} returned an envelope without a messages array`);
  }

  return {
    messages: page.messages.map(toChatMessage),
    hasMore: page.hasMore === true,
  };
}
