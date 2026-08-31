// @vitest-environment node
//
// The matching rule behind `behaviour.handoffKeywords`. Pure, so no DOM.

import { describe, expect, it } from 'vitest';

import { asksForAHuman } from '../src/handoff-keywords.js';

/** The console's own shipped default list, lower-cased as the parser leaves it. */
const DEFAULTS = ['agent', 'human', 'person', 'speak to someone'];

describe('asksForAHuman', () => {
  it.each([
    'I want to talk to an agent',
    'can I speak to a human',
    'get me a real person',
    'speak to someone please',
  ])('escalates on %s', (text) => {
    expect(asksForAHuman(text, DEFAULTS)).toBe(true);
  });

  // THE trap this module exists for. A substring match on the console's own
  // default list escalates on all four of these, and a support conversation is
  // full of them — the bot would appear to give up at random.
  it.each([
    ['urgent', 'this is urgent'],
    ['management', 'escalate to management'],
    ['personal', 'this is a personal question'],
    ['personally', 'I personally think so'],
  ])('does not escalate on %s, which merely contains a keyword', (_label, text) => {
    expect(asksForAHuman(text, DEFAULTS)).toBe(false);
  });

  it('matches a keyword at the very start and very end', () => {
    expect(asksForAHuman('agent', DEFAULTS)).toBe(true);
    expect(asksForAHuman('agent please', DEFAULTS)).toBe(true);
    expect(asksForAHuman('give me an agent', DEFAULTS)).toBe(true);
  });

  it('matches regardless of how the visitor capitalised it', () => {
    expect(asksForAHuman('I need an AGENT', DEFAULTS)).toBe(true);
    expect(asksForAHuman('Human please', DEFAULTS)).toBe(true);
  });

  it('matches beside punctuation, which is not part of a word', () => {
    expect(asksForAHuman('agent!', DEFAULTS)).toBe(true);
    expect(asksForAHuman('can I get an agent?', DEFAULTS)).toBe(true);
    expect(asksForAHuman('"human"', DEFAULTS)).toBe(true);
  });

  // `\b` is defined against [A-Za-z0-9_], so it would put a boundary inside
  // "señor" and refuse one beside "日本語" — a customer typing a keyword in
  // their own language would never match. These pin the Unicode behaviour.
  it('works for keywords outside the Latin alphabet', () => {
    expect(asksForAHuman('quiero hablar con un asesor', ['asesor'])).toBe(true);
    expect(asksForAHuman('asesoramiento', ['asesor'])).toBe(false);
  });

  // Japanese, Chinese, Thai and friends do not put spaces between words, so
  // the keyword runs straight into the next character — which IS a letter. A
  // boundary rule would refuse every keyword these merchants could write, so
  // those scripts match as substrings, which is how matching in them is
  // normally done anyway.
  it.each([
    ['Japanese', '担当者とお話ししたい', '担当者'],
    ['Chinese', '我想找人工客服帮忙', '人工客服'],
    ['Thai', 'ฉันต้องการพนักงานตอนนี้', 'พนักงาน'],
  ])('matches a %s keyword with no spaces around it', (_label, text, keyword) => {
    expect(asksForAHuman(text, [keyword])).toBe(true);
  });

  // Each end is decided by the script at that end of the KEYWORD, so a mixed
  // keyword still gets a boundary on the side that needs one.
  it('still guards the Latin end of a mixed-script keyword', () => {
    expect(asksForAHuman('サポートJP へ', ['サポートJP'])).toBe(true);
    expect(asksForAHuman('サポートJPX', ['サポートJP'])).toBe(false);
  });

  it('treats a multi-word phrase as one unit', () => {
    expect(asksForAHuman('let me speak to someone', ['speak to someone'])).toBe(true);
    // The words are all present but not as the phrase.
    expect(asksForAHuman('speak to a someone', ['speak to someone'])).toBe(false);
  });

  // An empty list is how a merchant who set no keywords disables the feature.
  // Matching everything there would escalate every conversation on its first
  // word — the worst possible reading of "not configured".
  it.each([
    ['an empty list', 'I need an agent', []],
    ['an empty message', '   ', DEFAULTS],
  ])('matches nothing for %s', (_label, text, keywords) => {
    expect(asksForAHuman(text, keywords)).toBe(false);
  });

  // Merchant-supplied strings reach a RegExp constructor, so a keyword full of
  // metacharacters has to be matched literally rather than compiled as a
  // pattern — and above all must not throw and take the send path with it.
  it('treats regex metacharacters in a keyword literally', () => {
    expect(() => asksForAHuman('anything at all', ['a.*'])).not.toThrow();
    expect(asksForAHuman('anything at all', ['a.*'])).toBe(false);
    expect(asksForAHuman('is this a.* thing', ['a.*'])).toBe(true);
    expect(() => asksForAHuman('mismatched (paren', ['('])).not.toThrow();
  });
});
