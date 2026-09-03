// "End this conversation?" — the in-widget confirmation that stands in for
// the transcript while the customer decides, exactly like the other product
// surfaces (ui/report-issue.ts, ui/new-conversation.ts) already do.
//
// ── Why this exists instead of `globalThis.confirm` ─────────────────────────
//
// The ⋯ menu's "End conversation" used to ask through the browser's own
// `confirm()`. That is the HOST PAGE's modal, not the widget's: it renders
// in the browser's chrome with the browser's copy style, it is suppressed
// outright by some embedded/kiosk browsers and by any host that has already
// overridden `window.confirm`, and it is unstyleable — so on the one page the
// widget is meant to disappear into, the one dialog it ever raised looked
// like it belonged to somebody else. This module puts the question inside
// the shadow root, in the slot every other form already uses.
//
// ── What happens after "End conversation" is NOT this module's business ────
//
// `onConfirm` is expected to call core's `closeSession` and then release this
// surface; whatever follows — the CSAT survey `widget.ts`'s
// `syncProductSurfaces` raises for a thread that had messages, or the ended
// footer for one that did not — is the SAME path an agent-side close already
// takes. This module only asks the question and reports the answer.
//
// ── Two buttons, one destructive ──────────────────────────────────────────
//
// The destructive action is the `createSubmitButton` so it inherits the
// busy/failure contract every other commit action in this package has
// (`submitOnce`, ui/forms.ts): a close that rejects re-enables the button
// and says so, rather than leaving "Ending…" up forever. It is coloured with
// the same `--dh-danger` token the menu item that opened this already uses,
// so the tap that got here and the tap that commits read as the same act.
// "Keep chatting" is the safe way out and is where `focus()` lands — a
// keyboard user who arrived by mistake should have to move to destroy
// something, not to keep it.

import { el } from './dom.js';
import { createStatusLine, createSubmitButton, submitOnce } from './forms.js';

export interface EndConversationCallbacks {
  /** Ends the conversation. Rejecting keeps this surface up with a message. */
  readonly onConfirm: () => Promise<void>;
  /** The customer changed their mind. */
  readonly onCancel: () => void;
  readonly onError: (error: unknown) => void;
}

export interface EndConversationView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createEndConversationConfirm(callbacks: EndConversationCallbacks): EndConversationView {
  const heading = el('h3', {
    attrs: { class: 'dh-form-heading', id: 'dh-confirm-end-heading' },
    text: 'End this conversation?',
  });
  const subtitle = el('p', {
    attrs: { class: 'dh-form-subtitle' },
    text: 'You can always start a new one from Home or Messages.',
  });

  const status = createStatusLine();
  const confirm = createSubmitButton('End conversation', 'Ending…');
  // Layered on top of `.dh-form-submit` rather than replacing it, so the
  // button keeps the size and busy treatment of every other commit action
  // and only its colour says "this one destroys something".
  confirm.node.classList.add('dh-confirm-end-danger');
  // There is no `<form>` here, so `createSubmitButton`'s `type="submit"` has
  // nothing to submit to and this is a plain click — same note
  // ui/ended-footer.ts makes about its own Reopen button.
  confirm.node.addEventListener('click', () => void run());

  const keep = el('button', {
    attrs: { class: 'dh-confirm-end-keep', type: 'button' },
    text: 'Keep chatting',
    on: { click: () => callbacks.onCancel() },
  });

  const node = el('div', {
    attrs: { role: 'group', 'aria-labelledby': 'dh-confirm-end-heading' },
    children: [
      el('div', {
        attrs: { class: 'dh-form dh-confirm-end' },
        children: [
          heading,
          subtitle,
          status.node,
          el('div', { attrs: { class: 'dh-confirm-end-actions' }, children: [confirm.node, keep] }),
        ],
      }),
    ],
  });

  async function run(): Promise<void> {
    // "Keep chatting" is disabled for the span of the request too: a cancel
    // that lands while the close is in flight would tear this surface down
    // under a request whose outcome (success, or the failure line) still has
    // to land somewhere — same reasoning ui/ended-footer.ts gives for
    // disabling its own secondary action during a reopen.
    keep.disabled = true;
    await submitOnce(callbacks.onConfirm, {
      button: confirm,
      status,
      failureMessage: "We couldn't end this conversation. Please try again.",
      onError: callbacks.onError,
    });
    keep.disabled = false;
  }

  return {
    node,
    focus() {
      keep.focus({ preventScroll: true });
    },
    destroy() {
      // Nothing document-level to release — every listener here is on a node
      // inside `node`, and goes with it. Same note new-conversation.ts makes.
    },
  };
}
