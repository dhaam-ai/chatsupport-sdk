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
import { ChatClientConfigError } from '@dhaam-ccrm/js';
import type { ChatStore } from '@dhaam-ccrm/js';
import type { ChatMessage, ChatSessionSummary, ChatState, ConnectionState } from '@dhaam-ccrm/js';

import { createWidgetStore } from './client.js';
import { resolveConfig } from './config.js';
import type { ResolvedConfig, WidgetConfig } from './config.js';
import { createComposer } from './ui/composer.js';
import { ICONS, el, icon } from './ui/dom.js';
import { captureFocus, trapFocus } from './ui/focus.js';
import type { FocusTrap } from './ui/focus.js';
import { createIdentityHeader } from './ui/identity-header.js';
import { createMessageList } from './ui/message-list.js';
import { resolvePresentation } from './ui/presentation.js';
import type { ResolvedPresentation } from './ui/presentation.js';
import { createWidgetRoot } from './ui/root.js';
import { createPreChatScreen, createSessionSwitcher } from './ui/session-picker.js';
import type { SessionPickerCallbacks } from './ui/session-picker.js';
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
 * `suspended` means core stopped on purpose because something outside its
 * control is broken — an unsupported protocol version, or credentials that
 * failed three times running — and `closed` follows a `disconnect()`. Core
 * documents `connect()` as the only way out of either, which makes recovering
 * from them the host's job.
 *
 * These are the only two states in which the Reconnect button is PRESSABLE.
 * See {@link WorkingConnectionState} for why it is deliberately inert
 * everywhere else, even though it is no longer invisible there.
 */
const TERMINAL_CONNECTION_STATES: ReadonlySet<ConnectionState> = new Set(['suspended', 'closed']);

/**
 * How long a session switch waits for core's connect-time history work before
 * going ahead without it.
 *
 * A deadline is not optional here. {@link createWidget}'s `whenHistorySettles`
 * resolves on a `pagination` transition, and `pagination` only ever moves
 * because a connection reached `connected` and core seeded page one. A socket
 * that never gets there — a connect that keeps failing, or a `suspended`
 * client core has deliberately stopped retrying — produces no transition at
 * all, so an unbounded wait turns every row in the picker into a click that
 * navigates nowhere, reports nothing, and leaves one live subscription behind
 * per press on a widget that lives as long as the tab does.
 *
 * Shorter than core's own `SESSION_SNAPSHOT_TIMEOUT_MS` (10s) on purpose. This
 * wait is an optimisation in front of the real operation, not a step of it,
 * so it must not be the larger half of the customer's worst case.
 */
export const HISTORY_SETTLE_TIMEOUT_MS = 5_000;

/** Words for the states in which nothing is being attempted. */
const SETTLED_CONNECTION_LABEL = {
  idle: 'Not connected',
  connected: 'Online',
  // Both terminal states name the control that fixes them. `suspended` once
  // read "Offline — messages will send when you reconnect", which promised an
  // automatic recovery that by definition never comes in that state: core has
  // stopped retrying, so the sentence was waiting on an event that required the
  // customer to act and never told them so.
  suspended: 'Not connected — use Reconnect to try again',
  closed: 'Disconnected — use Reconnect to try again',
} as const satisfies Partial<Record<ConnectionState, string>>;

type SettledConnectionState = keyof typeof SETTLED_CONNECTION_LABEL;

/**
 * The states in which core is still working on the connection by itself.
 *
 * ── Why "Reconnect" is inert here, and does not force an attempt ──────────
 *
 * The bug this set exists to fix was that `connecting` belonged to NEITHER
 * list: the Reconnect button and the `online` listener were both gated on
 * `TERMINAL_CONNECTION_STATES`, so in the one state a client actually parks in
 * when the server is down, both silently did nothing and the customer got an
 * indefinite "Connecting…" with no further signal.
 *
 * The answer is not to let them call `connect()` here. Two independent reasons,
 * both readable in core's connection/controller.ts:
 *
 *   1. It cannot work. `connect()` returns the in-flight promise whenever one
 *      is pending, and that promise settles only on `connection.ack`,
 *      `disconnect()`, or `#suspend` — never on a retryable close. In exactly
 *      the reported scenario (server unreachable from the first load) it stays
 *      pending for the whole retry loop, so every `connect()` returns the same
 *      promise and opens no socket. A button wired to it would be a no-op by
 *      construction; enabling it only makes the no-op loud.
 *
 *   2. Where it could work, it would compete. After a successful connect and a
 *      later drop the promise is settled, so `connect()` runs `#cancelTimers()`
 *      and resets `#attempt` to 0 — cancelling core's armed backoff timer AND
 *      restarting its exponential backoff from the bottom. A customer tapping
 *      the button would pin backoff at attempt 0 for as long as they kept
 *      tapping. That is the second, competing retry mechanism this widget must
 *      not become.
 *
 * Core also no longer needs the help: every attempt now produces a close
 * within `connectTimeoutMs` (10s by default) and routes into the existing
 * backoff, so `connecting` self-heals unaided. What was missing was never the
 * button — it was the SIGNAL. So the control becomes visible-but-disabled once
 * something has demonstrably gone wrong, the status line says which thing, and
 * the button becomes pressable the instant core actually parks.
 */
type WorkingConnectionState = Exclude<ConnectionState, SettledConnectionState>;

