// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { captureFocus, tabbableWithin, trapFocus } from '../src/ui/focus.js';

function mountShadow(html: string): { host: HTMLElement; shadow: ShadowRoot; panel: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const panel = document.createElement('div');
  panel.innerHTML = html;
  shadow.appendChild(panel);
  return { host, shadow, panel };
}

function tab(target: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('tabbableWithin', () => {
  it('finds focusable controls in DOM order', () => {
    const { panel } = mountShadow(`
      <button id="a">a</button>
      <textarea id="b"></textarea>
      <button id="c">c</button>
    `);

    expect(tabbableWithin(panel).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips disabled, hidden, and aria-hidden controls', () => {
    // Each of these is a state this widget genuinely puts a control into: the
    // send button is disabled with an empty composer, "load earlier" is hidden
    // with no more history, and the launcher is hidden behind a sheet.
    const { panel } = mountShadow(`
      <button id="a">a</button>
      <button id="off" disabled>off</button>
      <button id="gone" hidden>gone</button>
      <button id="quiet" aria-hidden="true">quiet</button>
      <button id="b">b</button>
    `);

    expect(tabbableWithin(panel).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('skips a control inside a hidden ancestor', () => {
    const { panel } = mountShadow(`
      <button id="a">a</button>
      <div hidden><button id="buried">buried</button></div>
    `);

    expect(tabbableWithin(panel).map((n) => n.id)).toEqual(['a']);
  });

  it('does not exclude a fixed-position control', () => {
    // The trap's container IS `position: fixed` in every presentation. The
    // obvious `offsetParent === null` visibility test reports null for exactly
    // those elements, which would empty the trap of every stop it has.
    const { panel } = mountShadow(`<button id="a" style="position:fixed">a</button>`);

    expect(tabbableWithin(panel).map((n) => n.id)).toEqual(['a']);
  });
});

describe('trapFocus', () => {
  it('wraps forward from the last control to the first', () => {
    const { shadow, panel } = mountShadow(`
      <button id="first">first</button>
      <button id="last">last</button>
    `);
    const trap = trapFocus(panel, shadow);

    const last = shadow.getElementById('last') as HTMLElement;
    last.focus();
    expect(shadow.activeElement).toBe(last);

    const event = tab(last);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(shadow.getElementById('first'));

    trap.release();
  });

  it('wraps backward from the first control to the last', () => {
    const { shadow, panel } = mountShadow(`
      <button id="first">first</button>
      <button id="last">last</button>
    `);
    const trap = trapFocus(panel, shadow);

    const first = shadow.getElementById('first') as HTMLElement;
    first.focus();

    const event = tab(first, true);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(shadow.getElementById('last'));

    trap.release();
  });

  it('leaves a Tab in the middle of the panel alone', () => {
    // Only the two ends are intercepted; everything between them is the
    // browser's own sequential navigation, which is more correct than
    // anything this could reimplement.
    const { shadow, panel } = mountShadow(`
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c">c</button>
    `);
    const trap = trapFocus(panel, shadow);

    const middle = shadow.getElementById('b') as HTMLElement;
    middle.focus();
    expect(tab(middle).defaultPrevented).toBe(false);

    trap.release();
  });

  it('stops intercepting once released', () => {
    const { shadow, panel } = mountShadow(`
      <button id="first">first</button>
      <button id="last">last</button>
    `);
    const trap = trapFocus(panel, shadow);
    trap.release();

    const last = shadow.getElementById('last') as HTMLElement;
    last.focus();
    expect(tab(last).defaultPrevented).toBe(false);
  });
});

describe('captureFocus', () => {
  it('returns focus to the host-page element that opened the panel', () => {
    const opener = document.createElement('button');
    opener.id = 'help';
    document.body.appendChild(opener);
    opener.focus();

    const restore = captureFocus();

    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    restore();
    // Without this a keyboard user who opened the chat from a "Need help?"
    // link is dumped at the top of the document on close.
    expect(document.activeElement).toBe(opener);
  });

  it('does nothing if the host unmounted the opener while the panel was open', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const restore = captureFocus();

    // An SPA route change behind an open chat is entirely normal. Focusing a
    // detached element silently moves focus to <body>, which is worse than
    // leaving it where the browser put it.
    opener.remove();
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    restore();
    expect(document.activeElement).toBe(other);
  });
});
