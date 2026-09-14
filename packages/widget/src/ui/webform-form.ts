// The web-form surface: an anonymous visitor leaving a message.
//
// Reached from two directions — see `widget.ts`'s `openWebform` and the
// gate-1 carve-out in `syncProductSurfaces` — but built here exactly once,
// the same "one surface, several openers" shape `ui/offline-form.ts` and
// `ui/report-issue.ts` already use.
//
// ── This is NOT `ui/report-issue.ts` ─────────────────────────────────────
//
// That form files a ticket FROM INSIDE an authenticated conversation, against
// a `sessionId`. This one is for a visitor who never started a conversation
// and holds no session — the route resolves the tenant from the publishable
// key alone (`docs/design/DECISIONS.md` D3) and never mints one. They share
// `ui/forms.ts` and nothing else.
//
// ── The honeypot ──────────────────────────────────────────────────────────
//
// `company_website`, fixed by the server's schema. A REAL input in the DOM —
// a bot reads the DOM, not the stylesheet — hidden by the geometry this
// package already ships for screen-reader-only text (`.dh-sr`), and kept out
// of both the tab order and the accessibility tree. No `-9999px` offset: a
// later `left` would override a logical `inset-inline-start` outright (they
// cascade together), producing a physical-only rule with no honest RTL
// story, and a 9999px offset inside the panel is its own horizontal-overflow
// risk on the host page. `.dh-sr` has no offsets at all.
//
// ── The tenant shapes this form; this file no longer guesses ────────────
//
// Two things arrive from the merchant's own configuration, both published by
// `GET /chat-services/api/v1/widget/form` INSIDE `data` (not at the top
// level) and both optional here:
//
//   `contactRequirement`  which of Email / Phone the SUBMIT route will insist
//                         on. Email used to be marked required for every
//                         tenant, which made a tenant set to `'phone'` collect
//                         a detail the server does not want while leaving the
//                         one it does want marked "(optional)".
//   `copy`                the merchant's `title` / `intro` / `successMessage`.
//                         Absent — and each field independently `null` — means
//                         "render your own strings", and the strings below are
//                         what that renders.
//
// NEITHER DEFAULTS TO THE COLUMN'S DEFAULT. `contactRequirement` defaults to
// `'email'`, which is what this form did before the option existed, so a
// caller that has not yet read the boot route renders exactly what it rendered
// yesterday rather than a different guess. `widget.ts` is such a caller: its
// config comes from `remote-config.ts`, which carries no `form` block at all.
// Until that hop is wired, the widget-hosted form still shows every tenant an
// `'email'` form — a KNOWN REMAINING GAP, not a fixed one.
//
// ── `prefer` is always `'ticket'` from this surface ─────────────────────
//
// Leaving a message is what this form is FOR. Row 2's "Try live chat
// anyway" does not submit through here at all — it calls `onChooseChat`,
// which hands the visitor to a real, authenticated socket session
// (`startNewConversation`). This form never sends `prefer: 'chat'`.

import { el } from './dom.js';
import {
  createField,
  createStatusLine,
  createSubmitButton,
  firstMissingRequired,
  submitOnce,
} from './forms.js';
import type { FieldSpec } from './forms.js';
import { dedupeAgainstRendered } from './field-dedup.js';
import { WEBFORM_MESSAGE_MAX, WebformError, newSubmissionId, visitorMessage } from '../webform.js';
import type {
  ContactRequirement,
  WebformCopy,
  WebformDraft,
  WebformReceipt,
} from '../webform.js';

