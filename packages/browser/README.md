# `@dhaam-ccrm/browser`

Framework-free browser primitives for voice recording, waveform decode, and read tracking. Three independent state machines with **zero dependencies** — not even `@dhaam-ccrm/core`. DOM and browser APIs only.

This package exists because `@dhaam-ccrm/js` deliberately compiles without the `DOM` lib (so it stays Node-safe), which meant these three browser-only primitives could not live there. React, Vue, Angular and the vanilla widget all need the same recording teardown and read semantics. One implementation in this package means they cannot drift — that is the point.

- **`createVoiceRecorder()`** — `getUserMedia` + `MediaRecorder` state machine with amplitude tracking, snapshot/subscribe interface, 9 error codes, guaranteed MediaStream release on every exit path.
- **`decodeWaveform()` / `computeWaveformPeaks()`** — voice-note AudioBuffer decode that always closes the AudioContext, with configurable bucketing.
- **`createReadTracker()`** — IntersectionObserver two-watermark tracking: delivered on registration, read at >=60% visibility (configurable).

## Install

```sh
npm install @dhaam-ccrm/browser
```

Zero runtime dependencies.

## Voice recording

Record audio from the microphone, with real error codes:

```ts
import { createVoiceRecorder } from '@dhaam-ccrm/browser';

const recorder = createVoiceRecorder({
  // Optional. Defaults: Opus if available, MP3 fallback.
  mimeType: 'audio/webm;codecs=opus',
  // Optional. Defaults: 50ms snapshots.
  amplitudeIntervalMs: 50,
});

const { subscribe, startRecording, stopRecording } = recorder;

// Amplitude updates during recording
const unsubscribe = subscribe((state) => {
  if (state.status === 'recording') {
    console.log('Current amplitude:', state.amplitude); // 0–1
  }
});

startRecording();
setTimeout(() => {
  const result = stopRecording(); // { blob, duration, amplitude: [] }
  if (result.status === 'success') {
    await client.sendAttachment({ blob: result.blob, mimeType: result.mimeType });
  }
}, 5000);
```

Every exit path — success, cancellation, error — releases the MediaStream. Call `recorder.destroy()` to clean up subscriptions.

### Error handling

`startRecording()` throws one of nine `VoiceRecorderErrorCode` values: `NOT_SUPPORTED`, `PERMISSION_DENIED`, `NOT_READABLE`, `SECURITY_ERROR`, `UNKNOWN_HARDWARE`, `ABORTING`, `INVALID_STATE`, `ENCODING_ERROR`, `STREAM_RELEASE_ERROR`. Each corresponds to one real failure mode with distinct recovery (retry, ask permission, give up). Use `classifyMediaError(err)` to map browser errors to these codes:

```ts
try {
  startRecording();
} catch (err) {
  const code = classifyMediaError(err);
  if (code === 'PERMISSION_DENIED') showPermissionGuide();
  if (code === 'NOT_SUPPORTED') hideRecordButton();
}
```

Check support before offering the UI:

```ts
const support = probeVoiceSupport();
if (!support.supported) {
  console.log('Reason:', support.reason); // 'HTTPS_REQUIRED' | 'NO_MICROPHONE' | 'OLD_BROWSER'
}
```

## Waveforms

Decode a voice-note blob into an array of bar heights (for visualization), closing the AudioContext automatically:

```ts
import { decodeWaveform } from '@dhaam-ccrm/browser';

const blob = await fetch('voice-note.webm').then((r) => r.blob());

const result = await decodeWaveform(blob, {
  buckets: 64, // Height of each bar. Defaults: 64.
});

if (result.status === 'success') {
  renderWaveform(result.peaks); // number[]
}
if (result.status === 'error') {
  console.log(result.errorCode); // 'NOT_DECODABLE' | 'CONTEXT_INIT' | 'AUDIO_PROCESSING'
}
```

For a message with an existing waveform already stored, `computeWaveformPeaks()` is a synchronous helper — it just rescales:

```ts
import { computeWaveformPeaks } from '@dhaam-ccrm/browser';

const stored = [0.3, 0.7, 0.2, 0.9]; // from a message
const rescaled = computeWaveformPeaks(stored, { buckets: 32 });
```

## Read tracking

Report when a message row enters the viewport at >=60% visibility (configurable), and track two watermarks: *delivered* on subscription registration, *read* on reaching the threshold:

```ts
import { createReadTracker } from '@dhaam-ccrm/browser';

const tracker = createReadTracker({
  // Structural — core is not a dependency of this package.
  getMessages: () => state.messages,
  onRead: (ids, watermark) => {
    console.log('Read:', ids, 'watermark:', watermark);
    client.markRead(watermark); // Single call for the highest watermark
  },
  onDelivered: (ids, watermark) => {
    console.log('Delivered:', ids); // Fires once on tracker creation
  },
  // Optional. Defaults: 60%, debounced 200ms.
  visibilityThreshold: 0.6,
  debounceMs: 200,
});

// Call whenever DOM is updated (after pagination load, reflow, etc.)
tracker.registerElements([
  { id: 'msg_01ARZ3NDEKTSV4RRFFQ69G5FAV', element: messageElement1 },
  { id: 'msg_01ARZ3NDEKTSV4RRFFQ69G5FAW', element: messageElement2 },
]);

// Unsubscribe and disconnect the observer.
tracker.destroy();
```

The tracker is stateless and viewport-aware: once a message crosses the threshold, a repeat scroll past it does not re-report it. Core's watermarks control the authoritative state; this just reports the viewport's opinion.

`getMessages` is structural — it accepts any array of `{ id, seq }` (that is what `ChatMessage` is to core). No `@dhaam-ccrm/core` import is needed.

## SSR / Workers

Nothing touches `window` or `document` at module scope, only inside functions behind `typeof` guards. Safe to import on a server or in a worker, call nothing, and ship zero code:

```ts
// server.ts
import { createVoiceRecorder } from '@dhaam-ccrm/browser'; // module scope: silent
// ✓ Tree-shakable. A server build includes no runtime for these.
```

## How the bindings use this

**React:** `useVoiceRecorder`, `useAudioWaveform`, `useReadTracker` are thin wrappers over the state machines here, wired to component lifecycle via `useEffect`.

**Vue:** `useVoiceRecorder`, `useAudioWaveform`, `useReadTracker` composables, with `scope`-aware cleanup.

**Angular:** `createVoiceRecorder()`, `createAudioWaveform()`, `createReadTracker()` signal stores, with `DestroyRef` integration.

**Widget:** owns its own trimmed voice implementation (`src/ui/voice.ts`) — it drops the static waveform in favour of a live amplitude meter for bundle size. It does not use `@dhaam-ccrm/browser`.

## License

MIT
