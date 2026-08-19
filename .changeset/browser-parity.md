---
"@dhaam-ccrm/browser": minor
"@dhaam-ccrm/react": minor
"@dhaam-ccrm/vue": minor
"@dhaam-ccrm/angular": minor
---

Framework-agnostic browser primitives for voice recording, waveform decode, and read tracking.

**New package:** `@dhaam-ccrm/browser` — voice recording with amplitude tracking and 9
error codes; waveform decode with automatic AudioContext cleanup; two-watermark read
tracking with configurable visibility threshold. Zero dependencies, SSR-safe. Exists so
React, Vue, Angular and any vanilla page share one implementation and cannot drift on
microphone teardown or on what "read" means. (The widget still carries its own trimmed
recorder — deliberately, for bundle size.)

**Updated bindings:**

- **React:** `useVoiceRecorder`, `useAudioWaveform`, `useReadTracker` now delegate to
  `@dhaam-ccrm/browser` and are thin wrappers. The tick derivation
  (`MESSAGE_TICK_STATES`, `deriveTickState`, `deriveTickStateFromState`) is now
  re-exported from core, which was previously missing from the React barrel.
- **Vue:** `useVoiceRecorder`, `useAudioWaveform`, `useReadTracker` are new, thin
  wrappers over the browser primitives.
- **Angular:** `createVoiceRecorder()`, `createAudioWaveform()`, `createReadTracker()`
  are new, wired to Signal and DI lifecycle.

All three bindings now have feature parity across voice recording, waveform, and read
tracking. The widget continues to own its own trimmed voice implementation for bundle
size.
