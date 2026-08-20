// The WebSocket transport: owns one socket, and moves validated frames across it.
//
// What it owns
// ------------
//   socket lifecycle          open / message / error / close
//   the frame codec           serialize out, validate in, drop what is malformed
//   outbound envelopes        ULID `id`, `v`, `ts`
//   ack correlation           a pending registry that always settles
//   liveness                  heartbeat out, pong in, dead peer detected
//   version negotiation       `connection.hello` out, `connection.ack` in
//
// What it deliberately does NOT own — this is T8's, and the seam is kept sharp
// so T8 can drive all of the above with a stub socket and no network:
//
//   ConnectionState           `connecting` / `authenticating` / `connected` / …
//   reconnect scheduling      backoff/ computes the delays; nobody here sets a
//                             retry timer, and there is no attempt counter
//   session and auth state    the transport never reads a token, only relays it
//   what a close *means*      it reports code, cause and retryability; T8 picks
//                             `reconnecting` vs `suspended`
//
// The three callbacks are the whole outbound surface:
//
//   onOpen()      the socket is open AND `connection.hello` has been written,
//                 so this single signal is T8's connecting → authenticating edge
//   onFrame(f)    every valid inbound frame, EXCEPT `ack` — an ack is delivered
//                 through its send's promise instead, which is the entire point
//                 of the transport owning correlation. No information is lost:
//                 the `acked` outcome carries the whole ack frame, `seq` included
//   onClose(info) the socket ended, with everything T8 needs to choose a policy
//
// Every one of those fires at most once per event, and `onClose` fires exactly
// once per connection that opened a socket.
//
// `onClose` is also T8's *only* signal to retry (`#handleClose` ->
// `#scheduleTransportRetry`, connection/controller.ts) — nothing else in this
// codebase schedules a reconnect. That makes it this module's job to guarantee
// `onClose` eventually fires for every `connect()` call, not just the ones
// that happen to succeed or that the peer happens to close cleanly. Two gaps
// used to violate that:
//
//   - A socket that never calls back at all — no `onopen`, no `onerror`, no
//     `onclose` — which is exactly what "server down" or "no route to host"
//     looks like on many platforms until the OS's own TCP timeout gives up,
//     tens of seconds to minutes later. `connect()` now arms a deadline
//     (`connectTimeoutMs`) that synthesizes a retryable close if nothing else
//     resolves the attempt first.
//   - `onerror`, which carries no diagnostic detail by design and, across the
//     `WebSocketLike` seam, is not guaranteed to be followed by `onclose` the
//     way a real browser follows it. `onerror` now finishes the attempt
//     itself rather than trusting a close that may never come.
//
// Both routes end at `#finish`, the same funnel every other close goes
// through, so `onClose` still fires exactly once no matter which of these
// fires first or whether a genuine close follows.

import type { ConnectionHelloPayload, ClientFramePayloadMap, ClientToServerFrameType, ServerFrame } from '../protocol/frames.js';
import type { ErrorPayload, Frame } from '../protocol/envelope.js';
import type { CancelTimer, Clock, ScheduleTimer } from '../presence/time.js';
import { systemClock, systemTimers } from '../presence/time.js';
import { buildCloseInfo } from './close.js';
import type { TransportCloseCause, TransportCloseInfo } from './close.js';
import { decodeFrame } from './decode.js';
import { HeartbeatMonitor } from './heartbeat.js';
import { consoleLogger, frameLogContext } from './logger.js';
import type { TransportLogger } from './logger.js';
import { PendingAckRegistry } from './pending-acks.js';
import type { AckOutcome } from './pending-acks.js';
import { CLOSE_CODE, createPlatformWebSocketFactory } from './socket.js';
import type { WebSocketFactory, WebSocketLike } from './socket.js';
import { createUlidGenerator } from './ulid.js';
import type { UlidGenerator } from './ulid.js';

/**
 * The client frame types that are answered by a generic `ack`.
 *
 * Excludes the two the transport sends itself and which get their own
 * dedicated reply instead: `connection.hello` is answered by `connection.ack`
 * and `system.heartbeat` by `system.pong` — neither carries a `ref`, so
 * neither can be ack-correlated. Encoding that in the type means a caller
 * cannot accidentally await an ack that will never arrive.
 */
