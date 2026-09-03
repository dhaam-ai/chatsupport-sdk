// @vitest-environment jsdom
//
// Focused on what this file's slices changed: the box that nests the icon row
// inside the input's own border, the link popover that replaced the browser
// prompt, and the suggestion path (`submit(text)`) the bot's chips go
// through. Every other composer behaviour (attach, emoji, mic, typed send)
// already has incidental coverage across the integration suites
// (remote-config-gating.test.ts, widget-dom.test.ts, connecting-state.test.ts
// and others) and is left alone here rather than backfilled — see the
// incremental-implementation discipline this package is built under: touch
// what the task requires.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createComposer } from '../src/ui/composer.js';
import type { ComposerCallbacks, ComposerView } from '../src/ui/composer.js';

// Every composer built in a test is destroyed after it: an open popover holds
// document-level listeners, and one left behind would swallow the next
// test's Escape.
const built: ComposerView[] = [];

function build(overrides: Partial<ComposerCallbacks> = {}) {
  const onSend = vi.fn(async () => undefined);
  const onSendAttachment = vi.fn(async () => undefined);
  const onTyping = vi.fn();
  const onError = vi.fn();
  const onCancelReply = vi.fn();
  const composer = createComposer({
    onSend,
    onSendAttachment,
    onTyping,
    onError,
    onCancelReply,
    ...overrides,
  });
  document.body.appendChild(composer.node);
  built.push(composer);
  return { composer, onSend, onSendAttachment, onTyping, onError, onCancelReply };
}

const input = (composer: ComposerView) => composer.node.querySelector<HTMLTextAreaElement>('.dh-input')!;
const sendButton = (composer: ComposerView) => composer.node.querySelector<HTMLButtonElement>('.dh-send')!;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const composer of built.splice(0)) composer.destroy();
  vi.unstubAllGlobals();
});

describe('the icon row nests inside the input’s own border', () => {
  it('wraps the textarea and the icon row in one .dh-composer-box', () => {
    const { composer } = build();
    const box = composer.node.querySelector('.dh-composer-box');
    expect(box).not.toBeNull();
    expect(box?.querySelector('.dh-input')).not.toBeNull();
    expect(box?.querySelector('.dh-composer-row')).not.toBeNull();
  });

  it('keeps attach, emoji, mic, link and send inside the row, in that order — not beside the box', () => {
    const { composer } = build();
    const row = composer.node.querySelector('.dh-composer-box .dh-composer-row')!;
    // Direct children only: the emoji picker's own node is a wrapper that
    // also carries a hidden popover full of emoji-cell buttons, and a deep
    // querySelectorAll('button') would pick those up too.
    const directChildLabels = [...row.children].map((child) =>
      child.matches('button')
        ? child.getAttribute('aria-label')
        : (child.querySelector('button')?.getAttribute('aria-label') ?? null),
    );
    expect(directChildLabels).toEqual([
      'Attach a file',
      'Insert emoji', // the emoji picker's own trigger, inside its wrapper node
      'Record a voice message',
      'Insert a link',
      'Send message',
      null, // the hidden file input, last — see ui/dom.ts's .dh-file
    ]);
  });

  it('the textarea is a direct child of the box, not of the icon row', () => {
    const { composer } = build();
    const box = composer.node.querySelector('.dh-composer-box')!;
    expect(box.querySelector(':scope > .dh-input')).not.toBeNull();
    expect(box.querySelector('.dh-composer-row > .dh-input')).toBeNull();
  });
});

