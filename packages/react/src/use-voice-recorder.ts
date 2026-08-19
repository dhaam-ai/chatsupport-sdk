// useVoiceRecorder — `getUserMedia` + `MediaRecorder`, with the failure
// modes that actually happen in the field.
//
// ---------------------------------------------------------------------------
// What this hook is, and what it deliberately is not
// ---------------------------------------------------------------------------
//
// It produces a `Blob`. It does not send one: `useMessages().sendAttachment`
// already owns that path (§6.3, upload-then-announce), and folding the send
// in here would put a network policy inside a media hook and make "record but
// let the user review before sending" impossible. v1 sent from inside
// `recorder.onstop` (`src/widget/ChatContentInner.tsx`), which is exactly why
// v1 had no way to offer a cancel that discards.
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
//                        denial cannot — retry copy that is wrong in either
//                        direction is worse than no copy.
//   no-microphone        `NotFoundError`/`OverconstrainedError` — a desktop
//                        with no input device, or one that was unplugged.
//   microphone-busy      `NotReadableError`/`TrackStartError` — another app
//                        (or another tab) holds the device. Common on Windows.
//   aborted              `AbortError` — the device went away mid-acquire.
//   recorder-failed      `MediaRecorder` itself errored after starting.
//
// ---------------------------------------------------------------------------
// Releasing the stream is not optional
// ---------------------------------------------------------------------------
//
// Every exit path — stop, cancel, recorder error, unmount mid-recording, and
// the race where the component unmounts while `getUserMedia` is still in
// flight — runs {@link releaseMedia}, which calls `stop()` on every track and
// closes the `AudioContext`. A live `MediaStreamTrack` keeps the browser's
// tab-level recording indicator lit and the OS microphone light on after the
// widget is gone, which users reasonably read as the page still listening.
//
// §14: nothing here is ever logged. Not the error, not the mime type, not the
// blob size, and above all not the audio.

import { useCallback, useEffect, useRef, useState } from 'react';

/** v1's proven pair (`src/widget/ChatContentInner.tsx`): webm everywhere it exists, mp4 for Safari. First supported wins. */
export const DEFAULT_VOICE_MIME_TYPES = ['audio/webm', 'audio/mp4'] as const;

/**
 * 20Hz. Fast enough that a bar meter reads as continuous, slow enough that a
 * recording does not cost 60 React re-renders per second.
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

export interface UseVoiceRecorderOptions {
  /** Candidate mime types, best first. Defaults to {@link DEFAULT_VOICE_MIME_TYPES}. Falls through to the browser default if none is supported. */
  mimeTypes?: readonly string[];
  /** Amplitude sampling period in ms. Defaults to {@link DEFAULT_AMPLITUDE_INTERVAL_MS}. */
  amplitudeIntervalMs?: number;
}

export interface UseVoiceRecorderResult {
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

  /** Requests the microphone and begins recording. Never throws: failures land on {@link UseVoiceRecorderResult.error}. */
  start: () => Promise<void>;
  /** Stops and resolves the recording, or `null` if nothing was recording (or the take was cancelled). */
  stop: () => Promise<VoiceRecording | null>;
  /** Stops and discards. Resolves any in-flight `stop()` with `null`. */
  cancel: () => void;
}

/**
 * Maps a `getUserMedia` rejection to one of our codes.
 *
 * Reads `name` first because it is the standardized field; `message` is only
 * consulted for the one distinction the spec does not model — denied versus
 * dismissed, which Chrome expresses solely as "Permission dismissed" inside
 * an otherwise identical `NotAllowedError`.
 */
function classifyMediaError(error: unknown): VoiceRecorderError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  const rawMessage =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : '';

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

/** First supported candidate, or `undefined` to let the browser choose. Mirrors v1's `isTypeSupported` probe, generalized past two hardcoded strings. */
function pickMimeType(candidates: readonly string[]): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

interface MediaSupport {
  supported: boolean;
  error: VoiceRecorderError | null;
}

/**
 * Probes the environment. Called inside `start()` and inside an effect —
 * never at module scope, so importing this module during SSR touches no
 * `navigator`.
 */
