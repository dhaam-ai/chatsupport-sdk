// useAudioWaveform — decode a recorded blob into the handful of bar heights a
// voice-note bubble draws.
//
// ---------------------------------------------------------------------------
// Why this returns a status instead of throwing
// ---------------------------------------------------------------------------
//
// `decodeAudioData` fails routinely and unremarkably: a Safari client is
// handed an `audio/webm` note recorded by a Chrome client and simply cannot
// decode it, a blob is truncated because the sender's tab closed mid-upload,
// or the file is not audio at all. None of those is exceptional enough to
// throw from a render tree — a voice note whose waveform failed should still
// play through an `<audio>` element, which has its own decoder and often
// succeeds where `decodeAudioData` did not. So every failure lands on
// `status: 'failed'` and the caller draws a flat bar.
//
// ---------------------------------------------------------------------------
// Closing the AudioContext is the whole reason this is a hook
// ---------------------------------------------------------------------------
//
// Browsers cap concurrent `AudioContext`s — historically 6 in Safari, ~50 in
// Chrome — and an un-closed one counts against that cap for the lifetime of
// the document. Decoding one context per voice note and never closing it
// means a conversation with forty voice notes stops being able to construct
// an AudioContext at all, at which point playback and the recorder's own
// amplitude meter both break with an error that names nothing to do with
// waveforms. The `finally` below is load-bearing, and it runs on the
// cancelled path too.

import { useEffect, useState } from 'react';

/** ~48 bars: dense enough to read as a waveform in a chat bubble, sparse enough to render as plain divs. */
export const DEFAULT_WAVEFORM_BUCKETS = 48;

/** Above this, "peaks" stops being a summary and starts being a resample. Guards a caller passing `audioBuffer.length`. */
const MAX_WAVEFORM_BUCKETS = 512;

export type AudioWaveformStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type AudioWaveformErrorCode =
  | 'unsupported'
  | 'read-failed'
  | 'decode-failed';

export interface UseAudioWaveformOptions {
  /** Number of bars. Defaults to {@link DEFAULT_WAVEFORM_BUCKETS}; clamped to 1..512. */
  buckets?: number;
}

export interface UseAudioWaveformResult {
  status: AudioWaveformStatus;
  /**
   * One normalized peak per bucket, 0..1, loudest bar exactly 1. Empty unless
   * `status === 'ready'` — a partially-filled array during decode would draw
   * a waveform that is simply wrong.
   */
  peaks: number[];
  /** Decoded duration in ms, or `null` until ready. Comes from the audio itself, so it is right even when the recorder's own timer was not. */
  durationMs: number | null;
  errorCode: AudioWaveformErrorCode | null;
}

const IDLE: UseAudioWaveformResult = { status: 'idle', peaks: [], durationMs: null, errorCode: null };

/** `AudioContext`, or Safari's prefixed one. Read lazily — never at module scope, so SSR imports touch no `window`. */
function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Promise-shaped `decodeAudioData` across both spec generations.
 *
 * Older WebKit implements only the callback form and returns `undefined`;
 * modern browsers return a promise AND still honour the callbacks. Handling
 * both is what keeps this working on the Safari versions most likely to be
 * handed a codec they cannot read in the first place. Double-settling is
 * inert — a promise keeps its first outcome.
 */
function decodeAudio(context: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let maybePromise: Promise<AudioBuffer> | undefined;
    try {
      maybePromise = context.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    } catch (caught) {
      reject(caught instanceof Error ? caught : new Error('decodeAudioData threw'));
      return;
    }
    if (maybePromise !== undefined && typeof maybePromise.then === 'function') {
      maybePromise.then(resolve, reject);
    }
  });
}

/**
 * Reads a `Blob` to an `ArrayBuffer`.
 *
 * `Blob.prototype.arrayBuffer` is the obvious call and is used when present,
 * but it is genuinely absent in two environments this hook has to work in:
 * Safari before 14 (which still ships `MediaRecorder`-adjacent voice notes
 * from other clients), and jsdom, which is what the test suite runs on. The
 * `FileReader` fallback is the pre-promise API both of those do have.
 */
function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();

  return new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('no way to read a Blob in this environment'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error('FileReader returned a non-ArrayBuffer result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Downsamples a decoded buffer to `buckets` normalized peaks.
 *
 * Peak-per-bucket rather than RMS-per-bucket: this is the shape a person
 * recognizes as "a waveform", and it keeps a short loud syllable visible
 * instead of averaging it into the surrounding silence. Normalizing by the
 * global maximum is what makes a quietly-recorded note still legible — an
 * absolute scale would render most phone recordings as a flat line.
 *
 * Channel 0 only. Mixing channels costs a full pass for a difference no one
 * can see at 48 bars, and voice notes are mono in practice.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, buckets: number): number[] {
  const bucketCount = Math.max(1, Math.min(MAX_WAVEFORM_BUCKETS, Math.floor(buckets)));
  if (buffer.numberOfChannels === 0 || buffer.length === 0) return new Array<number>(bucketCount).fill(0);

  const samples = buffer.getChannelData(0);
  const peaks = new Array<number>(bucketCount).fill(0);
  const blockSize = samples.length / bucketCount;

  let loudest = 0;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * blockSize);
    // `min` guards the final bucket against a rounding overshoot; `max`
    // guarantees at least one sample per bucket when there are fewer samples
    // than buckets (a sub-50ms recording), so no bucket is silently 0.
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((bucket + 1) * blockSize)));

    let peak = 0;
    for (let i = start; i < end && i < samples.length; i += 1) {
      const magnitude = Math.abs(samples[i] ?? 0);
      if (magnitude > peak) peak = magnitude;
    }
    peaks[bucket] = peak;
    if (peak > loudest) loudest = peak;
  }

  if (loudest === 0) return peaks;
  for (let i = 0; i < peaks.length; i += 1) peaks[i] = (peaks[i] ?? 0) / loudest;
  return peaks;
}

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
  const [result, setResult] = useState<UseAudioWaveformResult>(IDLE);

  useEffect(() => {
    if (blob === null || blob === undefined) {
      setResult(IDLE);
      return;
    }

    let cancelled = false;
    setResult({ status: 'loading', peaks: [], durationMs: null, errorCode: null });

    const run = async (): Promise<void> => {
      const AudioContextCtor = getAudioContextCtor();
      if (AudioContextCtor === undefined) {
        if (!cancelled) setResult({ status: 'failed', peaks: [], durationMs: null, errorCode: 'unsupported' });
        return;
      }

      let data: ArrayBuffer;
      try {
        data = await readBlobAsArrayBuffer(blob);
      } catch {
        if (!cancelled) setResult({ status: 'failed', peaks: [], durationMs: null, errorCode: 'read-failed' });
        return;
      }
      if (cancelled) return;

      let context: AudioContext | null = null;
      try {
        context = new AudioContextCtor();
        const decoded = await decodeAudio(context, data);
        if (cancelled) return;
        setResult({
          status: 'ready',
          peaks: computeWaveformPeaks(decoded, buckets),
          durationMs: decoded.duration * 1000,
          errorCode: null,
        });
      } catch {
        if (!cancelled) setResult({ status: 'failed', peaks: [], durationMs: null, errorCode: 'decode-failed' });
      } finally {
        // Runs on the cancelled path too — an early `return` inside `try`
        // still runs `finally`, which is exactly why the close lives here and
        // not after the try/catch.
        if (context !== null && context.state !== 'closed') {
          void Promise.resolve(context.close()).catch(() => {});
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [blob, buckets]);

  return result;
}
