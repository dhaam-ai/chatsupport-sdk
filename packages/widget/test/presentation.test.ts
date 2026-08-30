// @vitest-environment node
//
// The pure functions behind what the widget LOOKS like — no DOM needed to
// prove any of them. `themeCss` lives here rather than in a file of its own
// for the same reason `resolvePresentation` does: it is the other half of the
// same decision (which presentation, and which tokens it renders with), and
// both are total functions of the resolved config.

import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../src/config.js';
import type { WidgetConfig } from '../src/config.js';
import { resolvePresentation } from '../src/ui/presentation.js';
import {
  cssPx,
  cssUrl,
  fontStackFor,
  headerBaseColor,
  headerForeground,
  headerLayers,
  launcherShadowCss,
  readableOn,
  themeCss,
} from '../src/ui/styles.js';
import type { HeaderAppearance } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

function tokens(overrides: Partial<WidgetConfig> = {}): string {
  return themeCss(
    resolveConfig({
      auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
      identity: { userId: 'cus_1' },
      apiUrl: 'https://chat.example.com',
      wsUrl: 'wss://chat.example.com',
      ...overrides,
    }),
  );
}

describe('resolvePresentation', () => {
  it('resolves auto to a sheet at or below the breakpoint, and a bubble above it', () => {
    expect(resolvePresentation('auto', { width: 360 }, 640)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 640 }, 640)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 641 }, 640)).toBe('bubble');
    expect(resolvePresentation('auto', { width: 1440 }, 640)).toBe('bubble');
  });

  it('honours an explicitly named mode at EVERY width', () => {
    // The load-bearing case. A host that asked for a sidebar on a 320px phone
    // has a layout reason we cannot see — a tablet kiosk, a fixed-width
    // embedded frame. Silently overriding them is the bug, not the feature.
    for (const width of [320, 375, 640, 641, 1024, 1920]) {
      expect(resolvePresentation('sidebar', { width }, 640)).toBe('sidebar');
      expect(resolvePresentation('bubble', { width }, 640)).toBe('bubble');
      expect(resolvePresentation('sheet', { width }, 640)).toBe('sheet');
    }
  });

  it('moves the boundary with the configured breakpoint', () => {
    expect(resolvePresentation('auto', { width: 800 }, 900)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 800 }, 700)).toBe('bubble');
  });
});

describe('themeCss — config becomes custom properties, and only custom properties', () => {
  it('emits the built-in tokens for a config that states nothing', () => {
    const css = tokens();
    expect(css).toContain('--dh-accent: #1f2937;');
    expect(css).toContain('--dh-radius: 12px;');
    expect(css).toContain('--dh-font: system-ui');
    // 20px is exactly `calc(var(--dh-space) * 5)`, where the launcher has
    // always sat — the tokens must not move an existing host's widget.
    expect(css).toContain('--dh-offset-x: 20px;');
    expect(css).toContain('--dh-offset-y: 20px;');
  });

  it('emits the host’s offsets as tokens', () => {
    const css = tokens({ offsetX: 8, offsetY: 96 });
    expect(css).toContain('--dh-offset-x: 8px;');
    expect(css).toContain('--dh-offset-y: 96px;');
  });

  it('emits the host’s corner radius and font as tokens', () => {
    const css = tokens({ cornerRadius: 20, fontFamily: 'Georgia' });
    expect(css).toContain('--dh-radius: 20px;');
    expect(css).toContain('--dh-font: Georgia');
  });

  // The two settings answer different questions, and this is the ordering
  // between them: `font: 'inherit'` is a statement about the HOST's page, and
  // a merchant picking a face in a console tab cannot see it to overrule it.
  it('lets font: inherit outrank a named fontFamily', () => {
    expect(tokens({ font: 'inherit', fontFamily: 'Georgia' })).toContain('--dh-font: inherit;');
  });

  it('falls back to the system stack for a face this bundle has never heard of', () => {
    expect(tokens({ fontFamily: 'Comic Papyrus' })).toContain('--dh-font: system-ui');
    expect(fontStackFor('Comic Papyrus')).toBe(fontStackFor('System default'));
  });

  // The containment rule. Nothing config-supplied may end a declaration or a
  // rule block, or the rest of the sheet becomes garbage.
  it('refuses a colour that could break out of its declaration', () => {
    expect(tokens({ accent: 'red; --dh-surface: black' })).toContain('--dh-accent: #1f2937;');
    expect(tokens({ accent: 'url(evil)' })).toContain('--dh-accent: #1f2937;');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative length', -8],
  ])('refuses %s as a length rather than emitting a declaration the engine drops', (_l, value) => {
    expect(cssPx(value, 12)).toBe('12px');
  });

  it('keeps a zero length, which renders as square corners rather than as unset', () => {
    expect(cssPx(0, 12)).toBe('0px');
  });
});

