// @vitest-environment jsdom
//
// The three data-collecting surfaces. Each is a pure DOM module taking a
// callback, so all of this is assertable without a socket, a store or a mount.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCsatSurvey } from '../src/ui/csat.js';
import { createOfflineForm } from '../src/ui/offline-form.js';
import { createPreChatForm } from '../src/ui/pre-chat-form.js';
import type { FieldSpec } from '../src/ui/forms.js';

const NAME: FieldSpec = { id: 'p1', label: 'Your name', type: 'text', required: true };
const EMAIL: FieldSpec = { id: 'p2', label: 'Email address', type: 'email', required: true };
const ORDER: FieldSpec = { id: 'p3', label: 'Order number', type: 'text', required: false };

function mount(node: HTMLElement): void {
  document.body.innerHTML = '';
  document.body.appendChild(node);
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

const $$ = <T extends HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
}

/** Lets the submit handler's promise chain settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('pre-chat form — "ask for details before chatting"', () => {
  it('renders one input per configured field, in order', () => {
    const view = createPreChatForm([NAME, EMAIL, ORDER], {
      onSubmit: async () => {},
      onSkip: () => {},
      onError: () => {},
    });
    mount(view.node);

    const labels = $$('.dh-field-label').map((l) => l.textContent);
    expect(labels[0]).toBe('Your name');
    expect(labels[1]).toBe('Email address');
    // Optional is marked, not required — the console's own convention.
    expect(labels[2]).toBe('Order number (optional)');
  });

  it('maps field types to the right input type and inputmode', () => {
    const view = createPreChatForm([NAME, EMAIL, { ...ORDER, type: 'phone' }], {
      onSubmit: async () => {},
      onSkip: () => {},
      onError: () => {},
    });
    mount(view.node);

    const inputs = $$<HTMLInputElement>('.dh-field-input');
    expect([inputs[0]?.type, inputs[1]?.type, inputs[2]?.type]).toEqual(['text', 'email', 'tel']);
    // The difference between a numeric keypad and a full keyboard on mobile.
    expect(inputs[2]?.getAttribute('inputmode')).toBe('tel');
  });

  it('associates every label with its input', () => {
    const view = createPreChatForm([NAME], { onSubmit: async () => {}, onSkip: () => {}, onError: () => {} });
    mount(view.node);
    expect($('.dh-field-label').getAttribute('for')).toBe($<HTMLInputElement>('.dh-field-input').id);
  });

  it('collects the answers keyed by field id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = createPreChatForm([NAME, EMAIL], { onSubmit, onSkip: () => {}, onError: () => {} });
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, '  Ada  ');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'ada@example.com');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith({ p1: 'Ada', p2: 'ada@example.com' });
  });

  it('omits an empty optional answer rather than sending a blank string', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = createPreChatForm([NAME, ORDER], { onSubmit, onSkip: () => {}, onError: () => {} });
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith({ p1: 'Ada' });
  });

  it('names the missing field and focuses it, rather than saying "fill in the fields above"', async () => {
    const onSubmit = vi.fn();
    const view = createPreChatForm([NAME, EMAIL], { onSubmit, onSkip: () => {}, onError: () => {} });
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Email address is required.');
    expect(document.activeElement).toBe($$('.dh-field-input')[1]);
  });

  // A skip link next to a required field tells the customer the merchant's
  // mandatory question is optional after all.
  it('offers Skip only when nothing is required', () => {
    const optionalOnly = createPreChatForm([ORDER], { onSubmit: async () => {}, onSkip: () => {}, onError: () => {} });
    mount(optionalOnly.node);
    expect(document.querySelector('.dh-form-skip')).not.toBeNull();

    const withRequired = createPreChatForm([NAME], { onSubmit: async () => {}, onSkip: () => {}, onError: () => {} });
    mount(withRequired.node);
    expect(document.querySelector('.dh-form-skip')).toBeNull();
  });

  it('uses the merchant greeting as the heading when there is one', () => {
    const view = createPreChatForm([NAME], { onSubmit: async () => {}, onSkip: () => {}, onError: () => {} }, 'Hi from Acme!');
    mount(view.node);
    expect($('.dh-form-heading').textContent).toBe('Hi from Acme!');
  });

  // The React originals leave the button stuck on "Sending…" forever when the
  // submit rejects. This is the one place that is fixed.
  it('comes back to life when the submit rejects', async () => {
    const onError = vi.fn();
    const view = createPreChatForm([NAME], {
      onSubmit: async () => {
        throw new Error('network down');
      },
      onSkip: () => {},
      onError,
    });
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    const submit = $<HTMLButtonElement>('.dh-form-submit');
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Start chat');
    expect($('.dh-form-error').textContent).toContain('could not start the chat');
    // The exception goes to the host's tracker, not onto the screen.
    expect(onError).toHaveBeenCalledOnce();
    expect($('.dh-form-error').textContent).not.toContain('network down');
    // The customer's typing survives.
    expect($$<HTMLInputElement>('.dh-field-input')[0]?.value).toBe('Ada');
  });
});

describe('offline form — out of hours', () => {
  const callbacks = (onSubmit = vi.fn().mockResolvedValue(undefined)) => ({
    onSubmit,
    onError: vi.fn(),
  });

  it('always asks for name, contact and a message', () => {
    const view = createOfflineForm([], callbacks());
    mount(view.node);
    expect($$('.dh-field-label').map((l) => l.textContent)).toEqual([
      'Name',
      'Email or phone',
      'How can we help?',
    ]);
  });

  // The console seeds every workspace with "Your name" and "Email address",
  // so without de-duplication every untouched merchant asks for a name twice.
  it('drops console fields that duplicate the built-ins', () => {
    const view = createOfflineForm([NAME, EMAIL, ORDER], callbacks());
    mount(view.node);
    const labels = $$('.dh-field-label').map((l) => l.textContent);
    expect(labels).toEqual(['Name', 'Email or phone', 'Order number (optional)', 'How can we help?']);
  });

  it('keeps a merchant field that merely CONTAINS a built-in word', () => {
    const view = createOfflineForm(
      [{ id: 'x', label: 'Name of the product you ordered', type: 'text', required: false }],
      callbacks(),
    );
    mount(view.node);
    expect($$('.dh-field-label').map((l) => l.textContent)).toContain(
      'Name of the product you ordered (optional)',
    );
  });

  it('flattens answered custom fields into the message body', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = createOfflineForm([ORDER], callbacks(onSubmit));
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'ada@example.com');
    type($$<HTMLInputElement>('.dh-field-input')[2]!, 'ORD-42');
    type($<HTMLTextAreaElement>('.dh-offline-message'), 'My parcel never arrived');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ada',
      contact: 'ada@example.com',
      message: 'My parcel never arrived\n\nOrder number: ORD-42',
    });
  });

  it('leaves an unanswered optional field out of the body entirely', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = createOfflineForm([ORDER], callbacks(onSubmit));
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'ada@example.com');
    type($<HTMLTextAreaElement>('.dh-offline-message'), 'Where is my order');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit.mock.calls[0]?.[0].message).toBe('Where is my order');
  });

  it.each([
    ['no name', { name: '', contact: 'a@b.c', message: 'a real message' }, 'Please add your name.'],
    ['no contact', { name: 'Ada', contact: '', message: 'a real message' }, 'Please add an email or phone number so we can reply.'],
    ['a too-short message', { name: 'Ada', contact: 'a@b.c', message: 'hi' }, 'Please tell us a little about what you need.'],
  ])('refuses %s with a specific reason', async (_label, values, expected) => {
    const onSubmit = vi.fn();
    const view = createOfflineForm([], callbacks(onSubmit));
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, values.name);
    type($$<HTMLInputElement>('.dh-field-input')[1]!, values.contact);
    type($<HTMLTextAreaElement>('.dh-offline-message'), values.message);
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe(expected);
  });

  it('enforces a required console field', async () => {
    const onSubmit = vi.fn();
    const view = createOfflineForm([{ ...ORDER, required: true }], callbacks(onSubmit));
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'a@b.c');
    type($<HTMLTextAreaElement>('.dh-offline-message'), 'a real message');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect($('.dh-form-error').textContent).toBe('Order number is required.');
  });

  // The form is spent once sent; leaving it up invites a duplicate from a
  // customer unsure the first one landed.
  it('replaces the form with a confirmation naming the contact', async () => {
    const view = createOfflineForm([], callbacks());
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'ada@example.com');
    type($<HTMLTextAreaElement>('.dh-offline-message'), 'My parcel never arrived');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($<HTMLFormElement>('form').hidden).toBe(true);
    const sent = $('.dh-offline-sent');
    expect(sent.hidden).toBe(false);
    expect(sent.textContent).toContain('ada@example.com');
    expect(document.activeElement).toBe(sent);
  });

  it('keeps the form up when the send rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'));
    const view = createOfflineForm([], callbacks(onSubmit));
    mount(view.node);

    type($$<HTMLInputElement>('.dh-field-input')[0]!, 'Ada');
    type($$<HTMLInputElement>('.dh-field-input')[1]!, 'a@b.c');
    type($<HTMLTextAreaElement>('.dh-offline-message'), 'a real message');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($<HTMLFormElement>('form').hidden).toBe(false);
    expect($('.dh-offline-sent').hidden).toBe(true);
    expect($<HTMLButtonElement>('.dh-form-submit').disabled).toBe(false);
  });
});

describe('CSAT survey', () => {
  const cb = (onSubmit = vi.fn().mockResolvedValue(undefined)) => ({ onSubmit, onError: vi.fn() });

  it('renders a five-option radiogroup', () => {
    mount(createCsatSurvey('stars', cb()).node);
    expect($('.dh-csat-scale').getAttribute('role')).toBe('radiogroup');
    const options = $$('.dh-csat-option');
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.getAttribute('role'))).toEqual(Array(5).fill('radio'));
  });

  it('names every option with its score and word', () => {
    mount(createCsatSurvey('stars', cb()).node);
    expect($$('.dh-csat-option').map((o) => o.getAttribute('aria-label'))).toEqual([
      '1 of 5 — Poor',
      '2 of 5 — Not great',
      '3 of 5 — Okay',
      '4 of 5 — Good',
      '5 of 5 — Excellent',
    ]);
  });

  // A star rating is "this many out of five".
  it('fills stars cumulatively', () => {
    mount(createCsatSurvey('stars', cb()).node);
    $$('.dh-csat-option')[3]?.click();
    expect($$('.dh-csat-option').map((o) => o.classList.contains('dh-csat-lit'))).toEqual([
      true, true, true, true, false,
    ]);
    expect($$('.dh-csat-glyph').map((g) => g.textContent)).toEqual(['★', '★', '★', '★', '☆']);
  });

  // Faces are five different answers, not a quantity — a cumulative row would
  // claim the customer felt every mood up to the one they chose.
  it('lights exactly one face', () => {
    mount(createCsatSurvey('emoji', cb()).node);
    $$('.dh-csat-option')[3]?.click();
    expect($$('.dh-csat-option').map((o) => o.classList.contains('dh-csat-lit'))).toEqual([
      false, false, false, true, false,
    ]);
    expect($$('.dh-csat-glyph').map((g) => g.textContent)).toEqual(['😞', '🙁', '😐', '🙂', '😄']);
  });

  it('marks exactly one option checked', () => {
    mount(createCsatSurvey('stars', cb()).node);
    $$('.dh-csat-option')[2]?.click();
    expect($$('.dh-csat-option').map((o) => o.getAttribute('aria-checked'))).toEqual([
      'false', 'false', 'true', 'false', 'false',
    ]);
  });

  it('shows the word for the current score', () => {
    mount(createCsatSurvey('stars', cb()).node);
    expect($('.dh-csat-label').textContent).toBe('');
    $$('.dh-csat-option')[4]?.click();
    expect($('.dh-csat-label').textContent).toBe('Excellent');
  });

  it('hides the comment box and submit until a score exists', () => {
    mount(createCsatSurvey('stars', cb()).node);
    expect($('.dh-csat-comment').hidden).toBe(true);
    $$('.dh-csat-option')[0]?.click();
    expect($('.dh-csat-comment').hidden).toBe(false);
  });

  it('submits the score and a trimmed comment', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount(createCsatSurvey('stars', cb(onSubmit)).node);

    $$('.dh-csat-option')[4]?.click();
    type($<HTMLTextAreaElement>('#dh-csat-comment'), '  brilliant  ');
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(5, 'brilliant');
  });

  it('sends undefined rather than an empty comment', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount(createCsatSurvey('stars', cb(onSubmit)).node);

    $$('.dh-csat-option')[2]?.click();
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(3, undefined);
  });

  it('thanks the customer once it lands', async () => {
    mount(createCsatSurvey('stars', cb()).node);
    $$('.dh-csat-option')[3]?.click();
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($<HTMLFormElement>('form').hidden).toBe(true);
    expect($('.dh-csat-thanks').hidden).toBe(false);
  });

  it('keeps the rating on screen when the submit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'));
    mount(createCsatSurvey('stars', cb(onSubmit)).node);

    $$('.dh-csat-option')[3]?.click();
    $<HTMLFormElement>('form').requestSubmit();
    await flush();

    expect($<HTMLFormElement>('form').hidden).toBe(false);
    expect($<HTMLButtonElement>('.dh-form-submit').disabled).toBe(false);
    expect($('.dh-form-error').textContent).toContain('could not send your feedback');
  });

  it('renders the thanks state directly for an already-rated thread', () => {
    const view = createCsatSurvey('stars', cb());
    mount(view.node);
    view.markSubmitted();
    expect($('.dh-csat-thanks').hidden).toBe(false);
  });

  describe('keyboard', () => {
    it.each([
      ['ArrowRight', 0, 2],
      ['ArrowLeft', 2, 2],
      ['ArrowUp', 2, 2],
    ])('%s from score %i moves to score %i', (key, startIndex, expected) => {
      mount(createCsatSurvey('stars', cb()).node);
      const options = $$('.dh-csat-option');
      options[startIndex]?.click();
      options[startIndex]?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect($('.dh-csat-label').textContent).toBe(
        ['Poor', 'Not great', 'Okay', 'Good', 'Excellent'][expected - 1],
      );
    });

    // Clamped, not wrapping: wrapping from Excellent round to Poor would let
    // one extra keypress set the opposite of what the customer meant.
    it('clamps at both ends rather than wrapping', () => {
      mount(createCsatSurvey('stars', cb()).node);
      const options = $$('.dh-csat-option');

      options[4]?.click();
      options[4]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect($('.dh-csat-label').textContent).toBe('Excellent');

      options[0]?.click();
      options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect($('.dh-csat-label').textContent).toBe('Poor');
    });
  });
});
