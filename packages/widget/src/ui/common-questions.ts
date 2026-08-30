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
// ── Where this stands, and where it does not ────────────────────────────
// Shown only when there is no conversation yet AND nothing else is gating
// the panel (`widget.ts`'s `syncCommonQuestions` is the one place that
// decides — see it for the exact rule). Once the customer sends any message,
// by tapping a chip or by typing, the chips do not come back for that
// session: a customer who has already started talking does not need the
// starting prompts a second time.
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
  /** The customer tapped one. Sends `prompt` as their first message. */
  readonly onSelect: (question: CommonQuestion) => void;
}

export interface CommonQuestionsView {
  readonly node: HTMLElement;
}

export function createCommonQuestions(
  questions: readonly CommonQuestion[],
  callbacks: CommonQuestionsCallbacks,
): CommonQuestionsView {
  const node = el('div', {
    attrs: { class: 'dh-common-questions', role: 'group', 'aria-label': 'Common questions' },
    children: questions.map((question) =>
      el('button', {
        attrs: { class: 'dh-common-question-chip', type: 'button' },
        text: question.label,
        on: { click: () => callbacks.onSelect(question) },
      }),
    ),
  });

  return { node };
}
