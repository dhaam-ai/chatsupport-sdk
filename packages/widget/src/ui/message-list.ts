// The scrollback, its ticks, and the announcement channel behind it.
//
// ── Ticks come from core, always ────────────────────────────────────────
//
// `deriveTickState` is imported and called. This file computes nothing about
// delivery: not from `presence`, not from `seq` alone, not "if the agent is
// online". That is the exact bug v1 shipped — it drew the double tick from
// connectivity, which is a claim about a socket rather than about a message —
// and core's ticks.ts exists so no binding has to get it right a second time.
//
// ── Rendering is keyed, not wholesale ───────────────────────────────────
//
// A naive `log.replaceChildren(...messages.map(render))` on every state change
// is a paragraph shorter and wrong in four ways a user notices: it destroys
// any text selection mid-drag, it re-decodes every image attachment on every
// keystroke of a typing indicator, it makes the `<audio>` element restart, and
// it moves focus off any focused retry button. So elements are keyed by
// message id, created once, and patched in place.

import { deriveTickState } from '@dhaam-ccrm/js';
import type { ChatMessage, ChatState, MessageTickState } from '@dhaam-ccrm/js';
// Straight from core: `@dhaam-ccrm/js` re-exports the whole of `ChatState`'s
// shape EXCEPT `AttachmentMetadata`, even though `ChatMessage.attachment` is
// typed as one — so a binding consumer cannot name the type of a field the
// binding hands them. Reported as a gap in that package; imported from the
// source here rather than restated locally.
import type { AttachmentMetadata } from '@dhaam-ccrm/core';

import { ICONS, el, icon } from './dom.js';

/** Glyph plus the phrase a screen reader gets. The phrase is not optional. */
const TICK_PRESENTATION: Record<MessageTickState, { glyph: string; label: string }> = {
  pending: { glyph: '○', label: 'Sending' },
  sent: { glyph: '✓', label: 'Sent' },
  delivered: { glyph: '✓✓', label: 'Delivered' },
  read: { glyph: '✓✓', label: 'Read' },
};

export interface MessageListCallbacks {
  readonly onRetry: (message: ChatMessage) => void;
  readonly onLoadOlder: () => void;
}

export interface MessageListView {
  readonly log: HTMLElement;
  readonly liveRegion: HTMLElement;
  render(state: ChatState, localParticipantId: string | null): void;
}

