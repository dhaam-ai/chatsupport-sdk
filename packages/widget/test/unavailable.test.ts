// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createUnavailable, safeMailto } from '../src/ui/unavailable.js';

describe('safeMailto', () => {
  it('accepts an ordinary address', () => {
    expect(safeMailto('support@dhaam.com')).toBe('mailto:support@dhaam.com');
    expect(safeMailto('  help.desk+chat@sub.example.co.uk  ')).toBe(
      'mailto:help.desk+chat@sub.example.co.uk',
    );
  });

  // This value is merchant-supplied and lands in an `href`. A `mailto:` with a
  // newline or a `?` in it can append HEADERS to the message the customer is
  // about to send — a body, a bcc — so the shape is refused rather than
  // sanitised. Refusing renders no link, which this screen already handles.
  it.each([
    ['a newline', 'a@b.com\nbcc:someone@evil.test'],
    ['a carriage return', 'a@b.com\r\nbcc:x@evil.test'],
    ['a query string', 'a@b.com?body=hello'],
    ['an ampersand', 'a@b.com&cc=x@evil.test'],
    ['a second address', 'a@b.com,c@d.com'],
    ['a semicolon', 'a@b.com;c@d.com'],
    ['angle brackets', '<a@b.com>'],
    ['a space', 'a b@c.com'],
  ])('refuses %s', (_label, value) => {
    expect(safeMailto(value)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['no @', 'support.dhaam.com'],
    ['no domain dot', 'support@localhost'],
    ['no local part', '@dhaam.com'],
    ['absurdly long', `${'a'.repeat(300)}@b.com`],
  ])('refuses %s', (_label, value) => {
    expect(safeMailto(value)).toBeNull();
  });
});

describe('the unavailable screen', () => {
  const build = () => {
    const onRetry = vi.fn();
    const view = createUnavailable({ onRetry });
    document.body.append(view.node);
    return { view, onRetry };
  };

  it('starts hidden — it is not the widget’s resting state', () => {
    const { view } = build();
    expect(view.node.hidden).toBe(true);
  });

  it('says what happened and offers the way out', () => {
    const { view } = build();
    expect(view.node.querySelector('.dh-unavail-title')?.textContent).toBe(
      'Chat is temporarily unavailable',
    );
    expect(view.node.querySelector('.dh-unavail-retry')?.textContent).toBe('Try again');
  });

  it('retries through the caller’s own path', () => {
    const { view, onRetry } = build();
    view.node.querySelector<HTMLButtonElement>('.dh-unavail-retry')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the button and says so while a retry is in flight', () => {
    const { view } = build();
    view.update('', true);
    const retry = view.node.querySelector<HTMLButtonElement>('.dh-unavail-retry')!;
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe('Trying…');
  });

  // The rule this screen shares with the header menu's Privacy item: an
  // address nobody monitors is worse than admitting there is no second route,
  // because the customer waits on a reply that never comes.
  it('offers no email at all when the merchant configured none', () => {
    const { view } = build();
    view.update('', false);
    expect(view.node.querySelector<HTMLElement>('.dh-unavail-email')?.hidden).toBe(true);
  });

  it('offers the merchant’s address when there is one', () => {
    const { view } = build();
    view.update('support@dhaam.com', false);
    const link = view.node.querySelector<HTMLAnchorElement>('.dh-unavail-email')!;
    expect(link.hidden).toBe(false);
    expect(link.getAttribute('href')).toBe('mailto:support@dhaam.com');
    // The address is the link TEXT: somebody who cannot reach the chat may
    // want to copy it rather than trust a mailto: to open a client.
    expect(link.textContent).toBe('Email support@dhaam.com');
  });

  it('offers nothing rather than a link it could not make safe', () => {
    const { view } = build();
    view.update('a@b.com\nbcc:x@evil.test', false);
    expect(view.node.querySelector<HTMLElement>('.dh-unavail-email')?.hidden).toBe(true);
  });

  it('is announced assertively — there is nothing behind it to interrupt', () => {
    const { view } = build();
    expect(view.node.getAttribute('role')).toBe('alert');
  });
});
