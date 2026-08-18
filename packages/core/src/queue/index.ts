// Queue module barrel — PRD §9 (durability, ordering, dedup, conflict
// resolution, retention) and §8.4 (in-flight sends during disconnect).
//
// `SendQueue` is the seam. It owns every user-originated `message.send` from
// the moment the user presses enter until the server acks it or it
// permanently fails; it does not own the connection, the socket, or message
// history. It reacts to the connection rather than driving it — `flush()` is
// how a reconnect tells it to try again.
//
// What leaves this module is deliberately small:
//
//   SendQueue          the queue itself
//   QueueTransport     the seam it writes through — see the note on its
//                      `sendWithId` method for why this is NOT
//                      `WebSocketTransport.send`
//   the entry types    what a caller gets back and must render
//   the retention      §9.6's bounds and their documented defaults
//   FaultStorageAdapter / FakeQueueTransport
//                      test support, for the same reason transport/ ships
//                      StubWebSocket and presence/ ships ManualTimers
//
// This module takes no `ChatStore`. Failures and acks are reported through
// callbacks rather than §6.5 events because T11 (messages/) owns emitting
// `message` and `messageAck`, and two modules emitting the same event would
// double-fire it. T13's src/index.ts decides what leaves the package and
// wires these callbacks to whichever events are right.
//
// One gap is reported rather than papered over: §6.4 has no state
// representation for a permanently-failed send. `ChatMessage.seq` being
// absent means "not yet server-confirmed", which describes a queued message
// and a dead one identically, so overloading it would make a message that
// will never arrive indistinguishable from one still in flight. Failures are
// therefore surfaced on this module's own channel — `onFailed` and
// `failed()` — until `ChatState` gains a field for them.

export {
  QueueNotRestoredError,
  SendQueue,
  StorageQueueError,
} from './send-queue.js';
export type { QueueTransport, RestoreReport, SendQueueOptions } from './send-queue.js';

export {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_STORAGE_KEY,
} from './types.js';
export type {
  FailedSend,
  QueuedSend,
  SendFailureReason,
  SendQueueRetention,
} from './types.js';

export { applyRetention, resolveRetention } from './retention.js';
export type { ResolvedRetention, RetentionSplit } from './retention.js';

export { QUEUE_SCHEMA_VERSION, decodeQueue, encodeQueue } from './codec.js';
export type { QueueDecodeResult } from './codec.js';

export { QueuePersistence } from './persistence.js';
export type { SaveOutcome } from './persistence.js';

// Test support: a storage adapter you can make fail on purpose, and a
// hand-driven transport that records which envelope `id` each write carried.
// Both exist because the interesting behaviour here is what the queue does
// when storage and the network misbehave.
export { FaultStorageAdapter } from './fault-storage.js';
export type { FaultStorageOptions } from './fault-storage.js';

export { DISCONNECTED, FakeQueueTransport, TIMEOUT, acked, rejected } from './fake-queue-transport.js';
export type { RecordedSend } from './fake-queue-transport.js';