describe('launcherShadowCss — one intensity drives the whole shadow', () => {
  it('is nothing at all when the merchant turned it off', () => {
    expect(launcherShadowCss({ enabled: false, intensity: 90 }, 'resting')).toBe('none');
    expect(launcherShadowCss({ enabled: false, intensity: 90 }, 'lifted')).toBe('none');
  });

  it('grows with intensity in every dimension at once', () => {
    const soft = launcherShadowCss({ enabled: true, intensity: 0 }, 'resting');
    const hard = launcherShadowCss({ enabled: true, intensity: 100 }, 'resting');
    expect(soft).toBe('0 6px 14px -6px rgba(0,0,0,0.12)');
    expect(hard).toBe('0 20px 44px -12px rgba(0,0,0,0.45)');
  });

  // The launcher lifts on hover, and a shadow that does not grow with it reads
  // as the button sliding out from under its own shadow.
  it('casts further in the lifted state than at rest', () => {
    const shadow = { enabled: true, intensity: 45 };
    expect(launcherShadowCss(shadow, 'lifted')).not.toBe(launcherShadowCss(shadow, 'resting'));
  });

  // The slider is 0–100 in the console, but this value crosses a public
  // endpoint and a host-supplied object to get here.
  it.each([
    ['above the range', 400],
    ['below it', -50],
    ['NaN', Number.NaN],
  ])('clamps an intensity %s rather than emitting a broken declaration', (_label, intensity) => {
    const css = launcherShadowCss({ enabled: true, intensity }, 'resting');
    expect(css).toMatch(/^0 \d+px \d+px -\d+px rgba\(0,0,0,0\.\d+\)$/);
  });
});

describe('the hero header’s paint', () => {
  // Built through `resolveConfig` rather than by hand, so a field added to
  // `HeaderAppearance` cannot leave this fixture silently stale.
  const header = (overrides: Partial<HeaderAppearance> = {}): HeaderAppearance =>
    resolveConfig({
      auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
      identity: { userId: 'cus_1' },
      apiUrl: 'https://chat.example.com',
      wsUrl: 'wss://chat.example.com',
      header: overrides,
    }).header;

  // The variable, not the accent's literal value: a published accent landing
  // after mount has to repaint the header along with everything else.
  it('follows the accent variable when no explicit colour is set', () => {
    expect(headerBaseColor(header())).toBe('var(--dh-accent)');
    expect(headerBaseColor(header({ backgroundColor: '#0f172a' }))).toBe('#0f172a');
  });

  it('refuses a colour that could break out of its declaration', () => {
    expect(headerBaseColor(header({ backgroundColor: '#fff; display: none' }))).toBe('#1f2937');
  });

  // A pastel brand with hardcoded white text is a header nobody can read, and
  // nothing in the console warns the merchant about it.
  it('picks a foreground the text survives on', () => {
    expect(headerForeground(header(), '#0f172a')).toBe('#ffffff');
    expect(headerForeground(header(), '#fde68a')).toBe('#1a1a1a');
    expect(headerForeground(header({ backgroundColor: '#ffffff' }), '#0f172a')).toBe('#1a1a1a');
  });

  // `accent` is any CSS colour, and resolving `rebeccapurple` or a
  // `color-mix()` needs the engine rather than arithmetic. White is what this
  // widget has always used and is right for the dark accents that dominate.
  it.each(['rebeccapurple', 'rgb(12 12 12)', 'color-mix(in srgb, red, blue)'])(
    'assumes white on %s, which it cannot measure',
    (accent) => {
      expect(readableOn(accent)).toBe('#ffffff');
    },
  );

  it('paints nothing over a solid header', () => {
    expect(headerLayers(header({ background: 'solid' }))).toBe('none');
  });

  it('washes a gradient down from the top edge, scaled by its strength', () => {
    expect(headerLayers(header({ background: 'gradient', gradientStrength: 100 }))).toBe(
      'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.300) 50%, rgba(0,0,0,0) 100%)',
    );
    expect(headerLayers(header({ background: 'gradient', gradientStrength: 0 }))).toContain(
      'rgba(0,0,0,0) 0%',
    );
  });

  it('scrims an image so the greeting stays readable over it', () => {
    const layers = headerLayers(
      header({ background: 'image', backgroundImageUrl: 'https://cdn.acme.test/h.jpg', imageOverlay: 50 }),
    );
    expect(layers).toBe(
      'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.5) 100%), url("https://cdn.acme.test/h.jpg")',
    );
  });

  // A `url()` that 404s flashes the browser's broken-image behaviour on
  // someone else's page; an unpainted header over the base colour does not.
  it.each([
    ['a refused scheme', 'javascript:alert(1)'],
    ['a relative path', '/assets/hero.png'],
    ['nothing at all', ''],
  ])('paints no image layer for %s', (_label, backgroundImageUrl) => {
    expect(headerLayers(header({ background: 'image', backgroundImageUrl }))).toBe('none');
  });

  // safeImageUrl answers "will we load this"; cssUrl answers "can it be
  // written into a stylesheet", and the second question has its own answer.
  it('refuses a URL that would break out of the url() it is written into', () => {
    expect(cssUrl('https://cdn.acme.test/a");background:red;--x:("')).toBeNull();
    expect(cssUrl("https://cdn.acme.test/a'")).toBeNull();
    expect(cssUrl('https://cdn.acme.test/ok.png')).toBe('url("https://cdn.acme.test/ok.png")');
  });
});
