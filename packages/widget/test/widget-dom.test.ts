// @vitest-environment jsdom
//
// Mounts the real widget — real core client, real store, real DOM — against a
// stubbed socket and token endpoint. What is being proved here is not that
// messages flow (core's own suite owns that) but the four promises the brief
// makes about living on someone else's page: it isolates, it is reachable by
// keyboard and screen reader, it survives being loaded twice, and it leaves
// nothing behind.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWidget, mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

// Assembled at runtime, never a contiguous literal — a literal here blocks the
// push on secret scanning and trips a customer's scanner if they copy a test.
const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';


const PUBLISHABLE = PK_TEST;

/** Opens nothing and reports nothing. The widget must mount regardless. */
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
    // Swallowed rather than printed: connect() rejects in this environment by
    // design, and a red wall of expected failures hides a real one.
    onError: () => undefined,
    ...overrides,
  };
}

function host(): HTMLElement {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null) throw new Error('widget host not found');
  return element;
}

function shadow(): ShadowRoot {
  const root = host().shadowRoot;
  if (root === null) throw new Error('shadow root not found');
  return root;
}

const query = <T extends Element>(selector: string): T => {
  const found = shadow().querySelector<T>(selector);
  if (found === null) throw new Error(`not found: ${selector}`);
  return found;
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('isolation from the host page', () => {
  it('adds exactly one element to the host document and keeps the rest in a shadow root', () => {
    document.body.innerHTML = '<main id="host-content">checkout</main>';
    mount(config());

    // One node, and it is not a div that could collide with the host's CSS.
    expect(document.querySelectorAll('dh-chat-widget')).toHaveLength(1);
    expect(host().shadowRoot).not.toBeNull();
    // Nothing of ours is reachable by the host's own selectors.
    expect(document.querySelector('.dh-launcher')).toBeNull();
    expect(document.querySelector('.dh-panel')).toBeNull();
    expect(document.getElementById('host-content')?.textContent).toBe('checkout');
  });

  it('mutates no host-page style, on body or documentElement', () => {
    const bodyStyle = document.body.getAttribute('style');
    const htmlStyle = document.documentElement.getAttribute('style');

    const widget = mount(config());
    widget.open();

    // v1 set `body { overflow: hidden }` while open, which on a scrolling
    // checkout page silently strands the user. The panel uses
    // `overscroll-behavior: contain` instead, which needs no host mutation.
    expect(document.body.getAttribute('style')).toBe(bodyStyle);
    expect(document.documentElement.getAttribute('style')).toBe(htmlStyle);
  });

  it('injects no stylesheet into the host document', () => {
    mount(config());

    expect(document.head.querySelector('style')).toBeNull();
    expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
    // Ours lives inside the shadow root, where the host's cascade cannot see it.
    expect(shadow().querySelector('style')).not.toBeNull();
  });

  it('falls back to a real maximum z-index where the top layer is unavailable', () => {
    // jsdom has no popover API, which is exactly the pre-Safari-17 path.
    mount(config());
    expect(host().style.zIndex).toBe('2147483647');
  });
});

describe('the launcher', () => {
  it('carries an accessible name and a disclosure state', () => {
    mount(config());
    const launcher = query<HTMLButtonElement>('.dh-launcher');

    expect(launcher.getAttribute('aria-label')).toBe('Open chat');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.getAttribute('aria-controls')).toBe('dh-panel');
  });

  it('reports its expanded state when the panel opens', () => {
    const widget = mount(config());
    widget.open();

    const launcher = query<HTMLButtonElement>('.dh-launcher');
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    expect(launcher.getAttribute('aria-label')).toBe('Close chat');
  });

  it('toggles on click', () => {
    const widget = mount(config());
    query<HTMLButtonElement>('.dh-launcher').click();
    expect(widget.isOpen()).toBe(true);

    query<HTMLButtonElement>('.dh-launcher').click();
    expect(widget.isOpen()).toBe(false);
  });
});

