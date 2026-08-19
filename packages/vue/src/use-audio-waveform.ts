// useAudioWaveform — Vue's view of `@dhaam-ccrm/browser`'s `decodeWaveform`.
//
// The decode — both `decodeAudioData` spec generations, the `FileReader`
// fallback, the peak downsample, and the `finally` that closes the
// `AudioContext` on every path — lives in `@dhaam-ccrm/browser`. Browsers cap
// concurrent AudioContexts at a few dozen, so "who closes it" is the entire
// substance of this feature and it belongs in one shared place.
//
// Vue adds the race: `blob` is reactive, and a note swapped while an earlier
// decode is still running must not let the earlier one win.

import { decodeWaveform, IDLE_WAVEFORM, LOADING_WAVEFORM } from '@dhaam-ccrm/browser';
import type { DecodeWaveformOptions, WaveformResult } from '@dhaam-ccrm/browser';
import { shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, ShallowRef } from 'vue';

/**
 * Decodes a voice note into render-ready peaks.
 *
 * ```vue
 * <script setup lang="ts">
 * const props = defineProps<{ blob: Blob | null }>();
 * const waveform = useAudioWaveform(() => props.blob);
 * </script>
 * <template>
 *   <div v-if="waveform.status === 'ready'" class="bars">
 *     <span v-for="(peak, i) in waveform.peaks" :key="i" :style="{ height: `${peak * 100}%` }" />
 *   </div>
 * </template>
 * ```
 *
 * `null`/`undefined` is `idle`, not `failed` — a bubble whose blob is still
 * uploading must not flash an error. A decode that fails is still playable:
 * `<audio>` has its own decoder and often succeeds where `decodeAudioData`
 * did not, so draw a flat bar rather than hiding the note.
 *
 * SSR-safe: the decode runs from a watcher with `immediate: true`, which does
 * fire during a server render — but `decodeWaveform` finds no `AudioContext`
 * there and resolves `failed`/`unsupported` without touching a browser global.
 * The rendered HTML is the `loading` state either way.
 */
export function useAudioWaveform(
  blob: MaybeRefOrGetter<Blob | null | undefined>,
  options: DecodeWaveformOptions = {},
): Readonly<ShallowRef<WaveformResult>> {
  const result = shallowRef<WaveformResult>(IDLE_WAVEFORM);

  // A token rather than a boolean flag: `watch` can fire a third time while a
  // second decode is in flight, and only the newest run may publish.
  let latest = 0;

  watch(
    () => toValue(blob),
    (current) => {
      latest += 1;
      const run = latest;

      if (current === null || current === undefined) {
        result.value = IDLE_WAVEFORM;
        return;
      }

      result.value = LOADING_WAVEFORM;
      // `decodeWaveform` never rejects — every failure is a `status: 'failed'`
      // result — so there is no rejection path here, only a staleness one.
      void decodeWaveform(current, options).then((decoded) => {
        if (run === latest) result.value = decoded;
      });
    },
    { immediate: true },
  );

  return result;
}
