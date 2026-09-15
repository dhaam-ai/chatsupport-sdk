// @vitest-environment jsdom
//
// De-duplicating a merchant's pre-chat fields against what each surface
// ALREADY renders.
//
// The boundary under test is the rendered field set — what `createWebformForm`
// and `createOfflineForm` actually put in the DOM for a given pre-chat
// configuration — not the predicate in isolation. A predicate that agrees with
// itself while the form renders two phone boxes is the bug this file exists
// for.
//
// The two surfaces render DIFFERENT built-ins, so the same pre-chat field is
// correctly dropped on one and correctly kept on the other:
//
//   web form   Name · Email · Phone
//   offline    Name · Email or phone
//
// Which is exactly why the rule cannot be a fixed list of labels.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { dedupeAgainstRendered } from '../src/ui/field-dedup.js';
import { createOfflineForm } from '../src/ui/offline-form.js';
import { createWebformForm } from '../src/ui/webform-form.js';
import type { FieldSpec } from '../src/ui/forms.js';
import type { WebformDraft, WebformReceipt } from '../src/webform.js';

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

function mount(node: HTMLElement): void {
  document.body.innerHTML = '';
  document.body.appendChild(node);
}

const $$ = <T extends HTMLElement>(selector: string): T[] => [
  ...document.querySelectorAll<T>(selector),
];

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

/** The label element's own text, "(optional)" mark INCLUDED. */
const labelFor = (inputId: string): string =>
  $(`label[for="${inputId}"]`).textContent ?? '';

/** Lets the submit handler's promise chain settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

/** Every field label the surface rendered, with the "(optional)" mark stripped. */
function renderedLabels(): string[] {
  return $$('.dh-field-label').map((l) => (l.textContent ?? '').replace(/ \(optional\)$/, ''));
}

const receipt: WebformReceipt = { outcome: 'ticket', receiptId: 'r1', duplicate: false };

/** The web-form surface, mounted, for one pre-chat configuration. */
function webformView(
  extraFields: readonly FieldSpec[],
  onSubmit: (draft: WebformDraft) => Promise<WebformReceipt> = async () => receipt,
): void {
  const view = createWebformForm(
    {
      alternative: null,
      hours: 'OPEN',
      source: 'published',
      extraFields,
      // NAMED, not defaulted. These are dedup/promotion tests, and the
      // evidence of an unpromoted built-in is the " (optional)" mark on its
      // label — a mark the `'either'` rule strips from BOTH contact fields on
      // purpose, so under that rule "Phone" says nothing about whether a
      // promotion happened. `'email'` is the one requirement that leaves Phone
      // marked, which is what makes the negative cases here readable at all.
      // It was also this form's default until the fallback moved to the
      // server's `'either'`; naming it keeps these tests about dedup rather
      // than about whatever the default happens to be.
      // `test/webform-tenant-shape.test.ts` covers dedup under all three.
      contactRequirement: 'email',
    },
    { onSubmit, onError: () => {} },
  );
  mount(view.node);
}

/** The web-form surface's rendered labels for one pre-chat configuration. */
function webform(extraFields: readonly FieldSpec[]): string[] {
  webformView(extraFields);
  return renderedLabels();
}

/** Fills the two answers the web form always needs, then submits. */
async function submitWebform(): Promise<void> {
  $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
  $<HTMLTextAreaElement>('#dh-webform-message').value = 'Where is my order?';
  $<HTMLFormElement>('form').requestSubmit();
  await flush();
}

