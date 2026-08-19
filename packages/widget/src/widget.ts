// The widget itself: launcher, panel, and the wiring between core's state and
// the DOM.
//
// Reads state through `@dhaam-ccrm/js`'s `select`, never through a raw
// `client.subscribe`. Core notifies on EVERY state change — a keystroke of a
// typing indicator, a presence heartbeat, a watermark advancing — and a single
// subscription that re-rendered everything would rebuild the message list on
// each one. Each `select` below re-runs only when its own slice changes, which
// is the entire reason that package was built as this one's substrate.

import { isParkedCloseReason } from '@dhaam-ccrm/core';
import type { CloseReason } from '@dhaam-ccrm/core';
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

/**
 * The two connection states core deliberately does NOT retry out of (§8.1).
 *
 * Everything else recovers on its own and must be left alone: an ordinary
 * transport drop goes to `reconnecting` and is retried indefinitely with full
 * jitter (`#scheduleTransportRetry`), and an auth failure is retried against a
 * freshly-minted token up to `DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES` (3)
 * before it escalates. Offering a "Reconnect" button during those would race
 * core's own backoff and turn one client's bad minute into a reconnect storm.
 *
 * These two are different in kind. `suspended` means core has stopped on
 * purpose because something outside its control is broken — an unsupported
 * protocol version, or credentials that failed three times running — and
 * `closed` follows a `disconnect()`. Core documents `connect()` as the only
 * way out of either, which makes recovering from them the host's job, and
 * before this the widget never did it: it connected once at mount and had no
 * path back.
 */
const TERMINAL_CONNECTION_STATES: ReadonlySet<ConnectionState> = new Set(['suspended', 'closed']);

/**
 * Words for each connection state. Never colour alone — the dot is decoration.
 *
 * The two terminal states name the control that fixes them. `suspended`
 * previously read "Offline — messages will send when you reconnect", which
 * promised an automatic recovery that by definition never comes in that state
 * — core has stopped retrying, so the sentence was waiting on an event that
 * required the customer to act and never told them so.
 */
