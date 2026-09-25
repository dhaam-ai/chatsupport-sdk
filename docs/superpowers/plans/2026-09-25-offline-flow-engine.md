# Offline Flow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the team is closed and "Collect a message" is selected, the widget runs the merchant's published OFFLINE bot flow instead of the fixed built-in form.

**Architecture:** A pure, DOM-free step machine (`src/flow/machine.ts`) fed by a defensive step parser (`src/flow/parse.ts`), rendered by a new surface (`src/ui/flow-view.ts`) that stands in the slot the built-in offline form uses today. `widget.ts` chooses between web form / flow / built-in form and clears the flow when a person or real bot replies. No change to `packages/core` or the wire protocol.

**Tech Stack:** TypeScript, vitest (+ jsdom), the widget's own `el()` DOM helper. All paths below are relative to the SDK repo root `chatsupport-sdk/`. Run tests from that root: `npx vitest run packages/widget/test/<file>`.

**Spec:** `docs/superpowers/specs/2026-09-25-offline-flow-engine-design.md`

## Global Constraints

- No `innerHTML` anywhere; all text through `el()`'s `text` (`textContent`). Flow text is merchant-authored but rendered in a customer's page.
- No new dependency. No change under `packages/core`, `packages/rest`, or chat-service.
- The widget never computes business hours; it only reads `remote.isOpenNow` (existing `shouldCollectOffline`).
- Storage access (`localStorage`) is always in try/catch; the flow must work without it.
- Storage key is exactly `chatsdk:<publishableKey>:offline-flow`.
- Message metadata `kind` is exactly `'offline_flow'`.
- Max steps executed in one synchronous run: `100`.
- Conditions use exactly three operators: `is`, `is not`, `contains` (case-sensitive string comparison).
- Ticket destination still wins over the flow (`ticketDestinationExists` branch unchanged).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies but a straightforward happy-path test would miss, most likely first:

1. **Old BOT/AGENT history must not kill a fresh flow.** A returning visitor's session already holds earlier BOT/AGENT messages; only messages that arrive *after the flow's first send* may pre-empt it. (Task 5 test.)
2. **Double submit.** Pressing Enter twice, or tapping a chip twice, while a send is in flight must send exactly once. (Task 4 test.)
3. **Stale saved state.** Saved progress pointing at a step id that a republished flow no longer has, or at a different flow id, must be discarded and the flow restart from the top. (Task 4 test.)
4. **Send failure must not lose the visitor's place.** If `sendMessage` rejects, the step does not advance, the typed text stays, and an error line appears. (Task 4 test.)
5. **Hostile or malformed flow data.** Text containing `<img onerror>` renders as text; a cycle, a dangling `goToStepId`, a `choice` with no valid choices, and `steps: "nope"` must all end or fall back cleanly, never hang. (Tasks 1, 2, 4 tests.)
6. **Storage that throws** (private mode, quota). Flow still runs. (Task 4 test.)

---

### Task 1: Step parser

**Files:**
- Create: `packages/widget/src/flow/parse.ts`
- Test: `packages/widget/test/flow-parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact names, used by Tasks 2–5):
  - `type FlowOperator = 'is' | 'is not' | 'contains'`
  - `interface FlowChoice { readonly id: string; readonly label: string; readonly goToStepId: string | null }`
  - `type FlowStep` (discriminated union on `kind`, see code)
  - `function parseFlowSteps(raw: unknown): readonly FlowStep[]` — never throws

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/flow-parse.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/widget/test/flow-parse.test.ts`
Expected: FAIL — cannot resolve `../src/flow/parse.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/widget/src/flow/parse.ts`:

```ts
// Turns the wire's opaque `steps: unknown[]` into steps the machine can run.
//
// `remote-config.ts` deliberately leaves `PublishedFlow.steps` opaque ("step
// shapes are the console's to evolve"), so this is the one place that reads
// them — and it treats every field as untrusted: the flow was authored by a
// merchant, travelled through a cache, and is about to run on a customer's
// page. It never throws. A step it cannot make sense of is DROPPED rather than
// guessed at, so a newer console adding a step kind cannot break an older
// widget: the flow just runs without that step.
//
// Step shapes mirror the console's `BotStep`
// (chatsupport-react/app/lib/settings/chatbot.ts). A missing or non-string
// next-step reference means "end the flow" (`null`), which is also how the
// console spells it.

export type FlowOperator = 'is' | 'is not' | 'contains';

export interface FlowChoice {
  readonly id: string;
  readonly label: string;
  readonly goToStepId: string | null;
}

export type FlowStep =
  | { readonly kind: 'message'; readonly id: string; readonly text: string }
  | { readonly kind: 'question'; readonly id: string; readonly text: string; readonly saveAs?: string }
  | { readonly kind: 'choice'; readonly id: string; readonly text: string; readonly choices: readonly FlowChoice[] }
  | {
      readonly kind: 'condition';
      readonly id: string;
      readonly variable: string;
      readonly operator: FlowOperator;
      readonly value: string;
      readonly ifTrueStepId: string | null;
      readonly ifFalseStepId: string | null;
    }
  | { readonly kind: 'tag'; readonly id: string; readonly tag: string }
  | { readonly kind: 'handoff'; readonly id: string; readonly text: string }
  | { readonly kind: 'end'; readonly id: string; readonly text: string };

const MAX_TEXT = 1000;
const MAX_LABEL = 80;
const MAX_CHOICES = 8;
const MAX_STEPS = 200;

const OPERATORS: readonly FlowOperator[] = ['is', 'is not', 'contains'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string, clamped. `''` for anything that is not one. */
function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** A non-empty string id, or `undefined`. */
function id(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A next-step reference: a non-empty string, else `null` (= end the flow). */
function ref(value: unknown): string | null {
  return id(value) ?? null;
}

function parseChoices(value: unknown): readonly FlowChoice[] {
  if (!Array.isArray(value)) return [];
  const choices: FlowChoice[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const choiceId = id(entry['id']);
    const label = text(entry['label'], MAX_LABEL).trim();
    if (choiceId === undefined || label === '') continue;
    choices.push({ id: choiceId, label, goToStepId: ref(entry['goToStepId']) });
    if (choices.length === MAX_CHOICES) break;
  }
  return choices;
}

function parseStep(entry: unknown): FlowStep | undefined {
  if (!isRecord(entry)) return undefined;
  const stepId = id(entry['id']);
  const kind = entry['kind'];
  if (stepId === undefined || typeof kind !== 'string') return undefined;

  switch (kind) {
    case 'message':
      return { kind, id: stepId, text: text(entry['text']) };
    case 'question': {
      const saveAs = id(entry['saveAs']);
      return { kind, id: stepId, text: text(entry['text']), ...(saveAs === undefined ? {} : { saveAs }) };
    }
    case 'choice': {
      const choices = parseChoices(entry['choices']);
      // A choice with nothing to tap can never be answered, and the visitor
      // would be stranded on it — drop it instead.
      if (choices.length === 0) return undefined;
      return { kind, id: stepId, text: text(entry['text']), choices };
    }
    case 'condition': {
      const operator = OPERATORS.find((o) => o === entry['operator']);
      if (operator === undefined) return undefined;
      return {
        kind,
        id: stepId,
        variable: text(entry['variable'], MAX_LABEL),
        operator,
        value: text(entry['value']),
        ifTrueStepId: ref(entry['ifTrueStepId']),
        ifFalseStepId: ref(entry['ifFalseStepId']),
      };
    }
    case 'tag': {
      const tag = text(entry['tag'], MAX_LABEL).trim();
      return tag === '' ? undefined : { kind, id: stepId, tag };
    }
    case 'handoff':
    case 'end':
      return { kind, id: stepId, text: text(entry['text']) };
    default:
      return undefined;
  }
}

/** Never throws; unusable input yields fewer steps, possibly none. */
export function parseFlowSteps(raw: unknown): readonly FlowStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: FlowStep[] = [];
  for (const entry of raw) {
    const step = parseStep(entry);
    if (step !== undefined) steps.push(step);
    if (steps.length === MAX_STEPS) break;
  }
  return steps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/widget/test/flow-parse.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/flow/parse.ts packages/widget/test/flow-parse.test.ts
git commit -m "feat(widget): defensive parser for bot flow steps

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Step machine

**Files:**
- Create: `packages/widget/src/flow/machine.ts`
- Test: `packages/widget/test/flow-machine.test.ts`

**Interfaces:**
- Consumes: `FlowStep`, `FlowChoice` from `./parse.js` (Task 1).
- Produces (exact names, used by Task 4):
  - `const MAX_STEPS_PER_RUN = 100`
  - `interface FlowState { readonly flowId: string; readonly stepId: string | null; readonly answers: Readonly<Record<string, string>>; readonly pendingTags: readonly string[]; readonly done: boolean }`
  - `type FlowEffect = { type: 'say'; text: string } | { type: 'ask'; stepId: string } | { type: 'choose'; stepId: string; choices: readonly FlowChoice[] } | { type: 'send'; text: string; metadata: Record<string, unknown> } | { type: 'handoff'; reason: string } | { type: 'done' }`
  - `type FlowInput = { type: 'text'; text: string } | { type: 'choice'; choiceId: string }`
  - `interface FlowResult { readonly state: FlowState; readonly effects: readonly FlowEffect[] }`
  - `function startFlow(flowId: string, steps: readonly FlowStep[]): FlowResult`
  - `function resumeFlow(steps: readonly FlowStep[], state: FlowState): FlowResult` — re-enters at `state.stepId` (re-emits that step's `say`/`ask`/`choose`)
  - `function advanceFlow(steps: readonly FlowStep[], state: FlowState, input: FlowInput): FlowResult`

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/flow-machine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/widget/test/flow-machine.test.ts`
Expected: FAIL — cannot resolve `../src/flow/machine.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/widget/src/flow/machine.ts`:

```ts
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

/** Runs from `stepId` until the machine must wait for the visitor, or ends. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/widget/test/flow-machine.test.ts`
Expected: PASS. If the self-loop test hangs, the step cap is not being applied — check the `while` condition.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/flow/machine.ts packages/widget/test/flow-machine.test.ts
git commit -m "feat(widget): pure step machine for bot flows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Selecting the OFFLINE flow

**Files:**
- Modify: `packages/widget/src/remote-config.ts` (replace the "KNOWN, DELIBERATE DIVERGENCE" comment block that sits between `shouldCollectOffline` and `isOutOfHours`; add import at top)
- Test: `packages/widget/test/remote-config.test.ts` (append)

**Interfaces:**
- Consumes: `parseFlowSteps`, `FlowStep` (Task 1); `PublishedFlow`, `RemoteConfig` (existing).
- Produces:
  - `const FLOW_TRIGGER_OFFLINE = 4`
  - `function offlineFlowFor(remote: RemoteConfig): { readonly flow: PublishedFlow; readonly steps: readonly FlowStep[] } | undefined` — first flow with `trigger === 4` whose steps parse to at least one step.

- [ ] **Step 1: Write the failing test**

Append to `packages/widget/test/remote-config.test.ts`; also add `offlineFlowFor` to the existing import list from `'../src/remote-config.js'`:

```ts
describe('offlineFlowFor', () => {
  const withFlows = (flows: RemoteConfig['flows']): RemoteConfig => ({ ...DEFAULT_REMOTE_CONFIG, flows });
  const offline = (id: string, steps: unknown[]) => ({
    id,
    name: id,
    trigger: 4,
    keywords: [],
    pagePattern: '',
    steps,
  });

  it('is undefined when there are no flows', () => {
    expect(offlineFlowFor(DEFAULT_REMOTE_CONFIG)).toBeUndefined();
  });

  it('ignores flows that are not the OFFLINE trigger', () => {
    const welcome = { ...offline('w', [{ id: 'a', kind: 'message', text: 'hi' }]), trigger: 1 };
    expect(offlineFlowFor(withFlows([welcome]))).toBeUndefined();
  });

  it('returns the first OFFLINE flow with usable steps, with its parsed steps', () => {
    const picked = offlineFlowFor(
      withFlows([
        offline('broken', [{ id: 'a', kind: 'webhook' }]),
        offline('good', [{ id: 'a', kind: 'message', text: 'We are closed' }]),
        offline('later', [{ id: 'a', kind: 'message', text: 'x' }]),
      ]),
    );
    expect(picked?.flow.id).toBe('good');
    expect(picked?.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/widget/test/remote-config.test.ts -t offlineFlowFor`
