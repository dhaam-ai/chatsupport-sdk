// @vitest-environment jsdom
//
// `createAudioWaveform` on its own. jsdom has no Web Audio API, so
// `AudioContext` is stubbed below — the same contract
// `packages/react/test/use-audio-waveform.test.ts` uses, with a controllable
// `pending` decode so the staleness assertions are real assertions rather
// than a restatement of the stub's behaviour.
//
// What this file is really about: `createAudioWaveform` is the one function
// in this package whose signature FORKS on whether `blob` is a signal, and
// each branch has a sharp edge — a signal blob needs an injector or it must
// throw (never silently decode once and go stale), and a plain blob must
// need no injector at all, because a component field initializer with a
// literal `Blob` should not be forced into an injection context it has no
// other reason to need.

import { runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAudioWaveform } from '../src/index.js';
import { createAngularTestHost } from './angular-test-host.js';

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
  /** Resolvers for `pending` decodes, so a test can settle one on demand — this is what makes the staleness test real. */
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

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function makeBlob(bytes = [1, 2, 3, 4]): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: 'audio/webm' });
}

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.pending = [];
  FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1]) };
  globals.AudioContext = FakeAudioContext;
});

afterEach(() => {
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
});

// ---------------------------------------------------------------------------
// A plain (non-signal) blob needs no injector at all
// ---------------------------------------------------------------------------

