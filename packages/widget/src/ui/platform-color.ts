// Reading a brand colour off the page the widget is installed on.
//
// `header.colorSource: 'platform'` is a merchant saying "use my site's
// colour" without entering a hex code, so the widget samples the host document
// instead of asking again. That is the whole module.
//
// ── Why this is not a screenshot ────────────────────────────────────────
//
// It walks a short list of the places a site's colour actually lives and
// takes the first usable answer. It does NOT average pixels or read a
// canvas: `getComputedStyle` is exact, synchronous, and — decisively — cannot
// taint anything, where a canvas read of a page carrying cross-origin images
// throws a SecurityError the host would see in their own console as our bug.
//
// ── What counts as "usable", learned against a real host ───────────────
//
// The first version took the first OPAQUE background it found, which on a
// live Tailwind host (dh-hyperlocal) meant: the `<nav>` was translucent
// (`bg-white/50`, skipped), so the sampler fell through to `<body>` and
// proudly returned `#f9fafb` — near-white. The header went white, and the
// merchant's verdict was "the feature does nothing", because a near-white
// sample is visually indistinguishable from no sample at all. Meanwhile the
// site's actual brand purple sat in `<meta name="theme-color">`, unread.
//
// Hence two changes, both visible in `samplePlatformColor`:
//
//   1. Near-white is NOT a colour to borrow. A white/off-white surface is
//      what an unstyled page looks like; painting the header with it reads
//      as broken, never as branding. Such samples are skipped and the walk
//      continues (usually to the theme-color meta, else to `null`).
//   2. `<meta name="theme-color">` is consulted after the top-bar elements
//      and before the page background. It is the one place a site DECLARES
//      its chrome colour — mobile browsers paint their own toolbar with it —
//      so it outranks the ambient body colour, but not a real, visibly
//      painted top bar.
//
// The same host also taught the parser some humility: Chrome serializes
// computed backgrounds it was given in modern notations (Tailwind v4 defines
// its whole palette in oklch) as `oklab(…)` or `color(srgb …)`, not
// `rgb(…)`. A parser that only speaks `rgb()` silently skips every such
// element, so those two forms are converted here — closed-form math, no DOM
// tricks (re-serializing through a probe element just returns the same
// string).
//
// ── Null is an answer, not a failure ───────────────────────────────────
//
// A site with a transparent or white body genuinely has no colour to borrow,
// and a cross-origin frame refuses to be asked. Both return `null`, and the
// caller falls back to the configured accent — which is why nothing here
// reports an error: there is no misconfiguration to tell anyone about, only
// a page whose colour we could not name.

/**
 * Elements whose background is, in practice, the site's colour — its top bar
 * first, since that is where a brand is actually painted, and the document's
 * own surface last (behind the theme-color meta; see the module header).
 */
const CANDIDATES = ['header', '[role="banner"]', 'nav', '.navbar', '.site-header', '#header'];

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** The legacy serialization: `rgb(…)` / `rgba(…)`. */
function parseRgb(value: string): Rgb | null {
  const match = /^rgba?\(([^)]+)\)$/.exec(value);
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

/** sRGB gamma encoding of one linear channel, scaled to 0–255. */
function gammaEncode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded =
    clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return encoded * 255;
}

/**
 * Chrome's serialization for colours authored in oklch/oklab —
 * `oklab(L a b)` or `oklab(L a b / alpha)` — converted to sRGB with the
 * reference matrices from the CSS Color 4 spec. Computed values arrive as
 * plain numbers (L and alpha in 0–1), which is all this accepts; the exotic
 * percent forms never show up in `getComputedStyle` output.
 */
