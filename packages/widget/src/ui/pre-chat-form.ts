// "Ask for details before chatting" — the gate a merchant turns on with
// `preChatEnabled`, rendering the fields they defined in `preChatFields`.
//
// ── This is NOT a port of the React widget's GuestIdentityForm ───────────
//
// That component is a different feature wearing a similar shape, and reading
// it as this one produces the wrong thing. Its own header says so: it is
// "asked only once a guest's conversation actually needs a reply address —
// never as a gate in front of the first message", it appears from the
// customer's SECOND message onward, and its two fields are hardcoded. It
// never reads `preChatFields` at all; in that widget the console's fields are
// consumed only by the offline form.
//
// So this surface is built from the CONFIG CONTRACT rather than transcribed
// from a component: `preChatEnabled` gates it, `preChatFields` is the field
// list, and it stands in front of the conversation instead of interrupting
// one. Where the two overlap — a merchant who configured exactly "Your name"
// and "Email address" — the result is the same form, which is the point.
//
// ── Answers are content, not identity ────────────────────────────────────
//
// What comes back is a `Record<fieldId, answer>` of free text a customer
// typed. It is deliberately NOT assembled into an `IdentityProfile`: this
// package upserts a Contact only from `WidgetIdentity.profile`, which the HOST
// supplies for a user it has already authenticated. Promoting typed-in text to
// the same status would let anyone claim any email address by typing it into a
// storefront widget, which is the exact hole §14's key split exists to close.
//
// The caller decides what to do with the answers. See widget.ts.

import { el } from './dom.js';
import {
  createField,
  createStatusLine,
  createSubmitButton,
  firstMissingRequired,
  submitOnce,
} from './forms.js';
import type { FieldSpec, FieldView } from './forms.js';

export type PreChatAnswers = Readonly<Record<string, string>>;

export interface PreChatFormCallbacks {
  /** Resolves when the conversation may start. Rejecting keeps the form up. */
  readonly onSubmit: (answers: PreChatAnswers) => Promise<void>;
  /** The customer declined to fill it in. Only offered when nothing is required. */
  readonly onSkip: () => void;
  readonly onError: (error: unknown) => void;
}

export interface PreChatFormView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createPreChatForm(
  fields: readonly FieldSpec[],
  callbacks: PreChatFormCallbacks,
  greeting?: string,
): PreChatFormView {
  const heading = el('h3', {
    attrs: { class: 'dh-form-heading', id: 'dh-prechat-form-heading' },
    // The merchant's configured greeting when there is one: they wrote it to
    // be the first thing a customer reads, and this screen is now that place.
    text: greeting ?? 'Before we start',
  });
  const subtitle = el('p', {
    attrs: { class: 'dh-form-subtitle' },
    text: 'A few details so we can help you faster.',
  });

  const views = fields.map((spec) => ({ spec, view: createField(spec, 'dh-prechat') }));
  const status = createStatusLine();
  const submit = createSubmitButton('Start chat', 'Starting…');

  // Offered only when nothing is required. A skip link next to a required
  // field is a contradiction — it tells the customer the merchant's mandatory
  // question is optional after all, and whichever answer they get is wrong.
  const anyRequired = views.some((field) => field.spec.required);
  const skip = anyRequired
    ? null
    : el('button', {
        attrs: { class: 'dh-form-skip', type: 'button' },
        text: 'Skip for now',
        on: { click: () => callbacks.onSkip() },
      });

  const form = el('form', {
    attrs: { class: 'dh-form dh-prechat-form', 'aria-labelledby': 'dh-prechat-form-heading', novalidate: true },
    children: [
      heading,
      subtitle,
      ...views.map((field) => field.view.node),
      status.node,
      submit.node,
      ...(skip === null ? [] : [skip]),
    ],
    on: {
      submit: (event) => {
        event.preventDefault();
        void run();
      },
    },
  });

  async function run(): Promise<void> {
    const missing = firstMissingRequired(views);
    if (missing !== null) {
      // Names the field rather than saying "fill in the fields above", and
      // moves focus to it: on a six-field form the generic sentence is a
      // scavenger hunt.
      status.show(`${missing.spec.label} is required.`);
      missing.view.input.focus({ preventScroll: true });
      return;
    }

    const answers: Record<string, string> = {};
    for (const { spec, view } of views) {
      const value = view.value();
      // Empty optional answers are omitted rather than sent as `''` — an
      // absent key and a blank one mean different things to whatever stores
      // this, and only one of them is true.
      if (value !== '') answers[spec.id] = value;
    }

    await submitOnce(() => callbacks.onSubmit(answers), {
      button: submit,
      status,
      failureMessage: 'We could not start the chat. Please try again.',
      onError: callbacks.onError,
    });
  }

  return {
    node: form,
    focus() {
      const target = views[0]?.view.input ?? submit.node;
      target.focus({ preventScroll: true });
    },
    destroy() {
      // Nothing document-level to release: every listener above is on a node
      // inside `form`, which the caller removes.
    },
  };
}
