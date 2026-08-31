// New conversation — topic chips (when the merchant has configured any) plus
// a message, standing in place of the transcript exactly like the other
// product surfaces (ui/report-issue.ts, ui/pre-chat-form.ts) already do.
//
// ── Why this is a surface and not a fourth screen ──────────────────────────
//
// `ui/screens.ts`'s `ScreenName` union has exactly three members — home,
// messages, conversation — and stays that way here too, matching the
// Flutter package's own choice for the same reason: "new conversation" is
// what the CONVERSATION screen shows while there is no session yet to show a
// transcript for, not a fourth destination. Reaching it is
// `screens.go('conversation')` plus `openSurface('composingNew', …)` in
// widget.ts — the exact mechanism that already stands report-issue.ts, the
// pre-chat form and the CSAT survey in place of the log and composer,
// extended by one more kind rather than duplicated.
//
// ── One field, two jobs ────────────────────────────────────────────────────
//
// The textarea is both the session's `subject` (core's `startNewSession`
// payload) and the first message actually sent once Start succeeds. There is
// one box here, not two — asking a customer to describe their situation once
// for a "subject" and again as an opening message would be asking them to
// type it twice.
//
// ── `topic` is the chip's LABEL, not its id ────────────────────────────────
//
// `ChatSessionSummary.topic` is presentation — "one of the merchant's own
// configured chips" per core's own doc on the field — and the id exists only
// to key the chip in this list. Sending the id would put an opaque string
// where every other consumer (a ticket, a future subject line) expects the
// words a merchant actually wrote in the console.
//
// ── No "attach my active order" ─────────────────────────────────────────
//
// Deliberately absent — see the plan's own Context note: order data is out of
// scope for this pass, and chat-service's commerce routes are agent/admin
// tier, unreachable with a customer token. A checkbox here would render
// nothing.

import { el } from './dom.js';
import { createStatusLine, createSubmitButton, submitOnce } from './forms.js';
import type { ConversationTopic } from '../remote-config.js';

/** What Start hands the widget. `topic` is absent when no chip was picked. */
export interface NewConversationInput {
  readonly topic?: string;
  readonly message: string;
}

export interface NewConversationCallbacks {
  /** Starts the session and sends `message` as its opening line. Rejects on failure — the form shows its own message. */
  readonly onStart: (input: NewConversationInput) => Promise<void>;
  /** The customer backing out without starting anything. */
  readonly onCancel: () => void;
  readonly onError: (error: unknown) => void;
}

export interface NewConversationView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createNewConversationScreen(
  topics: readonly ConversationTopic[],
  callbacks: NewConversationCallbacks,
): NewConversationView {
  const heading = el('h3', {
    attrs: { class: 'dh-form-heading', id: 'dh-newconvo-heading' },
    text: 'Start a new conversation',
  });

  /** The chosen chip's id, or `null` for "no topic chosen" — a real, valid state core itself treats as absence. */
  let selectedTopicId: string | null = null;
  const chipNodes = new Map<string, HTMLButtonElement>();

  function selectTopic(id: string | null): void {
    selectedTopicId = id;
    for (const [chipId, node] of chipNodes) {
      const selected = chipId === id;
      node.setAttribute('aria-pressed', String(selected));
    }
  }

  const chips = el('div', {
    attrs: {
      class: 'dh-topics',
      // A group of toggle buttons, not a list of links — `aria-pressed`
      // below is what actually carries the selected state to a screen
      // reader.
      role: 'group',
      'aria-label': 'What is this about?',
      hidden: topics.length === 0,
    },
    children: topics.map((topic) => {
      const chip = el('button', {
        attrs: { class: 'dh-topic-chip', type: 'button', 'aria-pressed': 'false' },
        text: topic.label,
        on: {
          // A second tap on the SAME chip clears it, because "no topic
          // chosen" has to stay reachable after the first tap, not just
          // before it.
          click: () => selectTopic(selectedTopicId === topic.id ? null : topic.id),
        },
      });
      chipNodes.set(topic.id, chip);
      return chip;
    }),
  });

  const message = el('textarea', {
    attrs: {
      class: 'dh-field-input dh-newconvo-message',
      id: 'dh-newconvo-message',
      rows: '4',
      placeholder: 'What can we help with?',
    },
  });
  const messageField = el('div', {
    attrs: { class: 'dh-field' },
    children: [
      el('label', { attrs: { class: 'dh-field-label', for: 'dh-newconvo-message' }, text: 'Your message' }),
      message,
    ],
  });

  const status = createStatusLine();
  // Same resting/busy copy `ui/session-picker.ts`'s own "start new" buttons
  // use — this screen is what a tap on any of them now leads to, and the
  // wording should not change with the route that got here.
  const submit = createSubmitButton('Start a new conversation', 'Starting…');
  const cancel = el('button', {
    attrs: { class: 'dh-form-skip', type: 'button' },
    text: 'Cancel',
    on: { click: () => callbacks.onCancel() },
  });

  const node = el('div', {
    attrs: { role: 'group', 'aria-labelledby': 'dh-newconvo-heading' },
    children: [
      el('div', {
        attrs: { class: 'dh-form dh-newconvo-form' },
        children: [
          heading,
          chips,
          messageField,
          status.node,
          el('div', { attrs: { class: 'dh-form-actions' }, children: [submit.node, cancel] }),
        ],
      }),
    ],
  });

  submit.node.addEventListener('click', () => {
    const text = message.value.trim();
    if (text === '') {
      status.show('Tell us what you need help with.');
      message.focus();
      return;
    }

    const topicLabel = selectedTopicId === null ? undefined : topics.find((t) => t.id === selectedTopicId)?.label;
    void submitOnce(
      () => callbacks.onStart({ ...(topicLabel === undefined ? {} : { topic: topicLabel }), message: text }),
      {
        button: submit,
        status,
        failureMessage: "We couldn't start that conversation. Please try again.",
        onError: callbacks.onError,
      },
    );
  });

  return {
    node,
    focus() {
      message.focus();
    },
    destroy() {
      // Nothing document-level to release — every listener here is on a node
      // inside `node`, and goes with it. Same note report-issue.ts makes.
    },
  };
}
