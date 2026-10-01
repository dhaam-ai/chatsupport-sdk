// @vitest-environment node
//
// `metadata.input.type` on a bot message (chatbot-workflows.md §9.4, §11.2):
// the flow just asked a question of a known kind, so the composer's keyboard and
// prompt should match. Typing stays allowed — the bot handles free text — so a
// hint only ever changes HOW the box asks, never whether it accepts.

import { describe, expect, it } from 'vitest';

import { readInputHint } from '../src/ui/input-hint.js';

describe('readInputHint', () => {
  it.each([
    ['email', 'email', 'email'],
    ['phone', 'tel', 'tel'],
    ['number', 'decimal', 'off'],
    ['order', 'text', 'off'],
  ] as const)('maps %s to the %s keyboard', (type, inputMode, autocomplete) => {
    const hint = readInputHint({ input: { type } });
    expect(hint?.type).toBe(type);
    expect(hint?.inputMode).toBe(inputMode);
    expect(hint?.autocomplete).toBe(autocomplete);
    expect(hint?.placeholder).not.toBe('');
  });

  it('asks for an order number the way the merchant’s customers write them', () => {
    expect(readInputHint({ input: { type: 'order' } })?.placeholder).toBe('e.g. DH-10482');
  });

  it('is null for plain text, unknown kinds, and anything malformed', () => {
    for (const metadata of [
      undefined,
      null,
      'x',
      4,
      [],
      {},
      { input: null },
      { input: 'email' },
      { input: {} },
      { input: { type: 'text' } },
      { input: { type: 'password' } },
      { input: { type: 5 } },
      { input: { type: 'EMAIL' } },
    ]) {
      expect(readInputHint(metadata)).toBeNull();
    }
  });
});
