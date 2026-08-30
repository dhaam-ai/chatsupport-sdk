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

const SYSTEM_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The console's font NAMES → real CSS stacks.
 *
 * Deliberately not the console's own table. `chatsupport_react` maps these to
 * `var(--font-inter)` and friends — Next.js font-loader variables that exist
 * only on a page Next rendered. This bundle runs on any merchant's storefront,
 * where those variables resolve to nothing and the declaration is dropped, so
 * the named family goes in literally with a system fallback behind it.
 *
 * The consequence, stated because it is a real limitation rather than an
 * oversight: nothing here LOADS a webfont. A merchant who picks Inter gets
 * Inter if their page already serves it and the system stack if not, because
 * injecting a `@font-face` from a third-party script would add a render-
 * blocking download to someone else's page without asking.
 */
const FONT_STACKS: Readonly<Record<string, string>> = {
  'System default': SYSTEM_FONT_STACK,
  Inter: `Inter, ${SYSTEM_FONT_STACK}`,
  'DM Sans': `'DM Sans', ${SYSTEM_FONT_STACK}`,
  Roboto: `Roboto, ${SYSTEM_FONT_STACK}`,
  Georgia: 'Georgia, "Times New Roman", serif',
};

/**
 * A console font name → the stack that renders it. An unknown name — a face a
 * newer console offers and this bundle has never heard of — falls back to the
 * system stack rather than to an invalid declaration.
 *
 * Exported because the live-config path in widget.ts needs the same mapping:
 * a published `fontFamily` arriving after mount is applied as an inline
 * `--dh-font`, and computing the stack a second time there is how the two
 * would drift.
 */
export function fontStackFor(name: string): string {
  return FONT_STACKS[name] ?? SYSTEM_FONT_STACK;
}

/**
 * Tokens only. Kept separate from {@link STYLES} because these are the only
 * declarations that depend on runtime config, so the ~9KB of static CSS below
 * stays a module-scope constant that the engine parses once.
 */
export function themeCss(config: ResolvedConfig): string {
  // CUSTOM PROPERTIES ONLY. Not `font-family` itself — see the header: a host
  // rule that matches the shadow HOST element beats a `:host` rule, and an
  // `!important` one beats it unconditionally. A custom property is immune,
  // because no host page sets `--dh-font` by accident.
  //
  // `inherit` is expressible in the same mechanism: the value flows into
  // `font-family: var(--dh-font)` on the subtree roots below, and
  // `font-family: inherit` there means "adopt the host element's font", which
  // is exactly what a host asking for brand continuity wants.
  //
  // It also OUTRANKS `fontFamily`, and that ordering is the whole point of the
  // two settings being separate — see config.ts's `fontFamily` doc.
  const font = config.font === 'inherit' ? 'inherit' : fontStackFor(config.fontFamily);

  return `:host{
    --dh-font: ${font};
    --dh-accent: ${cssColor(config.accent)};
    --dh-radius: ${cssPx(config.cornerRadius, 12)};
    --dh-offset-x: ${cssPx(config.offsetX, 20)};
    --dh-offset-y: ${cssPx(config.offsetY, 20)};
  }`;
}

/**
 * A config-supplied length, as a CSS pixel value.
 *
 * The same containment job {@link cssColor} does, for the other kind of value
 * that reaches a stylesheet. `NaN` and `Infinity` both survive `String()` and
 * both produce a declaration the engine drops — which takes the WHOLE `:host`
 * rule's remaining declarations with it in some engines, so one bad number
 * from a hand-written `mount()` call could cost the accent and the font too.
 * Negative lengths are refused for the same reason `border-radius: -4px` is:
 * there is no reading of one that renders.
 *
 * Clamped rather than thrown on, unlike `sheetBreakpointPx`: this value also
 * arrives from published config, and a merchant dragging a slider must never
 * be able to stop a widget booting on someone else's checkout page.
 */