describe('the launcher’s shape', () => {
  it('is a bare bubble unless something says otherwise', () => {
    mount(config());
    expect(host().getAttribute('data-launcher')).toBe('bubble');
  });

  it.each(['bubble-label', 'tab'] as const)('carries the %s shape as an attribute', (launcher) => {
    mount(config({ launcher }));
    expect(host().getAttribute('data-launcher')).toBe(launcher);
  });

  // The label element has always existed — the sidebar tab uses it — so what
  // changes per shape is only whether CSS reveals it. Its TEXT is asserted
  // here because that is what the accessible name has to match.
  it('labels itself with the title when the host names no separate label', () => {
    mount(config({ launcher: 'bubble-label', title: 'Acme Support' }));
    expect(query('.dh-launcher-label').textContent).toBe('Acme Support');
  });

  it('prefers an explicit launcherLabel over the title', () => {
    mount(config({ launcher: 'tab', title: 'Acme Customer Support', launcherLabel: 'Help' }));
    expect(query('.dh-launcher-label').textContent).toBe('Help');
  });

  // WCAG 2.5.3: voice control addresses a button by the words on it, so
  // "click Help" has to find the control that says Help.
  it('puts the visible label in the accessible name of a shape that shows one', () => {
    mount(config({ launcher: 'tab', launcherLabel: 'Help' }));
    expect(query('.dh-launcher').getAttribute('aria-label')).toBe('Help');
  });

  // …and the name then stops swapping Open/Close, which is the APG disclosure
  // pattern: `aria-expanded` carries the state instead.
  it('keeps that name stable across open and close', () => {
    const widget = mount(config({ launcher: 'tab', launcherLabel: 'Help' }));
    widget.open();

    const launcher = query('.dh-launcher');
    expect(launcher.getAttribute('aria-label')).toBe('Help');
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the bare bubble’s Open/Close name alone — it shows no words to match', () => {
    const widget = mount(config({ launcher: 'bubble', launcherLabel: 'Help' }));
    expect(query('.dh-launcher').getAttribute('aria-label')).toBe('Open chat');
    widget.open();
    expect(query('.dh-launcher').getAttribute('aria-label')).toBe('Close chat');
  });

  // The sidebar's edge tab shows its label for a structural reason of its own,
  // independent of the launcher STYLE — so it earns the same naming rule.
  it('names the sidebar’s edge tab by its visible label', () => {
    vi.stubGlobal('innerWidth', 1280);
    mount(config({ mode: 'sidebar', title: 'Acme Support' }));
    expect(query('.dh-launcher').getAttribute('aria-label')).toBe('Acme Support');
  });
});

describe('the launcher’s glyph', () => {
  const glyph = (): Element => {
    const child = query('.dh-launcher-glyph').firstElementChild;
    if (child === null) throw new Error('launcher glyph is empty');
    return child;
  };

  it('draws the built-in chat bubble by default', () => {
    mount(config());
    expect(glyph().tagName.toLowerCase()).toBe('svg');
    // Hidden from the a11y tree — the button already carries its own name.
    expect(glyph().getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a library glyph by the id the merchant picked', () => {
    mount(config({ launcherIcon: { source: 'library', library: 'support' } }));
    expect(glyph().tagName.toLowerCase()).toBe('svg');
    // Six paths in the life ring, one in the chat bubble — enough to prove the
    // id was honoured rather than silently defaulted.
    expect(glyph().querySelectorAll('path').length).toBeGreaterThan(1);
  });

  // A ninth icon a newer console offers must not produce a blank launcher on
  // an older embed.
  it('falls back to the chat bubble for a library id it has never heard of', () => {
    mount(config({ launcherIcon: { source: 'library', library: 'unicorn' } }));
    expect(glyph().tagName.toLowerCase()).toBe('svg');
    expect(glyph().querySelectorAll('path')).toHaveLength(1);
  });

  it('renders an emoji through textContent, never as markup', () => {
    mount(config({ launcherIcon: { source: 'emoji', emoji: '👋' } }));
    expect(glyph().textContent).toBe('👋');
    expect(glyph().className).toBe('dh-launcher-emoji');
  });

  it('falls back when the emoji branch is selected but empty', () => {
    mount(config({ launcherIcon: { source: 'emoji', emoji: '   ' } }));
    expect(glyph().tagName.toLowerCase()).toBe('svg');
  });

  it('renders an https image', () => {
    mount(config({ launcherIcon: { source: 'image', imageUrl: 'https://cdn.acme.test/i.png' } }));
    expect(glyph().tagName.toLowerCase()).toBe('img');
    expect(glyph().getAttribute('src')).toBe('https://cdn.acme.test/i.png');
    expect(glyph().getAttribute('alt')).toBe('');
  });

  // The allowlist. Every one of these arrives from a merchant's console over a
  // public endpoint and would end up in a `src` on someone else's checkout
  // page; a relative path is refused too, because it would resolve against the
  // HOST's origin rather than anything we control.
  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a non-image data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a relative path', '/assets/chat/default-logo.svg'],
    ['an empty string', ''],
  ])('refuses %s and draws the built-in glyph instead', (_label, imageUrl) => {
    mount(config({ launcherIcon: { source: 'image', imageUrl } }));
    expect(glyph().tagName.toLowerCase()).toBe('svg');
  });

  it('accepts an uploaded image as a data: URL', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    mount(config({ launcherIcon: { source: 'image', imageUrl: url } }));
    expect(glyph().getAttribute('src')).toBe(url);
  });
});

