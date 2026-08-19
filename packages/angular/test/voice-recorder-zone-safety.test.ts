// @vitest-environment jsdom
//
// The zone.js half of `createVoiceRecorder`, tested against a REAL `NgZone`
// with real zone.js loaded — same reasoning as `zone-safety.test.ts`, and
// split into its own file for the same reason that one is separate from
// `chat-store.test.ts`: importing zone.js is a global, module-scoped side
// effect, and every other test in `voice-recorder.test.ts` is written to run
// correctly with or without it.
//
// The bug this guards against: the amplitude meter ticks from a
// `setInterval` that may fire outside Angular's zone (this module's header
// in `voice-recorder.ts` explains why), and under
// `provideZoneChangeDetection({ ignoreChangesOutsideZone: true })` a signal
// write there would leave the meter frozen on screen even though the state
// itself is correct.
//
// zone.js is imported for its side effect (patching setInterval/Promise) and
// is a devDependency only — the shipped package never imports it.

import 'zone.js';

import { NgZone } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVoiceRecorder } from '../src/index.js';
import type { ZoneRunner } from '../src/index.js';

// ---------------------------------------------------------------------------
// The same MediaRecorder/getUserMedia/AudioContext stubs as voice-recorder.test.ts.
// Duplicated rather than shared: this file's only reason to exist is the
// zone.js import, and sharing a module across the two would either drag that
// import into the non-zone file or split the stub from its user.
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
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  chunks: Blob[] = [new Blob(['audio-bytes'])];

  constructor(readonly stream: FakeStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    queueMicrotask(() => {
      for (const chunk of this.chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    });
  }
}

class FakeAnalyser {
  fftSize = 2048;
  getByteTimeDomainData(target: Uint8Array): void {
    target.fill(128);
  }
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => {}, disconnect: () => {} };
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
let currentStream: FakeStream;

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  currentStream = makeStream();
  getUserMedia = vi.fn(async () => currentStream);
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
  globals.MediaRecorder = FakeMediaRecorder;
  globals.AudioContext = FakeAudioContext;
  globals.isSecureContext = true;
});

afterEach(() => {
  delete globals.MediaRecorder;
  delete globals.AudioContext;
  delete globals.isSecureContext;
});

/** Records every `run()` and whether Angular's zone was already active when it happened — identical shape to zone-safety.test.ts's helper. */
function recordingZone(zone: NgZone): { runner: ZoneRunner; runs: boolean[]; insideDuringWrite: boolean[]; reset: () => void } {
  const runs: boolean[] = [];
  const insideDuringWrite: boolean[] = [];
  return {
    runs,
    insideDuringWrite,
    reset: () => {
      runs.length = 0;
      insideDuringWrite.length = 0;
    },
    runner: {
      run<T>(fn: () => T): T {
        runs.push(NgZone.isInAngularZone());
        return zone.run(() => {
          insideDuringWrite.push(NgZone.isInAngularZone());
          return fn();
        });
      },
    },
  };
}

describe('voice recorder zone safety', () => {
  // Both tests below trigger the notification through `stop()`, not
  // `start()`. `start()`'s only synchronous-after-`await` write crosses a
  // native `await navigator.mediaDevices.getUserMedia(...)` boundary, and
  // esbuild leaves native async/await un-downleveled at this repo's ES2020
  // target — which zone.js's Promise patch does not reliably propagate
  // through in every engine (a documented zone.js limitation, not a bug in
  // the binding). `stop()`'s notification instead rides `queueMicrotask`
  // (via the fake `MediaRecorder`'s `onstop`), which zone.js patches
  // directly and does propagate reliably — the same primitive the
  // `ChatStore` zone-safety tests lean on via `queueMicrotask`-scheduled
  // flushes. This keeps the test asserting the binding's zone re-entry
  // logic rather than an unrelated zone.js/native-async interaction.

  it('re-enters the Angular zone when a recorder notification arrives outside it', async () => {
    const zone = new NgZone({});
    const recorder = recordingZone(zone);
    const store = createVoiceRecorder({ ngZone: recorder.runner, destroyRef: null });

    // Get a live recording going first — which zone THIS happens in is not
    // under test, so it runs unwrapped.
    await store.start();
    recorder.reset();

    await new Promise<void>((resolve) => {
      zone.runOutsideAngular(() => {
        expect(NgZone.isInAngularZone(), 'precondition: we really are outside the Angular zone').toBe(false);
        void store.stop().then(() => resolve());
      });
    });

    expect(recorder.runs.length, 'stop() publishes the isRecording:false transition').toBeGreaterThan(0);
    expect(recorder.runs.every((wasInsideAtCallTime) => wasInsideAtCallTime === false), 'every re-entry originated from outside the zone').toBe(
      true,
    );
    expect(recorder.insideDuringWrite.every(Boolean), 'and every write itself happened INSIDE the zone once re-entered').toBe(
      true,
    );
    expect(store.isRecording(), 'and the value landed').toBe(false);

    store.destroy();
  });

  it('does not re-enter when the notification already arrives inside the Angular zone', async () => {
    const zone = new NgZone({});
    const recorder = recordingZone(zone);
    const store = createVoiceRecorder({ ngZone: recorder.runner, destroyRef: null });

    await store.start();
    recorder.reset();

    await new Promise<void>((resolve) => {
      zone.run(() => {
        expect(NgZone.isInAngularZone(), 'precondition: we really are inside the Angular zone').toBe(true);
        void store.stop().then(() => resolve());
      });
    });

    expect(recorder.runs, 'no redundant re-entry when the zone is already active').toEqual([]);
    expect(store.isRecording(), 'and the value still landed').toBe(false);

    store.destroy();
  });

  it('updates without any NgZone at all — the zoneless path', async () => {
    const store = createVoiceRecorder({ ngZone: null, destroyRef: null });

    await store.start();
    expect(store.isRecording()).toBe(true);

    store.destroy();
  });
});
