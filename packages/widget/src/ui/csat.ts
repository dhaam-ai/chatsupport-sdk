// The post-resolution rating.
//
// Two presentations, because that is exactly what the console offers:
// `csatStyle: 'stars' | 'emoji'`. There is no thumbs style and no numeric/NPS
// style — the thumbs pair in the React widget belongs to the card that ASKS
// whether the issue was resolved, which is the gate in front of this, not a
// rating scale.
//
// Both are 1-5. The only difference is how the scale reads:
//   stars — CUMULATIVE. Picking 4 fills 1..4, because a star rating is
//           "this many out of five".
//   emoji — SINGULAR. Picking 4 lights only the fourth face, because the faces
//           are five different answers to one question, not a quantity. A
//           "cumulative" row of faces would claim the customer felt every mood
//           up to and including the one they chose.
//
// ── There is no server endpoint for this yet ─────────────────────────────
//
// chat-service has no CSAT route, and the React widget's `submitCsat` is a
// mock that mutates local state. So this module takes a callback and the host
// decides where the score goes. That is stated rather than hidden: a survey
// that silently discards the answer is worse than no survey.

import { el } from './dom.js';
import { createStatusLine, createSubmitButton, submitOnce } from './forms.js';

export type CsatStyle = 'stars' | 'emoji';

/** Lowest to highest. Index 0 is a score of 1. */
const LABELS = ['Poor', 'Not great', 'Okay', 'Good', 'Excellent'] as const;
const FACES = ['😞', '🙁', '😐', '🙂', '😄'] as const;
const STAR_FILLED = '★';
const STAR_EMPTY = '☆';

const MAX_SCORE = 5;

export interface CsatCallbacks {
  readonly onSubmit: (score: number, comment?: string) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export interface CsatView {
  readonly node: HTMLElement;
  /** Renders the "thanks" state directly, for a thread already rated. */
  markSubmitted(): void;
  destroy(): void;
}

export function createCsatSurvey(style: CsatStyle, callbacks: CsatCallbacks): CsatView {
  let score = 0;

  const heading = el('h3', {
    attrs: { class: 'dh-form-heading', id: 'dh-csat-heading' },
    text: 'How was your support experience?',
  });

  // A radio GROUP, not a row of buttons: five mutually exclusive answers to
  // one question is precisely what a radiogroup is, and it gets arrow-key
  // navigation and "4 of 5" announcements from the platform rather than from
  // code here. The React original uses buttons with `aria-pressed`, which
  // tells a screen reader these are five independent toggles.
  const options = Array.from({ length: MAX_SCORE }, (_unused, index) => {
    const value = index + 1;
    const glyph = el('span', {
      attrs: { class: 'dh-csat-glyph', 'aria-hidden': 'true' },
      // `?? STAR_EMPTY` only satisfies noUncheckedIndexedAccess — `index` is
      // bounded by MAX_SCORE and both arrays have exactly that many entries.
      text: style === 'emoji' ? (FACES[index] ?? STAR_EMPTY) : STAR_EMPTY,
    });
    return el('button', {
      attrs: {
        class: 'dh-csat-option',
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${value} of ${MAX_SCORE} — ${LABELS[index]}`,
        tabindex: index === 0 ? '0' : '-1',
      },
      children: [glyph],
      on: {
        click: () => choose(value),
        keydown: (event) => onKeydown(event as KeyboardEvent, index),
      },
    });
  });

  const group = el('div', {
    attrs: { class: `dh-csat-scale dh-csat-${style}`, role: 'radiogroup', 'aria-labelledby': 'dh-csat-heading' },
    children: options,
  });

  // Fixed height so the card does not jump the moment a rating is picked —
  // the same reason the React original reserves `h-4` here.
  const scaleLabel = el('p', { attrs: { class: 'dh-csat-label' }, text: '' });

  const commentLabel = el('label', {
    attrs: { class: 'dh-sr', for: 'dh-csat-comment' },
    text: 'Tell us more',
  });
  const comment = el('textarea', {
    attrs: {
      class: 'dh-field-input',
      id: 'dh-csat-comment',
      rows: '2',
      placeholder: 'Tell us more (optional)',
    },
  });

  const status = createStatusLine();
  const submit = createSubmitButton('Submit feedback', 'Sending…');

  // Both stay hidden until a score exists: there is nothing to submit before
  // one, and an enabled Submit next to an unrated scale invites a click that
  // can only be refused.
  const commentRow = el('div', {
    attrs: { class: 'dh-csat-comment', hidden: true },
    children: [commentLabel, comment, status.node, submit.node],
  });

  const thanks = el('p', {
    attrs: { class: 'dh-csat-thanks', role: 'status', hidden: true },
    text: 'Thanks for your feedback!',
  });

  const form = el('form', {
    attrs: { class: 'dh-form dh-csat', novalidate: true },
    children: [heading, group, scaleLabel, commentRow],
    on: {
      submit: (event) => {
        event.preventDefault();
        void run();
      },
    },
  });

  const node = el('div', { attrs: { class: 'dh-csat-card' }, children: [form, thanks] });

  function paint(): void {
    options.forEach((option, index) => {
      const value = index + 1;
      // The whole difference between the two styles, in one predicate.
      const lit = style === 'emoji' ? value === score : value <= score;
      option.setAttribute('aria-checked', value === score ? 'true' : 'false');
      option.setAttribute('tabindex', value === score || (score === 0 && index === 0) ? '0' : '-1');
      option.classList.toggle('dh-csat-lit', lit);
      const glyph = option.firstElementChild;
      if (glyph !== null && style === 'stars') glyph.textContent = lit ? STAR_FILLED : STAR_EMPTY;
    });
    scaleLabel.textContent = score === 0 ? '' : (LABELS[score - 1] ?? '');
    commentRow.hidden = score === 0;
  }

  function choose(value: number): void {
    score = value;
    paint();
  }

  function onKeydown(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    // Clamped, not wrapping — unlike the emoji grid. A rating scale has a
    // real low end and a real high end, and wrapping from "Excellent" round
    // to "Poor" would let a customer set the opposite of what they meant with
    // one extra keypress.
    const next = Math.min(MAX_SCORE, Math.max(1, index + 1 + delta));
    choose(next);
    options[next - 1]?.focus({ preventScroll: true });
  }

  async function run(): Promise<void> {
    if (score === 0) return;
    const text = comment.value.trim();
    const sent = await submitOnce(
      () => callbacks.onSubmit(score, text === '' ? undefined : text),
      {
        button: submit,
        status,
        failureMessage: 'We could not send your feedback. Please try again.',
        onError: callbacks.onError,
      },
    );
    if (sent) markSubmitted();
  }

  function markSubmitted(): void {
    form.hidden = true;
    thanks.hidden = false;
  }

  paint();

  return { node, markSubmitted, destroy() {} };
}
