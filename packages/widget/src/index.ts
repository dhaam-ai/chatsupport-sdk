// @dhaam-ccrm/widget — task T25. The actual visible chat surface: a
// launcher button + chat window (messages, typing indicator, composer),
// built entirely on vanilla DOM/CSS against @dhaam-ccrm/core's
// createChatClient(). No React, no framework dependency of any kind — this
// is what makes it usable via a plain <script> tag (see tsup.config.ts's
// `chat-widget.global.js` build, `window.ChatWidget.initChatWidget(...)`)
// in any app, framework or none, same as @dhaam-ccrm/js's own reason to
// exist for the headless client.

import { createChatClient } from '@dhaam-ccrm/core';
import type { ChatClient, ChatClientConfig, ChatMessage, ChatState, GetToken } from '@dhaam-ccrm/core';

export interface ChatWidgetTheme {
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left';
}

export interface ChatWidgetConfig {
  publishableKey: string;
  apiUrl: string;
  wsUrl?: string;
  /** Preferred: an async token supplier, same as core's own config. */
  getToken?: GetToken;
  /**
   * Convenience for the common case of "I already have a token string"
   * (e.g. read once from localStorage at mount time) — wrapped into a
   * `getToken` that always resolves to this same value. For a token that
   * can change over the widget's lifetime, use `getToken` directly instead.
   */
  token?: string;
  theme?: ChatWidgetTheme;
  /** Defaults to `document.body`. */
  container?: HTMLElement;
  /** Defaults to true — call `client.connect()` as soon as the widget mounts. */
  autoConnect?: boolean;
}

export interface ChatWidgetInstance {
  open(): void;
  close(): void;
  toggle(): void;
  /** The underlying core client, for callers that need direct access (e.g. `identify()` after login). */
  readonly client: ChatClient;
  destroy(): void;
}

