// The bot's own suggested follow-ups — `metadata.options` on a bot message.
//
// ── This is live data that was being thrown away ─────────────────────────
//
// nexusai's agent already returns them on every reply: `BotResponse.options`
// ("2-4 suggested follow-up options or actions", src/agent/
// dynamic_chatbot_agent.py), which chat-service stores verbatim as
// `metadata.options` (`ai-bot.service.ts` `_sendBotReply`). Nothing in this
// package read the key, so an LLM has been generating them into a bag nobody
// opened.
//
// ── Why these are not Common Questions ───────────────────────────────────
//
// `ui/common-questions.ts` renders the MERCHANT's list, configured in the
// console, shown before a conversation starts. These are the BOT's, generated
// per reply, shown during one. They look similar and are different features
// with different sources; sharing a renderer would mean one config change
// silently altering the other.
//
// ── Everything here is untrusted ─────────────────────────────────────────
//
// `MessageMetadata` is `{ [key: string]: unknown }` by definition — core never
// interprets it — and the producer at the far end is a language model. So the
// parse is defensive in exactly the way `remote-config.ts`'s leaf readers are:
// a non-array, a non-string entry, a blank, or an absurd count is dropped
// rather than rendered.

import { asksForAHuman } from '../handoff-keywords.js';
import { el } from './dom.js';

/**
 * Most chips rendered from one message.
 *
 * The prompt asks the model for 2-4. It is a language model, so it will
 * occasionally return twenty; a row of twenty chips would push the composer
 * off a phone screen. Extra ones are dropped rather than scrolled, because a
 * suggestion the customer cannot see is not a suggestion.
 */
const MAX_OPTIONS = 6;

/** Longest single chip. Past this it is a sentence, not an option. */
const MAX_LABEL = 80;

/**
 * `metadata.options` → the chips to draw. Never throws.
 *
 * Exported for tests: this is the half worth asserting exhaustively, and it is
 * a pure function of the bag and the keyword list.
 *
 * `handoffKeywords` is the tenant's `behaviour.handoffKeywords`, and any
 * suggestion that matches one is dropped. The only escalation path is the
 * customer typing those words themselves — a "Talk to a human"-type chip
 * would be the removed handoff button back under another name, this time
 * authored per-reply by a language model. Judged by `asksForAHuman`, the
 * SAME matcher the composer escalates on, not a second regex: a chip is sent
 * verbatim as the customer's message, so "would this chip escalate when
 * tapped?" and "should this chip render?" must be one question. This is
 * defence in depth — the server drops these before they are stored — but the
 * producer is an LLM two services away, and this row is where they render.
 */
export function readQuickReplies(
  metadata: unknown,
  handoffKeywords: readonly string[] = [],
): readonly string[] {
  if (typeof metadata !== 'object' || metadata === null) return [];
  const raw = (metadata as Record<string, unknown>)['options'];
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const label = entry.trim();
    // De-duplicated because a model asked for four options will sometimes
    // return the same one twice, and two identical chips read as a bug.
    if (label === '' || label.length > MAX_LABEL || seen.has(label)) continue;
    if (asksForAHuman(label, handoffKeywords)) continue;
    seen.add(label);
    if (seen.size === MAX_OPTIONS) break;
  }
  return [...seen];
}

/**
 * Which flow button a chip answers, when it came from a server-side flow
 * (chatbot-workflows.md §9.4-9.5). The engine matches a `flow_reply` to its
 * waiting step by `runId` + `stepId`, and to the button by `buttonId`.
 */
export interface FlowReplyRef {
  readonly runId: string;
  readonly stepId: string;
  readonly buttonId: string;
}

