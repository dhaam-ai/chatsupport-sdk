// Runtime frame validation.
//
// Every inbound frame is untrusted input (PRD §14: "All inputs crossing the
// wire boundary ... are validated against the schema in §7.2 before being
// applied to state; malformed frames are dropped ... not applied
// partially"). This module is a hand-rolled validator — `@dhaam-ccrm/core`
// has zero runtime dependencies, so no zod/ajv/etc.
//
// Design principles:
//
// 1. Never partially apply. `validateFrame` returns either a fully-formed,
//    fully-typed `AnyFrame` or a structured failure — there is no third
//    state where part of a frame is trusted.
// 2. Forward-compatible by default. Validators check that REQUIRED fields
//    are present with the right shape; they do not reject objects that
//    carry EXTRA, unrecognized keys (top-level envelope or inside `d`).
//    This is deliberate: a validator that hard-rejects unknown fields
//    would turn every backward-compatible additive field the backend adds
//    later into a breaking change for every already-deployed client. Only
//    reject what's actually wrong (missing/mistyped required fields,
//    unknown frame types), never what's merely unfamiliar.
// 3. Logging is not this module's job. The transport layer (a later task)
//    calls `validateFrame`, and logs + drops on failure — this module only
//    classifies valid vs. invalid and says why.

import type {
  AckFrame,
  AnyFrame,
  ClientToServerFrameType,
  ErrorFrame,
  ErrorPayload,
  ServerPushFrameType,
} from './frames.js';
import {
  ALL_FRAME_TYPES,
  CLIENT_TO_SERVER_FRAME_TYPES,
  SERVER_PUSH_FRAME_TYPES,
} from './frames.js';
import type { FrameType } from './frames.js';
import { isErrorCode } from './errors.js';
import {
  isChatMode,
  isChatStatus,
  isCloseReason,
  isMessageType,
  isParticipantType,
  isPresenceStatus,
  isSenderType,
} from './enums.js';

// =============================================================================
// Public result types
// =============================================================================

export interface FrameValidationFailure {
  ok: false;
  /** Dot path to the offending field, e.g. "d.protocolVersion", or "" for the envelope itself. */
  path: string;
  /** Human-readable, single-line reason a person or log line can use directly. */
  reason: string;
  /** The frame's `t` value, if the envelope was parseable that far. */
  frameType?: string;
}

export type FrameValidationResult = { ok: true; frame: AnyFrame } | FrameValidationFailure;

// =============================================================================
// Primitive guards
// =============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Canonical Crockford base32 ULID shape: 26 characters, uppercase (§7.2). */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

/** Requires an explicit 'T' separator and an explicit zone (Z or ±hh:mm) — no bare dates, no non-ISO formats. */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601_PATTERN.test(value);
}

// =============================================================================
// Frame-type membership guards
// =============================================================================

const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set(ALL_FRAME_TYPES);
const CLIENT_FRAME_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_TO_SERVER_FRAME_TYPES);
const SERVER_PUSH_FRAME_TYPE_SET: ReadonlySet<string> = new Set(SERVER_PUSH_FRAME_TYPES);

export function isKnownFrameType(value: string): value is FrameType {
  return KNOWN_FRAME_TYPES.has(value);
}

export function isClientToServerFrameType(value: string): value is ClientToServerFrameType {
  return CLIENT_FRAME_TYPE_SET.has(value);
}

export function isServerPushFrameType(value: string): value is ServerPushFrameType {
  return SERVER_PUSH_FRAME_TYPE_SET.has(value);
}

// =============================================================================
// Failure helper
// =============================================================================

function fail(path: string, reason: string, frameType?: string): FrameValidationFailure {
  if (frameType !== undefined) {
    return { ok: false, path, reason, frameType };
  }
  return { ok: false, path, reason };
}

type FieldGuard<T> = (value: unknown) => value is T;
type NestedValidator = (value: unknown, path: string, frameType: string) => FrameValidationFailure | null;

function requireField<T>(
  obj: Record<string, unknown>,
  key: string,
  guard: FieldGuard<T>,
  path: string,
  label: string,
  frameType: string,
): FrameValidationFailure | null {
  if (!guard(obj[key])) {
    return fail(`${path}.${key}`, `must be ${label}`, frameType);
  }
  return null;
}

