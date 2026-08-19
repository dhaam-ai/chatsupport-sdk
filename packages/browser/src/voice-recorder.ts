// createVoiceRecorder — `getUserMedia` + `MediaRecorder`, with the failure
// modes that actually happen in the field.
//
// ---------------------------------------------------------------------------
// Why this is a plain object and not a hook
// ---------------------------------------------------------------------------
//
// This logic was written once as `@dhaam-ccrm/react`'s `useVoiceRecorder` and
// then written a second time, by hand, as the widget's `ui/voice.ts` — because
// neither Vue nor Angular nor a vanilla page can call a React hook. Two copies
// of a media-teardown path is one copy too many: the rule that EVERY exit path
// releases the MediaStream is the difference between a widget that closes and
// a browser tab that keeps the OS microphone light on afterwards, and a rule
// like that has to live in one place to stay true.
//
// So the state machine lives here, framework-free, behind
// `getSnapshot()`/`subscribe()` — the same shape `useSyncExternalStore`,
// Vue's `shallowRef`, and Angular's `signal` all consume without adaptation.
// The bindings above are wiring, not logic.
//
// ---------------------------------------------------------------------------
// What this is, and what it deliberately is not
// ---------------------------------------------------------------------------
//
// It produces a `Blob`. It does not send one: `sendAttachment` already owns
// that path (§6.3, upload-then-announce), and folding the send in here would
// put a network policy inside a media primitive and make "record but let the
// user review before sending" impossible. v1 sent from inside
// `recorder.onstop`, which is exactly why v1 had no way to offer a cancel that
// discards.
//
// ---------------------------------------------------------------------------
// The failure modes, all of which are real
// ---------------------------------------------------------------------------
//
//   insecure-context     `navigator.mediaDevices` is undefined on plain HTTP
//                        (localhost excepted). Not an error the user can fix
//                        by clicking allow — the UI has to say "needs HTTPS",
//                        so it gets its own code rather than collapsing into
//                        `unsupported`.
//   unsupported          Secure, but no `mediaDevices`/`MediaRecorder` —
//                        an old browser, or a JS engine with no media stack.
//   permission-denied    The user (or an admin policy) said no. Asking again
//                        immediately will not re-prompt.
//   permission-dismissed The user closed the prompt without answering.
//                        Chrome reports both as `NotAllowedError`; only the
//                        message distinguishes them, and the distinction
//                        matters because a dismissal CAN be re-prompted and a
//                        denial cannot.
//   no-microphone        `NotFoundError`/`OverconstrainedError` — a desktop
//                        with no input device, or one that was unplugged.
//   microphone-busy      `NotReadableError`/`TrackStartError` — another app
//                        (or another tab) holds the device. Common on Windows.
//   aborted              `AbortError` — the device went away mid-acquire.
//   recorder-failed      `MediaRecorder` itself errored after starting.
//
// §14: nothing here is ever logged. Not the error, not the mime type, not the
// blob size, and above all not the audio.

/** v1's proven pair: webm everywhere it exists, mp4 for Safari. First supported wins. */
export const DEFAULT_VOICE_MIME_TYPES = ['audio/webm', 'audio/mp4'] as const;

/**
 * 20Hz. Fast enough that a bar meter reads as continuous, slow enough that a
 * recording does not cost 60 re-renders per second in whatever binding is
 * subscribed.
 *
 * `setInterval` rather than `requestAnimationFrame` deliberately: rAF is
 * throttled to zero in a background tab, which would freeze the meter at
 * whatever value it last saw and make a still-recording widget look dead,
 * and it is one more browser global a test would have to stub.
 */
export const DEFAULT_AMPLITUDE_INTERVAL_MS = 50;

/** How often `durationMs` updates. 100ms keeps a tenths-of-a-second timer honest. */
const DURATION_INTERVAL_MS = 100;

export type VoiceRecorderErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'permission-dismissed'
  | 'no-microphone'
  | 'microphone-busy'
  | 'aborted'
  | 'recorder-failed'
  | 'unknown';

