// Inbound frame decoding: raw socket payload → validated `ServerFrame`.
//
// Three gates, in order, each of which rejects rather than coerces (D4,
// PRD §0.5). Nothing downstream ever sees a partially-trusted frame:
//
//   1. Text only. `event.data` may be a string, an ArrayBuffer or a Blob.
//      This protocol is JSON text; a binary payload is rejected, never
//      decoded into a string and retried.
//   2. Valid JSON.
//   3. Valid frame, per protocol/validate.ts — which is byte-identical in
//      its ULID pattern and frame catalog to the server's own validator.
//
// Plus a fourth gate protocol/validate.ts deliberately does not apply,
// because it validates both directions: **direction**. `validateFrame`
// happily accepts `connection.hello`, since that is a legitimate frame — in
// the other direction. Arriving from a server it is nonsense, and accepting
// it would hand T8 a frame its state machine has no case for. The real
// server applies the mirror-image check to client frames, rejecting known
// types sent the wrong way with a distinct message.
//
// Note `typing.start` / `typing.stop` are legitimately in both catalogs
// (§7.3: "one concept, one pair of names, in both directions") and carry an
// identical payload, so the direction gate passes them.
//
// Serialization has no counterpart function here on purpose: encoding is a
// bare `JSON.stringify` whose only failure mode (a non-serializable payload)
// is handled where the send is attempted, so a wrapper would add a name
// without adding behaviour.

import type { AnyFrame, ServerFrame } from '../protocol/frames.js';
import { isServerPushFrameType, validateFrame } from '../protocol/validate.js';

/** Why a frame was dropped. Structured so a log line can carry it verbatim. */
export interface FrameDecodeFailure {
  readonly ok: false;

  /** Dot path to the offending field, e.g. `d.seq`. `''` for the frame itself. */
  readonly path: string;

  /** Single-line, human-readable. */
  readonly reason: string;

  /**
   * The offending value — the parsed object when parsing succeeded, the raw
   * payload otherwise. Present for a caller that wants it; never logged
   * wholesale by this module (see logger.ts `frameLogContext`).
   */
  readonly raw: unknown;
}

export type FrameDecodeResult = { readonly ok: true; readonly frame: ServerFrame } | FrameDecodeFailure;

function failure(path: string, reason: string, raw: unknown): FrameDecodeFailure {
  return { ok: false, path, reason, raw };
}

/**
 * Narrows a validated frame to the half a server is allowed to send.
 *
 * Sound despite `typing.start`/`typing.stop` appearing in both catalogs:
 * their two declarations carry the same `TypingPayload`, so the two union
 * members are structurally identical.
 */
function isServerFrame(frame: AnyFrame): frame is ServerFrame {
  return frame.t === 'ack' || frame.t === 'error' || isServerPushFrameType(frame.t);
}

/**
 * Decodes one inbound socket payload.
 *
 * Never throws — a malformed frame is a routine event on an untrusted wire
 * (PRD §14), not an exceptional one, and throwing here would turn one bad
 * frame into a dead connection.
 */
export function decodeFrame(data: unknown): FrameDecodeResult {
  if (typeof data !== 'string') {
    return failure('', `expected a text frame, received ${describeType(data)}`, data);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return failure('', 'frame is not valid JSON', data);
  }

  const validation = validateFrame(parsed);
  if (!validation.ok) {
    return failure(validation.path, validation.reason, parsed);
  }

  if (!isServerFrame(validation.frame)) {
    return failure('t', `"${validation.frame.t}" is a client→server frame type`, parsed);
  }

  return { ok: true, frame: validation.frame };
}

/** A type name safe to put in a message — never the value itself. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof ArrayBuffer) return 'binary data';
  return `a ${typeof value} value`;
}
