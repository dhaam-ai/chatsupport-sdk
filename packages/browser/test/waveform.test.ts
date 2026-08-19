// @vitest-environment jsdom
//
// jsdom has no Web Audio API, so `AudioContext` is stubbed — ported from
// packages/react/test/use-audio-waveform.test.ts, which tracks every instance
// it hands out and records `close()` calls on each, because "was this context
// closed" is the assertion that matters most: an un-closed context is
// invisible in a passing test and only shows up as broken playback after a
// few dozen voice notes.
//
// One thing this suite leans on deliberately, matching decodeWaveform's own
// header comment: this repo's jsdom (25.x) does not implement
// `Blob.prototype.arrayBuffer`, so every `decodeWaveform()` call below
// exercises the `FileReader` fallback in `readBlobAsArrayBuffer` for free —
// that IS the environment the module's comment says it has to keep working
// in. A dedicated test still forces the `blob.arrayBuffer()` branch
// explicitly, so neither path depends on incidental jsdom behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeWaveformPeaks, decodeWaveform } from '../src/waveform.js';

/** A decoded buffer. `getChannelData` returns the samples the test supplied. */
function makeAudioBuffer(samples: number[], durationSeconds = 2): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: samples.length,
    duration: durationSeconds,
    sampleRate: 48000,
    getChannelData: () => Float32Array.from(samples),
  } as unknown as AudioBuffer;
}

type DecodeBehaviour =
  | { kind: 'resolve'; buffer: AudioBuffer }
  | { kind: 'reject' }
  | { kind: 'throw' };

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static behaviour: DecodeBehaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };

  state: AudioContextState = 'running';
  close = vi.fn(async () => {
    this.state = 'closed';
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  decodeAudioData(
    _data: ArrayBuffer,
    onSuccess?: (buffer: AudioBuffer) => void,
    onError?: (error: DOMException) => void,
  ): Promise<AudioBuffer> {
    const behaviour = FakeAudioContext.behaviour;
    if (behaviour.kind === 'throw') {
      // Older WebKit's callback-form decodeAudioData can throw synchronously
      // rather than reject — decodeAudio()'s try/catch exists for exactly this.
      throw new Error('decodeAudioData threw synchronously');
    }
    if (behaviour.kind === 'reject') {
      const error = new Error('EncodingError: unable to decode');
      onError?.(error as unknown as DOMException);
      return Promise.reject(error);
    }
    onSuccess?.(behaviour.buffer);
    return Promise.resolve(behaviour.buffer);
  }
}

/** Drives the FileReader onerror path deterministically, without depending on jsdom internals. */
class FailingFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: ArrayBuffer | null = null;
  error: Error | null = null;

  readAsArrayBuffer(_blob: Blob): void {
    queueMicrotask(() => {
      this.error = new Error('FileReader failed');
      this.onerror?.();
    });
  }
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function makeBlob(bytes = [1, 2, 3, 4]): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: 'audio/webm' });
}

/** Forces the `blob.arrayBuffer()` branch of `readBlobAsArrayBuffer`, independent of jsdom's own support. */
function withArrayBuffer(blob: Blob, impl: () => Promise<ArrayBuffer>): Blob {
  Object.defineProperty(blob, 'arrayBuffer', { value: impl, configurable: true });
  return blob;
}

/** Forces the "no arrayBuffer method" branch even if some future jsdom adds one. */
function withoutArrayBuffer(blob: Blob): Blob {
  Object.defineProperty(blob, 'arrayBuffer', { value: undefined, configurable: true });
  return blob;
}

const globals = globalThis as unknown as Record<string, unknown>;
const originalFileReader = globalThis.FileReader;

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  globals.AudioContext = FakeAudioContext;
});

afterEach(() => {
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
  globals.FileReader = originalFileReader;
});

// ---------------------------------------------------------------------------
// computeWaveformPeaks
// ---------------------------------------------------------------------------