export interface VoiceRecorderError {
  code: VoiceRecorderErrorCode;
  /** Human-readable, safe to render. Never contains anything captured from the microphone. */
  message: string;
}

export interface VoiceRecording {
  blob: Blob;
  /** The mime type the recorder actually used — pick the file extension from this, not from what you requested. */
  mimeType: string;
  /** Wall-clock ms between `start()` resolving and `stop()` being called. */
  durationMs: number;
}

export interface VoiceRecorderOptions {
  /** Candidate mime types, best first. Defaults to {@link DEFAULT_VOICE_MIME_TYPES}. Falls through to the browser default if none is supported. */
  mimeTypes?: readonly string[];
  /** Amplitude sampling period in ms. Defaults to {@link DEFAULT_AMPLITUDE_INTERVAL_MS}. */
  amplitudeIntervalMs?: number;
}

/**
 * One immutable snapshot of the recorder.
 *
 * Identity is stable while nothing changes — `getSnapshot()` returns the SAME
 * object until a field actually differs. That is not a micro-optimization:
 * `useSyncExternalStore` re-renders in an infinite loop if its snapshot
 * getter allocates, and Vue/Angular equality checks degrade to "always
 * changed" for the same reason.
 */
export interface VoiceRecorderState {
  isRecording: boolean;
  /** Elapsed ms, updating while recording. Resets to 0 on the next `start()`. */
  durationMs: number;
  /**
   * Live RMS level of the microphone, 0..1, for animating while recording.
   *
   * Best-effort decoration: if the environment has no `AudioContext`, or
   * constructing the analyser graph throws, this stays 0 and the recording
   * proceeds normally. A broken meter must never cost the user their audio.
   */
  amplitude: number;
  /** The last failure, or `null`. Cleared at the start of every `start()`. */
  error: VoiceRecorderError | null;
  /** Whether this environment can record at all — false on plain HTTP and on browsers with no `MediaRecorder`. */
  isSupported: boolean;
}

export interface VoiceRecorder {
  /** The current state. Stable identity between changes — see {@link VoiceRecorderState}. */
  getSnapshot: () => VoiceRecorderState;
  /** Subscribe to state changes. Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;

  /** Requests the microphone and begins recording. Never throws: failures land on `state.error`. */
  start: () => Promise<void>;
  /** Stops and resolves the recording, or `null` if nothing was recording (or the take was cancelled). */
  stop: () => Promise<VoiceRecording | null>;
  /** Stops and discards. Resolves any in-flight `stop()` with `null`. */
  cancel: () => void;

  /**
   * Re-probe the environment and publish the result on `state.isSupported`.
   *
   * Separate from construction so that constructing a recorder during SSR
   * touches no `navigator`. Bindings call this once they know they are on a
   * client (React: an effect; Vue: `onMounted`; Angular: `afterNextRender`).
   */
  refreshSupport: () => void;

  /**
   * Replace the options. Read at record time, never captured at construction,
   * so a binding whose call site passes an inline `mimeTypes={[...]}` can keep
   * the recorder current without rebuilding it (and without restarting a
   * recording that is already running — a change lands on the next `start()`).
   */
  setOptions: (options: VoiceRecorderOptions) => void;

  /**
   * Release everything: stop the recorder if live, stop every track, close the
   * `AudioContext`, clear timers, resolve any pending `stop()` with `null`,
   * and drop all subscribers. Idempotent — safe from an unmount cleanup that
   * may run twice.
   */
  destroy: () => void;
}

/**
 * Maps a `getUserMedia` rejection to one of our codes.
 *
 * Reads `name` first because it is the standardized field; `message` is only
 * consulted for the one distinction the spec does not model — denied versus
 * dismissed, which Chrome expresses solely as "Permission dismissed" inside
 * an otherwise identical `NotAllowedError`.
 */
