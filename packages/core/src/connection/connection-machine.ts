// The connection state machine — task T8. PRD §8: the seven states (§8.1),
// full-jitter reconnect scheduling on top of T5's policies (§8.2),
// resume-on-reconnect via `seq` (§8.3, D2), and auth-failure escalation to
// `suspended` (§8.2, §10.6).
//
// Deliberately does NOT know how to obtain credentials — `buildHello` is
// injected. T9 (auth) will supply the real `getToken()`-backed
// implementation; this module only needs *something* that resolves to
// `{token, publishableKey}` or rejects to signal an auth-level failure. That
// keeps this task buildable and fully testable without T9 existing yet,
// matching plan.md's declared dependency (T8 needs T5, T7 — not T9).
//
// Also deliberately does NOT apply pushed frames to `ChatState` — every
// server push frame (fresh or replayed) is forwarded via the `frame` event
// for T11 (messages) / T12 (presence) to consume once they exist. "Applied
// to state," per §8.3's `resumeFrom` definition, is read here as "handed off
// to the next layer" — this class has no visibility into whether a
// consumer actually finished processing a frame, and D2's own `seq` field on
// `connection.ack` already gives the authoritative resume anchor directly
// (see `#handleAck`), so it never needs to infer that cursor from watching
// individual replayed frames itself.

import type {
  ConnectionAckPayload,
  ConnectionHelloPayload,
  ErrorFrame,
  ErrorPayload,
  FrameValidationFailure,
  ServerFrame,
} from '../protocol/index.js';
import { CORE_PROTOCOL_VERSION } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
// Type-only — erased at compile time (verbatimModuleSyntax), so this carries
// no runtime coupling to `state/` (T3), only a shared vocabulary: T3's
// `ChatState.connectionState` must hold exactly the values this class
// produces, and importing the type (not redeclaring the same seven-value
// union a second time) is what keeps that guarantee structural rather than
// "keep two lists in sync by hand."
import type { ConnectionState } from '../state/index.js';
import type { TransportEventMap, Unsubscribe } from '../transport/index.js';
import { SimpleEmitter, Transport } from '../transport/index.js';
import type { AuthBackoffConfig, AuthBackoffOutcome, BackoffConfig } from '../backoff/index.js';
import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';

export type { ConnectionState };

/**
 * What the injected `buildHello` resolves to — everything `connection.hello.d`
 * needs beyond what this class already owns (protocolVersion, resumeFrom).
 * Exactly one of `token`/`guestId` — mirrors `ConnectionHelloPayload`'s own
 * "exactly one" wire rule (protocol/validate.ts). T9 (auth) is what actually
 * decides which one, based on whether the host app supplied `getToken`.
 */
export type HelloCredentials =
  | { token: string; guestId?: never; publishableKey: string }
  | { token?: never; guestId: string; publishableKey: string };

export type BuildHello = () => Promise<HelloCredentials>;

export interface ConnectionMachineOptions {
  url: string;
  transport: Transport;
  buildHello: BuildHello;
  transportBackoffConfig?: BackoffConfig;
  authBackoffConfig?: AuthBackoffConfig;
}

export interface ConnectionMachineEventMap {
  stateChange: { state: ConnectionState; previous: ConnectionState };
  connected: { ack: ConnectionAckPayload };
  reconnecting: { attempt: number; delayMs: number };
  suspended: { reason: 'auth' | 'maxAttempts' };
  /**
   * Every server-originated frame this class doesn't consume itself — push
   * frames (fresh or replayed) AND generic `ack` frames (e.g. a
   * `message.send` ack) — in order, for T10/T11/T12 to correlate and apply.
   * `connection.ack` and `error`-during-authenticating are consumed here
   * and never forwarded.
   */
  frame: ServerFrame;
  /** A pushed frame's `seq` didn't immediately follow the last known one — D2's "a seq jump means refetch" signal. Reported, not acted on; T11 decides what to do about it. */
  sequenceGap: { expected: number; received: number };
  /**
   * Inbound data that failed `validateFrame` (T1) — malformed JSON, or JSON
   * that doesn't match any known frame shape. Forwarded rather than silently
   * dropped: without this, a real protocol mismatch against a real backend
   * (wrong field name, unexpected extra frame type, etc.) looks identical to
   * "the connection is just hanging," with zero diagnostic signal — found via
   * an actual external smoke test against the built package, not a unit test.
   */
  invalidFrame: { failure: FrameValidationFailure; raw: string };
}

/** Non-auth error codes treated as fatal-for-this-attempt rather than transport-retryable — judgment call, see this file's header. */
const NON_AUTH_TERMINAL_CODES = new Set(['PROTOCOL_VERSION_UNSUPPORTED', 'SESSION_NOT_FOUND', 'SESSION_CLOSED']);
const AUTH_ERROR_CODES = new Set(['AUTH_INVALID', 'AUTH_EXPIRED']);

const ACTIVE_STATES: ReadonlySet<ConnectionState> = new Set(['connecting', 'authenticating', 'connected', 'reconnecting']);

