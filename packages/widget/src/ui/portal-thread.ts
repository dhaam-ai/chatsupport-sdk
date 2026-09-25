// The admin's view of ONE real customer conversation, opened from the
// Customers tab's real queue data (see widget.ts's portal wiring, and
// `../portal/portal-staff-client.ts` for why this is a second client rather
// than a branch in the customer one).

import type { ChatMessage, ChatState, SendMessageOptions } from '@dhaam-ccrm/js';
import { ICONS, el, icon, safeLinkUrl } from './dom.js';
import { createEmojiPicker, insertAtCaret } from './emoji.js';
import { createMessageActions } from './message-actions.js';
import { flashMessage, readReplyQuote } from './message-list.js';

export interface PortalThreadCallbacks {
  readonly onSend: (text: string, options?: SendMessageOptions) => Promise<void>;
}

export interface PortalThreadView {
  readonly node: HTMLElement;
  /**
   * Renders the conversation currently open.
   * `state === null` means nothing has opened yet (or `opening` is true and
   * the join is still in flight); `state.session === null` means the join
   * has not produced a usable session yet either.
   */
  render(state: ChatState | null, opening: boolean): void;
  /** A load/open/send failure banner above the transcript. `null` clears it. */
  setError(message: string | null): void;
  /** Sets the active customer display name to show on incoming message bubbles. */
  setCustomerName(name: string | null): void;
  focus(): void;
}

/**
 * The admin IS the agent on this surface — the inverse of `message-list.ts`'s
 * own `isOutgoing` — for an ordinary support/DM conversation, where the only
 * CUSTOMER-typed party is the one real end-customer and every AGENT-typed
 * message is "our side" no matter which staff member sent it (shared-inbox
 * semantics: a coworker's reply belongs on the same side as mine).
 *
 * That collapses for a PARTNER conversation (admin/manager <-> merchant/
 * outlet): per the wire contract's "Partner chats" section, BOTH parties
 * send as senderType AGENT there, so `senderType === 'AGENT'` can no longer
 * tell "us" from "them" — every message in the thread would be "outgoing".
 * `isPartnerConversation` (the caller passes `state.session.customer ===
 * null` — see `packages/core/src/client/session.ts`'s `customer:
 * findParticipant(..., 'CUSTOMER')`, which is null exactly when no
 * participant is CUSTOMER-typed, i.e. never for a real customer
 * conversation) switches to comparing `senderId` against this viewer's own
 * id instead, matching the doc's "place messages by senderId".
 */
function isOutgoing(
  message: ChatMessage,
  isPartnerConversation: boolean,
  localParticipantId: string | null,
): boolean {
  if (isPartnerConversation) return message.senderId === localParticipantId;
  return message.senderType === 'AGENT';
}

function isSystemMessage(message: ChatMessage): boolean {
  if (message.senderType === 'SYSTEM' || message.type === 'SYSTEM' || (message.type as string) === 'system') return true;
  const content = message.content.trim();
  if (
    content.endsWith('has joined the chat.') ||
    content.endsWith('has left the chat.') ||
    content.includes('has joined the chat') ||
    content.includes('has left the chat') ||
    content.startsWith('Conversation assigned to') ||
    content.startsWith('The agent has left')
  ) {
    return true;
  }
  return false;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  } catch {
    return '';
  }
}

function formatDayKey(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return '';
  }
}

function getDayLabel(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'TODAY';
    if (diffDays === 1) return 'YESTERDAY';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  } catch {
    return '';
  }
}

function createDaySeparator(label: string): HTMLElement {
  const pill = el('span', { attrs: { class: 'dh-day-pill' }, text: label });
  return el('div', { attrs: { class: 'dh-day-separator' }, children: [pill] });
}

function createSystemRow(text: string): HTMLElement {
  const pill = el('span', { attrs: { class: 'dh-system-pill' }, text });
  return el('div', { attrs: { class: 'dh-system-row' }, children: [pill] });
}

