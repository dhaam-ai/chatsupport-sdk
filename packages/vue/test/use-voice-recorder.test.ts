// @vitest-environment jsdom
//
// jsdom implements neither `navigator.mediaDevices` nor `MediaRecorder`, so
// both are stubbed here — trimmed down from
// packages/react/test/use-voice-recorder.test.ts's stubs to what this file's
// assertions need. `AudioContext` is deliberately left unstubbed: jsdom has no
// Web Audio API either, so `attachAnalyser` (browser/src/voice-recorder.ts)
// finds `AudioContextCtor === undefined` and returns early — recording
// proceeds normally with `amplitude` pinned at 0, and nothing here needs it.
//
// The property that is specifically THIS binding's to get right: teardown
// goes through `onChatScopeDispose` (scope.ts), not `onUnmounted`, so a
// microphone opened from a Pinia store action or a Nuxt composable — code
// that runs inside a bare `effectScope()` with no component instance — must
// release its tracks exactly like an unmounted component does. What leaks if
// it doesn't is not a listener, it is the OS's recording indicator.

import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, nextTick } from 'vue';

import { useVoiceRecorder } from '../src/index.js';
import type { UseVoiceRecorderResult } from '../src/index.js';

enableAutoUnmount(afterEach);

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

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Handed to `ondataavailable` when `stop()` runs. */
  chunks: Blob[] = [new Blob(['audio-bytes'])];

  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // Asynchronous on purpose: the real `MediaRecorder` fires `onstop` in a
    // later task, never inline with the `stop()` call.
    queueMicrotask(() => {
      for (const chunk of this.chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    });
  }
}

function namedError(name: string, message = ''): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Same idea as harness.ts's `runInChatScope`, minus the ChatClient this composable never needs. */
function runInScope<T>(fn: () => T): { value: T; stop: () => void } {
  const scope = effectScope();
  const value = scope.run(fn) as T;
  return { value, stop: () => scope.stop() };
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

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(['audio/webm']);
  installMediaDevices();
  globals.MediaRecorder = FakeMediaRecorder;
});

afterEach(() => {
  delete globals.MediaRecorder;
});

// ---------------------------------------------------------------------------
// Property: the microphone is released when the owning scope stops, whether
// that scope belongs to a component or to nothing but itself.
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — releases the microphone when its scope stops', () => {
  it('stops every MediaStream track when a bare effectScope() is stopped mid-recording', async () => {
    // No component anywhere in this test — a Pinia store action or a Nuxt
    // composable runs exactly like this. onChatScopeDispose is what makes
    // this path tear down identically to an unmounted component; proving it
    // here, with @vue/test-utils entirely out of the loop, is what makes
    // that guarantee real rather than an artifact of how mount() happens to
    // unmount things.
    const { value: recorder, stop } = runInScope(() => useVoiceRecorder());

    await recorder.start();
    const track = currentStream.tracks[0];
    expect(track?.stop).not.toHaveBeenCalled();

    stop();

    expect(track?.stop, 'stopping the effect scope must stop the live microphone, not just unsubscribe').toHaveBeenCalledTimes(
      1,
    );
  });

  it('stops every MediaStream track when the owning component unmounts', async () => {
    let api!: UseVoiceRecorderResult;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useVoiceRecorder();
          return () => h('div', api.state.value.isRecording ? 'recording' : 'idle');
        },
      }),
    );

    expect(wrapper.text()).toBe('idle');
    await api.start();
    await nextTick();
    expect(wrapper.text(), 'the template reads the same shallowRef the leak check is about to exercise').toBe(
      'recording',
    );

    const track = currentStream.tracks[0];
    expect(track?.stop).not.toHaveBeenCalled();

    wrapper.unmount();

    expect(track?.stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Property: no active scope warns rather than silently leaking, and the
// recorder handed back is still fully functional.
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — no active effect scope', () => {
  it('warns instead of leaking, and the recorder it hands back still works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Called at the top level of this test — no setup(), no effectScope() —
    // exactly the mistake onChatScopeDispose exists to catch.
    const recorder = useVoiceRecorder();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('useVoiceRecorder');
    expect(warn.mock.calls[0]?.[0]).toContain('no active effect scope');

    // scope.ts's whole point: the subscription is already live, so the
    // *value* stays correct even though nothing will ever tear it down.
    await recorder.start();
    expect(recorder.state.value.isRecording).toBe(true);
    const recording = await recorder.stop();
    expect(recording).not.toBeNull();
    expect(recording?.blob).toBeInstanceOf(Blob);

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Property: `state` tracks the recorder's real progress.
// ---------------------------------------------------------------------------

describe('useVoiceRecorder — state progression', () => {
  it('start() flips isRecording, and stop() resolves a recording carrying the blob', async () => {
    const { value: recorder, stop } = runInScope(() => useVoiceRecorder());

    expect(recorder.state.value.isRecording).toBe(false);

    await recorder.start();
    expect(recorder.state.value.isRecording).toBe(true);
    expect(recorder.state.value.error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    const recording = await recorder.stop();
    expect(recording).not.toBeNull();
    expect(recording?.blob).toBeInstanceOf(Blob);
    expect(recording?.blob.size).toBeGreaterThan(0);
    expect(recorder.state.value.isRecording).toBe(false);

    stop();
  });

  it('surfaces a classified error on state and leaves no MediaRecorder behind', async () => {
    // A minimal error-path sanity check: proves this binding passes
    // `state.error` through untouched rather than swallowing or reshaping
    // it. The full error-code matrix is @dhaam-ccrm/browser's own contract,
    // already exercised end-to-end via the React binding's suite.
    getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError', 'Permission denied'));
    const { value: recorder, stop } = runInScope(() => useVoiceRecorder());

    await recorder.start();

    expect(recorder.state.value.error?.code).toBe('permission-denied');
    expect(recorder.state.value.isRecording).toBe(false);
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    stop();
  });
});
