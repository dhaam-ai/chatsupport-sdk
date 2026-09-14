// Every style the STANDALONE web form has, as one string injected into its
// shadow root.
//
// ── Why this is not `ui/styles.ts` ────────────────────────────────────────
//
// `STYLES` is ~2,400 lines describing a launcher, a panel, a message thread,
// a composer, an emoji picker, a voice recorder, three presentations and a
// CSAT scale. A standalone form renders none of it. Importing that string
// would put all of it in `dist/form.js` — a bundle whose entire reason to
// exist is being small enough to drop onto a merchant's contact page.
//
// So this is a deliberate SECOND sheet covering exactly the classes
// `ui/webform-form.ts` and `ui/forms.ts` emit. The declarations for the
// shared classes are copied from `STYLES` rather than invented, so the
// standalone form and the in-widget form look like the same form — and the
// copy is one-directional and small enough to re-check by eye. A future
// change to the in-widget form's LOOK has to be made here too; that cost is
// the price of not shipping a chat client to render a contact form.
//
// ── The three placements below were arrived at empirically, in STYLES ─────
//
// 1. `[hidden] { display: none !important }` as ONE rule. The UA's own
//    `[hidden]` rule has specificity (0,1,0) and so does any class rule, so
//    a later `.dh-offline-sent { display: flex }` silently wins and an
//    element built with `hidden:true` renders anyway. `STYLES` answered that
//    one class at a time for a while and the classes added in each pass kept
//    forgetting. One rule, `!important`, scoped to this shadow root.
//
// 2. The typographic reset is on `.dh-form-root`, a SHADOW-TREE element, and
//    not on `:host`. `:host` rules lose to any outer-document rule that
//    matches the host element, and a host page carrying
//    `* { font-family: X !important }` matches it — the host element is an
//    ordinary light-DOM node. No host selector can reach `.dh-form-root`, so
//    declarations there are final. This is the single most important line in
//    this file for "renders on a stranger's website".
//
// 3. The theme tokens ARE on `:host`, and that is the same fact used the
//    other way round: because an outer-document rule beats `:host`, a
//    merchant can restyle this form from their own stylesheet with
//    `dh-web-form { --dh-accent: #c0392b }` and it wins. That is the
//    deliberate escape hatch for the one real cost of a shadow root — that
//    the merchant's brand CSS cannot otherwise reach us. Nothing else in
//    here is reachable from the host page, by design.

// 4. `:host { all: revert }`, not `all: initial`. `initial` would also reset
//    `direction` to `ltr`, which breaks every RTL host page — that is the
//    whole reason, and it is one reason, not two. It would NOT disturb the
//    tokens above it: per css-variables-1, `all` does not apply to custom
//    properties at all, so "it would reset the tokens" is not a second
//    argument for `revert` and is written down here only so the next reader
//    does not go looking for a constraint that does not exist.
//
// ── Comments in the string below are SHIPPED ─────────────────────────────
//
// Everything from `FORM_STYLES` on is a template literal, so a `/* … */` in
// it is string content: esbuild's minifier does not touch it and every
// visitor to a merchant's contact page downloads it. Reasoning therefore
// belongs up here, in a comment the build strips, and the string gets a
// pointer. (Checked, not assumed: `grep -c 'css-variables-1' dist/form.js`
// returned 1 when this note was written in the CSS instead.)

/**
 * The tokens. Declared on `:host` so a merchant can override any of them from
 * their own sheet (see the header) and so they inherit into the whole tree.
 */
const LIGHT_TOKENS = `
  --dh-surface: #ffffff;
  --dh-surface-sunken: #f6f7f9;
  --dh-text: #16181d;
  --dh-text-muted: #5f6672;
  --dh-border: #e3e6ea;
  --dh-danger: #b42318;
  --dh-accent: #2563eb;
  --dh-on-accent: #ffffff;
  --dh-focus: #2563eb;
  --dh-radius: 12px;
  --dh-space: 4px;
`;

