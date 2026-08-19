// @vitest-environment jsdom
//
// jsdom implements none of `navigator.mediaDevices`, `MediaRecorder`, or
// `AudioContext`, so all three are stubbed here rather than requiring a real
// browser with a real microphone. Stubs ported from
// packages/react/test/use-voice-recorder.test.ts, which model the parts of
// each contract this state machine actually depends on — `MediaRecorder.state`
// transitions, the `ondataavailable`/`onstop`/`onerror` callback order, and
// above all `MediaStreamTrack.stop()`, which is what the "does the tab keep
// showing the recording indicator" assertions are really testing. Driven
// directly against `createVoiceRecorder()` here instead of through a hook —
// there is no framework in this package to render through.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyMediaError, createVoiceRecorder, probeVoiceSupport } from '../src/voice-recorder.js';
import type { VoiceRecorder, VoiceRecorderOptions, VoiceRecording } from '../src/voice-recorder.js';

// ---------------------------------------------------------------------------
// Stubs
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
  /** Set to make the constructor throw, simulating an unsupported codec. */
  static throwOnConstruct = false;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Chunks handed to `ondataavailable` when `stop()` runs. Empty array = a take with no audio. */
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
    // Spec-accurate on purpose: real `MediaRecorder.stop()` sets `.state` to
    // "inactive" SYNCHRONOUSLY as part of the call — the `dataavailable`/
    // `stop` events are what's deferred to a queued task, not the state
    // transition itself. Several assertions below depend on this exact
    // ordering (see the "double stop()" test).
    this.state = 'inactive';
    queueMicrotask(() => {
      for (const chunk of this.chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    });
  }

  /** Test hook: the recorder failing after it started. */
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

// ---------------------------------------------------------------------------
// Environment wiring
// ---------------------------------------------------------------------------

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

/** Every recorder a test constructs, so `afterEach` can guarantee teardown even when a test forgets to. */
let recorders: VoiceRecorder[] = [];
function newRecorder(options?: VoiceRecorderOptions): VoiceRecorder {
  const recorder = options === undefined ? createVoiceRecorder() : createVoiceRecorder(options);
  recorders.push(recorder);
  return recorder;
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(['audio/webm']);
  FakeMediaRecorder.throwOnConstruct = false;
  FakeAudioContext.instances = [];
  FakeAudioContext.throwOnConstruct = false;
  FakeAnalyser.sampleValue = 128;
  FakeAnalyser.shouldThrow = false;
  recorders = [];

  installMediaDevices();
  globals.MediaRecorder = FakeMediaRecorder;
  globals.AudioContext = FakeAudioContext;
  globals.isSecureContext = true;
});

afterEach(() => {
  for (const recorder of recorders) recorder.destroy();
  recorders = [];
  vi.useRealTimers();
  delete globals.MediaRecorder;
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
  delete globals.isSecureContext;
});

// ---------------------------------------------------------------------------
// classifyMediaError — the getUserMedia rejection -> code table
// ---------------------------------------------------------------------------

