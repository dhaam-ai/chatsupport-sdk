// The transport layer — task T7. Owns exactly one WebSocket connection's raw
// lifecycle: opening it, framing outbound sends through the codec,
// validating and typing inbound data through the same codec, keepalive
// heartbeats, and reporting close/error as one uniform signal.
//
// Deliberately does NOT know about `connection.hello`, auth, sessions,
// reconnection policy, or resume — those are T8 (connection state machine)
// and T9 (auth), layered on top. This class only ever holds one connection
// at a time; reconnecting means calling `connect()` again after a `close`.

import { CORE_PROTOCOL_VERSION } from '../protocol/index.js';
import type { AnyFrame, FrameValidationFailure } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
import { decodeFrame, encodeFrame } from './frame-codec.js';
import { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS, HeartbeatScheduler } from './heartbeat.js';
import { SimpleEmitter } from './simple-emitter.js';
import type { Unsubscribe } from './simple-emitter.js';
import { defaultWebSocketFactory, WS_READY_STATE } from './websocket-like.js';
import type { WebSocketFactory, WebSocketLike } from './websocket-like.js';

export interface TransportEventMap {
  open: Record<string, never>;
  frame: AnyFrame;
  invalidFrame: { failure: FrameValidationFailure; raw: string };
  close: { code: number; reason: string };
  error: { message: string };
}

export interface TransportOptions {
  webSocketFactory?: WebSocketFactory;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export class Transport {
  readonly #wsFactory: WebSocketFactory;
  readonly #emitter = new SimpleEmitter<TransportEventMap>();
  readonly #heartbeat: HeartbeatScheduler;
  #ws: WebSocketLike | null = null;

  constructor(options: TransportOptions = {}) {
    this.#wsFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.#heartbeat = new HeartbeatScheduler({
      intervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      timeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      sendHeartbeat: () => this.#sendHeartbeatFrame(),
      onTimeout: () => this.#handleHeartbeatTimeout(),
    });
  }

  on<E extends keyof TransportEventMap>(event: E, handler: (payload: TransportEventMap[E]) => void): Unsubscribe {
    return this.#emitter.on(event, handler);
  }

  get isOpen(): boolean {
    return this.#ws !== null && this.#ws.readyState === WS_READY_STATE.OPEN;
  }

  /** Opens a new connection to `url`. Throws if a connection is already active — `close()` it first. */
  connect(url: string): void {
    if (this.#ws) {
      throw new Error('Transport: connect() called while a connection is already active — close() it first.');
    }

    const ws = this.#wsFactory(url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#heartbeat.start();
      this.#emitter.emit('open', {});
    };
    ws.onmessage = (event) => this.#handleMessage(event.data);
    ws.onclose = (event) => this.#handleClose(event.code, event.reason);
    ws.onerror = () => this.#emitter.emit('error', { message: 'WebSocket error' });
  }

  /**
   * Sends `frame` over the wire. Throws if the connection is not currently
   * open — queueing a send made while disconnected is T10's (offline queue)
   * responsibility, not this layer's.
   */
  send(frame: AnyFrame): void {
    if (!this.isOpen || !this.#ws) {
      throw new Error('Transport: cannot send — connection is not open.');
    }
    this.#ws.send(encodeFrame(frame));
  }

  /** Caller-initiated close. Produces the same `close` event a network drop would, with the code/reason given here. */
  close(code?: number, reason?: string): void {
    this.#heartbeat.stop();
    this.#ws?.close(code, reason);
  }

  #handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      this.#emitter.emit('invalidFrame', {
        failure: { ok: false, path: '', reason: 'expected a text frame, got binary data' },
        raw: '',
      });
      return;
    }

    const result = decodeFrame(data);
    if (!result.ok) {
      this.#emitter.emit('invalidFrame', { failure: result, raw: data });
      return;
    }

    if (result.frame.t === 'system.pong') {
      this.#heartbeat.notePong();
    }
    this.#emitter.emit('frame', result.frame);
  }

  #handleClose(code: number, reason: string): void {
    this.#heartbeat.stop();
    this.#ws = null;
    this.#emitter.emit('close', { code, reason });
  }

  #sendHeartbeatFrame(): void {
    if (!this.isOpen) return;
    this.send({ v: CORE_PROTOCOL_VERSION, t: 'system.heartbeat', id: generateUlid(), ts: Date.now(), d: {} });
  }

  /**
   * A missed pong is treated identically to a dropped connection: terminate
   * the socket and let the normal `close` flow fire. Callers get exactly one
   * signal to react to ("the connection is gone"), never a second "it went
   * stale" concept to handle separately.
   */
  #handleHeartbeatTimeout(): void {
    this.#ws?.close(4000, 'heartbeat timeout');
  }
}
