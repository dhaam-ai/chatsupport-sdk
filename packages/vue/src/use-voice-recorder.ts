// useVoiceRecorder — Vue's view of `@dhaam-ccrm/browser`'s recorder.
//
// The state machine — `getUserMedia`, `MediaRecorder`, the eight distinct
// failure codes, and the rule that EVERY exit path releases the MediaStream —
// lives in `@dhaam-ccrm/browser`'s `createVoiceRecorder`. Read that module for
// the why of any behaviour here; this file is wiring only, and it is short on
// purpose: a microphone-teardown path written once per framework is a tab that
// keeps the OS recording light on in whichever copy drifts.
//
// Teardown goes through `onChatScopeDispose`, not `onUnmounted`, for the
// reason scope.ts documents at length — and it matters more here than for a
// plain subscription: what leaks is not a listener, it is a live microphone.

import { createVoiceRecorder } from '@dhaam-ccrm/browser';
import type { VoiceRecorderOptions, VoiceRecorderState, VoiceRecording } from '@dhaam-ccrm/browser';
import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

import { onChatScopeDispose } from './scope.js';

export interface UseVoiceRecorderResult {
  /** The whole recorder state as one ref. Replaced, never mutated — so a template reads `state.isRecording` and re-renders only when something actually changed. */
  state: Readonly<ShallowRef<VoiceRecorderState>>;

  /** Requests the microphone and begins recording. Never throws: failures land on `state.value.error`. */
  start: () => Promise<void>;
  /** Stops and resolves the recording, or `null` if nothing was recording (or the take was cancelled). */
  stop: () => Promise<VoiceRecording | null>;
  /** Stops and discards. Resolves any in-flight `stop()` with `null`. */
  cancel: () => void;
}

/**
 * A microphone recorder scoped to the calling effect scope.
 *
 * ```vue
 * <script setup lang="ts">
 * const { state, start, stop } = useVoiceRecorder();
 * const send = async () => {
 *   const take = await stop();
 *   if (take) await sendAttachment(take.blob, { fileName: `voice.${take.mimeType.includes('mp4') ? 'm4a' : 'webm'}` });
 * };
 * </script>
 * ```
 *
 * SSR-safe: constructing a recorder touches no browser global, and the support
 * probe is skipped on the server so the button rendered there matches the one
 * hydrated on the client.
 *
 * @param options Read at record time, so they are applied at construction and
 *   a later change needs a new recorder. Static per call site in practice —
 *   a reactive mime-type list would only take effect on the next `start()`,
 *   which is a footgun rather than a feature.
 */
export function useVoiceRecorder(options: VoiceRecorderOptions = {}): UseVoiceRecorderResult {
  const recorder = createVoiceRecorder(options);
  const state = shallowRef<VoiceRecorderState>(recorder.getSnapshot());

  const unsubscribe = recorder.subscribe(() => {
    state.value = recorder.getSnapshot();
  });

  // Probed only on a client. On a server this would publish
  // `isSupported: false` into the rendered HTML — a disabled mic button that
  // enables itself a frame after hydration, which is the flicker the
  // `true`-until-proven default exists to avoid.
  if (typeof window !== 'undefined') recorder.refreshSupport();

  onChatScopeDispose(() => {
    unsubscribe();
    // Not merely unsubscribing: this stops every track, closes the
    // AudioContext, and resolves any pending `stop()` with `null`.
    recorder.destroy();
  }, 'useVoiceRecorder');

  return {
    state,
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    cancel: () => recorder.cancel(),
  };
}
