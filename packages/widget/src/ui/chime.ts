// The notification sound — `behaviour.sound` in the console's "During the
// chat" group, described there as "Plays on the visitor's side when a reply
// arrives."
//
// ── Why this is synthesised and not a file ────────────────────────────────
//
// Every other asset in this package is inlined into the bundle, because a
// widget that fetches a second resource has a second thing that can fail on a
// merchant's page. An audio file inlined as a data URI is tens of kilobytes
// for two notes; two oscillators are a few hundred bytes of code and cannot
// 404. The bundle-size line in `scripts/bundle.mjs` is a stated constraint of
// this package, and a chime is not worth a measurable fraction of it.
//
// ── Why a failure here is silent ──────────────────────────────────────────
//
// Browsers refuse to start an AudioContext until the user has interacted with
// the page, and they are right to: this widget lives on somebody else's site,
// and a script that could make noise on load would be a script merchants
// remove. So every call is best-effort — a blocked context, a browser with no
// WebAudio at all, and a machine with no output device all end in the same
// place, which is nothing happening and nothing thrown. The alternative is an
// exception on the message-arrival path, where the sound is by far the least
// important thing occurring.

/** Plays the chime, if the browser will let us. Never throws. */
export type Chime = () => void;

/**
 * A two-note chime, lazily constructed.
 *
 * The context is created on the FIRST call rather than at mount, for two
 * reasons that point the same way: a widget that never plays a sound should
 * never have allocated an audio graph, and a context created before any user
 * gesture starts life `suspended` and has to be resumed anyway.
 */
export function createChime(onError: (error: unknown) => void): Chime {
  // `webkitAudioContext` is not in lib.dom's Window; older iOS Safari is the
  // reason it is still worth reaching for.
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  let context: AudioContext | null = null;

  return () => {
    if (Ctor === undefined) return;
    try {
      context ??= new Ctor();
      // Suspended is the normal state before a gesture, and `resume()` is a
      // promise that rejects when the browser is still refusing. Ignored on
      // purpose: the note below is scheduled either way and simply will not be
      // heard, which is the correct outcome for "the user has not interacted
      // with this page yet".
      if (context.state === 'suspended') void context.resume().catch(() => undefined);

      const now = context.currentTime;
      // A rising fifth — two short sine notes, the shape a notification takes
      // in most systems. Sine rather than square: a widget's chime is heard on
      // top of whatever the visitor is already doing, and a harmonically rich
      // waveform at the same loudness is the one people describe as harsh.
      for (const [frequency, at] of [
        [660, 0],
        [990, 0.09],
      ] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        // An envelope, not a constant: a note that starts and stops at full
        // amplitude clicks at both ends, and the click is the part people
        // notice. 0.06 peak keeps it under the page's own audio.
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.06, now + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + at);
        oscillator.stop(now + at + 0.18);
      }
    } catch (error) {
      // Reported, not thrown — this runs on the message-arrival path, where a
      // chime is the least important thing happening.
      onError(error);
    }
  };
}