export function createPortalThread(
  callbacks: PortalThreadCallbacks,
  localParticipantId: string | null = null,
): PortalThreadView {
  const log = el('div', { attrs: { class: 'dh-log dh-message-log dh-portal-log', role: 'log' } });
  const errorLine = el('p', { attrs: { class: 'dh-composer-error', hidden: true } });

  function autoGrow(): void {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  const input = el('textarea', {
    attrs: {
      class: 'dh-input',
      rows: '1',
      placeholder: 'Type your message...',
      'aria-label': 'Reply to customer',
      autocomplete: 'off',
    },
    on: {
      input: () => {
        autoGrow();
        syncSendState();
      },
      keydown: (event) => {
        const key = event as KeyboardEvent;
        if (key.key === 'Enter' && !key.shiftKey && !key.isComposing) {
          key.preventDefault();
          void submit();
        }
      },
    },
  }) as HTMLTextAreaElement;

  const imageInput = el('input', {
    attrs: { class: 'dh-file', type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true', hidden: true },
    on: {
      change: () => {
        const file = (imageInput as HTMLInputElement).files?.[0];
        if (file) {
          insertAtCaret(input, `[Image: ${file.name}] `);
          autoGrow();
          input.focus();
          syncSendState();
        }
        (imageInput as HTMLInputElement).value = '';
      },
    },
  });

  const fileInput = el('input', {
    attrs: { class: 'dh-file', type: 'file', tabindex: '-1', 'aria-hidden': 'true', hidden: true },
    on: {
      change: () => {
        const file = (fileInput as HTMLInputElement).files?.[0];
        if (file) {
          insertAtCaret(input, `[File: ${file.name}] `);
          autoGrow();
          input.focus();
          syncSendState();
        }
        (fileInput as HTMLInputElement).value = '';
      },
    },
  });

  const imageBtn = el('button', {
    attrs: { class: 'dh-icon-button dh-composer-tool-btn', type: 'button', 'aria-label': 'Attach image' },
    children: [icon(ICONS.image, 18)],
    on: { click: () => (imageInput as HTMLInputElement).click() },
  });

  const emojiPicker = createEmojiPicker({
    onSelect: (emoji) => {
      insertAtCaret(input, emoji);
      autoGrow();
      input.focus();
      syncSendState();
    },
  });

  const attachBtn = el('button', {
    attrs: { class: 'dh-icon-button dh-composer-tool-btn', type: 'button', 'aria-label': 'Attach file' },
    children: [icon(ICONS.paperclip, 18)],
    on: { click: () => (fileInput as HTMLInputElement).click() },
  });

  const linkBtn = el('button', {
    attrs: {
      class: 'dh-icon-button dh-composer-tool-btn',
      type: 'button',
      'aria-label': 'Insert a link',
      'aria-expanded': 'false',
      'aria-haspopup': 'true',
    },
    children: [icon(ICONS.link, 18)],
    on: { click: () => toggleLinkPopover() },
  });

  // ── link popover ──────────────────────────────────────────────────────
  // The same in-widget replacement `ui/composer.ts` built for the customer
  // flow, ported rather than re-designed — see that file's own
  // `toggleLinkPopover` doc for why this replaced `window.prompt` (the
  // host page's own dialog, unthemed and invisible on a sandboxed embed).
  // Same CSS classes too (`.dh-link-popover` and friends, ui/styles.ts), so
  // this needed no new styling of its own.
  const linkInput = el('input', {
    attrs: {
      class: 'dh-field-input dh-link-input',
      type: 'url',
      inputmode: 'url',
      placeholder: 'https://…',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;
  const linkError = el('p', { attrs: { class: 'dh-form-error dh-link-error', role: 'alert', hidden: true } });
  const linkCancel = el('button', {
    attrs: { class: 'dh-link-cancel', type: 'button' },
    text: 'Cancel',
    on: { click: () => dismissLinkPopover() },
  });
  const linkInsert = el('button', {
    attrs: { class: 'dh-form-submit dh-link-insert', type: 'submit' },
    text: 'Add',
  });
  const linkPopover = el('form', {
    attrs: {
      class: 'dh-link-popover',
      'aria-label': 'Insert a link',
      // `novalidate`: a `type="url"` field brings the browser's own
      // constraint bubble with it — the host-page chrome this popover
      // exists to avoid. `safeLinkUrl` in `submitLink` is the one validator.
      novalidate: true,
      hidden: true,
    },
    children: [
      el('label', {
        attrs: { class: 'dh-link-label' },
        children: [el('span', { text: 'Link URL' }), linkInput],
      }),
      linkError,
      el('div', { attrs: { class: 'dh-link-actions' }, children: [linkCancel, linkInsert] }),
    ],
    on: { submit: (event) => submitLink(event) },
  }) as HTMLFormElement;
  let linkOpen = false;

  function toggleLinkPopover(): void {
    if (linkOpen) {
      closeLinkPopover();
      return;
    }
    if (!sendable || sending) return;
    linkOpen = true;
    linkInput.value = '';
    showLinkError(null);
    linkPopover.hidden = false;
    linkBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onLinkDocumentPointerDown);
    document.addEventListener('keydown', onLinkDocumentKeydown, true);
    linkInput.focus({ preventScroll: true });
  }

  function closeLinkPopover(): void {
    if (!linkOpen) return;
    linkOpen = false;
    linkPopover.hidden = true;
    linkBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onLinkDocumentPointerDown);
    document.removeEventListener('keydown', onLinkDocumentKeydown, true);
  }

  function dismissLinkPopover(): void {
    if (!linkOpen) return;
    closeLinkPopover();
    linkBtn.focus({ preventScroll: true });
  }

  function showLinkError(message: string | null): void {
    linkError.textContent = message ?? '';
    linkError.hidden = message === null;
    linkInput.setAttribute('aria-invalid', String(message !== null));
  }

  function onLinkDocumentPointerDown(event: Event): void {
    const pressed = (event.composedPath()[0] ?? event.target) as Node;
    if (linkPopover.contains(pressed) || linkBtn.contains(pressed)) return;
    dismissLinkPopover();
  }

  function onLinkDocumentKeydown(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.key !== 'Escape' || !linkOpen) return;
    key.stopPropagation();
    dismissLinkPopover();
  }

  function submitLink(event: Event): void {
    event.preventDefault();
    if (!linkOpen) return;

    const url = safeLinkUrl(linkInput.value);
    if (url === null) {
      showLinkError('That does not look like a valid https:// link.');
      linkInput.focus({ preventScroll: true });
      return;
    }

    closeLinkPopover();
    insertAtCaret(input, url);
    autoGrow();
    syncSendState();
  }

  const sendButton = el('button', {
    attrs: { class: 'dh-send', type: 'button', 'aria-label': 'Send reply', disabled: true },
    children: [icon(ICONS.send, 18)],
    on: { click: () => { void submit(); } },
  });

  const toolsGroup = el('div', {
    attrs: { class: 'dh-composer-tools' },
    children: [imageBtn, emojiPicker.node, attachBtn, linkBtn, imageInput, fileInput],
  });

  const composerRow = el('div', {
    attrs: { class: 'dh-composer-row' },
    children: [toolsGroup, sendButton],
  });

  // The quoted message, shown above the input while a reply is being
  // composed — same shape as the customer composer's own chip
  // (ui/composer.ts), reused here rather than redesigned so the two
  // surfaces agree on what "replying" looks like.
  const replyName = el('span', { attrs: { class: 'dh-reply-name' } });
  const replyExcerpt = el('span', { attrs: { class: 'dh-reply-excerpt' } });
  const replyChip = el('div', {
    attrs: { class: 'dh-reply-chip', hidden: true },
    children: [
      el('span', { attrs: { class: 'dh-reply-body' }, children: [replyName, replyExcerpt] }),
      el('button', {
        attrs: { class: 'dh-reply-clear', type: 'button', 'aria-label': 'Cancel reply' },
        children: [icon(ICONS.close, 14)],
        on: { click: () => cancelReply() },
      }),
    ],
  });

  const composerNode = el('div', {
    attrs: { class: 'dh-composer' },
    children: [
      errorLine,
      replyChip,
      el('div', {
        attrs: { class: 'dh-composer-box' },
        // `linkPopover` anchors to the box's full width (`.dh-link-popover`
        // in styles.ts) and being inside the box means the box's own
        // `:focus-within` border lights while the URL field has focus — see
        // composer.ts's own placement of the same popover.
        children: [input, composerRow, linkPopover],
      }),
    ],
  });

  const node = el('div', { attrs: { class: 'dh-portal-thread' }, children: [log, composerNode] });

  let sendable = false;
  let sending = false;
  let currentCustomerName: string | null = null;

  /**
   * The message an agent's next send will quote — captured at reply-start,
   * not re-derived at send time, for the same reason widget.ts's customer
   * flow captures it: by send time the quoted message may have scrolled out
   * of the loaded page, and the excerpt sent must match what the chip showed.
   */
  let replyingTo: { messageId: string; excerpt: string; senderName: string } | null = null;

  /** The wire cap on a reply excerpt — matches widget.ts's own constant. */
  const MAX_REPLY_EXCERPT = 120;

  function startReply(message: ChatMessage, senderName: string): void {
    const raw = (message.content ?? '').trim().replace(/\s+/g, ' ');
    const text = message.attachment?.url !== undefined && raw === message.attachment.url ? '' : raw;
    const excerpt =
      text === ''
        ? 'Attachment'
        : text.length > MAX_REPLY_EXCERPT
          ? `${text.slice(0, MAX_REPLY_EXCERPT - 1)}…`
          : text;

    replyingTo = { messageId: message.id, excerpt, senderName };
    replyChip.hidden = false;
    replyName.textContent = senderName;
    replyExcerpt.textContent = excerpt;
    input.focus();
  }

  function cancelReply(): void {
    if (replyingTo === null) return;
    replyingTo = null;
    replyChip.hidden = true;
  }

  function syncSendState(): void {
    const hasText = input.value.trim() !== '';
    sendButton.disabled = !sendable || sending || !hasText;
    imageBtn.disabled = !sendable || sending;
    attachBtn.disabled = !sendable || sending;
    linkBtn.disabled = !sendable || sending;
    // A disabled trigger with an open popover would be unreachable and
    // unclosable by pointer — shut it rather than stranding it. Same rule
    // composer.ts's own `syncSendState` applies to its copy of this popover.
    if (linkBtn.disabled) closeLinkPopover();
    emojiPicker.setEnabled(sendable && !sending);
  }

  function renderBubble(message: ChatMessage, isPartnerConversation: boolean): HTMLElement {
    const outgoing = isOutgoing(message, isPartnerConversation, localParticipantId);
    const timeStr = formatTime(message.createdAt);

    // The quoted message this one replies to, drawn from the SAME metadata
    // shape the customer flow writes and reads (message-list.ts's own
    // readReplyQuote) — one wire format, read by both surfaces.
    const replyQuote = readReplyQuote(message.metadata);
    const quoteName = el('span', { attrs: { class: 'dh-quote-name' } });
    const quoteText = el('span', { attrs: { class: 'dh-quote-text' } });
    const quote = el('span', { attrs: { class: 'dh-msg-quote', hidden: true }, children: [quoteName, quoteText] });
    if (replyQuote !== null) {
      quote.hidden = false;
      quoteName.textContent = replyQuote.senderName;
      quoteText.textContent = replyQuote.excerpt;
      // Metadata first; the message's own `replyToMessageId` covers replies
      // whose metadata predates the id.
      const quotedId = replyQuote.messageId ?? message.replyToMessageId;
      if (quotedId !== undefined) {
        // Click / Enter / Space on the quote jumps to the message it answers.
        quote.setAttribute('role', 'button');
        quote.setAttribute('tabindex', '0');
        quote.setAttribute('data-jump', 'true');
        const jump = (): void => {
          const target = Array.from(log.querySelectorAll<HTMLElement>('[data-message-id]')).find(
            (row) => row.getAttribute('data-message-id') === quotedId,
          );
          if (target !== undefined) flashMessage(target);
        };
        quote.addEventListener('click', jump);
        quote.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          jump();
        });
      }
    }

    const body = el('span', { attrs: { class: 'dh-msg-body' }, text: message.content });
    const bubble = el('div', { attrs: { class: 'dh-msg-bubble' }, children: [quote, body] });

    if (outgoing) {
      // The admin IS the agent here, so the admin's own messages quote as
      // 'You' — the same word the customer flow's own outgoing rows use.
      const actions = createMessageActions({ onReply: () => startReply(message, 'You') });

      const bubbleWrap = el('div', {
        attrs: { class: 'dh-msg-bubble-wrap' },
        children: [actions.node, bubble],
      });

      const timeEl = el('time', { attrs: { class: 'dh-msg-time' }, text: timeStr });
      const tick = el('span', { attrs: { class: 'dh-tick' }, children: [icon(ICONS.checkDouble, 14)] });
      const meta = el('div', { attrs: { class: 'dh-msg-meta' }, children: [timeEl, tick] });

      const row = el('div', {
        attrs: { class: 'dh-msg', 'data-mine': 'true' },
        children: [bubbleWrap, meta],
      });
      return row;
    }

    // Incoming message
    const isBot = message.senderType === 'BOT';
    const isAgent = message.senderType === 'AGENT';
    const avatarClass = isBot ? 'dh-msg-avatar--bot' : (isAgent ? 'dh-msg-avatar--agent' : 'dh-msg-avatar--customer');

    const senderMetadata = message.metadata as Record<string, unknown> | undefined;
    const metaName =
      (typeof senderMetadata?.senderName === 'string' ? senderMetadata.senderName : null) ??
      (typeof senderMetadata?.name === 'string' ? senderMetadata.name : null) ??
      (typeof senderMetadata?.customerName === 'string' ? senderMetadata.customerName : null) ??
      (typeof senderMetadata?.author === 'string' ? senderMetadata.author : null);

    const resolvedCustomerName = metaName ?? currentCustomerName ?? 'Customer';
    const authorName = isBot ? '✦ Dhaam Assistant' : (isAgent ? (metaName ?? 'Staff') : resolvedCustomerName);
    const initial = isAgent
      ? (authorName.trim().charAt(0).toUpperCase() || 'S')
      : (resolvedCustomerName.trim().charAt(0).toUpperCase() || 'C');

    let avatarEl: HTMLElement;
    if (isBot) {
      avatarEl = el('span', {
        attrs: { class: `dh-msg-avatar ${avatarClass}` },
        children: [icon(ICONS.sparkle, 16)],
      });
    } else {
      avatarEl = el('span', {
        attrs: { class: `dh-msg-avatar ${avatarClass}` },
        text: initial,
      });
    }

    const authorEl = el('span', { attrs: { class: 'dh-msg-author' }, text: authorName });

    const actions = createMessageActions({ onReply: () => startReply(message, authorName) });
    const bubbleWrap = el('div', {
      attrs: { class: 'dh-msg-bubble-wrap' },
      children: [bubble, actions.node],
    });

    const timeEl = el('time', { attrs: { class: 'dh-msg-time' }, text: timeStr });
    const meta = el('div', { attrs: { class: 'dh-msg-meta' }, children: [timeEl] });

    const contentWrap = el('div', {
      attrs: { class: 'dh-msg-content-wrap' },
      children: [authorEl, bubbleWrap, meta],
    });

    const row = el('div', {
      attrs: { class: 'dh-msg', 'data-mine': 'false' },
      children: [avatarEl, contentWrap],
    });
    return row;
  }

  async function submit(): Promise<void> {
    const text = input.value.trim();
    if (text === '' || !sendable || sending) return;
    sending = true;
    syncSendState();
    const draft = input.value;
    // Read and cleared BEFORE the await, same reason widget.ts's customer
    // flow does it: a send that takes a second must not leave the chip on
    // screen looking like it still applies to whatever the agent types next.
    const addressedTo = replyingTo;
    cancelReply();
    input.value = '';
    autoGrow();
    try {
      await callbacks.onSend(
        text,
        addressedTo === null
          ? undefined
          : {
              replyToMessageId: addressedTo.messageId,
              metadata: {
                kind: 'reply',
                replyTo: {
                  messageId: addressedTo.messageId,
                  excerpt: addressedTo.excerpt,
                  senderName: addressedTo.senderName,
                },
              },
            },
      );
      errorLine.hidden = true;
    } catch (error) {
      input.value = draft;
      autoGrow();
      errorLine.textContent = error instanceof Error ? error.message : 'Could not send the reply.';
      errorLine.hidden = false;
    } finally {
      sending = false;
      syncSendState();
    }
  }

  return {
    node,

    render(state, opening) {
      sendable = state !== null && state.session !== null;
      syncSendState();

      if (state?.session) {
        const sessionAny = state.session as any;
        const sessionCustomerName =
          sessionAny.customer?.displayName ??
          sessionAny.customer?.name ??
          sessionAny.metadata?.customerName ??
          sessionAny.metadata?.senderName ??
          sessionAny.customerName ??
          null;
        if (sessionCustomerName && typeof sessionCustomerName === 'string' && sessionCustomerName.trim() && !currentCustomerName) {
          currentCustomerName = sessionCustomerName.trim();
        }
      }

      if (state === null || state.session === null) {
        log.replaceChildren(
          opening
            ? el('div', {
                attrs: { class: 'dh-loading', role: 'status' },
                children: [
                  el('span', { attrs: { class: 'dh-spinner', 'aria-hidden': 'true' } }),
                  el('span', { text: 'Loading messages…' }),
                ],
              })
            : el('p', { attrs: { class: 'dh-messages-empty' }, text: 'Select a conversation.' }),
        );
        return;
      }
      if (state.messages.length === 0) {
        log.replaceChildren(
          el('p', { attrs: { class: 'dh-messages-empty' }, text: 'No messages in this conversation yet.' }),
        );
        return;
      }

      const isPartnerConversation = state.session.customer === null;
      const elements: HTMLElement[] = [];
      let lastDayKey = '';

      for (const msg of state.messages) {
        const dayKey = formatDayKey(msg.createdAt);
        if (dayKey && dayKey !== lastDayKey) {
          lastDayKey = dayKey;
          elements.push(createDaySeparator(getDayLabel(msg.createdAt)));
        }

        if (isSystemMessage(msg)) {
          elements.push(createSystemRow(msg.content));
        } else {
          const row = renderBubble(msg, isPartnerConversation);
          row.setAttribute('data-message-id', msg.id);
          elements.push(row);
        }
      }

      log.replaceChildren(...elements);
      log.scrollTop = log.scrollHeight;
    },

    setError(message) {
      errorLine.textContent = message ?? '';
      errorLine.hidden = message === null;
    },

    setCustomerName(name) {
      currentCustomerName = name && name.trim() ? name.trim() : null;
    },

    focus() {
      input.focus({ preventScroll: true });
    },
  };
}
