// @vitest-environment jsdom
//
// The in-widget "End this conversation?" surface (ui/end-conversation.ts) in
// isolation: a pure DOM module taking callbacks, so everything here is
// assertable without a socket, a store or a mount — the same split
// product-surfaces.test.ts makes for the other forms. The widget-level half
// (the ⋯ menu opening it, `closeSession` running on confirm, the CSAT/ended
// footer following) lives in ended-conversation.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEndConversationConfirm } from '../src/ui/end-conversation.js';
import type { EndConversationCallbacks } from '../src/ui/end-conversation.js';

function build(overrides: Partial<EndConversationCallbacks> = {}) {
  const callbacks: EndConversationCallbacks = {
    onConfirm: vi.fn(async () => undefined),
    onCancel: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const view = createEndConversationConfirm(callbacks);
  document.body.innerHTML = '';
  document.body.appendChild(view.node);
  return { view, callbacks };
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

const confirmButton = () => $<HTMLButtonElement>('.dh-confirm-end .dh-form-submit');
const keepButton = () => $<HTMLButtonElement>('.dh-confirm-end-keep');

/** Lets the click handler's promise chain settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createEndConversationConfirm', () => {
  it('asks the question, offers the two answers, and names itself for assistive tech', () => {
    build();

    const heading = $('.dh-form-heading');
    expect(heading.textContent).toBe('End this conversation?');
    expect($('.dh-form-subtitle').textContent).toBe('You can always start a new one from Home or Messages.');
    expect(confirmButton().textContent).toBe('End conversation');
    expect(keepButton().textContent).toBe('Keep chatting');

    // Same landmark shape ui/new-conversation.ts uses: a group named by its
    // own heading, so a screen reader announces what the two buttons decide.
    const group = $('[role="group"]');
    expect(group.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
  });

  it('marks the destructive action as such without losing the shared submit treatment', () => {
    build();
    // Both classes: `.dh-form-submit` keeps the size/busy styling every other
    // commit action has, `.dh-confirm-end-danger` swaps only the colour.
    expect(confirmButton().classList.contains('dh-form-submit')).toBe(true);
    expect(confirmButton().classList.contains('dh-confirm-end-danger')).toBe(true);
  });

  it('confirm calls onConfirm and shows the busy label until it settles', async () => {
    let release = (): void => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    build({ onConfirm });

    confirmButton().click();
    await flush();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmButton().disabled).toBe(true);
    expect(confirmButton().textContent).toBe('Ending…');
    expect(confirmButton().getAttribute('aria-busy')).toBe('true');
    // The way out is parked too, so a cancel cannot tear the surface down
    // under a close whose outcome still has to land somewhere.
    expect(keepButton().disabled).toBe(true);

    release();
    await flush();
    // The caller tears the surface down on success; the button itself still
    // comes back to rest, which is `submitOnce`'s guarantee.
    expect(confirmButton().disabled).toBe(false);
    expect(confirmButton().textContent).toBe('End conversation');
    expect(keepButton().disabled).toBe(false);
  });

  it('a second press while one close is in flight is refused by the disabled button', async () => {
    let release = (): void => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    build({ onConfirm });

    confirmButton().click();
    await flush();
    confirmButton().click();
    await flush();

    // A disabled button dispatches no click in a real browser; jsdom honours
    // the same rule, so this pins that the busy state actually blocks.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });

  it('"Keep chatting" calls onCancel and never onConfirm', () => {
    const { callbacks } = build();
    keepButton().click();
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
  });

  it('a rejected onConfirm shows the failure message, reports it, and re-enables both buttons', async () => {
    const boom = new Error('close failed');
    const onError = vi.fn();
    build({
      onConfirm: vi.fn(async () => {
        throw boom;
      }),
      onError,
    });

    confirmButton().click();
    await flush();

    const status = $('.dh-form-error');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("We couldn't end this conversation. Please try again.");
    // The error goes to the host's tracker, never onto the screen verbatim.
    expect(onError).toHaveBeenCalledWith(boom);
    expect(status.textContent).not.toContain('close failed');

    expect(confirmButton().disabled).toBe(false);
    expect(confirmButton().textContent).toBe('End conversation');
    expect(keepButton().disabled).toBe(false);
  });

  it('focus() lands on "Keep chatting" — the safe answer, not the destructive one', () => {
    const { view } = build();
    view.focus();
    expect(document.activeElement).toBe(keepButton());
  });
});
