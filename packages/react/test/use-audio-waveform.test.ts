// @vitest-environment jsdom
//
// jsdom has no Web Audio API, so `AudioContext` is stubbed. The stub tracks
// every instance it hands out and records `close()` calls on each, because
// "was this context closed" is the assertion that matters most here — an
// un-closed context is invisible in a passing render and only shows up as
// broken playback after a few dozen voice notes.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeWaveformPeaks, useAudioWaveform } from '../src/use-audio-waveform.js';

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
  | { kind: 'pending' };

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static behaviour: DecodeBehaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  /** Resolvers for `pending` decodes, so a test can settle one on demand. */
  static pending: Array<(buffer: AudioBuffer) => void> = [];

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
    if (behaviour.kind === 'reject') {
      const error = new Error('EncodingError: unable to decode');
      onError?.(error as unknown as DOMException);
      return Promise.reject(error);
    }
    if (behaviour.kind === 'pending') {
      return new Promise<AudioBuffer>((resolve) => {
        FakeAudioContext.pending.push((buffer) => {
          onSuccess?.(buffer);
          resolve(buffer);
        });
      });
    }
    onSuccess?.(behaviour.buffer);
    return Promise.resolve(behaviour.buffer);
  }
}

/**
 * `Array.prototype.at` is ES2022 and this repo's tsconfig.base.json targets
 * ES2020 — vitest's esbuild transform accepts it, `tsc --noEmit -p
 * tsconfig.test.json` does not. Same semantics, no lib bump.
 */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

const globals = globalThis as unknown as Record<string, unknown>;

function makeBlob(bytes = [1, 2, 3, 4]): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: 'audio/webm' });
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.pending = [];
  FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  globals.AudioContext = FakeAudioContext;
});

afterEach(() => {
  cleanup();
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
});