export function cssPx(value: number, fallback: number): string {
  return `${Number.isFinite(value) && value >= 0 ? value : fallback}px`;
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
export function cssColor(value: string): string {
  return /[;{}()<>\\]|\/\*/.test(value) ? '#1f2937' : value.trim();
}

/**
 * The dark half of the palette, interpolated into {@link STYLES} twice.
 *
 * Twice because there are two independent ways to be in dark mode and they
 * cannot be expressed as one selector: the host page's OS preference (a media
 * query) and an explicit `theme: 'dark'` (an attribute). Declaring the tokens
 * once here is what stops the two copies drifting — the bug this shape exists
 * to prevent is a token added to the media query and forgotten in the
 * attribute rule, which renders a half-dark widget only for the merchants who
 * pinned the scheme.
 *
 * Still module scope, so {@link STYLES} is still a constant the engine parses
 * once — the interpolation happens at module evaluation, not per mount.
 */
const DARK_TOKENS = `
  --dh-surface: #191c21;
  --dh-surface-sunken: #131519;
  --dh-text: #f2f4f7;
  --dh-text-muted: #9aa3b0;
  --dh-border: #2c3039;
  --dh-bubble-in: #252a32;
  --dh-focus: #7aa5ff;
  --dh-danger: #f97066;
  --dh-shadow: 0 6px 24px -4px rgb(0 0 0 / 0.55), 0 2px 6px -2px rgb(0 0 0 / 0.4);
`;

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
  /* '--dh-radius' is NOT declared here. It is config-driven and belongs to
     themeCss(), which is appended after this sheet — declaring a second copy
     here would be dead the moment it disagreed, and the disagreement is the
     kind nobody notices until a merchant's corners are the wrong shape. */
  --dh-space: 4px;

  all: revert;
  display: block;
}

/* The typographic reset, applied to the two SHADOW-TREE roots rather than to
   ':host'.

   This placement is the whole point and it was arrived at empirically: with the
   reset on ':host', a host page carrying '* { font-family: X !important }'
   rendered the entire widget in its own display face. ':host' rules lose to any
   outer-document rule that matches the host element, and '*' matches it — the
   host element is an ordinary light-DOM node. Everything NOT inherited
   (background, border, radius, text-transform) was correctly blocked by the
   shadow boundary the whole time; only inherited properties ever got through,
   and they got through by inheritance rather than by selector.

   No host selector can reach '.dh-launcher' or '.dh-panel', so declarations
   here are final. */
.dh-launcher, .dh-panel {
  font-family: var(--dh-font);
  font-size: 15px;
  font-weight: 400;
  font-style: normal;
  font-variant: normal;
  line-height: 1.45;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-indent: 0;
  text-align: start;
  text-shadow: none;
  white-space: normal;
  color: var(--dh-text);
}

/* ── Colour scheme ────────────────────────────────────────────────────────

   'theme: auto' (the default) follows the host page's scheme rather than
   imposing one — a dark-mode food ordering app should not get a white slab
   bolted to its corner. 'light'/'dark' pin one, for a merchant whose brand
   only works in one of them.

   The OS rule is an override ON TOP OF the light tokens on ':host', so the
   explicit LIGHT case needs no rule of its own: excluding it from the media
   query is enough, and one rule that opts out beats two rules that
   re-declare the same palette and drift apart. ':host(:not([data-theme=
   "light"]))' also covers the attribute being ABSENT entirely, which is what
   a widget mounted before its published config lands looks like. */
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {${DARK_TOKENS}}
}

/* Last, and higher-specificity than the base ':host', so a pinned dark theme
   wins on a light OS. Where both this and the media query match they set
   identical tokens, so which one wins does not matter. */
:host([data-theme="dark"]) {${DARK_TOKENS}}

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

/* 'right'/'bottom', not 'inset-inline-*'. A merchant picking "bottom right"
   in a console showing a right-anchored preview means the right of the
   screen; a logical property would put it in the other corner on an RTL
   storefront, which is a setting silently doing the opposite of what it says.
   Everything INSIDE the widget stays logical — only the viewport anchor is
   physical, because only the anchor is what the merchant named. */