describe('computeWaveformPeaks', () => {
  it('downsamples to the requested bucket count and normalizes the loudest bar to exactly 1', () => {
    // Four samples, four buckets: one sample each, so each peak is that
    // sample's magnitude divided by the loudest (1).
    const peaks = computeWaveformPeaks(makeAudioBuffer([0.5, -1, 0.25, 0.1]), 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.5, 5);
    expect(peaks[1]).toBeCloseTo(1, 5);
    expect(peaks[2]).toBeCloseTo(0.25, 5);
    expect(peaks[3]).toBeCloseTo(0.1, 5);
    expect(Math.max(...peaks)).toBe(1);
  });

  it('takes the peak within each bucket, not the first or last sample of it', () => {
    // Two buckets over eight samples: the loud sample sits in the middle of
    // bucket 0, where a "sample the boundary" implementation would miss it.
    const peaks = computeWaveformPeaks(makeAudioBuffer([0.01, 0.02, 0.9, 0.01, 0.05, 0.05, 0.05, 0.05]), 2);
    expect(peaks[0]).toBeCloseTo(1, 5);
    expect(peaks[1]).toBeCloseTo(0.05 / 0.9, 5);
  });

  it('quiet audio still fills the full height — the scale is relative, not absolute', () => {
    const peaks = computeWaveformPeaks(makeAudioBuffer([0.001, 0.002]), 2);
    expect(peaks[1]).toBeCloseTo(1, 5);
  });

  it('returns all zeros rather than NaN for pure silence', () => {
    const peaks = computeWaveformPeaks(makeAudioBuffer([0, 0, 0, 0]), 4);
    expect(peaks).toEqual([0, 0, 0, 0]);
    for (const peak of peaks) expect(Number.isNaN(peak)).toBe(false);
  });

  it('returns all zeros, no NaN, for a zero-length buffer', () => {
    const peaks = computeWaveformPeaks(makeAudioBuffer([]), 4);
    expect(peaks).toEqual([0, 0, 0, 0]);
    for (const peak of peaks) expect(Number.isNaN(peak)).toBe(false);
  });

  it('gives every bucket at least one sample when there are fewer samples than buckets', () => {
    const peaks = computeWaveformPeaks(makeAudioBuffer([1, 0.5]), 8);
    expect(peaks).toHaveLength(8);
    // With 2 samples over 8 buckets no bucket may be empty-and-therefore-zero
    // by accident; the first four map to sample 0, the rest to sample 1.
    expect(peaks.filter((p) => p > 0)).toHaveLength(8);
  });

  it('clamps the bucket count to 1..512 instead of allocating whatever was asked for', () => {
    expect(computeWaveformPeaks(makeAudioBuffer([1, 1]), 100000)).toHaveLength(512);
    expect(computeWaveformPeaks(makeAudioBuffer([1, 1]), 0)).toHaveLength(1);
    expect(computeWaveformPeaks(makeAudioBuffer([1, 1]), -5)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// decodeWaveform — never rejects, always closes the context it opened
// ---------------------------------------------------------------------------

describe('decodeWaveform', () => {
  it('resolves unsupported (never rejects) when there is no AudioContext constructor at all', async () => {
    delete globals.AudioContext;
    delete globals.webkitAudioContext;

    const result = await decodeWaveform(makeBlob());

    expect(result).toEqual({ status: 'failed', peaks: [], durationMs: null, errorCode: 'unsupported' });
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('falls back to webkitAudioContext when AudioContext is absent', async () => {
    delete globals.AudioContext;
    globals.webkitAudioContext = FakeAudioContext;

    const result = await decodeWaveform(makeBlob());
    expect(result.status).toBe('ready');
  });

  it('decodes to normalized peaks and reports the decoded duration, then closes the context', async () => {
    FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1], 3) };

    const result = await decodeWaveform(makeBlob(), { buckets: 4 });

    expect(result.status).toBe('ready');
    expect(result.peaks).toHaveLength(4);
    expect(result.peaks[1]).toBeCloseTo(1, 5);
    expect(result.durationMs).toBe(3000);
    expect(result.errorCode).toBeNull();

    const context = last(FakeAudioContext.instances);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('resolves a failed status (never throws) when the codec cannot be decoded, and still closes the context', async () => {
    FakeAudioContext.behaviour = { kind: 'reject' };

    const result = await decodeWaveform(makeBlob());

    expect(result).toEqual({ status: 'failed', peaks: [], durationMs: null, errorCode: 'decode-failed' });
    const context = last(FakeAudioContext.instances);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('resolves decode-failed (never throws) even when decodeAudioData throws synchronously, and still closes the context', async () => {
    FakeAudioContext.behaviour = { kind: 'throw' };

    const result = await decodeWaveform(makeBlob());

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('decode-failed');
    const context = last(FakeAudioContext.instances);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('resolves read-failed (never throws) when the blob cannot be read, and never constructs an AudioContext', async () => {
    globals.FileReader = FailingFileReader;
    const blob = withoutArrayBuffer(makeBlob());

    const result = await decodeWaveform(blob);

    expect(result).toEqual({ status: 'failed', peaks: [], durationMs: null, errorCode: 'read-failed' });
    // The read happens before the AudioContext is ever constructed, so a
    // read failure must leave nothing open to close.
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('resolves read-failed (never throws) when neither blob.arrayBuffer() nor FileReader exist', async () => {
    delete globals.FileReader;
    const blob = withoutArrayBuffer(makeBlob());

    const result = await decodeWaveform(blob);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('read-failed');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('uses blob.arrayBuffer() directly when the environment provides it, bypassing FileReader entirely', async () => {
    let calledArrayBuffer = false;
    const blob = withArrayBuffer(makeBlob(), () => {
      calledArrayBuffer = true;
      return Promise.resolve(new ArrayBuffer(8));
    });
    // Poison FileReader so the test fails loudly if the fallback is taken
    // instead of the direct method.
    globals.FileReader = class {
      constructor() {
        throw new Error('FileReader should not be constructed when blob.arrayBuffer() exists');
      }
    };

    const result = await decodeWaveform(blob);

    expect(calledArrayBuffer).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('never rejects even when blob.arrayBuffer() itself rejects', async () => {
    const blob = withArrayBuffer(makeBlob(), () => Promise.reject(new Error('boom')));

    await expect(decodeWaveform(blob)).resolves.toEqual({
      status: 'failed',
      peaks: [],
      durationMs: null,
      errorCode: 'read-failed',
    });
  });
});