describe('computeWaveformPeaks', () => {
  it('downsamples to the requested bucket count and normalizes the loudest bar to 1', () => {
    // Four samples, four buckets: one sample each, so each peak is that
    // sample's magnitude divided by the loudest (1).
    const peaks = computeWaveformPeaks(makeAudioBuffer([0.5, -1, 0.25, 0.1]), 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.5, 5);
    expect(peaks[1]).toBeCloseTo(1, 5);
    expect(peaks[2]).toBeCloseTo(0.25, 5);
    expect(peaks[3]).toBeCloseTo(0.1, 5);
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

  it('gives every bucket at least one sample when there are fewer samples than buckets', () => {
    const peaks = computeWaveformPeaks(makeAudioBuffer([1, 0.5]), 8);
    expect(peaks).toHaveLength(8);
    // With 2 samples over 8 buckets no bucket may be empty-and-therefore-zero
    // by accident; the first four map to sample 0, the rest to sample 1.
    expect(peaks.filter((p) => p > 0)).toHaveLength(8);
  });

  it('clamps an absurd bucket count instead of allocating it', () => {
    expect(computeWaveformPeaks(makeAudioBuffer([1, 1]), 100000)).toHaveLength(512);
    expect(computeWaveformPeaks(makeAudioBuffer([1, 1]), 0)).toHaveLength(1);
  });
});

describe('useAudioWaveform', () => {
  it('is idle with no blob and never constructs an AudioContext', async () => {
    const { result } = renderHook(() => useAudioWaveform(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.peaks).toEqual([]);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('decodes to peaks and reports the decoded duration', async () => {
    FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1], 3) };
    const blob = makeBlob();

    const { result } = renderHook(() => useAudioWaveform(blob, { buckets: 4 }));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.peaks).toHaveLength(4);
    expect(result.current.peaks[1]).toBeCloseTo(1, 5);
    expect(result.current.durationMs).toBe(3000);
    expect(result.current.errorCode).toBeNull();
  });

  it('closes the AudioContext once decoding succeeds', async () => {
    const blob = makeBlob();
    const { result } = renderHook(() => useAudioWaveform(blob));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    const context = last(FakeAudioContext.instances);
    expect(context).toBeDefined();
    await waitFor(() => {
      expect(context?.close).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a failed status instead of throwing when the codec cannot be decoded, and still closes the context', async () => {
    FakeAudioContext.behaviour = { kind: 'reject' };
    const blob = makeBlob();

    const { result } = renderHook(() => useAudioWaveform(blob));

    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    expect(result.current.errorCode).toBe('decode-failed');
    expect(result.current.peaks).toEqual([]);

    const context = last(FakeAudioContext.instances);
    await waitFor(() => {
      expect(context?.close).toHaveBeenCalledTimes(1);
    });
  });

  it('reports unsupported where the browser has no Web Audio API', async () => {
    delete globals.AudioContext;
    const blob = makeBlob();

    const { result } = renderHook(() => useAudioWaveform(blob));

    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    expect(result.current.errorCode).toBe('unsupported');
  });

  it('falls back to webkitAudioContext', async () => {
    delete globals.AudioContext;
    globals.webkitAudioContext = FakeAudioContext;
    const blob = makeBlob();

    const { result } = renderHook(() => useAudioWaveform(blob));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
  });

  it('discards a stale decode when the blob changes, and closes the abandoned context', async () => {
    FakeAudioContext.behaviour = { kind: 'pending' };
    const first = makeBlob([1, 1, 1]);
    const second = makeBlob([2, 2, 2]);

    const { result, rerender } = renderHook(({ blob }: { blob: Blob }) => useAudioWaveform(blob, { buckets: 2 }), {
      initialProps: { blob: first },
    });

    await waitFor(() => {
      expect(FakeAudioContext.pending).toHaveLength(1);
    });
    expect(result.current.status).toBe('loading');

    // Swap the blob while the first decode is still in flight, then settle
    // the first one. Its result must never reach state.
    rerender({ blob: second });
    await waitFor(() => {
      expect(FakeAudioContext.pending).toHaveLength(2);
    });

    const settleFirst = FakeAudioContext.pending[0];
    const settleSecond = FakeAudioContext.pending[1];
    if (settleFirst === undefined || settleSecond === undefined) throw new Error('missing pending decode');

    await act(async () => {
      settleFirst(makeAudioBuffer([1, 1], 9));
      await Promise.resolve();
    });
    // Still loading: the stale decode was dropped, not applied.
    expect(result.current.status).toBe('loading');
    expect(result.current.durationMs).toBeNull();

    await act(async () => {
      settleSecond(makeAudioBuffer([0.5, 0.25], 4));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.durationMs).toBe(4000);

    // Both contexts closed — including the one whose result was thrown away.
    await waitFor(() => {
      for (const context of FakeAudioContext.instances) {
        expect(context.close).toHaveBeenCalledTimes(1);
      }
    });
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  it('closes the AudioContext when the component unmounts mid-decode', async () => {
    FakeAudioContext.behaviour = { kind: 'pending' };
    const blob = makeBlob();

    const { unmount } = renderHook(() => useAudioWaveform(blob));

    await waitFor(() => {
      expect(FakeAudioContext.pending).toHaveLength(1);
    });
    const context = last(FakeAudioContext.instances);

    unmount();

    const settle = FakeAudioContext.pending[0];
    if (settle === undefined) throw new Error('missing pending decode');
    await act(async () => {
      settle(makeAudioBuffer([1]));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(context?.close).toHaveBeenCalledTimes(1);
    });
  });

  it('goes back to idle when the blob is cleared', async () => {
    const blob = makeBlob();
    const { result, rerender } = renderHook(({ b }: { b: Blob | null }) => useAudioWaveform(b), {
      initialProps: { b: blob as Blob | null },
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    rerender({ b: null });
    expect(result.current.status).toBe('idle');
    expect(result.current.peaks).toEqual([]);
  });
});