.dh-launcher {
  position: fixed;
  bottom: var(--dh-offset-y);
  right: var(--dh-offset-x);
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

:host([data-position="bottom-left"]) .dh-launcher {
  right: auto;
  left: var(--dh-offset-x);
}

/* ── Launcher shapes ──────────────────────────────────────────────────────

   'bubble' is the base rule above and needs no variant. The other two grow
   sideways to fit a label, so they trade the fixed 56px square for auto width
   and lay their two children out in a row — 'place-items: center' on the base
   rule keeps both centred either way. */
:host([data-launcher="bubble-label"]) .dh-launcher,
:host([data-launcher="tab"]) .dh-launcher {
  width: auto;
  grid-auto-flow: column;
  gap: calc(var(--dh-space) * 2.5);
  white-space: nowrap;
}
:host([data-launcher="bubble-label"]) .dh-launcher {
  padding: 0 calc(var(--dh-space) * 5) 0 calc(var(--dh-space) * 4);
}

/* A tab hugs the wall, so it drops the two corners facing it and gives up its
   horizontal offset — an offset gap behind a shape whose whole idea is being
   flush against the edge is the one thing it must not have. The VERTICAL
   offset still applies: that is how far up from the bottom it sits. */
:host([data-launcher="tab"]) .dh-launcher {
  height: 48px;
  padding: 0 calc(var(--dh-space) * 4);
  right: 0;
  border-radius: 999px 0 0 999px;
}
:host([data-launcher="tab"][data-position="bottom-left"]) .dh-launcher {
  right: auto;
  left: 0;
  border-radius: 0 999px 999px 0;
}

/* The sidebar's launcher is an edge tab, not a circle — the brief's "side tab
   that slides in". Vertical text keeps it narrow enough not to eat content.

   It also takes back the horizontal anchor, and must come AFTER the
   'data-position' rule above to do it: a sidebar is a full-height tab with no
   bottom corner to sit in, so its edge is 'data-side' (which also decides
   which way the panel slides) rather than the launcher's own corner setting.
   Letting both apply would let a merchant park the tab on the opposite edge
   from the panel it opens. */
:host([data-presentation="sidebar"]) .dh-launcher {
  right: var(--dh-offset-x);
  left: auto;
  bottom: auto;
  top: 50%;
  translate: 0 -50%;
  width: 40px;
  height: auto;
  padding: calc(var(--dh-space) * 4) calc(var(--dh-space) * 2);
  border-radius: var(--dh-radius) 0 0 var(--dh-radius);
  gap: calc(var(--dh-space) * 2);
  /* Stacked, not side by side. Restated rather than left to the grid default
     because 'data-launcher="tab"' above sets 'column' and this rule has to be
     able to take it back — a vertical rail 40px wide cannot lay an icon and a
     rotated label out in a row. Every other property this block needs from
     that rule is already re-declared here for the same reason. */
  grid-auto-flow: row;
}
:host([data-presentation="sidebar"][data-side="left"]) .dh-launcher {
  left: var(--dh-offset-x);
  right: auto;
  border-radius: 0 var(--dh-radius) var(--dh-radius) 0;
}
/* Hidden by default and shown by whichever shape has room for it. Three
   selectors rather than one, because the sidebar's edge tab shows a label for
   a reason of its own — it is a structural presentation, not the 'tab'
   launcher STYLE — and collapsing them would tie the two together. */
.dh-launcher-label { display: none; }
:host([data-launcher="bubble-label"]) .dh-launcher-label,
:host([data-launcher="tab"]) .dh-launcher-label,
:host([data-presentation="sidebar"]) .dh-launcher-label { display: block; }

:host([data-launcher="bubble-label"]) .dh-launcher-label,
:host([data-launcher="tab"]) .dh-launcher-label {
  font-size: 14px;
  font-weight: 600;
  /* A merchant's label is free text and the launcher sits over their own
     page, so it is capped rather than allowed to span the viewport. */
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* LAST, so it wins the tie against the launcher-style typography above when
   both match — a merchant's 'tab' style on a host's sidebar presentation. The
   rail owns its own type: rotated, narrower, and with no horizontal cap,
   which is the wrong axis to clamp on vertical text. */
:host([data-presentation="sidebar"]) .dh-launcher-label {
  writing-mode: vertical-rl;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  max-width: none;
}
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
  transition-delay: 0s;
}

/* The off-screen offsets belong to the CLOSED state, never to the open one.

   Written the other way round first — a per-presentation 'translate' plus a
   ':host(...) .dh-panel' selector — and every presentation stayed off screen.
   ':host([data-presentation="sidebar"]) .dh-panel' scores (0,2,1) against
   '.dh-panel[data-open="true"]'s (0,2,0), so the open rule's 'translate: none'
   silently lost and the sidebar rendered at left:1280 on a 1280px viewport.
   Putting each offset behind '[data-open="false"]' removes the competing
   declaration instead of trying to out-specify it, which is the version that
   cannot regress when a fourth presentation is added. */

/* bubble: a floating card anchored above the launcher — so it takes the same
   physical corner and the same offsets, for the same reason. */
:host([data-presentation="bubble"]) .dh-panel {
  bottom: calc(var(--dh-offset-y) + 56px + var(--dh-space) * 3);
  right: var(--dh-offset-x);
  width: min(384px, calc(100vw - var(--dh-space) * 8));
  height: min(560px, calc(100dvh - 140px));
  border-radius: var(--dh-radius);
}
:host([data-position="bottom-left"][data-presentation="bubble"]) .dh-panel {
  right: auto;
  left: var(--dh-offset-x);
}
:host([data-presentation="bubble"]) .dh-panel[data-open="false"] { translate: 0 8px; }

/* sidebar: full-height, edge-anchored, slides in horizontally. */
:host([data-presentation="sidebar"]) .dh-panel {
  top: 0; bottom: 0;
  inset-inline-end: 0;
  /* Pinned rather than inherited: 'inset-inline-end' and the translate above
     both resolve against 'direction', which crosses the shadow boundary, so an
     RTL host page would otherwise slide the panel in from the side opposite
     the one 'data-side' names. */
  direction: ltr;
  width: min(420px, 100vw);
  border-radius: 0;
  border-block: 0;
}
:host([data-presentation="sidebar"]) .dh-panel[data-open="false"] { translate: 100% 0; }
:host([data-presentation="sidebar"][data-side="left"]) .dh-panel[data-open="false"] { translate: -100% 0; }

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
}
:host([data-presentation="sheet"]) .dh-panel[data-open="false"] { translate: 0 100%; }

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