describe('a plain Blob', () => {
  it('decodes with no injector — a signal-less field initializer needs no DI at all', async () => {
    // No createAngularTestHost, no runInInjectionContext: proves the
    // `injectIfAvailable(Injector)` call is genuinely skipped for this
    // branch, not merely tolerant of a missing one.
    const result = createAudioWaveform(makeBlob());

    expect(result().status).toBe('loading');
    await vi.waitFor(() => expect(result().status).toBe('ready'));
    expect(result().peaks.length).toBeGreaterThan(0);
  });

  it('is idle for null/undefined and never constructs an AudioContext', () => {
    expect(createAudioWaveform(null)().status).toBe('idle');
    expect(createAudioWaveform(undefined)().status).toBe('idle');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('reports peaks and duration from a real decode', async () => {
    FakeAudioContext.behaviour = { kind: 'resolve', buffer: makeAudioBuffer([0.5, -1, 0.25, 0.1], 3) };
    const result = createAudioWaveform(makeBlob(), { buckets: 4 });

    await vi.waitFor(() => expect(result().status).toBe('ready'));
    expect(result().peaks).toHaveLength(4);
    expect(result().durationMs).toBe(3000);
    expect(result().errorCode).toBeNull();
  });

  it('closes the AudioContext once decoding settles, success or failure', async () => {
    const ready = createAudioWaveform(makeBlob());
    await vi.waitFor(() => expect(ready().status).toBe('ready'));
    await vi.waitFor(() => expect(last(FakeAudioContext.instances)?.close).toHaveBeenCalledTimes(1));

    FakeAudioContext.behaviour = { kind: 'reject' };
    const failed = createAudioWaveform(makeBlob([9, 9, 9]));
    await vi.waitFor(() => expect(failed().status).toBe('failed'));
    expect(failed().errorCode).toBe('decode-failed');
    await vi.waitFor(() => expect(last(FakeAudioContext.instances)?.close).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// A signal blob requires an injector — the documented throw
// ---------------------------------------------------------------------------

describe('a signal Blob with no injector available', () => {
  it('throws a clear, actionable error rather than silently decoding once and going stale', () => {
    const blob = signal<Blob | null>(makeBlob());

    expect(() => createAudioWaveform(blob)).toThrow(/no injector/i);
    expect(FakeAudioContext.instances, 'must not have started a decode it can never update').toHaveLength(0);
  });

  it('also throws inside an injection context that never resolved an Injector — passing { injector: null } opts out explicitly', () => {
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob());

    expect(() =>
      runInInjectionContext(host.injector, () => createAudioWaveform(blob, { injector: null })),
    ).toThrow(/no injector/i);

    host.destroy();
  });
});

// ---------------------------------------------------------------------------
// A signal blob with an injector: reactive, and only the newest decode wins
// ---------------------------------------------------------------------------

describe('a signal Blob with an injector', () => {
  it('re-decodes when the signal changes, using the ambient injector found via an injection context', async () => {
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob([1, 1, 1]));

    const result = runInInjectionContext(host.injector, () => createAudioWaveform(blob));
    host.flushEffects();

    await vi.waitFor(() => expect(result().status).toBe('ready'));
    expect(FakeAudioContext.instances).toHaveLength(1);

    blob.set(makeBlob([2, 2, 2]));
    host.flushEffects();
    await vi.waitFor(() => expect(FakeAudioContext.instances).toHaveLength(2));
    await vi.waitFor(() => expect(result().status).toBe('ready'));

    host.destroy();
  });

  it('goes back to idle when the signal is cleared', async () => {
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob());

    const result = runInInjectionContext(host.injector, () => createAudioWaveform(blob));
    host.flushEffects();
    await vi.waitFor(() => expect(result().status).toBe('ready'));

    blob.set(null);
    host.flushEffects();
    expect(result().status).toBe('idle');
    expect(result().peaks).toEqual([]);

    host.destroy();
  });

  it('a second blob emitted while the first decode is in flight — only the newest result is published', async () => {
    FakeAudioContext.behaviour = { kind: 'pending' };
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob([1, 1, 1]));

    const result = runInInjectionContext(host.injector, () => createAudioWaveform(blob, { buckets: 2 }));
    host.flushEffects();
    await vi.waitFor(() => expect(FakeAudioContext.pending).toHaveLength(1));
    expect(result().status).toBe('loading');

    // Swap the blob while the first decode is still unresolved.
    blob.set(makeBlob([2, 2, 2]));
    host.flushEffects();
    await vi.waitFor(() => expect(FakeAudioContext.pending).toHaveLength(2));

    const settleFirst = FakeAudioContext.pending[0];
    const settleSecond = FakeAudioContext.pending[1];
    if (settleFirst === undefined || settleSecond === undefined) throw new Error('missing pending decode');

    // Settle the FIRST (now-stale) decode first. Its result must never reach
    // the published signal — this is the whole point of the `generation`
    // token in waveform.ts.
    settleFirst(makeAudioBuffer([1, 1], 9));
    await Promise.resolve();
    expect(result().status, 'the stale result was dropped, not applied').toBe('loading');
    expect(result().durationMs).toBeNull();

    settleSecond(makeAudioBuffer([0.5, 0.25], 4));
    await vi.waitFor(() => expect(result().status).toBe('ready'));
    expect(result().durationMs, 'only the newest (second) decode landed').toBe(4000);

    // Both contexts closed — including the one whose result was thrown away.
    await vi.waitFor(() => {
      for (const context of FakeAudioContext.instances) expect(context.close).toHaveBeenCalledTimes(1);
    });
    expect(FakeAudioContext.instances).toHaveLength(2);

    host.destroy();
  });

  it('stops decoding future signal changes once the injector is destroyed', async () => {
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob([1, 1, 1]));

    const result = runInInjectionContext(host.injector, () => createAudioWaveform(blob));
    host.flushEffects();
    await vi.waitFor(() => expect(result().status).toBe('ready'));
    expect(FakeAudioContext.instances).toHaveLength(1);

    host.destroy();

    blob.set(makeBlob([2, 2, 2]));
    // Nothing left to flush against — the effect is gone with the injector.
    // A real app confirms this by the absence of a second decode.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeAudioContext.instances, 'the destroyed effect must not have started a new decode').toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Usable outside an injection context — as long as the blob is not a signal
// ---------------------------------------------------------------------------

describe('outside an injection context', () => {
  it('a plain Blob decodes fine with zero DI setup anywhere', async () => {
    const result = createAudioWaveform(makeBlob());
    await vi.waitFor(() => expect(result().status).toBe('ready'));
  });

  it('an explicit injector option is honoured over the ambient ("no ambient" here) ', async () => {
    const host = createAngularTestHost();
    const blob = signal<Blob | null>(makeBlob());

    // No runInInjectionContext — the injector is supplied directly.
    const result = createAudioWaveform(blob, { injector: host.injector });
    host.flushEffects();
    await vi.waitFor(() => expect(result().status).toBe('ready'));

    host.destroy();
  });
});