function optionalField<T>(
  obj: Record<string, unknown>,
  key: string,
  guard: FieldGuard<T>,
  path: string,
  label: string,
  frameType: string,
): FrameValidationFailure | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  if (!guard(obj[key])) {
    return fail(`${path}.${key}`, `must be ${label}`, frameType);
  }
  return null;
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  validator: NestedValidator,
  frameType: string,
): FrameValidationFailure | null {
  return validator(obj[key], `${path}.${key}`, frameType);
}

function optionalObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  validator: NestedValidator,
  frameType: string,
): FrameValidationFailure | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  return validator(obj[key], `${path}.${key}`, frameType);
}

function requireArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  itemValidator: NestedValidator,
  frameType: string,
): FrameValidationFailure | null {
  const value = obj[key];
  if (!Array.isArray(value)) {
    return fail(`${path}.${key}`, 'must be an array', frameType);
  }
  for (let i = 0; i < value.length; i++) {
    const failure = itemValidator(value[i], `${path}.${key}[${i}]`, frameType);
    if (failure) return failure;
  }
  return null;
}

function optionalArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  itemValidator: NestedValidator,
  frameType: string,
): FrameValidationFailure | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  return requireArray(obj, key, path, itemValidator, frameType);
}

// =============================================================================
// Nested domain object validators (domain.ts shapes)
// =============================================================================

function validateAttachmentMetadata(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'url', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'fileName', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'mimeType', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'size', isFiniteNumber, path, 'a number', frameType) ??
    requireField(value, 'mediaType', isNonEmptyString, path, 'a non-empty string', frameType)
  );
}

function validateMessageMetadata(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  // Opaque application data — shape is not this spec's business. Attachments
  // are validated at the payload level, not in here (D4: one location).
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return null;
}

function validateParticipantSnapshot(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'participantId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'type', isParticipantType, path, 'a valid ParticipantType', frameType) ??
    optionalField(value, 'lastReadAt', isIsoTimestamp, path, 'an ISO-8601 timestamp string', frameType)
  );
}

function validateSessionSnapshot(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'sessionId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'status', isChatStatus, path, 'a valid ChatStatus', frameType) ??
    requireField(value, 'mode', isChatMode, path, 'a valid ChatMode', frameType) ??
    requireArray(value, 'participants', path, validateParticipantSnapshot, frameType) ??
    requireField(value, 'createdAt', isIsoTimestamp, path, 'an ISO-8601 timestamp string', frameType) ??
    optionalField(value, 'ticketId', isNonEmptyString, path, 'a non-empty string', frameType)
  );
}

function validatePresenceEntry(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'participantId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'status', isPresenceStatus, path, 'a valid PresenceStatus', frameType) ??
    optionalField(value, 'lastSeen', isIsoTimestamp, path, 'an ISO-8601 timestamp string', frameType)
  );
}

// =============================================================================
// Per-frame-type payload validators
// =============================================================================

function validateConnectionHello(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'token', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'publishableKey', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'protocolVersion', isInteger, path, 'an integer', frameType) ??
    optionalField(d, 'resumeFrom', isInteger, path, 'an integer', frameType)
  );
}

function validateConnectionReauth(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return requireField(d, 'token', isNonEmptyString, path, 'a non-empty string', frameType);
}

function validateSessionJoin(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return requireField(d, 'sessionId', isNonEmptyString, path, 'a non-empty string', frameType);
}

function validateEmptyPayload(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return null;
}

function validateSessionRequestAgent(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return optionalField(d, 'reason', isString, path, 'a string', frameType);
}

function validateMessageSend(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'content', isString, path, 'a string', frameType) ??
    requireField(d, 'type', isMessageType, path, 'a valid MessageType', frameType) ??
    optionalField(d, 'replyToMessageId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    optionalObject(d, 'attachment', path, validateAttachmentMetadata, frameType) ??
    optionalObject(d, 'metadata', path, validateMessageMetadata, frameType)
  );
}

function validateMessageMarkRead(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return optionalField(d, 'upToMessageId', isNonEmptyString, path, 'a non-empty string', frameType);
}

function validateTyping(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return optionalField(d, 'participantId', isNonEmptyString, path, 'a non-empty string', frameType);
}

