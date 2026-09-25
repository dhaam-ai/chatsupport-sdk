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
