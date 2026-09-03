// "Report an issue" — a form that files a real ticket without a conversation.
//
// The point of the form is that it is NOT a chat: a customer who already knows
// what went wrong should not have to talk their way to a ticket. So it stands
// in place of the transcript like the pre-chat and out-of-hours forms do,
// rather than opening as a modal over it — this widget has one surface slot
// and three forms that share it (`openSurface` in widget.ts), and a fourth
// pattern for the fourth form would be a pattern for its own sake.
//
// ── Why so few fields ────────────────────────────────────────────────────
//
// Subject and details, and nothing else required. The customer is already
// authenticated — the route resolves their email from the session's own record
// when the form does not supply one — so asking for contact details a second
// time is asking them to retype something the system already knows. The email
// field exists only for the case where they want the reply somewhere else.
//
// Attachments are deliberately absent for now: the route accepts attachment
// METADATA, but this widget has no way to upload the bytes anywhere the ticket
// system can read them. A file input that silently discarded the file would be
// worse than no file input.

import { el } from './dom.js';
import {
  createField,
  createStatusLine,
  createSubmitButton,
  firstMissingRequired,
  submitOnce,
} from './forms.js';
import type { FieldSpec } from './forms.js';

/** What the route accepts. `contactEmail` is optional — see the header. */
export interface IssueReport {
  readonly subject: string;
  readonly details: string;
  readonly contactEmail?: string;
}

export interface ReportIssueCallbacks {
  /** Files the report. Rejects on failure — the form shows its own message. */
  readonly onSubmit: (report: IssueReport) => Promise<void>;
  /** The customer backing out without filing anything. */
  readonly onCancel: () => void;
  readonly onError: (error: unknown) => void;
}

export interface ReportIssueView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

const FIELDS: readonly FieldSpec[] = [
  { id: 'subject', label: 'What went wrong?', type: 'text', required: true },
  { id: 'contactEmail', label: 'Reply to a different email (optional)', type: 'email', required: false },
];

export function createReportIssueForm(callbacks: ReportIssueCallbacks): ReportIssueView {
  const heading = el('h3', {
    attrs: { class: 'dh-form-heading', id: 'dh-report-heading' },
    text: 'Report an issue',
  });
  const subtitle = el('p', {
    attrs: { class: 'dh-form-subtitle' },
    text: 'Tell us what happened and we will open a ticket.',
  });

  const views = FIELDS.map((spec) => ({ spec, view: createField(spec, 'dh-report') }));

  // A textarea rather than a `FieldSpec`, because `createField` builds single
  // line inputs and the whole value of this form is the room to explain. Given
  // the same classes so it inherits the shared form styling rather than
  // needing its own.
  const details = el('textarea', {
    attrs: {
      class: 'dh-field-input dh-report-details',
      id: 'dh-report-details',
      rows: '4',
      'aria-label': 'What happened',
      placeholder: 'What happened, and what did you expect instead?',
    },
  });
  const detailsField = el('div', {
    attrs: { class: 'dh-field' },
    children: [
      el('label', {
        attrs: { class: 'dh-field-label', for: 'dh-report-details' },
        text: 'Details',
      }),
      details,
    ],
  });

  const status = createStatusLine();
  const submit = createSubmitButton('Send report', 'Sending…');
  const cancel = el('button', {
    attrs: { class: 'dh-form-skip', type: 'button' },
    text: 'Cancel',
    on: { click: () => callbacks.onCancel() },
  });

  // A confirmation, not a toast: the form is replaced by it, so there is no
  // way to file the same report twice by pressing the button again.
  //
  // It carries its own way out, and that is not politeness. This surface
  // stands IN PLACE OF the transcript, and `syncProductSurfaces` never
  // preempts a surface the customer opened — so a confirmation with no
  // button hands the slot back to nobody: the transcript and composer stay
  // hidden, and with an empty back stack (a host-supplied `sessionId`, whose
  // panel opens straight on the conversation) there is no Back either, and
  // the only way out of the widget is a page reload. `onCancel` rather than
  // a second callback, because the job it does is the same one Cancel does —
  // hand the slot back and return to the screen this was opened from.
  const dismiss = el('button', {
    attrs: { class: 'dh-form-skip dh-report-done-dismiss', type: 'button' },
    text: 'Done',
    on: { click: () => callbacks.onCancel() },
  });
  const done = el('div', {
    attrs: { class: 'dh-form-done', hidden: true, role: 'status' },
    children: [
      el('p', { attrs: { class: 'dh-form-heading' }, text: 'Report sent' }),
      el('p', {
        attrs: { class: 'dh-form-subtitle' },
        // No ticket reference is quoted. The route does not return one, and
        // inventing a reassuring "we'll be in touch shortly" that nothing
        // guarantees is the kind of small dishonesty this package avoids.
        text: 'Our team has it and will follow up by email.',
      }),
      el('div', { attrs: { class: 'dh-form-actions' }, children: [dismiss] }),
    ],
  });

  const form = el('div', {
    attrs: { class: 'dh-form dh-report-form' },
    children: [
      heading,
      subtitle,
      ...views.map((f) => f.view.node),
      detailsField,
      status.node,
      el('div', { attrs: { class: 'dh-form-actions' }, children: [submit.node, cancel] }),
    ],
  });

  const node = el('div', {
    attrs: { role: 'group', 'aria-labelledby': 'dh-report-heading' },
    children: [form, done],
  });

  submit.node.addEventListener('click', () => {
    const missing = firstMissingRequired(views);
    if (missing !== null) {
      status.show(`${missing.spec.label} is required.`);
      missing.view.input.focus();
      return;
    }
    const detailsText = details.value.trim();
    if (detailsText === '') {
      status.show('Details are required.');
      details.focus();
      return;
    }

    const email = views.find((f) => f.spec.id === 'contactEmail')!.view.value();
    void submitOnce(
      () =>
        callbacks.onSubmit({
          subject: views.find((f) => f.spec.id === 'subject')!.view.value(),
          details: detailsText,
          // Omitted rather than sent empty: the route treats an ABSENT email
          // as "use the address already on file", and `''` would fail its own
          // `.email()` check for no reason.
          ...(email === '' ? {} : { contactEmail: email }),
        }),
      {
        button: submit,
        status,
        failureMessage: "We couldn't send that report. Please try again.",
        onError: callbacks.onError,
      },
    ).then((ok) => {
      if (!ok) return;
      form.hidden = true;
      done.hidden = false;
      // Focus follows the content that replaced what it was on: the submit
      // button the customer just pressed is now inside a `hidden` subtree,
      // and focus left on a hidden element falls back to the host page's
      // body — which is how the panel's own Escape handler stops receiving
      // keys. The same rule widget.ts's `focusOnOpen` states.
      dismiss.focus({ preventScroll: true });
    });
  });

  return {
    node,
    focus() {
      views[0]?.view.input.focus();
    },
    destroy() {
      // Nothing document-level to release — every listener here is on a node
      // inside `node`, and goes with it.
    },
  };
}