export function classifyMediaError(error: unknown): VoiceRecorderError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  const rawMessage =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return rawMessage.toLowerCase().includes('dismiss')
        ? { code: 'permission-dismissed', message: 'Microphone permission prompt was dismissed.' }
        : { code: 'permission-denied', message: 'Microphone permission was denied.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { code: 'no-microphone', message: 'No microphone was found.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { code: 'microphone-busy', message: 'The microphone is already in use by another application.' };
    case 'AbortError':
      return { code: 'aborted', message: 'Microphone access was interrupted.' };
    default:
      return { code: 'unknown', message: 'The microphone could not be started.' };
  }
}

/** First supported candidate, or `undefined` to let the browser choose. */
function pickMimeType(candidates: readonly string[]): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

export interface VoiceSupport {
  supported: boolean;
  error: VoiceRecorderError | null;
}

/**
 * Probes the environment for microphone capture support.
 *
 * Safe to call anywhere, including on a server: every global is `typeof`
 * guarded. Exported because a UI often wants to hide a mic button entirely
 * rather than construct a recorder it will never start.
 */
export function probeVoiceSupport(): VoiceSupport {
  const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const hasGetUserMedia = mediaDevices !== undefined && typeof mediaDevices.getUserMedia === 'function';
  const hasRecorder = typeof MediaRecorder !== 'undefined';

  if (hasGetUserMedia && hasRecorder) return { supported: true, error: null };

  // `isSecureContext === false` is the specific, actionable case: the API is
  // absent because the page is on plain HTTP, not because the browser is old.
  const insecure =
    typeof globalThis !== 'undefined' && (globalThis as { isSecureContext?: boolean }).isSecureContext === false;

  if (!hasGetUserMedia && insecure) {
    return {
      supported: false,
      error: { code: 'insecure-context', message: 'Voice recording requires a secure (HTTPS) page.' },
    };
  }
  return { supported: false, error: { code: 'unsupported', message: 'This browser cannot record audio.' } };
}

const INITIAL_STATE: VoiceRecorderState = {
  isRecording: false,
  durationMs: 0,
  amplitude: 0,
  error: null,
  // `true` until proven otherwise, so a button is not disabled during
  // hydration and then re-enabled a frame later.
  isSupported: true,
};

