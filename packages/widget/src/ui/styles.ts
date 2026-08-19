// Every style this widget has, as one string injected into the shadow root.
//
// ── Font inheritance, which is the opposite of the usual claim ───────────
//
// It is widely repeated that a shadow root "does not inherit fonts". That is
// not what the cascade does. INHERITED properties — `font-family`, `font-size`,
// `line-height`, `color`, `letter-spacing`, `direction` — cross the shadow
// boundary perfectly well, because the shadow tree's root inherits from its
// HOST element, and the host element is an ordinary node in the light DOM
// inheriting from the page. What does NOT cross is anything that requires a
// SELECTOR to match: `body { font-family: X }` reaches us (through
// inheritance), while `.chat p { font-family: X }` never does.
//
// So the real hazard is the reverse of the folklore: left alone we silently
// adopt the host's typography, including a 20px base size from a marketing
// site, a display face with no lowercase, or a webfont that has not loaded and
// renders as invisible text. `:host` therefore sets the inherited properties
// explicitly — that is what actually isolates them.
//
// `font: inherit` is offered as `WidgetConfig.font: 'inherit'` for hosts that
// want brand continuity, which is a legitimate thing to want and is why this
// is a setting rather than a hardcode. `all: initial` on `:host` was rejected:
// it would also reset the custom properties the theme is built from, and it
// resets `direction`, which would break every RTL host.
//
// ── Stacking ────────────────────────────────────────────────────────────
//
// The shadow root solves style leakage in both directions. It does NOT solve
// stacking: a shadow host is an ordinary element in the host's z-order, so v1's
// `z-index: 999999` still loses to any host that bids higher. See ui/root.ts —
// the container is promoted to the TOP LAYER via the popover API where that
// exists, which no z-index can outrank, and falls back to the real maximum
// (2147483647) rather than v1's arbitrary six digits.

import type { ResolvedConfig } from '../config.js';

/**
 * Tokens only. Kept separate from {@link STYLES} because these are the only
 * declarations that depend on runtime config, so the ~9KB of static CSS below
 * stays a module-scope constant that the engine parses once.
 */
export function themeCss(config: ResolvedConfig): string {
  const font =
    config.font === 'inherit'
      ? 'font: inherit; font-family: inherit;'
      : "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";

  return `:host{
    ${font}
    font-size: 15px;
    line-height: 1.45;
    letter-spacing: normal;
    font-weight: 400;
    font-style: normal;
    text-align: start;
    text-transform: none;
    --dh-accent: ${cssColor(config.accent)};
  }`;
}

/**
 * Neutralises a config-supplied colour before it reaches a stylesheet.
 *
 * `accent` is host config rather than end-user input, so this is not the XSS
 * boundary — but a stray `;` would still let a typo silently rewrite unrelated
 * declarations, and a `}` would end the rule block and leave the rest of the
 * sheet as garbage. Anything with a brace, semicolon, or comment marker is
 * refused in favour of the default rather than escaped, because there is no
 * legitimate CSS colour containing one.
 */
function cssColor(value: string): string {
  return /[;{}()<>\\]|\/\*/.test(value) ? '#1f2937' : value.trim();
}