/**
 * `in`, not a cast.
 *
 * This is the one place the settled and working halves of
 * {@link ConnectionState} are separated, and the narrowing it produces is
 * checked by the compiler rather than asserted by us. The concrete payoff is
 * that {@link SETTLED_CONNECTION_LABEL} can only ever be indexed by a key it
 * actually has: an eighth connection state added to core would fall through to
 * {@link workingConnectionStatus}'s generic copy, which is wrong-but-harmless,
 * where the cast this replaced would have put a literal `undefined` in the
 * status line.
 */
function isSettledConnection(state: ConnectionState): state is SettledConnectionState {
  return state in SETTLED_CONNECTION_LABEL;
}

/**
 * How many consecutive failed attempts before this stops being called a blip.
 *
 * One failure is the commonest event the transport has — a wifi handover, a
 * proxy recycling a socket — and core is usually back inside a second.
 * Escalated copy and a visible control on the FIRST failure would fire
 * constantly, on a healthy connection, for a condition that resolves itself
 * before the customer finishes reading it. Two consecutive failures is the
 * cheapest honest evidence that something is actually wrong.
 */
const OUTAGE_ATTEMPT_THRESHOLD = 2;

/**
 * More specific than "still trying", and it names something the customer can
 * act on. Reached from `navigator.onLine`, which is a fact the browser
 * volunteers rather than a guess this widget makes.
 */
const OFFLINE_LABEL = 'No internet connection — we\u2019ll reconnect when it\u2019s back';

/**
 * The copy the reported bug was missing.
 *
 * An indefinite "Connecting…" says an attempt is going fine. Once attempts
 * have failed twice running, that is false, and the true sentence has to say
 * both halves: we cannot reach it, AND we have not given up.
 */
const OUTAGE_LABEL = 'Can\u2019t reach chat \u2014 still trying';

/**
 * What the composer promises once anything typed will be held rather than sent.
 *
 * The composer stays ENABLED in every one of these states on purpose — core's
 * send queue is durable (§9.6), so a customer with no signal can still type
 * their question and have it go out on reconnect. Only the promise about what
 * happens to it changes.
 */
const QUEUEING_PLACEHOLDER = 'Type a message \u2014 we\u2019ll send it when you\u2019re back online';

const CONNECTION_COLOR: Record<ConnectionState, string> = {
  idle: 'var(--dh-text-muted)',
  connecting: '#c98a00',
  authenticating: '#c98a00',
  connected: '#118d57',
  reconnecting: '#c98a00',
  suspended: '#b42318',
  closed: 'var(--dh-text-muted)',
};

/**
 * How many past conversations the picker asks for.
 *
 * Five is the server's own default for `GET /chat/sessions/customer` and well
 * inside its cap of 20 (chat.validator.ts). A picker is a shortcut back to a
 * recent conversation, not an archive browser — a longer list would push the
 * "start a new conversation" action below the fold on a phone, which is the
 * one action every customer needs to be able to reach.
 */
const SESSION_PICKER_LIMIT = 5;

/** Everything the connection's state implies for the UI, decided in one place. */
interface ConnectionStatus {
  readonly label: string;
  readonly color: string;
  /**
   * `hidden` — no recovery control at all; nothing has gone wrong yet.
   * `inert` — shown and disabled: recovery is underway and pressing is not the
   *   missing step (see {@link WorkingConnectionState}).
   * `ready` — core has parked and only an explicit `connect()` revives it.
   */
  readonly control: 'hidden' | 'inert' | 'ready';
  /** Whether anything typed now will be held rather than sent immediately. */
  readonly queueing: boolean;
}

/**
 * The one function that decides what the customer is told about the connection.
 *
 * Pure, and the single source for all three surfaces it drives — the status
 * line, the Reconnect control, and the composer's prompt. They previously
 * disagreed because each was written separately: the composer stayed silent
 * while the status line said "Connecting…" forever, and the button's
 * visibility rule knew nothing about either. Any two of them contradicting
 * each other is now impossible by construction rather than by discipline.
 */
function resolveConnectionStatus(
  connectionState: ConnectionState,
  online: boolean,
  failedAttempts: number,
): ConnectionStatus {
  if (isSettledConnection(connectionState)) {
    return {
      label: SETTLED_CONNECTION_LABEL[connectionState],
      color: CONNECTION_COLOR[connectionState],
      control: TERMINAL_CONNECTION_STATES.has(connectionState) ? 'ready' : 'hidden',
      // `suspended` really does hold what is typed: core has stopped retrying,
      // but the durable send queue (§9.6) is untouched by that.
      queueing: connectionState === 'suspended',
    };
  }

  return workingConnectionStatus(connectionState, online, failedAttempts);
}

/**
 * The half of {@link resolveConnectionStatus} that runs while core is still
 * working on the connection by itself.
 *
 * Split out so the compiler, not a comment, guarantees the two halves cover
 * every {@link ConnectionState} exactly once — see {@link isSettledConnection}.
 */