Expected: FAIL — `offlineFlowFor` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/widget/src/remote-config.ts`, add near the other imports at the top of the file:

```ts
import { parseFlowSteps } from './flow/parse.js';
import type { FlowStep } from './flow/parse.js';
```

Then replace the whole comment block starting `// A KNOWN, DELIBERATE DIVERGENCE FROM THE CONSOLE CONTRACT.` through `// \`PublishedFlow.trigger === 4\` is parsed and carried for exactly that.` with:

```ts
/** `PublishedFlow.trigger` for the out-of-hours flow (FlowTrigger 4 OFFLINE). */
export const FLOW_TRIGGER_OFFLINE = 4;

/**
 * The tenant's out-of-hours flow, when `COLLECT_MESSAGE` should run one.
 *
 * The console specifies COLLECT_MESSAGE as "run the tenant's OFFLINE-trigger
 * bot flow, falling back to the built-in form when none is published". The
 * payload only ever carries published+enabled flows, so "is there one" is
 * answered here by looking for the first OFFLINE flow whose steps parse to
 * something runnable. `undefined` is the fallback: the caller renders the
 * built-in form. A flow whose every step the parser had to drop counts as
 * absent — running it would show the visitor an empty screen.
 *
 * Only meaningful when {@link shouldCollectOffline} is true; it does not
 * re-check hours.
 */
export function offlineFlowFor(
  remote: RemoteConfig,
): { readonly flow: PublishedFlow; readonly steps: readonly FlowStep[] } | undefined {
  for (const flow of remote.flows) {
    if (flow.trigger !== FLOW_TRIGGER_OFFLINE) continue;
    const steps = parseFlowSteps(flow.steps);
    if (steps.length > 0) return { flow, steps };
  }
  return undefined;
}
```

Also update the comment on `shouldCollectOffline`'s doc if it says the flow is not consulted — it says only `COLLECT_MESSAGE` replaces the composer, which stays true.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/widget/test/remote-config.test.ts`
Expected: PASS (all, including the new three).

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/remote-config.ts packages/widget/test/remote-config.test.ts
git commit -m "feat(widget): offlineFlowFor selects the published OFFLINE flow

Removes the note recording that the widget ignored flows.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The flow view

**Files:**
- Create: `packages/widget/src/ui/flow-view.ts`
- Modify: `packages/widget/src/ui/styles.ts` (add CSS block after the `.dh-offline-text` rule, line ~1097)
- Test: `packages/widget/test/flow-view.test.ts`

**Interfaces:**
- Consumes: `startFlow`, `resumeFlow`, `advanceFlow`, `FlowState`, `FlowEffect`, `FlowInput` (Task 2); `FlowStep`, `FlowChoice` (Task 1); `el` from `./dom.js`; `createStatusLine` from `./forms.js`.
- Produces (used by Task 5):
  - `interface FlowViewCallbacks { readonly send: (text: string, metadata: Record<string, unknown>) => Promise<void>; readonly requestAgent: (reason: string) => void; readonly hasSession: () => boolean; readonly onError: (error: unknown) => void }`
  - `interface FlowViewOptions { readonly flowId: string; readonly steps: readonly FlowStep[]; readonly storageKey: string; readonly sessionId: string | null; readonly offlineMessage?: string }`
  - `interface FlowView { readonly node: HTMLElement; focus(): void; destroy(): void; /** Clears saved progress and stops the flow (a person replied). */ abandon(): void }`
  - `function createFlowView(options: FlowViewOptions, callbacks: FlowViewCallbacks): FlowView`
  - Persisted JSON shape at `storageKey`: `{ flowId, stepId, answers, pendingTags, sessionId }`

DOM contract the tests and CSS rely on: root `.dh-flow`; banner `.dh-offline-banner`; log `.dh-flow-log` containing `.dh-flow-line[data-from="bot"|"me"]`; chips container `.dh-quick-replies` holding `button.dh-quick-reply`; answer form `form.dh-flow-form` with `input.dh-field-input` and `button.dh-form-submit`; error line `.dh-form-error`.

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/flow-view.test.ts`:

```ts
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlowView } from '../src/ui/flow-view.js';
import type { FlowViewCallbacks } from '../src/ui/flow-view.js';
import { parseFlowSteps } from '../src/flow/parse.js';

const KEY = 'chatsdk:test:offline-flow';

const steps = parseFlowSteps([
  { id: 'm', kind: 'message', text: 'We are closed.' },
  { id: 'q', kind: 'question', text: 'Your email?', saveAs: 'email' },
  {
    id: 'c',
    kind: 'choice',
    text: 'Topic?',
    choices: [
      { id: 'c1', label: 'Billing', goToStepId: 'h' },
      { id: 'c2', label: 'Other', goToStepId: 'e' },
    ],
  },
  { id: 'h', kind: 'handoff', text: 'A person will follow up' },
  { id: 'e', kind: 'end', text: 'Thanks, bye' },
]);

function build(over: Partial<FlowViewCallbacks> = {}, opts: { sessionId?: string | null; stepsOverride?: typeof steps } = {}) {
  const send = vi.fn(async () => undefined);
  const requestAgent = vi.fn();
  const onError = vi.fn();
  const callbacks: FlowViewCallbacks = { send, requestAgent, hasSession: () => true, onError, ...over };
  const view = createFlowView(
    { flowId: 'f1', steps: opts.stepsOverride ?? steps, storageKey: KEY, sessionId: opts.sessionId ?? null, offlineMessage: 'Back at 9.' },
    callbacks,
  );
  document.body.appendChild(view.node);
  return { view, send, requestAgent, onError };
}