function validatePresenceSet(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return requireField(d, 'status', isPresenceStatus, path, 'a valid PresenceStatus', frameType);
}

function validatePresenceQuery(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return optionalField(d, 'participantIds', isStringArray, path, 'an array of strings', frameType);
}

function validateConnectionAck(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'protocolVersion', isInteger, path, 'an integer', frameType) ??
    requireObject(d, 'session', path, validateSessionSnapshot, frameType) ??
    requireField(d, 'seq', isInteger, path, 'an integer', frameType) ??
    optionalArray(d, 'replay', path, validateReplayFrame, frameType)
  );
}

function validateReplayFrame(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  const result = validateFrame(value);
  if (!result.ok) {
    const nestedPath = result.path.length > 0 ? `${path}.${result.path}` : path;
    return fail(nestedPath, result.reason, frameType);
  }
  if (!isServerPushFrameType(result.frame.t)) {
    return fail(`${path}.t`, `replayed frame must be a server push frame type, got "${result.frame.t}"`, frameType);
  }
  return null;
}

function validateSessionUpdated(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return requireObject(d, 'session', path, validateSessionSnapshot, frameType);
}

function validateSessionClosed(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'sessionId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'closeReason', isCloseReason, path, 'a valid CloseReason', frameType)
  );
}

function validateAgentEvent(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'agentId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    optionalField(d, 'agentName', isString, path, 'a string', frameType)
  );
}

function validateMessageNew(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'id', isValidUlid, path, 'a valid ULID', frameType) ??
    requireField(d, 'sessionId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'senderId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'senderType', isSenderType, path, 'a valid SenderType', frameType) ??
    requireField(d, 'type', isMessageType, path, 'a valid MessageType', frameType) ??
    requireField(d, 'content', isString, path, 'a string', frameType) ??
    optionalField(d, 'replyToMessageId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    optionalObject(d, 'attachment', path, validateAttachmentMetadata, frameType) ??
    optionalObject(d, 'metadata', path, validateMessageMetadata, frameType) ??
    requireField(d, 'seq', isInteger, path, 'an integer', frameType) ??
    requireField(d, 'createdAt', isIsoTimestamp, path, 'an ISO-8601 timestamp string', frameType)
  );
}

function validateMessageRead(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'participantId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'readAt', isIsoTimestamp, path, 'an ISO-8601 timestamp string', frameType)
  );
}

function validatePresenceUpdate(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  return validatePresenceEntry(d, path, frameType);
}

function validateTicketLinked(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'ticketId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    optionalField(d, 'ticketUrl', isNonEmptyString, path, 'a non-empty string', frameType)
  );
}

export function validateErrorPayload(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'code', isErrorCode, path, 'a valid ErrorCode', frameType) ??
    requireField(value, 'message', isString, path, 'a string', frameType) ??
    requireField(value, 'retryable', isBoolean, path, 'a boolean', frameType) ??
    optionalField(value, 'details', isPlainObject, path, 'an object', frameType)
  );
}

type PlainFrameType = ClientToServerFrameType | ServerPushFrameType;
type PayloadValidator = (d: unknown, path: string, frameType: string) => FrameValidationFailure | null;

const PAYLOAD_VALIDATORS: Record<PlainFrameType, PayloadValidator> = {
  'connection.hello': validateConnectionHello,
  'connection.reauth': validateConnectionReauth,
  'session.join': validateSessionJoin,
  'session.leave': validateEmptyPayload,
  'session.requestAgent': validateSessionRequestAgent,
  'message.send': validateMessageSend,
  'message.markRead': validateMessageMarkRead,
  'typing.start': validateTyping,
  'typing.stop': validateTyping,
  'presence.set': validatePresenceSet,
  'presence.query': validatePresenceQuery,
  'system.heartbeat': validateEmptyPayload,
  'connection.ack': validateConnectionAck,
  'session.updated': validateSessionUpdated,
  'session.closed': validateSessionClosed,
  'agent.joined': validateAgentEvent,
  'agent.left': validateAgentEvent,
  'message.new': validateMessageNew,
  'message.read': validateMessageRead,
  'presence.update': validatePresenceUpdate,
  'ticket.linked': validateTicketLinked,
  'system.pong': validateEmptyPayload,
};

