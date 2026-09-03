// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNewConversationScreen } from '../src/ui/new-conversation.js';
import type { NewConversationInput } from '../src/ui/new-conversation.js';
import type { FieldSpec } from '../src/ui/forms.js';
import type { ConversationTopic } from '../src/remote-config.js';

const TOPICS: readonly ConversationTopic[] = [
  { id: 'delivery', label: 'Delivery issue' },
  { id: 'refund', label: 'Refund request' },
];

const NAME: FieldSpec = { id: 'name', label: 'Your name', type: 'text', required: true };
const EMAIL: FieldSpec = { id: 'email', label: 'Email address', type: 'email', required: true };
const ORDER: FieldSpec = { id: 'order', label: 'Order number', type: 'text', required: false };

function build(topics: readonly ConversationTopic[] = TOPICS, preChatFields: readonly FieldSpec[] = []) {
  const onStart = vi.fn<(input: NewConversationInput) => Promise<void>>(async () => undefined);
  const onCancel = vi.fn();
  const onError = vi.fn();
  const screen = createNewConversationScreen(topics, { onStart, onCancel, onError }, preChatFields);
  document.body.appendChild(screen.node);
  return { screen, onStart, onCancel, onError };
}

const chips = (screen: { node: HTMLElement }) => [...screen.node.querySelectorAll<HTMLButtonElement>('.dh-topic-chip')];
const message = (screen: { node: HTMLElement }) => screen.node.querySelector<HTMLTextAreaElement>('.dh-newconvo-message')!;
const submit = (screen: { node: HTMLElement }) => screen.node.querySelector<HTMLButtonElement>('.dh-form-submit')!;
/** The pre-chat inputs only — the message textarea shares `.dh-field-input` but is not an `<input>`. */
const fieldInputs = (screen: { node: HTMLElement }) => [...screen.node.querySelectorAll<HTMLInputElement>('input.dh-field-input')];
const subtitle = (screen: { node: HTMLElement }) => screen.node.querySelector<HTMLElement>('.dh-form-subtitle')!;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createNewConversationScreen — topic chips', () => {
  it('renders one chip per configured topic, labelled with the console text', () => {
    const { screen } = build();
    expect(chips(screen).map((c) => c.textContent)).toEqual(['Delivery issue', 'Refund request']);
  });

  it('skips the chooser entirely when the merchant configured no topics', () => {
    const { screen } = build([]);
    expect(screen.node.querySelector<HTMLElement>('.dh-topics')?.hidden).toBe(true);
    expect(chips(screen)).toHaveLength(0);
  });

  it('selects a chip on tap, marking it aria-pressed', () => {
    const { screen } = build();
    chips(screen)[0]!.click();
    expect(chips(screen)[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(chips(screen)[1]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('allows only one selected chip at a time', () => {
    const { screen } = build();
    chips(screen)[0]!.click();
    chips(screen)[1]!.click();
    expect(chips(screen)[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(chips(screen)[1]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('tapping the same chip again clears the selection — "no topic" stays reachable', () => {
    const { screen } = build();
    chips(screen)[0]!.click();
    chips(screen)[0]!.click();
    expect(chips(screen)[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('never renders an "attach my active order" control', () => {
    const { screen } = build();
    expect(screen.node.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.node.textContent?.toLowerCase()).not.toContain('order');
  });
});

describe('createNewConversationScreen — starting', () => {
  it('refuses to start with an empty message, and focuses it', () => {
    const { screen, onStart } = build();
    submit(screen).click();

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.node.querySelector('.dh-form-error')?.textContent).toBe('Tell us what you need help with.');
    expect(document.activeElement).toBe(message(screen));
  });

  it('starts with just a message when no topic was picked — topic key absent, not empty', async () => {
    const { screen, onStart } = build();
    message(screen).value = 'Where is my order?';
    submit(screen).click();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledWith({ message: 'Where is my order?' });
    expect(onStart.mock.calls[0]![0]).not.toHaveProperty('topic');
  });

  it('sends the chip LABEL as topic, not its id', async () => {
    const { screen, onStart } = build();
    chips(screen)[0]!.click(); // Delivery issue
    message(screen).value = 'It never arrived';
    submit(screen).click();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledWith({ topic: 'Delivery issue', message: 'It never arrived' });
  });

  it('goes busy while starting, and re-enables with the message intact on failure', async () => {
    const onStart = vi.fn<(input: { topic?: string; message: string }) => Promise<void>>(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('nope')), 0)),
    );
    const screen = createNewConversationScreen(TOPICS, { onStart, onCancel: vi.fn(), onError: vi.fn() });
    document.body.appendChild(screen.node);

    message(screen).value = 'Hello';
    submit(screen).click();
    expect(submit(screen).disabled).toBe(true);
    expect(submit(screen).textContent).toBe('Starting…');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(submit(screen).disabled).toBe(false);
    expect(submit(screen).textContent).toBe('Start a new conversation');
    expect(screen.node.querySelector('.dh-form-error')?.textContent).toBe(
      "We couldn't start that conversation. Please try again.",
    );
    // The customer's typing survives a failed start, same rule every other
    // form in this package follows (ui/forms.ts's submitOnce).
    expect(message(screen).value).toBe('Hello');
  });

  it('routes a rejection to onError rather than putting it on screen', async () => {
    const boom = new Error('boom');
    const onError = vi.fn();
    const onStart = vi.fn<(input: { topic?: string; message: string }) => Promise<void>>(async () => {
      throw boom;
    });
    const screen = createNewConversationScreen(TOPICS, { onStart, onCancel: vi.fn(), onError });
    document.body.appendChild(screen.node);

    message(screen).value = 'Hello';
    submit(screen).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe('createNewConversationScreen — pre-chat fields folded in', () => {
  it('renders the configured fields above the chips and the message, under the same heading', () => {
    const { screen } = build(TOPICS, [NAME, EMAIL, ORDER]);

    // The heading is this screen's, not the gate's "Before we start": the
    // customer asked to start a conversation and that is still what this is.
    expect(screen.node.querySelector('.dh-form-heading')?.textContent).toBe('Start a new conversation');
    expect(subtitle(screen).hidden).toBe(false);
    expect(subtitle(screen).textContent).toBe('A few details so we can help you faster.');

    // Same `createField` the gate uses: labels in order, optional marked.
    const labels = [...screen.node.querySelectorAll('.dh-field-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Your name', 'Email address', 'Order number (optional)', 'Your message']);
    expect(fieldInputs(screen).map((i) => i.type)).toEqual(['text', 'email', 'text']);

    // ABOVE the chips and the message box, in DOM order.
    const lastField = fieldInputs(screen)[2]!;
    const topics = screen.node.querySelector('.dh-topics')!;
    expect(lastField.compareDocumentPosition(topics) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(topics.compareDocumentPosition(message(screen)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('renders no fields and no subtitle when given none', () => {
    const { screen } = build(TOPICS, []);
    expect(fieldInputs(screen)).toHaveLength(0);
    expect(subtitle(screen).hidden).toBe(true);
    // The message box is still the one field there is.
    expect(message(screen)).not.toBeNull();
  });

  it('keeps field ids clear of the message textarea, even for a merchant field called "message"', () => {
    const { screen } = build(TOPICS, [{ id: 'message', label: 'Message ref', type: 'text', required: false }]);
    const ids = [...screen.node.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('blocks Start on a missing required field, naming it and focusing it', () => {
    const { screen, onStart } = build(TOPICS, [NAME, EMAIL]);
    fieldInputs(screen)[0]!.value = 'Ada';
    message(screen).value = 'Hello';
    submit(screen).click();

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.node.querySelector('.dh-form-error')?.textContent).toBe('Email address is required.');
    expect(document.activeElement).toBe(fieldInputs(screen)[1]);
  });

  it('checks the details before the message — top to bottom, the order the customer reads', () => {
    const { screen, onStart } = build(TOPICS, [NAME]);
    submit(screen).click();

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.node.querySelector('.dh-form-error')?.textContent).toBe('Your name is required.');
  });

  it('passes the answers alongside topic and message, omitting a blank optional', async () => {
    const { screen, onStart } = build(TOPICS, [NAME, EMAIL, ORDER]);
    fieldInputs(screen)[0]!.value = '  Ada  ';
    fieldInputs(screen)[1]!.value = 'ada@example.com';
    chips(screen)[0]!.click(); // Delivery issue
    message(screen).value = 'It never arrived';
    submit(screen).click();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledWith({
      topic: 'Delivery issue',
      message: 'It never arrived',
      preChatAnswers: { name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('hands back an EMPTY record — not absence — when every optional field was left blank', async () => {
    const { screen, onStart } = build(TOPICS, [ORDER]);
    message(screen).value = 'Hello';
    submit(screen).click();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledWith({ message: 'Hello', preChatAnswers: {} });
  });

  it('leaves preChatAnswers absent when no fields were rendered', async () => {
    const { screen, onStart } = build(TOPICS, []);
    message(screen).value = 'Hello';
    submit(screen).click();
    await Promise.resolve();

    expect(onStart.mock.calls[0]![0]).not.toHaveProperty('preChatAnswers');
  });

  it('focus() lands on the first detail field when there are any', () => {
    const { screen } = build(TOPICS, [NAME, EMAIL]);
    screen.focus();
    expect(document.activeElement).toBe(fieldInputs(screen)[0]);
  });
});

describe('createNewConversationScreen — cancel and focus', () => {
  it('calls onCancel when the customer backs out', () => {
    const { screen, onCancel } = build();
    screen.node.querySelector<HTMLButtonElement>('.dh-form-skip')!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('focus() moves focus to the message field', () => {
    const { screen } = build();
    screen.focus();
    expect(document.activeElement).toBe(message(screen));
  });
});
