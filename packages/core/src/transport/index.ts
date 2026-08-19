// Public surface of the transport module — task T7.

export { Transport, type TransportEventMap, type TransportOptions } from './transport.js';
export { encodeFrame, decodeFrame } from './frame-codec.js';
export {
  HeartbeatScheduler,
  type HeartbeatSchedulerOptions,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from './heartbeat.js';
export {
  WS_READY_STATE,
  defaultWebSocketFactory,
  type WebSocketLike,
  type WebSocketFactory,
} from './websocket-like.js';
export { SimpleEmitter, type Unsubscribe } from './simple-emitter.js';
