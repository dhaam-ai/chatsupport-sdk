// @vitest-environment jsdom
//
// This is the one module that turns untrusted message text into elements, so
// the assertions below are weighted towards what must NEVER happen rather than
// towards matching cleverness.

import { describe, expect, it } from 'vitest';

import { findLinks, renderLinkified } from '../src/ui/linkify.js';

const render = (text: string): HTMLElement => {
  const node = document.createElement('p');
  renderLinkified(node, text);
  return node;
};

const hrefs = (node: HTMLElement) =>
  [...node.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('what must never happen', () => {
  // The whole reason this file is allowed to exist. If any of these regress,
  // the widget is injecting markup into a merchant's checkout page.
  it('never parses markup out of message text', () => {
    const node = render('<img src=x onerror=alert(1)> and <b>bold</b>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('b')).toBeNull();
    expect(node.textContent).toBe('<img src=x onerror=alert(1)> and <b>bold</b>');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
  ])('never builds a %s link', (_label, text) => {
    const node = render(`click ${text} now`);
    expect(node.querySelectorAll('a')).toHaveLength(0);
    // The text survives verbatim — it is simply not interactive.
    expect(node.textContent).toContain(text);
  });

  // A link whose visible text disagrees with its destination is phishing, and
  // the text here is written by whoever is on the other end of the chat.
  it('shows exactly the text that was written, never a prettified version', () => {
    const node = render('go to https://example.com/a/very/long/path?x=1');
    const anchor = node.querySelector('a')!;
    expect(anchor.textContent).toBe('https://example.com/a/very/long/path?x=1');
    expect(anchor.getAttribute('href')).toBe('https://example.com/a/very/long/path?x=1');
  });

  it('does not leak the merchant’s page URL to whatever was linked', () => {
    const anchor = render('https://example.com').querySelector('a')!;
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.getAttribute('target')).toBe('_blank');
  });
});

describe('what it matches', () => {
  it('links absolute http(s) URLs', () => {
    expect(hrefs(render('see https://example.com and http://foo.test'))).toEqual([
      'https://example.com',
      'http://foo.test',
    ]);
  });

  // People type these constantly and mean a link. Promoted to https rather
  // than left schemeless, which would resolve against the HOST page's origin.
  it('links a bare www. host, over https', () => {
    expect(hrefs(render('visit www.example.com'))).toEqual(['https://www.example.com']);
  });

  it('links email addresses as mailto:', () => {
    expect(hrefs(render('write to help@example.com'))).toEqual(['mailto:help@example.com']);
  });

  it('links several in one message, in order, keeping the text between them', () => {
    const node = render('a https://one.test b help@two.test c');
    expect(hrefs(node)).toEqual(['https://one.test', 'mailto:help@two.test']);
    expect(node.textContent).toBe('a https://one.test b help@two.test c');
  });
});

describe('what it deliberately leaves alone', () => {
  // Under-matching is the harmless direction: the text simply stays plain.
  // Over-matching produces links that go somewhere the sentence did not say.
  it.each([
    ['a bare domain', 'read faq.md for details'],
    ['a filename', 'open report.txt'],
    ['plain prose', 'no links at all here'],
  ])('does not link %s', (_label, text) => {
    expect(render(text).querySelectorAll('a')).toHaveLength(0);
  });

  it('leaves sentence punctuation out of the link', () => {
    expect(hrefs(render('see https://example.com.'))).toEqual(['https://example.com']);
    expect(hrefs(render('see https://example.com, then'))).toEqual(['https://example.com']);
    expect(render('see https://example.com.').textContent).toBe('see https://example.com.');
  });

  // Balanced brackets are legitimately part of a URL; an unmatched one closed
  // something in the sentence around it.
  it('keeps balanced brackets and drops unmatched ones', () => {
    expect(hrefs(render('see https://example.com/a_(b)_c'))).toEqual([
      'https://example.com/a_(b)_c',
    ]);
    expect(hrefs(render('(see https://example.com)'))).toEqual(['https://example.com']);
  });
});

describe('findLinks', () => {
  it('is not confused by being called twice', () => {
    // The patterns are module-level and global, so a stale `lastIndex` would
    // make the second call silently skip the start of the string.
    expect(findLinks('https://a.test')).toHaveLength(1);
    expect(findLinks('https://a.test')).toHaveLength(1);
  });

  it('never returns overlapping matches', () => {
    const links = findLinks('https://example.com/?to=help@example.com');
    for (let i = 1; i < links.length; i += 1) {
      expect(links[i]!.start).toBeGreaterThanOrEqual(links[i - 1]!.end);
    }
  });

  it('returns nothing for an empty string', () => {
    expect(findLinks('')).toEqual([]);
  });
});