export type AckableClientFrameType = Exclude<
  ClientToServerFrameType,
  'connection.hello' | 'system.heartbeat'
>;

/** The result of {@link WebSocketTransport.send}. */
export interface PendingSend {
  /**
   * The envelope ULID. Available synchronously and before the write, because
   * for `message.send` this IS the message's permanent id (D1, §9.3) — the
   * caller needs it to render optimistically and to replay the identical
   * frame after a reconnect.
   */
  readonly id: string;

  /** Always resolves, never rejects. See {@link AckOutcome}. */
  readonly ack: Promise<AckOutcome>;
}

export interface TransportConnectOptions {
  /**
   * Full WebSocket URL. On `chat-service-node` this is
   * `wss://<host>/chat-services/v2/ws` — note `/chat-services/v2/ws`, not
   * `/v2/ws`, and note that no credential belongs in it: that endpoint reads
   * no query parameter, header or subprotocol, and authenticates entirely
   * from the `connection.hello` payload.
   */
  readonly url: string;

  /**
   * Credentials for the handshake. `protocolVersion` is filled in by the
   * transport, which owns version negotiation (§7.5).
   *
   * The server enforces a 10 second deadline from socket open to a valid
   * `connection.hello`, which is why the transport writes it itself on open
   * rather than waiting to be asked.
   */
  readonly hello: Omit<ConnectionHelloPayload, 'protocolVersion'>;
}

export interface WebSocketTransportOptions {
  /** Defaults to the platform `WebSocket` global, read lazily at connect time. */
  readonly webSocket?: WebSocketFactory;

  /** Defaults to `Date.now`. */
  readonly now?: Clock;

  /** Defaults to `setTimeout`. Injected so every timeout in this module is testable without sleeping. */
  readonly schedule?: ScheduleTimer;

  /** Defaults to a `console.warn`-backed logger. Never receives credential material. */
  readonly logger?: TransportLogger;

  /** Highest protocol version this client speaks. Defaults to 1. */
  readonly protocolVersion?: number;

  /** How long a client frame waits for its `ack`. Defaults to {@link DEFAULT_ACK_TIMEOUT_MS}. */
  readonly ackTimeoutMs?: number;

  /**
   * Deadline from `connect()` to the socket reporting open. Defaults to
   * {@link DEFAULT_CONNECT_TIMEOUT_MS}.
   *
   * Covers the one gap `onOpen`/`onError`/`onClose` cannot: a socket that
   * simply never calls back. See the file header.
   */
  readonly connectTimeoutMs?: number;

  /** Idle time between heartbeats. */
  readonly heartbeatIntervalMs?: number;

  /** Grace period for a `system.pong`. */
  readonly heartbeatTimeoutMs?: number;

  /** The socket is open and `connection.hello` has been written. */
  readonly onOpen?: () => void;

  /** A valid inbound frame arrived. Never called for `ack`. */
  readonly onFrame?: (frame: ServerFrame) => void;

  /** The connection ended. Fires exactly once per opened socket. */
  readonly onClose?: (info: TransportCloseInfo) => void;
}

/**
 * Default ack deadline. The PRD fixes no number here (Open Question 9
 * territory); 10s is comfortably longer than a slow mobile round trip and
 * short enough that a lost frame surfaces while the user still remembers
 * sending it.
 */
export const DEFAULT_ACK_TIMEOUT_MS = 10_000;

/**
 * Default connect deadline. Matches the other 10s deadlines in this module
 * ({@link DEFAULT_ACK_TIMEOUT_MS}, heartbeat's `DEFAULT_HEARTBEAT_TIMEOUT_MS`
 * in heartbeat.ts): comfortably longer than a slow mobile round trip, and
 * short enough that a genuinely unreachable server — down, or a network with
 * no route to it — surfaces as a visible retry (the state machine moves to
 * `reconnecting` and backs off per §8.2) rather than leaving the state
 * machine parked in `connecting` for however long the OS's own TCP timeout
 * happens to be, which on some platforms is tens of seconds to several
 * minutes with zero WebSocket-level events in the meantime.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** The protocol version this client implements (§7.5). */
export const DEFAULT_PROTOCOL_VERSION = 1;

