// Fake in-process WebSocket server — task T6, the protocol conformance
// target later tasks (T7 transport, T8 connection state machine, T9 auth)
// are built and tested against, per docs/spec/chat-sdk-v2-plan.md §3/§7.
//
// This is a REAL WebSocket server (via `ws`, listening on an ephemeral
// loopback port) — not an in-memory mock of one. Task T7's transport will
// hold a real `WebSocket` client connection to it, so what's being proven is
// the actual wire behavior (handshake, frame serialization, close codes),
// not just JS function calls standing in for them.
//
// Named risk this class exists to mitigate (plan.md §7, risk 2): "if [the
// fake server] is more permissive than the real server, core passes its
// tests and fails in production." So every inbound frame is run through the
// SAME `validateFrame` (protocol/validate.ts) a real backend implementation
// would need to satisfy — this harness cannot accidentally accept something
// the wire spec forbids.
//
// Deliberately low-level and fully scriptable: this class does not
// auto-respond to `connection.hello` with a `connection.ack`, does not
// auto-ack anything, and has no built-in session/state model. Tests decide
// exactly how to respond to each frame via `onFrame`. A smarter default
// responder would hide exactly the behavior T7/T8/T9's tests need to
// control precisely (timing of acks, injected errors, dropped connections).

import { WebSocketServer } from 'ws';
import type { RawData, WebSocket as RawWebSocket } from 'ws';

import type { AnyFrame, FrameValidationFailure } from '../../src/protocol/index.js';
import { validateFrame } from '../../src/protocol/index.js';
import { testUlid } from './test-ulid.js';

export interface FakeWsClient {
  readonly id: string;
  /** Sends `frame` to this client only. */
  send(frame: AnyFrame): void;
  /** Closes this client's connection. Defaults match a normal WS close (1000). */
  close(code?: number, reason?: string): void;
}

export interface FakeWsServerOptions {
  onConnect?: (client: FakeWsClient) => void;
  /** Fired for every frame that passed `validateFrame`. */
  onFrame?: (client: FakeWsClient, frame: AnyFrame) => void;
  /**
   * Fired when inbound data fails `validateFrame` — malformed JSON or JSON
   * that isn't a valid frame shape. Default behavior (if not overridden):
   * close the connection with code 1002 (protocol error), matching PRD
   * §14's "malformed frames are dropped ... not applied partially" applied
   * at the transport boundary rather than silently ignored.
   */
  onInvalidFrame?: (client: FakeWsClient, failure: FrameValidationFailure, raw: string) => void;
  onDisconnect?: (client: FakeWsClient, code: number, reason: string) => void;
}

const DEFAULT_INVALID_FRAME_CLOSE_CODE = 1002;

/**
 * A running fake server instance. Construct via {@link FakeWsServer.start},
 * never directly — the constructor requires values only available once the
 * underlying `ws` server has actually bound a port.
 */
export class FakeWsServer {
  readonly #wss: WebSocketServer;
  readonly #options: FakeWsServerOptions;
  readonly #clientsBySocket = new Map<RawWebSocket, FakeWsClient>();
  readonly #url: string;

  private constructor(wss: WebSocketServer, url: string, options: FakeWsServerOptions) {
    this.#wss = wss;
    this.#url = url;
    this.#options = options;
    this.#wss.on('connection', (socket) => this.#handleConnection(socket));
  }

  /** Starts a fake server on an ephemeral loopback port and resolves once it's listening. */
  static async start(options: FakeWsServerOptions = {}): Promise<FakeWsServer> {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', () => resolve());
      wss.once('error', reject);
    });
    const address = wss.address();
    if (typeof address === 'string' || address === null) {
      throw new Error('FakeWsServer: expected an AddressInfo from an ephemeral TCP listener');
    }
    return new FakeWsServer(wss, `ws://127.0.0.1:${address.port}`, options);
  }

  /** e.g. `ws://127.0.0.1:54213` — pass to a client's connect call. */
  get url(): string {
    return this.#url;
  }

  /** Currently connected clients, in connection order. */
  get clients(): readonly FakeWsClient[] {
    return [...this.#clientsBySocket.values()];
  }

  /** Sends `frame` to every currently connected client. */
  broadcast(frame: AnyFrame): void {
    for (const client of this.#clientsBySocket.values()) {
      client.send(frame);
    }
  }

  /** Stops accepting connections and closes every open one. Resolves once fully shut down. */
  async close(): Promise<void> {
    for (const client of this.#clientsBySocket.values()) {
      client.close(1001, 'server shutting down');
    }
    await new Promise<void>((resolve, reject) => {
      this.#wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  #handleConnection(socket: RawWebSocket): void {
    const client: FakeWsClient = {
      id: testUlid(),
      send: (frame) => socket.send(JSON.stringify(frame)),
      close: (code, reason) => socket.close(code, reason),
    };
    this.#clientsBySocket.set(socket, client);
    this.#options.onConnect?.(client);

    socket.on('message', (raw: RawData) => this.#handleMessage(client, socket, raw));

    socket.on('close', (code: number, reasonBuf: Buffer) => {
      this.#clientsBySocket.delete(socket);
      this.#options.onDisconnect?.(client, code, reasonBuf.toString('utf8'));
    });
  }

  #handleMessage(client: FakeWsClient, socket: RawWebSocket, raw: RawData): void {
    const text = rawDataToString(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.#rejectInvalidFrame(client, socket, { ok: false, path: '', reason: 'not valid JSON' }, text);
      return;
    }

    const result = validateFrame(parsed);
    if (!result.ok) {
      this.#rejectInvalidFrame(client, socket, result, text);
      return;
    }

    this.#options.onFrame?.(client, result.frame);
  }

  #rejectInvalidFrame(
    client: FakeWsClient,
    socket: RawWebSocket,
    failure: FrameValidationFailure,
    raw: string,
  ): void {
    if (this.#options.onInvalidFrame) {
      this.#options.onInvalidFrame(client, failure, raw);
      return;
    }
    socket.close(DEFAULT_INVALID_FRAME_CLOSE_CODE, failure.reason.slice(0, 123));
  }
}

/** `ws`'s message payload can be a string, Buffer, ArrayBuffer, or Buffer[] depending on config — normalize to a string. */
function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}
