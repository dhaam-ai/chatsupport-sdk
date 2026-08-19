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
} as const;
