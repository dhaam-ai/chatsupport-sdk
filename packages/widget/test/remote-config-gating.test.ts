// @vitest-environment jsdom
//
// The end-to-end half of published config: a REAL mounted widget, a stubbed
// `/widget/config` response, and the assertion that the response actually
// changes what is on screen.
//
// remote-config.test.ts already proves the fetch and the parse in isolation,
// and product-surfaces.test.ts proves each form in isolation. Neither of those
// would catch the failure that matters most here — config parsed correctly and
// then wired to nothing — so this file exercises the seam between them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    // connect() rejects by design in this environment; a wall of expected
    // failures would hide a real one.
    onError: () => undefined,
    ...overrides,
  };
}

/** The published-config body, with only what a test cares about overridden. */
function published(data: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {},
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
      ...data,
    },
  };
}

/**
 * Serves the token mint and the config endpoint, and nothing else.
 *
 * Routed on the path rather than call order: the widget fires both during
 * mount and the order between them is not part of any contract this file
 * should be pinning.
 */
function stubFetch(configBody: unknown, { failConfig = false } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/widget/config')) {
        if (failConfig) {
          // Exactly what a blocked cross-origin read looks like from JS: a
          // bare TypeError with no detail. See WIDGET_ALLOWED_ORIGINS.
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);

/** Lets the config fetch and its promise chain land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', SilentSocket);
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('the pre-chat gate is driven by published config', () => {
  const preChatConfig = published({
    behaviour: {
      preChatEnabled: true,
      preChatFields: [
        { id: 'name', label: 'Your name', type: 'text', required: true },
        { id: 'email', label: 'Email address', type: 'email', required: true },
      ],
      greeting: 'Hi from Acme!',
    },
  });

  it('renders the merchant’s fields in front of the conversation', async () => {
    stubFetch(preChatConfig);
    mount(config());
    await settle();

    expect(find('.dh-prechat-form')).not.toBeNull();
    const labels = [...shadow().querySelectorAll('.dh-prechat-form .dh-field-label')].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['Your name', 'Email address']);
    // The form keeps its OWN heading. The console has "Greeting" and "Ask for
    // details first" as two separate controls, and this screen used to borrow
    // the first for the second — so a merchant's opening line showed up as a
    // form title and never as the message it is configured to be. The greeting
    // now has a surface of its own; see `the merchant's greeting` below.
    expect(find('.dh-prechat-form .dh-form-heading')?.textContent).toBe('Before we start');
  });

  it('stands IN PLACE OF the transcript and composer, not on top of them', async () => {
    stubFetch(preChatConfig);
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-log')?.hidden).toBe(true);
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(true);
  });

  it('does not gate when the merchant left pre-chat off', async () => {
    stubFetch(published({ behaviour: { preChatEnabled: false, preChatFields: [] } }));
    mount(config());
    await settle();

    expect(find('.dh-prechat-form')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(false);
  });

  // Enabled with an empty field list is a merchant misconfiguration, and the
  // honest reading is "nothing to ask" rather than an empty form with a button.
  it('does not gate on an empty field list even when enabled', async () => {
    stubFetch(published({ behaviour: { preChatEnabled: true, preChatFields: [] } }));
    mount(config());
    await settle();

    expect(find('.dh-prechat-form')).toBeNull();
  });

  // The gate lifts through `preChatAnswered`, and Skip is the path that
  // reaches it without a working socket — this environment has none, so a
  // submit genuinely cannot land here. The submit path's own success case is
  // covered in product-surfaces.test.ts against a resolving callback.
  it('hands the conversation back when the customer skips', async () => {
    stubFetch(
      published({
        behaviour: {
          preChatEnabled: true,
          // All-optional, which is what makes Skip available at all.
          preChatFields: [{ id: 'order', label: 'Order number', type: 'text', required: false }],
        },
      }),
    );
    mount(config());
    await settle();

    expect(find('.dh-prechat-form')).not.toBeNull();
    find<HTMLButtonElement>('.dh-form-skip')!.click();
    await settle();

    expect(find('.dh-prechat-form')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(false);
  });

  // The inherited React defect, proved against the real widget: a send that
  // cannot land must leave the form usable rather than stuck on "Starting…"
  // with the customer's answers trapped behind a dead button.
  it('keeps the gate up and the button alive when the send cannot land', async () => {
    stubFetch(preChatConfig);
    mount(config());
    await settle();

    const inputs = [...shadow().querySelectorAll<HTMLInputElement>('.dh-prechat-form .dh-field-input')];
    inputs[0]!.value = 'Ada';
    inputs[1]!.value = 'ada@example.com';
    find<HTMLFormElement>('.dh-prechat-form')!.requestSubmit();
    await settle();

    expect(find('.dh-prechat-form')).not.toBeNull();
    const submit = find<HTMLButtonElement>('.dh-form-submit')!;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Start chat');
    // The customer's typing survives, so they can retry without re-entering it.
    expect(inputs[0]!.value).toBe('Ada');
  });
});

describe('the out-of-hours form is driven by isOpenNow + offlineMode', () => {
  it('replaces the composer under COLLECT_MESSAGE while closed', async () => {
    stubFetch(
      published({
        offlineMode: OFFLINE_MODE.COLLECT_MESSAGE,
        isOpenNow: false,
        behaviour: { offlineMessage: 'Back at 9am.' },
      }),
    );
    mount(config());
    await settle();

    expect(find('.dh-offline-form')).not.toBeNull();
    expect(find('.dh-offline-form .dh-form-subtitle')?.textContent).toBe('Back at 9am.');
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(true);
  });

  it('leaves the composer alone under SHOW_MESSAGE', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.SHOW_MESSAGE, isOpenNow: false }));
    mount(config());
    await settle();

    expect(find('.dh-offline-form')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(false);
  });

  it('hides the launcher entirely under HIDE_WIDGET while closed', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.HIDE_WIDGET, isOpenNow: false }));
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-launcher')?.hidden).toBe(true);
  });

  it('does not collect while the team is open', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: true }));
    mount(config());
    await settle();

    expect(find('.dh-offline-form')).toBeNull();
  });

  // The three-valued field, end to end. `null` means the tenant does not
  // follow business hours — not that they are shut.
  it('treats isOpenNow: null as always open', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: null }));
    mount(config());
    await settle();

    expect(find('.dh-offline-form')).toBeNull();
    expect(find<HTMLElement>('.dh-launcher')?.hidden).toBe(false);
  });
});

describe('enabled: false is an off switch', () => {
  it('hides the launcher', async () => {
    stubFetch(published({ enabled: false }));
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-launcher')?.hidden).toBe(true);
  });
});

describe('appearance, and the host’s right to overrule it', () => {
  it('adopts the published accent and title when the host said nothing', async () => {
    stubFetch(published({ appearance: { accent: '#7C3AED', title: 'Acme Support' } }));
    mount(config());
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.style.getPropertyValue('--dh-accent')).toBe('#7C3AED');
    expect(find('.dh-launcher-label')?.textContent).toBe('Acme Support');
    expect(find('#dh-title')?.textContent).toBe('Acme Support');
  });

  // The precedence rule. A host that hardcoded a colour to match its checkout
  // page must not have it yanked by a console save it cannot see.
  it('never overrules a value the host stated explicitly', async () => {
    stubFetch(published({ appearance: { accent: '#7C3AED', title: 'Acme Support' } }));
    mount(config({ accent: '#0f172a', title: 'Host title' }));
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.style.getPropertyValue('--dh-accent')).toBe('');
    expect(find('.dh-launcher-label')?.textContent).toBe('Host title');
  });

  it('pins the published colour scheme onto the host element', async () => {
    stubFetch(published({ appearance: { theme: 'dark' } }));
    mount(config());
    await settle();

    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-theme')).toBe('dark');
  });

  // `auto` is not the absence of a choice — it is the widget's own default and
  // what every host relied on before appearance parsing existed. The media
  // query, not an attribute, is what governs it (ui/styles.ts).
  it('leaves the scheme on auto when the publish names none', async () => {
    stubFetch(published({ appearance: {} }));
    mount(config());
    await settle();

    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-theme')).toBe('auto');
  });

  it('keeps a host-pinned scheme against a published one', async () => {
    stubFetch(published({ appearance: { theme: 'dark' } }));
    mount(config({ theme: 'light' }));
    await settle();

    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-theme')).toBe('light');
  });

  // Applied as an inline custom property on the host, exactly like the accent:
  // an inline declaration outranks the `:host` rule themeCss wrote, so the
  // upgrade needs no sheet reparse and races nothing already using the old one.
  it('adopts the published corner radius and font', async () => {
    stubFetch(published({ appearance: { cornerRadius: 24, fontFamily: 'Georgia' } }));
    mount(config());
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.style.getPropertyValue('--dh-radius')).toBe('24px');
    expect(host?.style.getPropertyValue('--dh-font')).toContain('Georgia');
  });

  it('leaves a host-stated radius and font alone', async () => {
    stubFetch(published({ appearance: { cornerRadius: 24, fontFamily: 'Georgia' } }));
    mount(config({ cornerRadius: 4, fontFamily: 'Roboto' }));
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.style.getPropertyValue('--dh-radius')).toBe('');
    expect(host?.style.getPropertyValue('--dh-font')).toBe('');
  });

  it('adopts the published launcher shape and label', async () => {
    stubFetch(published({ appearance: { launcher: 'tab', launcherLabel: 'Need help?' } }));
    mount(config());
    await settle();

    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-launcher')).toBe('tab');
    expect(find('.dh-launcher-label')?.textContent).toBe('Need help?');
    // The name follows the words, WCAG 2.5.3 — including on the async path.
    expect(find('.dh-launcher')?.getAttribute('aria-label')).toBe('Need help?');
  });

  // The launcher label falls back to the title, so renaming the widget renames
  // the tab with it.
  it('labels the launcher from a published title when no label was published', async () => {
    stubFetch(published({ appearance: { launcher: 'bubble-label', title: 'Acme Support' } }));
    mount(config());
    await settle();

    expect(find('.dh-launcher-label')?.textContent).toBe('Acme Support');
  });

  // …but not through the back door: a host that stated the title has stated
  // what the launcher says too, because that is where the fallback comes from.
  it('does not let a published title relabel a launcher whose title the host set', async () => {
    stubFetch(published({ appearance: { launcher: 'bubble-label', title: 'Acme Support' } }));
    mount(config({ title: 'Host title' }));
    await settle();

    expect(find('.dh-launcher-label')?.textContent).toBe('Host title');
  });

  // The load-bearing default. `hero` paints the header in the brand colour,
  // and that must reach only merchants who asked for it in the console —
  // never a host who embedded a script tag and never opened one.
  it('stays on the classic header until a publish says hero', async () => {
    stubFetch(published({ appearance: {} }));
    mount(config());
    await settle();

    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-design')).toBe('classic');
  });

  it('paints the header once the merchant publishes the hero design', async () => {
    stubFetch(
      published({
        appearance: {
          design: 'hero',
          accent: '#0f172a',
          header: { background: 'gradient', gradientStrength: 100 },
        },
      }),
    );
    mount(config());
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.getAttribute('data-design')).toBe('hero');
    // The variable, so a later accent change repaints the header with it.
    expect(host?.style.getPropertyValue('--dh-header-bg')).toBe('var(--dh-accent)');
    expect(host?.style.getPropertyValue('--dh-header-layers')).toContain('linear-gradient');
  });

  // The header's text is painted straight onto the brand colour, so a publish
  // that moves the accent has to be able to flip it from white to near-black.
  it('recomputes the header foreground against a published accent', async () => {
    stubFetch(published({ appearance: { design: 'hero', accent: '#fde68a' } }));
    mount(config());
    await settle();

    expect(
      document.querySelector<HTMLElement>('dh-chat-widget')?.style.getPropertyValue('--dh-header-fg'),
    ).toBe('#1a1a1a');
  });

  describe('the hero header’s content', () => {
    const hero = published({
      appearance: {
        design: 'hero',
        header: {
          greeting: 'Hello there 👋',
          subGreeting: 'Ask us anything.',
          showAvatars: true,
          showPresence: true,
          avatars: ['https://cdn.acme.test/a.png', 'https://cdn.acme.test/b.png'],
          ctaEnabled: true,
          ctaTitle: 'Send us a message',
          ctaSubtitle: 'We usually reply instantly',
        },
      },
    });

    it('renders the merchant’s greeting, faces and call to action', async () => {
      stubFetch(hero);
      mount(config());
      await settle();

      expect(find('.dh-hero-greeting')?.textContent).toBe('Hello there 👋');
      expect(find('.dh-hero-sub')?.textContent).toBe('Ask us anything.');
      expect(shadow().querySelectorAll('.dh-hero-avatar')).toHaveLength(2);
      // The dot rides the LAST face only — it says "someone is here", not
      // "this particular person is".
      expect(shadow().querySelectorAll('.dh-hero-presence')).toHaveLength(1);
      expect(find('.dh-hero-cta-title')?.textContent).toBe('Send us a message');
    });

    // The whole block is decoration the panel already conveys, and announcing
    // four lines of marketing before the conversation is hostile.
    it('is hidden from the a11y tree, with nothing focusable left inside it', async () => {
      stubFetch(hero);
      mount(config());
      await settle();

      expect(find('.dh-hero')?.getAttribute('aria-hidden')).toBe('true');
      // A focusable control inside an aria-hidden subtree is the one
      // combination that genuinely breaks assistive tech.
      expect(find('.dh-hero-cta')?.getAttribute('tabindex')).toBe('-1');
    });

    it('shows while the transcript is empty and never on the classic design', async () => {
      stubFetch(hero);
      mount(config());
      await settle();
      expect(find<HTMLElement>('.dh-hero')?.hidden).toBe(false);

      unmount();
      stubFetch(published({ appearance: { header: { greeting: 'Hi' } } }));
      mount(config());
      await settle();
      expect(find<HTMLElement>('.dh-hero')?.hidden).toBe(true);
    });

    // The hero and the Common Questions chips are shown by ONE function
    // against ONE condition (`syncPreConversationPanes`), so a surface that
    // stands in for the conversation has to retire both. Proved through the
    // pre-chat gate because it is the surface reachable without a socket.
    it('stands down while a surface is standing in for the conversation', async () => {
      stubFetch(
        published({
          appearance: { design: 'hero', header: { greeting: 'Hello there 👋' } },
          behaviour: {
            preChatEnabled: true,
            preChatFields: [{ id: 'name', label: 'Your name', type: 'text', required: true }],
            commonQuestions: [{ id: 'q', label: 'Track my order', prompt: 'Where is my order?' }],
          },
        }),
      );
      mount(config());
      await settle();

      expect(find('.dh-prechat-form')).not.toBeNull();
      expect(find<HTMLElement>('.dh-hero')?.hidden).toBe(true);
      expect(find<HTMLElement>('.dh-common-questions-host')?.hidden).toBe(true);
    });

    // A merchant who turned every piece of it off has turned the block off; a
    // bare coloured slab above the transcript reads as a rendering failure.
    it('collapses to nothing when the merchant left every piece of it empty', async () => {
      stubFetch(published({ appearance: { design: 'hero', header: { background: 'solid' } } }));
      mount(config());
      await settle();

      expect(find<HTMLElement>('.dh-hero')?.dataset['empty']).toBe('true');
    });

    it('drops avatars past the third and any the allowlist refuses', async () => {
      stubFetch(
        published({
          appearance: {
            design: 'hero',
            header: {
              showAvatars: true,
              avatars: [
                'https://cdn.acme.test/1.png',
                'javascript:alert(1)',
                'https://cdn.acme.test/2.png',
                'https://cdn.acme.test/3.png',
                'https://cdn.acme.test/4.png',
              ],
            },
          },
        }),
      );
      mount(config());
      await settle();

      expect(shadow().querySelectorAll('.dh-hero-avatar')).toHaveLength(3);
    });

    // `header.logoUrl` is the hero's own; `appearance.logoUrl` is the brand
    // mark. A merchant who uploaded one and not the other means the same thing.
    it('falls back to the top-level logo when the header names none', async () => {
      stubFetch(
        published({
          appearance: {
            design: 'hero',
            logoUrl: 'https://cdn.acme.test/logo.svg',
            header: { showLogo: true },
          },
        }),
      );
      mount(config());
      await settle();

      expect(find('.dh-hero-logo')?.getAttribute('src')).toBe('https://cdn.acme.test/logo.svg');
    });
  });

  it('swaps in the published launcher glyph and shadow after mount', async () => {
    stubFetch(
      published({
        appearance: {
          launcherIcon: { source: 'emoji', emoji: '👋' },
          launcherShadow: { enabled: false },
        },
      }),
    );
    mount(config());
    await settle();

    // Swapped in place: the button itself is never rebuilt, so its click
    // listener survives a publish landing mid-press.
    expect(find('.dh-launcher-glyph')?.firstElementChild?.textContent).toBe('👋');
    expect(
      document.querySelector<HTMLElement>('dh-chat-widget')?.style.getPropertyValue(
        '--dh-launcher-shadow',
      ),
    ).toBe('none');
  });

  it('adopts the published corner and offsets', async () => {
    stubFetch(published({ appearance: { position: 'bottom-left', offsetX: 8, offsetY: 96 } }));
    mount(config());
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.getAttribute('data-position')).toBe('bottom-left');
    expect(host?.style.getPropertyValue('--dh-offset-x')).toBe('8px');
    expect(host?.style.getPropertyValue('--dh-offset-y')).toBe('96px');
  });

  it('leaves a host-stated corner and offsets alone', async () => {
    stubFetch(published({ appearance: { position: 'bottom-left', offsetX: 8, offsetY: 96 } }));
    mount(config({ position: 'bottom-right', offsetX: 40, offsetY: 40 }));
    await settle();

    const host = document.querySelector<HTMLElement>('dh-chat-widget');
    expect(host?.getAttribute('data-position')).toBe('bottom-right');
    expect(host?.style.getPropertyValue('--dh-offset-x')).toBe('');
  });

  // `font: 'inherit'` is a statement about the HOST page's typography. A face
  // published later must not quietly cancel it.
  it('does not let a published font override font: inherit', async () => {
    stubFetch(published({ appearance: { fontFamily: 'Georgia' } }));
    mount(config({ font: 'inherit' }));
    await settle();

    expect(
      document.querySelector<HTMLElement>('dh-chat-widget')?.style.getPropertyValue('--dh-font'),
    ).toBe('');
  });
});

describe('degrading when the config cannot be read', () => {
  // The WIDGET_ALLOWED_ORIGINS trap: fleet-wide, not per-tenant, so an
  // unlisted storefront gets a response the browser refuses to hand us.
  it('still mounts a working widget', async () => {
    stubFetch(null, { failConfig: true });
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-launcher')?.hidden).toBe(false);
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(false);
    expect(find('.dh-prechat-form')).toBeNull();
    expect(find('.dh-offline-form')).toBeNull();
  });

  it('says so through onError rather than failing silently', async () => {
    stubFetch(null, { failConfig: true });
    const onError = vi.fn();
    mount(config({ onError }));
    await settle();

    const messages = onError.mock.calls.map(([error]) => String((error as Error).message));
    const configError = messages.find((m) => m.includes('widget config could not be read'));
    expect(configError).toBeDefined();
    // Names the likeliest cause, because the browser refuses to say why a
    // cross-origin read failed.
    expect(configError).toContain('WIDGET_ALLOWED_ORIGINS');
  });

  it('never puts the publishable key in the config URL', async () => {
    stubFetch(published());
    mount(config());
    await settle();

    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls;
    const configCall = calls.find(([url]) => String(url).includes('/widget/config'));
    expect(configCall).toBeDefined();
    expect(String(configCall?.[0])).not.toContain(PUBLISHABLE);
  });
});

describe('the merchant’s greeting', () => {
  // It is "The first message" in the console, so it has to read as something
  // said TO the customer — not as the heading of a form, which is where it
  // used to end up.
  it('appears as its own line, not as the pre-chat form’s heading', async () => {
    stubFetch(published({ behaviour: { greeting: 'Hi from Acme!' } }));
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-greeting')?.hidden).toBe(false);
    expect(find('.dh-greeting')?.textContent).toBe('Hi from Acme!');
  });

  it('stays hidden when the merchant wrote none', async () => {
    stubFetch(published());
    mount(config());
    await settle();
    expect(find<HTMLElement>('.dh-greeting')?.hidden).toBe(true);
  });

  it('waits out the configured delay before showing', async () => {
    stubFetch(published({ behaviour: { greeting: 'Hi!', greetingDelaySec: 0.08 } }));
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-greeting')?.hidden).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(find<HTMLElement>('.dh-greeting')?.hidden).toBe(false);
  });
});

describe('the consent gate', () => {
  const consentConfig = published({
    behaviour: { consentRequired: true, consentText: 'You agree to our privacy policy.' },
  });

  it('holds the composer shut until the visitor agrees', async () => {
    stubFetch(consentConfig);
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-consent')?.hidden).toBe(false);
    expect(find<HTMLTextAreaElement>('.dh-input')?.disabled).toBe(true);

    find<HTMLButtonElement>('.dh-consent-agree')?.click();
    expect(find<HTMLElement>('.dh-consent')?.hidden).toBe(true);
    expect(find<HTMLTextAreaElement>('.dh-input')?.disabled).toBe(false);
  });

  it('leaves the composer alone when no consent is required', async () => {
    stubFetch(published());
    mount(config());
    await settle();

    expect(find<HTMLElement>('.dh-consent')?.hidden).toBe(true);
    expect(find<HTMLTextAreaElement>('.dh-input')?.disabled).toBe(false);
  });

  // Consent fatigue is itself a reason people stop reading notices, so the
  // answer is remembered — and remembered per publishable key, so two tenants
  // sharing a browser cannot answer for one another.
  it('does not ask a second time in the same browser', async () => {
    stubFetch(consentConfig);
    mount(config());
    await settle();
    find<HTMLButtonElement>('.dh-consent-agree')?.click();
    // Let the storage write land before the remount reads it back.
    await settle();
    unmount();

    stubFetch(consentConfig);
    mount(config());
    await settle();
    expect(find<HTMLElement>('.dh-consent')?.hidden).toBe(true);
    expect(find<HTMLTextAreaElement>('.dh-input')?.disabled).toBe(false);
  });

  // A notice switched on with nothing written in it has nothing to agree to,
  // and must not strand the visitor with a composer they cannot use.
  it('does not gate on an empty notice', async () => {
    stubFetch(published({ behaviour: { consentRequired: true, consentText: '  ' } }));
    mount(config());
    await settle();
    expect(find<HTMLElement>('.dh-consent')?.hidden).toBe(true);
    expect(find<HTMLTextAreaElement>('.dh-input')?.disabled).toBe(false);
  });
});

describe('report an issue', () => {
  const openButton = () => find<HTMLButtonElement>('.dh-report-open');

  // Off unless the merchant turned it on — the rule every surface this pass
  // added follows, so a widget whose config never landed is unchanged.
  it('offers nothing until the merchant turns it on', async () => {
    stubFetch(published());
    mount(config());
    await settle();
    expect(openButton()?.hidden).toBe(true);
  });

  it('offers the form when the merchant turned it on', async () => {
    stubFetch(published({ behaviour: { reportIssue: true } }));
    mount(config());
    await settle();
    expect(openButton()?.hidden).toBe(false);
  });

  it('stands in place of the conversation rather than over it', async () => {
    stubFetch(published({ behaviour: { reportIssue: true } }));
    mount(config());
    await settle();

    openButton()!.click();
    expect(find('.dh-report-form')).not.toBeNull();
    // The same slot the pre-chat and out-of-hours forms use.
    expect(find<HTMLElement>('.dh-log')?.hidden).toBe(true);
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(true);
  });

  it('gives the conversation back on cancel', async () => {
    stubFetch(published({ behaviour: { reportIssue: true } }));
    mount(config());
    await settle();

    openButton()!.click();
    find<HTMLButtonElement>('.dh-report-form .dh-form-skip')!.click();
    expect(find('.dh-report-form')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).toBe(false);
  });

  it('refuses to submit without the two required fields, and says which', async () => {
    stubFetch(published({ behaviour: { reportIssue: true } }));
    mount(config());
    await settle();
    openButton()!.click();

    find<HTMLButtonElement>('.dh-report-form .dh-form-submit')!.click();
    expect(find('.dh-report-form .dh-form-error')?.textContent).toContain('required');
    // Still on the form, with nothing filed.
    expect(find('.dh-report-form')).not.toBeNull();
  });
});
