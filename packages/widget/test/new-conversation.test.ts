// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNewConversationScreen } from '../src/ui/new-conversation.js';
import type { ConversationTopic } from '../src/remote-config.js';

const TOPICS: readonly ConversationTopic[] = [
  { id: 'delivery', label: 'Delivery issue' },
  { id: 'refund', label: 'Refund request' },
];

function build(topics: readonly ConversationTopic[] = TOPICS) {
  const onStart = vi.fn<(input: { topic?: string; message: string }) => Promise<void>>(async () => undefined);
  const onCancel = vi.fn();
  const onError = vi.fn();
  const screen = createNewConversationScreen(topics, { onStart, onCancel, onError });
  document.body.appendChild(screen.node);
  return { screen, onStart, onCancel, onError };
}

const chips = (screen: { node: HTMLElement }) => [...screen.node.querySelectorAll<HTMLButtonElement>('.dh-topic-chip')];
const message = (screen: { node: HTMLElement }) => screen.node.querySelector<HTMLTextAreaElement>('.dh-newconvo-message')!;
const submit = (screen: { node: HTMLElement }) => screen.node.querySelector<HTMLButtonElement>('.dh-form-submit')!;

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
