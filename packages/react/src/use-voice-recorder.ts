// useVoiceRecorder — React's view of `@dhaam-ccrm/browser`'s recorder.
//
// The state machine — `getUserMedia`, `MediaRecorder`, the eight distinct
// failure codes, and the rule that every exit path releases the MediaStream —
// lives in `@dhaam-ccrm/browser`'s `createVoiceRecorder`, because Vue,
// Angular, and the vanilla widget need exactly the same thing and a
// microphone-teardown path duplicated per framework is a tab that keeps the OS
// recording light on in whichever copy drifts. Read that module for the why of
// any behaviour below; this file is wiring only.
//
// What React adds, and it is not nothing:
//
//   `useSyncExternalStore` over the recorder's snapshot, so a recording that
//   updates 20 times a second stays correct under concurrent rendering and
//   tearing-free in a Suspense boundary.
//
//   Lifecycle. The recorder is created lazily, destroyed on unmount, and
//   recreated if the component mounts again — which StrictMode does on
//   purpose, and which a recorder held in `useState` and destroyed once would
//   turn into a permanently dead microphone button.
//
// The public API is unchanged from when this file owned the implementation.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createVoiceRecorder } from '@dhaam-ccrm/browser';
import type { VoiceRecorder, VoiceRecorderState, VoiceRecording } from '@dhaam-ccrm/browser';

export {
  DEFAULT_AMPLITUDE_INTERVAL_MS,
  DEFAULT_VOICE_MIME_TYPES,
  probeVoiceSupport,
} from '@dhaam-ccrm/browser';
export type {
  VoiceRecorderError,
  VoiceRecorderErrorCode,
  VoiceRecording,
} from '@dhaam-ccrm/browser';

export interface UseVoiceRecorderOptions {
  /** Candidate mime types, best first. Defaults to `DEFAULT_VOICE_MIME_TYPES`. Falls through to the browser default if none is supported. */
  mimeTypes?: readonly string[];
  /** Amplitude sampling period in ms. Defaults to `DEFAULT_AMPLITUDE_INTERVAL_MS`. */
  amplitudeIntervalMs?: number;
}

export interface UseVoiceRecorderResult extends VoiceRecorderState {
  /** Requests the microphone and begins recording. Never throws: failures land on {@link UseVoiceRecorderResult.error}. */
  start: () => Promise<void>;
  /** Stops and resolves the recording, or `null` if nothing was recording (or the take was cancelled). */
  stop: () => Promise<VoiceRecording | null>;
  /** Stops and discards. Resolves any in-flight `stop()` with `null`. */
  cancel: () => void;
}

/** The snapshot a server render sees: nothing recording, support assumed until probed on the client. */
const SERVER_SNAPSHOT: VoiceRecorderState = {
  isRecording: false,
  durationMs: 0,
  amplitude: 0,
  error: null,
  isSupported: true,
};

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): UseVoiceRecorderResult {
  const { mimeTypes, amplitudeIntervalMs } = options;

  const recorderRef = useRef<VoiceRecorder | null>(null);

  // Lazily, and never during a server render: `createVoiceRecorder` itself
  // reads no browser global, but there is nothing for a server to hold onto
  // either — `getServerSnapshot` below answers that case.
  const ensureRecorder = useCallback((): VoiceRecorder => {
    const existing = recorderRef.current;
    if (existing !== null) return existing;
    const created = createVoiceRecorder();
    recorderRef.current = created;
    return created;
  }, []);

  // Options are pushed in rather than captured at construction, so an inline
  // `mimeTypes={['audio/webm']}` at the call site does not rebuild the
  // recorder (and abort a live recording) on every render. Pushed from an
  // effect, not during render: writing to an object shared with a subscriber
  // mid-render is exactly what concurrent rendering may throw away and redo.
  // Read at record time, so a change lands on the next `start()`.
  useEffect(() => {
    recorderRef.current?.setOptions({
      ...(mimeTypes === undefined ? {} : { mimeTypes }),
      ...(amplitudeIntervalMs === undefined ? {} : { amplitudeIntervalMs }),
    });
  }, [mimeTypes, amplitudeIntervalMs]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => ensureRecorder().subscribe(onStoreChange),
    [ensureRecorder],
  );

  const getSnapshot = useCallback(() => ensureRecorder().getSnapshot(), [ensureRecorder]);
  const getServerSnapshot = useCallback(() => SERVER_SNAPSHOT, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Probed here rather than during render: it reads `navigator`, and a
    // render pass is the one place that must stay safe on a server.
    ensureRecorder().refreshSupport();

    return () => {
      recorderRef.current?.destroy();
      // Nulled so a remount (StrictMode does this deliberately) builds a live
      // recorder instead of reusing the destroyed one.
      recorderRef.current = null;
    };
  }, [ensureRecorder]);

  const actions = useMemo(
    () => ({
      start: () => ensureRecorder().start(),
      stop: () => ensureRecorder().stop(),
      cancel: () => ensureRecorder().cancel(),
    }),
    [ensureRecorder],
  );

  return { ...state, ...actions };
}
