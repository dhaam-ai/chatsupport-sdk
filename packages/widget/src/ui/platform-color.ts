// Reading a brand colour off the page the widget is installed on.
//
// `header.colorSource: 'platform'` is a merchant saying "use my site's
// colour" without entering a hex code, so the widget samples the host document
// instead of asking again. That is the whole module.
//
// ── Why this is not a screenshot ────────────────────────────────────────
//
// It walks a short list of the elements a site's colour actually lives on and
// takes the first one painted opaquely. It does NOT average pixels or read a
// canvas: `getComputedStyle` is exact, synchronous, and — decisively — cannot
// taint anything, where a canvas read of a page carrying cross-origin images
// throws a SecurityError the host would see in their own console as our bug.
//
// ── Null is an answer, not a failure ───────────────────────────────────
//
// A site with a transparent body genuinely has no colour to borrow, and a
// cross-origin frame refuses to be asked. Both return `null`, and the caller
// falls back to the configured accent — which is why nothing here reports an
// error: there is no misconfiguration to tell anyone about, only a page whose
// colour we could not name.

/**
 * Elements whose background is, in practice, the site's colour — its top bar
 * first, since that is where a brand is actually painted, and the document's
 * own surface last.
 */
const CANDIDATES = ['header', '[role="banner"]', 'nav', '.navbar', '.site-header', '#header'];

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** `getComputedStyle` returns `rgb()`/`rgba()`; anything else is not usable. */
function parseRgb(value: string): Rgb | null {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (match === null) return null;
  const parts = (match[1] as string)
    .split(/[\s,/]+/)
    .filter((part) => part !== '')
    .map(Number);
  const [r, g, b, a = 1] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
  return { r, g, b, a };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The host page's colour as a hex string, or `null` when there is none to take.
 *
 * Hex specifically, not the `rgb()` string it came from: the caller feeds this
 * to `readableOn` to decide the header's text colour, and that measures hex.
 *
 * Never throws. Every failure mode — no document, a cross-origin parent, a
 * `getComputedStyle` on a node that has since been detached — collapses to
 * `null`, because a widget that throws while picking a colour takes the host's
 * page down over a decoration.
 */
export function samplePlatformColor(): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const elements: (Element | null)[] = CANDIDATES.map((selector) =>
      document.querySelector(selector),
    );
    elements.push(document.body, document.documentElement);

    for (const element of elements) {
      if (element === null) continue;
      const parsed = parseRgb(getComputedStyle(element).backgroundColor);
      // Below fully opaque is a wash over something else, and sampling it
      // would give a colour the visitor never actually sees.
      if (parsed !== null && parsed.a >= 1) return toHex(parsed);
    }
  } catch {
    // A cross-origin frame, or a document that is not there yet. Neither is
    // something the merchant can act on, so neither is reported.
  }

  return null;
}
