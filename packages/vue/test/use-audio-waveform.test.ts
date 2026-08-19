// @vitest-environment jsdom
//
// jsdom has no Web Audio API, so `AudioContext` is stubbed here — trimmed
// from packages/react/test/use-audio-waveform.test.ts's stub to what this
// file needs. `computeWaveformPeaks` and `decodeWaveform`'s own decode/failure
// logic are @dhaam-ccrm/browser's contract, already exhaustively covered
// there; this file is about the one thing that IS Vue-specific — `blob` is a
// reactive ref, and a decode racing a blob swap must never let the stale one
// win.
//
// No no-active-scope test here, deliberately: unlike use-voice-recorder.ts
// and use-read-tracker.ts, use-audio-waveform.ts never calls
// onChatScopeDispose (see its own header comment) — there is no subscription
// to release, only a `watch()`, and a `watch()`'s underlying effect
// self-registers with whatever effect scope happens to be active, the same
// as any other Vue effect. Calling it with no active scope would not warn;
// it would just mean the watcher runs forever, which is a plain Vue-level
// leak this composable's own code has no hook to detect or prevent — testing
// it here would be testing Vue's reactivity system, not this file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { useAudioWaveform } from '../src/index.js';

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

type DecodeBehaviour = { kind: 'resolve'; buffer: AudioBuffer } | { kind: 'reject' } | { kind: 'pending' };

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static behaviour: DecodeBehaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  /** Resolvers for `pending` decodes, in construction order, so a test can settle each on demand. */
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

const globals = globalThis as unknown as Record<string, unknown>;

function makeBlob(bytes = [1, 2, 3, 4]): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: 'audio/webm' });
}

/** Same idea as harness.ts's `runInChatScope`, minus the ChatClient this composable never needs. */
function runInScope<T>(fn: () => T): { value: T; stop: () => void } {
  const scope = effectScope();
  const value = scope.run(fn) as T;
  return { value, stop: () => scope.stop() };
}

/**
 * Polls until `predicate` is true. `decodeWaveform`'s promise chain runs
 * through jsdom's real `Blob.arrayBuffer()`, which — unlike the plain
 * microtask chain a hand-rolled fake would use — settles on jsdom's own
 * schedule (it is backed by a real stream reader, not a bare `Promise.resolve`).
 * A fixed number of `await Promise.resolve()` turns is not reliably enough;
 * polling with real timers is what both this file and
 * packages/react/test/use-audio-waveform.test.ts's `waitFor` do for the same
 * reason.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!predicate()) throw new Error('condition not met yet');
  });
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.pending = [];
  FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  globals.AudioContext = FakeAudioContext;
});

afterEach(() => {
  delete globals.AudioContext;
});

describe('useAudioWaveform — idle', () => {
  it('is idle for a null blob and never constructs an AudioContext', () => {
    const { value: result, stop } = runInScope(() => useAudioWaveform(null));

    expect(result.value.status).toBe('idle');
    expect(result.value.peaks).toEqual([]);
    expect(FakeAudioContext.instances).toHaveLength(0);

    stop();
  });

  it('a blob that clears back to null goes back to idle rather than staying at its last result', async () => {
    // "A bubble whose blob is still uploading must not flash an error" cuts
    // both ways: a note that gets cleared must not keep showing stale peaks
    // either.
    const blob = ref<Blob | null>(makeBlob());
    const { value: result, stop } = runInScope(() => useAudioWaveform(blob));

    await waitFor(() => result.value.status === 'ready');

    blob.value = null;
    await nextTick();

    expect(result.value.status).toBe('idle');
    expect(result.value.peaks).toEqual([]);

    stop();
  });
});

describe('useAudioWaveform — decode outcomes', () => {
  it('decodes to peaks, forwarding the buckets option through to the underlying decode', async () => {
    const blob = ref<Blob | null>(makeBlob());
    const { value: result, stop } = runInScope(() => useAudioWaveform(blob, { buckets: 4 }));

    expect(result.value.status, 'synchronous, from the immediate watcher — no AudioContext exists yet').toBe(
      'loading',
    );

    await waitFor(() => result.value.status === 'ready');

    expect(result.value.peaks).toHaveLength(4);
    expect(result.value.durationMs).toBe(2000);
    expect(result.value.errorCode).toBeNull();

    stop();
  });

  it('reports a failed status instead of throwing when the codec cannot be decoded', async () => {
    // `decodeWaveform` never rejects — every failure resolves to
    // `status: 'failed'` — so the property under test is simply that this
    // whole flow (construction through decode) never throws, and the
    // rejection surfaces as data instead.
    FakeAudioContext.behaviour = { kind: 'reject' };
    const blob = ref<Blob | null>(makeBlob());

    const { value: result, stop } = runInScope(() => useAudioWaveform(blob));

    await waitFor(() => result.value.status === 'failed');

    expect(result.value.errorCode).toBe('decode-failed');
    expect(result.value.peaks).toEqual([]);

    stop();
  });
});

describe('useAudioWaveform — a swapped blob mid-decode', () => {
  it('publishes only the newest decode, even when the stale one resolves last', async () => {
    FakeAudioContext.behaviour = { kind: 'pending' };
    const blob = ref<Blob>(makeBlob([1, 1, 1]));
    const { value: result, stop } = runInScope(() => useAudioWaveform(blob, { buckets: 2 }));

    expect(result.value.status).toBe('loading');
    await waitFor(() => FakeAudioContext.pending.length === 1);

    // Swap while the first decode is still in flight — the generation token
    // increments and a second decode starts.
    blob.value = makeBlob([2, 2, 2]);
    await nextTick();
    await waitFor(() => FakeAudioContext.pending.length === 2);

    const settleFirst = FakeAudioContext.pending[0];
    const settleSecond = FakeAudioContext.pending[1];
    if (settleFirst === undefined || settleSecond === undefined) throw new Error('missing pending decode');

    // Resolve the NEWER decode first — the ordinary case a naive
    // "last write wins" implementation would also get right by accident.
    settleSecond(makeAudioBuffer([0.5, 0.25], 4));
    await waitFor(() => result.value.status === 'ready');
    expect(result.value.durationMs).toBe(4000);

    // Now resolve the OLDER, now-stale decode — deliberately out of order,
    // which is the case that actually distinguishes a generation-token guard
    // from one that just trusts whichever promise settles last. It must not
    // overwrite the fresher result already on screen.
    settleFirst(makeAudioBuffer([1, 1], 9));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.value.status, 'the stale decode must not win').toBe('ready');
    expect(result.value.durationMs, 'still the second decode s duration, not the first s').toBe(4000);

    stop();
  });
});
