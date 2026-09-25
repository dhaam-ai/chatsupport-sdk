// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { MAX_STEPS_PER_RUN, advanceFlow, resumeFlow, startFlow } from '../src/flow/machine.js';
import type { FlowEffect } from '../src/flow/machine.js';
import { parseFlowSteps } from '../src/flow/parse.js';

const flow = (raw: unknown[]) => parseFlowSteps(raw);
const types = (effects: readonly FlowEffect[]) => effects.map((e) => e.type);

describe('startFlow', () => {
  it('says message steps and stops at the first question', () => {
    const steps = flow([
      { id: 'a', kind: 'message', text: 'Hello' },
      { id: 'b', kind: 'question', text: 'Email?', saveAs: 'email' },
    ]);
    const { state, effects } = startFlow('f1', steps);
    expect(effects).toEqual([
      { type: 'say', text: 'Hello' },
      { type: 'say', text: 'Email?' },
      { type: 'ask', stepId: 'b' },
    ]);
    expect(state).toMatchObject({ flowId: 'f1', stepId: 'b', done: false });
  });

  it('skips a message step with empty text without saying anything', () => {
    const steps = flow([{ id: 'a', kind: 'message', text: '' }]);
    expect(types(startFlow('f', steps).effects)).toEqual(['done']);
  });

  it('is done immediately for an empty step list', () => {
    const { state, effects } = startFlow('f', []);
    expect(state.done).toBe(true);
    expect(types(effects)).toEqual(['done']);
  });
});

describe('question', () => {
  const steps = flow([
    { id: 'q', kind: 'question', text: 'Email?', saveAs: 'email' },
    { id: 'm', kind: 'message', text: 'Thanks' },
  ]);

  it('sends the answer with flow metadata, stores it, and continues', () => {
    const first = startFlow('f1', steps);
    const { state, effects } = advanceFlow(steps, first.state, { type: 'text', text: '  a@b.co  ' });
    expect(effects[0]).toEqual({
      type: 'send',
      text: 'a@b.co',
      metadata: { kind: 'offline_flow', flowId: 'f1', stepId: 'q' },
    });
    expect(types(effects.slice(1))).toEqual(['say', 'done']);
    expect(state.answers).toEqual({ email: 'a@b.co' });
    expect(state.done).toBe(true);
  });

  it('ignores blank input without moving', () => {
    const first = startFlow('f1', steps);
    const result = advanceFlow(steps, first.state, { type: 'text', text: '   ' });
    expect(result.effects).toEqual([]);
    expect(result.state).toBe(first.state);
  });

  it('ignores a choice input while waiting on a question', () => {
    const first = startFlow('f1', steps);
    const result = advanceFlow(steps, first.state, { type: 'choice', choiceId: 'x' });
    expect(result.effects).toEqual([]);
  });
});

describe('choice', () => {
  const steps = flow([
    {
      id: 'c',
      kind: 'choice',
      text: 'Pick',
      choices: [
        { id: 'c1', label: 'Billing', goToStepId: 'b' },
        { id: 'c2', label: 'Bye', goToStepId: null },
      ],
    },
    { id: 'b', kind: 'message', text: 'Billing it is' },
  ]);

  it('offers the choices and waits', () => {
    const { effects } = startFlow('f', steps);
    expect(effects[1]).toMatchObject({ type: 'choose', stepId: 'c' });
  });

  it('sends the label with choiceId and follows goToStepId', () => {
    const first = startFlow('f', steps);
    const { effects } = advanceFlow(steps, first.state, { type: 'choice', choiceId: 'c1' });
    expect(effects[0]).toEqual({
      type: 'send',
      text: 'Billing',
      metadata: { kind: 'offline_flow', flowId: 'f', stepId: 'c', choiceId: 'c1' },
    });
    expect(effects[1]).toEqual({ type: 'say', text: 'Billing it is' });
  });

  it('ends the flow on a null goToStepId', () => {
    const first = startFlow('f', steps);
    const { state, effects } = advanceFlow(steps, first.state, { type: 'choice', choiceId: 'c2' });
    expect(state.done).toBe(true);
    expect(types(effects)).toEqual(['send', 'done']);
  });

  it('ignores an unknown choice id', () => {
    const first = startFlow('f', steps);
    const result = advanceFlow(steps, first.state, { type: 'choice', choiceId: 'nope' });
    expect(result.effects).toEqual([]);
  });
});

