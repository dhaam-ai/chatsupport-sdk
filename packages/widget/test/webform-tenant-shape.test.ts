// @vitest-environment jsdom
//
// The web form, shaped by the TENANT rather than by this package's guesses.
//
// Two halves of one gap, both "served by one layer, read by none":
//
//   1. `contact_requirement` — `chat-service-node`'s
//      `validators/webform.validator.ts` makes `email` optional and enforces
//      the tenant's own rule in `assertContactRequirement`. This form used to
//      mark Email required for EVERY tenant, so a tenant on `'phone'` got a
//      form that collected an email the server does not want and left the
//      phone box optional — every submission that took that box at its word
//      was refused.
//   2. `form.title` / `form.intro` / `form.successMessage` — published by
//      `GET /chat-services/api/v1/widget/form` inside `data`, and thrown away.
//
// The boundary under test is `createWebformForm`'s rendered DOM and the draft
// it hands to `onSubmit`. Both are what a VISITOR and the SERVER respectively
// consume; neither is an internal call sequence.
//
// ⚠️ jsdom applies no cascade and computes no layout. Everything here is a
// structural/attribute assertion. "The hint is above the two boxes" is pinned
// as DOM ORDER, not as pixels, and no test in this file is evidence about
// what anything looks like.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebformForm } from '../src/ui/webform-form.js';
import { dedupeAgainstRendered } from '../src/ui/field-dedup.js';
import type { FieldSpec } from '../src/ui/forms.js';
import type { WebformCopy, WebformDraft, WebformReceipt } from '../src/webform.js';
import type { WebformFormOptions } from '../src/ui/webform-form.js';

const receipt: WebformReceipt = { outcome: 'ticket', receiptId: 'r1', duplicate: false };

