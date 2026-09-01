// @dhaam-ccrm/browser — the browser primitives every binding needs and none
// of them should own.
//
// Three rules shaped this package, and they are the reason it exists as its
// own dependency rather than as three more files inside `@dhaam-ccrm/react`:
//
//   No framework. Nothing here imports React, Vue, Angular, or any reactive
//   runtime. State is published through `getSnapshot()`/`subscribe()`, which
//   `useSyncExternalStore`, `shallowRef`, and `signal` all consume without
//   adaptation. The bindings on top are wiring; the state machines are here.
//
//   No `@dhaam-ccrm/core` dependency, not even type-only. `createReadTracker`
//   needs the message list, so it takes a `getMessages` callback and a
//   structural {@link TrackedMessage} that `ChatMessage` already satisfies.
//   A page adding voice recording pulls in no second copy of anything.
//
//   Nothing at module scope but declarations. Importing this registers no
//   listener, reads no `navigator`, and starts no timer — so it is safe to
//   import in a file that also renders on a server. Every browser global is
//   read inside a function, behind a `typeof` guard.
//
// The DOM half of `packages/js`, in other words: `js` deliberately compiles
// without the `DOM` lib so it stays Node-safe, which is exactly why these
// three could not live there.

// ---------------------------------------------------------------------------
// Voice recording — `getUserMedia` + `MediaRecorder` and its real failure set.
// ---------------------------------------------------------------------------
export {
  createVoiceRecorder,
  classifyMediaError,
  probeVoiceSupport,
  DEFAULT_AMPLITUDE_INTERVAL_MS,
  DEFAULT_VOICE_MIME_TYPES,
} from './voice-recorder.js';
export type {
  VoiceRecorder,
  VoiceRecorderError,
  VoiceRecorderErrorCode,
  VoiceRecorderOptions,
  VoiceRecorderState,
  VoiceRecording,
  VoiceSupport,
} from './voice-recorder.js';

// ---------------------------------------------------------------------------
// Waveforms — decode a voice note into bar heights, closing the AudioContext.
// ---------------------------------------------------------------------------
export {
  computeWaveformPeaks,
  decodeWaveform,
  DEFAULT_WAVEFORM_BUCKETS,
  IDLE_WAVEFORM,
  LOADING_WAVEFORM,
} from './waveform.js';
export type {
  AudioWaveformErrorCode,
  AudioWaveformStatus,
  DecodeWaveformOptions,
  WaveformResult,
} from './waveform.js';

// ---------------------------------------------------------------------------
// Read/delivery tracking — the viewport half of §9.5's two watermarks.
// ---------------------------------------------------------------------------
export { createReadTracker, DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD } from './read-tracker.js';
export type { ReadTracker, ReadTrackerOptions, TrackedMessage } from './read-tracker.js';

// ---------------------------------------------------------------------------
// Offline — the platform's connectivity signal, the retry cadence that caps
// how long a recoverable outage looks stuck, and the copy every binding shows.
// ---------------------------------------------------------------------------
export {
  countQueuedSends,
  createNetworkStatus,
  createReconnectPump,
  DEFAULT_RECONNECT_INTERVAL_MS,
  isNavigatorOnline,
  OUTAGE_ATTEMPT_THRESHOLD,
  resolveOfflineBanner,
} from './offline.js';
export type {
  CancelInterval,
  NetworkStatus,
  OfflineBannerInput,
  OfflineBannerTone,
  OfflineBannerView,
  QueueableMessage,
  ReconnectPump,
  ReconnectPumpOptions,
  ReconnectTarget,
  ScheduleInterval,
} from './offline.js';