describe('condition', () => {
  const build = (operator: string, value: string) =>
    flow([
      { id: 'q', kind: 'question', text: 'Plan?', saveAs: 'plan' },
      { id: 'k', kind: 'condition', variable: 'plan', operator, value, ifTrueStepId: 't', ifFalseStepId: 'f' },
      { id: 't', kind: 'message', text: 'TRUE' },
      { id: 'x', kind: 'end', text: '' },
      { id: 'f', kind: 'message', text: 'FALSE' },
    ]);
  const run = (operator: string, value: string, answer: string) => {
    const steps = build(operator, value);
    const first = startFlow('f', steps);
    return advanceFlow(steps, first.state, { type: 'text', text: answer })
      .effects.filter((e) => e.type === 'say')
      .map((e) => (e as { text: string }).text);
  };

  it('is', () => {
    expect(run('is', 'pro', 'pro')).toEqual(['TRUE']);
    expect(run('is', 'pro', 'free')).toEqual(['FALSE']);
  });
  it('is not', () => {
    expect(run('is not', 'pro', 'free')).toEqual(['TRUE']);
    expect(run('is not', 'pro', 'pro')).toEqual(['FALSE']);
  });
  it('contains (case-sensitive)', () => {
    expect(run('contains', 'ro', 'pro')).toEqual(['TRUE']);
    expect(run('contains', 'RO', 'pro')).toEqual(['FALSE']);
  });
  it('treats a variable that was never answered as the empty string', () => {
    const steps = flow([
      { id: 'k', kind: 'condition', variable: 'ghost', operator: 'is', value: '', ifTrueStepId: 't', ifFalseStepId: null },
      { id: 't', kind: 'message', text: 'EMPTY' },
    ]);
    expect(startFlow('f', steps).effects[0]).toEqual({ type: 'say', text: 'EMPTY' });
  });
});

describe('tag', () => {
  it('rides on the next outgoing message and is then cleared', () => {
    const steps = flow([
      { id: 't', kind: 'tag', tag: 'lead' },
      { id: 'q1', kind: 'question', text: 'One?' },
      { id: 'q2', kind: 'question', text: 'Two?' },
    ]);
    const first = startFlow('f', steps);
    expect(first.state.pendingTags).toEqual(['lead']);
    const second = advanceFlow(steps, first.state, { type: 'text', text: 'a' });
    expect(second.effects[0]).toMatchObject({ metadata: { tags: ['lead'] } });
    expect(second.state.pendingTags).toEqual([]);
    const third = advanceFlow(steps, second.state, { type: 'text', text: 'b' });
    expect((third.effects[0] as { metadata: object }).metadata).not.toHaveProperty('tags');
  });

  it('sends no empty message when a tag has no message left to ride on', () => {
    const steps = flow([{ id: 't', kind: 'tag', tag: 'lead' }]);
    expect(types(startFlow('f', steps).effects)).toEqual(['done']);
  });
});

describe('handoff and end', () => {
  it('handoff says its text, requests a person, and ends', () => {
    const steps = flow([{ id: 'h', kind: 'handoff', text: 'Connecting you' }]);
    const { state, effects } = startFlow('f', steps);
    expect(effects).toEqual([
      { type: 'say', text: 'Connecting you' },
      { type: 'handoff', reason: 'Connecting you' },
      { type: 'done' },
    ]);
    expect(state.done).toBe(true);
  });

  it('end says its closing line and finishes', () => {
    const steps = flow([{ id: 'e', kind: 'end', text: 'Bye' }, { id: 'm', kind: 'message', text: 'never' }]);
    expect(startFlow('f', steps).effects).toEqual([{ type: 'say', text: 'Bye' }, { type: 'done' }]);
  });
});

describe('malformed flows never hang', () => {
  it('a cycle between message steps stops at the step cap', () => {
    // condition true→itself: a self-loop with no waiting step.
    const steps = flow([
      { id: 'k', kind: 'condition', variable: '', operator: 'is', value: '', ifTrueStepId: 'k', ifFalseStepId: null },
    ]);
    const { state, effects } = startFlow('f', steps);
    expect(state.done).toBe(true);
    expect(effects.at(-1)).toEqual({ type: 'done' });
    expect(MAX_STEPS_PER_RUN).toBe(100);
  });

  it('a dangling goToStepId ends the flow', () => {
    const steps = flow([
      { id: 'c', kind: 'choice', text: 'Pick', choices: [{ id: 'x', label: 'Go', goToStepId: 'missing' }] },
    ]);
    const first = startFlow('f', steps);
    const { state } = advanceFlow(steps, first.state, { type: 'choice', choiceId: 'x' });
    expect(state.done).toBe(true);
  });

  it('a state whose step no longer exists ends when advanced', () => {
    const steps = flow([{ id: 'a', kind: 'question', text: 'Q' }]);
    const { state } = startFlow('f', steps);
    const result = advanceFlow([], state, { type: 'text', text: 'hi' });
    expect(result.state.done).toBe(true);
  });

  it('does nothing once done', () => {
    const steps = flow([{ id: 'e', kind: 'end', text: '' }]);
    const { state } = startFlow('f', steps);
    expect(advanceFlow(steps, state, { type: 'text', text: 'x' }).effects).toEqual([]);
  });
});

describe('resumeFlow', () => {
  it('re-emits the waiting step so a reloaded widget shows the same prompt', () => {
    const steps = flow([{ id: 'q', kind: 'question', text: 'Email?', saveAs: 'email' }]);
    const { state } = startFlow('f', steps);
    const resumed = resumeFlow(steps, { ...state, answers: { earlier: 'x' } });
    expect(resumed.effects).toEqual([{ type: 'say', text: 'Email?' }, { type: 'ask', stepId: 'q' }]);
    expect(resumed.state.answers).toEqual({ earlier: 'x' });
  });
});
