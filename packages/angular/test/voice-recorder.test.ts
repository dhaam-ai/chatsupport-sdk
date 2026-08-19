// @vitest-environment jsdom
//
// `createVoiceRecorder` on its own — construction, teardown, and the signal
// projection. What this file deliberately does NOT re-litigate: the eight
// failure codes, the mime-type probe, and the rule that every exit path
// releases the stream all live in `@dhaam-ccrm/browser`'s state machine and
// are its tests' job. This file's job is the wiring `voice-recorder.ts` adds
// on top: does `destroy()` on a `DestroyRef` really stop a live microphone
// (not just drop a listener), do the field signals cost nothing when
// unrelated fields change, and does the whole thing still work with no
// Angular injector in sight at all.
//
// jsdom implements none of `navigator.mediaDevices`, `MediaRecorder`, or
// `AudioContext`, so all three are stubbed below — the same shapes
// `packages/react/test/use-voice-recorder.test.ts` uses, reused here so a
// stream/track/context leak means the same thing in both bindings.

import { effect, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVoiceRecorder } from '../src/index.js';
import { createAngularTestHost } from './angular-test-host.js';

// ---------------------------------------------------------------------------
// Stubs (same contract as packages/react/test/use-voice-recorder.test.ts)
// ---------------------------------------------------------------------------

interface FakeTrack {
  kind: string;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeStream {
  tracks: FakeTrack[];
  getTracks: () => FakeTrack[];
}

function makeStream(): FakeStream {
  const tracks: FakeTrack[] = [{ kind: 'audio', stop: vi.fn() }];
  return { tracks, getTracks: () => tracks };
}

class FakeMediaRecorder {
  static supportedTypes = new Set<string>(['audio/webm']);
  static instances: FakeMediaRecorder[] = [];
  static throwOnConstruct = false;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  chunks: Blob[] = [new Blob(['audio-bytes'])];

  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    if (FakeMediaRecorder.throwOnConstruct) throw new Error('unsupported mimeType');
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // Async on purpose, like the real MediaRecorder: onstop fires in a later
    // task, never inline with stop().
    queueMicrotask(() => {
      for (const chunk of this.chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    });
  }

  fail(): void {
    this.state = 'inactive';
    this.onerror?.({});
  }
}

class FakeAnalyser {
  fftSize = 2048;
  static sampleValue = 128;
  static shouldThrow = false;
  getByteTimeDomainData(target: Uint8Array): void {
    target.fill(FakeAnalyser.sampleValue);
  }
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static throwOnConstruct = false;

  state: AudioContextState = 'running';
  close = vi.fn(async () => {
    this.state = 'closed';
  });

  constructor() {
    if (FakeAudioContext.throwOnConstruct) throw new Error('AudioContext unavailable');
    FakeAudioContext.instances.push(this);
  }

  createAnalyser(): FakeAnalyser {
    if (FakeAnalyser.shouldThrow) throw new Error('createAnalyser failed');
    return new FakeAnalyser();
  }

  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => {}, disconnect: () => {} };
  }
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function namedError(name: string, message = ''): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

let getUserMedia: ReturnType<typeof vi.fn>;
let currentStream: FakeStream;

function installMediaDevices(): void {
  currentStream = makeStream();
  getUserMedia = vi.fn(async () => currentStream);
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
}

function removeMediaDevices(): void {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(['audio/webm']);
  FakeMediaRecorder.throwOnConstruct = false;
  FakeAudioContext.instances = [];
  FakeAudioContext.throwOnConstruct = false;
  FakeAnalyser.sampleValue = 128;
  FakeAnalyser.shouldThrow = false;

  installMediaDevices();
  globals.MediaRecorder = FakeMediaRecorder;
  globals.AudioContext = FakeAudioContext;
  globals.isSecureContext = true;
});

