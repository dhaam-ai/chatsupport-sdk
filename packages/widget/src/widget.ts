// The widget itself: launcher, panel, and the wiring between core's state and
// the DOM.
//
// Reads state through `@dhaam-ccrm/js`'s `select`, never through a raw
// `client.subscribe`. Core notifies on EVERY state change — a keystroke of a
// typing indicator, a presence heartbeat, a watermark advancing — and a single
// subscription that re-rendered everything would rebuild the message list on
// each one. Each `select` below re-runs only when its own slice changes, which
// is the entire reason that package was built as this one's substrate.

import type { ChatStore } from '@dhaam-ccrm/js';
import type { ChatMessage, ChatState, ConnectionState } from '@dhaam-ccrm/js';

import { createWidgetStore } from './client.js';
import { resolveConfig } from './config.js';
import type { ResolvedConfig, WidgetConfig } from './config.js';
import { createComposer } from './ui/composer.js';
import { ICONS, el, icon } from './ui/dom.js';
import { captureFocus, trapFocus } from './ui/focus.js';
import type { FocusTrap } from './ui/focus.js';
import { createMessageList } from './ui/message-list.js';
import { resolvePresentation } from './ui/presentation.js';
import type { ResolvedPresentation } from './ui/presentation.js';
import { createWidgetRoot } from './ui/root.js';
import { STYLES, themeCss } from './ui/styles.js';

/** How the host drives the widget after mounting it. */
export interface ChatWidget {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** The underlying store, for a host that wants to send programmatically. */
  readonly store: ChatStore;
  /** Removes every node, listener, timer, and the socket. Idempotent. */
  destroy(): void;
}

/** Words for each connection state. Never colour alone — the dot is decoration. */
const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  authenticating: 'Connecting…',
  connected: 'Online',
  reconnecting: 'Reconnecting…',
  suspended: 'Offline — messages will send when you reconnect',
  closed: 'Disconnected',
};

const CONNECTION_COLOR: Record<ConnectionState, string> = {
  idle: 'var(--dh-text-muted)',
  connecting: '#c98a00',
  authenticating: '#c98a00',
  connected: '#118d57',
  reconnecting: '#c98a00',
  suspended: '#b42318',
  closed: 'var(--dh-text-muted)',
};

