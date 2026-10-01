// The bubble shown when the server pushes a `flow.invite`
// (chatbot-workflows-commerce.md §6): a flow would like to start and there
// is no chat yet. Anchored beside the launcher rather than inside the panel
// — the panel may well be closed, which is the whole point of an invite.
//
// Text only, like every other string this widget renders (ui/dom.ts's `el`
// header) — an invite's text and button labels are merchant-authored flow
// copy, but still untrusted shape-wise by the time it reaches here.

import { el } from './dom.js';

export interface InviteBubbleButton {
  readonly id: string;
  readonly label: string;
}

export interface InviteView {
  readonly inviteId: string;
  readonly text: string;
  /**
   * Carried for API compatibility with the `flow.invite` payload, but no
   * longer rendered here — the compact bubble is text only (heading-style);
   * tapping it accepts the invite and opens the full chat, where these same
   * buttons render as the flow's actual first step (ui/quick-replies.ts).
   * Showing the same buttons twice (once collapsed in a tiny card, once full
   * size in the chat) read as cluttered, by design request.
   */
  readonly buttons: readonly InviteBubbleButton[];
}

export interface InviteBubbleElement {
  readonly node: HTMLElement;
  /** Shows `view`, or hides the bubble when `view` is `null`. */
  update(view: InviteView | null): void;
  /**
   * Names who the bubble speaks for — a brand fact (the widget's title/avatar),
   * not part of any one invite's payload, so it is set independently of
   * `update()`. `avatarInitials` follows the header's own rule (config.ts's
   * `avatarInitials` doc): empty means no avatar, not a blank circle.
   */
  setSender(name: string, avatarInitials?: string): void;
}

/**
 * Builds the bubble. Hidden until {@link InviteBubbleElement.update} shows
 * one — a widget that has never received an invite must never flash one.
 */
export function createInviteBubble(callbacks: {
  /** Tapping the bubble's text, or any of its buttons: accept this invite. */
  readonly onAccept: (inviteId: string) => void;
  /** The bubble's own close affordance. */
  readonly onDismiss: (inviteId: string) => void;
}): InviteBubbleElement {
  let current: InviteView | null = null;

  // Absent from the DOM entirely until setSender() names someone — a bubble
  // built before its host resolves config must not show a blank/undefined
  // header for one frame.
  const avatar = el('div', { attrs: { class: 'dh-invite-avatar' } });
  const name = el('span', { attrs: { class: 'dh-invite-name' } });
  const header = el('div', { attrs: { class: 'dh-invite-header' } });

  const text = el('button', {
    attrs: { class: 'dh-invite-text', type: 'button' },
    on: {
      click: () => {
        if (current !== null) callbacks.onAccept(current.inviteId);
      },
    },
  });
  const close = el('button', {
    attrs: { class: 'dh-invite-close', type: 'button', 'aria-label': 'Dismiss' },
    text: '×',
    on: {
      click: () => {
        if (current !== null) callbacks.onDismiss(current.inviteId);
      },
    },
  });

  const node = el('div', {
    attrs: { class: 'dh-invite-bubble', hidden: true, role: 'dialog', 'aria-label': 'Chat invitation', 'aria-live': 'polite' },
    children: [close, text],
  });

  return {
    node,
    update(view) {
      if (view === null) {
        current = null;
        node.hidden = true;
        return;
      }
      current = view;
      if (text.textContent !== view.text) text.textContent = view.text;
      node.hidden = false;
    },
    setSender(senderName, avatarInitials) {
      if (name.textContent !== `${senderName} replied`) name.textContent = `${senderName} replied`;
      header.replaceChildren(...(avatarInitials ? [avatar, name] : [name]));
      if (avatar.textContent !== avatarInitials) avatar.textContent = avatarInitials ?? '';
      // Indents the message (and its buttons) to start under the NAME, not
      // under the avatar — only when there is an avatar column to align
      // past; with none, the name itself starts at the card edge and the
      // message should too.
      node.classList.toggle('dh-invite-has-avatar', Boolean(avatarInitials));

      if (senderName && !node.contains(header)) node.insertBefore(header, text);
      else if (!senderName) header.remove();
    },
  };
}