export interface WebformFormOptions {
  /** Row 2's "Try live chat anyway" — present only when the resolved entry's
   *  secondary option is chat. `null` renders no alternative at all. */
  readonly alternative: 'chat' | null;
  readonly hours: 'OPEN' | 'CLOSED' | 'NO_CALENDAR' | 'UNKNOWN';
  /**
   * `'assumed'` never actually reaches this form today — `entryFor` only
   * ever returns `'assumed'` paired with `primary: 'chat'`, which cannot open
   * a webform surface either from the Home CTA or from gate 1 — but it is
   * threaded through anyway so a future change to that resolution can never
   * make an unpublished entry claim "we're closed" here without this form
   * having to change too. See the closed-copy guard below.
   */
  readonly source: 'published' | 'assumed';
  readonly offlineMessage?: string;
  /** The merchant's pre-chat fields, for a guest visitor — folded into the
   *  message body, exactly like `ui/offline-form.ts`: there is no structured
   *  slot for them on the wire, and this path produces a message a human
   *  reads, not a record with a schema. */
  readonly extraFields: readonly FieldSpec[];
  /**
   * The tenant's `contact_requirement`, from `GET /widget/form`'s
   * `data.contactRequirement`.
   *
   * DEFAULTS TO `'email'`, which is this form's behaviour before the option
   * existed — NOT to the column's `'either'`. A caller that does not yet read
   * the boot route has learned nothing about this tenant, and changing what it
   * renders on the strength of a default nobody supplied would swap one guess
   * for another. `widget.ts` is such a caller today; see this file's header.
   */
  readonly contactRequirement?: ContactRequirement;
  /**
   * The merchant's own `title` / `intro` / `successMessage`.
   *
   * `undefined` or `null` — and each field independently `null` — renders this
   * form's own strings, byte for byte. That is not a fallback bolted on; it is
   * the documented meaning of the block being absent from the wire.
   */
  readonly copy?: WebformCopy | null;
}

export interface WebformFormCallbacks {
  /** Submits the draft. Resolves with the receipt, rejects with a
   *  `WebformError` — the form shows its own message and keeps what the
   *  visitor typed either way. */
  readonly onSubmit: (draft: WebformDraft) => Promise<WebformReceipt>;
  /** Row 2's escape hatch back to a real chat. Absent when `alternative` is
   *  `null`, or when this form was raised automatically (gate 1) rather than
   *  opened by the visitor. */
  readonly onChooseChat?: () => void;
  /** Absent for the automatic (gate-1) form, which has nowhere to cancel TO —
   *  it is standing in for the composer, not a detour from it. */
  readonly onCancel?: () => void;
  readonly onError: (error: unknown) => void;
}

export interface WebformView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

/**
 * The three built-ins, as DECLARED: the `'email'` tenant's form, which is also
 * what a caller that names no requirement renders.
 *
 * ⚠️ THE LABELS AND THE ORDER ARE FIXED, AND `field-dedup.ts` IS WHY.
 * `dedupeAgainstRendered` decides which of the merchant's pre-chat fields it
 * drops from the labels of what a surface renders and NOTHING ELSE — it never
 * reads `rendered[i].required`. Moving `required` therefore cannot move a
 * single drop, which is the property `test/webform-tenant-shape.test.ts` pins
 * across all three requirements against the same merchant fields. Change a
 * LABEL or the ORDER and that stops being true.
 *
 * ⚠️ THE SHAPE IS READ BY ANOTHER REPOSITORY. The console's two differential
 * gates (`chatsupport_react` `app/lib/settings/__tests__/webform-sdk-parity.test.ts`
 * and `prechat-dedup-sdk-differential.test.ts`) parse this file's SOURCE:
 * three named literals annotated `FieldSpec`, each with `id` / `label` /
 * `type` as quoted strings and `required` as a literal `true` or `false`,
 * resolved through the `FIELDS` array `createWebformForm` hands to
 * `dedupeAgainstRendered`. Both also pin this file's SHA-256, so any edit
 * turns them red and a human re-reads before re-pinning — but a change to
 * THIS shape fails their parse instead, which is a different failure with a
 * misleading message.
 */
const NAME_FIELD: FieldSpec = { id: 'name', label: 'Name', type: 'text', required: false };
const EMAIL_FIELD: FieldSpec = { id: 'email', label: 'Email', type: 'email', required: true };
const PHONE_FIELD: FieldSpec = { id: 'phone', label: 'Phone', type: 'phone', required: false };

/**
 * One declared built-in, under one tenant's contact rule.
 *
 * Only the two contact fields move, and they move together: the one the
 * tenant's SUBMIT route insists on is required, the other is not, and under
 * `'either'` neither is — the pair carries that rule instead (`pairRule` in
 * `createWebformForm`). Name is descriptive, not a way of reaching anyone,
 * and is returned as declared. A fresh object only where something changed:
 * `dedupeAgainstRendered` mutates nothing, so sharing the declared one is safe.
 */
function underRequirement(spec: FieldSpec, requirement: ContactRequirement): FieldSpec {
  switch (spec.id) {
    case 'email':
      return { ...spec, required: requirement === 'email' };
    case 'phone':
      return { ...spec, required: requirement === 'phone' };
    default:
      return spec;
  }
}