const lines = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.dh-flow-line')].map((n) => `${n.dataset['from']}:${n.textContent}`);
const answerInput = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.dh-flow-form input')!;
const answerForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('.dh-flow-form')!;
const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.dh-quick-reply')];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function answer(root: HTMLElement, value: string) {
  answerInput(root).value = value;
  answerForm(root).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('rendering', () => {
  it('shows the offline banner, the bot lines, and an answer box at a question', () => {
    const { view } = build();
    expect(view.node.querySelector('.dh-offline-banner')?.textContent).toContain('Back at 9.');
    expect(lines(view.node)).toEqual(['bot:We are closed.', 'bot:Your email?']);
    expect(answerForm(view.node).hidden).toBe(false);
    expect(chips(view.node)).toHaveLength(0);
  });

  it('renders merchant text as text, never as markup', () => {
    const hostile = parseFlowSteps([{ id: 'a', kind: 'message', text: '<img src=x onerror=alert(1)>' }]);
    const { view } = build({}, { stepsOverride: hostile });
    expect(view.node.querySelector('img')).toBeNull();
    expect(lines(view.node)[0]).toBe('bot:<img src=x onerror=alert(1)>');
  });
});

describe('answering', () => {
  it('sends the answer with flow metadata, echoes it, and shows the next step', async () => {
    const { view, send } = build();
    await answer(view.node, 'a@b.co');
    expect(send).toHaveBeenCalledWith('a@b.co', { kind: 'offline_flow', flowId: 'f1', stepId: 'q' });
    expect(lines(view.node)).toEqual(['bot:We are closed.', 'bot:Your email?', 'me:a@b.co', 'bot:Topic?']);
    expect(answerForm(view.node).hidden).toBe(true);
    expect(chips(view.node).map((c) => c.textContent)).toEqual(['Billing', 'Other']);
  });

  it('ignores a blank answer', async () => {
    const { view, send } = build();
    await answer(view.node, '   ');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends exactly once when submitted twice while the first send is in flight', async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { view } = build({ send });
    answerInput(view.node).value = 'a@b.co';
    answerForm(view.node).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    answerForm(view.node).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    release();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the visitor’s place and shows an error when the send fails', async () => {
    const send = vi.fn(async () => { throw new Error('offline'); });
    const { view, onError } = build({ send });
    await answer(view.node, 'a@b.co');
    expect(onError).toHaveBeenCalled();
    expect(view.node.querySelector('.dh-form-error')?.hasAttribute('hidden')).toBe(false);
    expect(answerInput(view.node).value).toBe('a@b.co');
    expect(lines(view.node)).toEqual(['bot:We are closed.', 'bot:Your email?']);
    expect(answerForm(view.node).hidden).toBe(false);
  });
});

describe('choices', () => {
  async function toChoice() {
    const ctx = build();
    await answer(ctx.view.node, 'a@b.co');
    return ctx;
  }

  it('sends the label with choiceId and follows the branch to a handoff', async () => {
    const { view, send, requestAgent } = await toChoice();
    chips(view.node)[0]!.click();
    await tick();
    expect(send).toHaveBeenLastCalledWith('Billing', { kind: 'offline_flow', flowId: 'f1', stepId: 'c', choiceId: 'c1' });
    expect(requestAgent).toHaveBeenCalledWith('A person will follow up');
    expect(chips(view.node)).toHaveLength(0);
  });

  it('does not request an agent when there is no session', async () => {
    const send = vi.fn(async () => undefined);
    const requestAgent = vi.fn();
    const { view } = build({ send, requestAgent, hasSession: () => false });
    await answer(view.node, 'a@b.co');
    chips(view.node)[0]!.click();
    await tick();
    expect(requestAgent).not.toHaveBeenCalled();
    expect(lines(view.node).at(-1)).toBe('bot:A person will follow up');
  });

  it('a double tap sends once', async () => {
    const { view, send } = await toChoice();
    const [first] = chips(view.node);
    first!.click();
    first!.click();
    await tick();
    expect(send.mock.calls.filter(([text]) => text === 'Billing')).toHaveLength(1);
  });

  it('ends with the closing line on the other branch', async () => {
    const { view } = await toChoice();
    chips(view.node)[1]!.click();
    await tick();
    expect(lines(view.node).at(-1)).toBe('bot:Thanks, bye');
    expect(answerForm(view.node).hidden).toBe(true);
  });
});

describe('persistence', () => {
  it('saves progress at a waiting step and clears it when the flow ends', async () => {
    const { view } = build();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ flowId: 'f1', stepId: 'q' });
    await answer(view.node, 'a@b.co');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ stepId: 'c', answers: { email: 'a@b.co' } });
    chips(view.node)[1]!.click();
    await tick();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('resumes at the saved step after a reload', async () => {
    const first = build();
    await answer(first.view.node, 'a@b.co');
    first.view.destroy();
    document.body.innerHTML = '';

    const { view, send } = build();
    expect(lines(view.node)).toEqual(['bot:Topic?']);
    expect(chips(view.node)).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('discards saved progress for a different flow id', () => {
    localStorage.setItem(KEY, JSON.stringify({ flowId: 'OTHER', stepId: 'q', answers: {}, pendingTags: [], sessionId: null }));
    const { view } = build();
    expect(lines(view.node)[0]).toBe('bot:We are closed.');
  });

  it('discards saved progress whose step no longer exists (flow was republished)', () => {
    localStorage.setItem(KEY, JSON.stringify({ flowId: 'f1', stepId: 'gone', answers: {}, pendingTags: [], sessionId: null }));
    const { view } = build();
    expect(lines(view.node)[0]).toBe('bot:We are closed.');
  });

  it('discards saved progress from a different session', () => {
    localStorage.setItem(KEY, JSON.stringify({ flowId: 'f1', stepId: 'c', answers: {}, pendingTags: [], sessionId: 'old' }));
    const { view } = build({}, { sessionId: 'new' });
    expect(lines(view.node)[0]).toBe('bot:We are closed.');
  });

  it('discards corrupt saved data', () => {
    localStorage.setItem(KEY, '{not json');
    const { view } = build();
    expect(lines(view.node)[0]).toBe('bot:We are closed.');
  });

  it('still runs when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { view, send } = build();
    await answer(view.node, 'a@b.co');
    expect(send).toHaveBeenCalled();
    expect(chips(view.node)).toHaveLength(2);
  });
});

