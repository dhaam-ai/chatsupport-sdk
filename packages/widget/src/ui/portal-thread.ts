// The admin's view of ONE real customer conversation, opened from the
// Customers tab's real queue data (see widget.ts's portal wiring, and
// `../portal/portal-staff-client.ts` for why this is a second client rather
// than a branch in the customer one).

import type { ChatMessage, ChatState } from '@dhaam-ccrm/js';
import { ICONS, el, icon } from './dom.js';
import { createEmojiPicker, insertAtCaret } from './emoji.js';

export interface PortalThreadCallbacks {
  readonly onSend: (text: string) => Promise<void>;
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

/** The admin IS the agent on this surface — the inverse of `message-list.ts`'s own `isOutgoing`. */
function isOutgoing(message: ChatMessage): boolean {
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

export function createPortalThread(callbacks: PortalThreadCallbacks): PortalThreadView {
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
    attrs: { class: 'dh-icon-button dh-composer-tool-btn', type: 'button', 'aria-label': 'Insert link' },
    children: [icon(ICONS.link, 18)],
    on: {
      click: () => {
        const url = window.prompt('Enter link URL:', 'https://');
        if (url && url.trim()) {
          insertAtCaret(input, url.trim() + ' ');
          autoGrow();
          input.focus();
          syncSendState();
        }
      },
    },
  });

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

  const composerNode = el('div', {
    attrs: { class: 'dh-composer' },
    children: [
      errorLine,
      el('div', {
        attrs: { class: 'dh-composer-box' },
        children: [input, composerRow],
      }),
    ],
  });

  const node = el('div', { attrs: { class: 'dh-portal-thread' }, children: [log, composerNode] });

  let sendable = false;
  let sending = false;
  let currentCustomerName: string | null = null;

  function syncSendState(): void {
    const hasText = input.value.trim() !== '';
    sendButton.disabled = !sendable || sending || !hasText;
    imageBtn.disabled = !sendable || sending;
    attachBtn.disabled = !sendable || sending;
    linkBtn.disabled = !sendable || sending;
    emojiPicker.setEnabled(sendable && !sending);
  }

  function handleReply(message: ChatMessage): void {
    const snippet = message.content.trim().slice(0, 60);
    input.value = `> ${snippet}\n\n`;
    autoGrow();
    input.focus();
    syncSendState();
  }

  function renderBubble(message: ChatMessage): HTMLElement {
    const outgoing = isOutgoing(message);
    const timeStr = formatTime(message.createdAt);

    const replyBtn = el('button', {
      attrs: { class: 'dh-msg-reply-btn', type: 'button', 'aria-label': 'Reply' },
      children: [icon(ICONS.reply, 13)],
      on: {
        click: () => handleReply(message),
      },
    });

    const body = el('span', { attrs: { class: 'dh-msg-body' }, text: message.content });
    const bubble = el('div', { attrs: { class: 'dh-msg-bubble' }, children: [body] });

    if (outgoing) {
      const bubbleWrap = el('div', {
        attrs: { class: 'dh-msg-bubble-wrap' },
        children: [replyBtn, bubble],
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

    const bubbleWrap = el('div', {
      attrs: { class: 'dh-msg-bubble-wrap' },
      children: [bubble, replyBtn],
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
    input.value = '';
    autoGrow();
    try {
      await callbacks.onSend(text);
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
          el('p', { attrs: { class: 'dh-messages-empty' }, text: opening ? 'Opening…' : 'Select a conversation.' }),
        );
        return;
      }
      if (state.messages.length === 0) {
        log.replaceChildren(
          el('p', { attrs: { class: 'dh-messages-empty' }, text: 'No messages in this conversation yet.' }),
        );
        return;
      }

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
          elements.push(renderBubble(msg));
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