export const STYLES = `
*, *::before, *::after { box-sizing: border-box; }

:host {
  /* Neutral by default. The AI-purple gradient is not a brand, and this ships
     onto someone else's page where it would clash with an actual one. */
  --dh-surface: #ffffff;
  --dh-surface-sunken: #f6f7f9;
  --dh-text: #16181d;
  --dh-text-muted: #5f6672;
  --dh-border: #e3e6ea;
  --dh-accent-text: #ffffff;
  --dh-danger: #b42318;
  --dh-focus: #2563eb;
  --dh-bubble-in: #f1f3f5;
  --dh-shadow: 0 6px 24px -4px rgb(16 18 24 / 0.18), 0 2px 6px -2px rgb(16 18 24 / 0.12);
  --dh-radius: 12px;
  --dh-space: 4px;

  all: revert;
  display: block;
}

/* Follows the host page's scheme rather than imposing one — a dark-mode food
   ordering app should not get a white slab bolted to its corner. */
@media (prefers-color-scheme: dark) {
  :host {
    --dh-surface: #191c21;
    --dh-surface-sunken: #131519;
    --dh-text: #f2f4f7;
    --dh-text-muted: #9aa3b0;
    --dh-border: #2c3039;
    --dh-bubble-in: #252a32;
    --dh-focus: #7aa5ff;
    --dh-danger: #f97066;
    --dh-shadow: 0 6px 24px -4px rgb(0 0 0 / 0.55), 0 2px 6px -2px rgb(0 0 0 / 0.4);
  }
}

/* Screen-reader-only. Every tick, every unread count, and every connection
   state has one of these, because the brief's "ticks need text equivalents,
   not colour alone" is the same requirement as WCAG 1.4.1. */
.dh-sr {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  margin: 0;
  cursor: pointer;
}

/* ':focus-visible' only, so a pointer user does not get a ring on every click,
   but every keyboard user gets one on every control. Never removed without a
   replacement. */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--dh-focus);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ── Launcher ─────────────────────────────────────────────────────────── */

.dh-launcher {
  position: fixed;
  bottom: calc(var(--dh-space) * 5);
  inset-inline-end: calc(var(--dh-space) * 5);
  width: 56px; height: 56px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--dh-accent);
  color: var(--dh-accent-text);
  box-shadow: var(--dh-shadow);
  transition: transform 160ms ease, opacity 160ms ease;
  /* The container is 'pointer-events: none' so it cannot swallow clicks on the
     host page while it spans the viewport in the top layer (ui/root.ts). Every
     element that must actually be clickable turns them back on here. */
  pointer-events: auto;
}
.dh-launcher:hover { transform: scale(1.04); }
.dh-launcher:active { transform: scale(0.97); }
.dh-launcher[hidden] { display: none; }

/* The sidebar's launcher is an edge tab, not a circle — the brief's "side tab
   that slides in". Vertical text keeps it narrow enough not to eat content. */
:host([data-presentation="sidebar"]) .dh-launcher {
  bottom: auto;
  top: 50%;
  translate: 0 -50%;
  width: 40px;
  height: auto;
  padding: calc(var(--dh-space) * 4) calc(var(--dh-space) * 2);
  border-radius: var(--dh-radius) 0 0 var(--dh-radius);
  gap: calc(var(--dh-space) * 2);
}
:host([data-presentation="sidebar"][data-side="left"]) .dh-launcher {
  border-radius: 0 var(--dh-radius) var(--dh-radius) 0;
}
:host([data-presentation="sidebar"]) .dh-launcher-label {
  writing-mode: vertical-rl;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.dh-launcher-label { display: none; }
:host([data-presentation="sidebar"]) .dh-launcher-label { display: block; }
:host([data-presentation="sidebar"]) .dh-launcher:hover { transform: none; }

/* The unread badge. Its number is decoration: the count is also in the
   launcher's accessible name, so a screen reader hears "Open chat, 3 unread
   messages" rather than an unannounced red dot. */
.dh-badge {
  position: absolute;
  top: -2px; inset-inline-end: -2px;
  min-width: 20px; height: 20px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--dh-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  border: 2px solid var(--dh-surface);
}
.dh-badge[hidden] { display: none; }

/* ── Panel ────────────────────────────────────────────────────────────── */

.dh-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dh-surface);
  color: var(--dh-text);
  border: 1px solid var(--dh-border);
  box-shadow: var(--dh-shadow);
  opacity: 0;
  visibility: hidden;
  pointer-events: auto;
  transition: opacity 180ms ease, translate 220ms cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear 220ms;
}
.dh-panel[data-open="true"] {
  opacity: 1;
  visibility: visible;
  translate: none;
  transition-delay: 0s;
}

/* bubble: a floating card anchored above the launcher. */
:host([data-presentation="bubble"]) .dh-panel {
  bottom: calc(var(--dh-space) * 5 + 56px + var(--dh-space) * 3);
  inset-inline-end: calc(var(--dh-space) * 5);
  width: min(384px, calc(100vw - var(--dh-space) * 8));
  height: min(560px, calc(100dvh - 140px));
  border-radius: var(--dh-radius);
  translate: 0 8px;
}

/* sidebar: full-height, edge-anchored, slides in horizontally. */
:host([data-presentation="sidebar"]) .dh-panel {
  top: 0; bottom: 0;
  inset-inline-end: 0;
  width: min(420px, 100vw);
  border-radius: 0;
  border-block: 0;
  translate: 100% 0;
}
:host([data-presentation="sidebar"][data-side="left"]) .dh-panel { translate: -100% 0; }

/* sheet: bottom-anchored, full width. 'dvh' is the whole reason this mode
   exists — with 'vh', iOS Safari's URL bar makes the composer sit under the
   fold, and the on-screen keyboard pushes it off entirely. */
:host([data-presentation="sheet"]) .dh-panel {
  left: 0; right: 0; bottom: 0;
  width: 100%;
  height: min(88dvh, 720px);
  max-height: 100dvh;
  border-radius: var(--dh-radius) var(--dh-radius) 0 0;
  border-bottom: 0;
  translate: 0 100%;
}

/* A grab handle, on the sheet only — it is the affordance that says "this
   panel came from the bottom edge and goes back there". */
.dh-grip { display: none; }
:host([data-presentation="sheet"]) .dh-grip {
  display: block;
  width: 36px; height: 4px;
  margin: calc(var(--dh-space) * 2) auto 0;
  border-radius: 999px;
  background: var(--dh-border);
  flex: none;
}

@media (prefers-reduced-motion: reduce) {
  .dh-panel, .dh-launcher { transition-duration: 1ms; }
  .dh-typing-dot { animation: none; }
}

/* ── Header ───────────────────────────────────────────────────────────── */

.dh-header {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 3);
  padding: calc(var(--dh-space) * 3) calc(var(--dh-space) * 4);
  border-bottom: 1px solid var(--dh-border);
  flex: none;
}
.dh-title { font-size: 15px; font-weight: 600; margin: 0; }
.dh-status {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 1.5);
  font-size: 12px;
  color: var(--dh-text-muted);
}
/* The dot is decoration; '.dh-status' carries the words. Never colour alone. */
.dh-status-dot {
  width: 7px; height: 7px;
  border-radius: 999px;
  background: currentColor;
  flex: none;
}
.dh-header-spacer { flex: 1; }
.dh-icon-button {
  width: 32px; height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--dh-text-muted);
}
.dh-icon-button:hover { background: var(--dh-surface-sunken); color: var(--dh-text); }
.dh-icon-button[disabled] { opacity: 0.45; cursor: not-allowed; }

/* ── Message list ─────────────────────────────────────────────────────── */

.dh-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;      /* the host page must not scroll behind us */
  -webkit-overflow-scrolling: touch;
  padding: calc(var(--dh-space) * 4);
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 2);
  background: var(--dh-surface);
}
.dh-log:focus-visible { outline-offset: -2px; }

.dh-more {
  align-self: center;
  padding: calc(var(--dh-space) * 1.5) calc(var(--dh-space) * 3);
  border-radius: 999px;
  border: 1px solid var(--dh-border);
  font-size: 13px;
  color: var(--dh-text-muted);
}
.dh-more[hidden] { display: none; }

.dh-msg {
  display: flex;
  flex-direction: column;
  max-width: 82%;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border-radius: var(--dh-radius);
  overflow-wrap: anywhere;           /* a pasted URL must not widen the panel */
  white-space: pre-wrap;             /* newlines the user typed are content */
}
.dh-msg[data-mine="false"] {
  align-self: flex-start;
  background: var(--dh-bubble-in);
  border-bottom-left-radius: 4px;
}
.dh-msg[data-mine="true"] {
  align-self: flex-end;
  background: var(--dh-accent);
  color: var(--dh-accent-text);
  border-bottom-right-radius: 4px;
}
.dh-msg[data-failed="true"] {
  border: 1px solid var(--dh-danger);
}
.dh-msg-sender {
  font-size: 12px;
  font-weight: 600;
  color: var(--dh-text-muted);
  margin-bottom: calc(var(--dh-space) * 0.5);
}
.dh-msg-meta {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 1.5);
  margin-top: calc(var(--dh-space) * 1);
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.dh-msg[data-mine="true"] .dh-msg-meta { justify-content: flex-end; }

/* Ticks. The glyph is a visual shorthand and carries no information of its
   own — every one is paired with a '.dh-sr' phrase, so "read" is announced,
   not inferred from two blue check marks. */
.dh-tick { font-size: 12px; letter-spacing: -0.08em; }
.dh-tick[data-state="read"] { color: #53a3ff; opacity: 1; }
.dh-msg[data-mine="true"] .dh-tick[data-state="read"] { color: #9ecbff; }

.dh-attachment {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 2);
  margin-top: calc(var(--dh-space) * 1);
  font-size: 13px;
  text-decoration: underline;
  color: inherit;
}
.dh-attachment-image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  border-radius: 8px;
  margin-top: calc(var(--dh-space) * 1);
}
.dh-audio { margin-top: calc(var(--dh-space) * 1); max-width: 100%; }

.dh-empty {
  margin: auto;
  text-align: center;
  color: var(--dh-text-muted);
  font-size: 13px;
  padding: calc(var(--dh-space) * 6);
}

.dh-retry {
  font-size: 12px;
  color: var(--dh-danger);
  text-decoration: underline;
  padding: 0;
}
.dh-msg[data-mine="true"] .dh-retry { color: #ffd7d3; }

/* ── Typing indicator ─────────────────────────────────────────────────── */

.dh-typing {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 1);
  align-self: flex-start;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border-radius: var(--dh-radius);
  background: var(--dh-bubble-in);
}
.dh-typing[hidden] { display: none; }
.dh-typing-dot {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: var(--dh-text-muted);
  animation: dh-bounce 1.2s infinite ease-in-out;
}
.dh-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.dh-typing-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes dh-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-3px); opacity: 1; }
}

/* ── Composer ─────────────────────────────────────────────────────────── */

.dh-composer {
  flex: none;
  border-top: 1px solid var(--dh-border);
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  /* Keeps the composer clear of the iOS home indicator in sheet mode. */
  padding-bottom: max(calc(var(--dh-space) * 2), env(safe-area-inset-bottom));
  background: var(--dh-surface);
}
.dh-composer-row {
  display: flex;
  align-items: flex-end;
  gap: calc(var(--dh-space) * 2);
}
.dh-input {
  flex: 1;
  min-height: 38px;
  max-height: 120px;
  resize: none;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-border);
  border-radius: 10px;
  background: var(--dh-surface-sunken);
  color: var(--dh-text);
  font: inherit;
  /* 16px on touch: anything smaller makes iOS Safari zoom the whole page on
     focus, which on a food-ordering checkout is actively destructive. */
  font-size: 16px;
}
@media (pointer: fine) { .dh-input { font-size: 14px; } }
.dh-input::placeholder { color: var(--dh-text-muted); opacity: 1; }
.dh-input:disabled { opacity: 0.6; cursor: not-allowed; }

.dh-send {
  width: 38px; height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--dh-accent);
  color: var(--dh-accent-text);
}
.dh-send[disabled] { opacity: 0.4; cursor: not-allowed; }

.dh-preview {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 2);
  margin-bottom: calc(var(--dh-space) * 2);
  padding: calc(var(--dh-space) * 2);
  border: 1px solid var(--dh-border);
  border-radius: 10px;
  background: var(--dh-surface-sunken);
  font-size: 13px;
}
.dh-preview[hidden] { display: none; }
.dh-preview-thumb {
  width: 40px; height: 40px;
  border-radius: 6px;
  object-fit: cover;
  flex: none;
}
.dh-preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dh-preview-size { color: var(--dh-text-muted); font-size: 12px; flex: none; }

.dh-recording {
  display: flex;
  align-items: center;
  gap: calc(var(--dh-space) * 2);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.dh-recording[hidden] { display: none; }
.dh-level {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--dh-border);
  overflow: hidden;
}
.dh-level-fill {
  height: 100%;
  width: 0%;
  background: var(--dh-danger);
  transition: width 80ms linear;
}

.dh-error {
  margin-bottom: calc(var(--dh-space) * 2);
  padding: calc(var(--dh-space) * 2);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dh-danger) 12%, transparent);
  color: var(--dh-danger);
  font-size: 12px;
}
.dh-error[hidden] { display: none; }

.dh-file { display: none; }
`;
