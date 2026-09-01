// The bar under the header that says the network is gone and the messages are
// safe.
//
// ── Why this is a bar and not a word in the status line ──────────────────
//
// The status line under the title already said "No internet connection" and it
// was not enough, for two reasons that are both about what a bar is FOR.
//
// The first is that a subtitle is a caption. It sits at 12px under a name, in
// muted grey, in the one spot a customer stops reading after the first visit
// because it usually says "Replies instantly". Losing your signal mid-sentence
// is not caption-sized news.
//
// The second is the half the status line could never carry: what happens to
// what you have already typed. "You're offline" on its own reads as "stop
// typing" — so the customer stops, and the durable send queue (§9.1, §8.4)
// that would have delivered their message the moment the signal returned never
// gets used. The promise is the point of the bar. The composer stays enabled
// underneath it precisely because that promise is true.
//
// ── Not an error, and coloured that way ─────────────────────────────────
//
// Amber, not red. Nothing has failed: every message is held, the connection is
// retrying, and the expected outcome is that all of it goes through. Red is
// for the failed send, which has its own affordance on the message itself
// (`retryMessage`). A red bar for a tunnel would teach customers that the red
// bar means nothing.
//
// The copy and the show/hide decision are NOT made here. Both come from
// `resolveOfflineBanner` in @dhaam-ccrm/browser, which @dhaam-ccrm/react also
// renders from — so the two bindings cannot drift into telling a customer two
// different things about the same connection.

import type { OfflineBannerView } from '@dhaam-ccrm/browser';

import { el, icon } from './dom.js';

/**
 * A wifi glyph with a slash through it, drawn as four arcs and a stroke.
 *
 * Same provenance rule as `ICONS` in dom.ts — an outline path set drawn to
 * this package's 24px, 1.75-weight grid, rendered through `icon()`. It lives
 * here rather than in `ICONS` because it is the only glyph in the package with
 * exactly one consumer, and `ICONS` is the shared table.
 */
const WIFI_OFF_ICON = [
  'M2 2l20 20',
  'M8.5 16.4a5 5 0 0 1 7 0',
  'M5 12.9a10 10 0 0 1 3.6-2.3',
  'M16.9 11.2A10 10 0 0 1 19 12.9',
  'M2 8.8a15 15 0 0 1 5.5-3.3',
  'M12.2 4.5a15 15 0 0 1 9.8 4.3',
  'M12 20h.01',
];

export interface OfflineBannerElement {
  readonly node: HTMLElement;

  /**
   * Shows the banner with `view`'s copy, or hides it when `view` is `null`.
   *
   * Safe to call on every state change: identical input is a no-op down to the
   * DOM write, which matters because this is driven from a store subscription
   * that fires on every message as well as every connection change. Rewriting
   * `textContent` on each of those would restart the announcement in a screen
   * reader mid-sentence — see the live region below.
   */
  update(view: OfflineBannerView | null): void;
}

/**
 * Builds the bar. Hidden until {@link OfflineBannerElement.update} says
 * otherwise — a widget that has never lost its connection must never flash one.
 */
export function createOfflineBanner(): OfflineBannerElement {
  const text = el('span', { attrs: { class: 'dh-offline-text' } });

  const node = el('div', {
    attrs: {
      class: 'dh-offline-banner',
      hidden: '',
      // `status`, not `alert`. An alert interrupts whatever a screen reader is
      // currently saying, and interrupting someone mid-message to tell them
      // their wifi dropped is the wrong trade — `status` is polite and waits
      // for a pause. `aria-live` is stated explicitly rather than left to the
      // role's implicit value, which some older combinations do not apply.
      role: 'status',
      'aria-live': 'polite',
    },
    children: [icon(WIFI_OFF_ICON, 18), text],
  });
  // The glyph duplicates the sentence beside it; naming it too would have a
  // screen reader announce the same fact twice.
  node.firstElementChild?.setAttribute('aria-hidden', 'true');

  let shownMessage: string | null = null;

  return {
    node,
    update(view) {
      if (view === null) {
        shownMessage = null;
        node.hidden = true;
        return;
      }

      // The tone drives colour only (see styles.ts). Set before the text so a
      // banner going from offline → unreachable never paints one frame of new
      // copy in the old colour.
      node.setAttribute('data-tone', view.tone);

      if (view.message !== shownMessage) {
        shownMessage = view.message;
        // `textContent` — this string is this package's own, but the composer
        // rule holds everywhere in this widget: nothing reaches the DOM as
        // markup.
        text.textContent = view.message;
      }

      node.hidden = false;
    },
  };
}
