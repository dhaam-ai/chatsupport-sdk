// "Common Questions" — the console configures a list of quick-tap questions
// (Chatbot → Behaviour → Common Questions) and, until now, nothing in this
// package ever read them: `remote-config.ts`'s `RemoteConfig` had no field
// for `behaviour.commonQuestions` at all, so a merchant filling that list in
// and publishing had no effect a customer could ever see. Confirmed against
// the actual wire payload — `GET /chat-services/api/v1/widget/config` sends
// `behaviour.commonQuestions` verbatim (it is inside the opaque `behaviour`
// blob chat-service stores and re-serves whole) — the gap was on this side.
//
// The reference for what this should look like is `reco-engine-react`'s
// `ChatHome` (`app/components/chat/home/ChatHome.tsx` +
// `resolveCommonQuestions` in `app/lib/chat/config.ts`): a row of chips shown
// before a conversation exists, each one sending its `prompt` as the first
// message when tapped. This is that surface, built to this package's own
// idioms (`el()`, no innerHTML — see `dom.ts`'s header) rather than ported
// from JSX.
//
// ── Rows, not chips ───────────────────────────────────────────────────────
//
// This shipped once as a wrapped row of pill-shaped `<button>`s
// (`border-radius: 999px`), which read as tags rather than as tappable
// questions and gave no affordance at all for "this opens something" — no
// chevron, no row boundary. Rebuilt as a `<ul>` of hairline-separated rows
// inside one bordered box, matching the two other list-style surfaces this
// package already ships: `ui/messages-screen.ts`'s `.dh-messages-row` (the
// border/radius/padding this box's OWN rule borrows) and `ui/home-screen.ts`'s
// two CTA rows, which are the one place already drawing exactly the trailing
// '›' this component now reuses (`.dh-home-chevron` — a plain character, not
// an SVG: this package's `ICONS` in `ui/dom.ts` has no dedicated chevron/arrow
// glyph, and home-screen.ts's own precedent is the closer match than
// inventing a new path set for one glyph).
//
// ── Where this stands, and where it does not ────────────────────────────
// Shown only when there is no conversation yet AND nothing else is gating
// the panel (`widget.ts`'s `syncScreens` is the one place that decides — see
// it for the exact rule). Once the customer sends any message, by tapping a
// row or by typing, the rows do not come back for that session: a customer
// who has already started talking does not need the starting prompts a
// second time.
//
// Unlike `reco-engine-react`'s `resolveCommonQuestions`, this does NOT fall
// back to a built-in default list when the console has configured none.
// That fallback exists there as a MOCKUP's placeholder content; a real widget
// with an empty `commonQuestions` array means the merchant has not written
// any, and inventing generic ones here would put words a merchant never
// approved in front of their customers.

import { el } from './dom.js';
import type { CommonQuestion } from '../remote-config.js';

export type { CommonQuestion };

export interface CommonQuestionsCallbacks {
  /**
   * The customer tapped one.
   *
   * This component sends nothing itself — see `widget.ts`'s wiring for why:
   * turning a tap into a visible conversation takes minting a session AND
   * navigating to it, both of which are the widget's job (`startNewSession`,
   * `showConversation`), not this presentational component's.
   */
  readonly onSelect: (question: CommonQuestion) => void;
}

export interface CommonQuestionsView {
  readonly node: HTMLElement;
}

export function createCommonQuestions(
  questions: readonly CommonQuestion[],
  callbacks: CommonQuestionsCallbacks,
): CommonQuestionsView {
  // `role="list"` stated explicitly, like `ui/messages-screen.ts`'s own list —
  // Safari/VoiceOver drops the implicit list role once `list-style` is styled
  // away, so restoring it here is not decoration.
  const node = el('ul', {
    attrs: { class: 'dh-common-questions', role: 'list', 'aria-label': 'Common questions' },
    children: questions.map((question) =>
      el('li', {
        attrs: { class: 'dh-common-question-item' },
        children: [
          el('button', {
            attrs: { class: 'dh-common-question-row', type: 'button' },
            children: [
              el('span', { attrs: { class: 'dh-common-question-label' }, text: question.label }),
              // Same glyph, same class, as `ui/home-screen.ts`'s two CTA rows —
              // one "this row opens something" affordance across the panel
              // rather than a second one invented here.
              el('span', { attrs: { class: 'dh-home-chevron', 'aria-hidden': 'true' }, text: '›' }),
            ],
            on: { click: () => callbacks.onSelect(question) },
          }),
        ],
      }),
    ),
  });

  return { node };
}