const STYLE_ELEMENT_ID = 'dhaam-chat-widget-styles';

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function initChatWidget(config: ChatWidgetConfig): ChatWidgetInstance {
  injectStylesOnce();

  const container = config.container ?? document.body;
  const position = config.theme?.position ?? 'bottom-right';
  const primaryColor = config.theme?.primaryColor ?? '#6366f1';

  const clientConfig: ChatClientConfig = {
    publishableKey: config.publishableKey,
    apiUrl: config.apiUrl,
    ...(config.wsUrl ? { wsUrl: config.wsUrl } : {}),
    ...(config.getToken ? { getToken: config.getToken } : config.token ? { getToken: async () => config.token! } : {}),
  };
  const client = createChatClient(clientConfig);

  // ── DOM scaffold ────────────────────────────────────────────────────────
  const root = el('div', `dhaam-chat-widget dhaam-chat-widget--${position}`);
  root.style.setProperty('--dhaam-chat-primary', primaryColor);

  const launcher = el('button', 'dhaam-chat-launcher');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const badge = el('span', 'dhaam-chat-badge');
  badge.style.display = 'none';
  launcher.appendChild(badge);

  const win = el('div', 'dhaam-chat-window');
  win.style.display = 'none';

  const header = el('div', 'dhaam-chat-header');
  const headerTitle = el('span', 'dhaam-chat-header-title', 'Chat with us');
  const headerStatus = el('span', 'dhaam-chat-header-status', '');
  const closeBtn = el('button', 'dhaam-chat-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  const headerText = el('div', 'dhaam-chat-header-text');
  headerText.append(headerTitle, headerStatus);
  header.append(headerText, closeBtn);

  const messagesEl = el('div', 'dhaam-chat-messages');
  const emptyState = el('div', 'dhaam-chat-empty', 'Say hello — we usually reply in a few minutes.');
  messagesEl.appendChild(emptyState);

  const typingEl = el('div', 'dhaam-chat-typing', '');
  typingEl.style.display = 'none';

  const composer = el('div', 'dhaam-chat-composer');
  const textarea = el('textarea', 'dhaam-chat-input');
  textarea.placeholder = 'Type a message…';
  textarea.rows = 1;
  const sendBtn = el('button', 'dhaam-chat-send', 'Send');
  sendBtn.type = 'button';
  composer.append(textarea, sendBtn);

  win.append(header, messagesEl, typingEl, composer);
  root.append(win, launcher);
  container.appendChild(root);

  // ── Behavior ────────────────────────────────────────────────────────────
  let isOpen = false;
  const renderedMessageIds = new Set<string>();
  let currentSessionId: string | null = null;

  function open(): void {
    isOpen = true;
    win.style.display = 'flex';
    launcher.classList.add('dhaam-chat-launcher--open');
    badge.style.display = 'none';
    client.markRead();
    scrollToBottom();
    textarea.focus();
  }
  function close(): void {
    isOpen = false;
    win.style.display = 'none';
    launcher.classList.remove('dhaam-chat-launcher--open');
  }
  function toggle(): void {
    if (isOpen) close();
    else open();
  }
  launcher.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderBubble(message: ChatMessage): HTMLElement {
    const isCustomer = message.senderType === 'CUSTOMER';
    const bubble = el('div', `dhaam-chat-bubble ${isCustomer ? 'dhaam-chat-bubble--customer' : 'dhaam-chat-bubble--other'}`);
    if (message.messageType === 'SYSTEM') {
      bubble.className = 'dhaam-chat-bubble dhaam-chat-bubble--system';
      bubble.textContent = message.content;
      return bubble;
    }
    const content = el('div', 'dhaam-chat-bubble-content', message.content);
    const time = el('div', 'dhaam-chat-bubble-time', formatTime(message.createdAt));
    bubble.append(content, time);
    return bubble;
  }

  function renderMessages(state: ChatState): void {
    if (state.session?.id !== currentSessionId) {
      // Session changed (or first snapshot) — a stale message list from a
      // previous session must not linger, so start clean rather than diff.
      currentSessionId = state.session?.id ?? null;
      renderedMessageIds.clear();
      messagesEl.innerHTML = '';
      messagesEl.appendChild(emptyState);
    }

    const hasMessages = state.messages.length > 0;
    emptyState.style.display = hasMessages ? 'none' : 'block';

    let appended = false;
    for (const message of state.messages) {
      if (renderedMessageIds.has(message.id)) continue;
      renderedMessageIds.add(message.id);
      messagesEl.appendChild(renderBubble(message));
      appended = true;
    }
    if (appended) scrollToBottom();
  }

  function renderConnectionStatus(state: ChatState): void {
    const labels: Record<ChatState['connectionState'], string> = {
      idle: '',
      connecting: 'Connecting…',
      authenticating: 'Connecting…',
      connected: '',
      reconnecting: 'Reconnecting…',
      suspended: 'Unable to connect',
      closed: '',
    };
    headerStatus.textContent = labels[state.connectionState];
  }

  function renderTyping(state: ChatState): void {
    if (state.typing.isTyping) {
      typingEl.textContent = 'Typing…';
      typingEl.style.display = 'block';
    } else {
      typingEl.style.display = 'none';
    }
  }

  function renderUnread(state: ChatState): void {
    if (!isOpen && state.unreadCount > 0) {
      badge.textContent = state.unreadCount > 9 ? '9+' : String(state.unreadCount);
      badge.style.display = 'flex';
    } else if (isOpen) {
      badge.style.display = 'none';
    }
  }

  const unsubscribeState = client.subscribe((state) => {
    renderMessages(state);
    renderConnectionStatus(state);
    renderTyping(state);
    renderUnread(state);
  });

  // ── Composer ────────────────────────────────────────────────────────────
  let typingActive = false;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function handleInputActivity(): void {
    if (!typingActive) {
      typingActive = true;
      client.startTyping();
    }
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingActive = false;
      client.stopTyping();
    }, 2000);
  }

  function send(): void {
    const content = textarea.value.trim();
    if (!content) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    if (typingTimer) clearTimeout(typingTimer);
    typingActive = false;
    client.stopTyping();
    client.sendMessage(content).catch(() => {
      // Optimistic UI already reflects the send; a failure is visible via
      // the connection-status line / lastError, not a separate toast here.
    });
  }

  textarea.addEventListener('input', () => {
    handleInputActivity();
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener('click', send);

  if (config.autoConnect !== false) {
    client.connect().catch(() => {
      // Surfaced via renderConnectionStatus (state.connectionState becomes
      // 'suspended') rather than thrown here — a widget must not crash the
      // host page just because the backend is unreachable.
    });
  }

  return {
    open,
    close,
    toggle,
    client,
    destroy(): void {
      unsubscribeState();
      client.destroy();
      root.remove();
    },
  };
}

const CSS = `
.dhaam-chat-widget { position: fixed; z-index: 2147483000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.dhaam-chat-widget--bottom-right { right: 20px; bottom: 20px; }
.dhaam-chat-widget--bottom-left { left: 20px; bottom: 20px; }
.dhaam-chat-launcher { position: relative; width: 56px; height: 56px; border-radius: 50%; border: none; background: var(--dhaam-chat-primary, #6366f1); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.2); transition: transform 0.15s ease; }
.dhaam-chat-launcher:hover { transform: scale(1.05); }
.dhaam-chat-badge { position: absolute; top: -4px; right: -4px; background: #ef4444; color: #fff; border-radius: 999px; font-size: 11px; line-height: 1; padding: 4px 6px; display: flex; align-items: center; justify-content: center; min-width: 18px; }
.dhaam-chat-window { position: absolute; bottom: 72px; right: 0; width: 360px; max-width: calc(100vw - 40px); height: 520px; max-height: calc(100vh - 120px); background: #fff; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; }
.dhaam-chat-widget--bottom-left .dhaam-chat-window { right: auto; left: 0; }
.dhaam-chat-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: var(--dhaam-chat-primary, #6366f1); color: #fff; }
.dhaam-chat-header-text { display: flex; flex-direction: column; }
.dhaam-chat-header-title { font-weight: 600; font-size: 15px; }
.dhaam-chat-header-status { font-size: 12px; opacity: 0.85; min-height: 14px; }
.dhaam-chat-close { background: none; border: none; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px; }
.dhaam-chat-messages { flex: 1; overflow-y: auto; padding: 12px; background: #f7f7f8; }
.dhaam-chat-empty { color: #888; font-size: 13px; text-align: center; margin-top: 24px; }
.dhaam-chat-bubble { max-width: 78%; margin-bottom: 8px; display: flex; flex-direction: column; }
.dhaam-chat-bubble--customer { margin-left: auto; align-items: flex-end; }
.dhaam-chat-bubble--other { margin-right: auto; align-items: flex-start; }
.dhaam-chat-bubble-content { padding: 8px 12px; border-radius: 14px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
.dhaam-chat-bubble--customer .dhaam-chat-bubble-content { background: var(--dhaam-chat-primary, #6366f1); color: #fff; border-bottom-right-radius: 4px; }
.dhaam-chat-bubble--other .dhaam-chat-bubble-content { background: #fff; color: #111; border: 1px solid #e5e5e5; border-bottom-left-radius: 4px; }
.dhaam-chat-bubble-time { font-size: 10px; color: #999; margin-top: 2px; }
.dhaam-chat-bubble--system { text-align: center; font-size: 12px; color: #888; margin: 8px auto; }
.dhaam-chat-typing { padding: 0 16px 4px; font-size: 12px; color: #888; font-style: italic; }
.dhaam-chat-composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; background: #fff; }
.dhaam-chat-input { flex: 1; resize: none; border: 1px solid #ddd; border-radius: 10px; padding: 8px 10px; font-size: 14px; font-family: inherit; max-height: 120px; }
.dhaam-chat-input:focus { outline: none; border-color: var(--dhaam-chat-primary, #6366f1); }
.dhaam-chat-send { background: var(--dhaam-chat-primary, #6366f1); color: #fff; border: none; border-radius: 10px; padding: 0 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.dhaam-chat-send:hover { opacity: 0.9; }
@media (max-width: 420px) {
  .dhaam-chat-window { width: calc(100vw - 24px); height: calc(100vh - 100px); bottom: 72px; }
}
`;