describe('abandon', () => {
  it('clears saved progress and disables further input', async () => {
    const { view } = build();
    view.abandon();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(answerForm(view.node).hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/widget/test/flow-view.test.ts`
Expected: FAIL — cannot resolve `../src/ui/flow-view.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/widget/src/ui/flow-view.ts`:

```ts
// The out-of-hours flow surface: a small self-contained transcript that shows
// the merchant's bot lines, the visitor's own answers, tappable choices, and
// an answer box — standing in the slot the built-in offline form uses.
//
// Bot lines live ONLY here. They are never sent to chat-service and never
// enter the core message store; what reaches the server is the visitor's own
// words (answers, chosen labels) as ordinary messages carrying
// `metadata.kind === 'offline_flow'`, so an agent reading the conversation
// sees exactly what the visitor said and which step it answered.
//
// The step machine (../flow/machine.ts) is pure; this file is the imperative
// half that applies its effects. One rule matters most: a `send` effect is
// applied FIRST and the new state is committed only if it succeeded. A failed
// send leaves the visitor on the same step with their text intact.
//
// Progress is saved to localStorage so a reload resumes. Storage is optional:
// every access is guarded, and a throwing or full store just means no resume.

import { advanceFlow, resumeFlow, startFlow } from '../flow/machine.js';
import type { FlowEffect, FlowInput, FlowResult, FlowState } from '../flow/machine.js';
import type { FlowChoice, FlowStep } from '../flow/parse.js';
import { el } from './dom.js';
import { createStatusLine } from './forms.js';

export interface FlowViewCallbacks {
  readonly send: (text: string, metadata: Record<string, unknown>) => Promise<void>;
  readonly requestAgent: (reason: string) => void;
  /** Whether a chat session exists to escalate. */
  readonly hasSession: () => boolean;
  readonly onError: (error: unknown) => void;
}

export interface FlowViewOptions {
  readonly flowId: string;
  readonly steps: readonly FlowStep[];
  readonly storageKey: string;
  /** The session this view was built under; saved progress from another is discarded. */
  readonly sessionId: string | null;
  readonly offlineMessage?: string;
}

export interface FlowView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
  /** A person or real bot replied: drop saved progress and stop taking input. */
  abandon(): void;
}

const SEND_FAILED = 'We could not send that. Please try again.';
const MAX_ANSWER_LENGTH = 500;

interface Saved {
  flowId: string;
  stepId: string;
  answers: Record<string, string>;
  pendingTags: string[];
  sessionId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createFlowView(options: FlowViewOptions, callbacks: FlowViewCallbacks): FlowView {
  const { flowId, steps, storageKey, sessionId } = options;

  // ── storage (all guarded) ────────────────────────────────────────────
  function readSaved(): Saved | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      const { stepId, answers, pendingTags } = parsed;
      if (parsed['flowId'] !== flowId || typeof stepId !== 'string') return null;
      if (!steps.some((s) => s.id === stepId)) return null;
      if (!isRecord(answers) || !Object.values(answers).every((v) => typeof v === 'string')) return null;
      if (!Array.isArray(pendingTags) || !pendingTags.every((t) => typeof t === 'string')) return null;
      const savedSession = typeof parsed['sessionId'] === 'string' ? parsed['sessionId'] : null;
      if (savedSession !== null && sessionId !== null && savedSession !== sessionId) return null;
      return { flowId, stepId, answers: answers as Record<string, string>, pendingTags: pendingTags as string[], sessionId: savedSession };
    } catch {
      return null;
    }
  }

  function save(state: FlowState): void {
    try {
      if (state.done || state.stepId === null) {
        localStorage.removeItem(storageKey);
        return;
      }
      const value: Saved = {
        flowId: state.flowId,
        stepId: state.stepId,
        answers: { ...state.answers },
        pendingTags: [...state.pendingTags],
        sessionId,
      };
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // No storage: the flow simply cannot resume after a reload.
    }
  }

  function clearSaved(): void {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignored, as above
    }
  }

  // ── DOM ──────────────────────────────────────────────────────────────
  const banner = el('div', {
    attrs: { class: 'dh-offline-banner' },
    children: [
      el('p', { attrs: { class: 'dh-form-heading' }, text: "We're currently offline." }),
      el('p', {
        attrs: { class: 'dh-form-subtitle' },
        text: options.offlineMessage ?? "Leave us a message and we'll get back to you.",
      }),
    ],
  });
  const log = el('div', { attrs: { class: 'dh-flow-log', role: 'log', 'aria-live': 'polite' } });
  const chipRow = el('div', { attrs: { class: 'dh-quick-replies' }, });
  chipRow.hidden = true;
  const status = createStatusLine();
  const input = el('input', {
    attrs: {
      class: 'dh-field-input',
      type: 'text',
      maxlength: MAX_ANSWER_LENGTH,
      autocomplete: 'off',
      'aria-label': 'Your answer',
    },
  });
  const sendButton = el('button', { attrs: { class: 'dh-form-submit', type: 'submit' }, text: 'Send' });
  const form = el('form', {
    attrs: { class: 'dh-flow-form', novalidate: true },
    children: [input, sendButton],
    on: {
      submit: (event) => {
        event.preventDefault();
        void take({ type: 'text', text: input.value });
      },
    },
  });
  form.hidden = true;
  const node = el('div', { attrs: { class: 'dh-flow' }, children: [banner, log, chipRow, status.node, form] });

  function addLine(from: 'bot' | 'me', text: string): void {
    log.appendChild(el('p', { attrs: { class: 'dh-flow-line', 'data-from': from }, text }));
    log.scrollTop = log.scrollHeight;
  }

  function showChoices(choices: readonly FlowChoice[]): void {
    chipRow.replaceChildren(
      ...choices.map((choice) =>
        el('button', {
          attrs: { class: 'dh-quick-reply', type: 'button' },
          text: choice.label,
          on: { click: () => void take({ type: 'choice', choiceId: choice.id }) },
        }),
      ),
    );
    chipRow.hidden = false;
  }

  function hideInputs(): void {
    chipRow.hidden = true;
    chipRow.replaceChildren();
    form.hidden = true;
  }

  // ── state ────────────────────────────────────────────────────────────
  let state: FlowState;
  let busy = false;
  let finished = false;

  function setBusy(next: boolean): void {
    busy = next;
    input.disabled = next;
    sendButton.disabled = next;
    for (const chip of chipRow.querySelectorAll('button')) chip.disabled = next;
  }

  function apply(effects: readonly FlowEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'say':
          addLine('bot', effect.text);
          break;
        case 'ask':
          chipRow.hidden = true;
          chipRow.replaceChildren();
          form.hidden = false;
          input.value = '';
          break;
        case 'choose':
          form.hidden = true;
          showChoices(effect.choices);
          break;
        case 'handoff':
          if (callbacks.hasSession()) callbacks.requestAgent(effect.reason);
          break;
        case 'done':
          finished = true;
          hideInputs();
          break;
        case 'send':
          break; // applied before commit, see take()
      }
    }
  }

  function commit(result: FlowResult): void {
    state = result.state;
    save(state);
    apply(result.effects);
  }

  async function take(inputEvent: FlowInput): Promise<void> {
    if (busy || finished) return;
    const result = advanceFlow(steps, state, inputEvent);
    if (result.effects.length === 0) return;

    const send = result.effects[0]?.type === 'send' ? result.effects[0] : undefined;
    if (send !== undefined) {
      setBusy(true);
      status.clear();
      try {
        await callbacks.send(send.text, send.metadata);
      } catch (error) {
        setBusy(false);
        status.show(SEND_FAILED);
        callbacks.onError(error);
        return; // not committed: same step, text left in the box
      }
      addLine('me', send.text);
      setBusy(false);
    }
    commit(result);
    if (!finished) focusCurrent();
  }

  function focusCurrent(): void {
    if (!form.hidden) input.focus({ preventScroll: true });
    else chipRow.querySelector('button')?.focus({ preventScroll: true });
  }

  // ── start or resume ──────────────────────────────────────────────────
  const saved = readSaved();
  if (saved !== null) {
    commit(resumeFlow(steps, { flowId, stepId: saved.stepId, answers: saved.answers, pendingTags: saved.pendingTags, done: false }));
  } else {
    commit(startFlow(flowId, steps));
  }

  return {
    node,
    focus: focusCurrent,
    destroy() {
      // No document-level listeners; every listener is on a node inside `node`.
    },
    abandon() {
      finished = true;
      clearSaved();
      hideInputs();
    },
  };
}
```

Add CSS to `packages/widget/src/ui/styles.ts` immediately after the `.dh-offline-text { overflow-wrap: anywhere; }` rule:

```css
.dh-flow {
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 2);
  padding: calc(var(--dh-space) * 3);
  min-height: 0;
}
.dh-flow-log {
  display: flex;
  flex-direction: column;
  gap: calc(var(--dh-space) * 1.5);
  overflow-y: auto;
  min-height: 0;
}
.dh-flow-line {
  margin: 0;
  max-width: 85%;
  min-width: 0;
  padding: calc(var(--dh-space) * 2) calc(var(--dh-space) * 3);
  border-radius: var(--dh-radius);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.dh-flow-line[data-from="bot"] {
  align-self: flex-start;
  background: var(--dh-bubble-in);
  border-bottom-left-radius: 4px;
}
.dh-flow-line[data-from="me"] {
  align-self: flex-end;
  background: var(--dh-accent);
  color: var(--dh-accent-text);
  border-bottom-right-radius: 4px;
}
.dh-flow-form {
  display: flex;
  gap: calc(var(--dh-space) * 2);
}
.dh-flow-form .dh-form-submit { flex: none; width: auto; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/widget/test/flow-view.test.ts`
Expected: PASS. If the "double tap sends once" test fails, confirm `setBusy(true)` runs synchronously before the first `await` in `take()` — the guard `if (busy || finished) return;` depends on it.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/ui/flow-view.ts packages/widget/src/ui/styles.ts packages/widget/test/flow-view.test.ts
git commit -m "feat(widget): out-of-hours flow view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the flow into the widget

**Files:**
- Modify: `packages/widget/src/widget.ts` (imports ~line 117; state declarations near `activeSurface` ~line 1972; helper + avatar check ~line 1446; branch in `syncProductSurfaces` ~line 3541–3603)
- Test: `packages/widget/test/offline-flow.test.ts`

**Interfaces:**
- Consumes: `offlineFlowFor` (Task 3); `createFlowView`, `FlowView` (Task 4); existing `store`, `remote`, `openSurface`, `closeSurface`, `syncProductSurfaces`, `config.auth.publishableKey`.
- Produces: no new exports. Behavior: closed + `COLLECT_MESSAGE` + usable OFFLINE flow → `.dh-flow` renders instead of `.dh-offline-form`; a customer-visible reply from a person/real bot after the flow's first send returns the panel to the normal conversation.

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/offline-flow.test.ts`. It reuses the exact harness from `remote-config-gating.test.ts` (copy its `PUBLISHABLE`, `SilentSocket`, `AckingSocket`, `config`, `published`, `stubFetch`, `shadow`, `find`, `settle` definitions verbatim; also its `beforeEach`/`afterEach` that unmount and unstub — view lines 1–215 and the hooks of that file). Then add:

```ts
// @vitest-environment jsdom
// (harness copied from remote-config-gating.test.ts — see that file's header)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

// …PUBLISHABLE, SilentSocket, AckingSocket, config(), published(), stubFetch(),
// shadow(), find(), settle() exactly as in remote-config-gating.test.ts…

const FLOW = {
  id: 'flow-1',
  name: 'Out of hours',
  trigger: 4,
  keywords: [],
  pagePattern: '',
  steps: [
    { id: 'a', kind: 'message', text: 'We are closed right now.' },
    { id: 'b', kind: 'question', text: 'What is your email?', saveAs: 'email' },
    { id: 'c', kind: 'end', text: 'Thanks, we will reply soon.' },
  ],
};

const closedWith = (flows: unknown[]) =>
  published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: false, flows });

const botLines = () =>
  [...shadow().querySelectorAll<HTMLElement>('.dh-flow-line[data-from="bot"]')].map((n) => n.textContent);

function frames(socket: InstanceType<typeof AckingSocket>): Array<{ t: string; d: Record<string, unknown> }> {
  return socket.sent.map((s) => JSON.parse(s));
}

async function mountClosed(configBody: unknown) {
  stubFetch(configBody);
  vi.stubGlobal('WebSocket', AckingSocket);
  const widget = mount(config());
  await settle();
  AckingSocket.instances[0]!.ack('sess_live');
  await settle();
  widget.open();
  await settle();
  return widget;
}

describe('COLLECT_MESSAGE runs the published OFFLINE flow', () => {
  it('shows the flow instead of the built-in form', async () => {
    await mountClosed(closedWith([FLOW]));
    expect(find('.dh-flow')).not.toBeNull();
    expect(find('.dh-offline-form')).toBeNull();
    expect(botLines()).toEqual(['We are closed right now.', 'What is your email?']);
  });

  it('falls back to the built-in form when no OFFLINE flow is published', async () => {
    await mountClosed(closedWith([]));
    expect(find('.dh-offline-form')).not.toBeNull();
    expect(find('.dh-flow')).toBeNull();
  });

  it('falls back to the built-in form when the flow has no usable steps', async () => {
    await mountClosed(closedWith([{ ...FLOW, steps: [{ id: 'x', kind: 'webhook' }] }]));
    expect(find('.dh-offline-form')).not.toBeNull();
  });

  it('ignores flows for other triggers', async () => {
    await mountClosed(closedWith([{ ...FLOW, trigger: 1 }]));
    expect(find('.dh-offline-form')).not.toBeNull();
  });

  it('does not run the flow while the team is open', async () => {
    await mountClosed(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: true, flows: [FLOW] }));
    expect(find('.dh-flow')).toBeNull();
    expect(find('.dh-offline-form')).toBeNull();
  });

  it('sends the visitor’s answer to chat-service as an offline_flow message', async () => {
    await mountClosed(closedWith([FLOW]));
    const input = find<HTMLInputElement>('.dh-flow-form input')!;
    input.value = 'a@b.co';
    find<HTMLFormElement>('.dh-flow-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    const sent = frames(AckingSocket.instances[0]!).find((f) => f.t === 'message.send');
    expect(sent?.d).toMatchObject({ content: 'a@b.co', metadata: { kind: 'offline_flow', flowId: 'flow-1', stepId: 'b' } });
    expect(botLines().at(-1)).toBe('Thanks, we will reply soon.');
  });
});

describe('a person replying takes over from the flow', () => {
  const agentReply = (socket: InstanceType<typeof AckingSocket>) =>
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'message.new',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        ts: Date.now(),
        // `message.new` carries a MessagePayload directly (core/src/protocol/frames.ts).
        d: {
          id: 'm_agent_1',
          sessionId: 'sess_live',
          senderId: 'agent_1',
          senderType: 'AGENT',
          type: 'TEXT',
          content: 'Hi, this is Sam',
          seq: 1, // the ack above carried seq 0, so this is the next in order
          createdAt: new Date().toISOString(),
        },
      }),
    });

  it('closes the flow and restores the conversation when an agent replies after the first send', async () => {
    await mountClosed(closedWith([FLOW]));
    find<HTMLInputElement>('.dh-flow-form input')!.value = 'a@b.co';
    find<HTMLFormElement>('.dh-flow-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    agentReply(AckingSocket.instances[0]!);
    await settle();
    expect(find('.dh-flow')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).not.toBe(true);
  });

  it('does NOT close a fresh flow because of an agent message that was already in the history', async () => {
    await mountClosed(closedWith([FLOW]));
    agentReply(AckingSocket.instances[0]!); // arrives before the visitor has answered anything
    await settle();
    expect(find('.dh-flow')).not.toBeNull();
  });
});
```

Frame names are confirmed against `packages/core/src/protocol/frames.ts`: the client sends `message.send` (`MessageSendPayload`: `content`, optional `metadata`), and the server pushes `message.new` (`MessagePayload`: `id, sessionId, senderId, senderType, type, content, seq, createdAt`). If `message.send` carries `metadata` under a different key than `d.metadata`, adjust only that one `toMatchObject` line after reading `MessageSendPayload`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/widget/test/offline-flow.test.ts`
Expected: FAIL — `.dh-flow` is null (the built-in form is still rendered).

- [ ] **Step 3: Write minimal implementation**

In `packages/widget/src/widget.ts`:

(a) Extend the import from `./remote-config.js` (around line 117) with `offlineFlowFor`, and add:

```ts
import { createFlowView } from './ui/flow-view.js';
import type { FlowView } from './ui/flow-view.js';
```

(b) Next to `let activeSurface` (~line 1972) declare the flow-tracking state:

```ts
  // The out-of-hours flow view, while one is on screen, and how many messages
  // the store held when the visitor's FIRST flow answer went out. Only replies
  // that arrive after that point count as "a person answered" — history that
  // was already in the session must not cancel a flow that has not started.
  let activeFlowView: FlowView | null = null;
  let flowBaseline: number | null = null;
  // The session in which a person/real bot took over. While the current
  // session is this one the flow does not come back; a new session may run it.
  let flowPreemptedSessionId: string | null = null;
```

(c) Add a helper near `syncProductSurfaces` (before it) and use it for both former `shouldCollectOffline(remote)` call sites (~lines 1446 and 3541):

```ts
  /** `shouldCollectOffline`, minus a flow that a person has already taken over. */
  function collectingOffline(): boolean {
    if (!shouldCollectOffline(remote)) return false;
    const current = store.getState().session?.id ?? null;
    return !(flowPreemptedSessionId !== null && flowPreemptedSessionId === current);
  }
```

Change `if (!shouldCollectOffline(remote)) {` (avatar, ~1446) to `if (!collectingOffline()) {`.

(d) At the top of `syncProductSurfaces`, before `if (shouldCollectOffline(remote)) {`, add the pre-emption check, and change that `if` to use the helper:

```ts
    if (activeFlowView !== null && flowBaseline !== null) {
      const arrived = store.getState().messages.slice(flowBaseline);
      if (arrived.some((m) => m.senderType === 'AGENT' || m.senderType === 'BOT')) {
        flowPreemptedSessionId = store.getState().session?.id ?? null;
        activeFlowView.abandon();
        closeSurface();
      }
    }

    if (collectingOffline()) {
```

(e) Inside that branch, replace the `openSurface('offline', () => ticketDestinationExists ? createWebformForm(...) : createOfflineForm(...))` expression so the third arm becomes the flow when one exists. Keep the two existing arms byte-for-byte; only restructure the ternary and pass a `key` so a changed flow rebuilds the view:

```ts
      const offlineFlow = ticketDestinationExists ? undefined : offlineFlowFor(remote);
      openSurface(
        'offline',
        () =>
          ticketDestinationExists
            ? createWebformForm(/* …existing arguments unchanged… */)
            : offlineFlow !== undefined
              ? buildFlowSurface(offlineFlow.flow.id, offlineFlow.steps)
              : createOfflineForm(/* …existing arguments unchanged… */),
        offlineFlow === undefined ? undefined : `flow:${offlineFlow.flow.id}`,
      );
```

and add, next to `collectingOffline`:

```ts
  function buildFlowSurface(flowId: string, steps: readonly FlowStep[]): ProductSurface {
    flowBaseline = null;
    const view = createFlowView(
      {
        flowId,
        steps,
        storageKey: `chatsdk:${config.auth.publishableKey}:offline-flow`,
        sessionId: store.getState().session?.id ?? null,
        ...(remote.offlineMessage === undefined ? {} : { offlineMessage: remote.offlineMessage }),
      },
      {
        send: async (text, metadata) => {
          if (flowBaseline === null) flowBaseline = store.getState().messages.length;
          await store.client.sendMessage(text, { metadata });
        },
        requestAgent: (reason) => store.client.requestAgent(reason),
        hasSession: () => store.getState().session !== null,
        onError: report,
      },
    );
    activeFlowView = view;
    return {
      node: view.node,
      focus: () => view.focus(),
      destroy: () => {
        view.destroy();
        if (activeFlowView === view) {
          activeFlowView = null;
          flowBaseline = null;
        }
      },
    };
  }
```

`FlowStep` needs importing: `import type { FlowStep } from './flow/parse.js';`. `report` is the widget's existing error sink already used by the neighbouring `onError: report` arguments.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/widget/test/offline-flow.test.ts packages/widget/test/remote-config-gating.test.ts`
Expected: PASS, including every pre-existing out-of-hours test (built-in form still appears when no flow exists).

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/widget.ts packages/widget/test/offline-flow.test.ts
git commit -m "feat(widget): run the OFFLINE bot flow under Collect a message

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification and hand-off to the customer app

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-offline-flow-engine-design.md` (one sentence: selection picks the first OFFLINE flow *with usable steps*)
- No other source changes.

**Interfaces:**
- Consumes: everything above.
- Produces: a green suite and a packed SDK ready for `npm run refresh:sdk` in the customer app.

- [ ] **Step 1: Typecheck and run the whole widget suite**

Run: `npx tsc --noEmit -p packages/widget` then `npx vitest run packages/widget`
Expected: tsc prints nothing. Vitest passes. `remote-config-gating.test.ts` › "waits out the configured delay before showing" is timing-sensitive under load; if it alone fails, rerun that file by itself before treating it as a regression.

- [ ] **Step 2: Align the spec with the implementation**

In the spec §4.1, change "Returns the first flow in `remote.flows` with `trigger === 4`" to "Returns the first flow with `trigger === 4` whose steps parse to at least one runnable step". Commit:

```bash
git add docs/superpowers/specs/2026-09-25-offline-flow-engine-design.md
git commit -m "docs: spec selects the first OFFLINE flow with usable steps

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Pack the SDK**

Run from the SDK root: `pnpm pack:local`
Expected: `packages/<name>/dhaam-ccrm-<name>-0.1.0.tgz` refreshed for browser, core, js, rest, widget.

- [ ] **Step 4: Refresh the customer app**

Run from `dh-hyperlocal-customer-app-react/`: `npm run refresh:sdk`
Expected: script ends with `SDK refreshed: all 5 packages match their tarballs.` Then `npx tsc --noEmit` and `npx vitest run app/lib/__tests__/chatConfig.test.ts` in that app.

- [ ] **Step 5: Manual check (needs a human)**

1. In the console: Chatbot → Flows, create and publish an OFFLINE-trigger flow: a message, a question saving `email`, and an end step.
2. Behaviour → Availability: Follow business hours ON, When closed = Collect a message. Save.
3. Ticket settings → Business hours: set the calendar so it is closed now.
4. Load the customer app (dev), wait for the config cache (up to the widget-config TTL), open the widget.
5. Expected: the flow's lines appear; answering sends a message the agent sees in the inbox with the answer as its text; an agent reply returns the panel to the normal conversation.

- [ ] **Step 6: Final commit state**

Run: `git status --short` and `git log --oneline -8`
Expected: clean tree, the feature commits on `feat/offline-flow-engine`. Do not push or open a PR unless asked.
