// The smallest element helper that removes the two mistakes this UI would
// otherwise make repeatedly.
//
// Mistake one is `innerHTML`. Every string this widget renders is either a
// message body or a display name, and both come from other users of the host's
// product — the customer's own typing, an agent's reply. `innerHTML` on that
// path is stored XSS, and it is stored XSS *inside a shadow root on a
// customer's checkout page*, which is about the worst place to put it. So this
// module has no HTML-string entry point at all: text goes through `textContent`
// and nowhere else, and the only markup that is ever parsed is the icon set
// below, which is a module-scope constant with no interpolation in it.
//
// Mistake two is forgetting that `class` is not a property. `el('div', {
// class: 'x' })` and `element.class = 'x'` behave differently and the second
// silently does nothing; routing everything through `setAttribute` makes them
// the same thing.

/** Namespace for the icons. `createElement` would produce unstyleable HTML elements. */
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ElementSpec {
  /** Attributes. `null`/`undefined` values are skipped, so callers can inline conditionals. */
  readonly attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Text content. Always set via `textContent` — never parsed as markup. */
  readonly text?: string;
  readonly children?: readonly Node[];
  readonly on?: Record<string, EventListener>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  spec: ElementSpec = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applySpec(node, spec);
  return node;
}

function applySpec(node: Element, spec: ElementSpec): void {
  for (const [name, value] of Object.entries(spec.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  if (spec.text !== undefined) node.textContent = spec.text;
  for (const child of spec.children ?? []) node.appendChild(child);
  for (const [type, handler] of Object.entries(spec.on ?? {})) {
    node.addEventListener(type, handler);
  }
}

/**
 * Builds one icon from a path list.
 *
 * `aria-hidden` on every icon without exception: each one sits inside a
 * control that already carries a real accessible name, so an unhidden icon
 * would make a screen reader announce the button twice.
 */
export function icon(paths: readonly string[], size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export const ICONS = {
  chat: ['M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.8-.7L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7Z'],
  paperclip: ['M21.4 11.05 12.25 20.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  mic: ['M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z', 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18.5V22'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'],
  stop: ['M7 7h10v10H7z'],
  // The session-switcher toggle (ui/session-picker.ts) — a plain list glyph,
  // not a chat/clock icon, so it does not compete visually with the launcher.
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
} as const;

/**
 * The launcher glyphs the console's icon picker offers, keyed by its own ids.
 *
 * Deliberately OUTLINE, where `chatsupport_react`'s picker renders the same
 * ids as Heroicons *solid*. Two reasons, and the divergence is a choice rather
 * than an oversight: every other icon in this package is a 1.8px stroke drawn
 * by {@link icon}, so a solid glyph would be the only filled thing in the
 * widget; and matching the React set exactly would mean shipping eight new
 * filled paths for a control that renders one of them, on a bundle whose whole
 * budget is someone else's page-load. The id — which is what the merchant
 * actually picked — is honoured; the drawing is this renderer's.
 *
 * An id this bundle has never heard of falls back to `chat` rather than to
 * nothing: a newer console offering a ninth icon must not produce a blank
 * launcher on an older embed.
 */
export const LAUNCHER_ICONS: Readonly<Record<string, readonly string[]>> = {
  chat: ICONS.chat,
  chats: [
    'M17 9V7a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3v3l3-3',
    'M10 12a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3v3l-3-3h-3a3 3 0 0 1-3-3Z',
  ],
  message: ['M6 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z', 'M8 9h8', 'M8 13h5'],
  help: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
    'M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.9-.9 1.5v.7',
    'M12 17h.01',
  ],
  support: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M4.9 4.9 9.2 9.2',
    'M14.8 14.8l4.3 4.3',
    'M19.1 4.9 14.8 9.2',
    'M9.2 14.8l-4.3 4.3',
  ],
  phone: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z',
  ],
  mail: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'm2.5 7 9.5 6 9.5-6'],
  sparkle: [
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z',
    'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z',
  ],
};

/**
 * A config-supplied image URL, or `null` if it is not one we will load.
 *
 * The allowlist is the point. `logoUrl`, `imageUrl` and the header's avatars
 * all arrive from a merchant's console over a public endpoint, and every one
 * of them ends up in a `src` attribute inside a shadow root on someone else's
 * checkout page. Three things are refused:
 *
 *   - `javascript:` — inert in `<img src>` today, but this same guard is what
 *     the header's logo and CTA will pass through, and one of those could
 *     become an `<a href>` the day a design changes.
 *   - `data:` that is not an image — the console writes `data:image/…` for an
 *     uploaded file, and nothing else it writes has any business being one.
 *   - anything relative — it would resolve against the HOST page's origin, so
 *     a merchant's typo would silently fetch a random path off a storefront
 *     nobody involved controls.
 *
 * `blob:` is not on the list because it is meaningless here: a blob URL is
 * scoped to the document that created it, and this one arrived as JSON.
 */
export function safeImageUrl(value: string): string | null {
  const url = value.trim();
  if (url === '') return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);/i.test(url)) return url;
  return null;
}

/**
 * The same allowlist for a value going into an `href`, where the stakes are
 * higher than in a `src`.
 *
 * Deliberately NARROWER than {@link safeImageUrl} rather than a reuse of it:
 * `data:` is refused outright here. A `data:image/svg+xml` in an `<img>` is
 * rendered as a picture with no script, but the same string NAVIGATED to is a
 * document with a script — the exact difference the two guards exist to keep
 * apart. Only absolute `http(s)` survives, so `javascript:` is unreachable
 * rather than merely unlikely, and a relative path cannot silently point at
 * the host page's own origin.
 */
export function safeLinkUrl(value: string): string | null {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}
