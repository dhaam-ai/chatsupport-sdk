// @vitest-environment jsdom
//
// The ended-conversation footer — a pure DOM module taking three callbacks,
// same shape as the three data-collecting surfaces in product-surfaces.test.ts,
// so this is assertable the same way: no socket, no store, no widget mount.
//
// What widget.ts's own wiring (which session states show this footer, and
// what it replaces) is covered separately in ended-conversation.test.ts,
// through a real mount — this file is only about what happens once the two
// buttons exist on screen.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEndedFooter } from '../src/ui/ended-footer.js';

function mount(node: HTMLElement): void {
  document.body.innerHTML = '';
  document.body.appendChild(node);
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

/** Lets a submit handler's promise chain settle — same helper as product-surfaces.test.ts. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ended footer — "Reopen" / "New conversation"', () => {
  const callbacks = (onReopen = vi.fn().mockResolvedValue(undefined)) => ({
    onReopen,
    onStartNew: vi.fn(),
    onError: vi.fn(),
  });

  it('renders both actions', () => {
    mount(createEndedFooter(callbacks()).node);
    expect($('.dh-form-submit').textContent).toBe('Reopen conversation');
    expect($('.dh-ended-secondary').textContent).toBe('New conversation');
  });

  it('routes "New conversation" straight to the callback — no surface of its own', () => {
    const cb = callbacks();
    mount(createEndedFooter(cb).node);
    $<HTMLButtonElement>('.dh-ended-secondary').click();
    expect(cb.onStartNew).toHaveBeenCalledOnce();
  });

  it('calls onReopen when "Reopen" is pressed', async () => {
    const cb = callbacks();
    mount(createEndedFooter(cb).node);
    $<HTMLButtonElement>('.dh-form-submit').click();
    await flush();
    expect(cb.onReopen).toHaveBeenCalledOnce();
  });

  it('disables both buttons and shows the busy label while the reopen is in flight', async () => {
    let resolve!: () => void;
    const onReopen = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    mount(createEndedFooter(callbacks(onReopen)).node);

    $<HTMLButtonElement>('.dh-form-submit').click();
    await flush();

    const reopen = $<HTMLButtonElement>('.dh-form-submit');
    const startNew = $<HTMLButtonElement>('.dh-ended-secondary');
    expect(reopen.disabled).toBe(true);
    expect(reopen.textContent).toBe('Reopening…');
    // The secondary action is disabled too — see ui/ended-footer.ts's own
    // comment on why a customer must not start a fresh conversation while
    // this one's reopen is still in flight.
    expect(startNew.disabled).toBe(true);

    resolve();
    await flush();
    expect(reopen.disabled).toBe(false);
    expect(reopen.textContent).toBe('Reopen conversation');
    expect(startNew.disabled).toBe(false);
  });

  // The exact bug class ui/forms.ts's submitOnce exists to make unrepeatable
  // (see that module's own header) — a rejected reopen must not leave the
  // button stuck reading "Reopening…" with no way to try again.
  it('comes back to life with an inline error when the reopen rejects', async () => {
    const failure = new Error('network down');
    const cb = callbacks(vi.fn().mockRejectedValue(failure));
    mount(createEndedFooter(cb).node);

    $<HTMLButtonElement>('.dh-form-submit').click();
    await flush();

    const reopen = $<HTMLButtonElement>('.dh-form-submit');
    expect(reopen.disabled).toBe(false);
    expect(reopen.textContent).toBe('Reopen conversation');
    expect($('.dh-form-error').textContent).toBe(
      'We could not reopen this conversation. Please try again.',
    );
    // The raw error goes to the host's own error channel, never onto the
    // screen verbatim — same split every other surface in this package uses.
    expect(cb.onError).toHaveBeenCalledWith(failure);
    expect($('.dh-form-error').textContent).not.toContain('network down');
  });

  it('clears a previous error on the next attempt', async () => {
    const onReopen = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined);
    mount(createEndedFooter(callbacks(onReopen)).node);

    $<HTMLButtonElement>('.dh-form-submit').click();
    await flush();
    expect($('.dh-form-error').hidden).toBe(false);

    $<HTMLButtonElement>('.dh-form-submit').click();
    await flush();
    expect($('.dh-form-error').hidden).toBe(true);
  });
});
