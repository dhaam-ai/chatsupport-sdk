// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { samplePlatformColor } from '../src/ui/platform-color.js';

// Every meta this suite plants, so cleanup never touches metas jsdom owns.
const planted: Element[] = [];

function plantMeta(content: string, media?: string): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', content);
  if (media !== undefined) meta.setAttribute('media', media);
  document.head.appendChild(meta);
  planted.push(meta);
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.backgroundColor = '';
  document.documentElement.style.backgroundColor = '';
});

afterEach(() => {
  for (const meta of planted.splice(0)) meta.remove();
});

describe('samplePlatformColor — the painted top bar', () => {
  it('returns the header element’s opaque background', () => {
    document.body.innerHTML = '<header style="background-color: rgb(20, 40, 200)"></header>';
    expect(samplePlatformColor()).toBe('#1428c8');
  });

  it('skips a translucent top bar — a wash is not the colour the visitor sees', () => {
    // The live dh-hyperlocal shape: a `bg-white/50 backdrop-blur` nav.
    document.body.innerHTML = '<nav style="background-color: rgba(255, 255, 255, 0.5)"></nav>';
    expect(samplePlatformColor()).toBeNull();
  });

  it('outranks the theme-color meta when actually painted', () => {
    plantMeta('#7c43df');
    document.body.innerHTML = '<header style="background-color: rgb(17, 17, 17)"></header>';
    expect(samplePlatformColor()).toBe('#111111');
  });
});

describe('samplePlatformColor — near-white is not a colour to borrow', () => {
  it('refuses a near-white page background instead of painting the header white', () => {
    // The exact live failure: dh-hyperlocal’s body is #f9fafb, and borrowing
    // it made the feature indistinguishable from broken.
    document.body.style.backgroundColor = 'rgb(249, 250, 251)';
    expect(samplePlatformColor()).toBeNull();
  });

  it('keeps a pale but saturated brand colour', () => {
    document.body.style.backgroundColor = 'rgb(255, 192, 203)'; // pastel pink
    expect(samplePlatformColor()).toBe('#ffc0cb');
  });

  it('keeps a dark achromatic bar — #222 is a design choice, not an accident', () => {
    document.body.innerHTML = '<nav style="background-color: rgb(34, 34, 34)"></nav>';
    expect(samplePlatformColor()).toBe('#222222');
  });
});

describe('samplePlatformColor — the theme-color meta', () => {
  it('reads the declared chrome colour when no top bar is usable', () => {
    document.body.innerHTML = '<nav style="background-color: rgba(255, 255, 255, 0.5)"></nav>';
    document.body.style.backgroundColor = 'rgb(249, 250, 251)';
    plantMeta('#7C43DF');
    expect(samplePlatformColor()).toBe('#7c43df');
  });

  it('expands three-digit hex', () => {
    plantMeta('#f0a');
    expect(samplePlatformColor()).toBe('#ff00aa');
  });

  it('skips a variant whose media query does not currently match', () => {
    plantMeta('#000000', '(prefers-color-scheme: dark)'); // jsdom never matches this
    plantMeta('#7c43df');
    expect(samplePlatformColor()).toBe('#7c43df');
  });

  it('skips content it cannot parse rather than guessing', () => {
    plantMeta('rebeccapurple');
    expect(samplePlatformColor()).toBeNull();
  });
});

describe('samplePlatformColor — modern colour serializations', () => {
  // Chrome hands back `oklab(…)`/`color(srgb …)` for backgrounds authored in
  // modern notations (Tailwind v4’s whole palette is oklch). jsdom cannot
  // reproduce that through getComputedStyle, so the conversion is exercised
  // through the meta path, which runs the same parser.
  it('converts an oklab colour to sRGB hex', () => {
    plantMeta('oklab(0.627955 0.224863 0.125846)'); // pure red’s oklab coordinates
    expect(samplePlatformColor()).toBe('#ff0000');
  });

  it('converts a color(srgb …) colour', () => {
    plantMeta('color(srgb 0.5 0.25 0.75)');
    expect(samplePlatformColor()).toBe('#8040bf');
  });

  it('treats a translucent oklab value as unusable', () => {
    plantMeta('oklab(0.999994 0.0000455678 0.0000200868 / 0.5)'); // the live nav’s computed value
    expect(samplePlatformColor()).toBeNull();
  });
});

describe('samplePlatformColor — nothing usable', () => {
  it('returns null on a page with no colour to borrow, so the accent fallback applies', () => {
    expect(samplePlatformColor()).toBeNull();
  });
});
