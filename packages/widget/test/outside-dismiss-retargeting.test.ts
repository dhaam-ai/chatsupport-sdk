// @vitest-environment jsdom
//
// The emoji picker, mounted the way the widget really mounts it: inside a
// shadow root. It closes on an outside `pointerdown` heard at the DOCUMENT,
// and to a document-level listener every event from inside a shadow tree is
// retargeted to the shadow HOST — so a press on one of its own cells used to
// look "outside", close the popover mid-press, and swallow the click that
// pointer event was producing. header-menu.test.ts tells the full story
// (dh-hyperlocal, reported issue 5) and guards the header menu; this file
// guards the emoji picker, which carried the identical listener, fixed the
// identical way (`composedPath()[0]`, the cure session-picker.ts always
// used). A test that appends it straight to `document.body` cannot catch any
// of this, because without a shadow boundary nothing is retargeted.
//
// The per-message "..." menu this file used to guard the same way is gone —
// see message-actions.ts. Its single Reply button holds no document-level
// listener, so there is nothing left here for it to dismiss.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmojiPicker } from '../src/ui/emoji.js';

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
