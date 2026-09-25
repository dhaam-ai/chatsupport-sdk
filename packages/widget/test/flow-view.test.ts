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
  const send = vi.fn(async (_text: string, _metadata: Record<string, unknown>) => undefined);
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
    const send = vi.fn(
      (_text: string, _metadata: Record<string, unknown>) => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { view } = build({ send });
    answerInput(view.node).value = 'a@b.co';
    answerForm(view.node).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    answerForm(view.node).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    release();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the visitor’s place and shows an error when the send fails', async () => {
    const send = vi.fn(async (_text: string, _metadata: Record<string, unknown>): Promise<void> => {
      throw new Error('offline');
    });
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
    const requestAgent = vi.fn();
    const { view } = build({ requestAgent, hasSession: () => false });
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
  it('clears saved progress and disables further input', () => {
    const { view } = build();
    view.abandon();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(answerForm(view.node).hidden).toBe(true);
  });
});

describe('startedAt', () => {
  it('is null until the first send succeeds, then saved and restored on resume', async () => {
    const first = build();
    expect(first.view.startedAt()).toBeNull();
    const before = Date.now();
    await answer(first.view.node, 'a@b.co');
    const at = first.view.startedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(JSON.parse(localStorage.getItem(KEY)!).startedAt).toBe(at);

    first.view.destroy();
    document.body.innerHTML = '';
    const second = build();
    expect(second.view.startedAt()).toBe(at);
  });

  it('a failed first send does not start the clock', async () => {
    const send = vi.fn(async (_text: string, _metadata: Record<string, unknown>): Promise<void> => {
      throw new Error('offline');
    });
    const { view } = build({ send });
    await answer(view.node, 'a@b.co');
    expect(view.startedAt()).toBeNull();
  });
});
