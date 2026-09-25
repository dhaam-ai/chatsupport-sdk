// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseFlowSteps } from '../src/flow/parse.js';

describe('parseFlowSteps', () => {
  it('parses every step kind the console can author', () => {
    const steps = parseFlowSteps([
      { id: 'a', kind: 'message', text: 'Hi' },
      { id: 'b', kind: 'question', text: 'Email?', saveAs: 'email' },
      {
        id: 'c',
        kind: 'choice',
        text: 'Topic?',
        choices: [
          { id: 'c1', label: 'Billing', goToStepId: 'd' },
          { id: 'c2', label: 'Other', goToStepId: null },
        ],
      },
      {
        id: 'd',
        kind: 'condition',
        variable: 'email',
        operator: 'contains',
        value: '@',
        ifTrueStepId: 'e',
        ifFalseStepId: null,
      },
      { id: 'e', kind: 'tag', tag: 'lead' },
      { id: 'f', kind: 'handoff', text: 'Connecting you', team: 'Billing' },
      { id: 'g', kind: 'end', text: 'Bye' },
    ]);

    expect(steps.map((s) => s.kind)).toEqual([
      'message', 'question', 'choice', 'condition', 'tag', 'handoff', 'end',
    ]);
    expect(steps[1]).toMatchObject({ saveAs: 'email' });
    expect(steps[3]).toMatchObject({ ifTrueStepId: 'e', ifFalseStepId: null });
  });

  it('returns [] for anything that is not an array', () => {
    for (const bad of [undefined, null, 'nope', 42, {}]) {
      expect(parseFlowSteps(bad)).toEqual([]);
    }
  });

  it('drops entries that are not records or lack a string id/kind', () => {
    const steps = parseFlowSteps([
      null,
      'x',
      { kind: 'message', text: 'no id' },
      { id: 'a' },
      { id: 'b', kind: 'message', text: 'ok' },
    ]);
    expect(steps.map((s) => s.id)).toEqual(['b']);
  });

  it('drops unknown kinds so a newer console cannot break an older widget', () => {
    expect(parseFlowSteps([{ id: 'a', kind: 'webhook', text: 'x' }])).toEqual([]);
  });

  it('drops a condition with an unknown operator', () => {
    const steps = parseFlowSteps([
      { id: 'a', kind: 'condition', variable: 'v', operator: 'regex', value: 'x' },
    ]);
    expect(steps).toEqual([]);
  });

  it('drops a choice step that has no usable choices (it could never be answered)', () => {
    expect(parseFlowSteps([{ id: 'a', kind: 'choice', text: 'Pick', choices: [] }])).toEqual([]);
    expect(
      parseFlowSteps([{ id: 'a', kind: 'choice', text: 'Pick', choices: [{ label: 'no id' }, 7] }]),
    ).toEqual([]);
  });

  it('treats a missing or non-string next-step reference as "end"', () => {
    const [step] = parseFlowSteps([
      { id: 'a', kind: 'condition', variable: 'v', operator: 'is', value: 'x', ifTrueStepId: 5 },
    ]);
    expect(step).toMatchObject({ ifTrueStepId: null, ifFalseStepId: null });
  });

  it('clamps text, choice labels and the number of choices', () => {
    const [message, choice] = parseFlowSteps([
      { id: 'a', kind: 'message', text: 'x'.repeat(5000) },
      {
        id: 'b',
        kind: 'choice',
        text: 'Pick',
        choices: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: 'y'.repeat(500), goToStepId: null })),
      },
    ]);
    expect((message as { text: string }).text).toHaveLength(1000);
    const choices = (choice as { choices: { label: string }[] }).choices;
    expect(choices).toHaveLength(8);
    expect(choices[0]!.label).toHaveLength(80);
  });

  it('caps the number of steps parsed', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, kind: 'message', text: 't' }));
    expect(parseFlowSteps(many)).toHaveLength(200);
  });

  it('keeps hostile markup as inert text (rendering uses textContent)', () => {
    const [step] = parseFlowSteps([{ id: 'a', kind: 'message', text: '<img src=x onerror=alert(1)>' }]);
    expect((step as { text: string }).text).toBe('<img src=x onerror=alert(1)>');
  });
});
