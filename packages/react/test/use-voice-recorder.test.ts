// @vitest-environment jsdom
//
// jsdom implements none of `navigator.mediaDevices`, `MediaRecorder`, or
// `AudioContext`, so all three are stubbed here rather than requiring a real
// browser with a real microphone. The stubs model the parts of each contract
// the hook actually depends on — `MediaRecorder.state` transitions, the
// `ondataavailable`/`onstop`/`onerror` callback order, and above all
// `MediaStreamTrack.stop()`, which is what the "does the tab keep showing the
// recording indicator" assertions are really testing.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVoiceRecorder } from '../src/use-voice-recorder.js';

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
  /** Set to a mime string to make the constructor throw, simulating an unsupported codec. */
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
    this.state = 'inactive';
    // Asynchronous on purpose: the real `MediaRecorder` flushes its last
    // chunk and fires `onstop` in a later task, never inline with the
    // `stop()` call. A synchronous stub would make `stop()` resolve before a
    // `cancel()` on the next line could ever be observed, which is exactly
    // the race the cancel-after-stop test exists to cover.
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
  /** Byte value every sample reads back as. 128 is silence; 255 is full deflection. */
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

/**
 * `Array.prototype.at` is ES2022 and this repo's tsconfig.base.json targets
 * ES2020 — vitest's esbuild transform accepts it, `tsc --noEmit -p
 * tsconfig.test.json` does not. Same semantics, no lib bump.
 */
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
  cleanup();
  vi.useRealTimers();
  delete globals.MediaRecorder;
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
  delete globals.isSecureContext;
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — recording', () => {
  it('starts, records, and resolves a blob whose mime type came from the recorder', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      recording = await result.current.stop();
    });

    expect(recording).not.toBeNull();
    expect(recording!.mimeType).toBe('audio/webm');
    expect(recording!.blob.size).toBeGreaterThan(0);
    expect(result.current.isRecording).toBe(false);
  });

  it('reuses v1s codec probe: webm when supported, mp4 otherwise', async () => {
    const webm = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await webm.result.current.start();
    });
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/webm');
    await act(async () => {
      await webm.result.current.stop();
    });
    webm.unmount();

    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4']);
    const mp4 = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await mp4.result.current.start();
    });
    expect(last(FakeMediaRecorder.instances)?.mimeType).toBe('audio/mp4');
    await act(async () => {
      await mp4.result.current.stop();
    });
  });

  it('stop() releases every microphone track', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    const track = currentStream.tracks[0];
    expect(track?.stop).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop();
    });

    expect(track?.stop).toHaveBeenCalledTimes(1);
  });

  it('cancel() while recording discards the take, releases the tracks, and clears the elapsed timer', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    // Let the elapsed timer actually accumulate, so "back to 0" is a real
    // assertion rather than a restatement of the initial value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.durationMs).toBeGreaterThan(0);

    const track = currentStream.tracks[0];

    await act(async () => {
      result.current.cancel();
      await Promise.resolve();
    });

    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.durationMs).toBe(0);
  });

  it('cancel() racing an in-flight stop() resolves that stop with null rather than the audio', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    const track = currentStream.tracks[0];

    let recording: unknown = 'unset';
    await act(async () => {
      const pending = result.current.stop();
      result.current.cancel();
      recording = await pending;
    });

    expect(recording).toBeNull();
    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
  });

  it('resolves null rather than a zero-byte blob when the recorder produced no chunks', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    const recorder = last(FakeMediaRecorder.instances);
    if (recorder === undefined) throw new Error('no recorder');
    recorder.chunks = [];

    let recording: unknown = 'unset';
    await act(async () => {
      recording = await result.current.stop();
    });
    expect(recording).toBeNull();
  });

  it('stop() with nothing recording resolves null instead of hanging', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    let recording: unknown = 'unset';
    await act(async () => {
      recording = await result.current.stop();
    });
    expect(recording).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — failure modes', () => {
  it('reports permission-denied and leaks no stream', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission denied'));
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error?.code).toBe('permission-denied');
    expect(result.current.isRecording).toBe(false);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('distinguishes a dismissed prompt from a denial', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission dismissed'));
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error?.code).toBe('permission-dismissed');
  });

  it('reports no-microphone for NotFoundError', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotFoundError'));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error?.code).toBe('no-microphone');
  });

  it('reports microphone-busy for NotReadableError', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('NotReadableError'));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error?.code).toBe('microphone-busy');
  });

  it('reports aborted for AbortError', async () => {
    getUserMedia.mockRejectedValueOnce(namedError('AbortError'));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error?.code).toBe('aborted');
  });

  it('reports insecure-context when mediaDevices is missing on a non-secure page', async () => {
    removeMediaDevices();
    globals.isSecureContext = false;

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error?.code).toBe('insecure-context');
    expect(result.current.isSupported).toBe(false);
  });

  it('reports unsupported when the API is missing on a secure page', async () => {
    removeMediaDevices();
    globals.isSecureContext = true;

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error?.code).toBe('unsupported');
  });

  it('reports unsupported and releases the stream when the MediaRecorder constructor throws', async () => {
    FakeMediaRecorder.throwOnConstruct = true;
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error?.code).toBe('unsupported');
    expect(currentStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('reports recorder-failed and releases the stream when the recorder errors mid-take', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    const track = currentStream.tracks[0];
    act(() => {
      last(FakeMediaRecorder.instances)?.fail();
    });

    expect(result.current.error?.code).toBe('recorder-failed');
    expect(result.current.isRecording).toBe(false);
    expect(track?.stop).toHaveBeenCalledTimes(1);
  });

  it('records normally when the AudioContext cannot be constructed — the meter is decoration', async () => {
    FakeAudioContext.throwOnConstruct = true;
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isRecording).toBe(true);
    expect(result.current.amplitude).toBe(0);

    let recording: unknown = null;
    await act(async () => {
      recording = await result.current.stop();
    });
    expect(recording).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resource release
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — resource release', () => {
  it('unmounting mid-recording stops the tracks (the tab recording indicator) and closes the AudioContext', async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    const track = currentStream.tracks[0];
    const context = last(FakeAudioContext.instances);
    expect(context).toBeDefined();
    expect(track?.stop).not.toHaveBeenCalled();

    unmount();

    expect(track?.stop).toHaveBeenCalledTimes(1);
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('closes the AudioContext on a normal stop too', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    const context = last(FakeAudioContext.instances);

    await act(async () => {
      await result.current.stop();
    });

    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it('stops a stream granted after the component already unmounted', async () => {
    // The permission prompt was still open when the widget closed. Nothing
    // else will ever stop this stream.
    let releaseGrant: (stream: FakeStream) => void = () => {};
    const pendingStream = makeStream();
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          releaseGrant = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useVoiceRecorder());

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });

    unmount();

    await act(async () => {
      releaseGrant(pendingStream);
      await started;
    });

    expect(pendingStream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Live signals
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — live duration and amplitude', () => {
  it('advances durationMs while recording and stops advancing after stop', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.durationMs).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.durationMs).toBeGreaterThanOrEqual(900);

    const atStop = result.current.durationMs;
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.durationMs).toBe(atStop);
  });

  it('exposes a live amplitude derived from the analyser, and returns to 0 on stop', async () => {
    vi.useFakeTimers();
    FakeAnalyser.sampleValue = 128; // silence
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.amplitude).toBe(0);

    // Full deflection: (255 - 128) / 128 ≈ 0.992 RMS on a constant signal.
    FakeAnalyser.sampleValue = 255;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.amplitude).toBeGreaterThan(0.9);
    expect(result.current.amplitude).toBeLessThanOrEqual(1);

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.amplitude).toBe(0);
  });

  it('a second start() while already recording is ignored rather than acquiring a second stream', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    await act(async () => {
      await result.current.stop();
    });
  });

  it('reports isSupported=false on mount in an environment with no media stack', async () => {
    removeMediaDevices();
    const { result } = renderHook(() => useVoiceRecorder());
    await waitFor(() => {
      expect(result.current.isSupported).toBe(false);
    });
  });
});