export function createVoiceRecorder(options: VoiceRecorderOptions = {}): VoiceRecorder {
  let mimeTypes: readonly string[] = options.mimeTypes ?? DEFAULT_VOICE_MIME_TYPES;
  let amplitudeIntervalMs = options.amplitudeIntervalMs ?? DEFAULT_AMPLITUDE_INTERVAL_MS;

  let state: VoiceRecorderState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  let destroyed = false;

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;

  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let amplitudeTimer: ReturnType<typeof setInterval> | null = null;
  let durationTimer: ReturnType<typeof setInterval> | null = null;

  /** Set by `cancel()` (and by `destroy()`) so `onstop` discards instead of resolving a blob. */
  let cancelled = false;
  /**
   * Everyone waiting on a `stop()`.
   *
   * A list, not a single resolver: two handlers can call `stop()` on the same
   * take (a double-clicked send button is the ordinary case), and both must
   * receive the SAME outcome. Resolving only the first and handing the second
   * a `null` would look exactly like "the recording was empty" at the call
   * site, and the audio would be dropped by whichever caller happened to lose.
   */
  let stopWaiters: ((recording: VoiceRecording | null) => void)[] = [];

  function patch(changes: Partial<VoiceRecorderState>): void {
    if (destroyed) return;
    let changed = false;
    for (const key of Object.keys(changes) as (keyof VoiceRecorderState)[]) {
      if (changes[key] !== state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...changes };
    for (const listener of [...listeners]) listener();
  }

  function settle(recording: VoiceRecording | null): void {
    const waiters = stopWaiters;
    stopWaiters = [];
    for (const resolve of waiters) resolve(recording);
  }

  /**
   * The one teardown path. Idempotent, and safe to call from an unmount
   * cleanup — it touches locals only, never subscribers.
   */
  function releaseMedia(): void {
    if (amplitudeTimer !== null) {
      clearInterval(amplitudeTimer);
      amplitudeTimer = null;
    }
    if (durationTimer !== null) {
      clearInterval(durationTimer);
      durationTimer = null;
    }

    try {
      source?.disconnect();
    } catch {
      // A node belonging to an already-closed context throws on disconnect;
      // that is the state we were trying to reach anyway.
    }
    source = null;
    analyser = null;

    const context = audioContext;
    audioContext = null;
    if (context !== null && context.state !== 'closed') {
      // Browsers cap concurrent AudioContexts; leaking one per voice note
      // breaks playback after a few dozen. Fire-and-forget: nothing waits on
      // the close, but the rejection must not become unhandled.
      void Promise.resolve(context.close()).catch(() => {});
    }

    // Last, and unconditionally: this is the one that turns off the tab's
    // recording indicator.
    const live = stream;
    stream = null;
    if (live !== null) {
      for (const track of live.getTracks()) track.stop();
    }

    recorder = null;
  }

  /**
   * Wires an analyser onto the live stream. Every failure here is swallowed:
   * the amplitude meter is decoration and must not be able to fail a
   * recording (Safari in particular will throw constructing an AudioContext
   * without a user gesture in some configurations).
   */
  function attachAnalyser(live: MediaStream): void {
    const AudioContextCtor =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor === undefined) return;

    try {
      const context = new AudioContextCtor();
      const node = context.createAnalyser();
      // 256 bins is plenty for an RMS level and a quarter the work of the
      // 1024 a spectrum display would need.
      node.fftSize = 256;
      const streamSource = context.createMediaStreamSource(live);
      streamSource.connect(node);
      // Deliberately NOT connected to context.destination: routing the
      // microphone to the speakers is a feedback loop, not a meter.

      audioContext = context;
      analyser = node;
      source = streamSource;

      const samples = new Uint8Array(node.fftSize);
      amplitudeTimer = setInterval(() => {
        if (analyser === null) return;
        analyser.getByteTimeDomainData(samples);

        // RMS of the waveform around the 128 zero-point, scaled to 0..1.
        // Peak would spike to 1 on a single click; RMS is what reads as
        // "how loud am I" to a human watching a bar.
        let sumOfSquares = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const deviation = ((samples[i] ?? 128) - 128) / 128;
          sumOfSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumOfSquares / samples.length);
        patch({ amplitude: Math.min(1, Math.max(0, rms)) });
      }, amplitudeIntervalMs);
    } catch {
      // Leave whatever partially-built graph exists to releaseMedia().
    }
  }

  async function start(): Promise<void> {
    if (destroyed) return;
    if (recorder !== null) return;

    const support = probeVoiceSupport();
    patch({ isSupported: support.supported });
    if (!support.supported) {
      patch({ error: support.error });
      return;
    }

    patch({ error: null, durationMs: 0, amplitude: 0 });
    cancelled = false;

    let live: MediaStream;
    try {
      live = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (caught) {
      patch({ error: classifyMediaError(caught) });
      return;
    }

    // The race the tab indicator bug lives in: the consumer was destroyed, or
    // the user hit cancel, while the permission prompt was open. The stream is
    // granted to something that no longer exists, and nothing else will ever
    // stop it.
    if (destroyed || cancelled) {
      for (const track of live.getTracks()) track.stop();
      return;
    }

    const mimeType = pickMimeType(mimeTypes);

    let started: MediaRecorder;
    try {
      started = mimeType === undefined ? new MediaRecorder(live) : new MediaRecorder(live, { mimeType });
    } catch {
      for (const track of live.getTracks()) track.stop();
      patch({ error: { code: 'unsupported', message: 'This browser cannot record audio.' } });
      return;
    }

    stream = live;
    recorder = started;
    chunks = [];
    startedAt = Date.now();

    started.ondataavailable = (event: BlobEvent) => {
      if (event.data !== undefined && event.data.size > 0) chunks.push(event.data);
    };

    started.onerror = () => {
      chunks = [];
      releaseMedia();
      patch({
        error: { code: 'recorder-failed', message: 'Recording stopped unexpectedly.' },
        isRecording: false,
        amplitude: 0,
      });
      settle(null);
    };

    started.onstop = () => {
      const elapsed = Date.now() - startedAt;
      const recorded = chunks;
      const recorderMimeType = started.mimeType !== '' ? started.mimeType : (mimeType ?? '');
      chunks = [];

      const discarded = cancelled;
      releaseMedia();
      patch({
        isRecording: false,
        amplitude: 0,
        // A discarded take has no duration to report; leaving the last tick
        // on screen would show a timer for audio that no longer exists.
        ...(discarded ? { durationMs: 0 } : {}),
      });

      if (discarded || recorded.length === 0) {
        settle(null);
        return;
      }
      settle({ blob: new Blob(recorded, { type: recorderMimeType }), mimeType: recorderMimeType, durationMs: elapsed });
    };

    attachAnalyser(live);

    durationTimer = setInterval(() => {
      patch({ durationMs: Date.now() - startedAt });
    }, DURATION_INTERVAL_MS);

    started.start();
    patch({ isRecording: true });
  }

  function stop(): Promise<VoiceRecording | null> {
    // FIRST, before anything reads `recorder.state`. `MediaRecorder.stop()`
    // flips `state` to 'inactive' SYNCHRONOUSLY, and only then fires `onstop`
    // asynchronously — so from the moment the first `stop()` returns until its
    // `onstop` lands, a second caller sees an inactive recorder and would take
    // the teardown path below, resolving `null` while the first caller
    // receives the audio. Two callers, one take, different answers. Joining
    // the waiter list here is what makes them agree.
    if (stopWaiters.length > 0) {
      return new Promise<VoiceRecording | null>((resolve) => {
        stopWaiters.push(resolve);
      });
    }

    const live = recorder;
    if (live === null) return Promise.resolve(null);

    // An already-inactive recorder with nobody waiting on it will never fire
    // `onstop`, so awaiting one would hang forever. Tear down here instead.
    if (live.state === 'inactive') {
      releaseMedia();
      patch({ isRecording: false, amplitude: 0 });
      return Promise.resolve(null);
    }

    return new Promise<VoiceRecording | null>((resolve) => {
      stopWaiters.push(resolve);
      live.stop();
    });
  }

  function cancel(): void {
    cancelled = true;
    const live = recorder;

    if (live === null) {
      // Nothing is live, so no `onstop` will ever arrive to do it for us.
      releaseMedia();
      patch({ isRecording: false, amplitude: 0, durationMs: 0 });
      settle(null);
      return;
    }

    if (live.state !== 'inactive') live.stop();

    // Deliberately nothing else. `recorder` is cleared only by
    // `releaseMedia()`, which runs only from `onstop`/`onerror`/`destroy` — so
    // a non-null recorder here means `onstop` has not fired yet and still
    // will. It reads `cancelled` and owns the whole transition: discard the
    // chunks, tear down the media, resolve any pending `stop()` with `null`.
    // Duplicating that here would give one state transition two owners, and
    // the two would race over which of them resolves the caller's promise.
  }

  function refreshSupport(): void {
    patch({ isSupported: probeVoiceSupport().supported });
  }

  function setOptions(next: VoiceRecorderOptions): void {
    if (next.mimeTypes !== undefined) mimeTypes = next.mimeTypes;
    if (next.amplitudeIntervalMs !== undefined) amplitudeIntervalMs = next.amplitudeIntervalMs;
  }

  function destroy(): void {
    if (destroyed) return;
    cancelled = true;

    const live = recorder;
    if (live !== null && live.state !== 'inactive') {
      // Best-effort: some engines fire `onstop` synchronously, some never do
      // once the page is tearing down. releaseMedia() below is idempotent and
      // runs either way, so the tracks are stopped regardless of which happens.
      try {
        live.stop();
      } catch {
        // Already torn down by the browser.
      }
    }
    releaseMedia();
    settle(null);

    // Last: `patch` is a no-op once this is set, and `onstop` may still fire
    // after we return.
    destroyed = true;
    listeners.clear();
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
    cancel,
    refreshSupport,
    setOptions,
    destroy,
  };
}