/** The offline surface's rendered labels for one pre-chat configuration. */
function offline(extraFields: readonly FieldSpec[]): string[] {
  const view = createOfflineForm(extraFields, { onSubmit: async () => {}, onError: () => {} });
  mount(view.node);
  return renderedLabels();
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ── CHARACTERIZATION — today's behaviour, which must survive the fix ───────
//
// These passed before any change on this task. They pin the cases the old
// fixed list already got right, so the new rule cannot quietly trade one
// direction of the bug for the other.
describe('CHARACTERIZATION: pre-chat de-duplication as it already behaves', () => {
  it('web form: drops the two labels the console seeds every workspace with', () => {
    expect(webform([field('Your name'), field('Email address', 'email')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'How can we help?',
    ]);
  });

  it('web form: keeps a merchant field that merely CONTAINS a built-in word', () => {
    expect(webform([field('Name of the product you ordered'), field('Order number')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'Name of the product you ordered',
      'Order number',
      'How can we help?',
    ]);
  });

  it('web form: matching ignores case and surrounding whitespace', () => {
    expect(webform([field('  EMAIL ADDRESS  ', 'email')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'How can we help?',
    ]);
  });

  it('offline form: drops the seeded name label and keeps a real merchant field', () => {
    expect(offline([field('Your name'), field('Order number')])).toEqual([
      'Name',
      'Email or phone',
      'Order number',
      'How can we help?',
    ]);
  });
});

// ── The web form's rendered set ───────────────────────────────────────────
describe('web form de-duplicates against Name / Email / Phone', () => {
  // "Phone number" is the label an admin types when they want a phone number.
  // The web form already renders one, so asking again is two phone boxes on
  // one short form.
  it('drops "Phone number" rather than rendering a second phone box', () => {
    const labels = webform([field('Phone number', 'phone')]);
    expect($$('input[type="tel"]')).toHaveLength(1);
    expect(labels).toEqual(['Name', 'Email', 'Phone', 'How can we help?']);
  });

  // Nothing on this surface is labelled "Contact" — it asks for Name, Email
  // and Phone separately. Dropping the merchant's question because some OTHER
  // surface has a contact field deletes it with no trace and no answer.
  it('keeps "Contact" and "Contact details", which it renders no field for', () => {
    expect(webform([field('Contact'), field('Contact details')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'Contact',
      'Contact details',
      'How can we help?',
    ]);
  });
});

// ── The offline form's rendered set ───────────────────────────────────────
//
// One contact field, labelled "Email or phone" — so the SAME merchant field is
// correctly kept here and correctly dropped on the web form, and vice versa.
describe('offline form de-duplicates against Name / Email or phone', () => {
  it('drops "Email or phone", the label that repeats its contact field', () => {
    expect(offline([field('Email or phone', 'email')])).toEqual([
      'Name',
      'Email or phone',
      'How can we help?',
    ]);
  });

  // "Email or phone" is one input offering two channels, so a field asking for
  // either one of them collects the same value the visitor already typed
  // there. "Contact" is not one of the two, and nothing here is called that.
  it('drops "Email" and "Phone" — the two sides of "Email or phone" — and keeps "Contact"', () => {
    expect(offline([field('Email', 'email'), field('Phone', 'phone'), field('Contact')])).toEqual([
      'Name',
      'Email or phone',
      'Contact',
      'How can we help?',
    ]);
  });

  // Affix strip and alternative split compose: "Email address" → "email" →
  // one side of the built-in. This is the console's own seeded label, so it is
  // the case every untouched workspace actually hits.
  it('drops the seeded "Email address" through both halves of the rule', () => {
    expect(offline([field('Email address', 'email')])).toEqual([
      'Name',
      'Email or phone',
      'How can we help?',
    ]);
  });

  // The one field left that still diverges by surface — and the reason it
  // does is that only RENDERED labels are split. This surface renders "Email
  // or phone", so the merchant's copy of it is a repeat; the web form renders
  // no such label, and its two separate boxes are not what this field asks
  // for, so it stays.
  it('drops a merchant "Email or phone" here while the web form keeps it', () => {
    const either = field('Email or phone', 'email');
    expect(offline([either])).toEqual(['Name', 'Email or phone', 'How can we help?']);
    expect(webform([either])).toEqual([
      'Name',
      'Email',
      'Phone',
      'Email or phone',
      'How can we help?',
    ]);
  });
});

// ── The boundary, on purpose ──────────────────────────────────────────────
//
// The rule strips a leading "your" and one trailing "address"/"number"/
// "details", and compares whole labels — it has no synonym table. These are
// the near misses that decision leaves in, pinned so the next reader finds the
// edge deliberately rather than by a bug report. They render IN ADDITION to
// the built-in, which is the direction that loses nobody's question.
describe('near misses the rule deliberately does not fold together', () => {
  // Every name `ui/field-dedup.ts`'s header lists, on BOTH surfaces. That
  // header claims these are pinned per surface, so it must not name one this
  // file leaves to chance — and the two surfaces render different built-ins,
  // so "kept on the web form" is no evidence at all about the offline one.
  const NEAR_MISSES: ReadonlyArray<[string, FieldSpec['type']]> = [
    ['Mobile', 'phone'],
    ['Telephone', 'phone'],
    ['Cell', 'phone'],
    ['E-mail', 'email'],
    ['Mail', 'email'],
    ['Full name', 'text'],
    ['First name', 'text'],
  ];

  it.each(NEAR_MISSES)('keeps "%s" on both surfaces', (label, type) => {
    expect(webform([field(label, type)])).toEqual([
      'Name',
      'Email',
      'Phone',
      label,
      'How can we help?',
    ]);
    expect(offline([field(label, type)])).toEqual([
      'Name',
      'Email or phone',
      label,
      'How can we help?',
    ]);
  });

  // The affix strip is not a substring match: it takes a leading "your" and
  // ONE trailing qualifier, so a label that merely ends in a stripped word
  // keeps whatever is left of it.
  it('keeps "Order number" and "Delivery address", whose stems match nothing rendered', () => {
    expect(webform([field('Order number'), field('Delivery address')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'Order number',
      'Delivery address',
      'How can we help?',
    ]);
  });

  // " or " splits a RENDERED label, never a merchant's. Splitting a merchant's
  // could only ever drop a question that was asked: both labels below contain
  // a side that matches something the surface renders, and both must survive
  // whole. This is the assertion that fails if the split is ever moved to the
  // other side of the comparison.
  it('never splits a merchant label on "or", on either surface', () => {
    expect(offline([field('Email or WhatsApp', 'email')])).toEqual([
      'Name',
      'Email or phone',
      'Email or WhatsApp',
      'How can we help?',
    ]);
    expect(webform([field('Phone or WhatsApp', 'phone')])).toEqual([
      'Name',
      'Email',
      'Phone',
      'Phone or WhatsApp',
      'How can we help?',
    ]);
  });
});

// ── The one case no surface can reach ─────────────────────────────────────
//
// Pinned at the function rather than at the DOM, and deliberately so: both
// surfaces render hardcoded, non-blank specs, so a blank built-in label cannot
// arrive through `createWebformForm` or `createOfflineForm` today. Without the
// empty-concept guard it would put '' into the rendered set, and a merchant
// field whose own label is blank would vanish from a form with room to show
// it — the one wrongful drop the split's own trim cannot rule out.
describe('dedupeAgainstRendered: a blank rendered label matches nothing', () => {
  it('keeps a blank merchant label instead of pairing it with a blank built-in', () => {
    const blankBuiltIn: FieldSpec = { id: 'b', label: '   ', type: 'text', required: false };
    const blankMerchant: FieldSpec = { id: 'm', label: '', type: 'text', required: false };
    expect(dedupeAgainstRendered([blankBuiltIn], [blankMerchant]).extra).toEqual([blankMerchant]);
  });

  // Nothing was dropped, so nothing is promoted — and the built-ins come back
  // as the very objects passed in, which is the cheapest proof that a caller's
  // module-level constants are never mutated by a render.
  it('returns the callers own spec objects when no drop promotes anything', () => {
    const builtIn: FieldSpec = { id: 'phone', label: 'Phone', type: 'phone', required: false };
    const merchant: FieldSpec = { id: 'order', label: 'Order number', type: 'text', required: true };
    const out = dedupeAgainstRendered([builtIn], [merchant]);
    expect(out.rendered[0]).toBe(builtIn);
    expect(out.extra).toEqual([merchant]);
  });
});

// ── A dropped duplicate takes its `required` with it ──────────────────────
//
// Dropping the merchant's field must not drop the merchant's REQUIREMENT. The
// web form's Phone and Name are `required: false`, so without this a merchant
// who marked "Phone number" required gets a form that submits with no phone —
// the question silently downgraded rather than silently deleted.
describe('a dropped required duplicate promotes the built-in it repeats', () => {
  it('makes Phone required when the dropped "Phone number" was required', () => {
    webformView([field('Phone number', 'phone', true)]);
    expect($$('input[type="tel"]')).toHaveLength(1);
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(true);
  });

  // `ui/forms.ts` appends " (optional)" from the spec, so a promotion that
  // does not reach the LABEL renders a box marked optional that refuses to
  // submit — a worse lie than the one being fixed.
  it('takes the "(optional)" mark off the promoted label', () => {
    webformView([field('Phone number', 'phone', true)]);
    expect(labelFor('dh-webform-phone')).toBe('Phone');
  });

  it('blocks the submit the merchant asked it to block', async () => {
    const onSubmit = vi.fn(async () => receipt);
    webformView([field('Phone number', 'phone', true)], onSubmit);
    await submitWebform();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Phone is required.');
  });

  // Name does NOT promote, and not because it is called Name: promotion
  // exists so that losing a dropped requirement cannot make the submission
  // unanswerable, and a name is descriptive rather than a way to reach
  // anyone. Losing it costs an agent context; losing the phone the merchant
  // made mandatory costs them the reply. The console's seeded "Your name" is
  // `required: true`, so this is the default configuration, not an edge case.
  it('does NOT promote Name, which is not a way to reach the visitor', () => {
    webformView([field('Your name', 'text', true)]);
    expect($<HTMLInputElement>('#dh-webform-name').required).toBe(false);
    expect(labelFor('dh-webform-name')).toBe('Name (optional)');
  });

  // …and the distinction is drawn on the built-in's TYPE, never its label. A
  // label check would be the fixed list this whole rule replaced, rebuilt in
  // a new place. Same label on both sides here, so only `type` can decide.
  it('decides by the built-ins type, not its label', () => {
    const merchant: FieldSpec = { id: 'm', label: 'Reach me', type: 'text', required: true };
    const descriptive: FieldSpec = { id: 'd', label: 'Reach me', type: 'text', required: false };
    const reachable: FieldSpec = { id: 'r', label: 'Reach me', type: 'phone', required: false };

    expect(dedupeAgainstRendered([descriptive], [merchant]).rendered[0]?.required).toBe(false);
    expect(dedupeAgainstRendered([reachable], [merchant]).rendered[0]?.required).toBe(true);
  });

  // The invariant `ui/field-dedup.ts` claims for the promotion path: a
  // promotion belongs to ONE render. `FIELDS` is a module-level constant
  // shared by every mount for the lifetime of the page, so a merchant's
  // requirement written INTO it would outlive the visitor it was meant for —
  // the next form built from the same module would demand a phone number
  // nobody asked for, and no amount of reconfiguring would clear it.
  //
  // Asserted on the promotion path itself, and deliberately self-contained:
  // an in-place `required = true` on the shared spec still satisfies every
  // other test here, and is caught by them only through the order they happen
  // to run in. This one fails on its own.
  it('leaves the next mount unpromoted, from the same module instance', () => {
    webformView([field('Phone number', 'phone', true)]);
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(true);
    expect(labelFor('dh-webform-phone')).toBe('Phone');

    webformView([]);
    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(false);
    expect(labelFor('dh-webform-phone')).toBe('Phone (optional)');
  });

  // The mirror-image regression. A merchant who marked a field optional must
  // not find the built-in mandatory — promotion follows the dropped field's
  // own `required`, never the mere fact that something was dropped.
  it('does NOT promote when the dropped duplicate was optional', async () => {
    const onSubmit = vi.fn(async () => receipt);
    webformView([field('Phone number', 'phone')], onSubmit);

    expect($<HTMLInputElement>('#dh-webform-phone').required).toBe(false);
    expect(labelFor('dh-webform-phone')).toBe('Phone (optional)');

    await submitWebform();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // A no-op on the offline surface, whose own two are already required — on
  // the same code path anyway, so it cannot stop applying unnoticed if one of
  // them ever becomes optional.
  it('changes nothing on the offline form, whose built-ins are already required', () => {
    offline([field('Your name', 'text', true), field('Email address', 'email', true)]);

    expect($<HTMLInputElement>('#dh-offline-name').required).toBe(true);
    expect($<HTMLInputElement>('#dh-offline-contact').required).toBe(true);
    expect(labelFor('dh-offline-name')).toBe('Name');
    expect(labelFor('dh-offline-contact')).toBe('Email or phone');
  });
});