/* Shown only in a state core has stopped retrying out of, so it reads as the
   one thing left to do rather than as permanent header furniture. */
.dh-reconnect {
  padding: calc(var(--dh-space) * 1.5) calc(var(--dh-space) * 3);
  border-radius: 999px;
  border: 1px solid var(--dh-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--dh-text);
  white-space: nowrap;
}
.dh-reconnect:hover { background: var(--dh-surface-sunken); }
.dh-reconnect[hidden] { display: none; }
.dh-reconnect[disabled] { opacity: 0.45; cursor: not-allowed; }

/* ── Human hand-off ───────────────────────────────────────────────────── */

/*
 * Sits on the seam between the transcript and the composer. flex: none for
 * the same reason .dh-composer has it: the log is the only element in the
 * panel column allowed to absorb the spare height, and a growable strip here
 * would take it from the conversation.
 */
.dh-handoff {
  flex: none;
  align-self: stretch;
  margin: 0 calc(var(--dh-space) * 3) calc(var(--dh-space) * 2);
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border-radius: 999px;
  border: 1px solid var(--dh-accent);
  font-size: 13px;
  font-weight: 600;
  color: var(--dh-accent);
  background: transparent;
}
.dh-handoff:hover { background: var(--dh-surface-sunken); }
/* An explicit rule, not the UA default: display here is set by this sheet,
 * and a stylesheet declaration beats the UA's [hidden] rule. */
.dh-handoff[hidden] { display: none; }
.dh-handoff[disabled] { opacity: 0.45; cursor: not-allowed; }

/* ── Common Questions ─────────────────────────────────────────────────── */

/*
 * Same seam as .dh-handoff above (flex: none, same rationale) — it sits in
 * the same "between the log and the composer" position, just shown at the
 * opposite moment: before the first message rather than mid-conversation.
 */
.dh-common-questions-host {
  flex: none;
  margin: 0 calc(var(--dh-space) * 3) calc(var(--dh-space) * 2);
}
.dh-common-questions-host[hidden] { display: none; }

.dh-common-questions {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--dh-space) * 1);
}

.dh-common-question-chip {
  flex: none;
  padding: calc(var(--dh-space) * 1.5) calc(var(--dh-space) * 2.5);
  border-radius: 999px;
  border: 1px solid var(--dh-border);
  background: var(--dh-surface);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dh-text);
  cursor: pointer;
  text-align: left;
}
.dh-common-question-chip:hover { background: var(--dh-surface-sunken); }

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

/* Who is speaking. Only the first bubble of a run carries one, so this is a
   heading for the run rather than a label repeated on every line. */
.dh-msg-author {
  font-size: 12px;
  font-weight: 600;
  color: var(--dh-text-muted);
  margin-bottom: calc(var(--dh-space) * 0.5);
}
.dh-msg-author[hidden] { display: none; }
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

/* The end-of-conversation line and its way out. Centred and full-width so it
   reads as chrome about the whole transcript rather than as another message
   in it — no bubble, no sender, no timestamp. */
.dh-system {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--dh-space) * 2);
  align-self: stretch;
  padding: calc(var(--dh-space) * 3) 0 calc(var(--dh-space) * 1);
  border-top: 1px solid var(--dh-border);
  margin-top: calc(var(--dh-space) * 2);
}
.dh-system[hidden] { display: none; }