export function createWidget(rawConfig: WidgetConfig): ChatWidget {
  const config = resolveConfig(rawConfig);
  const store = createWidgetStore(config);
  const localParticipantId = config.identity.userId;

  const root = createWidgetRoot(`${STYLES}\n${themeCss(config)}`);
  const { host, shadow } = root;
  host.setAttribute('data-side', config.side);

  let presentation: ResolvedPresentation = 'bubble';
  let open = false;
  let trap: FocusTrap | null = null;
  let restoreFocus: (() => void) | null = null;
  let destroyed = false;

  const report = (error: unknown): void => config.onError(error);

  // ── launcher ──────────────────────────────────────────────────────────
  const badge = el('span', { attrs: { class: 'dh-badge', hidden: true, 'aria-hidden': 'true' } });
  const launcherLabel = el('span', { attrs: { class: 'dh-launcher-label' }, text: config.title });
  const launcher = el('button', {
    attrs: {
      class: 'dh-launcher',
      type: 'button',
      // Both states are required by the brief and by APG's disclosure pattern:
      // `aria-expanded` says whether the panel is showing, `aria-controls`
      // says which element it refers to.
      'aria-expanded': 'false',
      'aria-controls': 'dh-panel',
      'aria-label': 'Open chat',
    },
    children: [icon(ICONS.chat, 24), launcherLabel, badge],
    on: { click: () => toggle() },
  });

  // ── panel ─────────────────────────────────────────────────────────────
  const statusDot = el('span', { attrs: { class: 'dh-status-dot', 'aria-hidden': 'true' } });
  const statusText = el('span', { attrs: { class: 'dh-status-text' } });
  const status = el('div', {
    attrs: { class: 'dh-status', role: 'status', 'aria-live': 'polite' },
    children: [statusDot, statusText],
  });

  const closeButton = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Close chat' },
    children: [icon(ICONS.close, 18)],
    on: { click: () => close() },
  });

  const titleNode = el('h2', { attrs: { class: 'dh-title', id: 'dh-title' }, text: config.title });

  const messageList = createMessageList({
    onRetry: (message) => retry(message),
    onLoadOlder: () => {
      // `.catch`, not `void`: an unhandled rejection here surfaces on the
      // HOST's window and lands in the host's error tracker as a bug in their
      // page. Nothing this widget does may escape into that.
      store.client.loadOlderMessages().catch(report);
    },
  });

  const composer = createComposer({
    onSend: (text) => store.client.sendMessage(text),
    onSendAttachment: (file) => store.client.sendAttachment(file, { fileName: file.name }),
    onTyping: () => {
      try {
        store.client.startTyping();
      } catch (error) {
        // A typing intent that fails must never block the keystroke that
        // triggered it.
        report(error);
      }
    },
    onError: report,
  });

  const panel = el('div', {
    attrs: {
      class: 'dh-panel',
      id: 'dh-panel',
      'data-open': 'false',
      role: 'dialog',
      // True because focus really is trapped while open — see ui/focus.ts.
      // Claiming it without the trap would tell a screen-reader user the page
      // behind is inert when it is not.
      'aria-modal': 'true',
      'aria-labelledby': 'dh-title',
      // Removed from the tab order and the a11y tree while closed. Without
      // this a keyboard user tabs into an invisible panel, and a screen reader
      // reads a conversation that is not on screen.
      'aria-hidden': 'true',
    },
    children: [
      el('span', { attrs: { class: 'dh-grip', 'aria-hidden': 'true' } }),
      el('header', {
        attrs: { class: 'dh-header' },
        children: [
          el('div', { children: [titleNode, status] }),
          el('div', { attrs: { class: 'dh-header-spacer' } }),
          closeButton,
        ],
      }),
      messageList.log,
      composer.node,
      messageList.liveRegion,
    ],
    on: {
      keydown: (event) => {
        const key = event as KeyboardEvent;
        if (key.key !== 'Escape') return;
        // Stopped here so the host page's own Escape handler does not also
        // fire — closing their modal because the user dismissed our chat.
        key.stopPropagation();
        key.preventDefault();
        close();
      },
    },
  });

  shadow.append(launcher, panel);

  // ── presentation ──────────────────────────────────────────────────────
  function applyPresentation(): void {
    const next = resolvePresentation(
      config.mode,
      { width: window.innerWidth },
      config.sheetBreakpointPx,
    );
    if (next === presentation) return;
    presentation = next;
    host.setAttribute('data-presentation', next);
    // `sidebar` is an edge tab whose accessible name is its visible label; the
    // other two are icon-only buttons that need one supplied.
    syncLauncher(store.getState());
  }

  host.setAttribute('data-presentation', presentation);
  applyPresentation();

  const onResize = (): void => {
    // Only `auto` reacts. A host that asked for `sidebar` gets a sidebar at
    // every width — they have a layout reason we cannot see.
    if (config.mode === 'auto') applyPresentation();
  };
  window.addEventListener('resize', onResize, { passive: true });

  // ── state → DOM ───────────────────────────────────────────────────────
  function syncLauncher(state: ChatState): void {
    const unread = state.unreadCount;
    const showBadge = unread > 0 && !open;
    badge.hidden = !showBadge;
    badge.textContent = unread > 99 ? '99+' : String(unread);

    // The count goes in the NAME, not only in the badge. A red dot a screen
    // reader never mentions is not an unread indicator.
    const base = open ? 'Close chat' : 'Open chat';
    launcher.setAttribute(
      'aria-label',
      showBadge ? `${base}, ${unread} unread ${unread === 1 ? 'message' : 'messages'}` : base,
    );
  }

  const unsubscribers = [
    store.select(
      (state) => state.messages,
      () => messageList.render(store.getState(), localParticipantId),
      { immediate: true },
    ),
    store.select(
      (state) => state.typing.isTyping,
      () => messageList.render(store.getState(), localParticipantId),
    ),
    store.select(
      (state) => state.pagination,
      () => messageList.render(store.getState(), localParticipantId),
      // `pagination` is a fresh object on every notification, so identity
      // comparison would fire on all of them. Compared field-wise instead.
      { isEqual: (a, b) => a.hasMore === b.hasMore && a.loadingMore === b.loadingMore },
    ),
    store.select(
      (state) => state.unreadCount,
      () => syncLauncher(store.getState()),
      { immediate: true },
    ),
    store.select(
      (state) => state.connectionState,
      (connectionState) => {
        statusText.textContent = CONNECTION_LABEL[connectionState];
        statusDot.style.color = CONNECTION_COLOR[connectionState];
        // Deliberately NOT disabled while offline: core queues sends durably
        // (§9.6), so a user on a lift with no signal can still type their
        // question and have it go out on reconnect. Only a terminal close
        // takes the composer away.
        composer.setEnabled(connectionState !== 'closed');
      },
      { immediate: true },
    ),
    store.select(
      (state) => state.uploading,
      (uploading) => composer.setUploading(uploading),
      { immediate: true },
    ),
  ];

  function retry(message: ChatMessage): void {
    store.client.sendMessage(message.content).catch(report);
  }

  // ── open / close ──────────────────────────────────────────────────────
  function openPanel(): void {
    if (open || destroyed) return;
    open = true;

    restoreFocus = captureFocus();
    panel.setAttribute('data-open', 'true');
    panel.removeAttribute('aria-hidden');
    launcher.setAttribute('aria-expanded', 'true');
    // In `bubble` the launcher stays visible as the close affordance; the
    // other two cover it entirely, so leaving it in the tab order would strand
    // a keyboard user on a control they cannot see.
    launcher.hidden = presentation !== 'bubble';

    trap = trapFocus(panel, shadow);

    // Focus the composer, which is what the user came to use. `preventScroll`
    // stops the host page from jumping to the widget's position — on a
    // fixed-position element that scroll is always wrong.
    composer.input.focus({ preventScroll: true });

    try {
      store.client.markRead();
    } catch (error) {
      report(error);
    }
    syncLauncher(store.getState());
    messageList.render(store.getState(), localParticipantId);
  }

  function close(): void {
    if (!open) return;
    open = false;

    panel.setAttribute('data-open', 'false');
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.hidden = false;

    trap?.release();
    trap = null;

    // Back where it came from. Without this, a keyboard user who opened the
    // chat from a "Need help?" link is dumped at the top of the document.
    restoreFocus?.();
    restoreFocus = null;

    syncLauncher(store.getState());
  }

  function toggle(): void {
    if (open) close();
    else openPanel();
  }

  // Nothing above this point opened a socket. Connecting last means a config
  // or DOM failure surfaces before any network cost is incurred.
  store.client.connect().catch(report);
  if (config.sessionId !== undefined) {
    try {
      store.client.joinSession(config.sessionId);
    } catch (error) {
      report(error);
    }
  }
  if (config.openOnLoad) openPanel();

  return {
    store,
    open: openPanel,
    close,
    toggle,
    isOpen: () => open,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('resize', onResize);
      trap?.release();
      restoreFocus?.();
      for (const unsubscribe of unsubscribers) unsubscribe();
      composer.destroy();
      // `disconnect: true` — this store built the client it wraps, so nothing
      // else on the page is using that socket.
      store.destroy({ disconnect: true });
      root.destroy();
    },
  };
}
