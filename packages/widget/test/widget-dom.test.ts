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