.dh-system-text {
  margin: 0;
  text-align: center;
  color: var(--dh-text-muted);
  font-size: 13px;
}

.dh-system-action {
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 4);
  border-radius: 999px;
  border: 1px solid var(--dh-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--dh-accent, inherit);
}

/* The reason a failed send did not go through — shown whether or not a
   Retry button accompanies it, so a permanently-refused send still tells the
   customer why instead of just silently withholding the button. */
.dh-failure {
  font-size: 12px;
  color: var(--dh-danger);
}
.dh-failure[hidden] { display: none; }
.dh-msg[data-mine="true"] .dh-failure { color: #ffd7d3; }

.dh-retry {
  font-size: 12px;
  color: var(--dh-danger);
  text-decoration: underline;
  padding: 0;
}

/* Retrying into a session that has ended is the dead end this UI removes.
   The "start a new conversation" button is the way forward instead. */
.dh-log[data-closed="true"] .dh-retry { display: none; }
.dh-msg[data-mine="true"] .dh-retry { color: #ffd7d3; }

/* ── Session picker: pre-chat screen + in-chat switcher ──────────────────
   One row style (.dh-session-row and its children) shared by both
   surfaces (ui/session-picker.ts) — the "one component family" the two
   screens are built from. */

.dh-prechat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: calc(var(--dh-space) * 4);
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 3);
  background: var(--dh-surface);
}
.dh-prechat-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--dh-text-muted);
}

.dh-session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 2);
}
.dh-session-empty {
  text-align: center;
  color: var(--dh-text-muted);
  font-size: 13px;
  padding: calc(var(--dh-space) * 4) 0;
}
.dh-session-empty[hidden] { display: none; }

.dh-session-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: calc(var(--dh-space) * 1);
  padding: calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-border);
  border-radius: var(--dh-radius);
  background: var(--dh-surface);
  text-align: start;
}
.dh-session-row:hover { background: var(--dh-surface-sunken); }
.dh-session-row[aria-current="true"] { border-color: var(--dh-accent); }

.dh-session-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--dh-space) * 2);
}
.dh-session-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px calc(var(--dh-space) * 2);
  border-radius: 999px;
  background: var(--dh-surface-sunken);
  color: var(--dh-text-muted);
}
/* A terminal status is information, not an archive marker — no dimming, no
   disabled affordance. Picking this row reactivates it server-side. */
