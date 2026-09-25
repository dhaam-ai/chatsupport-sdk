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
  stepId: string;
  answers: Record<string, string>;
  pendingTags: string[];
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
      return { stepId, answers: answers as Record<string, string>, pendingTags: pendingTags as string[] };
    } catch {
      return null;
    }
  }

  function save(next: FlowState): void {
    try {
      if (next.done || next.stepId === null) {
        localStorage.removeItem(storageKey);
        return;
      }
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          flowId: next.flowId,
          stepId: next.stepId,
          answers: { ...next.answers },
          pendingTags: [...next.pendingTags],
          sessionId,
        }),
      );
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
  const chipRow = el('div', { attrs: { class: 'dh-quick-replies' } });
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

  function focusCurrent(): void {
    if (!form.hidden) input.focus({ preventScroll: true });
    else chipRow.querySelector('button')?.focus({ preventScroll: true });
  }

  async function take(event: FlowInput): Promise<void> {
    if (busy || finished) return;
    const result = advanceFlow(steps, state, event);
    if (result.effects.length === 0) return;

    const first = result.effects[0];
    if (first?.type === 'send') {
      setBusy(true);
      status.clear();
      try {
        await callbacks.send(first.text, first.metadata);
      } catch (error) {
        setBusy(false);
        status.show(SEND_FAILED);
        callbacks.onError(error);
        return; // not committed: same step, text left in the box
      }
      addLine('me', first.text);
      setBusy(false);
    }
    commit(result);
    if (!finished) focusCurrent();
  }

  // ── start or resume ──────────────────────────────────────────────────
  const saved = readSaved();
  commit(
    saved !== null
      ? resumeFlow(steps, { flowId, stepId: saved.stepId, answers: saved.answers, pendingTags: saved.pendingTags, done: false })
      : startFlow(flowId, steps),
  );

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
