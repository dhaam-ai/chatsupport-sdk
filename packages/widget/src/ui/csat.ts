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
// ── Where the score goes is the HOST's decision, not this module's ──────────
//
// This module takes a callback rather than owning the submit itself:
// `widget.ts`'s `syncProductSurfaces` wires `onSubmit` to core's
// `ChatClient.submitCsat`, which goes over `POST /chat/sessions/{id}/csat` —
// a real chat-service route that records the rating against the session (and,
// server-side, the session's linked support ticket) rather than a disguised
// chat message. Kept as a callback anyway, the same reason `onError` is:
// a survey that silently discards the answer if the host wired nothing up
// is worse than no survey, and this module has no business knowing chat-service's
// URL shape.

// ── Two cards, one factory: ask, or show what was already answered ─────────
//
// `POST /chat/sessions/{id}/csat` is an UPSERT server-side, so a survey shown
// over an already-rated session does not fail — it quietly replaces the score
// the customer gave. The widget therefore asks the server first
// (`ChatClient.getCsat`) and, when a rating comes back, builds this card in its
// LOCKED form: filled in, read-only, and with no submit control at all. That
// is the only shape in which a rated session can be shown its rating without
// also handing the customer a way to overwrite it.

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

/**
 * A rating this session ALREADY carries, read back from the server
 * (`ChatClient.getCsat`).
 *
 * Passing it builds the card in its locked, read-only form: the score is
 * filled in, nothing is clickable, and there is no submit — because
 * `POST /chat/sessions/{id}/csat` is an UPSERT, so a second survey over a
 * rated session does not fail loudly, it silently overwrites the score the
 * customer already gave. Withholding the controls is the only place that can
 * be prevented in this module.
 */
export interface CsatExistingRating {
  /** 1-5. */
  readonly rating: number;
  /** `null` when the customer left none. */
  readonly comment: string | null;
}

export interface CsatView {
  readonly node: HTMLElement;
  /** Renders the "thanks" state directly, for a thread already rated. */
  markSubmitted(): void;
  destroy(): void;
}

export function createCsatSurvey(
  style: CsatStyle,
  callbacks: CsatCallbacks,
  existing?: CsatExistingRating,
): CsatView {
  let score = 0;
  /** Read-only: this session was already rated. See {@link CsatExistingRating}. */
  const locked = existing !== undefined;

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

  // The comment the customer left last time, shown as text rather than in the
  // textarea above: a filled-in `<textarea>` reads as something still being
  // edited, which is the opposite of what a locked card is saying.
  const lockedComment = el('p', { attrs: { class: 'dh-csat-your-comment', hidden: true } });

  const form = el('form', {
    attrs: { class: 'dh-form dh-csat', novalidate: true },
    children: [heading, group, scaleLabel, lockedComment, commentRow],
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
    // Never in the locked card: `commentRow` carries the submit button, and a
    // rated session must have no way to send a second rating at all — not a
    // disabled button, which still invites the press.
    commentRow.hidden = locked || score === 0;
  }

  function choose(value: number): void {
    if (locked) return;
    score = value;
    paint();
  }

  function onKeydown(event: KeyboardEvent, index: number): void {
    if (locked) return;
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
    if (locked || score === 0) return;
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

  if (existing !== undefined) {
    // ── The locked, already-rated card ────────────────────────────────────
    //
    // `aria-readonly` on the group rather than `disabled` on the options: the
    // score is the whole point of this card, and a disabled control is skipped
    // by some screen-reader browse modes — locking the rating must not make it
    // unreadable. `aria-disabled` on each option says the same thing to a user
    // who lands on one anyway, and `choose`/`onKeydown` above are the actual
    // enforcement.
    score = existing.rating;
    node.setAttribute('data-locked', 'true');
    heading.textContent = 'Your rating';
    group.setAttribute('aria-readonly', 'true');
    for (const option of options) option.setAttribute('aria-disabled', 'true');
    const previous = existing.comment ?? '';
    lockedComment.textContent = previous;
    lockedComment.hidden = previous.trim() === '';
    // The same acknowledgement a just-submitted rating gets, for the same
    // reason — the customer needs to see that the score on screen is one the
    // server holds, not one they are being asked for again. Shown alongside
    // the (locked) scale rather than instead of it, which is why this is not
    // `markSubmitted()`: that hides the form, and hiding the form here would
    // hide the very rating this card exists to show.
    thanks.hidden = false;
  }

  paint();

  return { node, markSubmitted, destroy() {} };
}
