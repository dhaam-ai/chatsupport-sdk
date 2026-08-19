// Voice notes, as a plain object with a callback instead of a React hook.
//
// ── What was ported, and what was not ───────────────────────────────────
//
// `@dhaam-ccrm/react`'s `useVoiceRecorder` is the pattern here and it was
// worth porting: its failure taxonomy is field-earned, not theoretical
// (`insecure-context` distinct from `unsupported` because "needs HTTPS" and
// "your browser is too old" need different copy; `permission-dismissed`
// distinct from `permission-denied` because only one of them can be
// re-prompted), and its rule that every exit path releases the MediaStream is
// the difference between a widget that closes and a browser tab that keeps the
// OS microphone light on afterwards. All of that is framework-independent, so
// it is reproduced here rather than re-derived.
//
// `useAudioWaveform` was NOT ported. It decodes the finished blob through an
// `AudioContext` to draw a static peak graph — roughly 1.5KB of bundle plus a
// full decode of the recording, to produce decoration next to a `<audio
// controls>` element that already has a scrubber. On a widget whose whole
// budget is someone else's page-load, the live amplitude meter below (which
// costs an analyser we already have open) buys the "it is listening" feedback
// that actually matters, and playback uses the platform control.
//
// §14: nothing here is logged. Not the error, not the mime type, not the blob
// size, and above all not the audio.

/** v1's proven pair: webm everywhere it exists, mp4 for Safari. First supported wins. */
const MIME_CANDIDATES = ['audio/webm', 'audio/mp4'] as const;

const AMPLITUDE_INTERVAL_MS = 50;

export type VoiceErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'permission-dismissed'
  | 'no-microphone'
  | 'microphone-busy'
  | 'aborted'
  | 'recorder-failed'
  | 'unknown';

export interface VoiceError {
  readonly code: VoiceErrorCode;
  /** Human-readable and safe to render. Never contains anything captured from the microphone. */
  readonly message: string;
}

export interface VoiceRecording {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
}

export interface VoiceRecorder {
  isSupported(): boolean;
  isRecording(): boolean;
  start(): Promise<VoiceError | null>;
  stop(): Promise<VoiceRecording | null>;
  cancel(): void;
  /** Releases the device unconditionally. Safe to call when idle. */
  dispose(): void;
}

export interface VoiceRecorderCallbacks {
  /** Elapsed ms and 0..1 RMS level, ~20 times a second while recording. */
  readonly onTick: (durationMs: number, amplitude: number) => void;
}

export function createVoiceRecorder(callbacks: VoiceRecorderCallbacks): VoiceRecorder {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let cancelled = false;

  /**
   * Stops every track and closes the analyser graph.
   *
   * Called from every exit path without exception — stop, cancel, recorder
   * error, and dispose. A live `MediaStreamTrack` keeps the tab's recording
   * indicator and the OS microphone light on after the widget is gone, which
   * a user quite reasonably reads as the page still listening to them.
   */
  function release(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    analyser = null;
    const context = audioContext;
    audioContext = null;
    // `close()` returns a promise that rejects if the context is already
    // closed. Nothing downstream depends on it, and an unhandled rejection
    // escaping into the host's error tracking is exactly what the brief
    // forbids.
    void context?.close().catch(() => undefined);
    recorder = null;
  }

  function isSupported(): boolean {
    return probe().supported;
  }

  return {
    isSupported,
    isRecording: () => recorder !== null && recorder.state === 'recording',

    async start(): Promise<VoiceError | null> {
      const support = probe();
      if (!support.supported) return support.error;

      cancelled = false;
      chunks = [];

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        release();
        return classifyMediaError(error);
      }

      // The user may have cancelled while the permission prompt was up.
      if (cancelled) {
        release();
        return null;
      }

      const mimeType = pickMimeType();
      try {
        recorder = new MediaRecorder(stream, mimeType === undefined ? undefined : { mimeType });
      } catch {
        release();
        return { code: 'recorder-failed', message: 'Recording could not be started.' };
      }

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });

      startedAt = Date.now();
      recorder.start();
      attachAnalyser();

      timer = setInterval(() => {
        callbacks.onTick(Date.now() - startedAt, readAmplitude());
      }, AMPLITUDE_INTERVAL_MS);

      return null;
    },

    async stop(): Promise<VoiceRecording | null> {
      const active = recorder;
      if (active === null || active.state === 'inactive') {
        release();
        return null;
      }

      const mimeType = active.mimeType !== '' ? active.mimeType : 'audio/webm';
      const durationMs = Date.now() - startedAt;

      const finished = new Promise<void>((resolve) => {
        active.addEventListener('stop', () => resolve(), { once: true });
      });
      active.stop();
      await finished;

      const collected = chunks;
      chunks = [];
      release();

      if (cancelled || collected.length === 0) return null;
      return { blob: new Blob(collected, { type: mimeType }), mimeType, durationMs };
    },

    cancel(): void {
      cancelled = true;
      chunks = [];
      if (recorder !== null && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Already stopping. `release` below is what actually matters.
        }
      }
      release();
    },

    dispose(): void {
      cancelled = true;
      chunks = [];
      release();
    },
  };

  /**
   * Best-effort live level meter.
   *
   * Wrapped in a try/catch and allowed to fail silently: a browser that
   * refuses to build the analyser graph (an autoplay policy, an exhausted
   * context limit) must still record. A broken meter must never cost the user
   * their audio.
   */
  function attachAnalyser(): void {
    if (stream === null) return;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      audioContext = new Ctor();
      const node = audioContext.createAnalyser();
      node.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(node);
      analyser = node;
    } catch {
      analyser = null;
    }
  }

  function readAmplitude(): number {
    if (analyser === null) return 0;
    const samples = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      // 128 is silence for 8-bit time-domain data, so this is the deviation
      // from the zero line rather than the absolute value.
      const deviation = (sample - 128) / 128;
      sum += deviation * deviation;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 2.5);
  }
}

interface Support {
  readonly supported: boolean;
  readonly error: VoiceError | null;
}

/** Probed at call time, never at module scope — importing this file touches no `navigator`. */
function probe(): Support {
  const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const hasGetUserMedia = mediaDevices !== undefined && typeof mediaDevices.getUserMedia === 'function';
  const hasRecorder = typeof MediaRecorder !== 'undefined';

  if (hasGetUserMedia && hasRecorder) return { supported: true, error: null };

  const insecure = (globalThis as { isSecureContext?: boolean }).isSecureContext === false;
  if (!hasGetUserMedia && insecure) {
    return {
      supported: false,
      error: { code: 'insecure-context', message: 'Voice messages need a secure (HTTPS) page.' },
    };
  }
  return { supported: false, error: { code: 'unsupported', message: 'This browser cannot record audio.' } };
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Maps a `getUserMedia` rejection to one of our codes.
 *
 * Reads `name` first because it is the standardized field; `message` is only
 * consulted for the one distinction the spec does not model — denied versus
 * dismissed, which Chrome expresses solely as "Permission dismissed" inside an
 * otherwise identical `NotAllowedError`.
 */
function classifyMediaError(error: unknown): VoiceError {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return raw.toLowerCase().includes('dismiss')
        ? { code: 'permission-dismissed', message: 'Microphone permission prompt was dismissed.' }
        : { code: 'permission-denied', message: 'Microphone permission was denied.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { code: 'no-microphone', message: 'No microphone was found.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { code: 'microphone-busy', message: 'The microphone is in use by another application.' };
    case 'AbortError':
      return { code: 'aborted', message: 'Microphone access was interrupted.' };
    default:
      return { code: 'unknown', message: 'The microphone could not be started.' };
  }
}
