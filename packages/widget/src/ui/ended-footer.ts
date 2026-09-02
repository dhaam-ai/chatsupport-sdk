// The ended-conversation footer — "Reopen" and "New conversation", shown
// where the composer sits once a session has gone CLOSED/RESOLVED and there
// is nothing else standing in for it.
//
// ── The gap this closes ───────────────────────────────────────────────────
//
// `widget.ts`'s `syncProductSurfaces` already handles a session ending: it
// puts a CSAT survey in place of the conversation, once, for a thread that
// had messages. But that is a ONE-TIME surface — the moment it is submitted
// (`ratedSessionId` is set) or was never due (an empty thread, or a session
// already rated on an earlier visit), nothing replaces it. The composer was
// left fully visible and enabled: `syncComposer`'s `closedSessionId` gate
// only ever gets set by THIS tab's own `sessionClosed` event (an agent
// ending the live conversation, or `endConversation()` below), so a
// terminal session reached any other way — a Messages-screen row, a page
// reload landing back on an old conversation, a rating that just landed —
// left a customer able to type into a dead thread and watch the send go
// nowhere.
//
// This module is what fills that gap, and `widget.ts`'s `syncScreens` is
// what decides exactly when: CLOSED/RESOLVED, and the CSAT survey is not (or
// no longer) due. See that function's own comment for the precedence in
// full — it deliberately mirrors `syncProductSurfaces`'s CSAT-due check
// rather than diverging from it.
//
// ── Why this is a footer beside the composer, not a fourth `ProductSurface`
//
// The three data-collecting surfaces (`ui/offline-form.ts`, `ui/pre-chat-
// form.ts`, `ui/csat.ts`) and the "new conversation" screen all stand in for
// the WHOLE conversation — transcript and composer both — because a form and
// the history behind it are alternatives, never both on screen at once. This
// is a different situation: the customer is looking at their OWN past
// conversation and deciding what to do with it, and hiding that transcript
// to show two buttons would take away the very thing being decided about.
// So `widget.ts` mounts this as a sibling of the composer instead, and only
// the two of them ever trade places — same "one at a time" rule, applied one
// level lower, at the composer's own seam rather than the whole pane's.
//
// ── "Reopen" reaching the real backend ────────────────────────────────────
//
// `onReopen` is expected to call `store.client.reopenSession(sessionId)`
// (core's `ChatClient.reopenSession`, backed by the real
// `POST /chat/sessions/{id}/reopen`) — never a client-side-only re-enable.
// This module does not know the session id or the client; `widget.ts` owns
// both, so the callback is where that call lives. What THIS module owns is
// the request's UX: `submitOnce`/`createStatusLine` (`ui/forms.ts`) already
// generalize "disable the button, clear the error, show one on failure,
// always come back to life" — the exact bug class the offline form, the
// pre-chat form and the CSAT survey all had before that module existed (see
// its own header) — so this reuses it rather than writing a fourth, possibly
// different, copy of the same three lines. On success there is nothing left
// to do here: `reopenSession` commits the resolved session through the same
// path `closeSession` does, and the reactive subscriptions already wired in
// `widget.ts` (the `state.session` id/status selector, `syncProductSurfaces`)
// repaint the panel — the identical path that already restores the composer
// once a CSAT rating lands.

import { el } from './dom.js';
import { createStatusLine, createSubmitButton, submitOnce } from './forms.js';

export interface EndedFooterCallbacks {
  /** "Reopen" was pressed. Expected to call the real `reopenSession` endpoint. */
  readonly onReopen: () => Promise<void>;
  /**
   * "New conversation" was pressed. Never built here — this fires the ONE
   * new-conversation flow every other entry point already funnels through
   * (`widget.ts`'s `openNewConversationFlow`; see that function's own
   * comment for the full list of callers this joins).
   */
  readonly onStartNew: () => void;
  /** A `reopenSession` rejection, for the host's own error channel — never shown to the customer verbatim. */
  readonly onError: (error: unknown) => void;
}

export interface EndedFooterView {
  readonly node: HTMLElement;
  destroy(): void;
}

export function createEndedFooter(callbacks: EndedFooterCallbacks): EndedFooterView {
  const status = createStatusLine();

  const reopen = createSubmitButton('Reopen conversation', 'Reopening…');
  // Not `type="submit"` behaviour by accident: there is no `<form>` here, so
  // `createSubmitButton`'s `type="submit"` attribute never has anything to
  // submit to and this is a plain click, same as every other button in this
  // footer.
  reopen.node.addEventListener('click', () => void run());

  const startNew = el('button', {
    attrs: { class: 'dh-ended-secondary', type: 'button' },
    text: 'New conversation',
    on: { click: () => callbacks.onStartNew() },
  });

  const node = el('div', {
    attrs: { class: 'dh-ended-footer', role: 'group', 'aria-label': 'This conversation has ended' },
    children: [
      status.node,
      el('div', { attrs: { class: 'dh-ended-actions' }, children: [reopen.node, startNew] }),
    ],
  });

  async function run(): Promise<void> {
    // The secondary action is disabled for the span of the request too — a
    // press that starts a brand new conversation while a reopen of THIS one
    // is still in flight would leave the in-flight reopen's outcome (success
    // or a status line) landing on a footer the customer has already moved
    // away from.
    startNew.disabled = true;
    await submitOnce(callbacks.onReopen, {
      button: reopen,
      status,
      failureMessage: 'We could not reopen this conversation. Please try again.',
      onError: callbacks.onError,
    });
    startNew.disabled = false;
  }

  return {
    node,
    destroy() {
      // No document-level listeners; every listener is on a node inside `node`.
    },
  };
}