afterEach(() => {
  delete globals.MediaRecorder;
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
  delete globals.isSecureContext;
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('construction', () => {
  it('is readable the instant it is built, and probes support automatically on a client', () => {
    const store = createVoiceRecorder({ destroyRef: null });

    // `refreshSupport()` runs at construction because `typeof window !==
    // 'undefined'` — jsdom provides one — so a fully-stubbed environment
    // reports supported rather than sitting on the SSR-safe `true`-until-
    // proven default until something else asks.
    expect(store.isSupported()).toBe(true);
    expect(store.isRecording()).toBe(false);
    expect(store.durationMs()).toBe(0);
    expect(store.amplitude()).toBe(0);
    expect(store.error()).toBeNull();

    store.destroy();
  });
});

// ---------------------------------------------------------------------------
// Usable outside an injection context
// ---------------------------------------------------------------------------

describe('usable outside an injection context', () => {
  it('createVoiceRecorder() with no ambient injector just does not find a DestroyRef — it does not throw', async () => {
    // No TestBed, no createAngularTestHost, no runInInjectionContext: a
    // plain function call, exactly like a conformance probe or a vanilla
    // script would make.
    let store: ReturnType<typeof createVoiceRecorder> | undefined;
    expect(() => {
      store = createVoiceRecorder();
    }).not.toThrow();
    if (store === undefined) throw new Error('store not constructed');

    await store.start();
    expect(store.isRecording()).toBe(true);

    // Nothing owns teardown here but the caller.
    store.destroy();
    expect(currentStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Teardown — DestroyRef
// ---------------------------------------------------------------------------

describe('teardown', () => {
  it('destroying the injector stops every MediaStreamTrack and closes the AudioContext — a live microphone leak, not merely a listener leak', async () => {
    const host = createAngularTestHost();
    const store = runInInjectionContext(host.injector, () => createVoiceRecorder());

    await store.start();

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);
    expect(track?.stop, 'precondition: recording is live and nothing has stopped it yet').not.toHaveBeenCalled();
    expect(context).toBeDefined();

    host.destroy();

    expect(track?.stop, 'this is the tab recording indicator turning off').toHaveBeenCalledTimes(1);
    expect(context?.close, 'and this is the AudioContext that would otherwise count against the browser cap').toHaveBeenCalledTimes(1);
  });

  it('destroy() is idempotent — a second call must not double-release anything', async () => {
    const store = createVoiceRecorder({ destroyRef: null });
    await store.start();
    const track = currentStream.tracks[0];

    store.destroy();
    expect(track?.stop).toHaveBeenCalledTimes(1);

    expect(() => store.destroy()).not.toThrow();
    expect(track?.stop, 'the second destroy() found nothing left to release').toHaveBeenCalledTimes(1);
  });

  it('passing destroyRef: null means the caller owns teardown — destroying the ambient injector does not touch the microphone', async () => {
    const host = createAngularTestHost();
    const store = runInInjectionContext(host.injector, () => createVoiceRecorder({ destroyRef: null }));

    await store.start();
    const track = currentStream.tracks[0];

    host.destroy();
    expect(track?.stop, 'opted out — the ambient DestroyRef must never have been registered').not.toHaveBeenCalled();

    // The mic is still live; it is the caller's job to close it.
    store.destroy();
    expect(track?.stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Field signals are `computed` off `state`
// ---------------------------------------------------------------------------

describe('field signals', () => {
  it('an unrelated field changing does not bump an unrelated computed’s identity — amplitude ticking must not make isSupported re-notify', async () => {
    const host = createAngularTestHost();
    const store = runInInjectionContext(host.injector, () => createVoiceRecorder());

    let isSupportedRuns = 0;
    effect(
      () => {
        store.isSupported();
        isSupportedRuns += 1;
      },
      { injector: host.injector },
    );
    host.flushEffects();
    expect(isSupportedRuns, 'the effect runs once on creation').toBe(1);

    // start() alone fires several patches: isSupported (unchanged, still
    // true), error/duration/amplitude reset, then isRecording flips.
    await store.start();
    host.flushEffects();

    // Let the amplitude meter genuinely tick a few times (default interval
    // 50ms) rather than asserting against a single synthetic write — each
    // tick is a brand-new state snapshot object, which is exactly what would
    // fool a hand-rolled computed that compared snapshot identity instead of
    // the one field it exposes.
    await new Promise((resolve) => setTimeout(resolve, 160));
    host.flushEffects();

    expect(
      isSupportedRuns,
      'isSupported’s VALUE never changed across construction, start(), or a run of amplitude ticks, so a consumer reading only it must never re-run',
    ).toBe(1);

    store.destroy();
    host.destroy();
  });

  it('a field that DID change still notifies its own computed', async () => {
    const host = createAngularTestHost();
    const store = runInInjectionContext(host.injector, () => createVoiceRecorder());

    let isRecordingRuns = 0;
    effect(
      () => {
        store.isRecording();
        isRecordingRuns += 1;
      },
      { injector: host.injector },
    );
    host.flushEffects();
    expect(isRecordingRuns).toBe(1);

    await store.start();
    host.flushEffects();
    expect(isRecordingRuns, 'false -> true is a real change').toBe(2);

    await store.stop();
    host.flushEffects();
    expect(isRecordingRuns, 'true -> false is a real change too').toBe(3);

    store.destroy();
    host.destroy();
  });
});

// ---------------------------------------------------------------------------
// State projection — the wrapper reflects the browser primitive faithfully
// ---------------------------------------------------------------------------

describe('state projection', () => {
  it('start/stop round-trips into a recording, then back to idle', async () => {
    const store = createVoiceRecorder({ destroyRef: null });

    await store.start();
    expect(store.isRecording()).toBe(true);
    expect(store.error()).toBeNull();

    const recording = await store.stop();
    expect(recording).not.toBeNull();
    expect(recording?.blob.size).toBeGreaterThan(0);
    expect(store.isRecording()).toBe(false);

    store.destroy();
  });

  it('cancel() discards the take — stop() was never told to keep it', async () => {
    const store = createVoiceRecorder({ destroyRef: null });
    await store.start();

    const pending = store.stop();
    store.cancel();
    const recording = await pending;

    expect(recording, 'cancel() resolves the in-flight stop() with null').toBeNull();
    expect(store.isRecording()).toBe(false);

    store.destroy();
  });

  it('a getUserMedia rejection lands on the error signal, not an exception', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission denied'));
    const store = createVoiceRecorder({ destroyRef: null });

    await expect(store.start()).resolves.toBeUndefined();

    expect(store.error()?.code).toBe('permission-denied');
    expect(store.isRecording()).toBe(false);
    expect(FakeMediaRecorder.instances, 'nothing was ever constructed after the denial').toHaveLength(0);

    store.destroy();
  });

  it('refreshSupport() re-probes and updates isSupported', () => {
    removeMediaDevices();
    const store = createVoiceRecorder({ destroyRef: null });
    expect(store.isSupported(), 'construction already probed once').toBe(false);

    installMediaDevices();
    store.refreshSupport();
    expect(store.isSupported()).toBe(true);

    store.destroy();
  });
});