function probeSupport(): MediaSupport {
  const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const hasGetUserMedia = mediaDevices !== undefined && typeof mediaDevices.getUserMedia === 'function';
  const hasRecorder = typeof MediaRecorder !== 'undefined';

  if (hasGetUserMedia && hasRecorder) return { supported: true, error: null };

  // `isSecureContext === false` is the specific, actionable case: the API is
  // absent because the page is on plain HTTP, not because the browser is old.
  const insecure = typeof globalThis !== 'undefined' && (globalThis as { isSecureContext?: boolean }).isSecureContext === false;

  if (!hasGetUserMedia && insecure) {
    return {
      supported: false,
      error: { code: 'insecure-context', message: 'Voice recording requires a secure (HTTPS) page.' },
    };
  }
  return {
    supported: false,
    error: { code: 'unsupported', message: 'This browser cannot record audio.' },
  };
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): UseVoiceRecorderResult {
  const { mimeTypes = DEFAULT_VOICE_MIME_TYPES, amplitudeIntervalMs = DEFAULT_AMPLITUDE_INTERVAL_MS } = options;

  // Held in refs so an inline `mimeTypes={['audio/webm']}` at the call site
  // does not give `start`/`stop`/`cancel` a new identity every render — these
  // are read at record time, never during render.
  const mimeTypesRef = useRef(mimeTypes);
  mimeTypesRef.current = mimeTypes;
  const amplitudeIntervalRef = useRef(amplitudeIntervalMs);
  amplitudeIntervalRef.current = amplitudeIntervalMs;

  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  // Probed lazily on mount rather than during render: `probeSupport()` reads
  // `navigator`, and a render pass is the one place that must stay safe on a
  // server. `true` until proven otherwise, so a button is not disabled during
  // hydration and then re-enabled a frame later.
  const [isSupported, setIsSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const amplitudeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Set by `cancel()` (and by unmount) so `onstop` discards instead of resolving a blob. */
  const cancelledRef = useRef(false);
  /** Resolver for the promise `stop()` handed out. Exactly one in flight at a time. */
  const settleRef = useRef<((recording: VoiceRecording | null) => void) | null>(null);
  const mountedRef = useRef(true);

  const safeSetState = useCallback((apply: () => void) => {
    if (mountedRef.current) apply();
  }, []);

  const settle = useCallback((recording: VoiceRecording | null) => {
    const resolve = settleRef.current;
    settleRef.current = null;
    resolve?.(recording);
  }, []);

  /**
   * The one teardown path. Idempotent, and safe to call from an unmount
   * cleanup — it touches refs only, never state.
   */
  const releaseMedia = useCallback(() => {
    if (amplitudeTimerRef.current !== null) {
      clearInterval(amplitudeTimerRef.current);
      amplitudeTimerRef.current = null;
    }
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    try {
      sourceRef.current?.disconnect();
    } catch {
      // A node belonging to an already-closed context throws on disconnect;
      // that is the state we were trying to reach anyway.
    }
    sourceRef.current = null;
    analyserRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context !== null && context.state !== 'closed') {
      // Browsers cap concurrent AudioContexts; leaking one per voice note
      // breaks playback after a few dozen. Fire-and-forget: nothing waits on
      // the close, but the rejection must not become unhandled.
      void Promise.resolve(context.close()).catch(() => {});
    }

    // Last, and unconditionally: this is the one that turns off the tab's
    // recording indicator.
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
    }

    recorderRef.current = null;
  }, []);

  /**
   * Wires an analyser onto the live stream. Every failure here is swallowed:
   * the amplitude meter is decoration and must not be able to fail a
   * recording (Safari in particular will throw constructing an AudioContext
   * without a user gesture in some configurations).
   */
  const attachAnalyser = useCallback(
    (stream: MediaStream) => {
      const AudioContextCtor =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor === undefined) return;

      try {
        const context = new AudioContextCtor();
        const analyser = context.createAnalyser();
        // 256 bins is plenty for an RMS level and a quarter the work of the
        // 1024 a spectrum display would need.
        analyser.fftSize = 256;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        // Deliberately NOT connected to context.destination: routing the
        // microphone to the speakers is a feedback loop, not a meter.

        audioContextRef.current = context;
        analyserRef.current = analyser;
        sourceRef.current = source;

        const samples = new Uint8Array(analyser.fftSize);
        amplitudeTimerRef.current = setInterval(() => {
          const live = analyserRef.current;
          if (live === null) return;
          live.getByteTimeDomainData(samples);

          // RMS of the waveform around the 128 zero-point, scaled to 0..1.
          // Peak would spike to 1 on a single click; RMS is what reads as
          // "how loud am I" to a human watching a bar.
          let sumOfSquares = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const deviation = ((samples[i] ?? 128) - 128) / 128;
            sumOfSquares += deviation * deviation;
          }
          const rms = Math.sqrt(sumOfSquares / samples.length);
          safeSetState(() => setAmplitude(Math.min(1, Math.max(0, rms))));
        }, amplitudeIntervalRef.current);
      } catch {
        // Leave whatever partially-built graph exists to releaseMedia().
      }
    },
    [safeSetState],
  );

  const start = useCallback(async (): Promise<void> => {
    if (recorderRef.current !== null) return;

    const support = probeSupport();
    safeSetState(() => setIsSupported(support.supported));
    if (!support.supported) {
      safeSetState(() => setError(support.error));
      return;
    }

    safeSetState(() => {
      setError(null);
      setDurationMs(0);
      setAmplitude(0);
    });
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (caught) {
      safeSetState(() => setError(classifyMediaError(caught)));
      return;
    }

    // The race the tab indicator bug lives in: the user navigated away, or
    // hit cancel, while the permission prompt was open. The stream is granted
    // to a component that no longer exists, and nothing else will ever stop
    // it.
    if (!mountedRef.current || cancelledRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    const mimeType = pickMimeType(mimeTypesRef.current);

    let recorder: MediaRecorder;
    try {
      recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
    } catch {
      for (const track of stream.getTracks()) track.stop();
      safeSetState(() => setError({ code: 'unsupported', message: 'This browser cannot record audio.' }));
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data !== undefined && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      chunksRef.current = [];
      releaseMedia();
      safeSetState(() => {
        setError({ code: 'recorder-failed', message: 'Recording stopped unexpectedly.' });
        setIsRecording(false);
        setAmplitude(0);
      });
      settle(null);
    };

    recorder.onstop = () => {
      const elapsed = Date.now() - startedAtRef.current;
      const chunks = chunksRef.current;
      const recorderMimeType = recorder.mimeType !== '' ? recorder.mimeType : (mimeType ?? '');
      chunksRef.current = [];

      const discarded = cancelledRef.current;
      releaseMedia();
      safeSetState(() => {
        setIsRecording(false);
        setAmplitude(0);
        // A discarded take has no duration to report; leaving the last tick
        // on screen would show a timer for audio that no longer exists.
        if (discarded) setDurationMs(0);
      });

      if (discarded || chunks.length === 0) {
        settle(null);
        return;
      }
      settle({ blob: new Blob(chunks, { type: recorderMimeType }), mimeType: recorderMimeType, durationMs: elapsed });
    };

    attachAnalyser(stream);

    durationTimerRef.current = setInterval(() => {
      safeSetState(() => setDurationMs(Date.now() - startedAtRef.current));
    }, DURATION_INTERVAL_MS);

    recorder.start();
    safeSetState(() => setIsRecording(true));
  }, [attachAnalyser, releaseMedia, safeSetState, settle]);

  const stop = useCallback((): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (recorder === null) return Promise.resolve(null);

    // An already-inactive recorder will never fire `onstop`, so awaiting one
    // would hang forever. Tear down here instead.
    if (recorder.state === 'inactive') {
      releaseMedia();
      safeSetState(() => {
        setIsRecording(false);
        setAmplitude(0);
      });
      return Promise.resolve(null);
    }

    // A second stop() while one is pending adopts the same outcome rather
    // than replacing (and thus abandoning) the first promise.
    const pending = settleRef.current;
    return new Promise<VoiceRecording | null>((resolve) => {
      settleRef.current = (recording) => {
        pending?.(recording);
        resolve(recording);
      };
      recorder.stop();
    });
  }, [releaseMedia, safeSetState]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;

    if (recorder === null) {
      // Nothing is live, so no `onstop` will ever arrive to do it for us.
      releaseMedia();
      safeSetState(() => {
        setIsRecording(false);
        setAmplitude(0);
        setDurationMs(0);
      });
      settle(null);
      return;
    }

    if (recorder.state !== 'inactive') recorder.stop();

    // Deliberately nothing else. `recorderRef` is cleared only by
    // `releaseMedia()`, which runs only from `onstop`/`onerror`/unmount — so a
    // non-null recorder here means `onstop` has not fired yet and still will,
    // whether we just called `stop()` or an earlier `stop()` did. It reads
    // `cancelledRef` and owns the whole transition: discard the chunks, tear
    // down the media, resolve any pending `stop()` with `null`. Duplicating
    // that here would give one state transition two owners, and the two would
    // race over which of them resolves the caller's promise.
  }, [releaseMedia, safeSetState, settle]);

  useEffect(() => {
    mountedRef.current = true;
    setIsSupported(probeSupport().supported);

    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;

      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== 'inactive') {
        // Best-effort: some engines fire `onstop` synchronously, some never
        // do once the page is tearing down. releaseMedia() below is
        // idempotent and runs either way, so the tracks are stopped
        // regardless of which happens.
        try {
          recorder.stop();
        } catch {
          // Already torn down by the browser.
        }
      }
      releaseMedia();
      settle(null);
    };
  }, [releaseMedia, settle]);

  return { isRecording, durationMs, amplitude, error, isSupported, start, stop, cancel };
}
