// @vitest-environment jsdom
//
// The per-message ⋯ menu and the emoji picker, mounted the way the widget
// really mounts them: inside a shadow root. Both close on an outside
// `pointerdown` heard at the DOCUMENT, and to a document-level listener every
// event from inside a shadow tree is retargeted to the shadow HOST — so a
// press on one of their own items used to look "outside", close the popover
// mid-press, and swallow the click those pointer events were producing.
// header-menu.test.ts tells the full story (dh-hyperlocal, reported issue 5)
// and guards the header menu; this file guards the other two popovers that
// carried the identical listener, fixed the identical way (`composedPath()[0]`,
// the cure session-picker.ts always used). A test that appends these straight
// to `document.body` cannot catch any of this, because without a shadow
// boundary nothing is retargeted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmojiPicker } from '../src/ui/emoji.js';
import { createMessageActions } from '../src/ui/message-actions.js';

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

/** A real pointer's press: bubbles and crosses the shadow boundary. */
const press = (target: EventTarget) =>
  target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));

describe('the per-message ⋯ menu vs shadow retargeting', () => {
  function build() {
    const callbacks = { onCopy: vi.fn(async () => {}), onReply: vi.fn() };
    const view = createMessageActions(callbacks);
    shadow.appendChild(view.node);
    return { view, callbacks };
  }

  const toggle = () => shadow.querySelector<HTMLButtonElement>('.dh-msg-more')!;
  const menuEl = () => shadow.querySelector<HTMLElement>('.dh-msg-menu')!;

  it('sanity: the document really does see our presses retargeted to the host', () => {
    // If jsdom ever stops retargeting, the tests below go vacuous — this one
    // fails first and says why.
    build();
    toggle().click();
    let seen: EventTarget | null = null;
    const spy = (event: Event): void => {
      seen = event.target;
    };
    document.addEventListener('pointerdown', spy);
    press(menuEl().querySelector('.dh-msg-action')!);
    document.removeEventListener('pointerdown', spy);
    expect(seen).toBe(host);
  });

  it('a press on a menu item does NOT close the menu, so its click still lands', () => {
    const { callbacks } = build();
    toggle().click();
    expect(menuEl().hidden).toBe(false);

    // Reply, not Copy: its handler is synchronous, so the click landing is
    // observable without waiting out the copy-outcome timer.
    const reply = menuEl().querySelectorAll<HTMLButtonElement>('.dh-msg-action')[1]!;
    press(reply);
    // Still open at "release" time — the click this press produces can land.
    expect(menuEl().hidden).toBe(false);

    reply.click();
    expect(callbacks.onReply).toHaveBeenCalledTimes(1);
    expect(menuEl().hidden).toBe(true);
  });

  it('a press on the host page outside the widget closes it', () => {
    build();
    toggle().click();

    press(document.body);
    expect(menuEl().hidden).toBe(true);
  });
});

describe('the emoji picker vs shadow retargeting', () => {
  function build() {
    const callbacks = { onSelect: vi.fn() };
    const view = createEmojiPicker(callbacks);
    shadow.appendChild(view.node);
    return { view, callbacks };
  }

  const trigger = () => shadow.querySelector<HTMLButtonElement>('.dh-icon-button')!;
  const popover = () => shadow.querySelector<HTMLElement>('.dh-emoji-popover')!;

  it('a press on an emoji cell does NOT close the popover, so its click still lands', () => {
    const { view, callbacks } = build();
    trigger().click();
    expect(view.isOpen()).toBe(true);

    const cell = popover().querySelector<HTMLButtonElement>('.dh-emoji-cell')!;
    press(cell);
    // Still open at "release" time — the click this press produces can land,
    // and the picker deliberately stays open after a selection.
    expect(view.isOpen()).toBe(true);

    cell.click();
    expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
    expect(view.isOpen()).toBe(true);
  });

  it('a press on the host page outside the widget closes it', () => {
    const { view } = build();
    trigger().click();
    expect(view.isOpen()).toBe(true);

    press(document.body);
    expect(view.isOpen()).toBe(false);
  });
});
