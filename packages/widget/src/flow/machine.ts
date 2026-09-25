// The bot-flow step machine: pure, no DOM, no I/O.
//
// It never talks to the network or the screen. Every call returns the next
// state plus a list of EFFECTS the caller applies (say a line, wait for an
// answer, send a message, hand off). That keeps the interesting logic
// testable without a browser and lets the view decide when a `send` has
// actually succeeded before it commits the new state.
//
// Cursor: the current STEP ID, not an index — `choice` and `condition` jump by
// id, so an index would be wrong the moment a flow branches.
//
// Safety: one synchronous run executes at most MAX_STEPS_PER_RUN steps. A flow
// whose `goToStepId`s form a loop with no waiting step in it (a self-pointing
// condition, say) would otherwise spin forever inside the visitor's browser.
// Hitting the cap ends the flow. A `goToStepId` that matches no step also ends
// it. Loops THROUGH a question/choice are fine: each lap needs the visitor.

import type { FlowChoice, FlowStep } from './parse.js';

export const MAX_STEPS_PER_RUN = 100;

export interface FlowState {
  readonly flowId: string;
  /** The step the machine is waiting on, or `null` once finished. */
  readonly stepId: string | null;
  readonly answers: Readonly<Record<string, string>>;
  /** Tags collected by `tag` steps, waiting for a message to ride on. */
  readonly pendingTags: readonly string[];
  readonly done: boolean;
}

export type FlowEffect =
  | { readonly type: 'say'; readonly text: string }
  | { readonly type: 'ask'; readonly stepId: string }
  | { readonly type: 'choose'; readonly stepId: string; readonly choices: readonly FlowChoice[] }
  | { readonly type: 'send'; readonly text: string; readonly metadata: Record<string, unknown> }
  | { readonly type: 'handoff'; readonly reason: string }
  | { readonly type: 'done' };

export type FlowInput =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'choice'; readonly choiceId: string };

export interface FlowResult {
  readonly state: FlowState;
  readonly effects: readonly FlowEffect[];
}

function nextAfter(steps: readonly FlowStep[], index: number): string | null {
  return steps[index + 1]?.id ?? null;
}

function holds(step: Extract<FlowStep, { kind: 'condition' }>, answers: Readonly<Record<string, string>>): boolean {
  const actual = answers[step.variable] ?? '';
  switch (step.operator) {
    case 'is':
      return actual === step.value;
    case 'is not':
      return actual !== step.value;
    case 'contains':
      return actual.includes(step.value);
  }
}

/** Runs from `from` until the machine must wait for the visitor, or ends. */
function run(
  steps: readonly FlowStep[],
  flowId: string,
  from: string | null,
  answers: Readonly<Record<string, string>>,
  pendingTags: readonly string[],
  effects: FlowEffect[],
): FlowState {
  let stepId = from;
  let tags = pendingTags;
  let executed = 0;

  while (stepId !== null && executed < MAX_STEPS_PER_RUN) {
    const index = steps.findIndex((s) => s.id === stepId);
    if (index < 0) break; // dangling reference: end
    executed += 1;
    const step = steps[index]!;

    switch (step.kind) {
      case 'message':
        if (step.text !== '') effects.push({ type: 'say', text: step.text });
        stepId = nextAfter(steps, index);
        break;
      case 'question':
        if (step.text !== '') effects.push({ type: 'say', text: step.text });
        effects.push({ type: 'ask', stepId: step.id });
        return { flowId, stepId: step.id, answers, pendingTags: tags, done: false };
      case 'choice':
        if (step.text !== '') effects.push({ type: 'say', text: step.text });
        effects.push({ type: 'choose', stepId: step.id, choices: step.choices });
        return { flowId, stepId: step.id, answers, pendingTags: tags, done: false };
      case 'condition':
        stepId = holds(step, answers) ? step.ifTrueStepId : step.ifFalseStepId;
        break;
      case 'tag':
        tags = [...tags, step.tag];
        stepId = nextAfter(steps, index);
        break;
      case 'handoff':
        if (step.text !== '') effects.push({ type: 'say', text: step.text });
        effects.push({ type: 'handoff', reason: step.text });
        stepId = null;
        break;
      case 'end':
        if (step.text !== '') effects.push({ type: 'say', text: step.text });
        stepId = null;
        break;
    }
  }

  effects.push({ type: 'done' });
  return { flowId, stepId: null, answers, pendingTags: tags, done: true };
}

export function startFlow(flowId: string, steps: readonly FlowStep[]): FlowResult {
  const effects: FlowEffect[] = [];
  const state = run(steps, flowId, steps[0]?.id ?? null, {}, [], effects);
  return { state, effects };
}

/** Re-enters at `state.stepId`, re-emitting that step's prompt. For a reload. */
export function resumeFlow(steps: readonly FlowStep[], state: FlowState): FlowResult {
  const effects: FlowEffect[] = [];
  const next = run(steps, state.flowId, state.stepId, state.answers, state.pendingTags, effects);
  return { state: next, effects };
}

export function advanceFlow(steps: readonly FlowStep[], state: FlowState, input: FlowInput): FlowResult {
  if (state.done || state.stepId === null) return { state, effects: [] };

  const index = steps.findIndex((s) => s.id === state.stepId);
  if (index < 0) {
    const effects: FlowEffect[] = [{ type: 'done' }];
    return { state: { ...state, stepId: null, done: true }, effects };
  }
  const step = steps[index]!;

  const metadata = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: 'offline_flow',
    flowId: state.flowId,
    stepId: step.id,
    ...extra,
    ...(state.pendingTags.length > 0 ? { tags: [...state.pendingTags] } : {}),
  });

  if (step.kind === 'question' && input.type === 'text') {
    const answer = input.text.trim();
    if (answer === '') return { state, effects: [] };
    const answers = step.saveAs === undefined ? state.answers : { ...state.answers, [step.saveAs]: answer };
    const effects: FlowEffect[] = [{ type: 'send', text: answer, metadata: metadata() }];
    const next = run(steps, state.flowId, nextAfter(steps, index), answers, [], effects);
    return { state: next, effects };
  }

  if (step.kind === 'choice' && input.type === 'choice') {
    const choice = step.choices.find((c) => c.id === input.choiceId);
    if (choice === undefined) return { state, effects: [] };
    const effects: FlowEffect[] = [{ type: 'send', text: choice.label, metadata: metadata({ choiceId: choice.id }) }];
    const next = run(steps, state.flowId, choice.goToStepId, state.answers, [], effects);
    return { state: next, effects };
  }

  return { state, effects: [] };
}