.dh-session-row[data-status="ON_HOLD"] .dh-session-status { color: #c98a00; }

.dh-session-time {
  font-size: 11px;
  color: var(--dh-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dh-session-preview {
  font-size: 13px;
  color: var(--dh-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dh-session-preview[hidden] { display: none; }

.dh-session-handler {
  font-size: 12px;
  color: var(--dh-text-muted);
}
.dh-session-handler[hidden] { display: none; }

.dh-session-unread {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 700;
  padding: 1px calc(var(--dh-space) * 2);
  border-radius: 999px;
  background: var(--dh-danger);
  color: #fff;
}
.dh-session-unread[hidden] { display: none; }

.dh-prechat-start, .dh-switcher-start {
  padding: calc(var(--dh-space) * 3);
  border-radius: 10px;
  background: var(--dh-accent);
  color: var(--dh-accent-text);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}
.dh-prechat-start[disabled], .dh-switcher-start[disabled] { opacity: 0.6; cursor: not-allowed; }

/* The in-chat switcher: a disclosure button plus a self-contained popover —
   position: relative lives on .dh-switcher itself so this renders correctly
   wherever the header mounts it, with no dependency on an ancestor's
   positioning context. */
.dh-switcher { position: relative; display: inline-flex; }
.dh-switcher-toggle[aria-expanded="true"] { background: var(--dh-surface-sunken); color: var(--dh-text); }

.dh-switcher-panel {
  position: absolute;
  top: calc(100% + var(--dh-space) * 2);
  inset-inline-end: 0;
  z-index: 2;
  width: min(300px, 80vw);
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 3);
  padding: calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-border);
  border-radius: var(--dh-radius);
  background: var(--dh-surface);
  box-shadow: var(--dh-shadow);
}
.dh-switcher-panel[hidden] { display: none; }

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
/* The slot a product surface occupies — same "stands in for the conversation"
   role as .dh-prechat, so it takes the same remaining height. */
.dh-surface-host { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow-y: auto; }

/* ── Data-collecting surfaces: pre-chat, out-of-hours, CSAT ────────────── */
.dh-form {
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 2);
  padding: calc(var(--dh-space) * 4);
  overflow-y: auto;
}
.dh-form-heading { font-size: 15px; font-weight: 600; color: var(--dh-text); margin: 0; }
.dh-form-subtitle { font-size: 13px; line-height: 1.5; color: var(--dh-text-muted); margin: 0; }
.dh-field { display: flex; flex-direction: column; gap: calc(var(--dh-space)); }
.dh-field-label { font-size: 12px; font-weight: 500; color: var(--dh-text-muted); }
.dh-field-optional { font-weight: 400; opacity: 0.75; }
.dh-field-input {
  width: 100%;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-border);
  border-radius: 10px;
  background: var(--dh-surface-sunken);
  color: var(--dh-text);
  font: inherit;
  /* 16px on touch, same reason as .dh-input: anything smaller makes iOS
     Safari zoom the whole page on focus. */
  font-size: 16px;
}
.dh-field-input:focus-visible { border-color: var(--dh-accent); }
.dh-offline-message { resize: none; }
.dh-form-error { font-size: 12.5px; color: var(--dh-danger, #b91c1c); margin: 0; }
.dh-form-error[hidden] { display: none; }
.dh-form-submit {
  min-height: 44px;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 4);
  border-radius: 10px;
  background: var(--dh-accent);
  color: var(--dh-on-accent, #fff);
  font: inherit;
  font-weight: 600;
}
.dh-form-submit[disabled] { opacity: 0.6; cursor: not-allowed; }
.dh-form-skip {
  min-height: 36px;
  color: var(--dh-text-muted);
  font: inherit;
  font-size: 12.5px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dh-offline { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dh-offline-banner {
  display: flex;
  flex-direction: column;
  gap: var(--dh-space);
  padding: calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-border);
  border-radius: var(--dh-radius);
  background: var(--dh-surface-sunken);
}
.dh-offline-sent {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dh-space);
  padding: calc(var(--dh-space) * 8);
  text-align: center;
}
.dh-offline-sent[hidden], .dh-csat-thanks[hidden], .dh-csat-comment[hidden] { display: none; }

.dh-csat-card { padding: calc(var(--dh-space) * 2); }
.dh-csat-scale { display: flex; justify-content: center; gap: var(--dh-space); }
.dh-csat-option {
  /* 44px: the same touch target every other control in this widget uses. */
  width: 44px; height: 44px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-size: 22px;
  line-height: 1;
}
.dh-csat-option:hover { background: var(--dh-surface-sunken); }
.dh-csat-stars .dh-csat-option { color: var(--dh-border); }
.dh-csat-stars .dh-csat-lit { color: var(--dh-accent); }
/* Emoji cannot be recoloured, so the unchosen faces recede by desaturating
   rather than by changing colour. */
.dh-csat-emoji .dh-csat-option { filter: grayscale(1); opacity: 0.45; }
.dh-csat-emoji .dh-csat-lit { filter: none; opacity: 1; }
.dh-csat-label {
  min-height: 16px;
  margin: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--dh-text-muted);
}
.dh-csat-comment { display: flex; flex-direction: column; gap: calc(var(--dh-space) * 2); }
.dh-csat-thanks {
  margin: 0;
  padding: calc(var(--dh-space) * 4);
  border-radius: var(--dh-radius);
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--dh-text);
  background: var(--dh-surface-sunken);
}

/* The emoji picker: same self-contained wrapper shape as .dh-switcher —
   position: relative on the wrapper, so the popover anchors to the trigger
   wherever the composer row places it. Opens UPWARD (bottom: 100%) because the
   composer already sits at the bottom of the panel. */
.dh-emoji { position: relative; display: inline-flex; }
.dh-emoji-glyph { font-size: 18px; line-height: 1; }
.dh-emoji-popover {
  position: absolute;
  bottom: calc(100% + var(--dh-space) * 2);
  inset-inline-start: 0;
  z-index: 3;
  padding: calc(var(--dh-space) * 2);
  border: 1px solid var(--dh-border);
  border-radius: var(--dh-radius);
  background: var(--dh-surface);
  box-shadow: var(--dh-shadow);
}
.dh-emoji-popover[hidden] { display: none; }
.dh-emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}
.dh-emoji-cell {
  width: 30px; height: 30px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 17px;
  line-height: 1;
}
.dh-emoji-cell:hover { background: var(--dh-surface-sunken); }

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