const DARK_TOKENS = `
  --dh-surface: #191c21;
  --dh-surface-sunken: #131519;
  --dh-text: #f2f4f7;
  --dh-text-muted: #9aa3b0;
  --dh-border: #2c3039;
  --dh-danger: #f97066;
  --dh-focus: #7aa5ff;
`;

const SYSTEM_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const FORM_STYLES = `
*, *::before, *::after { box-sizing: border-box; }

/* See note 1 in this module's header. */
[hidden] { display: none !important; }

:host {
${LIGHT_TOKENS}
  /* See note 4. */
  all: revert;
  display: block;
}

/* Follows the host page's scheme by default. A merchant who wants one scheme
   pins it by setting the tokens themselves from their own sheet, which beats
   both of these for the same reason ':host' loses (header, note 3). */
@media (prefers-color-scheme: dark) {
  :host {${DARK_TOKENS}}
}

/* See note 2 in this module's header. This is the reset that actually holds. */
.dh-form-root {
  font-family: var(--dh-font, ${SYSTEM_FONT_STACK});
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
  /* A readable measure even inside a 1200px container. 'none' turns it off. */
  max-width: var(--dh-form-max-width, 34rem);
}

button {
  font: inherit;
  color: inherit;
  margin: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

/* Screen-reader-only — the honeypot's wrapper. No offsets at all: a '-9999px'
   offset inside someone else's layout is its own horizontal-overflow risk,
   and a later physical 'left' would override a logical 'inset-inline-start'. */
.dh-sr {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.dh-webform { display: flex; flex-direction: column; }

/* Copied from STYLES' own '.dh-form', minus 'overflow-y: auto'. An inline
   embed has no fixed height to scroll inside; it grows and the HOST page
   scrolls, which is what a form in someone's page is supposed to do. */
.dh-form {
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 2);
}

.dh-form-heading { font-size: 15px; font-weight: 600; color: var(--dh-text); margin: 0; }
.dh-form-subtitle { font-size: 13px; line-height: 1.5; color: var(--dh-text-muted); margin: 0; }

.dh-field { display: flex; flex-direction: column; gap: var(--dh-space); }
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
  /* 16px on touch: anything smaller makes iOS Safari zoom the whole page on
     focus, which on a merchant's contact page zooms THEIR page. */
  font-size: 16px;
}
.dh-field-input:focus-visible {
  border-color: var(--dh-accent);
  /* An explicit ring rather than the UA default: the UA outline is drawn in
     the host page's own 'outline-color' where one is set, and a merchant
     with 'outline: none' in a reset would otherwise leave this form with no
     visible focus at all. WCAG 2.4.7 is not the host's to switch off. */
  outline: 2px solid var(--dh-focus);
  outline-offset: 2px;
}
.dh-offline-message { resize: vertical; min-height: 88px; }

.dh-form-error { font-size: 12.5px; color: var(--dh-danger); margin: 0; }

.dh-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--dh-space) * 2);
}
.dh-form-actions .dh-form-submit { flex: 1; }
.dh-form-submit {
  min-height: 44px;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 4);
  border-radius: 10px;
  background: var(--dh-accent);
  color: var(--dh-on-accent);
  font: inherit;
  font-weight: 600;
}
.dh-form-submit[disabled] { opacity: 0.6; cursor: not-allowed; }
.dh-form-skip, .dh-webform-alt {
  min-height: 36px;
  color: var(--dh-text-muted);
  font: inherit;
  font-size: 12.5px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dh-space);
  padding: calc(var(--dh-space) * 8);
  text-align: center;
}

/* The one surface this sheet adds that the in-widget form has no equivalent
   of: a form that CANNOT be submitted, because the boot read already told us
   the submit will be refused for the same reason. Rendered above the form
   rather than instead of it — see 'form.ts', 'blockForSure'. */
.dh-form-blocked {
  display: flex;
  flex-direction: column;
  gap: var(--dh-space);
  padding: calc(var(--dh-space) * 3);
  border: 1px solid var(--dh-danger);
  border-radius: var(--dh-radius);
  color: var(--dh-text);
  font-size: 13px;
  line-height: 1.5;
}
`;