describe('borrowing the host page’s colour', () => {
  const headerBg = (): string =>
    host().style.getPropertyValue('--dh-header-bg');

  it('samples the host’s top bar when the merchant asked for its colour', () => {
    document.body.innerHTML = '<header id="bar">shop</header>';
    document.getElementById('bar')!.style.backgroundColor = 'rgb(18, 52, 86)';

    mount(config({ design: 'hero', header: { colorSource: 'platform' } }));
    expect(headerBg()).toBe('#123456');
  });

  it('falls through to the body when there is no top bar to sample', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    mount(config({ design: 'hero', header: { colorSource: 'platform' } }));

    expect(headerBg()).toBe('#ffffff');
    // …and the text follows the colour rather than staying hardcoded white.
    expect(host().style.getPropertyValue('--dh-header-fg')).toBe('#1a1a1a');
    document.body.style.backgroundColor = '';
  });

  // "Borrow the site's colour" and "use this hex" are not both answerable, and
  // the explicit answer is the one the merchant typed most recently.
  it('does not sample when an explicit colour was set', () => {
    document.body.innerHTML = '<header id="bar">shop</header>';
    document.getElementById('bar')!.style.backgroundColor = 'rgb(18, 52, 86)';

    mount(config({ design: 'hero', header: { colorSource: 'platform', backgroundColor: '#abcdef' } }));
    expect(headerBg()).toBe('#abcdef');
  });

  // A page with no opaque colour genuinely has none to lend. That is an
  // answer, not a failure — and the accent already on the header is right.
  it('leaves the accent in place when there is nothing opaque to borrow', () => {
    mount(config({ design: 'hero', header: { colorSource: 'platform' } }));
    expect(headerBg()).toBe('var(--dh-accent)');
  });
});

describe('the panel', () => {
  it('is hidden from the a11y tree and the tab order while closed', () => {
    mount(config());
    const panel = query('.dh-panel');

    // Without this a keyboard user tabs into an invisible panel and a screen
    // reader reads a conversation that is not on screen.
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.getAttribute('data-open')).toBe('false');
  });

  it('is a labelled dialog that claims modality only because focus really is trapped', () => {
    const widget = mount(config());
    widget.open();
    const panel = query('.dh-panel');

    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('dh-title');
    expect(shadow().getElementById('dh-title')?.textContent).toBe('Chat with us');
    expect(panel.hasAttribute('aria-hidden')).toBe(false);
  });

  it('moves focus into the composer on open and back to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const widget = mount(config());
    widget.open();
    expect(shadow().activeElement).toBe(query('.dh-input'));

    widget.close();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and does not let the key reach the host page', () => {
    const onHostEscape = vi.fn();
    document.addEventListener('keydown', onHostEscape);

    const widget = mount(config());
    widget.open();

    query('.dh-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
    );

    expect(widget.isOpen()).toBe(false);
    // Otherwise dismissing our chat also closes the host's own modal.
    expect(onHostEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onHostEscape);
  });

  it('announces connection state in words, not only as a coloured dot', () => {
    mount(config());
    const status = query('.dh-status');

    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent?.trim()).not.toBe('');
  });
});