export function createMessageList(callbacks: MessageListCallbacks): MessageListView {
  const loadOlder = el('button', {
    attrs: { class: 'dh-more', type: 'button', hidden: true },
    text: 'Load earlier messages',
    on: { click: () => callbacks.onLoadOlder() },
  });

  const empty = el('p', {
    attrs: { class: 'dh-empty' },
    text: 'No messages yet. Ask us anything about your order.',
  });

  const log = el('div', {
    attrs: {
      class: 'dh-log',
      // `log` rather than `feed`: this is a chronological conversation whose
      // relevant end is the newest entry, which is exactly what `log` means.
      // `feed` implies article-level navigation this UI does not implement.
      role: 'log',
      'aria-label': 'Conversation',
      // The list itself is NOT the live region — see `liveRegion` below.
      'aria-live': 'off',
      // Focusable so a keyboard user can scroll the history without a mouse;
      // a scrollable region that cannot take focus is unreachable by keyboard.
      tabindex: '0',
    },
    children: [loadOlder, empty],
  });

  // The announcement channel. Separate from `log` on purpose: marking the log
  // itself `aria-live` would announce the entire backfill every time older
  // messages load, and would re-announce our own outgoing message the instant
  // its optimistic echo appears — telling the user what they just typed.
  const liveRegion = el('div', {
    attrs: { class: 'dh-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  const typing = createTypingIndicator();
  log.appendChild(typing.node);

  /** id → rendered row, so a re-render patches rather than rebuilds. */
  const rows = new Map<string, MessageRow>();
  let announcedUpTo: string | null = null;
  let seenAnyState = false;

  function render(state: ChatState, localParticipantId: string | null): void {
    // Captured BEFORE mutating: reading `scrollTop` after an append gives the
    // post-append value and would make "was the user at the bottom" always
    // true for a growing list.
    const wasAtBottom = isNearBottom(log);

    empty.hidden = state.messages.length > 0;
    loadOlder.hidden = !state.pagination.hasMore;
    loadOlder.disabled = state.pagination.loadingMore;
    loadOlder.textContent = state.pagination.loadingMore
      ? 'Loading…'
      : 'Load earlier messages';

    const live = new Set<string>();
    let previous: Node = loadOlder;

    for (const message of state.messages) {
      live.add(message.id);
      let row = rows.get(message.id);
      if (row === undefined) {
        row = createRow(message, callbacks);
        rows.set(message.id, row);
      }
      row.update(message, deriveTickState({
        message,
        localParticipantId,
        deliveredWatermarks: state.deliveredWatermarks,
        readWatermarks: state.readWatermarks,
      }));

      // Keeps DOM order equal to core's array order without a full rebuild.
      // Core may reorder on a `seq` arriving late (D2), so position is
      // asserted every pass rather than assumed from insertion.
      if (previous.nextSibling !== row.node) {
        log.insertBefore(row.node, previous.nextSibling);
      }
      previous = row.node;
    }

    for (const [id, row] of rows) {
      if (live.has(id)) continue;
      row.node.remove();
      rows.delete(id);
    }

    // Typing bubble stays last so it reads as "someone is composing the next
    // message", not as an interruption in the middle of history.
    log.appendChild(typing.node);
    typing.update(state);

    announce(state, localParticipantId);

    if (wasAtBottom) scrollToBottom(log);
  }

  /**
   * Speaks the newest INCOMING message, once.
   *
   * Three filters, each removing a real annoyance: our own messages are never
   * announced (the user wrote them), nothing is announced on the first state
   * we see (that is history loading, and announcing 40 messages on open is
   * hostile), and a message already announced is never repeated when an
   * unrelated field on it changes — which is why the watermark is the id
   * rather than the array length, since a tick update does not lengthen the
   * array but a retry-then-succeed does reorder it.
   */
  function announce(state: ChatState, localParticipantId: string | null): void {
    const newest = state.messages[state.messages.length - 1];

    if (!seenAnyState) {
      seenAnyState = true;
      announcedUpTo = newest?.id ?? null;
      return;
    }
    if (newest === undefined) return;
    if (newest.id === announcedUpTo) return;

    announcedUpTo = newest.id;
    if (localParticipantId !== null && newest.senderId === localParticipantId) return;

    const who = senderLabel(newest, state);
    liveRegion.textContent = `${who}: ${describeContent(newest)}`;
  }

  return { log, liveRegion, render };
}

interface MessageRow {
  readonly node: HTMLElement;
  update(message: ChatMessage, tick: MessageTickState | null): void;
}

function createRow(initial: ChatMessage, callbacks: MessageListCallbacks): MessageRow {
  const body = el('span', { attrs: { class: 'dh-msg-body' } });
  const time = el('time', { attrs: { class: 'dh-msg-time' } });
  const tickGlyph = el('span', { attrs: { class: 'dh-tick', 'aria-hidden': 'true' } });
  const tickLabel = el('span', { attrs: { class: 'dh-sr' } });
  const retry = el('button', {
    attrs: { class: 'dh-retry', type: 'button', hidden: true },
    text: 'Retry',
  });
  const meta = el('div', {
    attrs: { class: 'dh-msg-meta' },
    children: [time, tickGlyph, tickLabel, retry],
  });

  const node = el('div', { attrs: { class: 'dh-msg' }, children: [body, meta] });

  let current = initial;
  retry.addEventListener('click', () => callbacks.onRetry(current));

  let attachmentNode: HTMLElement | null = null;

  return {
    node,
    update(message, tick) {
      current = message;

      node.setAttribute('data-mine', String(isOutgoing(message)));
      node.setAttribute('data-failed', String(message.delivery?.state === 'failed'));

      // `textContent`, never `innerHTML`. This string is another user's input.
      if (body.textContent !== message.content) body.textContent = message.content;

      const created = new Date(message.createdAt);
      const iso = Number.isNaN(created.getTime()) ? '' : created.toISOString();
      if (time.getAttribute('datetime') !== iso) {
        time.setAttribute('datetime', iso);
        time.textContent = Number.isNaN(created.getTime())
          ? ''
          : created.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }

      if (attachmentNode === null && message.attachment !== undefined) {
        attachmentNode = renderAttachment(message.attachment);
        node.insertBefore(attachmentNode, meta);
      }

      const presentation = tick === null ? null : TICK_PRESENTATION[tick];
      tickGlyph.textContent = presentation?.glyph ?? '';
      tickGlyph.setAttribute('data-state', tick ?? '');
      // The tick's meaning as words. Colour distinguishes `read` from
      // `delivered` visually; this is what distinguishes them otherwise.
      tickLabel.textContent = presentation === null ? '' : ` ${presentation.label}`;

      const failed = message.delivery?.state === 'failed';
      retry.hidden = !failed;
      if (failed) {
        const reason = message.delivery?.state === 'failed' ? message.delivery.reason : '';
        retry.setAttribute('aria-label', `Message failed to send (${reason}). Retry`);
      }
    },
  };
}

/**
 * Renders one attachment.
 *
 * Images are shown inline; everything else is a link. `rel="noreferrer"` is
 * not decoration — an attachment URL is served by the customer's own storage
 * and the referrer would otherwise leak the host page's URL (which on a
 * food-ordering site contains an order id) to it.
 */
function renderAttachment(attachment: AttachmentMetadata): HTMLElement {
  // Typed as core's shape but read defensively: this record arrives over the
  // socket from another participant's client, so the compiler's guarantee is
  // about our own call sites, not about what the server actually sent.
  const url = typeof attachment.url === 'string' ? attachment.url : '';
  const name = typeof attachment.fileName === 'string' && attachment.fileName !== ''
    ? attachment.fileName
    : 'Attachment';
  const mime = typeof attachment.mimeType === 'string' ? attachment.mimeType : '';

  // Only http(s) and blob. An attacker-supplied `javascript:` URL in an
  // attachment record would otherwise become a one-click script execution
  // inside the host's page.
  const safe = /^(https?:|blob:)/i.test(url) ? url : '';

  if (safe !== '' && mime.startsWith('image/')) {
    const img = el('img', {
      attrs: { class: 'dh-attachment-image', src: safe, alt: name, loading: 'lazy', decoding: 'async' },
    });
    return el('div', { children: [img] });
  }

  if (safe !== '' && mime.startsWith('audio/')) {
    const audio = el('audio', { attrs: { class: 'dh-audio', controls: true, src: safe, preload: 'none' } });
    return el('div', {
      children: [audio, el('span', { attrs: { class: 'dh-sr' }, text: `Voice message: ${name}` })],
    });
  }

  if (safe === '') return el('div', { attrs: { class: 'dh-attachment' }, text: name });

  return el('a', {
    attrs: { class: 'dh-attachment', href: safe, target: '_blank', rel: 'noopener noreferrer', download: name },
    children: [icon(ICONS.paperclip, 14), el('span', { text: name })],
  });
}

function createTypingIndicator(): { node: HTMLElement; update(state: ChatState): void } {
  const dots = [0, 1, 2].map(() => el('span', { attrs: { class: 'dh-typing-dot' } }));
  const label = el('span', { attrs: { class: 'dh-sr' }, text: 'Agent is typing' });
  const node = el('div', {
    attrs: {
      class: 'dh-typing',
      hidden: true,
      // Deliberately not a live region. A typing indicator that announces
      // itself interrupts the message the user is actually reading, and it
      // can flap several times a second.
      'aria-hidden': 'false',
    },
    children: [...dots, label],
  });

  return {
    node,
    update(state) {
      node.hidden = !state.typing.isTyping;
    },
  };
}

function isOutgoing(message: ChatMessage): boolean {
  return message.senderType === 'CUSTOMER';
}

function senderLabel(message: ChatMessage, state: ChatState): string {
  if (message.senderType === 'AGENT') {
    return state.session?.assignedAgent?.displayName ?? 'Agent';
  }
  if (message.senderType === 'SYSTEM') return 'System';
  if (message.senderType === 'BOT') return 'Assistant';
  return 'You';
}

/** What the live region says. An attachment has no `content`, so it needs words. */
function describeContent(message: ChatMessage): string {
  if (message.content.trim() !== '') return message.content;
  if (message.attachment !== undefined) {
    const mime = typeof message.attachment.mimeType === 'string' ? message.attachment.mimeType : '';
    if (mime.startsWith('image/')) return 'sent an image';
    if (mime.startsWith('audio/')) return 'sent a voice message';
    return 'sent a file';
  }
  return 'sent a message';
}

/**
 * Whether the user is close enough to the bottom that new messages should
 * follow them down.
 *
 * A tolerance rather than `=== 0`, because sub-pixel scroll positions and
 * fractional device pixel ratios mean an "at the bottom" list routinely
 * reports a remainder of 0.5 to 2px, and an exact test would silently stop
 * auto-scrolling on exactly the high-DPI phones this is aimed at.
 */
function isNearBottom(log: HTMLElement, tolerancePx = 40): boolean {
  const remaining = log.scrollHeight - log.scrollTop - log.clientHeight;
  return remaining <= tolerancePx;
}

function scrollToBottom(log: HTMLElement): void {
  log.scrollTop = log.scrollHeight;
}
