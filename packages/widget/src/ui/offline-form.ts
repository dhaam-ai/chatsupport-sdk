// The out-of-hours form: leave a message when the team is closed.
//
// Reached only when the server says so. `isOpenNow === false` AND
// `offlineMode === COLLECT_MESSAGE` — see remote-config.ts's
// `shouldCollectOffline`. The other two modes never get here: SHOW_MESSAGE
// leaves the composer alone and says we are closed, and HIDE_WIDGET never
// mounted a launcher.
//
// ── Business hours are the server's to decide ────────────────────────────
//
// This module receives a boolean. It never sees a schedule, a timezone or a
// day/time range, and must not start: the merchant's calendar lives in the
// console, the widget runs on a customer's device with a clock the customer
// controls, and "are you open" computed on that device is a guess that
// disagrees with the answer the agent sees. chat-service resolves it and
// publishes `isOpenNow`; the same split the React widget keeps.
//
// ── Custom fields are flattened into the message, on purpose ─────────────
//
// Whatever a merchant configured in `preChatFields` is appended to the body as
// "Label: value" lines rather than sent as structured data. There is no
// structured place for them to go — the offline path produces a message a
// human reads, not a record with a schema — and a merchant who added "Order
// number" wants to SEE the order number in the message, not have it dropped
// because no column matched. Same choice the React widget makes.

import { el } from './dom.js';
import {
  createField,
  createStatusLine,
  createSubmitButton,
  submitOnce,
} from './forms.js';
import type { FieldSpec } from './forms.js';

/** The four flat strings the offline path produces. */
export interface OfflineMessage {
  readonly name: string;
  readonly contact: string;
  /** The typed message, with any custom-field answers appended. */
  readonly message: string;
}

export interface OfflineFormCallbacks {
  readonly onSubmit: (message: OfflineMessage) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export interface OfflineFormView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

/** Name and contact are always asked; the merchant's fields come after. */
const NAME_FIELD: FieldSpec = { id: 'name', label: 'Name', type: 'text', required: true };
const CONTACT_FIELD: FieldSpec = {
  id: 'contact',
  label: 'Email or phone',
  type: 'email',
  required: true,
};

/**
 * Console fields that duplicate the two built-ins above.
 *
 * The console seeds every workspace with "Your name" and "Email address", so
 * without this every merchant who never touched their pre-chat settings gets a
 * form asking for a name twice. Anchored and case-insensitive, matching the
 * seeded labels exactly rather than by substring — a merchant's "Name of the
 * product you ordered" must survive.
 */
const BUILT_IN_LABEL = /^(name|your name|email|email address|phone|contact|contact details)$/i;

const MIN_MESSAGE_LENGTH = 4;

export function createOfflineForm(
  extraFields: readonly FieldSpec[],
  callbacks: OfflineFormCallbacks,
  offlineMessage?: string,
): OfflineFormView {
  const banner = el('div', {
    attrs: { class: 'dh-offline-banner' },
    children: [
      el('p', { attrs: { class: 'dh-form-heading' }, text: "We're currently offline." }),
      el('p', {
        attrs: { class: 'dh-form-subtitle' },
        text: offlineMessage ?? "Leave us a message and we'll get back to you.",
      }),
    ],
  });

  const name = createField(NAME_FIELD, 'dh-offline');
  const contact = createField(CONTACT_FIELD, 'dh-offline');

  const custom = extraFields
    .filter((spec) => !BUILT_IN_LABEL.test(spec.label.trim()))
    .map((spec) => ({ spec, view: createField(spec, 'dh-offline') }));

  const messageLabel = el('label', {
    attrs: { class: 'dh-field-label', for: 'dh-offline-message' },
    text: 'How can we help?',
  });
  const message = el('textarea', {
    attrs: { class: 'dh-field-input dh-offline-message', id: 'dh-offline-message', rows: '4' },
  });

  const status = createStatusLine();
  const submit = createSubmitButton('Send message', 'Sending…');

  const form = el('form', {
    attrs: { class: 'dh-form dh-offline-form', 'aria-labelledby': 'dh-offline-heading', novalidate: true },
    children: [
      banner,
      name.node,
      contact.node,
      ...custom.map((field) => field.view.node),
      el('div', { attrs: { class: 'dh-field' }, children: [messageLabel, message] }),
      status.node,
      submit.node,
    ],
    on: {
      submit: (event) => {
        event.preventDefault();
        void run();
      },
    },
  });
  banner.querySelector('.dh-form-heading')?.setAttribute('id', 'dh-offline-heading');

  // The confirmation replaces the form rather than sitting above it: the form
  // is spent once it has been sent, and leaving it on screen invites a second
  // identical message from a customer who is not sure the first one landed.
  const confirmation = el('div', {
    attrs: { class: 'dh-offline-sent', role: 'status', hidden: true },
    children: [
      el('p', { attrs: { class: 'dh-form-heading' }, text: 'Message received' }),
      el('p', { attrs: { class: 'dh-form-subtitle' } }),
    ],
  });

  const node = el('div', { attrs: { class: 'dh-offline' }, children: [form, confirmation] });

  function firstProblem(): { message: string; focus: HTMLElement } | null {
    if (name.value() === '') return { message: 'Please add your name.', focus: name.input };
    if (contact.value() === '') {
      return { message: 'Please add an email or phone number so we can reply.', focus: contact.input };
    }
    for (const field of custom) {
      if (field.spec.required && field.view.value() === '') {
        return { message: `${field.spec.label} is required.`, focus: field.view.input };
      }
    }
    if (message.value.trim().length < MIN_MESSAGE_LENGTH) {
      return { message: 'Please tell us a little about what you need.', focus: message };
    }
    return null;
  }

  async function run(): Promise<void> {
    const problem = firstProblem();
    if (problem !== null) {
      status.show(problem.message);
      problem.focus.focus({ preventScroll: true });
      return;
    }

    const answered = custom.filter((field) => field.view.value() !== '');
    const body = [
      message.value.trim(),
      ...answered.map((field) => `${field.spec.label}: ${field.view.value()}`),
    ].join('\n\n');

    const sent = await submitOnce(
      () => callbacks.onSubmit({ name: name.value(), contact: contact.value(), message: body }),
      {
        button: submit,
        status,
        failureMessage: 'We could not send that. Please try again.',
        onError: callbacks.onError,
      },
    );

    if (!sent) return;
    const echo = confirmation.querySelector('.dh-form-subtitle');
    if (echo !== null) {
      echo.textContent = `We'll reply to ${contact.value()} as soon as the team is back online.`;
    }
    form.hidden = true;
    confirmation.hidden = false;
    // Focus follows the surface. Leaving it on the now-hidden submit button
    // would strand a keyboard customer on an element that no longer exists to
    // them, with no announcement that anything happened.
    confirmation.setAttribute('tabindex', '-1');
    confirmation.focus({ preventScroll: true });
  }

  return {
    node,
    focus() {
      (form.hidden ? confirmation : name.input).focus({ preventScroll: true });
    },
    destroy() {
      // No document-level listeners; every listener is on a node inside `node`.
    },
  };
}
