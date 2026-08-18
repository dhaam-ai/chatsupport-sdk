// Connection module barrel — PRD §8 (state machine), §10.4-10.6 (auth), §7.5
// (version negotiation), D2/D3 (§0.5).
//
// `ConnectionController` is the seam. It decides *when* to connect, retry,
// refresh, and give up; transport/ moves the bytes and backoff/ computes the
// delays. It owns `ChatState.connectionState` — nothing else in core writes
// that field — and it is the only place a `connection.hello` or a
// `connection.reauth` originates.
//
// What leaves this module is deliberately small:
//
//   ConnectionController      the state machine itself
//   the option/seam types     what a caller must supply to construct one
//   ConnectionStateMachine    the §8.1 table, reusable and independently
//                             testable, and the guard that makes an illegal
//                             transition throw rather than corrupt state
//   ResumeTracker             D2's seq bookkeeping, pure and side-effect-free
//   FakeTransport             test support, for the same reason transport/
//                             ships StubWebSocket
//
// As with protocol/, state/, presence/ and transport/, this barrel decides
// what *this module* exposes to the rest of core. T13's src/index.ts decides
// what leaves the package — in particular, `ChatClient.connect()`/
// `disconnect()` (§6.2) are expected to be thin forwards to the controller,
// and nothing below is public API by virtue of appearing here.

export {
  ConnectionAbortedError,
  ConnectionController,
  ConnectionSuspendedError,
  DEFAULT_REFRESH_AT_FRACTION,
} from './controller.js';

export {
  CONNECTION_TRANSITIONS,
  ConnectionStateMachine,
  IllegalConnectionTransitionError,
  canTransition,
} from './transitions.js';
export type { ConnectionTransitionListener } from './transitions.js';

export { ResumeTracker, frameSeq } from './resume.js';
export type { ResumeGapSpan } from './resume.js';

export { MissingTokenError, resolveToken } from './token.js';

export { createWebSocketTransportFactory } from './types.js';
export type {
  AuthToken,
  ConnectionControllerOptions,
  ConnectionTransport,
  ResumeGap,
  TokenProvider,
  TransportFactory,
  TransportHandlers,
} from './types.js';

// Test support: a hand-driven `ConnectionTransport` that reproduces the real
// transport's supersede-and-close semantics, so the state machine's policy can
// be driven without a socket.
export { FakeTransport } from './fake-transport.js';
export type { FakeSend } from './fake-transport.js';