describe('classifyMediaError', () => {
  it('maps NotAllowedError without "dismiss" in the message to permission-denied', () => {
    expect(classifyMediaError(namedError('NotAllowedError', 'Permission denied')).code).toBe('permission-denied');
  });

  it('maps NotAllowedError with "dismiss" in the message to permission-dismissed, case-insensitively', () => {
    expect(classifyMediaError(namedError('NotAllowedError', 'Permission Dismissed by user')).code).toBe(
      'permission-dismissed',
    );
  });

  it('treats the legacy PermissionDeniedError name the same as NotAllowedError', () => {
    expect(classifyMediaError(namedError('PermissionDeniedError')).code).toBe('permission-denied');
  });

  it('treats SecurityError as a denial too', () => {
    expect(classifyMediaError(namedError('SecurityError')).code).toBe('permission-denied');
  });

  it('maps NotFoundError and its legacy/overconstrained siblings to no-microphone', () => {
    expect(classifyMediaError(namedError('NotFoundError')).code).toBe('no-microphone');
    expect(classifyMediaError(namedError('DevicesNotFoundError')).code).toBe('no-microphone');
    expect(classifyMediaError(namedError('OverconstrainedError')).code).toBe('no-microphone');
  });

  it('maps NotReadableError and TrackStartError to microphone-busy', () => {
    expect(classifyMediaError(namedError('NotReadableError')).code).toBe('microphone-busy');
    expect(classifyMediaError(namedError('TrackStartError')).code).toBe('microphone-busy');
  });

  it('maps AbortError to aborted', () => {
    expect(classifyMediaError(namedError('AbortError')).code).toBe('aborted');
  });

  it('falls back to unknown for an unrecognized name', () => {
    expect(classifyMediaError(namedError('SomeFutureError')).code).toBe('unknown');
  });

  it('falls back to unknown for a non-error input without throwing', () => {
    expect(classifyMediaError('just a string').code).toBe('unknown');
    expect(classifyMediaError(undefined).code).toBe('unknown');
    expect(classifyMediaError(null).code).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// probeVoiceSupport
// ---------------------------------------------------------------------------

describe('probeVoiceSupport', () => {
  it('reports supported when mediaDevices and MediaRecorder are both present', () => {
    expect(probeVoiceSupport()).toEqual({ supported: true, error: null });
  });

  it('reports insecure-context when mediaDevices is absent on a non-secure page', () => {
    removeMediaDevices();
    globals.isSecureContext = false;
    expect(probeVoiceSupport()).toEqual({
      supported: false,
      error: { code: 'insecure-context', message: expect.any(String) },
    });
  });

  it('reports unsupported (not insecure-context) when mediaDevices is absent on a secure page', () => {
    removeMediaDevices();
    globals.isSecureContext = true;
    expect(probeVoiceSupport().error?.code).toBe('unsupported');
  });

  it('reports unsupported when mediaDevices exists but MediaRecorder does not', () => {
    delete globals.MediaRecorder;
    expect(probeVoiceSupport().error?.code).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — recording', () => {
  it('starts, records, and resolves a blob whose mime type came from the recorder', async () => {
    const recorder = newRecorder();
    await recorder.start();

    expect(recorder.getSnapshot().isRecording).toBe(true);
    expect(recorder.getSnapshot().error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    const recording = await recorder.stop();

    expect(recording).not.toBeNull();
    expect((recording as VoiceRecording).mimeType).toBe('audio/webm');
    expect((recording as VoiceRecording).blob.size).toBeGreaterThan(0);
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });

  it('reuses v1s codec probe: webm when supported, mp4 otherwise', async () => {
    const webm = newRecorder();
    await webm.start();
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/webm');
    await webm.stop();

    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4']);
    const mp4 = newRecorder();
    await mp4.start();
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/mp4');
    await mp4.stop();
  });

  it('resolves null rather than a zero-byte blob when the recorder produced no chunks', async () => {
    const recorder = newRecorder();
    await recorder.start();
    const fake = last(FakeMediaRecorder.instances);
    if (fake === undefined) throw new Error('no recorder');
    fake.chunks = [];

    expect(await recorder.stop()).toBeNull();
  });

  it('stop() with nothing recording resolves null instead of hanging', async () => {
    const recorder = newRecorder();
    expect(await recorder.stop()).toBeNull();
  });

  it('a second start() while already recording is ignored rather than acquiring a second stream', async () => {
    const recorder = newRecorder();
    await recorder.start();
    await recorder.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    await recorder.stop();
  });
});

// ---------------------------------------------------------------------------
// Every exit path stops every track (and closes the AudioContext)
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — every MediaStreamTrack is stopped on every exit path', () => {
  it('stop() releases the microphone track and closes the AudioContext', async () => {
    const recorder = newRecorder();
    await recorder.start();

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);
    expect(track?.stop).not.toHaveBeenCalled();

    await recorder.stop();

    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('cancel() while recording stops the track, closes the AudioContext, and discards the take', async () => {
    const recorder = newRecorder();
    await recorder.start();

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);

    const pending = recorder.stop();
    recorder.cancel();
    const recording = await pending;

    expect(recording).toBeNull();
    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(context?.close).toHaveBeenCalledTimes(1);
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });

  it('cancel() with no pending stop() also stops the track and resolves any caller with null', async () => {
    const recorder = newRecorder();
    await recorder.start();
    const track = currentStream.tracks[0];

    recorder.cancel();
    // `onstop` fires asynchronously (queueMicrotask in the fake); let it run.
    await Promise.resolve();
    await Promise.resolve();

    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });

  it('a recorder error mid-take releases the track and closes the AudioContext', async () => {
    const recorder = newRecorder();
    await recorder.start();

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);
    last(FakeMediaRecorder.instances)?.fail();

    expect(recorder.getSnapshot().error?.code).toBe('recorder-failed');
    expect(recorder.getSnapshot().isRecording).toBe(false);
    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('destroy() mid-recording stops the track (the tab recording indicator) and closes the AudioContext synchronously', async () => {
    const recorder = newRecorder();
    await recorder.start();

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);
    expect(context).toBeDefined();
    expect(track?.stop).not.toHaveBeenCalled();

    recorder.destroy();

    // No await needed: destroy() releases media synchronously rather than
    // waiting for the recorder's own (possibly-async) `onstop`.
    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(context?.close).toHaveBeenCalledTimes(1);

    // The fake's queued `onstop` still fires later; releaseMedia() must be
    // idempotent so the track is not stopped a second time.
    await Promise.resolve();
    await Promise.resolve();
    expect(track?.stop).toHaveBeenCalledTimes(1);
  });

  it('stops a stream granted after destroy() already ran — the tab-indicator race', async () => {
    // The permission prompt was still open when the consumer was destroyed.
    // Nothing else will ever stop this stream once it lands.
    let releaseGrant: (stream: FakeStream) => void = () => {};
    const pendingStream = makeStream();
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          releaseGrant = resolve;
        }),
    );

    const recorder = newRecorder();
    const started = recorder.start();

    recorder.destroy();
    releaseGrant(pendingStream);
    await started;

    expect(pendingStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('stops a stream granted after cancel() already ran — the same race, via cancel', async () => {
    let releaseGrant: (stream: FakeStream) => void = () => {};
    const pendingStream = makeStream();
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          releaseGrant = resolve;
        }),
    );

    const recorder = newRecorder();
    const started = recorder.start();

    recorder.cancel();
    releaseGrant(pendingStream);
    await started;

    expect(pendingStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('reports unsupported and releases the stream when the MediaRecorder constructor throws', async () => {
    FakeMediaRecorder.throwOnConstruct = true;
    const recorder = newRecorder();

    await recorder.start();

    expect(recorder.getSnapshot().error?.code).toBe('unsupported');
    expect(currentStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('records normally when the AudioContext cannot be constructed — the meter is decoration, not a dependency', async () => {
    FakeAudioContext.throwOnConstruct = true;
    const recorder = newRecorder();

    await recorder.start();

    expect(recorder.getSnapshot().error).toBeNull();
    expect(recorder.getSnapshot().isRecording).toBe(true);
    expect(recorder.getSnapshot().amplitude).toBe(0);

    const recording = await recorder.stop();
    expect(recording).not.toBeNull();
    // No context was ever built, so there is nothing to close and nothing
    // should throw trying.
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getSnapshot() identity — the useSyncExternalStore requirement
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — snapshot identity', () => {
  it('getSnapshot() returns the same reference when nothing has changed', () => {
    vi.useFakeTimers();
    const recorder = newRecorder();
    const first = recorder.getSnapshot();
    const second = recorder.getSnapshot();
    expect(second).toBe(first);
  });

  it('getSnapshot() identity changes on a real change and re-stabilizes afterward', async () => {
    vi.useFakeTimers();
    const recorder = newRecorder();
    const before = recorder.getSnapshot();

    await recorder.start();
    const afterStart = recorder.getSnapshot();
    expect(afterStart).not.toBe(before);
    expect(afterStart.isRecording).toBe(true);

    // Two reads with nothing in between (fake timers, not advanced — the
    // amplitude/duration intervals cannot have ticked) must be identical.
    expect(recorder.getSnapshot()).toBe(afterStart);

    await recorder.stop();
  });

  it('subscribe() notifies listeners only on real changes, and unsubscribe stops further notifications', async () => {
    const recorder = newRecorder();
    const listener = vi.fn();
    const unsubscribe = recorder.subscribe(listener);

    await recorder.start();
    expect(listener).toHaveBeenCalled();
    const callsAfterStart = listener.mock.calls.length;

    unsubscribe();
    await recorder.stop();
    expect(listener.mock.calls.length).toBe(callsAfterStart);
  });
});

// ---------------------------------------------------------------------------
// Failure modes surfaced through the public API
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — failure modes', () => {
  it('reports permission-denied and leaks no stream', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission denied'));
    const recorder = newRecorder();

    await recorder.start();

    expect(recorder.getSnapshot().error?.code).toBe('permission-denied');
    expect(recorder.getSnapshot().isRecording).toBe(false);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('distinguishes a dismissed prompt from a denial', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission dismissed'));
    const recorder = newRecorder();
    await recorder.start();
    expect(recorder.getSnapshot().error?.code).toBe('permission-dismissed');
  });

  it('reports insecure-context when mediaDevices is missing on a non-secure page, and marks unsupported', async () => {
    removeMediaDevices();
    globals.isSecureContext = false;

    const recorder = newRecorder();
    await recorder.start();

    expect(recorder.getSnapshot().error?.code).toBe('insecure-context');
    expect(recorder.getSnapshot().isSupported).toBe(false);
  });

  it('reports unsupported when the API is missing on a secure page', async () => {
    removeMediaDevices();
    globals.isSecureContext = true;

    const recorder = newRecorder();
    await recorder.start();

    expect(recorder.getSnapshot().error?.code).toBe('unsupported');
  });

  it('refreshSupport() re-probes and publishes isSupported', () => {
    removeMediaDevices();
    const recorder = newRecorder();
    expect(recorder.getSnapshot().isSupported).toBe(true); // optimistic initial value

    recorder.refreshSupport();
    expect(recorder.getSnapshot().isSupported).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stop() concurrency
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — stop() concurrency', () => {
  it('stop() on a recorder whose MediaRecorder went inactive out-of-band resolves null rather than hanging', async () => {
    const recorder = newRecorder();
    await recorder.start();

    // Simulate an engine/track ending the recorder without ever routing
    // through onstop/onerror — `recorder` (module-internal) is still set,
    // but `.state` already reads 'inactive'.
    const fake = last(FakeMediaRecorder.instances);
    if (fake === undefined) throw new Error('no recorder');
    fake.state = 'inactive';

    const recording = await recorder.stop();
    expect(recording).toBeNull();
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });

  it('two overlapping stop() calls resolve with the SAME recording, not one winner and one null', async () => {
    // `MediaRecorder.stop()` flips `state` to 'inactive' synchronously and
    // fires `onstop` asynchronously, so a second caller in that window sees an
    // inactive recorder. Before the waiter list existed, that second caller
    // got `null` while the first got the audio — indistinguishable at the call
    // site from "the take was empty", so a double-clicked send button silently
    // dropped the voice note. Both callers must agree.
    const recorder = newRecorder();
    await recorder.start();

    const first = recorder.stop();
    const second = recorder.stop();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).not.toBeNull();
    expect(secondResult).toBe(firstResult);
    expect((firstResult as VoiceRecording).blob.size).toBeGreaterThan(0);
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });

  it('cancel() racing an in-flight stop() resolves that stop with null rather than the audio', async () => {
    const recorder = newRecorder();
    await recorder.start();
    const track = currentStream.tracks[0];

    const pending = recorder.stop();
    recorder.cancel();
    const recording = await pending;

    expect(recording).toBeNull();
    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(recorder.getSnapshot().isRecording).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setOptions — read at record time
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — setOptions', () => {
  it('is read at record time: a change lands on the next start(), not the current one', async () => {
    const recorder = newRecorder({ mimeTypes: ['audio/webm'] });
    await recorder.start();
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/webm');
    await recorder.stop();

    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4']);
    recorder.setOptions({ mimeTypes: ['audio/mp4'] });

    await recorder.start();
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/mp4');
    await recorder.stop();
  });
});

// ---------------------------------------------------------------------------
// destroy() — idempotency
// ---------------------------------------------------------------------------

describe('createVoiceRecorder — destroy()', () => {
  it('is idempotent, and every mutation after it becomes a no-op', async () => {
    const recorder = newRecorder();
    await recorder.start();
    const track = currentStream.tracks[0];

    recorder.destroy();
    expect(track?.stop).toHaveBeenCalledTimes(1);

    expect(() => recorder.destroy()).not.toThrow();
    expect(track?.stop).toHaveBeenCalledTimes(1);

    getUserMedia.mockClear();
    await recorder.start();
    expect(getUserMedia).not.toHaveBeenCalled();

    const snapshotBefore = recorder.getSnapshot();
    recorder.setOptions({ mimeTypes: ['audio/mp4'] });
    recorder.refreshSupport();
    expect(recorder.getSnapshot()).toBe(snapshotBefore);

    const listener = vi.fn();
    const unsubscribe = recorder.subscribe(listener);
    expect(() => unsubscribe()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
