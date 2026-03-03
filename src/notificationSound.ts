// ── Notification Sound for Chat Widget ────────────────────────────────────────
// Synthesises a Google-Chat-style two-tone ascending chime using Web Audio API.
// Same ringtone as the agent dashboard.
// No external files needed — works offline and respects browser autoplay policy.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Play a short two-tone ascending chime (Google Chat-like).
 * Silently ignores errors (browser may block before first user gesture).
 */
export function playNotificationSound(volume = 0.65): void {
  try {
    const ctx  = getCtx();
    const now  = ctx.currentTime;

    // Two notes: E5 (659 Hz) → G5 (784 Hz), each ~120 ms
    const notes: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 659.25, start: now + 0.00, dur: 0.12 },
      { freq: 783.99, start: now + 0.11, dur: 0.18 },
    ];

    for (const note of notes) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type      = 'sine';
      osc.frequency.setValueAtTime(note.freq, note.start);

      // Quick attack, smooth exponential decay
      gain.gain.setValueAtTime(0, note.start);
      gain.gain.linearRampToValueAtTime(volume, note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, note.start + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(note.start);
      osc.stop(note.start + note.dur + 0.01);
    }
  } catch (_) {
    // Silently ignore — autoplay blocked or AudioContext unavailable
  }
}

/** Call once on first user interaction to unlock AudioContext. */
export function unlockAudio(): void {
  try { getCtx(); } catch (_) {}
}
