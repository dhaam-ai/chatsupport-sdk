// The per-message menu: Copy, and Reply.
//
// ── Why only two ─────────────────────────────────────────────────────────
//
// The React reference offers edit and delete alongside these. Neither exists
// on this protocol — there is no `message.edit` or `message.delete` frame in
// `@dhaam-ccrm/core`'s catalog, and nothing server-side to receive one. A menu
// item that cannot work is worse than an absent one: it is a promise the
// product makes and then breaks in front of the customer, which is exactly the
// failure the emailed-transcript work had to be held back from shipping.
//
// Reply, by contrast, is real: `replyToMessageId` is on the send frame
// (core protocol/frames.ts) and core's `sendMessage` already accepts it, so
// this is a capability the wire has always had and no surface exposed.
//
// ── Why a popover and not inline buttons ─────────────────────────────────
//
// Two controls on every row is visual noise on a transcript whose job is to be
// read, and on a phone they compete with the text for width. A single toggle
// that opens on demand keeps the quiet state quiet.

import { ICONS, el, icon } from './dom.js';

export interface MessageActionsCallbacks {
  /** Copy the message text. Rejects if the clipboard refuses. */
  readonly onCopy: () => Promise<void>;
  readonly onReply: () => void;
}

export interface MessageActionsView {
  readonly node: HTMLElement;
  /** Closes the menu without acting. Called when the row re-renders. */
  close(): void;
  destroy(): void;
}

/**
 * One row's action menu.
 *
 * The menu is closed by an outside `pointerdown`, the same mechanism
 * `ui/session-picker.ts` uses for its own popover — and, like that one, the
 * listener is document-level and therefore MUST be released on destroy or it
 * outlives the shadow root.
 */
export function createMessageActions(callbacks: MessageActionsCallbacks): MessageActionsView {
  const copy = el('button', {
    attrs: { class: 'dh-msg-action', type: 'button' },
    children: [icon(ICONS.copy, 14), el('span', { text: 'Copy' })],
    on: {
      click: () => {
        close();
        void callbacks
          .onCopy()
          .then(() => announce('Copied'))
          // Clipboard access is refused outright in some browsers without a
          // permission the host page has not asked for. Saying so is better
          // than a button that silently does nothing.
          .catch(() => announce("Couldn't copy"));
      },
    },
  });

  const reply = el('button', {
    attrs: { class: 'dh-msg-action', type: 'button' },
    children: [icon(ICONS.reply, 14), el('span', { text: 'Reply' })],
    on: {
      click: () => {
        close();
        callbacks.onReply();
      },
    },
  });

  const menu = el('div', {
    attrs: { class: 'dh-msg-menu', hidden: true, role: 'menu' },
    children: [copy, reply],
  });

  const toggle = el('button', {
    attrs: {
      class: 'dh-msg-more',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      // Named, because the glyph is three dots and a screen reader would
      // otherwise announce an unlabelled button on every single message.
      'aria-label': 'Message actions',
    },
    children: [icon(ICONS.more, 16)],
    on: {
      click: (event) => {
        // Stopped so the document listener below does not immediately close
        // what this click just opened.
        event.stopPropagation();
        if (menu.hidden) open();
        else close();
      },
    },
  });

  /**
   * Outcome announcements for actions with no visible result.
   *
   * Copy changes nothing on screen, so without this a screen-reader user gets
   * no confirmation it happened at all. Its own region rather than the message
   * list's: that one is busy narrating arrivals.
   */
  const live = el('span', { attrs: { class: 'dh-sr', role: 'status', 'aria-live': 'polite' } });
  function announce(text: string): void {
    live.textContent = text;
  }

  const node = el('div', { attrs: { class: 'dh-msg-actions' }, children: [toggle, menu, live] });

  function open(): void {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    copy.focus();
  }

  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
  }

  const onOutside = (event: Event): void => {
    if (!node.contains(event.target as Node)) close();
  };

  // Escape closes the menu without closing the PANEL. Without stopping it, the
  // panel's own Escape handler would take the whole widget down because the
  // customer wanted to dismiss a two-item menu.
  node.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || menu.hidden) return;
    event.stopPropagation();
    close();
    toggle.focus();
  });

  return {
    node,
    close,
    destroy() {
      document.removeEventListener('pointerdown', onOutside);
    },
  };
}