describe('the link popover', () => {
  const linkButton = (composer: ComposerView) =>
    composer.node.querySelector<HTMLButtonElement>('button[aria-label="Insert a link"]')!;
  const popover = (composer: ComposerView) => composer.node.querySelector<HTMLFormElement>('.dh-link-popover')!;
  const urlField = (composer: ComposerView) => popover(composer).querySelector<HTMLInputElement>('input[type="url"]')!;
  const insertButton = (composer: ComposerView) =>
    popover(composer).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const cancelButton = (composer: ComposerView) => popover(composer).querySelector<HTMLButtonElement>('.dh-link-cancel')!;
  const error = (composer: ComposerView) => popover(composer).querySelector<HTMLElement>('.dh-link-error')!;

  const REJECTION = 'That does not look like a valid https:// link.';

  it('lives inside the composer box and starts closed', () => {
    const { composer } = build();
    expect(composer.node.querySelector('.dh-composer-box > .dh-link-popover')).not.toBeNull();
    expect(popover(composer).hidden).toBe(true);
    expect(linkButton(composer).getAttribute('aria-expanded')).toBe('false');
  });

  // The whole point of the slice: the host page's dialog is never involved.
  it('never touches the browser prompt', () => {
    const prompt = vi.fn();
    vi.stubGlobal('prompt', prompt);
    const { composer } = build();
    linkButton(composer).click();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('opens on the link button, reports it to assistive tech, and focuses the URL field', () => {
    const { composer } = build();
    linkButton(composer).click();

    expect(popover(composer).hidden).toBe(false);
    expect(linkButton(composer).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(urlField(composer));
  });

  it('keeps the browser’s own URL validation out of it — safeLinkUrl is the one validator', () => {
    const { composer } = build();
    expect(popover(composer).noValidate).toBe(true);
    expect(urlField(composer).getAttribute('inputmode')).toBe('url');
    expect(urlField(composer).getAttribute('autocomplete')).toBe('off');
  });

  it('inserts a valid https URL at the caret, treats it like a keystroke, and closes', () => {
    const { composer, onTyping } = build();
    const field = input(composer);
    field.value = 'See here: !';
    field.setSelectionRange(10, 10); // right before "!"

    linkButton(composer).click();
    urlField(composer).value = 'https://x.test';
    insertButton(composer).click();

    expect(field.value).toBe('See here: https://x.test!');
    expect(onTyping).toHaveBeenCalledTimes(1);
    expect(popover(composer).hidden).toBe(true);
    expect(linkButton(composer).getAttribute('aria-expanded')).toBe('false');
    // Focus goes back to where the customer was typing, not to the trigger.
    expect(document.activeElement).toBe(field);
  });

  it('enables Send when the link is the only content', () => {
    const { composer } = build();
    expect(sendButton(composer).disabled).toBe(true);

    linkButton(composer).click();
    urlField(composer).value = 'https://example.com/order/42';
    insertButton(composer).click();

    expect(input(composer).value).toBe('https://example.com/order/42');
    expect(sendButton(composer).disabled).toBe(false);
  });

  it.each(['javascript:alert(1)', 'foo'])(
    'rejects %j with an error inside the popover and stays open',
    (raw) => {
      const { composer, onTyping } = build();
      linkButton(composer).click();
      urlField(composer).value = raw;
      insertButton(composer).click();

      expect(input(composer).value).toBe('');
      expect(onTyping).not.toHaveBeenCalled();
      expect(popover(composer).hidden).toBe(false);
      expect(error(composer).hidden).toBe(false);
      expect(error(composer).textContent).toBe(REJECTION);
      expect(urlField(composer).getAttribute('aria-invalid')).toBe('true');
      // Left in place to be corrected, and focus stays on it.
      expect(urlField(composer).value).toBe(raw);
      expect(document.activeElement).toBe(urlField(composer));
      // The composer's own error line is not where this lands any more.
      expect(composer.node.querySelector<HTMLElement>('.dh-error')!.hidden).toBe(true);
    },
  );

  it('opens fresh after a rejection was cancelled — no stale value or error', () => {
    const { composer } = build();
    linkButton(composer).click();
    urlField(composer).value = 'foo';
    insertButton(composer).click();
    cancelButton(composer).click();

    linkButton(composer).click();

    expect(urlField(composer).value).toBe('');
    expect(error(composer).hidden).toBe(true);
    expect(urlField(composer).getAttribute('aria-invalid')).toBe('false');
  });

  it('Cancel closes it without inserting and returns focus to the link button', () => {
    const { composer, onTyping } = build();
    linkButton(composer).click();
    urlField(composer).value = 'https://x.test';
    cancelButton(composer).click();

    expect(popover(composer).hidden).toBe(true);
    expect(input(composer).value).toBe('');
    expect(onTyping).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(linkButton(composer));
  });

  // Load-bearing, as for the emoji picker: the panel has its own Escape
  // handler that closes the whole conversation.
  it('Escape closes it, returns focus to the link button, and does not reach the panel', () => {
    const { composer } = build();
    linkButton(composer).click();
    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);

    urlField(composer).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', panelHandler);

    expect(popover(composer).hidden).toBe(true);
    expect(document.activeElement).toBe(linkButton(composer));
    expect(panelHandler).not.toHaveBeenCalled();
  });

  it('lets an Escape through while it is closed', () => {
    build();
    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', panelHandler);
    expect(panelHandler).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside pointerdown and returns focus to the link button', () => {
    const { composer } = build();
    linkButton(composer).click();
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(popover(composer).hidden).toBe(true);
    expect(document.activeElement).toBe(linkButton(composer));
  });

  it('stays open on a pointerdown inside itself', () => {
    const { composer } = build();
    linkButton(composer).click();
    urlField(composer).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(popover(composer).hidden).toBe(false);
  });

  it('closes when the link button is pressed again', () => {
    const { composer } = build();
    linkButton(composer).click();
    linkButton(composer).click();
    expect(popover(composer).hidden).toBe(true);
  });

  it('is disabled and will not open while the composer is disabled', () => {
    const { composer } = build();
    composer.setEnabled(false);
    expect(linkButton(composer).disabled).toBe(true);
    // A disabled button swallows a real click; a synthetic event may not, and
    // the rule has to hold for it too.
    linkButton(composer).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover(composer).hidden).toBe(true);
  });

  it('is disabled and will not open while an attachment is uploading', () => {
    const { composer } = build();
    composer.setUploading(true);
    expect(linkButton(composer).disabled).toBe(true);
    linkButton(composer).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover(composer).hidden).toBe(true);
  });

  // A disabled trigger with an open popover is unreachable and unclosable by
  // pointer — same rule the emoji picker applies to itself.
  it('closes rather than stranding itself when the composer is disabled while it is open', () => {
    const { composer } = build();
    linkButton(composer).click();
    composer.setEnabled(false);
    expect(popover(composer).hidden).toBe(true);
    expect(linkButton(composer).getAttribute('aria-expanded')).toBe('false');
  });

  it('releases its document listeners on destroy', () => {
    const { composer } = build();
    linkButton(composer).click();
    composer.destroy();

    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', panelHandler);

    // If the popover were still listening it would have swallowed this.
    expect(panelHandler).toHaveBeenCalledTimes(1);
  });
});

