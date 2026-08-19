// Voice-note waveforms, projected onto an Angular signal.
//
// The decode — both `decodeAudioData` spec generations, the `FileReader`
// fallback, the peak downsample, and the `finally` that closes the
// `AudioContext` on every path — lives in `@dhaam-ccrm/browser`. Browsers cap
// concurrent AudioContexts at a few dozen, so "who closes it" is the whole
// substance of the feature and it belongs in one shared place.

import { decodeWaveform, IDLE_WAVEFORM, LOADING_WAVEFORM } from '@dhaam-ccrm/browser';
import type { DecodeWaveformOptions, WaveformResult } from '@dhaam-ccrm/browser';
import { effect, isSignal, signal, Injector } from '@angular/core';
import type { Signal } from '@angular/core';

import { injectIfAvailable } from './injection-context.js';
import type { MaybeSignal } from './chat-store.js';

export interface AudioWaveformOptions extends DecodeWaveformOptions {
  /**
   * The injector that owns the internal `effect()` when `blob` is a signal.
   * Defaults to the ambient one. Only consulted for a reactive `blob` — a
   * plain `Blob` needs no effect and therefore no injector.
   */
  injector?: Injector | null;
}

/**
 * Decodes a voice note into render-ready peaks.
 *
 * ```ts
 * readonly blob = input<Blob | null>(null);
 * readonly waveform = createAudioWaveform(this.blob);
 * ```
 *
 * `null`/`undefined` is `idle`, not `failed` — a bubble whose blob is still
 * uploading must not flash an error. A decode that fails is still playable:
 * `<audio>` has its own decoder and often succeeds where `decodeAudioData`
 * did not, so draw a flat bar rather than hiding the note.
 *
 * @throws Error if `blob` is a signal and no injector is available — an
 *   `effect()` cannot be created without one, and silently decoding the first
 *   value and never updating again would be a waveform that is simply wrong
 *   for every subsequent note.
 */
export function createAudioWaveform(
  blob: MaybeSignal<Blob | null | undefined>,
  options: AudioWaveformOptions = {},
): Signal<WaveformResult> {
  const { injector: injectorOption, ...decodeOptions } = options;
  const result = signal<WaveformResult>(IDLE_WAVEFORM);

  // A token rather than a boolean: a third blob can arrive while the second
  // decode is in flight, and only the newest run may publish.
  let latest = 0;

  function run(current: Blob | null | undefined): void {
    latest += 1;
    const generation = latest;

    if (current === null || current === undefined) {
      result.set(IDLE_WAVEFORM);
      return;
    }

    result.set(LOADING_WAVEFORM);
    // `decodeWaveform` never rejects — every failure is a `status: 'failed'`
    // result — so there is no rejection path here, only a staleness one.
    void decodeWaveform(current, decodeOptions).then((decoded) => {
      if (generation === latest) result.set(decoded);
    });
  }

  if (!isSignal(blob)) {
    run(blob);
    return result.asReadonly();
  }

  const injector = injectorOption === undefined ? injectIfAvailable(Injector) : injectorOption;
  if (injector === null) {
    throw new Error(
      '[@dhaam-ccrm/angular] createAudioWaveform() was given a signal but found no injector. ' +
        'Call it from a component/service field initializer, or pass { injector }.',
    );
  }

  effect(
    () => {
      run(blob());
    },
    { injector },
  );

  return result.asReadonly();
}