function workingConnectionStatus(
  connectionState: WorkingConnectionState,
  online: boolean,
  failedAttempts: number,
): ConnectionStatus {
  const color = CONNECTION_COLOR[connectionState];
  const outage = failedAttempts >= OUTAGE_ATTEMPT_THRESHOLD;
  const control = outage ? 'inert' : 'hidden';

  // Checked before the attempt count: "there is no network" is both more
  // specific and more actionable than "we cannot reach the server", and it is
  // the reason the attempts are failing rather than a separate fact.
  if (!online) return { label: OFFLINE_LABEL, color, control, queueing: true };
  if (outage) return { label: OUTAGE_LABEL, color, control, queueing: true };

  return {
    // Zero failures is a first attempt genuinely in flight; one is a blip core
    // fixes on its own, which is what `reconnecting` has always meant here.
    label: failedAttempts === 0 ? 'Connecting\u2026' : 'Reconnecting\u2026',
    color,
    control,
    queueing: false,
  };
}

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

  /**
   * Every {@link whenHistorySettles} wait still in flight, keyed by its own
   * cancel function.
   *
   * `destroy()` cannot reach into a pending promise, and the `store.select`
   * teardown the store does on its own way out settles nothing — the promise
   * would simply stay pending forever with the whole `selectSession` frame
   * behind it. So each wait registers the one call that releases it, and
   * teardown drains the set.
   */
  const pendingHistorySettles = new Set<() => void>();

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
  /** One escalation in flight at a time — see {@link requestHumanAgent}. */
  let requestingAgent = false;
  /** Incremented by every `showConversation()`. See {@link maybeShowPreChat}. */
  let conversationShownEpoch = 0;
  let reconnecting = false;
  let lastAutoReconnectAt = 0;

  /**
   * What the browser says about connectivity, mirrored so the status can be
   * recomputed from an event rather than polled.
   *
   * Guarded because this file is imported in environments without a
   * `navigator` (SSR bundling a host page), where "assume online" is the only
   * answer that does not put a false offline notice on a server render.
   */
  let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

  /**
   * Consecutive failed connection attempts, reset on every successful connect.
   *
   * Counted from core's `reconnecting` event, which fires once per scheduled
   * retry, rather than derived from `connectionState` — the state cycles
   * `connecting → reconnecting → connecting` indefinitely, so it says whether
   * an attempt is in flight but never how many have already failed. That
   * missing number is precisely what separates "connecting normally" from the
   * indefinite "Connecting…" the customer reported.
   */
  let failedAttempts = 0;

  /** Whether the list has been asked for yet. Asked once, on the first open. */
  let sessionsRequested = false;
  /** Whether the pre-chat screen is the thing currently on screen. */
  let preChatOpen = false;
  /**
   * Whether the pre-chat screen may ever be shown for this widget.
   *
   * A host that passed `sessionId` has already named the conversation it wants
   * on screen, and opening onto a chooser would override an explicit
   * instruction. The header switcher still mounts in that case — being pointed
   * at one conversation is not the same as being locked into it.
   *
   * This is screen flow, not guest detection. The one guest-facing gate is
   * `sessions.length > 0` in `renderSessionPicker`, and there is no second one
   * anywhere in this package.
   */
  const preChatAllowed = config.sessionId === undefined;

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

  /**
   * "Talk to a human" — the customer's way off the bot.
   *
   * Core has had `requestAgent()` since the protocol was written and
   * chat-service has always handled `session.requestAgent`, but no surface in
   * this package ever called either: the ONLY route out of a bot conversation
   * was to phrase a sentence the bot's own intent classifier happened to
   * recognise. A customer who could not find those words could not reach a
   * person at all, which is the reported bug.
   *
   * Shown only while the bot is actually handling the conversation — see
   * {@link syncHandoff} for the exact rule. Offering it beside a human agent
   * would ask the customer to escalate to the person already typing to them.
   */
  const handoffButton = el('button', {
    attrs: { class: 'dh-handoff', type: 'button', hidden: true },
    text: 'Talk to a human',
    on: { click: () => requestHumanAgent() },
  });

  /**
   * Who the customer is talking to.
   *
   * Its `node` IS the `<h2 id="dh-title">` — mounted in place of the h2 this
   * file used to build by hand, so the panel's existing
   * `aria-labelledby="dh-title"` keeps working with nothing to change and,
   * more importantly, so there is exactly one title element rather than a
   * component and a hand-built rival for the same job.
   *
   * Nothing here interprets `handledBy`. The two rules that are easy to get
   * wrong — an ABSENT handler means "render the configured title", and a
   * PRESENT one can still be stale on a session reactivated from CLOSED —
   * both live inside the component behind core's own `isHandledByCurrent`.
   * Adding any identity logic on this side would be the second source of
   * truth that design exists to prevent.
   */
  const identityHeader = createIdentityHeader(config.title);

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

  /**
   * One set of callbacks behind both picker surfaces.
   *
   * The pre-chat screen and the header switcher are two views of the same two
   * decisions — "take me back to that conversation" and "start a fresh one" —
   * so they share one implementation of each. Giving them separate handlers
   * would let the same click mean two different things depending on which
   * surface the customer happened to use.
   */
  const pickerCallbacks: SessionPickerCallbacks = {
    // `void`: every failure inside `selectSession` is already reported, and a
    // promise handed back to a DOM click handler is a promise nothing awaits.
    onSelect: (sessionId) => void selectSession(sessionId),
    onStartNew: () => startNewConversation(),
  };

  const preChat = createPreChatScreen(pickerCallbacks);
  const switcher = createSessionSwitcher(pickerCallbacks);

  /**
   * The composer's ordinary prompt, read from the component rather than
   * restated here. Restating it would put the same sentence in two files, and
   * the copy would drift the first time either one was edited alone.
   */
  const composerPlaceholder = composer.input.placeholder;

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
          el('div', { children: [identityHeader.node, status] }),
          el('div', { attrs: { class: 'dh-header-spacer' } }),
          reconnectButton,
          // One self-contained node (its own positioning context), so it can
          // sit here without the header having to know anything about the
          // popover it opens. Hidden until there is something to switch to.
          switcher.node,
          closeButton,
        ],
      }),
      // The pre-chat screen stands in for the log + composer rather than
      // sitting above them — a chooser and the conversation it chooses between
      // are alternatives, not a stack.
      preChat.node,
      messageList.log,
      // Between the transcript and the composer: the customer looks here when
      // the bot's last answer did not help, which is exactly when they want
      // it. In the header it would compete with the conversation switcher for
      // a glance, and inside the log it would scroll away.
      handoffButton,
      composer.node,
      messageList.liveRegion,
      // Its own channel, deliberately not folded into `status` or the message
      // log's region: `status` re-announces on every connection change, and
      // the log's region is busy narrating ticks. See identity-header.ts.
      identityHeader.liveRegion,
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

  // The conversation is the default screen. The pre-chat chooser only ever
  // replaces it once a non-empty session list has actually arrived, so it
  // starts hidden rather than being hidden later by a subscription that has
  // no reason to fire on an empty list.
  showConversation();

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

  /**
   * The browser's own connectivity signals — the one ambient source worth
   * acting on, because they fire on a real transition rather than on a timer.
   *
   * Both listeners now do something in EVERY state, which is the half of the
   * reported bug that lived here: `onOnline` used to be nothing but
   * `reconnect('auto')`, and `reconnect` returns immediately unless core has
   * parked — so in `connecting`, the state that actually matters, coming back
   * online was silently ignored and the customer was told nothing had changed.
   *
   * What it does now is recompute the status, not force an attempt: while core
   * is working, forcing one is either a provable no-op or a reset of core's own
   * backoff — see {@link WorkingConnectionState}. `reconnect('auto')` is
   * still called and still self-gates, so the terminal case is unchanged.
   */
  const onOnline = (): void => {
    online = true;
    syncConnection();
    reconnect('auto');
  };
  const onOffline = (): void => {
    online = false;
    syncConnection();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

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
        // A completed handshake is the only proof the run of failures is over.
        if (connectionState === 'connected') failedAttempts = 0;
        syncConnection();
      },
      { immediate: true },
    ),
    // The count core's state cannot supply. `#scheduleRetry` emits this once
    // per scheduled retry, immediately after moving to `reconnecting` — so the
    // selector above has already re-rendered with the OLD count by the time
    // this runs, and this second render is what applies the new one.
    store.on('reconnecting', () => {
      failedAttempts += 1;
      syncConnection();
    }),
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
    // Default `strictEqual` comparison, on purpose: `applyAgentJoined` and
    // `applyAgentLeft` both spread a NEW session object, so a reference change
    // is exactly the signal that something about the handler moved. A
    // field-wise comparison here would have to enumerate `status`/`handledBy`
    // and would silently stop firing the day a third field joins them.
    store.select(
      (state) => state.session,
      (session) => identityHeader.update(session),
      { immediate: true },
    ),
    // Same `state.session` reference trigger, its own subscription: the
    // header renders an identity and this renders an action, and folding two
    // unrelated jobs into one listener is how the second one gets forgotten
    // the day the first is changed.
    store.select(
      (state) => state.session,
      () => syncHandoff(store.getState()),
      { immediate: true },
    ),
    store.select(
      (state) => state.pastSessions,
      (sessions) => renderSessionPicker(sessions),
      { immediate: true },
    ),
    // Keeps `aria-current` on the switcher's rows honest after a switch, a
    // `startNewSession`, or a server-side reactivation moved which session is
    // the current one. Renders from `pastSessions`, which this does not read
    // — one input, two triggers.
    store.select(
      (state) => state.session?.id ?? null,
      () => renderSessionPicker(store.getState().pastSessions),
    ),
    store.select(
      (state) => state.uploading,
      (uploading) => composer.setUploading(uploading),
      { immediate: true },
    ),
  ];

  /**
   * The Retry button on a permanently-failed bubble.
   *
   * `retryMessage(message.id)`, NEVER `sendMessage(message.content)`. That
   * distinction is the whole of the reported bug: a message's envelope id IS
   * its permanent id (D1), the server dedupes sends on
   * `@@unique([chatSessionId, clientMessageId])`, and `sendMessage` mints a
   * fresh ULID. So the old call was not a retry at all — it was a second,
   * independent message that failed independently, which is why every press
   * left another failed bubble with its own Retry button behind it.
   * `retryMessage` replays the ORIGINAL envelope under its original id, which
   * the server therefore collapses into the one message the user thinks they
   * sent.
   */
  // ── session picker ────────────────────────────────────────────────────

  /**
   * Shows or hides one pane of the panel.
   *
   * The `hidden` attribute alone is not enough here and the reason is worth
   * stating: `.dh-log`, `.dh-prechat` and `.dh-switcher` all carry an explicit
   * `display` in styles.ts, and a stylesheet `display` beats the UA's
   * `[hidden] { display: none }`. The attribute still does the job that
   * matters most — taking the pane out of the tab order and the accessibility
   * tree — and the inline style is what actually takes it off the screen.
   */
  function setPaneVisible(node: HTMLElement, visible: boolean): void {
    node.hidden = !visible;
    node.style.display = visible ? '' : 'none';
  }

  /**
   * Asks for the customer's recent conversations, once.
   *
   * Once, not on every open: the answer only changes when this customer starts
   * or switches a conversation, and both of those go through this file, which
   * re-renders from `pastSessions` either way. Re-fetching on every open would
   * spend a round trip to re-learn what the widget already knows.
   *
   * The result is not read from this promise. `listSessions` writes the page
   * to `ChatState.pastSessions` (§9.4-style wholesale replace) and the
   * subscription below renders from there, so the picker has one input rather
   * than two that could disagree.
   */
  function requestSessions(): void {
    if (sessionsRequested || destroyed) return;
    sessionsRequested = true;

    store.client
      .listSessions({ limit: SESSION_PICKER_LIMIT })
      .then(() => {
        // Revealing the chooser is deliberately tied to the DATA arriving
        // rather than to the open, so the panel never flashes an empty picker
        // on its way to the conversation.
        //
        // `void` with its own `.catch`: `maybeShowPreChat` now waits on
        // core's history load before it can tell an empty conversation from
        // one that has simply not loaded yet, and an unhandled rejection from
        // this branch would surface on the HOST's window.
        void maybeShowPreChat().catch(report);
      })
      .catch((error: unknown) => {
        // An embed whose client has no `sessionSummarySource` is a
        // CONFIGURATION fact, not a fault: core is telling us this deployment
        // simply has no session list. Degrading to "no picker" is exactly
        // right, and it is what keeps this change invisible to an existing
        // embed built against an older client — so it is swallowed rather than
        // pushed at the host's error tracker on every page load.
        //
        // Every other failure — a 5xx, a network drop, a malformed page — IS
        // a fault and is reported. Distinguished by the error's type, not by
        // its message.
        if (error instanceof ChatClientConfigError) return;
        report(error);
      });
  }

  /**
   * The one gate on both picker surfaces: `sessions.length > 0`, and nothing
   * else.
   *
   * `GET /chat/sessions/customer` answers an unidentified caller with
   * `200 { sessions: [] }` rather than a 403, so an empty page IS the guest
   * signal — there is no second "is this a guest" check here, in the
   * components (T11 left one out on purpose), or in `client.ts`. There is also
   * deliberately no widget flag: emptiness already gates the rollout in both
   * directions, and a flag on top would be a second off-switch that can
   * express nothing emptiness cannot.
   */
  function renderSessionPicker(sessions: readonly ChatSessionSummary[]): void {
    const hasSessions = sessions.length > 0;
    setPaneVisible(switcher.node, hasSessions);

    if (!hasSessions) {
      switcher.close();
      // Never strand the customer on a chooser with nothing to choose.
      if (preChatOpen) showConversation();
      return;
    }

    switcher.render(sessions, store.getState().session?.id ?? null);
    preChat.render(sessions);
  }

  /**
   * Reveals the chooser — but never in front of a conversation the customer is
   * already in.
   *
   * ── The bug this rule exists to fix ──────────────────────────────────────
   *
   * The only gate used to be `pastSessions.length > 0`, and the picker is a
   * FULL REPLACEMENT for the log and the composer. So any customer with
   * history — which, after their second conversation, is every customer —
   * opened the widget onto a list instead of onto the chat they were having.
   * Reload the page mid-conversation and the transcript was fetched, applied
   * to state, and then covered up: "my chat history is gone" from where the
   * customer sits, with the messages sitting behind the pane the whole time.
   *
   * The chooser is worth showing only when there is nothing to interrupt:
   *
   *   - NO session at all — nothing to land in.
   *   - A TERMINAL session (`CLOSED`/`RESOLVED`) — that conversation is over,
   *     so a list of others, plus "Start a new conversation", is exactly the
   *     right screen.
   *   - A live session with an EMPTY transcript — nothing has been said yet,
   *     so replacing it costs the customer nothing and reaching an older
   *     conversation is the likelier intent.
   *
   * Anything else means a live conversation with words in it, and the
   * customer's own history stays one click away in the header switcher, which
   * is a popover rather than a replacement precisely so it can be reached
   * from inside a conversation.
   *
   * `whenHistorySettles` first: "empty transcript" is only a fact once core's
   * page-one load has finished. Read too early it is true of every session,
   * which is the same bug again with an extra step.
   */
  async function maybeShowPreChat(): Promise<void> {
    if (destroyed || preChatOpen || !preChatAllowed) return;
    if (store.getState().pastSessions.length === 0) return;

    // Snapshotted BEFORE the await, checked after: waiting is what makes the
    // "empty transcript" test meaningful, and it is also a window in which the
    // customer can pick a row (or start a new conversation) and be put on the
    // conversation pane. Re-covering it with the chooser they just dismissed
    // would be this function undoing their click.
    const shownAt = conversationShownEpoch;

    await whenHistorySettles();
    if (destroyed || preChatOpen || !preChatAllowed) return;
    if (conversationShownEpoch !== shownAt) return;

    const state = store.getState();
    if (state.pastSessions.length === 0) return;

    const session = state.session;
    const inLiveConversation =
      session !== null &&
      session.status !== 'CLOSED' &&
      session.status !== 'RESOLVED' &&
      state.messages.length > 0;
    if (inLiveConversation) return;

    preChatOpen = true;
    setPaneVisible(preChat.node, true);
    setPaneVisible(messageList.log, false);
    composer.node.hidden = true;
    if (open) preChat.focus();
  }

  /** Puts the conversation back on screen. Idempotent. */
  function showConversation(): void {
    // Bumped unconditionally, including on the idempotent re-call: it is a
    // "the conversation pane has been asserted since you looked" marker for
    // {@link maybeShowPreChat}'s pending reveal, not a state change counter.
    conversationShownEpoch += 1;
    preChatOpen = false;
    setPaneVisible(preChat.node, false);
    setPaneVisible(messageList.log, true);
    composer.node.hidden = false;
  }

  /**
   * Take me back to that conversation.
   *
   * `switchSession` joins the chosen session, and the server accepts a
   * TERMINAL (`CLOSED`/`RESOLVED`) one there — picking a past conversation is
   * that ordinary path, not a special case. Nothing here
   * touches `status`: reactivation happens server-side on the customer's next
   * message, behind `FEATURE_SESSION_REACTIVATE_ON_CUSTOMER_MESSAGE` (default
   * OFF), and guessing at it locally would show a customer a live conversation
   * on a deployment where that flag is off.
   *
   * The conversation is shown immediately rather than on completion. The
   * switch is awaitable — it joins, waits for the snapshot, then seeds the
   * transcript — but holding the chooser up for a round trip would read as a
   * dead click, so the pane flips at once and the transcript fills in behind
   * it.
   *
   * The failure has to be caught, and caught around the `await`: a REJECTED
   * join or a snapshot that never arrives rejects the promise, and an
   * unhandled rejection here surfaces on the HOST's window and lands in the
   * host's error tracker as a bug in their page. `retry()` below documents the
   * same rule.
   *
   * No busy guard: core stamps each switch with an epoch and abandons a
   * superseded one, so a customer clicking two rows quickly lands on the
   * second. Guarding here would instead ignore their second click.
   */
  async function selectSession(sessionId: string): Promise<void> {
    showConversation();
    if (open) composer.input.focus({ preventScroll: true });

    // Behind core's own connect-time page-one load, for the reason
    // `whenHistorySettles` documents — a switch that overlaps it silently
    // fetches nothing and leaves the previous conversation's messages under
    // the new conversation's header, which is the reported bug. Free in the
    // ordinary case: by the time a customer has opened the panel and picked a
    // row, page one landed long ago and this resolves without waiting.
    await whenHistorySettles();
    if (destroyed) return;

    try {
      await store.client.switchSession(sessionId);
    } catch (error) {
      report(error);
    }
  }

  /**
   * Resolves once core's own connect-time history work has finished.
   *
   * Every `connected` puts core to work: it re-joins whatever session the
   * customer last chose and seeds page one of the transcript. Both are async
   * and both are already in flight by the time `connect()`'s promise settles,
   * so a switch started off that promise does not queue behind them — it
   * races them, and loses in both directions. `MessageController.loadMore`
   * refuses to start while another page is in flight, and refuses again once
   * one has landed (`initialLoaded && !hasMore`), so the racing switch joins
   * the named session and then quietly fetches nothing: the customer ends up
   * in one conversation reading another's transcript, or reading nothing at
   * all, depending on which round trip won. Sequencing is the only lever this
   * package has — the alternative would be for a switch to invalidate loads
   * started before it, which is core's to decide, not ours.
   *
   * `pagination` carries the whole signal. `initialLoaded` means a page has
   * landed; a `loadingMore` that has gone true and back to false means one was
   * attempted and failed. Either way nothing is in flight any more and the
   * switch's own load is free to run.
   *
   * ── Why the deadline PROCEEDS rather than refuses ────────────────────────
   *
   * `pagination` only moves because a connection reached `connected`. It never
   * does on a socket that cannot get there, so without
   * {@link HISTORY_SETTLE_TIMEOUT_MS} this waits forever and the picker row
   * the customer pressed does nothing, says nothing, and leaves a live
   * subscription behind.
   *
   * When the deadline passes the switch goes AHEAD, and the timeout is
   * reported. Refusing was the other option and is now the worse one:
   *
   *   - Core epoch-stamps in-flight loads and abandons superseded ones, so
   *     an overlapping seed no longer corrupts a switch. This wait went from
   *     the correctness barrier it was written as to an optimisation that
   *     saves a duplicate fetch — and an optimisation must not be able to
   *     veto the operation it is optimising.
   *   - Proceeding is what produces the customer-visible answer. On a dead
   *     socket `switchSession` fails immediately and audibly — core's
   *     `joinSessionAwaited` answers `disconnected` with "session.join was not
   *     sent: the socket is not open" — and `selectSession` reports it. On a
   *     merely slow one the switch simply works. Refusing would have produced
   *     the same nothing the deadline exists to remove.
   */
  function whenHistorySettles(): Promise<void> {
    if (destroyed || store.getState().pagination.initialLoaded) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let attempted = false;
      let settled = false;
      let unsubscribe: (() => void) | null = null;

      /**
       * The one exit. Every path out of the wait goes through it, so the
       * timer, the subscription and the registry entry are released exactly
       * once no matter which of the three fires first.
       */
      const finish = (reason: 'seeded' | 'timeout' | 'destroyed'): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingHistorySettles.delete(cancel);
        unsubscribe?.();

        // The switch goes ahead either way — see the deadline note above — but
        // a deadline that passed is still a fault, and the whole point of
        // bounding this was that the failure stops being invisible. `report`
        // is the only channel this package has to the host, and a host with no
        // `onError` gets config.ts's default, which writes to the console.
        if (reason === 'timeout') {
          report(
            new Error(
              `chat widget waited ${HISTORY_SETTLE_TIMEOUT_MS}ms for the connection to load history ` +
                `and gave up; the session switch is going ahead unsequenced ` +
                `(connection: ${store.getState().connectionState})`,
            ),
          );
        }

        resolve();
      };

      /** What {@link ChatWidget.destroy} calls to settle a wait mid-flight. */
      const cancel = (): void => finish('destroyed');

      const timer = setTimeout(() => finish('timeout'), HISTORY_SETTLE_TIMEOUT_MS);
      pendingHistorySettles.add(cancel);

      unsubscribe = store.select(
        (state) => state.pagination,
        (pagination) => {
          // Re-checked INSIDE the promise, not only at the top: teardown can
          // land between the two, and a wait that outlives the widget holding
          // it is the leak this registry exists to close.
          if (destroyed) {
            finish('destroyed');
            return;
          }
          attempted ||= pagination.loadingMore;
          if (pagination.loadingMore) return;
          if (!attempted && !pagination.initialLoaded) return;
          finish('seeded');
        },
      );

      // `store.select` does not fire synchronously without `immediate`, but
      // the state it reads can still have moved while this promise was being
      // built. Cheaper to re-read than to reason about it.
      if (destroyed) finish('destroyed');
      else if (store.getState().pagination.initialLoaded) finish('seeded');
    });
  }

  /**
   * Opens the conversation the HOST named in `config.sessionId`.
   *
   * `switchSession`, not `joinSession`: the host asked for a conversation to
   * be on screen, and only the former clears the one that is there and fetches
   * the one that was asked for.
   *
   * Deliberately last, behind {@link whenHistorySettles}, which is also what
   * makes it beat the customer's remembered choice when the two disagree: core
   * stamps every switch with an epoch and the last one to START wins, so
   * running after core's restore has finished is what turns "the host named a
   * session" into the instruction that actually holds.
   */
  async function openNamedSession(sessionId: string): Promise<void> {
    await whenHistorySettles();
    if (destroyed) return;
    await store.client.switchSession(sessionId);
  }

  function retry(message: ChatMessage): void {
    store.client
      .retryMessage(message.id)
      .then((outcome) => {
        if (outcome.status === 'retried') return;
        handleRetryRefusal(message, outcome.reason);
      })
      // `.catch`, not `void`: `retryMessage` resolves rather than throws for
      // the ordinary refusal, but a storage failure underneath it still
      // rejects, and an unhandled rejection here surfaces on the HOST's
      // window.
      .catch(report);
  }

  /**
   * What to show when core declines to replay an id.
   *
   * Rare by construction — message-list.ts gates the button's visibility on
   * `delivery.retryable`, which is core's own answer to "is this worth
   * offering" — but not impossible: the customer may have switched sessions
   * since the failure, and core refuses that case because `message.send`
   * carries no `sessionId` on the wire, so replaying the id now would
   * misattribute it to whichever session is current.
   *
   * Branched on `outcome.reason`, the discriminant, never on any message
   * text. The two reasons want opposite treatment and collapsing them would
   * get one of them wrong:
   *
   *   - `not-retryable` — this id will never reach the server. The customer's
   *     words are otherwise stranded in a dead bubble, so they are handed
   *     back to the composer where one keystroke sends them as a fresh
   *     message. Only into an EMPTY composer: silently overwriting something
   *     half-typed would lose more than it recovers.
   *   - `not-found` — nothing eligible under this id: already retried, already
   *     succeeded, or never failed. Offering the text back here would invite a
   *     genuine duplicate of a message that may well have landed, which is the
   *     exact failure this whole change removes. Report it and leave the UI
   *     alone; the re-render below already shows core's real state.
   */
  function handleRetryRefusal(message: ChatMessage, reason: 'not-found' | 'not-retryable'): void {
    report(new Error(`chat widget could not retry message ${message.id}: ${reason}`));

    // Re-read core rather than trust the affordance that was just pressed: a
    // refusal means the button's state and core's disagreed.
    messageList.render(store.getState(), localParticipantId);

    if (reason !== 'not-retryable') return;
    if (composer.input.value !== '') return;
    composer.input.value = message.content;
    composer.input.focus({ preventScroll: true });
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

  /**
   * Writes one {@link resolveConnectionStatus} answer out to all three
   * surfaces it governs.
   *
   * One writer, so the status line, the Reconnect control and the composer's
   * prompt cannot describe three different connections — the failure mode the
   * old code had, where the status said "Connecting…" indefinitely while the
   * button and the composer said nothing at all.
   */
  function syncConnection(): void {
    const status = resolveConnectionStatus(store.getState().connectionState, online, failedAttempts);

    statusText.textContent = status.label;
    statusDot.style.color = status.color;

    reconnectButton.hidden = status.control === 'hidden';
    // `inert` and "a manual attempt is already running" are different reasons
    // for the same disabled state, and both must win over `ready`.
    reconnectButton.disabled = status.control === 'inert' || reconnecting;
    reconnectButton.textContent = reconnecting ? 'Reconnecting…' : 'Reconnect';

    // The composer stays ENABLED throughout — core queues sends durably (§9.6)
    // and a customer in a lift must still be able to type their question. What
    // changes is only the promise made about what happens to it.
    composer.input.placeholder = status.queueing ? QUEUEING_PLACEHOLDER : composerPlaceholder;

    syncComposer();
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
    syncConnection();
    store.client
      .connect()
      .catch(report)
      .finally(() => {
        reconnecting = false;
        syncConnection();
      });
  }

  /**
   * Should the "Talk to a human" control be on screen, and what should it say?
   *
   * Visible only while the BOT holds the conversation and it is still live:
   *
   *   - `mode: 'HUMAN'` already means the hand-off happened. Whether an agent
   *     has picked it up yet (`WAITING_FOR_AGENT`) or is already replying
   *     (`ASSIGNED`), asking again escalates nothing — the server would answer
   *     the same session snapshot back.
   *   - `CLOSED`/`RESOLVED` is not a conversation to escalate; the way out of
   *     one of those is "Start a new conversation", which the log already
   *     offers.
   *   - No session at all (pre-connect, or mid `startNewSession`) has nothing
   *     to escalate.
   *
   * Driven off `mode`/`status` rather than `handledBy` on purpose:
   * `handledBy` is presentation-only and documented as able to lag `status`
   * on a reactivated session (core's `isHandledByCurrent`), so gating a real
   * ACTION on it would show this button to someone already talking to a
   * person.
   */
  function syncHandoff(state: ChatState): void {
    const session = state.session;
    const live =
      session !== null &&
      session.mode === 'BOT' &&
      session.status !== 'CLOSED' &&
      session.status !== 'RESOLVED';

    handoffButton.hidden = !live;
    if (!live) {
      // Reset, so a session that comes back round does not inherit the busy
      // label from the last time it was escalated.
      requestingAgent = false;
      handoffButton.disabled = false;
      handoffButton.textContent = 'Talk to a human';
    }
  }

  /**
   * Ask for a human.
   *
   * `requestAgent` is fire-and-forget on the wire (core writes the frame and
   * returns), so there is no promise to await and no ack to hang the UI on.
   * What settles this is the server's own `session.updated` — the session
   * flips to `HUMAN`, and {@link syncHandoff} hides the button in response.
   * Until then it stays disabled with a "Connecting you…" label, because a
   * control that looks pressable after a press invites a second escalation of
   * a session that is already queued.
   *
   * The throw path is real: core rejects a send with no session or no open
   * socket. Reported, and the button re-armed — leaving it disabled would
   * strand the customer with a dead control and no way to try again.
   */
  function requestHumanAgent(): void {
    if (requestingAgent) return;
    requestingAgent = true;
    handoffButton.disabled = true;
    handoffButton.textContent = 'Connecting you to an agent…';

    try {
      store.client.requestAgent();
    } catch (error) {
      report(error);
      requestingAgent = false;
      handoffButton.disabled = false;
      handoffButton.textContent = 'Talk to a human';
    }
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
    setStartingNewConversation(true);

    // `startNewSession`, never `switchSession`: a switch joins a session that
    // already exists and deliberately mints nothing, so using it here would
    // drop the customer into whichever conversation the server picked rather
    // than the fresh one they asked for.
    store.client
      .startNewSession()
      .then(() => {
        // Only on success. A rejected `startNewSession` leaves the old session
        // abandoned but no new one in place, and dropping the customer onto an
        // empty transcript there would hide the fact that nothing happened.
        showConversation();
        if (open) composer.input.focus({ preventScroll: true });
      })
      .catch(report)
      .finally(() => {
        startingNewConversation = false;
        setStartingNewConversation(false);
      });
  }

  /**
   * One busy flag, three surfaces.
   *
   * All three offer the same "start a new conversation" action, so all three
   * have to go busy together — a customer who pressed the button on the
   * pre-chat screen must not find a live one waiting in the switcher, which is
   * how a socket round trip's worth of impatience becomes two sessions.
   */
  function setStartingNewConversation(busy: boolean): void {
    messageList.setStartingNewConversation(busy);
    preChat.setStartingNew(busy);
    switcher.setStartingNew(busy);
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

    // Focus what is actually on screen. `preventScroll` stops the host page
    // from jumping to the widget's position — on a fixed-position element that
    // scroll is always wrong.
    if (preChatOpen) preChat.focus();
    else composer.input.focus({ preventScroll: true });

    // Asked here rather than at mount: a widget nobody opens should cost the
    // host page nothing beyond the socket it already opens. Fires once — see
    // `requestSessions`.
    requestSessions();

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

    // A popover left open over a closed panel re-appears on the next open,
    // over whatever the customer came back for.
    switcher.close();

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
  // Nothing here seeds history, and neither does any subscription above. Core
  // does it, on every `connected`, guarded by `pagination.initialLoaded` — so
  // it fetches page one exactly once per session and never re-requests it
  // under a customer who has scrolled back. The once-ever latch this file used
  // to keep could do neither: it could not re-arm when the customer switched
  // conversations, which is why picking a past session left the previous
  // session's transcript on screen.
  const connecting = store.client.connect();

  const namedSession = config.sessionId;
  if (namedSession === undefined) {
    connecting.catch(report);
  } else {
    // AFTER the socket is up, and through `switchSession` rather than
    // `joinSession`. Both halves of the old call were wrong. `joinSession`
    // writes a raw `session.join` frame, and `WebSocketTransport.send` DROPS a
    // frame written while the socket is closed — which, fired synchronously
    // beside `connect()`, it always was — so a host that named a session had
    // its instruction silently discarded on every page load. And even landed,
    // `joinSession` changes no client state: it neither clears the transcript
    // that is on screen nor fetches the named session's history.
    connecting.then(() => openNamedSession(namedSession)).catch(report);
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
      window.removeEventListener('offline', onOffline);
      trap?.release();
      restoreFocus?.();
      // Before `store.destroy()`: these settle by unsubscribing from the
      // store, and `select`'s unsubscribe on an already-destroyed store is a
      // no-op rather than an error, but draining first keeps the ordering
      // obvious. A copy, because `finish` deletes from the set it walks.
      for (const cancel of [...pendingHistorySettles]) cancel();
      for (const unsubscribe of unsubscribers) unsubscribe();
      composer.destroy();
      // The switcher owns a document-level `pointerdown` listener for its
      // outside-click close, which outlives the shadow root unless released.
      switcher.destroy();
      preChat.destroy();
      // `disconnect: true` — this store built the client it wraps, so nothing
      // else on the page is using that socket.
      store.destroy({ disconnect: true });
      root.destroy();
    },
  };
}
