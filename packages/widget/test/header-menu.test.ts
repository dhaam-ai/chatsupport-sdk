// @vitest-environment jsdom
//
// The header ⋯ menu, mounted the way the widget really mounts it: inside a
// shadow root. That detail is the entire point of this file. The menu's
// outside-dismiss listener lives on the DOCUMENT, and to a document-level
// listener every event from inside a shadow tree is retargeted to the shadow
// HOST — so a press on one of the menu's own items used to look "outside",
// close the menu mid-press, and swallow the click those pointer events were
// producing. Every item then "did nothing" under a real pointer while a
// synthetic `.click()` (no pointerdown) sailed through, which is how the menu
// passed automation and failed a human (dh-hyperlocal, reported issue 5).
// A test that appends the menu straight to `document.body` cannot catch any
// of this, because without a shadow boundary nothing is retargeted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeaderMenu, type HeaderMenuCallbacks } from '../src/ui/header-menu.js';

let host: HTMLElement;
let shadow: ShadowRoot;

beforeEach(() => {
  host = document.createElement('div');
  shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

function build(overrides: Partial<HeaderMenuCallbacks> = {}) {
  const callbacks: HeaderMenuCallbacks = {
    onStartNew: vi.fn(),
    onEndConversation: vi.fn(),
    onReportIssue: vi.fn(),
    onMuteChange: vi.fn(),
    ...overrides,
  };
  const menu = createHeaderMenu(callbacks);
  shadow.appendChild(menu.node);
  menu.update({ canEnd: true, privacyUrl: '', reportIssue: true, muted: false });
  return { menu, callbacks };
}

/** A real pointer's press: bubbles and crosses the shadow boundary. */
const press = (target: EventTarget) =>
  target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));

const toggle = () => shadow.querySelector<HTMLButtonElement>('.dh-hmenu-toggle')!;
const menuEl = () => shadow.querySelector<HTMLElement>('.dh-hmenu')!;
/** The mute item — the first row in the menu, and the only one that toggles. */
const muteItem = () => menuEl().querySelector<HTMLButtonElement>('.dh-hmenu-item')!;

describe('outside-dismiss vs shadow retargeting', () => {
  it('sanity: the document really does see our presses retargeted to the host', () => {
    // If jsdom ever stops retargeting, the two tests below go vacuous — this
    // one fails first and says why.
    build();
    toggle().click();
    let seen: EventTarget | null = null;
    const spy = (event: Event): void => {
      seen = event.target;
    };
    document.addEventListener('pointerdown', spy);
    press(muteItem());
    document.removeEventListener('pointerdown', spy);
    expect(seen).toBe(host);
  });

  it('a press on a menu item does NOT close the menu, so its click still lands', () => {
    const { callbacks } = build();
    toggle().click();
    expect(menuEl().hidden).toBe(false);

    const mute = muteItem();
    press(mute);
    // Still open at "release" time — the click this press produces can land.
    expect(menuEl().hidden).toBe(false);

    mute.click();
    expect(callbacks.onMuteChange).toHaveBeenCalledWith(true);
    expect(menuEl().hidden).toBe(true);
  });

  it('a press elsewhere in the shadow tree (not just the host page) closes it', () => {
    build();
    const elsewhere = document.createElement('button');
    shadow.appendChild(elsewhere);
    toggle().click();

    press(elsewhere);
    expect(menuEl().hidden).toBe(true);
  });

  it('a press on the host page outside the widget closes it', () => {
    build();
    toggle().click();

    press(document.body);
    expect(menuEl().hidden).toBe(true);
  });
});

// ── The mute item's label (reported issue 2) ──────────────────────────────
//
// It used to read "Mute notifications" in both states — only the bell glyph
// changed — so a customer who had muted the chime was offered "Mute
// notifications" again and could not tell what pressing it would do. The item
// is now a plain `menuitem` whose label names the ACTION, which is why the
// `menuitemcheckbox` role and `aria-checked` had to go with it: a checkbox
// announcing "Unmute notifications, checked" states the opposite of what the
// control does. See `setMuted`'s own comment in ui/header-menu.ts.
describe('the mute item states what pressing it will do', () => {
  it('reads "Mute notifications" while sound is on and "Unmute notifications" once muted', () => {
    const { menu } = build();
    toggle().click();
    expect(muteItem().textContent).toBe('Mute notifications');

    muteItem().click();
    toggle().click();
    expect(muteItem().textContent).toBe('Unmute notifications');

    // And back — the label is derived from the state, not toggled blindly.
    muteItem().click();
    toggle().click();
    expect(muteItem().textContent).toBe('Mute notifications');
    menu.close();
  });

  it('renders the muted label from an `update()` that arrives already muted', () => {
    // The persisted preference path: the widget reads the stored mute flag and
    // pushes it in through `update`, which must paint the same label a click
    // would have.
    const { menu } = build();
    menu.update({ canEnd: true, privacyUrl: '', reportIssue: true, muted: true });
    toggle().click();
    expect(muteItem().textContent).toBe('Unmute notifications');
  });

  it('is a plain menuitem with no contradictory checked state', () => {
    build();
    toggle().click();
    expect(muteItem().getAttribute('role')).toBe('menuitem');
    expect(muteItem().hasAttribute('aria-checked')).toBe(false);
    // The accessible name IS the visible label — nothing overrides it, so
    // WCAG 2.5.3 (Label in Name) holds in both states.
    expect(muteItem().hasAttribute('aria-label')).toBe(false);

    muteItem().click();
    toggle().click();
    expect(muteItem().hasAttribute('aria-checked')).toBe(false);
    expect(muteItem().hasAttribute('aria-label')).toBe(false);
  });
});
