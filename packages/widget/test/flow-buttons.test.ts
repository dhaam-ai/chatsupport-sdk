// @vitest-environment node
//
// `metadata.buttons` — the buttons a server-side flow attaches to a bot message
// (chatbot-workflows.md §9.4, §11.2). Pure parsing; the render and the send are
// covered in flow-buttons-mount.test.ts.
//
// Two rules that differ from the LLM's `metadata.options`:
//   - the tenant's handoff keywords do NOT filter them. The merchant wrote
//     these buttons, so "Talk to a person" is exactly what they meant it to be,
//     and the flow engine (not the widget) decides what it does;
//   - a tap carries `flow_reply` metadata so the engine matches it to the
//     button by id rather than by guessing at the label.

import { describe, expect, it } from 'vitest';

import { readSuggestions } from '../src/ui/quick-replies.js';

const KEYWORDS = ['agent', 'human', 'person', 'speak to someone'];

const flow = { runId: 'run-1', stepId: 'choose', kind: 'buttons' };

describe('readSuggestions with flow buttons', () => {
  it('turns buttons into chips that remember which button and step they answer', () => {
    const chips = readSuggestions(
      {
        flow,
        buttons: [
          { id: 'b1', label: 'Payment failed' },
          { id: 'b2', label: 'Change address' },
        ],
        options: ['Payment failed', 'Change address'],
      },
      KEYWORDS,
    );
    expect(chips).toEqual([
      { label: 'Payment failed', reply: { runId: 'run-1', stepId: 'choose', buttonId: 'b1' } },
      { label: 'Change address', reply: { runId: 'run-1', stepId: 'choose', buttonId: 'b2' } },
    ]);
  });

  it('does not apply the handoff-keyword filter to a merchant-written button', () => {
    const chips = readSuggestions({ flow, buttons: [{ id: 'b1', label: 'Talk to a person' }] }, KEYWORDS);
    expect(chips.map((c) => c.label)).toEqual(['Talk to a person']);
  });

  it('prefers buttons over options when both are present', () => {
    const chips = readSuggestions({ flow, buttons: [{ id: 'b1', label: 'Yes' }], options: ['Something else'] }, KEYWORDS);
    expect(chips.map((c) => c.label)).toEqual(['Yes']);
  });

  it('keeps the button but drops the flow reference when the flow block is missing or malformed', () => {
    for (const bad of [undefined, null, {}, { runId: 1, stepId: 'x' }, { runId: 'r' }, { runId: '', stepId: 'x' }, 'x']) {
      const chips = readSuggestions({ flow: bad, buttons: [{ id: 'b1', label: 'Yes' }] }, KEYWORDS);
      expect(chips).toEqual([{ label: 'Yes' }]);
    }
  });

  it('drops malformed buttons, trims labels, and de-duplicates by id', () => {
    const chips = readSuggestions(
      {
        flow,
        buttons: [
          { id: 'b1', label: '  Yes  ' },
          { id: 'b1', label: 'Duplicate id' },
          { id: '', label: 'No id' },
          { id: 'b3', label: '   ' },
          { id: 'b4' },
          { label: 'no id at all' },
          'x',
          null,
          { id: 5, label: 'numeric id' },
          { id: 'b6', label: 'x'.repeat(81) },
          { id: 'b7', label: 'x'.repeat(80) },
        ],
      },
      KEYWORDS,
    );
    expect(chips.map((c) => c.reply?.buttonId)).toEqual(['b1', 'b7']);
    expect(chips[0]?.label).toBe('Yes');
  });

  it('shows at most 6 buttons', () => {
    const buttons = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, label: `Option ${i}` }));
    expect(readSuggestions({ flow, buttons }, KEYWORDS)).toHaveLength(6);
  });

  it('falls back to the LLM options, still filtered, when there are no usable buttons', () => {
    for (const buttons of [undefined, [], 'nope', [{ id: '', label: '' }]]) {
      const chips = readSuggestions({ flow, buttons, options: ['Track my order', 'Talk to a person'] }, KEYWORDS);
      expect(chips).toEqual([{ label: 'Track my order' }]);
    }
  });

  it('is empty for metadata that is not an object, and never throws', () => {
    for (const metadata of [undefined, null, 'x', 4, []]) {
      expect(readSuggestions(metadata, KEYWORDS)).toEqual([]);
    }
  });
});