describe('presentation', () => {
  it('resolves auto to a sheet on a phone-width viewport', () => {
    vi.stubGlobal('innerWidth', 375);
    mount(config({ mode: 'auto' }));
    expect(host().getAttribute('data-presentation')).toBe('sheet');
  });

  it('resolves auto to a bubble on a desktop viewport', () => {
    vi.stubGlobal('innerWidth', 1280);
    mount(config({ mode: 'auto' }));
    expect(host().getAttribute('data-presentation')).toBe('bubble');
  });

  it('honours an explicit sidebar even at phone width', () => {
    vi.stubGlobal('innerWidth', 375);
    mount(config({ mode: 'sidebar', side: 'left' }));
    expect(host().getAttribute('data-presentation')).toBe('sidebar');
    expect(host().getAttribute('data-side')).toBe('left');
  });

  it('keeps the launcher tabbable in bubble mode and removes it under a sheet', () => {
    vi.stubGlobal('innerWidth', 1280);
    const bubble = mount(config({ mode: 'bubble' }));
    bubble.open();
    // In bubble mode the launcher is still visible and acts as the close
    // control; under a sheet it is covered, so leaving it in the tab order
    // would strand a keyboard user on a control they cannot see.
    expect(query<HTMLElement>('.dh-launcher').hidden).toBe(false);
    bubble.destroy();

    const sheet = mount(config({ mode: 'sheet' }));
    sheet.open();
    expect(query<HTMLElement>('.dh-launcher').hidden).toBe(true);
  });
});