/** One tappable suggestion: the words shown (and sent), and the flow button behind it if any. */
export interface QuickReplyChip {
  readonly label: string;
  readonly reply?: FlowReplyRef;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * `metadata.buttons` → chips. Never throws.
 *
 * A flow's buttons are the MERCHANT'S words, so unlike `options` they are not
 * filtered against the handoff keywords: "Talk to a person" is what they meant
 * it to say, and what happens next is the flow engine's call, not the
 * widget's. Everything is still untrusted shape-wise, exactly as `options` is —
 * the metadata is an open bag two services away. A chip whose flow block is
 * missing or malformed is kept (tapping it still sends its label, which the
 * engine also accepts) but carries no `reply`.
 */
function readFlowButtons(metadata: unknown): readonly QuickReplyChip[] {
  const bag = record(metadata);
  const raw = bag?.['buttons'];
  if (!Array.isArray(raw)) return [];

  const flow = record(bag?.['flow']);
  const runId = text(flow?.['runId']);
  const stepId = text(flow?.['stepId']);

  const seen = new Set<string>();
  const chips: QuickReplyChip[] = [];
  for (const entry of raw) {
    const button = record(entry);
    const id = text(button?.['id']);
    const label = typeof button?.['label'] === 'string' ? button['label'].trim() : '';
    if (id === undefined || label === '' || label.length > MAX_LABEL || seen.has(id)) continue;
    seen.add(id);
    chips.push(
      runId !== undefined && stepId !== undefined
        ? { label, reply: { runId, stepId, buttonId: id } }
        : { label },
    );
    if (chips.length === MAX_OPTIONS) break;
  }
  return chips;
}

/**
 * What to offer under the newest bot message: the flow's buttons when it sent
 * usable ones, otherwise the LLM's follow-ups exactly as before.
 */
export function readSuggestions(
  metadata: unknown,
  handoffKeywords: readonly string[] = [],
): readonly QuickReplyChip[] {
  const buttons = readFlowButtons(metadata);
  if (buttons.length > 0) return buttons;
  return readQuickReplies(metadata, handoffKeywords).map((label) => ({ label }));
}

/**
 * The message metadata a tap on `chip` sends (chatbot-workflows.md §9.5), or
 * `undefined` for a chip with no flow behind it — an LLM follow-up is just
 * words. `kind: 'flow_reply'` is what makes the engine treat the message as
 * that button being pressed rather than as free text.
 */
export function flowReplyMetadata(chip: QuickReplyChip): Record<string, unknown> | undefined {
  if (chip.reply === undefined) return undefined;
  return { kind: 'flow_reply', runId: chip.reply.runId, stepId: chip.reply.stepId, buttonId: chip.reply.buttonId };
}

const sameChip = (a: QuickReplyChip, b: QuickReplyChip): boolean =>
  a.label === b.label &&
  a.reply?.runId === b.reply?.runId &&
  a.reply?.stepId === b.reply?.stepId &&
  a.reply?.buttonId === b.reply?.buttonId;

export interface QuickRepliesView {
  readonly node: HTMLElement;
  /** Draws `chips`, or hides the row when there are none. */
  update(chips: readonly QuickReplyChip[]): void;
}

/**
 * The chip row.
 *
 * One row reused across renders rather than one per message: only the newest
 * bot message ever shows chips (see message-list.ts), so a per-message row
 * would be N-1 hidden elements accumulating in the transcript.
 */
export function createQuickReplies(onSelect: (chip: QuickReplyChip) => void): QuickRepliesView {
  const node = el('div', {
    attrs: {
      class: 'dh-quick-replies',
      hidden: true,
      // A group rather than a list: these are controls, and naming them tells
      // a screen-reader user that what follows are the bot's suggestions
      // rather than more of its message.
      role: 'group',
      'aria-label': 'Suggested replies',
    },
  });

  let current: readonly QuickReplyChip[] = [];

  return {
    node,
    update(chips) {
      // Compared before rebuilding: `render` runs on every state change, and
      // replacing these nodes each time would drop focus mid-tab for a
      // keyboard user and restart the CSS transition on every delivery tick.
      if (chips.length === current.length && chips.every((chip, i) => sameChip(chip, current[i]!))) {
        node.hidden = chips.length === 0;
        return;
      }
      current = chips;
      node.hidden = chips.length === 0;
      node.replaceChildren(
        ...chips.map((chip) =>
          el('button', {
            attrs: { class: 'dh-quick-reply', type: 'button' },
            // `text`, so it goes through `textContent`. The label came from a
            // language model or a merchant by way of two services.
            text: chip.label,
            on: { click: () => onSelect(chip) },
          }),
        ),
      );
    },
  };
}