function mount(node: HTMLElement): void {
  document.body.innerHTML = '';
  document.body.appendChild(node);
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

const $$ = <T extends HTMLElement>(selector: string): T[] => [
  ...document.querySelectorAll<T>(selector),
];

/** The label element's own text, "(optional)" mark INCLUDED. */
const labelFor = (inputId: string): string => $(`label[for="${inputId}"]`).textContent ?? '';

/** Lets the submit handler's promise chain settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const BASE: WebformFormOptions = {
  alternative: null,
  hours: 'OPEN',
  source: 'published',
  extraFields: [],
};

function build(
  options: Partial<WebformFormOptions> = {},
  onSubmit: (draft: WebformDraft) => Promise<WebformReceipt> = async () => receipt,
): void {
  const view = createWebformForm({ ...BASE, ...options }, { onSubmit, onError: () => {} });
  mount(view.node);
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ── 1. The tenant's contact requirement reaches the fields ────────────────

describe("the tenant's contact requirement decides which contact field is required", () => {
  it("marks Phone required and Email optional for a 'phone' tenant", () => {
    build({ contactRequirement: 'phone' });

    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(true);
    expect(labelFor('dh-webform-phone')).toBe('Phone');
    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(false);
    expect(labelFor('dh-webform-email')).toBe('Email (optional)');
  });

  it("lets a 'phone' visitor submit with no email at all, and omits the key", async () => {
    const onSubmit = vi.fn().mockResolvedValue(receipt);
    build({ contactRequirement: 'phone' }, onSubmit);

    $<HTMLInputElement>('#dh-webform-phone').value = '+447700900123';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Call me back please.';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0]?.[0] as WebformDraft;
    // `.strict()` server-side, and `email: z.string().email()` — an EMPTY
    // string is not a valid email, so an unanswered box must be an ABSENT
    // key, never `''`.
    expect('email' in draft).toBe(false);
    expect(draft.phone).toBe('+447700900123');
  });

  it("blocks a 'phone' submit with no phone, naming the field the server will name", async () => {
    const onSubmit = vi.fn();
    build({ contactRequirement: 'phone' }, onSubmit);

    $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Phone is required.');
    expect(document.activeElement).toBe($('#dh-webform-phone'));
  });

  it("keeps today's shape for an 'email' tenant, and for a caller that names none", () => {
    build({ contactRequirement: 'email' });
    expect($$('.dh-field-label').map((l) => l.textContent)).toEqual([
      'Name (optional)',
      'Email',
      'Phone (optional)',
      'How can we help?',
    ]);
    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(true);

    build();
    expect($$('.dh-field-label').map((l) => l.textContent)).toEqual([
      'Name (optional)',
      'Email',
      'Phone (optional)',
      'How can we help?',
    ]);
    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(true);
  });
});

// ── 2. `'either'` — the constraint no `required` attribute can express ────

describe("'either': one of the two, and the visitor is told so before submitting", () => {
  it('marks neither field required and neither field optional', () => {
    build({ contactRequirement: 'either' });

    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(false);
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(false);
    // The false half of the binary, removed: two boxes both marked
    // "(optional)" read as "skip both", which the server refuses.
    expect(labelFor('dh-webform-email')).toBe('Email');
    expect(labelFor('dh-webform-phone')).toBe('Phone');
    // Name is untouched — it really is optional.
    expect(labelFor('dh-webform-name')).toBe('Name (optional)');
  });

  it('states the rule ABOVE both boxes, and describes both inputs with it', () => {
    build({ contactRequirement: 'either' });

    const hint = $('#dh-webform-contact-hint');
    expect(hint.textContent).toBe(
      'Enter an email address or a phone number — either one is enough.',
    );

    const email = $('#dh-webform-email');
    const phone = $('#dh-webform-phone');
    // DOM order, which is reading order and screen-reader order alike. This is
    // NOT a claim about pixels: jsdom computes no layout.
    const PRECEDES = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(hint.compareDocumentPosition(email) & PRECEDES).toBeTruthy();
    expect(hint.compareDocumentPosition(phone) & PRECEDES).toBeTruthy();

    expect(email.getAttribute('aria-describedby')).toBe('dh-webform-contact-hint');
    expect(phone.getAttribute('aria-describedby')).toBe('dh-webform-contact-hint');

    // The two are one group in the markup as well as in the sentence.
    const group = hint.parentElement!;
    expect([...group.children].indexOf(hint)).toBe(0);
    expect(group.contains(email)).toBe(true);
    expect(group.contains(phone)).toBe(true);
  });

  it('refuses a submission with neither, in the hint’s own words', async () => {
    const onSubmit = vi.fn();
    build({ contactRequirement: 'either' }, onSubmit);

    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Enter an email address or a phone number.');
    expect(document.activeElement).toBe($('#dh-webform-email'));
  });

  it.each<['email' | 'phone', string, string]>([
    ['email', 'ada@example.com', 'phone'],
    ['phone', '+447700900123', 'email'],
  ])('accepts %s alone and omits the other key', async (given, value, absent) => {
    const onSubmit = vi.fn().mockResolvedValue(receipt);
    build({ contactRequirement: 'either' }, onSubmit);

    $<HTMLInputElement>(`#dh-webform-${given}`).value = value;
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0]?.[0] as WebformDraft;
    expect(draft[given]).toBe(value);
    expect(absent in draft).toBe(false);
  });

  it('confirms to whichever detail was given — a phone-only visitor is not told "reply to ."', async () => {
    build({ contactRequirement: 'either' });

    $<HTMLInputElement>('#dh-webform-phone').value = '+447700900123';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($('.dh-offline-sent').textContent).toContain(
      "Message received. We'll reply to +447700900123.",
    );
  });

  // Documented at the `reachAt` line in `ui/webform-form.ts`: email first,
  // because it is the channel the ticket branch replies on. Pinned here so
  // flipping that polarity is a red test and not a silent change of promise.
  it('confirms to the email when both were given — the channel the ticket branch uses', async () => {
    build({ contactRequirement: 'either' });

    $<HTMLInputElement>('#dh-webform-email').value = 'visitor@example.com';
    $<HTMLInputElement>('#dh-webform-phone').value = '+447700900123';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    const sent = $('.dh-offline-sent').textContent ?? '';
    expect(sent).toContain("Message received. We'll reply to visitor@example.com.");
    expect(sent).not.toContain('+447700900123');
  });

  // A merchant's own required "Email address" is dropped as a duplicate and
  // PROMOTES Email (`ui/field-dedup.ts`). The choice is then gone, so offering
  // one would be a lie about the form on screen.
  it('drops the hint when a promotion has already made one of the pair mandatory', async () => {
    const onSubmit = vi.fn();
    build(
      {
        contactRequirement: 'either',
        extraFields: [{ id: 'p1', label: 'Email address', type: 'email', required: true }],
      },
      onSubmit,
    );

    expect(document.querySelector('#dh-webform-contact-hint')).toBeNull();
    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(true);
    expect(labelFor('dh-webform-email')).toBe('Email');
    expect(labelFor('dh-webform-phone')).toBe('Phone (optional)');

    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Email is required.');
  });
});

// ── 3. The merchant's own copy, which was fetched and thrown away ─────────

describe("the tenant's copy is rendered, and its absence renders today's strings", () => {
  const HEADING = '.dh-form-heading';
  const SUBTITLE = '.dh-form-subtitle';

  it('renders title, intro and successMessage where the console says they go', async () => {
    build({
      copy: {
        title: 'Contact the crew',
        intro: 'We answer within a working day.',
        successMessage: 'Got it. Someone will be in touch.',
      },
    });

    expect($(HEADING).textContent).toBe('Contact the crew');
    expect($(SUBTITLE).textContent).toBe('We answer within a working day.');

    $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    // Verbatim. Nothing is spliced into a sentence the merchant wrote.
    expect($('.dh-offline-sent .dh-form-subtitle').textContent).toBe(
      'Got it. Someone will be in touch.',
    );
  });

  // `exactOptionalPropertyTypes` is on, so "absent" is an ABSENT KEY here and
  // never an explicit `undefined` — which is also the only way a caller can
  // express it against `copy?: WebformCopy | null`.
  it.each<[string, { readonly copy?: WebformCopy | null }]>([
    ['absent', {}],
    ['null', { copy: null }],
    ['three nulls', { copy: { title: null, intro: null, successMessage: null } }],
    ['three blanks', { copy: { title: '   ', intro: '', successMessage: ' ' } }],
  ])("renders today's own strings when the copy is %s", async (_label, withCopy) => {
    build(withCopy);

    expect($(HEADING).textContent).toBe('Leave a message');
    expect($(SUBTITLE).textContent).toBe("We'll reply by email.");

    $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($('.dh-offline-sent .dh-form-subtitle').textContent).toBe(
      "Message received. We'll reply to ada@example.com.",
    );
  });

  it('replaces the chat-outcome sentence too — the console says "every submission"', async () => {
    const view = createWebformForm(
      { ...BASE, copy: { title: null, intro: null, successMessage: 'Thanks, we have it.' } },
      { onSubmit: async () => ({ ...receipt, outcome: 'chat' }), onError: () => {} },
    );
    mount(view.node);

    $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
    $<HTMLTextAreaElement>('#dh-webform-message').value = 'Hello';
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($('.dh-offline-sent .dh-form-subtitle').textContent).toBe('Thanks, we have it.');
  });

  // The closed heading is the only thing on this form that says nobody is
  // reading right now. A title would delete that and return branding the panel
  // already carries.
  it('keeps the closed-hours heading even when the merchant set a title', () => {
    build({
      hours: 'CLOSED',
      source: 'published',
      copy: { title: 'Contact the crew', intro: null, successMessage: null },
    });

    expect($(HEADING).textContent).toBe("We're currently offline.");
  });

  it.each<[string, string | undefined, string | null, string]>([
    ['offlineMessage outranks intro', 'Back at 9am.', 'We answer within a day.', 'Back at 9am.'],
    ['intro is used when there is no offlineMessage', undefined, 'We answer within a day.', 'We answer within a day.'],
    ['the built-in is last', undefined, null, "Leave us a message and we'll get back to you."],
  ])('closed subtitle: %s', (_label, offlineMessage, intro, expected) => {
    build({
      hours: 'CLOSED',
      source: 'published',
      ...(offlineMessage === undefined ? {} : { offlineMessage }),
      copy: { title: null, intro, successMessage: null },
    });

    expect($(SUBTITLE).textContent).toBe(expected);
  });

  // "We'll reply by email." is a promise about a box a 'phone' tenant does not
  // collect, and on 'either' it names one of two channels before the visitor
  // has picked one.
  it.each<['email' | 'phone' | 'either', string]>([
    ['email', "We'll reply by email."],
    ['phone', "We'll reply by phone."],
    ['either', "We'll get back to you."],
  ])('the default intro for %s does not promise a channel it has not been given', (requirement, expected) => {
    build({ contactRequirement: requirement });
    expect($(SUBTITLE).textContent).toBe(expected);
  });
});

// ── 4. Criterion 6: moving `required` must not move a single DROP ─────────
//
// `dedupeAgainstRendered` reads the LABELS of what a surface renders and
// nothing else — it never consults `rendered[i].required`. K8/K9 pin that
// rule's behaviour from the console side, so the property asserted here is the
// one those pins care about: the same merchant fields survive, and the same
// ones are dropped, whichever contact rule the tenant is on.

describe('the dedup rule is unmoved by the contact requirement', () => {
  const REQUIREMENTS: ReadonlyArray<'email' | 'phone' | 'either'> = ['email', 'phone', 'either'];

  const field = (
    label: string,
    type: FieldSpec['type'] = 'text',
    required = false,
  ): FieldSpec => ({
    id: `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    type,
    required,
  });

  /** Every rendered label, with the "(optional)" mark stripped — so the list
   *  isolates WHICH fields are on screen from which are marked required. */
  function droppedShape(requirement: 'email' | 'phone' | 'either', fields: readonly FieldSpec[]): string[] {
    build({ contactRequirement: requirement, extraFields: fields });
    return $$('.dh-field-label').map((l) => (l.textContent ?? '').replace(/ \(optional\)$/, ''));
  }

  const BATTERY: ReadonlyArray<[string, readonly FieldSpec[]]> = [
    ['nothing configured', []],
    ["the console's seeded pair", [field('Your name', 'text', true), field('Email address', 'email', true)]],
    ['a phone duplicate', [field('Phone number', 'phone', true)]],
    ['case and whitespace', [field('  EMAIL ADDRESS  ', 'email')]],
    ['near misses that must survive', [field('Mobile', 'phone'), field('Telephone', 'phone'), field('E-mail', 'email')]],
    ['"Contact" and "Contact details", neither a built-in', [field('Contact'), field('Contact details')]],
    ['a merchant label containing " or ", never split', [field('Phone or WhatsApp', 'phone')]],
    ['a merchant who wrote a built-in out in full', [field('Email or phone', 'email')]],
    ['equality, not substring', [field('Name of the product you ordered'), field('Order number')]],
  ];

  it.each(BATTERY)('drops and keeps identically across all three requirements: %s', (_label, fields) => {
    const shapes = REQUIREMENTS.map((r) => droppedShape(r, fields));
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it.each(REQUIREMENTS)('promotes a dropped required contact duplicate under %s', (requirement) => {
    build({ contactRequirement: requirement, extraFields: [field('Phone number', 'phone', true)] });
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(true);
    expect(labelFor('dh-webform-phone')).toBe('Phone');

    build({ contactRequirement: requirement, extraFields: [field('Email address', 'email', true)] });
    expect($<HTMLInputElement>('#dh-webform-email').required).toBe(true);
    expect(labelFor('dh-webform-email')).toBe('Email');
  });

  it.each(REQUIREMENTS)('never promotes a descriptive built-in under %s', (requirement) => {
    build({ contactRequirement: requirement, extraFields: [field('Your name', 'text', true)] });
    expect($<HTMLInputElement>('#dh-webform-name').required).toBe(false);
    expect(labelFor('dh-webform-name')).toBe('Name (optional)');
  });

  // The rule itself, exercised directly, so the property above is pinned at
  // the module that owns it as well as at the surface that applies it.
  it('is a function of labels: the same `extra` for either polarity of `required`', () => {
    const merchant = [field('Email address', 'email'), field('Order number')];
    const optionalBuiltIns: FieldSpec[] = [
      { id: 'email', label: 'Email', type: 'email', required: false },
      { id: 'phone', label: 'Phone', type: 'phone', required: false },
    ];
    const requiredBuiltIns = optionalBuiltIns.map((spec) => ({ ...spec, required: true }));

    expect(dedupeAgainstRendered(optionalBuiltIns, merchant).extra.map((f) => f.label)).toEqual(
      dedupeAgainstRendered(requiredBuiltIns, merchant).extra.map((f) => f.label),
    );
  });

  // A render must not leave a promoted `required` behind for the next one.
  it('does not carry one visitor’s promotion into the next render', () => {
    build({ contactRequirement: 'either', extraFields: [field('Phone number', 'phone', true)] });
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(true);

    build({ contactRequirement: 'either' });
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(false);
    expect($('#dh-webform-contact-hint')).toBeTruthy();
  });
});
