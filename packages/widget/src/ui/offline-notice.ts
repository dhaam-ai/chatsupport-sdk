// The out-of-hours notice for `SHOW_MESSAGE`: the merchant's own words, and
// nothing to type into.
//
// WIDGET_CONFIG_SCHEMA §G defines the mode as "render `behaviour.offlineMessage`,
// no chat input" — and the console's own hint says visitors "can read it but
// not reply". It stands in the slot the conversation would otherwise fill, the
// same slot `createOfflineForm` uses for `COLLECT_MESSAGE`, so the composer is
// replaced rather than left dangling under a message saying nobody is there.
//
// Reached only when the server says so (`isOpenNow === false`, see
// remote-config.ts's `shouldShowOfflineNotice`). This module receives text,
// never a schedule: whether the team is in is chat-service's answer to give.

import { el } from './dom.js';

/** Shown when the merchant switched hours on but wrote no message. */
const DEFAULT_MESSAGE = "We're closed right now. Please check back later.";

export interface OfflineNoticeView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createOfflineNotice(message?: string): OfflineNoticeView {
  const text = message !== undefined && message.trim() !== '' ? message : DEFAULT_MESSAGE;
  const node = el('div', {
    attrs: { class: 'dh-offline dh-offline-notice', role: 'status', tabindex: '-1' },
    children: [
      el('div', {
        attrs: { class: 'dh-offline-banner' },
        children: [
          el('p', { attrs: { class: 'dh-form-heading' }, text: "We're currently offline." }),
          el('p', { attrs: { class: 'dh-form-subtitle' }, text }),
        ],
      }),
    ],
  });
  return {
    node,
    focus() {
      node.focus({ preventScroll: true });
    },
    destroy() {
      // No listeners at all.
    },
  };
}