function parseOklab(value: string): Rgb | null {
  const match = /^oklab\(([^)]+)\)$/.exec(value);
  if (match === null) return null;
  const parts = (match[1] as string)
    .split(/[\s/]+/)
    .filter((part) => part !== '')
    .map(Number);
  const [L, labA, labB, alpha = 1] = parts;
  if (L === undefined || labA === undefined || labB === undefined) return null;
  if (![L, labA, labB, alpha].every((n) => Number.isFinite(n))) return null;

  const l = Math.pow(L + 0.3963377774 * labA + 0.2158037573 * labB, 3);
  const m = Math.pow(L - 0.1055613458 * labA - 0.0638541728 * labB, 3);
  const s = Math.pow(L - 0.0894841775 * labA - 1.291485548 * labB, 3);
  return {
    r: gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

/** The other modern serialization: `color(srgb r g b)` with channels in 0–1. */
function parseColorSrgb(value: string): Rgb | null {
  const match = /^color\(srgb\s+([^)]+)\)$/.exec(value);
  if (match === null) return null;
  const parts = (match[1] as string)
    .split(/[\s/]+/)
    .filter((part) => part !== '')
    .map(Number);
  const [r, g, b, a = 1] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
  return { r: r * 255, g: g * 255, b: b * 255, a };
}

/** `#rgb` / `#rrggbb` — the forms a theme-color meta is written in by hand. */
function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return null;
  const hex = match[1] as string;
  const wide = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(wide.slice(0, 2), 16),
    g: parseInt(wide.slice(2, 4), 16),
    b: parseInt(wide.slice(4, 6), 16),
    a: 1,
  };
}

/** Every colour text this module can meet, through one door. */
function parseCssColor(value: string): Rgb | null {
  const trimmed = value.trim();
  return (
    parseRgb(trimmed) ?? parseOklab(trimmed) ?? parseColorSrgb(trimmed) ?? parseHex(trimmed)
  );
}

/**
 * A colour worth borrowing: fully opaque and not near-white.
 *
 * Below fully opaque is a wash over something else, and sampling it would
 * give a colour the visitor never actually sees. Near-white (all channels
 * bright and close together — white, `#f9fafb`, `#eee`) is what an unstyled
 * page looks like, so borrowing it makes the feature indistinguishable from
 * broken; a pale but SATURATED brand (a pastel pink) keeps enough channel
 * spread to pass. Dark and grey answers pass — a `#222` top bar is a real
 * design choice, not an accident of no styling.
 */
function isUsable(color: Rgb): boolean {
  if (color.a < 1) return false;
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return !(min >= 230 && max - min <= 20);
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The colour declared by `<meta name="theme-color">`, or `null`.
 *
 * A page may carry several, split by `media` (light/dark variants); one whose
 * media query does not currently match is skipped so a dark-scheme declaration
 * is not borrowed into a light page. Content that does not parse as a hex or
 * `rgb()` colour (a named colour, a variable) is skipped rather than guessed.
 */
function themeColorMeta(): Rgb | null {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    // A media-qualified declaration only applies while its query matches;
    // where that cannot be verified (no `matchMedia` — a non-browser
    // environment) it is skipped rather than assumed, so an unqualified
    // sibling still wins.
    const media = meta.getAttribute('media');
    if (media !== null && (typeof matchMedia !== 'function' || !matchMedia(media).matches)) {
      continue;
    }
    const parsed = parseCssColor(meta.getAttribute('content') ?? '');
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * The host page's colour as a hex string, or `null` when there is none to take.
 *
 * Hex specifically, not the serialization it came from: the caller feeds this
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
    // The visibly painted top bar wins over everything — it is what the
    // visitor already sees as "the site's colour".
    for (const selector of CANDIDATES) {
      const element = document.querySelector(selector);
      if (element === null) continue;
      const parsed = parseCssColor(getComputedStyle(element).backgroundColor);
      if (parsed !== null && isUsable(parsed)) return toHex(parsed);
    }

    // Then the site's own declaration, then the ambient page surface. The
    // meta outranks the body deliberately: a body background is usually
    // near-white (filtered) or a neutral wash, while the meta is the one
    // field that exists solely to name the site's chrome colour.
    const declared = themeColorMeta();
    if (declared !== null && isUsable(declared)) return toHex(declared);

    for (const element of [document.body, document.documentElement]) {
      if (element === null) continue;
      const parsed = parseCssColor(getComputedStyle(element).backgroundColor);
      if (parsed !== null && isUsable(parsed)) return toHex(parsed);
    }
  } catch {
    // A cross-origin frame, or a document that is not there yet. Neither is
    // something the merchant can act on, so neither is reported.
  }

  return null;
}
