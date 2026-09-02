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
/**
 * How long the Copy item shows its outcome before the menu closes itself.
 *
 * Long enough to be read, short enough that the menu does not feel stuck.
 * The old flow closed the menu FIRST and then announced the outcome to a
 * visually-hidden live region only — which is why the reported bug reads
 * "tapping Copy gives no feedback": for a sighted user there was none.
 */
const COPY_OUTCOME_MS = 1200;

export function createMessageActions(callbacks: MessageActionsCallbacks): MessageActionsView {
  // The label is its own node so the outcome can swap the WORD without
  // rebuilding the button (which would drop focus mid-confirmation).
  const copyLabel = el('span', { text: 'Copy' });
  const copy = el('button', {
    attrs: { class: 'dh-msg-action', type: 'button' },
    children: [icon(ICONS.copy, 14), copyLabel],
    on: {
      click: () => {
        // Not closed here. The confirmation IS the label swapping in place,
        // so the menu has to stay open long enough to show it; `close()` is
        // the outcome timer's job now.
        if (outcomeTimer !== null || copy.disabled) return;
        copy.disabled = true;
        void callbacks
          .onCopy()
          .then(() => showCopyOutcome('Copied', 'ok'))
          // Clipboard access is refused outright in some browsers without a
          // permission the host page has not asked for. Saying so is better
          // than a button that silently does nothing.
          .catch(() => showCopyOutcome("Couldn't copy", 'failed'));
      },
    },
  });

  /** Pending auto-close after a copy outcome; cleared by `resetCopy`. */
  let outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  function showCopyOutcome(text: string, state: 'ok' | 'failed'): void {
    // Spoken as well as shown: the label swap is invisible to a screen
    // reader whose focus is elsewhere.
    announce(text);
    // The menu can already be gone — an outside click or Escape landed while
    // the clipboard promise was still pending, and `close()` ran `resetCopy`
    // against a still-plain label. Swapping the label NOW would strand
    // "Copied" on a closed menu for the next open to show about a different
    // moment, so the visual outcome is skipped and only the announcement
    // stands.
    if (menu.hidden) {
      resetCopy();
      return;
    }
    copyLabel.textContent = text;
    copy.setAttribute('data-outcome', state);
    outcomeTimer = setTimeout(() => {
      outcomeTimer = null;
      close();
    }, COPY_OUTCOME_MS);
  }

  /**
   * Back to a plain "Copy". Runs inside `close()` — after the menu is hidden,
   * so the restore is never visible — because every way the menu can go away
   * (outcome timer, outside click, Escape, row re-render) funnels through
   * `close()`, and a menu re-opened later must not still say "Copied" about a
   * different moment.
   */
  function resetCopy(): void {
    if (outcomeTimer !== null) {
      clearTimeout(outcomeTimer);
      outcomeTimer = null;
    }
    copy.disabled = false;
    copy.removeAttribute('data-outcome');
    copyLabel.textContent = 'Copy';
  }

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
    resetCopy();
  }

  // `composedPath()[0]`, not `event.target`: this listener lives on the
  // document, OUTSIDE the shadow tree, so a press on one of our own items is
  // retargeted and reports the shadow HOST as its target — which
  // `node.contains` rejects, closing the menu DURING the press and swallowing
  // the click a real pointer was producing (synthetic `.click()` dispatches
  // no pointerdown, which is how automation passed while a human failed).
  // Full story on header-menu.ts's onOutside; same cure as session-picker.ts.
  const onOutside = (event: Event): void => {
    const pressed = event.composedPath()[0] ?? event.target;
    if (!node.contains(pressed as Node)) close();
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
      // The outcome timer holds this row's closure alive and would fire
      // `close()` against a node already evicted from the log.
      resetCopy();
    },
  };
}
