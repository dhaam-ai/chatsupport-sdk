// The voice recorder, projected onto Angular signals.
//
// The state machine — `getUserMedia`, `MediaRecorder`, the eight distinct
// failure codes, and the rule that EVERY exit path releases the MediaStream —
// lives in `@dhaam-ccrm/browser`'s `createVoiceRecorder`. This file is the same
// kind of wiring `chat-store.ts` is for core: a subscription, a `signal.set`,
// and teardown on `DestroyRef`. No media logic lives here.
//
// Zone handling mirrors chat-store.ts exactly, and for the same reason: the
// recorder's amplitude meter ticks from a `setInterval` that may be outside
// Angular's zone, and under
// `provideZoneChangeDetection({ ignoreChangesOutsideZone: true })` a signal
// write there would leave the meter frozen on screen. Structural notification
// (Angular ≥18) covers the default and zoneless cases; the explicit
// `ngZone.run` covers that one flag.

import { createVoiceRecorder as createBrowserVoiceRecorder } from '@dhaam-ccrm/browser';
import type { VoiceRecorderOptions, VoiceRecorderState, VoiceRecording } from '@dhaam-ccrm/browser';
import { computed, signal, DestroyRef, NgZone } from '@angular/core';
import type { Signal } from '@angular/core';

import { injectIfAvailable } from './injection-context.js';
import type { ZoneRunner } from './chat-store.js';

export interface VoiceRecorderStoreOptions extends VoiceRecorderOptions {
  /**
   * The zone to re-enter when a recorder notification arrives outside
   * Angular's. Defaults to the ambient `NgZone` when built inside an injection
   * context; pass `null` to opt out (a zoneless app loses nothing).
   */
  ngZone?: ZoneRunner | null;

  /**
   * Tear down on this `DestroyRef`. Defaults to the ambient one when built
   * inside an injection context. Pass `null` to own `destroy()` yourself —
   * and then actually call it, because what leaks otherwise is a live
   * microphone, not just a listener.
   */
  destroyRef?: { onDestroy: (callback: () => void) => void } | null;
}

export interface VoiceRecorderStore {
  /** The whole state as one signal. */
  state: Signal<VoiceRecorderState>;

  /** Field signals, for a template that binds one thing. Each is `computed` off {@link VoiceRecorderStore.state}, so they cost nothing when unread. */
  isRecording: Signal<boolean>;
  durationMs: Signal<number>;
  amplitude: Signal<number>;
  error: Signal<VoiceRecorderState['error']>;
  isSupported: Signal<boolean>;

  /** Requests the microphone and begins recording. Never throws: failures land on `error()`. */
  start: () => Promise<void>;
  /** Stops and resolves the recording, or `null` if nothing was recording (or the take was cancelled). */
  stop: () => Promise<VoiceRecording | null>;
  /** Stops and discards. Resolves any in-flight `stop()` with `null`. */
  cancel: () => void;

  /** Re-probe support. Called once at construction on a client; call again after a permissions change if you want the flag refreshed. */
  refreshSupport: () => void;

  /** Stop everything and release the microphone. Idempotent, and automatic when a `DestroyRef` was available. */
  destroy: () => void;
}

/**
 * A microphone recorder as an Angular store.
 *
 * ```ts
 * @Component({ ... })
 * export class Composer {
 *   readonly voice = createVoiceRecorder();
 *   async send() {
 *     const take = await this.voice.stop();
 *     if (take) await this.chat.sendAttachment(take.blob, { fileName: 'voice.webm' });
 *   }
 * }
 * ```
 *
 * Usable outside an injection context (a plain test, the conformance suite) —
 * it just cannot find a `DestroyRef` there, so `destroy()` becomes yours.
 */
export function createVoiceRecorder(options: VoiceRecorderStoreOptions = {}): VoiceRecorderStore {
  const { ngZone: ngZoneOption, destroyRef: destroyRefOption, ...recorderOptions } = options;

  const ngZone = ngZoneOption === undefined ? injectIfAvailable(NgZone) : ngZoneOption;
  const destroyRef = destroyRefOption === undefined ? injectIfAvailable(DestroyRef) : destroyRefOption;

  const recorder = createBrowserVoiceRecorder(recorderOptions);
  const state = signal<VoiceRecorderState>(recorder.getSnapshot());

  function publish(): void {
    const next = recorder.getSnapshot();
    if (ngZone !== null && !NgZone.isInAngularZone()) {
      ngZone.run(() => state.set(next));
      return;
    }
    state.set(next);
  }

  const unsubscribe = recorder.subscribe(publish);

  // Only on a client. On a server this would publish `isSupported: false` into
  // the rendered HTML — a disabled mic button that enables itself after
  // hydration, which the `true`-until-proven default exists to avoid.
  if (typeof window !== 'undefined') recorder.refreshSupport();

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    recorder.destroy();
  };

  destroyRef?.onDestroy(destroy);

  return {
    state: state.asReadonly(),
    isRecording: computed(() => state().isRecording),
    durationMs: computed(() => state().durationMs),
    amplitude: computed(() => state().amplitude),
    error: computed(() => state().error),
    isSupported: computed(() => state().isSupported),

    start: () => recorder.start(),
    stop: () => recorder.stop(),
    cancel: () => recorder.cancel(),
    refreshSupport: () => recorder.refreshSupport(),
    destroy,
  };
}
