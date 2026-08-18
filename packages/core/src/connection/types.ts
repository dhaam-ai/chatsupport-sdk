// The seams this module consumes, named as interfaces rather than taken as
// concrete classes.
//
// `ConnectionTransport` is exactly the slice of `WebSocketTransport` (T7) the
// controller uses. Depending on the interface rather than the class buys two
// things that matter here:
//
//   - A test can hand the controller a recording fake and assert on policy
//     decisions — "did it schedule a retry, with what delay" — without a
//     socket, a JSON codec, or an ack round trip in the picture.
//   - The socket-lifecycle tests that DO need the real thing (reconnect from
//     inside `onClose`, superseded sockets, close-code handling) construct a
//     real `WebSocketTransport` over `StubSocketFactory`. Two genuinely
//     different adapters, so the seam is real rather than hypothetical.
//
// The transport is created through a factory rather than passed in because
// its three callbacks are constructor options: the controller must be wired
// into the transport at construction, and nothing outside the controller can
// supply those handlers.

import type { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import type { ScheduleTimer } from '../presence/time.js';
import type { ClientFramePayloadMap, ServerFrame } from '../protocol/index.js';
import type { ChatStore } from '../state/index.js';
import type {
  AckOutcome,
  AckableClientFrameType,
  PendingSend,
  TransportCloseInfo,
  TransportConnectOptions,
  WebSocketTransportOptions,
} from '../transport/index.js';
import { WebSocketTransport } from '../transport/index.js';

/** The slice of `WebSocketTransport` the connection state machine drives. */
export interface ConnectionTransport {
  /** True between `onOpen` and `onClose`. */
  readonly isOpen: boolean;

  /** Opens a socket and writes `connection.hello`. Supersedes any existing socket. */
  connect(options: TransportConnectOptions): void;

  /** Sends one ack-tracked client frame. Never throws. */
  send<T extends AckableClientFrameType>(t: T, d: ClientFramePayloadMap[T]): PendingSend;

  /** Closes the connection. Reported as a `local` close. */
  close(): void;
}

/** What the controller registers with the transport it creates. */
export interface TransportHandlers {
  /** Socket open AND `connection.hello` written — the one `connecting → authenticating` edge. */
  readonly onOpen: () => void;

  /** Every valid inbound frame except `ack`. */
  readonly onFrame: (frame: ServerFrame) => void;

  /** Fires exactly once per opened socket. */
  readonly onClose: (info: TransportCloseInfo) => void;
}

/** Builds the transport the controller will drive, wired to its handlers. */
export type TransportFactory = (handlers: TransportHandlers) => ConnectionTransport;

/**
 * Builds a {@link TransportFactory} over the real {@link WebSocketTransport}.
 *
 * The handler options are omitted from the input because the controller owns
 * them — passing your own would silently detach the state machine from its
 * socket, which is exactly the bug this type prevents at compile time.
 */
export function createWebSocketTransportFactory(
  options: Omit<WebSocketTransportOptions, 'onOpen' | 'onFrame' | 'onClose'> = {},
): TransportFactory {
  return (handlers) => new WebSocketTransport({ ...options, ...handlers });
}

/**
 * A token and, when the host knows it, how long it is good for.
 *
 * §6.1 fixes the public config field as `getToken: () => Promise<string>`, and
 * a bare `string` is accepted here precisely so that callback is assignable to
 * {@link TokenProvider} with no adapter. But §10.4 requires a proactive
 * refresh "at 80% of the token's `expiresIn`", and a bare string does not
 * carry one.
 *
 * Rather than have a *connection state machine* decode a JWT's `exp` claim —
 * base64url, UTF-8, and a silent fallback to no-refresh whenever the parse
 * fails — the lifetime is an explicit, optional part of this seam. §10.3's
 * token endpoint already returns `{ accessToken, expiresIn }`, so the host (or
 * T13, assembling `ChatClient`) has the number without parsing anything. When
 * `expiresInMs` is absent, no proactive refresh is scheduled and core falls
 * back to the reactive `AUTH_EXPIRED` path (§10.4), which is correct rather
 * than merely tolerable.
 */
export interface AuthToken {
  readonly token: string;

  /** Milliseconds until expiry. Omit when unknown — see the note above. */
  readonly expiresInMs?: number;
}

/**
 * Supplies credentials. Called before the first connect, before every
 * reconnect attempt, and on every refresh (§10.4).
 *
 * §6.1's `() => Promise<string>` satisfies this exactly.
 */
export type TokenProvider = () => Promise<string | AuthToken> | string | AuthToken;

/**
 * A hole in replayed history (D2).
 *
 * `seq` is the ordering key and the gap-detection signal: "a `seq` jump means
 * refetch". This is the structured form of that jump, handed to whoever owns
 * message history so it can refetch — the `error` event tells the *app* that
 * history is incomplete, this tells *core* what to do about it.
 */
export interface ResumeGap {
  /** The `resumeFrom` this connection asked to resume after, or `null` on a first connect. */
  readonly resumeFrom: number | null;

  /** The `seq` that was expected next. */
  readonly expectedSeq: number;

  /** The `seq` actually seen, which is greater than `expectedSeq`. */
  readonly receivedSeq: number;

  /** `connection.ack.d.seq` — the anchor the server says this connection is current as of. */
  readonly ackSeq: number;
}

/** Everything the controller needs. Timers and the clock are injected; no global is reachable. */
export interface ConnectionControllerOptions {
  /** Where `connectionState`, `lastError`, and the §6.5 events go. */
  readonly store: ChatStore;

  /** Full WebSocket URL. No credential belongs in it — see `TransportConnectOptions`. */
  readonly url: string;

  /** Tenant identification (§10.2). Sent in `connection.hello`. */
  readonly publishableKey: string;

  /** Credentials (§10.4). */
  readonly getToken: TokenProvider;

  /** Builds the transport. Defaults to a real `WebSocketTransport`. */
  readonly createTransport?: TransportFactory;

  /** Defaults to `systemTimers`. Every timer in this module goes through it. */
  readonly schedule?: ScheduleTimer;

  /** Reconnect delays for transport failures. Retries forever (§8.2). */
  readonly transportBackoff?: TransportBackoffPolicy;

  /** Escalation policy for auth failures. Suspends after N consecutive (§10.6). */
  readonly authBackoff?: AuthBackoffPolicy;

  /**
   * The next handler in the inbound frame chain — presence, messages, session.
   *
   * Called for every frame the controller does not consume outright, and once
   * per replayed frame, in `seq` order. Mirrors
   * `PresenceCoordinator.handleFrame`, which returns `false` for frames it
   * does not own so handlers chain.
   */
  readonly onFrame?: (frame: ServerFrame) => void;

  /** Called when replay left a hole (D2). See {@link ResumeGap}. */
  readonly onResumeGap?: (gap: ResumeGap) => void;

  /**
   * Fraction of a token's lifetime at which to refresh proactively.
   * Defaults to 0.8 (§10.4).
   */
  readonly refreshAtFraction?: number;
}

export type { AckOutcome, PendingSend, TransportCloseInfo };