describe('submit(text) — the bot’s suggestion chips', () => {
  // The bug this guards against: gating on the Send button's disabled state
  // refused every chip, because Send is disabled whenever the box is empty —
  // which is exactly the state a chip is tapped in.
  it('sends the suggestion from an empty box and leaves the box empty', async () => {
    const { composer, onSend } = build();
    expect(sendButton(composer).disabled).toBe(true);

    await composer.submit('Check my account');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Check my account');
    expect(input(composer).value).toBe('');
    expect(sendButton(composer).disabled).toBe(true);
  });

  it('refuses to overwrite a draft the customer is typing', async () => {
    const { composer, onSend } = build();
    input(composer).value = 'my order was ';

    await composer.submit('Check my account');

    expect(onSend).not.toHaveBeenCalled();
    expect(input(composer).value).toBe('my order was ');
  });

  it('is a no-op while the composer is disabled — the consent gate holds', async () => {
    const { composer, onSend } = build();
    composer.setEnabled(false);

    await composer.submit('Check my account');

    expect(onSend).not.toHaveBeenCalled();
    expect(input(composer).value).toBe('');
  });

  it('is a no-op while an attachment is uploading', async () => {
    const { composer, onSend } = build();
    composer.setUploading(true);

    await composer.submit('Check my account');

    expect(onSend).not.toHaveBeenCalled();
    expect(input(composer).value).toBe('');
  });

  it('ignores a blank suggestion', async () => {
    const { composer, onSend } = build();
    await composer.submit('   ');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('the reply chip', () => {
  const chip = (composer: ComposerView) => composer.node.querySelector<HTMLElement>('.dh-reply-chip')!;

  it('is hidden until a reply starts', () => {
    const { composer } = build();
    expect(chip(composer).hidden).toBe(true);
  });

  it('shows WHO is being quoted above their words — not a bare excerpt', () => {
    const { composer } = build();
    composer.setReplyTo({ senderName: 'Priya', excerpt: 'Refunded.' });

    expect(chip(composer).hidden).toBe(false);
    expect(chip(composer).querySelector('.dh-reply-name')?.textContent).toBe('Priya');
    expect(chip(composer).querySelector('.dh-reply-excerpt')?.textContent).toBe('Refunded.');
  });

  it('clears back to hidden, with no stale text for the next reply to flash', () => {
    const { composer } = build();
    composer.setReplyTo({ senderName: 'Priya', excerpt: 'Refunded.' });
    composer.setReplyTo(null);

    expect(chip(composer).hidden).toBe(true);
    expect(chip(composer).querySelector('.dh-reply-name')?.textContent).toBe('');
    expect(chip(composer).querySelector('.dh-reply-excerpt')?.textContent).toBe('');
  });

  it('routes the × through onCancelReply — the widget owns the reply state', () => {
    const { composer, onCancelReply } = build();
    composer.setReplyTo({ senderName: 'Priya', excerpt: 'Refunded.' });
    chip(composer).querySelector<HTMLButtonElement>('.dh-reply-clear')!.click();
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });
});
