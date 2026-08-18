// Wire protocol frame envelope types.
//
// Source of truth: docs/spec/chat-sdk-v2-prd.md §7.2.
//
// `Frame`, `AckFrame`, and `ErrorFrame` are the only three top-level shapes
// that ever cross the WebSocket. Every specific frame type in the catalog
// (frames.ts) is a `Frame<T>` for its own payload `T`, except the two
// frame types that use the other two envelope shapes directly: `ack`
// (AckFrame) and `error` (ErrorFrame).

import type { ErrorCode } from './errors.js';

/**
 * The generic frame envelope. Every frame type in the catalog except
 * `ack` and `error` (see below) is `Frame<T>` with `t` narrowed to that
 * frame type's literal and `d` narrowed to that frame type's payload.
 */
export interface Frame<T = unknown> {
  /** Protocol version. Integer, monotonically increasing. See §7.5. */
  v: number;

  /** Frame type — dot-namespaced, e.g. "message.send". See §7.3. */
  t: string;

  /**
   * ULID. Client-generated for client→server frames — this is BOTH the
   * dedup/idempotency key AND, for `message.send` specifically (D1, §0.5),
   * the message's permanent id; there is no server-side id swap.
   * Server-generated for server→client push frames — on a push frame,
   * `id` identifies the frame/delivery itself, not necessarily any domain
   * entity. Where a push frame carries a domain entity with its own
   * identity (e.g. `message.new`'s message), that entity's id is a
   * separate field inside `d` — never assume envelope `id` on a push frame
   * doubles as a domain id.
   */
  id: string;

  /**
   * Sender's epoch-millis clock. INFORMATIONAL ONLY — never use `ts` for
   * ordering, gap detection, or conflict resolution (D2, §0.5). `seq`
   * (carried inside specific payloads — see `MessagePayload.seq` and
   * `ConnectionAckPayload.seq` in frames.ts) is the ordering key.
   */
  ts: number;

  /**
   * Payload. Always camelCase keys, no snake_case, no bare integer enum
   * values — one canonical shape every time for a given `t` (D4, §0.5).
   */
  d: T;
}

/**
 * Generic frame-level acknowledgment, `t: 'ack'`. Used to acknowledge any
 * client-originated frame — not just `message.send` (§8.4: "Any
 * message.send (or other client-originated) frame that has not received
 * an ack before the transport drops is moved into the durable offline
 * queue"), which implies every client→server frame type is ack-tracked,
 * except the two that get their own dedicated response frame instead:
 * `connection.hello` (answered by `connection.ack`) and `system.heartbeat`
 * (answered by `system.pong`).
 *
 * `ref` correlates this ack to the frame it acknowledges. A caller matches
 * `ref` against its own table of frames awaiting acknowledgment to know
 * *which* client→server frame this is acking, and therefore which shape of
 * `T` to expect in the `ok: true` branch. This module validates the ack
 * envelope shape and the ok/error discriminant; it deliberately does not
 * attempt to validate ack "extra data" fields against the original
 * request's frame type, since that requires stateful `ref` correlation
 * that belongs to the transport layer, not this one (see the T1 report's
 * judgment calls for the reasoning).
 */
export interface AckFrame<T = unknown> {
  v: number;
  t: 'ack';

  /** New ULID for this ack frame itself (server-generated). */
  id: string;

  /** id of the frame being acknowledged. */
  ref: string;

  ts: number;
  d: ({ ok: true } & T) | { ok: false; error: ErrorPayload };
}

/**
 * Structured, top-level error frame, `t: 'error'`. Used both for errors
 * correlated to a specific prior frame (`ref` present — e.g. a rejected
 * `message.send`) and for errors with no single frame to blame (`ref`
 * absent — e.g. `PROTOCOL_VERSION_UNSUPPORTED` on the very first
 * `connection.hello`, per §7.5).
 */
export interface ErrorFrame {
  v: number;
  t: 'error';
  id: string;

  /** id of the frame that caused this error, if applicable. */
  ref?: string;

  ts: number;
  d: ErrorPayload;
}

export interface ErrorPayload {
  /** Canonical enum — see errors.ts / §7.4. */
  code: ErrorCode;

  /** Human-readable. NOT for programmatic branching — branch on `code`. */
  message: string;

  retryable: boolean;
  details?: Record<string, unknown>;
}
