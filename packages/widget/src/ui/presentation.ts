// Which of the three presentations is on screen, and who decides.
//
// ── Why three and not the two the brief asked for ────────────────────────
//
// The brief requires `bubble` and `panel`/`sidebar`, and says a third mode
// needs justifying. `sheet` is that third mode, and the justification is a
// measurement rather than a preference:
//
//   A `bubble` panel is a floating card. To be usable it needs roughly
//   380x560 CSS px plus a margin, plus the launcher it must not cover. The
//   target device for this SDK is a customer checking a live food order on a
//   phone — 360x640 is still the modal Android viewport. There is no
//   arrangement of a 380px floating card inside a 360px viewport that is not
//   just "a full-screen panel with a wasted 8px gutter and a launcher hidden
//   behind it".
//
//   `sidebar` fares no better: a side tab that slides to 400px on a 360px
//   viewport IS a full-screen panel, but one anchored to an edge the thumb
//   cannot comfortably reach, with its close affordance in the far corner.
//
//   `sheet` anchors to the bottom edge, which is where a phone's thumb
//   already is, sizes itself to `100dvh` minus a header peek so the on-screen
//   keyboard shrinks the message list rather than pushing the composer off
//   screen (`dvh`, not `vh`, is what makes that true on iOS Safari), and puts
//   the close control at the top of a short reach.
//
// So `sheet` is not a third design; it is what `bubble` and `sidebar` both
// have to degrade into below a certain width, and naming it makes that
// degradation explicit and testable instead of a pile of media queries.
//
// `auto` — the default — is the only mode that ever changes at runtime.
// `bubble`, `sidebar`, and `sheet` are honoured exactly as asked at every
// width, because an integrator who names one has a layout reason we cannot
// see.

/** What a host may ask for. */
export type PresentationMode = 'auto' | 'bubble' | 'sidebar' | 'sheet';

/** What is actually mounted. `auto` is resolved away before it reaches the UI. */
export type ResolvedPresentation = 'bubble' | 'sidebar' | 'sheet';

export interface Viewport {
  readonly width: number;
}

/**
 * Maps a requested mode plus the current viewport onto the presentation to
 * render.
 *
 * A pure function of its two arguments — no `window` read — so the breakpoint
 * behaviour is a table test rather than a browser test, and so a server-side
 * render of the same config cannot diverge from the client's first paint.
 */
export function resolvePresentation(
  mode: PresentationMode,
  viewport: Viewport,
  breakpointPx: number,
): ResolvedPresentation {
  if (mode !== 'auto') return mode;
  return viewport.width <= breakpointPx ? 'sheet' : 'bubble';
}