describe('surviving a second script tag', () => {
  it('returns the existing widget and mounts no second one', () => {
    const first = mount(config());
    const errors: unknown[] = [];
    const second = mount(config({ onError: (error) => errors.push(error) }));

    expect(second).toBe(first);
    expect(document.querySelectorAll('dh-chat-widget')).toHaveLength(1);
    // Reported, not thrown: the duplicate tag is usually not the one anyone is
    // debugging, and throwing would take out whatever else that bundle does.
    expect(errors).toHaveLength(1);
  });

  it('reports the duplicate even when the caller supplied no onError', () => {
    // The script-tag path builds its config from data attributes, which cannot
    // carry a function — so reaching only for `config.onError` made a duplicate
    // SCRIPT TAG, the exact case this guard exists for, completely silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bare = { ...config() };
    delete (bare as { onError?: unknown }).onError;

    mount(bare);
    mount(bare);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('lets a genuine multi-instance host opt out of the guard', () => {
    mount(config());
    // A marketplace embedding one conversation per live order.
    const extra = createWidget(config());
    expect(document.querySelectorAll('dh-chat-widget')).toHaveLength(2);
    extra.destroy();
    expect(document.querySelectorAll('dh-chat-widget')).toHaveLength(1);
  });
});

describe('teardown', () => {
  it('removes every node it added and can be called twice', () => {
    document.body.innerHTML = '<main>checkout</main>';
    const widget = mount(config());
    expect(document.querySelector('dh-chat-widget')).not.toBeNull();

    widget.destroy();
    expect(document.querySelector('dh-chat-widget')).toBeNull();
    expect(document.body.innerHTML).toBe('<main>checkout</main>');

    expect(() => widget.destroy()).not.toThrow();
  });

  it('releases the window resize listener', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    mount(config()).destroy();

    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('frees the singleton so a later mount succeeds', () => {
    const first = mount(config());
    first.destroy();

    const second = mount(config());
    expect(second).not.toBe(first);
    expect(document.querySelectorAll('dh-chat-widget')).toHaveLength(1);
  });
});

describe('the classic header’s avatar', () => {
  // The rule the whole `null`-not-empty-circle contract exists for: this
  // widget has never drawn an avatar, and an upgrade must not put a grey disc
  // where a merchant's brand is supposed to be.
  it('draws nothing at all when there is nothing to draw', () => {
    mount(config());
    expect(shadow().querySelector('.dh-avatar')).toBeNull();
    expect(query<HTMLElement>('.dh-avatar-host').hidden).toBe(true);
  });

  it('draws the initials a merchant set', () => {
    mount(config({ avatarInitials: 'DH' }));
    expect(query('.dh-avatar').textContent).toBe('DH');
    expect(query<HTMLElement>('.dh-avatar-host').hidden).toBe(false);
  });

  // The console renders this field as a free-text input; three letters
  // overflow a 32px disc, so a merchant who typed their whole name gets the
  // first letters of it rather than a broken circle.
  it('takes the first two letters of a longer string', () => {
    mount(config({ avatarInitials: 'Dhaam Support' }));
    expect(query('.dh-avatar').textContent).toBe('Dh');
  });

  it('draws the logo instead when the mode says so', () => {
    mount(config({ avatarMode: 'logo', logoUrl: 'https://cdn.acme.test/logo.png' }));
    expect(query<HTMLImageElement>('.dh-avatar-image').getAttribute('src')).toBe(
      'https://cdn.acme.test/logo.png',
    );
  });

  // A refused URL is the no-avatar case, not a broken-image icon in the
  // header of somebody's checkout page.
  it('draws nothing when the logo URL is refused', () => {
    mount(config({ avatarMode: 'logo', logoUrl: 'javascript:alert(1)' }));
    expect(shadow().querySelector('.dh-avatar')).toBeNull();
  });

  // The hero design has its own face row; two avatars in one header is one
  // more than anybody asked for.
  it('stays out of the hero header entirely', () => {
    mount(config({ design: 'hero', avatarInitials: 'DH' }));
    expect(shadow().querySelector('.dh-avatar')).toBeNull();
  });
});

describe('the platform credit', () => {
  it('is absent until a merchant turns it on', () => {
    mount(config());
    expect(query<HTMLElement>('.dh-branding').hidden).toBe(true);
  });

  it('renders as plain text when no URL is given', () => {
    mount(config({ showBranding: true, brandingText: 'Powered by Dhaam' }));
    expect(query<HTMLElement>('.dh-branding').hidden).toBe(false);
    expect(query('.dh-branding-text').textContent).toBe('Powered by Dhaam');
    expect(query<HTMLElement>('.dh-branding-link').hidden).toBe(true);
  });

  it('renders as a link when the URL survives the guard', () => {
    mount(config({ showBranding: true, brandingUrl: 'https://dhaam.com' }));
    const link = query<HTMLAnchorElement>('.dh-branding-link');
    expect(link.hidden).toBe(false);
    expect(link.getAttribute('href')).toBe('https://dhaam.com');
    // The credit sits on a merchant's checkout page; the referrer would leak
    // whatever the customer was buying to whoever it points at.
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  // The half of the guard that matters: this value lands in an `href`, where
  // a `javascript:` URL is a script and not a broken picture.
  it('refuses a javascript: URL and falls back to plain text', () => {
    mount(config({ showBranding: true, brandingText: 'Us', brandingUrl: 'javascript:alert(1)' }));
    expect(query<HTMLElement>('.dh-branding-link').hidden).toBe(true);
    expect(query('.dh-branding-text').textContent).toBe('Us');
  });

  it('stays hidden when switched on with nothing to say', () => {
    mount(config({ showBranding: true, brandingText: '   ' }));
    expect(query<HTMLElement>('.dh-branding').hidden).toBe(true);
  });
});

describe('the merchant’s subtitle', () => {
  // The connection never reaches `connected` in this environment (the socket
  // is silent by design), which is exactly the case worth pinning: a
  // response-time promise must never be painted over a diagnostic.
  it('never replaces a connection label that is still diagnostic', () => {
    mount(config({ subtitle: 'Typically replies in a few minutes' }));
    expect(query('.dh-status-text').textContent).not.toBe('Typically replies in a few minutes');
  });
});

describe('the typing indicator’s off switch', () => {
  // It ships ON, so a widget whose config never lands behaves as it always has.
  it('is on before any config lands', () => {
    mount(config());
    expect(host().getAttribute('data-typing')).not.toBe('off');
  });
});

describe('the §14 key split, end to end', () => {
  it('refuses to mount with a secret key and leaves nothing on the page', () => {
    expect(() =>
      mount(config({ auth: { publishableKey: 'dhk_live_0123456789abcdefghijklmn', tokenEndpoint: '/t' } })),
    ).toThrow();

    // The failure must be total: no host element, and above all no socket.
    expect(document.querySelector('dh-chat-widget')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
