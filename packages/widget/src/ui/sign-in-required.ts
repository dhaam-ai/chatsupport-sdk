// Shown to a guest when the console's "Allow visitor chat" is off
// (`behaviour.allowGuestChat: false`). Replaces the whole panel body, like
// `unavailable.ts`, whose styles it reuses.

import { el, icon } from './dom.js';

export interface SignInRequiredView {
  readonly node: HTMLElement;
  focus(): void;
}

/** `onSignIn` absent → no button; the host has no sign-in route to offer. */
export function createSignInRequired(onSignIn?: () => void): SignInRequiredView {
  const button = onSignIn
    ? el('button', {
        attrs: { class: 'dh-unavail-retry', type: 'button' },
        text: 'Sign in',
        on: { click: () => onSignIn() },
      })
    : null;

  const node = el('div', {
    attrs: { class: 'dh-unavail dh-signin', hidden: true, role: 'status' },
    children: [
      el('span', {
        attrs: { class: 'dh-unavail-icon', 'aria-hidden': 'true' },
        children: [icon(['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 20a8 8 0 0 1 16 0'], 26)],
      }),
      el('p', { attrs: { class: 'dh-unavail-title' }, text: 'Sign in to chat' }),
      el('p', {
        attrs: { class: 'dh-unavail-body' },
        text: 'Please sign in to start a conversation with us.',
      }),
      ...(button ? [button] : []),
    ],
  });

  return {
    node,
    focus() {
      (button ?? node).focus({ preventScroll: true });
    },
  };
}