/** Outcome of one attempted socket write. */
type WriteResult = 'written' | 'notSerializable' | 'writeFailed';

export class WebSocketTransport {
  readonly #createSocket: WebSocketFactory;
  readonly #schedule: ScheduleTimer;
  readonly #now: Clock;
  readonly #logger: TransportLogger;
  readonly #protocolVersion: number;
  readonly #connectTimeoutMs: number;
  readonly #nextUlid: UlidGenerator;
  readonly #pending: PendingAckRegistry;
  readonly #heartbeat: HeartbeatMonitor;

  readonly #onOpen: (() => void) | undefined;
  readonly #onFrame: ((frame: ServerFrame) => void) | undefined;
  readonly #onClose: ((info: TransportCloseInfo) => void) | undefined;

  #socket: WebSocketLike | null = null;
  #open = false;
  #closeEmitted = false;
  #cause: TransportCloseCause = 'peer';
  #protocolError: ErrorPayload | null = null;
  #negotiatedProtocolVersion: number | null = null;

  /** Cancels the deadline armed by `connect()`. `null` once resolved (open, error, or close). */
  #cancelConnectDeadline: CancelTimer | null = null;

  constructor(options: WebSocketTransportOptions = {}) {
    const schedule = options.schedule ?? systemTimers;

    this.#createSocket = options.webSocket ?? createPlatformWebSocketFactory();
    this.#schedule = schedule;
    this.#now = options.now ?? systemClock;
    this.#logger = options.logger ?? consoleLogger;
    this.#protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.#onOpen = options.onOpen;
    this.#onFrame = options.onFrame;
    this.#onClose = options.onClose;

    this.#nextUlid = createUlidGenerator({ now: this.#now });

    this.#pending = new PendingAckRegistry({
      schedule,
      timeoutMs: options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
    });

    this.#heartbeat = new HeartbeatMonitor({
      schedule,
      ...(options.heartbeatIntervalMs === undefined ? {} : { intervalMs: options.heartbeatIntervalMs }),
      ...(options.heartbeatTimeoutMs === undefined ? {} : { timeoutMs: options.heartbeatTimeoutMs }),
      sendHeartbeat: () => this.#sendHeartbeat(),
      onDeadPeer: () => this.#handleDeadPeer(),
    });
  }

  /** True between `onOpen` and `onClose`. */
  get isOpen(): boolean {
    return this.#open;
  }

  /** Frames still awaiting an `ack`. */
  get pendingAckCount(): number {
    return this.#pending.size;
  }

  /**
   * The version agreed in `connection.ack.d.protocolVersion` — `min(client
   * max, server max)` per §7.5 — or `null` before the handshake completes.
   *
   * Note this is not the `v` on inbound frames: the server stamps its own
   * constant there, not the negotiated value.
   */
  get negotiatedProtocolVersion(): number | null {
    return this.#negotiatedProtocolVersion;
  }

  /**
   * Opens a socket and writes `connection.hello` as soon as it is open.
   *
   * Calling this while already connected tears the previous connection down
   * first — which settles its pending acks and fires `onClose` — so no
   * connection is ever abandoned silently.
   *
   * @throws whatever the `WebSocketFactory` throws; the default one throws
   *   when the environment has no `WebSocket` global.
   */
  connect(options: TransportConnectOptions): void {
    // Close the socket being superseded before `#finish` tears down our
    // bookkeeping, exactly as `close()` does. `#finish` only detaches handlers
    // and nulls the handle — without this the old socket is never sent a close
    // frame and stays open, authenticated, server-side until the peer's
    // liveness reaper collects it 25-50s later. T8 calls `connect()` on every
    // reconnect attempt, so on a flaky network these accumulate per client.
    if (this.#socket !== null) {
      this.#tryClose(this.#socket, CLOSE_CODE.NORMAL, 'superseded by a new connection');
    }

    this.#finish({
      code: CLOSE_CODE.NORMAL,
      reason: 'superseded by a new connection',
      wasClean: true,
      cause: 'local',
    });

    // `#finish` above fires `onClose`, and reconnecting from `onClose` is
    // exactly what T8 does — so by the time control returns here, a re-entrant
    // `connect()` may already have installed a socket. Overwriting the handle
    // would leave that socket open with nobody holding it and its handlers
    // still attached, and its eventual close event would tear down the
    // connection this call is about to establish.
    const displaced = this.#socket;
    if (displaced !== null) {
      this.#detach(displaced);
      this.#tryClose(displaced, CLOSE_CODE.NORMAL, 'superseded by a new connection');
    }

    // Cleared before the factory runs, so a factory that throws leaves this
    // transport genuinely socket-less rather than holding a detached handle
    // that a later `close()` would report a second close event for.
    this.#socket = null;
    this.#open = false;
    this.#closeEmitted = false;
    this.#cause = 'peer';
    this.#protocolError = null;
    this.#negotiatedProtocolVersion = null;

    const socket = this.#createSocket(options.url);
    this.#socket = socket;

    socket.onopen = () => this.#handleOpen(options.hello);
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onerror = () => {
      // Carries no diagnostic detail by design in every browser. In a real
      // browser this is reliably followed by `onclose`, but `WebSocketLike`
      // (socket.ts) is a seam meant for non-browser adapters too, and nothing
      // guarantees one of those delivers a close after an error. Finishing
      // right here — rather than trusting a close that may never come — is
      // what keeps an error from stranding the connection: `onClose` is T8's
      // only route to a retry (see the file header), so an error that never
      // reaches it would leave `connecting` parked forever.
      this.#logger.warn('transport: socket error');
      this.#cause = 'peer';
      this.#tryClose(socket, CLOSE_CODE.ABNORMAL, 'socket error');
      this.#finish({
        code: CLOSE_CODE.ABNORMAL,
        reason: 'socket error',
        wasClean: false,
        cause: 'peer',
      });
    };
    socket.onclose = (event) => {
      this.#finish({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        cause: this.#cause,
      });
    };

    // The backstop for a socket that never calls back at all — see the file
    // header. Cancelled the moment anything else resolves the attempt:
    // `#handleOpen` cancels it on success, `#finish` cancels it on every close
    // path (including the two above), so by the time this fires the attempt
    // is guaranteed still unresolved.
    this.#cancelConnectDeadline = this.#schedule(() => {
      this.#cancelConnectDeadline = null;
      this.#handleConnectTimeout();
    }, this.#connectTimeoutMs);
  }

  /**
   * Sends one ack-tracked client frame.
   *
   * Never throws and never returns a promise that hangs: a send attempted
   * with no open socket resolves immediately as `disconnected`, which is
   * exactly the §8.4 signal to enqueue it for replay.
   *
   * `replayId` re-sends a frame under an id that was already minted. Replay
   * MUST reuse the original ULID: for `message.send` that id IS the permanent
   * message id (D1), and the server dedupes on it — minting a fresh one turns
   * a replayed message into a second, distinct message, which is precisely
   * the double-send §9.3 exists to prevent. Omit it for a first send.
   */
  send<T extends AckableClientFrameType>(
    t: T,
    d: ClientFramePayloadMap[T],
    replayId?: string,
  ): PendingSend {
    const id = replayId ?? this.#nextUlid();
    const socket = this.#socket;

    if (!this.#open || socket === null) {
      return { id, ack: Promise.resolve<AckOutcome>({ status: 'disconnected', close: null }) };
    }

    // Register before writing, so an ack cannot arrive before there is
    // anything to correlate it against.
    const ack = this.#pending.register(id);
    const result = this.#write(socket, this.#envelope(t, id, d));

    if (result === 'notSerializable') {
      this.#pending.settle(id, {
        status: 'rejected',
        error: {
          code: 'VALIDATION_FAILED',
          message: `frame "${t}" could not be serialized`,
          retryable: false,
        },
      });
    } else if (result === 'writeFailed') {
      // The frame never reached the wire, so it is unsent rather than
      // rejected — `disconnected` routes it to the offline queue.
      this.#pending.settle(id, { status: 'disconnected', close: null });
    }

    return { id, ack };
  }

  /**
   * Closes the connection.
   *
   * The close is reported immediately rather than when the peer confirms it:
   * a closing handshake can hang indefinitely against a peer that is already
   * gone, and every in-flight send must settle now rather than waiting on it.
   * A late `onclose` from the socket is ignored.
   */
  close(): void {
    if (this.#socket === null) return;

    this.#cause = 'local';
    this.#tryClose(this.#socket, CLOSE_CODE.NORMAL, 'client disconnect');
    this.#finish({
      code: CLOSE_CODE.NORMAL,
      reason: 'client disconnect',
      wasClean: true,
      cause: 'local',
    });
  }

  // -------------------------------------------------------------------------
  // Socket events
  // -------------------------------------------------------------------------

  #handleOpen(hello: Omit<ConnectionHelloPayload, 'protocolVersion'>): void {
    this.#cancelConnectDeadlineTimer();

    const socket = this.#socket;
    if (socket === null) return;

    this.#open = true;

    const payload: ConnectionHelloPayload = { ...hello, protocolVersion: this.#protocolVersion };
    const frame = this.#envelope('connection.hello', this.#nextUlid(), payload);

    if (this.#write(socket, frame) !== 'written') {
      // The socket died between opening and our first write. There is no
      // connection to report as open, so go straight to closed.
      this.#tryClose(socket, CLOSE_CODE.NORMAL, 'hello failed');
      this.#finish({
        code: CLOSE_CODE.ABNORMAL,
        reason: 'connection.hello could not be written',
        wasClean: false,
        cause: 'peer',
      });
      return;
    }

    this.#onOpen?.();
  }

  #handleMessage(data: unknown): void {
    const result = decodeFrame(data);

    if (!result.ok) {
      // §14: dropped with a logged warning, never applied, and never fatal to
      // the connection — one bad frame must not cost the user their session.
      this.#logger.warn('transport: dropped malformed inbound frame', {
        ...frameLogContext(result.raw),
        path: result.path,
        reason: result.reason,
      });
      return;
    }

    this.#handleFrame(result.frame);
  }

  #handleFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case 'ack': {
        const outcome: AckOutcome = frame.d.ok
          ? { status: 'acked', frame }
          : { status: 'rejected', error: frame.d.error };

        if (!this.#pending.settle(frame.ref, outcome)) {
          // A ref this client never sent, or one that already timed out.
          this.#logger.warn('transport: ack for an unknown frame', frameLogContext(frame));
        }
        // Not forwarded: correlation is this layer's job, and the outcome
        // carries the whole frame to whoever sent it.
        return;
      }

      case 'error': {
        this.#handleErrorFrame(frame.d, frame.ref);
        break;
      }

      case 'connection.ack': {
        this.#negotiatedProtocolVersion = frame.d.protocolVersion;
        // Only now, not on open: the server rejects `system.heartbeat` from
        // an unauthenticated connection, so beating before the ack would
        // manufacture spurious AUTH_INVALID errors.
        this.#heartbeat.start();
        break;
      }

      case 'system.pong': {
        this.#heartbeat.notePong();
        break;
      }

      default:
        break;
    }

    this.#onFrame?.(frame);
  }

  /**
   * An `error` frame is either about one in-flight frame or about the
   * connection. The first settles that frame's ack — without this, a
   * protocol-level rejection of a `message.send` hangs until its timeout,
   * because the server answers business failures with a rejecting `ack` but
   * protocol failures with an `error`.
   *
   * Anything else is connection-level and is remembered for the close event.
   * That covers a `ref`-less error, and an error whose `ref` points at
   * `connection.hello` — hello is not ack-tracked, so it never matches.
   */
  #handleErrorFrame(error: ErrorPayload, ref: string | undefined): void {
    if (ref !== undefined && this.#pending.settle(ref, { status: 'rejected', error })) return;

    this.#protocolError = error;

    if (error.code === 'PROTOCOL_VERSION_UNSUPPORTED') {
      // §7.5: surface as non-retryable so T8 suspends rather than retry-looping
      // against a version it cannot speak. Latched on the code rather than on
      // `retryable`, because no other non-retryable code is grounds for giving
      // up on the whole connection — a rejected frame is not a dead session.
      this.#cause = 'versionUnsupported';
    }
  }

  #handleDeadPeer(): void {
    const socket = this.#socket;
    if (socket === null) return;

    this.#cause = 'heartbeatTimeout';
    this.#tryClose(socket, CLOSE_CODE.NORMAL, 'heartbeat timeout');

    // Synthesized rather than awaited. A peer that stopped answering will
    // very likely never send a close frame either, and waiting for one would
    // leave T8 believing it is connected for as long as the OS holds the
    // socket open. 1006 is exactly the right code: no close frame was
    // received.
    this.#finish({
      code: CLOSE_CODE.ABNORMAL,
      reason: 'no system.pong within the heartbeat deadline',
      wasClean: false,
      cause: 'heartbeatTimeout',
    });
  }

  /**
   * `connectTimeoutMs` elapsed with nothing else having resolved the attempt
   * — the "server down" / "no route to host" shape described in the file
   * header, where a socket calls back nothing at all.
   *
   * Mirrors `#handleDeadPeer`: attempt a clean close of the socket this
   * transport is abandoning, then synthesize the retryable close that
   * `#finish` guarantees fires exactly once. `cause: 'peer'` — from T8's
   * point of view this is indistinguishable from the network simply not
   * answering, which is exactly what it is.
   */
  #handleConnectTimeout(): void {
    const socket = this.#socket;
    if (socket === null) return;

    this.#cause = 'peer';
    this.#tryClose(socket, CLOSE_CODE.ABNORMAL, 'connect timed out');
    this.#finish({
      code: CLOSE_CODE.ABNORMAL,
      reason: `socket did not open within ${String(this.#connectTimeoutMs)}ms`,
      wasClean: false,
      cause: 'peer',
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #envelope<T extends ClientToServerFrameType>(
    t: T,
    id: string,
    d: ClientFramePayloadMap[T],
  ): Frame<ClientFramePayloadMap[T]> & { t: T } {
    return { v: this.#protocolVersion, t, id, ts: this.#now(), d };
  }

  #sendHeartbeat(): void {
    const socket = this.#socket;
    if (!this.#open || socket === null) return;

    // Not ack-tracked: answered by `system.pong`, which carries no `ref`.
    this.#write(socket, this.#envelope('system.heartbeat', this.#nextUlid(), {}));
  }

  /** Serializes and writes one frame, classifying whichever half failed. */
  #write(socket: WebSocketLike, frame: unknown): WriteResult {
    let text: string;

    try {
      text = JSON.stringify(frame);
    } catch {
      this.#logger.warn('transport: outbound frame could not be serialized', frameLogContext(frame));
      return 'notSerializable';
    }

    try {
      socket.send(text);
      return 'written';
    } catch {
      this.#logger.warn('transport: socket write failed', frameLogContext(frame));
      return 'writeFailed';
    }
  }

  /**
   * Unhooks every handler, so a socket this transport has abandoned can never
   * act on the connection that replaced it. Every path that abandons a socket
   * goes through here.
   */
  #detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  /** No leaked timer: safe to call whether or not one is currently armed. */
  #cancelConnectDeadlineTimer(): void {
    this.#cancelConnectDeadline?.();
    this.#cancelConnectDeadline = null;
  }

  /** A dying socket may throw from `close()`; that must not mask the real failure. */
  #tryClose(socket: WebSocketLike, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      this.#logger.warn('transport: socket close failed');
    }
  }

  /**
   * The single funnel every close path runs through, so the invariants hold
   * no matter which one fired: pending acks always settle, the heartbeat
   * always stops, handlers are always detached, and `onClose` fires exactly
   * once.
   */
  #finish(input: {
    code: number;
    reason: string;
    wasClean: boolean;
    cause: TransportCloseCause;
  }): void {
    const socket = this.#socket;
    if (socket === null || this.#closeEmitted) return;

    this.#cancelConnectDeadlineTimer();
    this.#closeEmitted = true;
    this.#open = false;
    this.#socket = null;
    this.#heartbeat.stop();

    // Detached so a late event from an already-reported socket cannot
    // resurrect a connection this transport has finished with.
    this.#detach(socket);

    const info = buildCloseInfo({ ...input, protocolError: this.#protocolError });

    // Before `onClose`, so the registry is already drained if T8 inspects it.
    // The promises themselves resolve on the microtask queue either way.
    this.#pending.settleAll({ status: 'disconnected', close: info });

    this.#onClose?.(info);
  }
}