const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  authenticating: 'Connecting…',
  connected: 'Online',
  // True, and core really is retrying on its own here — no affordance offered.
  reconnecting: 'Reconnecting…',
  suspended: 'Not connected — use Reconnect to try again',
  closed: 'Disconnected — use Reconnect to try again',
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

  // History never arrives over the socket by design — `connection.ack`
  // deliberately does not carry messages (see create-chat-client.ts) — so
  // without this, `ChatState.messages` starts and stays empty until the user
  // finds the "load older" affordance, which itself stays hidden because
  // `pagination.hasMore` starts `false` (§6.4) and nothing else ever flips
  // it. `loadOlderMessages()` bypasses that guard on an empty list, which is
  // exactly the seam this widget is supposed to drive once on connect. Fired
  // only once (`historyRequested`): a later reconnect fires `connected`
  // again, and re-requesting page 1 there would fight with whatever real
  // "load older" progress the user made while connected.
  let historyRequested = false;

  /**
   * The id of the session an agent closed, or `null` while the conversation
   * is live.
   *
   * Held here rather than read off `ChatState` because the close *reason* —
   * which decides both whether to say anything at all (`SWITCHED` parks the
   * session rather than ending it) and what to say — arrives only on the
   * §6.5 `sessionClosed` event. `ChatSession` carries `closedAt` but not the
   * reason.
   *
   * The id, not a boolean, so the session-id subscription below can tell "a
   * new conversation replaced the closed one" from "the same closed one is
   * still on screen".
   */
  let closedSessionId: string | null = null;
  let startingNewConversation = false;
  let reconnecting = false;
  let lastAutoReconnectAt = 0;

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

  // Deliberately a sibling of `status`, not a child of it: `status` is a
  // `role="status"` live region, and a control inside one gets its label read
  // out as part of every status announcement.
  const reconnectButton = el('button', {
    attrs: { class: 'dh-reconnect', type: 'button', hidden: true },
    text: 'Reconnect',
    on: { click: () => reconnect('manual') },
  });

  const closeButton = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Close chat' },
    children: [icon(ICONS.close, 18)],
    on: { click: () => close() },
  });

  const titleNode = el('h2', { attrs: { class: 'dh-title', id: 'dh-title' }, text: config.title });

  const messageList = createMessageList({
    onRetry: (message) => retry(message),
    onStartNewConversation: () => startNewConversation(),
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
          reconnectButton,
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

  // The one ambient signal worth acting on: the browser saying connectivity
  // returned. It fires on a real transition rather than on a timer, and
  // `reconnect` ignores it outright unless core has actually given up.
  const onOnline = (): void => reconnect('auto');
  window.addEventListener('online', onOnline);

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
        syncComposer();
        syncReconnect();
      },
      { immediate: true },
    ),
    // An agent ending the conversation. Core applies the close to session
    // state and emits this; before it was handled here, nothing in the widget
    // reacted at all — the transcript simply stopped accepting replies with
    // no explanation and no way forward.
    store.on('sessionClosed', ({ closeReason }) => {
      // §12.5: `SWITCHED` parks the session because the customer moved to a
      // different active one — it has not ended, and telling them their
      // conversation is over would be false. `isParkedCloseReason` is core's
      // own predicate for this, so the distinction cannot drift from the
      // protocol's.
      if (isParkedCloseReason(closeReason)) return;

      closedSessionId = store.getState().session?.id ?? null;
      messageList.setClosure(closeReason);
      syncComposer();
    }),
    store.select(
      (state) => state.session?.id ?? null,
      (sessionId) => {
        // Only a *different, real* session clears the close. `startNewSession`
        // blanks `session` before the new ack arrives, and treating that null
        // as "recovered" would drop the closing line — and the button on it —
        // in the exact window where a failed reconnect leaves the customer
        // needing both.
        if (sessionId === null || closedSessionId === null) return;
        if (sessionId === closedSessionId) return;
        closedSessionId = null;
        messageList.setClosure(null);
        syncComposer();
      },
    ),
    store.select(
      (state) => state.uploading,
      (uploading) => composer.setUploading(uploading),
      { immediate: true },
    ),
    store.select(
      (state) => state.connectionState,
      (connectionState) => {
        if (connectionState !== 'connected' || historyRequested) return;
        historyRequested = true;
        // `.catch`, not `void`, for the same reason `onLoadOlder` below is:
        // an unhandled rejection here must not surface on the HOST's window.
        // A failure is not swallowed either — `loadOlderMessages()` never
        // rejects (messages/controller.ts), it reports through `lastError`/
        // the `error` event instead, which the host is already free to watch.
        store.client.loadOlderMessages().catch(report);
      },
    ),
  ];

  function retry(message: ChatMessage): void {
    store.client.sendMessage(message.content).catch(report);
  }

  /**
   * The one place that decides whether the customer can type.
   *
   * Two independent reasons to take the composer away, so one writer rather
   * than two: a connection that is terminally `closed`, and a conversation an
   * agent ended. When both were separate `setEnabled` calls, whichever fired
   * last won, and a connection-state change after a session close silently
   * re-enabled typing into a dead session.
   *
   * Deliberately NOT disabled merely because we are offline: core queues sends
   * durably (§9.6), so a user on a lift with no signal can still type their
   * question and have it go out on reconnect.
   */
  function syncComposer(): void {
    const connectionState = store.getState().connectionState;
    composer.setEnabled(closedSessionId === null && connectionState !== 'closed');
  }

  /** How long before an *automatic* recovery attempt may fire again. */
  const AUTO_RECONNECT_MIN_INTERVAL_MS = 5_000;

  function syncReconnect(): void {
    const terminal = TERMINAL_CONNECTION_STATES.has(store.getState().connectionState);
    reconnectButton.hidden = !terminal;
    reconnectButton.disabled = reconnecting;
    reconnectButton.textContent = reconnecting ? 'Reconnecting…' : 'Reconnect';
  }

  /**
   * Re-opens the connection after core has stopped trying.
   *
   * This is NOT a retry loop layered over core's. It only ever fires in a
   * state core has deliberately parked (`TERMINAL_CONNECTION_STATES`), so it
   * cannot race the transport backoff or the auth escalation — in every state
   * where core is still working, this returns immediately.
   *
   * `'auto'` triggers are the two signals that genuinely mean "the customer is
   * here and wants this now": opening the panel, and the browser reporting the
   * network came back. Both are human-paced rather than timer-paced, and the
   * interval floor bounds the pathological case — a customer opening and
   * closing the panel repeatedly against credentials that are simply broken,
   * where each attempt costs a token mint and a socket.
   *
   * `visibilitychange` is deliberately not one of them: it fires on every
   * alt-tab, which is frequent enough to be a poll rather than an intent.
   */
  function reconnect(trigger: 'manual' | 'auto'): void {
    if (destroyed || reconnecting) return;
    if (!TERMINAL_CONNECTION_STATES.has(store.getState().connectionState)) return;

    if (trigger === 'auto') {
      const now = Date.now();
      if (now - lastAutoReconnectAt < AUTO_RECONNECT_MIN_INTERVAL_MS) return;
      lastAutoReconnectAt = now;
    }

    reconnecting = true;
    syncReconnect();
    store.client
      .connect()
      .catch(report)
      .finally(() => {
        reconnecting = false;
        syncReconnect();
      });
  }

  /**
   * The way out of a closed conversation.
   *
   * Explicit rather than automatic — see the widget's README note: an agent
   * has just said "resolved", and silently re-opening on the customer's next
   * keystroke would hide the boundary between two separate conversations at
   * exactly the moment it matters most.
   */
  function startNewConversation(): void {
    if (startingNewConversation) return;
    startingNewConversation = true;
    messageList.setStartingNewConversation(true);

    store.client
      .startNewSession()
      .catch(report)
      .finally(() => {
        startingNewConversation = false;
        messageList.setStartingNewConversation(false);
      });
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
    // Opening the panel is the clearest statement of intent the customer can
    // make. If core parked the connection while they were away, this is the
    // moment to try again rather than showing them a dead widget and waiting
    // for them to find the button.
    reconnect('auto');
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
  //
  // History is seeded by the `connectionState` subscription above (the
  // `historyRequested` guard), not chained off this promise: that subscription
  // fires off the actual state transition to 'connected', which is what
  // `loadMore()` needs (`state.session.id` populated) regardless of exactly
  // when `connect()`'s own promise settles relative to it — one owner for
  // "seed history once," not two racing on the same guard.
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
      window.removeEventListener('online', onOnline);
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
