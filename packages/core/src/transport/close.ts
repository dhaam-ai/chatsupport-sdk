// What T8 learns when a socket ends.
//
// The transport does not decide whether to reconnect — that is the connection
// state machine's job (T8), driven by backoff/. What the transport owes T8 is
// an honest, complete account of *why* the socket ended, because the raw close
// code is not sufficient on this endpoint:
//
//   - `chat-service-node` v2 defines no 4xxx application close codes at all.
//   - It uses **1008** for five distinct conditions (hello timeout, unsupported
//     protocol version, and three flavours of auth failure), all with the same
//     reason string.
//   - The only discriminator is the `error` frame the server sends immediately
//     *before* closing. A client that drops the last frame on close cannot tell
//     `AUTH_INVALID` from `AUTH_EXPIRED` from `PROTOCOL_VERSION_UNSUPPORTED`.
//
// So `protocolError` carries that last connection-level error payload forward
// into the close event, and `retryable`/`backpressure` name the two decisions
// that would otherwise have every caller hardcoding close-code numbers.

import type { ErrorPayload } from '../protocol/envelope.js';
import { CLOSE_CODE } from './socket.js';

/** What ended the connection, from this client's point of view. */
export type TransportCloseCause =
  /** The socket closed on its own — a server close frame, or the network. */
  | 'peer'

  /** `transport.close()` was called locally. */
  | 'local'

  /**
   * No `system.pong` arrived within the deadline. Synthesized locally: a
   * genuinely dead peer may never deliver a close frame at all, so waiting
   * for one would leave T8 blind for as long as the OS keeps the socket open.
   */
  | 'heartbeatTimeout'

  /**
   * The server answered `connection.hello` with `PROTOCOL_VERSION_UNSUPPORTED`
   * (§7.5). The one cause that is not retryable — no amount of backoff makes a
   * client speak a version it does not implement.
   */
  | 'versionUnsupported';

export interface TransportCloseInfo {
  /**
   * The close code, surfaced intact and never swallowed. `1006` when the
   * connection vanished without a close frame, which on this endpoint also
   * covers the server's liveness reaper calling `terminate()`.
   */
  readonly code: number;

  readonly reason: string;
  readonly wasClean: boolean;
  readonly cause: TransportCloseCause;

  /**
   * `false` only when the peer told us that retrying cannot succeed. A `local`
   * close is reported retryable because it is T8's own doing — T8 knows it
   * asked, and moves to `closed` on its own authority.
   */
  readonly retryable: boolean;

  /**
   * The server closed because its outbound buffer was exceeded (code 1013).
   * Reconnecting immediately just refills it — this is a back-off-harder
   * signal, not a retry-now one.
   */
  readonly backpressure: boolean;

  /**
   * The last connection-level `error` frame payload received before the close,
   * or `null`. The discriminator for close code 1008. Connection-level means
   * the error had no `ref`, or its `ref` pointed at `connection.hello`; an
   * error correlated to some other in-flight frame settles that frame's ack
   * instead and never lands here.
   */
  readonly protocolError: ErrorPayload | null;
}

export interface CloseInfoInput {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  readonly cause: TransportCloseCause;
  readonly protocolError: ErrorPayload | null;
}

/** Applies the two derived policies — retryability and backpressure — in one place. */
export function buildCloseInfo(input: CloseInfoInput): TransportCloseInfo {
  return {
    code: input.code,
    reason: input.reason,
    wasClean: input.wasClean,
    cause: input.cause,
    retryable: input.cause !== 'versionUnsupported',
    backpressure: input.code === CLOSE_CODE.TRY_AGAIN_LATER,
    protocolError: input.protocolError,
  };
}