/**
 * The line under the heading, when the merchant wrote none.
 *
 * `'email'` keeps the sentence this form has always shown. The other two are
 * new because they have to be: "We'll reply by email." on a `'phone'` tenant's
 * form is a promise made about a box that tenant does not collect, and on an
 * `'either'` tenant's form it names one of two channels before the visitor has
 * chosen. `'either'` is deliberately channel-neutral — at render time this
 * package genuinely does not know which detail it is about to be given.
 */
const DEFAULT_INTRO: Record<ContactRequirement, string> = {
  email: "We'll reply by email.",
  phone: "We'll reply by phone.",
  either: "We'll get back to you.",
};

/** `''` is not copy. The console stores an empty intro as `null` already; this
 *  makes the other two agree rather than rendering a blank heading. */
function written(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function createWebformForm(
  options: WebformFormOptions,
  callbacks: WebformFormCallbacks,
): WebformView {
  const closed = options.source === 'published' && options.hours === 'CLOSED';
  const requirement = options.contactRequirement ?? 'email';
  const title = written(options.copy?.title);
  const intro = written(options.copy?.intro);
  const successMessage = written(options.copy?.successMessage);

  const banner = el('div', {
    attrs: { class: 'dh-offline-banner' },
    children: [
      el('p', {
        attrs: { class: 'dh-form-heading', id: 'dh-webform-heading' },
        // The closed heading is a STATE, not a title, and it outranks the
        // merchant's. It is the only thing on this form that tells a visitor
        // nobody is reading right now; replacing it with branding deletes that
        // fact and returns nothing — the panel already carries the merchant's
        // name. The merchant's title owns the open render, which is the only
        // one `mountForm` (the standalone bundle, which passes `'assumed'` /
        // `'UNKNOWN'`) can ever produce. `mountForm` is task S1's, in
        // `src/form.ts` on `feat/webform-s1` — uncommitted in worktree
        // `chatsupport-sdk-wt-s1` as this is written — so what it passes is
        // asserted against a working tree and UNVERIFIED in any commit until
        // S1 lands. Re-read it then; the reference stays because it is the
        // wiring contract.
        text: closed ? "We're currently offline." : (title ?? 'Leave a message'),
      }),
      el('p', {
        attrs: { class: 'dh-form-subtitle' },
        // `offlineMessage` first when closed: it is the merchant's copy ABOUT
        // being closed, so it is more specific than a general form intro, and
        // it already outranked the built-in here before `copy` existed.
        text: closed
          ? (options.offlineMessage ?? intro ?? "Leave us a message and we'll get back to you.")
          : (intro ?? DEFAULT_INTRO[requirement]),
      }),
    ],
  });

  // The declared built-ins with this tenant's rule laid over the two contact
  // fields — laid over BEFORE the dedupe, not after it, because a promotion
  // is only visible on a spec that was not already required: `ui/field-dedup.ts`
  // clones `required: true` onto a promoted built-in only when its own
  // `required` was false. Hand it Email as declared (required) on a `'phone'`
  // tenant and a merchant's required "Email address" duplicate would promote
  // nothing anyone could see.
  //
  // The console's gates read the literal list that opens this declaration —
  // the declared set — and not the `.map` that follows it; the byte pin on
  // this file is what puts the rest in front of a human. The name is the one
  // they resolve, which is why a per-render value is spelled like a constant.
  const FIELDS: readonly FieldSpec[] = [NAME_FIELD, EMAIL_FIELD, PHONE_FIELD].map((spec) =>
    underRequirement(spec, requirement),
  );

  // Deduped against `FIELDS` — the specs this form actually renders — and not
  // against a list of labels. "Phone number" is dropped because THIS form
  // shows a Phone box; "Contact" is kept because it does not. `ui/field-
  // dedup.ts` owns the rule, and the offline form applies the same one to its
  // own, different built-ins.
  //
  // `built` rather than `FIELDS` below, and that is load-bearing: a dropped
  // REQUIRED duplicate promotes the built-in it repeated, and the optional
  // ones here — which two of the three depends on the tenant — would
  // otherwise submit without the answer the merchant made mandatory.
  const { rendered: built, extra } = dedupeAgainstRendered(FIELDS, options.extraFields);
  const views = built.map((spec) => ({ spec, view: createField(spec, 'dh-webform') }));
  const custom = extra.map((spec) => ({ spec, view: createField(spec, 'dh-webform') }));

  const emailField = views.find((f) => f.spec.id === 'email');
  const phoneField = views.find((f) => f.spec.id === 'phone');

  // ── The `'either'` rule, and the one place it is decided ────────────────
  //
  // "Email or phone, one of them" is a constraint across TWO inputs, and
  // `required` is a property of ONE. Marking both required demands both;
  // marking neither, under this package's inverse convention ("optional is
  // marked, not required", `ui/forms.ts`), puts " (optional)" on both — which
  // reads as "skip both" and is the only wording here that is outright false.
  // So the pair carries the rule instead: see `contactHint` below.
  //
  // OFF when a promotion has already made one of them mandatory. A merchant
  // who marked their own "Email address" required has it dropped as a
  // duplicate and promotes Email (`ui/field-dedup.ts`), and a hint offering a
  // choice between a mandatory field and an optional one would be a lie about
  // the form the visitor is looking at. `firstMissingRequired` covers that
  // case on its own, and any answer it accepts satisfies `'either'` too.
  const pairRule =
    requirement === 'either' &&
    emailField !== undefined &&
    phoneField !== undefined &&
    !emailField.spec.required &&
    !phoneField.spec.required;

  // ── How a visitor learns the `'either'` rule BEFORE submitting ──────────
  //
  // One sentence, ABOVE both boxes, naming both fields and saying that one
  // answer is enough. Above, because a rule read after the decision is a
  // rejection with extra steps, and a visitor scanning a contact form reads
  // downward. Naming both fields, because "one of these" forward-references
  // boxes the reader has not reached yet. "Either one is enough", because
  // stripping " (optional)" from the two labels (below) otherwise leaves them
  // reading, under this package's convention, as though BOTH were demanded.
  //
  // `.dh-form-subtitle` and `.dh-field` are EXISTING rules (`ui/styles.ts`
  // §"Data-collecting surfaces") and NO NEW CSS SHIPS WITH THIS. That is not
  // thrift: a `<fieldset>` would arrive with the user agent's own border and
  // margins inside a panel that has neither, and nothing in this package's
  // jsdom tests computes layout, so that defect would ship unseen. The wrapper
  // is a plain `.dh-field` — `gap: var(--dh-space)` against `.dh-form`'s
  // `calc(var(--dh-space) * 2)` — so by those two rules Email and Phone are
  // half a step closer to each other than to anything else on the form.
  //
  // ⚠️ READ OFF THE STYLESHEET, NOT OFF A SCREEN. No browser rendered this.
  const CONTACT_HINT_ID = 'dh-webform-contact-hint';
  const contactHint = pairRule
    ? el('p', {
        attrs: { class: 'dh-form-subtitle', id: CONTACT_HINT_ID },
        text: 'Enter an email address or a phone number — either one is enough.',
      })
    : null;

  if (pairRule && contactHint !== null && emailField !== undefined && phoneField !== undefined) {
    for (const field of [emailField, phoneField]) {
      // Announced when focus lands in the box, which is when the rule is
      // needed. `aria-describedby` rather than a named `role="group"` because
      // a description attaches to the control a visitor is actually in, while
      // a group name depends on the reader announcing group boundaries at all.
      //
      // ⚠️ NOT VERIFIED WITH A SCREEN READER. Nothing in this package can be:
      // jsdom builds no accessibility tree. What is pinned is the ATTRIBUTE
      // and the id it resolves to (`test/webform-tenant-shape.test.ts`); how
      // any given reader voices it is untested here and should be checked by
      // someone with one before this is called done.
      field.view.input.setAttribute('aria-describedby', CONTACT_HINT_ID);
      // " (optional)" removed from BOTH labels — see `pairRule` above for why
      // it is the false half of the binary. `ui/forms.ts` owns the mark and is
      // outside this slice, so it is unmade here, on this surface's own nodes,
      // where the three-state truth (required / optional / one-of-a-pair) is
      // actually known.
      field.view.node.querySelector('.dh-field-optional')?.remove();
    }
  }

  const contactGroup =
    pairRule && contactHint !== null && emailField !== undefined && phoneField !== undefined
      ? el('div', {
          attrs: { class: 'dh-field' },
          children: [contactHint, emailField.view.node, phoneField.view.node],
        })
      : null;

  /** The built-ins' nodes, with the `'either'` pair folded into one group in
   *  the slot Email already occupied — so the on-screen order never moves. */
  const builtNodes: HTMLElement[] = [];
  for (const field of views) {
    if (contactGroup === null) {
      builtNodes.push(field.view.node);
    } else if (field === emailField) {
      builtNodes.push(contactGroup);
    } else if (field !== phoneField) {
      builtNodes.push(field.view.node);
    }
  }

  const messageLabel = el('label', {
    attrs: { class: 'dh-field-label', for: 'dh-webform-message' },
    text: 'How can we help?',
  });
  const message = el('textarea', {
    attrs: {
      class: 'dh-field-input dh-offline-message',
      id: 'dh-webform-message',
      rows: '4',
      maxlength: String(WEBFORM_MESSAGE_MAX),
    },
  });

  // ── Honeypot. See this module's header. ─────────────────────────────
  const honeypot = el('input', {
    attrs: {
      id: 'dh-webform-company-website',
      name: 'company_website',
      type: 'text',
      tabindex: '-1',
      autocomplete: 'off',
    },
  });
  const honeypotWrap = el('div', {
    attrs: { class: 'dh-sr', 'aria-hidden': 'true' },
    children: [honeypot],
  });

  const status = createStatusLine();
  const submit = createSubmitButton('Send message', 'Sending…');

  const cancel =
    callbacks.onCancel === undefined
      ? null
      : el('button', {
          attrs: { class: 'dh-form-skip', type: 'button' },
          text: 'Cancel',
          on: { click: () => callbacks.onCancel?.() },
        });

  // Its own class, deliberately NOT `.dh-form-skip`: on Row 2, `openWebform`
  // supplies BOTH `onCancel` and `onChooseChat` unconditionally (design
  // §5.2), and this button and Cancel above can therefore be on screen
  // together — sharing a class here would make `.dh-form-skip` stop
  // uniquely identifying "the Cancel button" within an open surface, the
  // same collision `ui/home-screen.ts`'s own alt button caused once already
  // (see that file's comment). `.dh-webform-alt` gets `.dh-form-skip`'s LOOK
  // (styles.ts) without its identity.
  const chatAlt =
    options.alternative === 'chat' && callbacks.onChooseChat !== undefined
      ? el('button', {
          attrs: { class: 'dh-webform-alt', type: 'button' },
          text: 'Try live chat anyway',
          on: { click: () => callbacks.onChooseChat?.() },
        })
      : null;

  const actions = el('div', {
    attrs: { class: 'dh-form-actions' },
    children: cancel === null ? [submit.node] : [submit.node, cancel],
  });

  const form = el('form', {
    attrs: { class: 'dh-form dh-webform-form', 'aria-labelledby': 'dh-webform-heading', novalidate: true },
    children: [
      banner,
      ...builtNodes,
      ...custom.map((f) => f.view.node),
      el('div', { attrs: { class: 'dh-field' }, children: [messageLabel, message] }),
      honeypotWrap,
      status.node,
      actions,
      ...(chatAlt === null ? [] : [chatAlt]),
    ],
    on: {
      submit: (event) => {
        event.preventDefault();
        void run();
      },
    },
  });

  // Reuses `.dh-offline-sent` wholesale — see `ui/offline-form.ts`'s own
  // confirmation. A confirmation, not a toast: the form is spent once sent,
  // and leaving it on screen invites a second identical message from a
  // visitor unsure the first one landed.
  const confirmation = el('div', {
    attrs: { class: 'dh-offline-sent', role: 'status', hidden: true },
    children: [
      el('p', { attrs: { class: 'dh-form-heading' }, text: 'Message received' }),
      el('p', { attrs: { class: 'dh-form-subtitle' } }),
    ],
  });

  const node = el('div', { attrs: { class: 'dh-webform' }, children: [form, confirmation] });

  // Minted once, at build time, and reused by every attempt from this form
  // instance — a retry after a rejected attempt must send the SAME id, or
  // the server's idempotency guard cannot recognise it as the same
  // submission. `builtAt` is likewise fixed at build time: `fillMs` is an
  // ELAPSED delta, never a wall-clock stamp.
  const submissionId = newSubmissionId();
  const builtAt = Date.now();
  let lastReceipt: WebformReceipt | null = null;

  function focusFieldNamed(name: string): void {
    const match = views.find((f) => f.spec.id === name) ?? custom.find((f) => f.spec.id === name);
    if (match !== undefined) {
      match.view.input.focus({ preventScroll: true });
      return;
    }
    if (name === 'message') message.focus({ preventScroll: true });
  }

  async function run(): Promise<void> {
    const missing = firstMissingRequired(views) ?? firstMissingRequired(custom);
    if (missing !== null) {
      status.show(`${missing.spec.label} is required.`);
      missing.view.input.focus({ preventScroll: true });
      return;
    }
    // The `'either'` pair, checked where reading order puts it — above the
    // message box — and worded as the hint's own opening, so a visitor who
    // reaches it recognises the rule they were already shown rather than
    // meeting a second, new one. A backstop, not the mechanism: the hint is.
    if (
      pairRule &&
      emailField !== undefined &&
      phoneField !== undefined &&
      emailField.view.value() === '' &&
      phoneField.view.value() === ''
    ) {
      status.show('Enter an email address or a phone number.');
      emailField.view.input.focus({ preventScroll: true });
      return;
    }
    if (message.value.trim() === '') {
      status.show('Please tell us what you need.');
      message.focus({ preventScroll: true });
      return;
    }

    const byId = (id: string): string =>
      views.find((f) => f.spec.id === id)?.view.value() ?? '';
    const nameValue = byId('name');
    const emailValue = byId('email');
    const phoneValue = byId('phone');

    const answered = custom.filter((field) => field.view.value() !== '');
    const extra = answered.map((field) => `${field.spec.label}: ${field.view.value()}`).join('\n\n');
    const body = extra === '' ? message.value.trim() : `${message.value.trim()}\n\n${extra}`;

    const pageUrl = typeof window === 'undefined' ? undefined : window.location.href;
    const locale = typeof navigator === 'undefined' ? undefined : navigator.language;

    const draft: WebformDraft = {
      submissionId,
      ...(nameValue === '' ? {} : { name: nameValue }),
      // OMITTED when unanswered, never `''`: the route's schema is
      // `z.string().email().optional()`, and `''` fails `.email()` — an empty
      // box sent as an empty string is a 400 where an absent key is accepted.
      // Same shape Phone has always had, for the same reason.
      ...(emailValue === '' ? {} : { email: emailValue }),
      ...(phoneValue === '' ? {} : { phone: phoneValue }),
      message: body,
      prefer: 'ticket',
      ...(pageUrl === undefined ? {} : { pageUrl }),
      ...(locale === undefined ? {} : { locale }),
      fillMs: Date.now() - builtAt,
      company_website: honeypot.value,
    };

    const sent = await submitOnce(
      async () => {
        lastReceipt = await callbacks.onSubmit(draft);
      },
      {
        button: submit,
        status,
        failureMessage: (error: unknown) => visitorMessage(error),
        onError: (error: unknown) => {
          callbacks.onError(error);
          if (error instanceof WebformError && error.field !== undefined) focusFieldNamed(error.field);
        },
      },
    );

    if (!sent || lastReceipt === null) return;
    // WHICHEVER detail the visitor actually gave. It was `emailValue`
    // unconditionally, which was safe only while an email was unconditionally
    // demanded — on a `'phone'` tenant that same line would have read "We'll
    // reply to ." Email first when both are present: it is the channel the
    // ticket branch uses.
    const reachAt = emailValue !== '' ? emailValue : phoneValue;
    const line =
      // The merchant's own sentence wins outright, and nothing is spliced into
      // it. The console calls this field "Shown after every submission", which
      // includes the chat outcome below; a value interpolated into a string
      // they wrote would land wherever the sentence happened to end.
      successMessage ??
      (lastReceipt.outcome === 'chat'
        ? reachAt === ''
          ? 'Thanks — someone will pick this up.'
          : `Thanks — someone will pick this up and reply to ${reachAt}.`
        : reachAt === ''
          ? 'Message received.'
          : `Message received. We'll reply to ${reachAt}.`);
    const echo = confirmation.querySelector('.dh-form-subtitle');
    if (echo !== null) echo.textContent = line;
    form.hidden = true;
    confirmation.hidden = false;
    // Focus follows the surface — leaving it on the now-hidden submit button
    // would strand a keyboard visitor on an element that no longer exists to
    // them. Same rule, same mechanism, as `ui/offline-form.ts`.
    confirmation.setAttribute('tabindex', '-1');
    confirmation.focus({ preventScroll: true });
  }

  return {
    node,
    focus() {
      (form.hidden ? confirmation : views[0]!.view.input).focus({ preventScroll: true });
    },
    destroy() {
      // No document-level listeners; every listener here is on a node inside
      // `node`, and goes with it.
    },
  };
}
