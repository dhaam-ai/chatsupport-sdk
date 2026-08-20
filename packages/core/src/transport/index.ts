// Transport module barrel — PRD §7 (wire protocol), §7.5 (version
// negotiation), §12.11 (the v1 heartbeat/reconnect gaps this closes), §14
// (validate inbound, never log credentials).
//
// `WebSocketTransport` is the seam. It owns a socket and moves validated
// frames across it; it does not own `ConnectionState`, reconnect scheduling,
// session state, or auth — those are T8's, built on backoff/. Everything else
// exported here is either a type T8 needs to consume that seam, or test
// support for driving it without a network.
//
// As with protocol/, state/ and presence/, this barrel decides what *this
// module* exposes to the rest of core. T13's src/index.ts decides what leaves
// the package.

export {
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_PROTOCOL_VERSION,
  WebSocketTransport,
} from './transport.js';
export type {
  AckableClientFrameType,
  PendingSend,
  TransportConnectOptions,
  WebSocketTransportOptions,
} from './transport.js';

export { buildCloseInfo } from './close.js';
export type { CloseInfoInput, TransportCloseCause, TransportCloseInfo } from './close.js';

export { decodeFrame } from './decode.js';
export type { FrameDecodeFailure, FrameDecodeResult } from './decode.js';

export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  HeartbeatMonitor,
} from './heartbeat.js';
export type { HeartbeatMonitorOptions } from './heartbeat.js';

export { consoleLogger, frameLogContext, silentLogger } from './logger.js';
export type { TransportLogger } from './logger.js';

export { PendingAckRegistry } from './pending-acks.js';
export type { AckOutcome, PendingAckRegistryOptions } from './pending-acks.js';

export { CLOSE_CODE, createPlatformWebSocketFactory } from './socket.js';
export type {
  SocketCloseEvent,
  SocketMessageEvent,
  WebSocketFactory,
  WebSocketLike,
} from './socket.js';

export { createUlidGenerator } from './ulid.js';
export type { RandomSource, UlidGenerator, UlidGeneratorOptions } from './ulid.js';

// Test support: a hand-driven `WebSocketLike` and a factory that records every
// socket it makes. Exported for the same reason presence/ exports
// `ManualTimers` — consumers integrating against this transport should be able
// to drive it deterministically rather than standing up a server.
export { StubSocketFactory, StubWebSocket } from './stub-socket.js';
export type { StubCloseCall } from './stub-socket.js';