// =============================================================================
// Envelope-level validation and entry point
// =============================================================================

function buildAckFrame(
  v: number,
  id: string,
  ts: number,
  input: Record<string, unknown>,
  frameType: 'ack',
): FrameValidationResult {
  const ref = input['ref'];
  if (!isValidUlid(ref)) {
    return fail('ref', 'must be a valid ULID', frameType);
  }
  const d = input['d'];
  if (!isPlainObject(d)) {
    return fail('d', 'must be an object', frameType);
  }
  const okValue = d['ok'];
  if (okValue === false) {
    const errorFailure = validateErrorPayload(d['error'], 'd.error', frameType);
    if (errorFailure) return errorFailure;
    const frame: AckFrame = { v, t: 'ack', id, ref, ts, d: { ok: false, error: d['error'] as ErrorPayload } };
    return { ok: true, frame };
  }
  if (okValue === true) {
    // Extra fields beyond {ok:true} belong to AckExtraData (frames.ts) and
    // are only fully verifiable once the caller correlates `ref` to the
    // frame it acknowledges — see this file's header and AckExtraData's
    // doc comment. We accept any well-formed object at this layer.
    const frame: AckFrame = { v, t: 'ack', id, ref, ts, d: d as { ok: true } & Record<string, unknown> };
    return { ok: true, frame };
  }
  return fail('d.ok', 'must be a boolean discriminant', frameType);
}

function buildErrorFrame(
  v: number,
  id: string,
  ts: number,
  input: Record<string, unknown>,
  frameType: 'error',
): FrameValidationResult {
  const refRaw = input['ref'];
  if (refRaw !== undefined && !isValidUlid(refRaw)) {
    return fail('ref', 'must be a valid ULID when present', frameType);
  }
  const errorFailure = validateErrorPayload(input['d'], 'd', frameType);
  if (errorFailure) return errorFailure;
  const d = input['d'] as ErrorPayload;
  const frame: ErrorFrame =
    refRaw === undefined ? { v, t: 'error', id, ts, d } : { v, t: 'error', id, ref: refRaw, ts, d };
  return { ok: true, frame };
}

function buildPlainFrame(
  v: number,
  id: string,
  ts: number,
  t: PlainFrameType,
  input: Record<string, unknown>,
): FrameValidationResult {
  const d = input['d'];
  const failure = PAYLOAD_VALIDATORS[t](d, 'd', t);
  if (failure) return failure;
  const frame = { v, t, id, ts, d } as AnyFrame;
  return { ok: true, frame };
}

/**
 * Validate an arbitrary, untrusted `unknown` value as a wire protocol
 * frame. Returns either the fully-typed, fully-formed frame or a
 * structured failure — never a partial result.
 *
 * Unknown frame types are rejected (§14, §7.3) rather than passed through:
 * a `t` this module has never heard of is treated exactly like any other
 * malformed frame, not silently forwarded to state.
 */
export function validateFrame(input: unknown): FrameValidationResult {
  if (!isPlainObject(input)) {
    return fail('', 'frame must be a JSON object');
  }

  const v = input['v'];
  if (!isInteger(v)) {
    return fail('v', 'must be an integer protocol version');
  }

  const tRaw = input['t'];
  if (!isNonEmptyString(tRaw)) {
    return fail('t', 'must be a non-empty string');
  }
  if (!isKnownFrameType(tRaw)) {
    return fail('t', `unknown frame type: "${tRaw}"`);
  }
  const t = tRaw;

  const id = input['id'];
  if (!isValidUlid(id)) {
    return fail('id', 'must be a valid ULID', t);
  }

  const ts = input['ts'];
  if (!isFiniteNumber(ts)) {
    return fail('ts', 'must be a finite epoch-millis number', t);
  }

  if (t === 'ack') {
    return buildAckFrame(v, id, ts, input, t);
  }
  if (t === 'error') {
    return buildErrorFrame(v, id, ts, input, t);
  }

  return buildPlainFrame(v, id, ts, t, input);
}

/** Convenience boolean guard built on top of {@link validateFrame}. */
export function isFrame(value: unknown): value is AnyFrame {
  return validateFrame(value).ok;
}