export class ConnectionMachine {
  readonly #url: string;
  readonly #transport: Transport;
  readonly #buildHello: BuildHello;
  readonly #transportBackoff: TransportBackoffPolicy;
  readonly #authBackoffConfig: AuthBackoffConfig | undefined;
  readonly #emitter = new SimpleEmitter<ConnectionMachineEventMap>();
  readonly #unsubscribers: Unsubscribe[] = [];

  #state: ConnectionState = 'idle';
  #authBackoff: AuthBackoffPolicy;
  #transportAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #lastSeq: number | undefined;
  /** Guards against a stale async `buildHello()`/handshake resolving after the state has already moved on (e.g. `disconnect()` was called mid-handshake). */
  #handshakeToken = 0;
  /**
   * Set immediately before this class calls `transport.close()` itself
   * (deliberate close: user disconnect, or dropping the socket to start a
   * reconnect after an auth failure/suspend). Without this, that close call
   * re-enters `#handleTransportClose` — synchronously, for a `MockWebSocket`
   * — and the transport-failure reconnect path would double-schedule on top
   * of whatever this class was already doing, using the wrong backoff
   * policy for the actual reason the connection went down.
   */
  #expectingClose = false;

  constructor(options: ConnectionMachineOptions) {
    this.#url = options.url;
    this.#transport = options.transport;
    this.#buildHello = options.buildHello;
    this.#transportBackoff = new TransportBackoffPolicy(options.transportBackoffConfig);
    this.#authBackoffConfig = options.authBackoffConfig;
    this.#authBackoff = new AuthBackoffPolicy(this.#authBackoffConfig);

    this.#unsubscribers.push(
      this.#transport.on('open', () => this.#handleTransportOpen()),
      this.#transport.on('frame', (frame) => this.#handleTransportFrame(frame)),
      this.#transport.on('invalidFrame', (payload) => this.#emitter.emit('invalidFrame', payload)),
      this.#transport.on('close', () => this.#handleTransportClose()),
    );
  }

  get state(): ConnectionState {
    return this.#state;
  }

  on<E extends keyof ConnectionMachineEventMap>(
    event: E,
    handler: (payload: ConnectionMachineEventMap[E]) => void,
  ): Unsubscribe {
    return this.#emitter.on(event, handler);
  }

  /** Starts (or restarts, from `suspended`/`closed`) a connection attempt. Throws if already active. */
  connect(): void {
    if (ACTIVE_STATES.has(this.#state)) {
      throw new Error(`ConnectionMachine: connect() called while already ${this.#state}.`);
    }
    // A fresh explicit connect() gets a fresh auth-failure budget — see this
    // file's header on why AuthBackoffPolicy doesn't self-reset out of
    // `suspended`.
    this.#authBackoff = new AuthBackoffPolicy(this.#authBackoffConfig);
    this.#transportAttempt = 0;
    this.#beginConnecting();
  }

  /** User-initiated, terminal (§8.1) — cancels any pending reconnect and closes the transport if open. */
  disconnect(): void {
    this.#handshakeToken += 1;
    this.#clearReconnectTimer();
    if (this.#transport.isOpen) {
      this.#expectingClose = true;
      this.#transport.close(1000, 'client disconnect');
    }
    this.#setState('closed');
  }

  /** Sends `frame` if currently connected. Throws otherwise — queueing while disconnected is T10's job, not this layer's. */
  send(frame: Parameters<Transport['send']>[0]): void {
    if (this.#state !== 'connected') {
      throw new Error(`ConnectionMachine: cannot send while ${this.#state}.`);
    }
    this.#transport.send(frame);
  }

  /** Tears down this instance: stops listening to the underlying transport and cancels any pending reconnect. Does not itself call `disconnect()` — callers that want a clean close should call that first. */
  destroy(): void {
    this.#clearReconnectTimer();
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  // ── Internal transitions ─────────────────────────────────────────────────

  #setState(next: ConnectionState): void {
    if (next === this.#state) return;
    const previous = this.#state;
    this.#state = next;
    this.#emitter.emit('stateChange', { state: next, previous });
  }

  #beginConnecting(): void {
    this.#setState('connecting');
    this.#transport.connect(this.#url);
  }

  #handleTransportOpen(): void {
    if (this.#state !== 'connecting') return; // stale event from a superseded attempt
    this.#setState('authenticating');
    void this.#sendHello();
  }

  async #sendHello(): Promise<void> {
    const token = ++this.#handshakeToken;
    let credentials: HelloCredentials;
    try {
      credentials = await this.#buildHello();
    } catch {
      if (token !== this.#handshakeToken) return; // superseded (e.g. disconnect() ran meanwhile)
      this.#handleAuthFailure();
      return;
    }
    if (token !== this.#handshakeToken || this.#state !== 'authenticating') return;

    const payload: ConnectionHelloPayload = {
      ...(credentials.token !== undefined ? { token: credentials.token } : { guestId: credentials.guestId }),
      publishableKey: credentials.publishableKey,
      protocolVersion: CORE_PROTOCOL_VERSION,
      ...(this.#lastSeq !== undefined ? { resumeFrom: this.#lastSeq } : {}),
    };
    this.#transport.send({ v: CORE_PROTOCOL_VERSION, t: 'connection.hello', id: generateUlid(), ts: Date.now(), d: payload });
  }

  #handleTransportFrame(frame: TransportEventMap['frame']): void {
    if (frame.t === 'connection.ack') {
      this.#handleAck(frame.d as ConnectionAckPayload);
      return;
    }
    if (frame.t === 'error') {
      this.#handleErrorFrame(frame as ErrorFrame);
      return;
    }
    if (this.#state !== 'connected') return; // any other frame type only makes sense once connected
    // `TransportEventMap['frame']` is typed as the full `AnyFrame` (both
    // directions) because `validateFrame` (T1) doesn't know which direction
    // it validated — a well-behaved server never actually sends a
    // client→server frame type over this socket, so narrowing to
    // `ServerFrame` here is a judgment call about real-world behavior, not
    // something the type system proves on its own.
    this.#forwardServerFrame(frame as ServerFrame);
  }

  #handleAck(ack: ConnectionAckPayload): void {
    if (this.#state !== 'authenticating') return;

    this.#authBackoff.recordSuccess();
    this.#transportAttempt = 0;
    this.#lastSeq = ack.seq;
    this.#setState('connected');
    this.#emitter.emit('connected', { ack });

    for (const replayed of ack.replay ?? []) {
      this.#forwardServerFrame(replayed, { skipGapCheck: true });
    }
  }

  #forwardServerFrame(frame: ServerFrame, opts: { skipGapCheck?: boolean } = {}): void {
    const seq = extractSeq(frame);
    if (seq !== undefined) {
      if (!opts.skipGapCheck && this.#lastSeq !== undefined && seq !== this.#lastSeq + 1) {
        this.#emitter.emit('sequenceGap', { expected: this.#lastSeq + 1, received: seq });
      }
      this.#lastSeq = Math.max(this.#lastSeq ?? seq, seq);
    }
    this.#emitter.emit('frame', frame);
  }

  #handleErrorFrame(errorFrame: ErrorFrame): void {
    if (this.#state !== 'authenticating') {
      // Once connected, this class's own reconnect/suspend logic no longer
      // applies to an `error` frame — but the frame itself is still real
      // information (e.g. AUTH_EXPIRED, which T9's reactive-refresh path
      // needs to see) and must not be silently dropped. Forward it like any
      // other post-connect server frame; T13 also surfaces it via
      // `ChatState.lastError`.
      if (this.#state === 'connected') this.#forwardServerFrame(errorFrame);
      return;
    }
    const error: ErrorPayload = errorFrame.d;

    if (AUTH_ERROR_CODES.has(error.code)) {
      this.#handleAuthFailure();
      return;
    }
    if (!error.retryable || NON_AUTH_TERMINAL_CODES.has(error.code)) {
      this.#suspend('maxAttempts');
      return;
    }
    // Retryable, non-auth (e.g. RATE_LIMITED) — treat like a transport-level hiccup for this attempt.
    this.#disconnectTransportQuietly();
    this.#scheduleTransportReconnect();
  }

  #handleAuthFailure(): void {
    const outcome: AuthBackoffOutcome = this.#authBackoff.recordFailure();
    if (outcome.action === 'suspend') {
      this.#suspend('auth');
      return;
    }
    this.#disconnectTransportQuietly();
    this.#scheduleReconnect(outcome.attempt, outcome.delayMs);
  }

  #handleTransportClose(): void {
    if (this.#expectingClose) {
      this.#expectingClose = false; // this class caused this close itself — the caller is already handling the transition
      return;
    }
    if (this.#state === 'closed' || this.#state === 'suspended') return; // already terminal — nothing to do
    this.#scheduleTransportReconnect();
  }

  #scheduleTransportReconnect(): void {
    const attempt = this.#transportAttempt;
    this.#transportAttempt += 1;
    const delayMs = this.#transportBackoff.nextDelay(attempt);
    this.#scheduleReconnect(attempt, delayMs);
  }

  #scheduleReconnect(attempt: number, delayMs: number): void {
    this.#setState('reconnecting');
    this.#emitter.emit('reconnecting', { attempt, delayMs });
    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#beginConnecting();
    }, delayMs);
  }

  #suspend(reason: 'auth' | 'maxAttempts'): void {
    this.#disconnectTransportQuietly();
    this.#setState('suspended');
    this.#emitter.emit('suspended', { reason });
  }

  #disconnectTransportQuietly(): void {
    this.#handshakeToken += 1;
    if (this.#transport.isOpen) {
      this.#expectingClose = true;
      this.#transport.close(1000, 'reconnecting');
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}

function extractSeq(frame: ServerFrame): number | undefined {
  const d = frame.d as { seq?: unknown };
  return typeof d.seq === 'number' ? d.seq : undefined;
}
