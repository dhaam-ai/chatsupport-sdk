// @vitest-environment jsdom
//
// Focused on what this slice changed: the box that now nests the icon row
// inside the input's own border, and the new link affordance. Every other
// composer behaviour (attach, emoji, mic, send) already has incidental
// coverage across the integration suites (remote-config-gating.test.ts,
// widget-dom.test.ts, connecting-state.test.ts and others) and is left alone
// here rather than backfilled — see the incremental-implementation
// discipline this package is built under: touch what the task requires.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createComposer } from '../src/ui/composer.js';
import type { ComposerCallbacks } from '../src/ui/composer.js';

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
  return { composer, onSend, onSendAttachment, onTyping, onError, onCancelReply };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
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

describe('the link affordance', () => {
  const linkButton = (composer: { node: HTMLElement }) =>
    composer.node.querySelector<HTMLButtonElement>('button[aria-label="Insert a link"]')!;
  const input = (composer: { node: HTMLElement }) => composer.node.querySelector<HTMLTextAreaElement>('.dh-input')!;

  it('inserts a valid https URL at the caret and treats it like a keystroke', () => {
    vi.stubGlobal('prompt', vi.fn(() => 'https://example.com/order/42'));
    const { composer, onTyping } = build();

    linkButton(composer).click();

    expect(input(composer).value).toBe('https://example.com/order/42');
    expect(onTyping).toHaveBeenCalled();
  });

  it('inserts at the caret position, not just appended', () => {
    vi.stubGlobal('prompt', vi.fn(() => 'https://x.test'));
    const { composer } = build();
    const field = input(composer);
    field.value = 'See here: !';
    field.setSelectionRange(10, 10); // right before "!"

    linkButton(composer).click();

    expect(field.value).toBe('See here: https://x.test!');
  });

  it('refuses a non-http(s) value and leaves the field untouched', () => {
    vi.stubGlobal('prompt', vi.fn(() => 'javascript:alert(1)'));
    const { composer } = build();

    linkButton(composer).click();

    expect(input(composer).value).toBe('');
    expect(composer.node.querySelector('.dh-error')?.textContent).toBe(
      'That does not look like a valid https:// link.',
    );
  });

  it('does nothing when the customer cancels the prompt', () => {
    vi.stubGlobal('prompt', vi.fn(() => null));
    const { composer, onTyping } = build();

    linkButton(composer).click();

    expect(input(composer).value).toBe('');
    expect(composer.node.querySelector<HTMLElement>('.dh-error')?.hidden).toBe(true);
    expect(onTyping).not.toHaveBeenCalled();
  });

  it('is disabled along with the other controls when the composer is disabled', () => {
    const { composer } = build();
    composer.setEnabled(false);
    expect(linkButton(composer).disabled).toBe(true);
  });

  it('is disabled while an attachment is uploading', () => {
    const { composer } = build();
    composer.setUploading(true);
    expect(linkButton(composer).disabled).toBe(true);
  });
});
