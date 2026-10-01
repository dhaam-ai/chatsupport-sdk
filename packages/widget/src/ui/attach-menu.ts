// The composer's attach button (ui/composer.ts): rather than jumping
// straight into one file picker, offers "File" (any type) or "Video"
// (video/* picker, so a phone's photo app opens to its video tab instead of
// its camera roll). Same open/close/outside-click/Escape shape as
// ui/header-menu.ts, just two items and anchored upward — the composer sits
// at the BOTTOM of the panel, so the menu has to open above the toggle, not
// below it (`.dh-hmenu-up` in styles.ts).

import { ICONS, el, icon } from './dom.js';

export interface AttachMenuCallbacks {
  readonly onFile: () => void;
  readonly onVideo: () => void;
}

export interface AttachMenuView {
  readonly node: HTMLElement;
  readonly toggle: HTMLButtonElement;
  destroy(): void;
}

export function createAttachMenu(callbacks: AttachMenuCallbacks): AttachMenuView {
  const item = (glyph: readonly string[], label: string, onClick: () => void): HTMLButtonElement =>
    el('button', {
      attrs: { class: 'dh-hmenu-item', type: 'button', role: 'menuitem' },
      children: [icon(glyph, 16), el('span', { text: label })],
      on: {
        click: () => {
          close();
          onClick();
        },
      },
    });

  const fileItem = item(ICONS.paperclip, 'File', () => callbacks.onFile());
  const videoItem = item(ICONS.video, 'Video', () => callbacks.onVideo());

  const menu = el('div', {
    attrs: { class: 'dh-hmenu dh-hmenu-up', hidden: true, role: 'menu', 'aria-label': 'Attach' },
    children: [fileItem, videoItem],
  });

  const toggle = el('button', {
    attrs: {
      class: 'dh-icon-button dh-composer-tool-btn dh-hmenu-toggle',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Attach a file',
    },
    children: [icon(ICONS.paperclip, 18)],
    on: {
      click: (event) => {
        event.stopPropagation();
        if (menu.hidden) open();
        else close();
      },
    },
  });

  const node = el('div', { attrs: { class: 'dh-hmenu-wrap' }, children: [toggle, menu] });

  // Same retargeting trap `ui/header-menu.ts`'s own `onOutside` documents:
  // `composedPath()[0]`, not `event.target`, because this listener lives on
  // the document outside the shadow tree.
  const onOutside = (event: Event): void => {
    const pressed = event.composedPath()[0] ?? event.target;
    if (!node.contains(pressed as Node)) close();
  };

  function open(): void {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    fileItem.focus();
  }

  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
  }

  node.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || menu.hidden) return;
    event.stopPropagation();
    close();
    toggle.focus();
  });

  return {
    node,
    toggle,
    destroy() {
      document.removeEventListener('pointerdown', onOutside);
    },
  };
}
