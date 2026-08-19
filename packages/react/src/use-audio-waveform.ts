// useAudioWaveform — React's view of `@dhaam-ccrm/browser`'s `decodeWaveform`.
//
// The decode itself — the two `decodeAudioData` spec generations, the
// `FileReader` fallback for Safari<14 and jsdom, the peak downsample, and the
// `finally` that closes the `AudioContext` on every path including the
// cancelled one — lives in `@dhaam-ccrm/browser`. Browsers cap concurrent
// AudioContexts, so "who closes it" is the whole substance of this feature and
// it belongs in one place that every binding shares.
//
// React adds the effect lifecycle: a decode that outlives its component must
// not call `setState`, and a blob swapped mid-decode must not let the first
// decode win the race.

import { useEffect, useState } from 'react';
import { decodeWaveform, DEFAULT_WAVEFORM_BUCKETS, IDLE_WAVEFORM, LOADING_WAVEFORM } from '@dhaam-ccrm/browser';
import type { WaveformResult } from '@dhaam-ccrm/browser';

export { computeWaveformPeaks, DEFAULT_WAVEFORM_BUCKETS } from '@dhaam-ccrm/browser';
export type { AudioWaveformErrorCode, AudioWaveformStatus } from '@dhaam-ccrm/browser';

export interface UseAudioWaveformOptions {
  /** Number of bars. Defaults to {@link DEFAULT_WAVEFORM_BUCKETS}; clamped to 1..512. */
  buckets?: number;
}

/** Identical to `@dhaam-ccrm/browser`'s `WaveformResult` — named for the hook, kept as the same shape. */
export type UseAudioWaveformResult = WaveformResult;

/**
 * Decodes `blob` to render-ready peaks.
 *
 * SSR-safe: the decode lives entirely in an effect, which never runs on the
 * server, and the module reads no browser global at import time. A server
 * render sees `status: 'idle'`.
 *
 * Pass `null`/`undefined` for "nothing to decode yet" — that is `idle`, not
 * `failed`, so a bubble whose blob is still uploading does not flash an error.
 *
 * @param blob The recorded audio. Identity, not content, is the dependency:
 *   keep the same `Blob` reference across renders (or `useMemo` it) or every
 *   render restarts the decode.
 */
export function useAudioWaveform(
  blob: Blob | null | undefined,
  options: UseAudioWaveformOptions = {},
): UseAudioWaveformResult {
  const { buckets = DEFAULT_WAVEFORM_BUCKETS } = options;
  const [result, setResult] = useState<UseAudioWaveformResult>(IDLE_WAVEFORM);

  useEffect(() => {
    if (blob === null || blob === undefined) {
      setResult(IDLE_WAVEFORM);
      return;
    }

    let cancelled = false;
    setResult(LOADING_WAVEFORM);

    // `decodeWaveform` never rejects — every failure is a `status: 'failed'`
    // result — so there is no rejection path to handle here, only a
    // cancellation one.
    void decodeWaveform(blob, { buckets }).then((decoded) => {
      if (!cancelled) setResult(decoded);
    });

    return () => {
      cancelled = true;
    };
  }, [blob, buckets]);

  return result;
}
