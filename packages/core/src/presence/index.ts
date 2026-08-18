// Presence module barrel — PRD §7.3 (typing/presence frames), §9.5 (read
// watermarks), §6.4 (`typing`, `unreadCount`, `readWatermarks`), §6.5 (the
// `typing` and `presenceUpdate` events).
//
// This module is the pure logic between inbound frames and the store. It owns
// no socket and no I/O: `PresenceCoordinator.handleFrame` takes an
// already-validated frame (D4) and outbound work leaves as `OutboundIntent`
// objects handed to an injected sink. Transport (T7) and connection (T8) own
// the actual reads and writes, and every timeout here runs on an injected
// timer, so the whole module is testable without a WebSocket or a sleep.
//
// `PresenceCoordinator` is the seam; `TypingController`, `PresenceRegistry`,
// and `WatermarkTracker` are reachable through it and exported here for direct
// use. As with state/ and protocol/, this barrel decides what *this module*
// exposes to the rest of core — T13's src/index.ts decides what leaves the
// package.

export { PresenceCoordinator } from './controller.js';
export type { PresenceCoordinatorOptions } from './controller.js';

export { PRESENCE_INTENT_TYPES } from './intents.js';
export type { IntentSink, OutboundIntent, PresenceIntentType } from './intents.js';

export { PresenceRegistry } from './presence.js';
export type { PresenceRegistryOptions } from './presence.js';

export { systemClock, systemTimers } from './time.js';
export type { CancelTimer, Clock, ScheduleTimer } from './time.js';

export {
  DEFAULT_REMOTE_TYPING_TIMEOUT_MS,
  DEFAULT_TYPING_IDLE_MS,
  DEFAULT_TYPING_START_INTERVAL_MS,
  TypingController,
  assertTypingTimings,
} from './typing.js';
export type { TypingControllerOptions, TypingTimings } from './typing.js';

export { WatermarkTracker, maxWatermark } from './watermarks.js';
export type { WatermarkTrackerOptions } from './watermarks.js';

// Test support: a hand-driven Clock/ScheduleTimer pair. Exported so consumers
// integrating against this module can drive its timeouts deterministically
// rather than sleeping.
export { ManualTimers } from './manual-timers.js';
