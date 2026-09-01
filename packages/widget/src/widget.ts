// The widget itself: launcher, panel, and the wiring between core's state and
// the DOM.
//
// Reads state through `@dhaam-ccrm/js`'s `select`, never through a raw
// `client.subscribe`. Core notifies on EVERY state change — a keystroke of a
// typing indicator, a presence heartbeat, a watermark advancing — and a single
// subscription that re-rendered everything would rebuild the message list on
// each one. Each `select` below re-runs only when its own slice changes, which
// is the entire reason that package was built as this one's substrate.

import {
  MemoryStorageAdapter,
  createBrowserStorageAdapter,
  isParkedCloseReason,
} from '@dhaam-ccrm/core';
import type { CloseReason } from '@dhaam-ccrm/core';
import { ChatClientConfigError } from '@dhaam-ccrm/js';
import type { ChatStore } from '@dhaam-ccrm/js';
import type { ChatMessage, ChatSessionSummary, ChatState, ConnectionState } from '@dhaam-ccrm/js';

import {
  countQueuedSends,
  createNetworkStatus,
  createReconnectPump,
  isNavigatorOnline,
  OUTAGE_ATTEMPT_THRESHOLD,
  resolveOfflineBanner,
} from '@dhaam-ccrm/browser';

import { createWidgetStore } from './client.js';
import { resolveConfig } from './config.js';
import type {
  AvatarMode,
  HeaderAppearance,
  LauncherIcon,
  LauncherStyle,
  ResolvedConfig,
  ThreadAppearance,
  WidgetConfig,
  WidgetDesign,
} from './config.js';
import { asksForAHuman } from './handoff-keywords.js';
import { createChime } from './ui/chime.js';
import { createConsentGate } from './ui/consent.js';
import { createHeaderMenu } from './ui/header-menu.js';
import { createUnavailable } from './ui/unavailable.js';
import { createReportIssueForm } from './ui/report-issue.js';
import type { IssueReport } from './ui/report-issue.js';
import { createComposer } from './ui/composer.js';
import {
  ICONS,
  LAUNCHER_ICONS,
  SOLID_LAUNCHER_ICONS,
  el,
  icon,
  safeImageUrl,
  safeLinkUrl,
  solidIcon,
} from './ui/dom.js';
import { captureFocus, trapFocus } from './ui/focus.js';
import type { FocusTrap } from './ui/focus.js';
import { createHeroHeader, heroContentFrom } from './ui/hero-header.js';
import { createHomeScreen, homeQuestionsSlot } from './ui/home-screen.js';
import { createIdentityHeader } from './ui/identity-header.js';
import { createMessageList } from './ui/message-list.js';
import { createMessagesScreen } from './ui/messages-screen.js';
import { createNav } from './ui/nav.js';
import type { NavTab } from './ui/nav.js';
import { createNewConversationScreen } from './ui/new-conversation.js';
import type { NewConversationInput } from './ui/new-conversation.js';
import { resolvePresentation } from './ui/presentation.js';
import type { ResolvedPresentation } from './ui/presentation.js';
import { samplePlatformColor } from './ui/platform-color.js';
import { createWidgetRoot } from './ui/root.js';
import { createScreens } from './ui/screens.js';
import type { ScreenName } from './ui/screens.js';
import {
  STYLES,
  cssColor,
  cssPx,
  fontStackFor,
  headerBaseColor,
  headerForeground,
  headerLayers,
  launcherShadowCss,
  readableOn,
  themeCss,
  threadTokens,
} from './ui/styles.js';
import { createCsatSurvey } from './ui/csat.js';
import { createOfflineBanner } from './ui/offline-banner.js';
import { createOfflineForm } from './ui/offline-form.js';
import { createPreChatForm } from './ui/pre-chat-form.js';
import { createCommonQuestions } from './ui/common-questions.js';
import {
  DEFAULT_REMOTE_CONFIG,
  fetchRemoteConfig,
  shouldCollectOffline,
  shouldMount,
} from './remote-config.js';
import type { AutoOpen, RemoteConfig } from './remote-config.js';

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

// `OUTAGE_ATTEMPT_THRESHOLD` — "how many consecutive failures before this stops
// being a blip" — used to be declared here. It now comes from
// @dhaam-ccrm/browser, alongside `resolveOfflineBanner`, which is the OTHER
// surface that has to answer the same question. Two copies of that number
// would put the status line and the banner on different sides of the same
// failure, and the reason for the value is unchanged: one failure is the
// commonest event the transport has (a wifi handover, a proxy recycling a
// socket) and core is usually back inside a second.

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

/**
 * The launcher's glyph, from whichever of the three sources is selected.
 *
 * Lives here rather than in `ui/dom.ts` so that module keeps its one-way
 * imports: it is the primitive layer and knows nothing about `WidgetConfig`,
 * while this file already holds both.
 *
 * Every branch falls back to the built-in chat bubble rather than to nothing.
 * An emoji field a merchant blanked, an image URL the allowlist refused, a
 * library id from a console newer than this bundle — all of them are cases
 * where a launcher with no glyph at all is strictly worse than the default
 * one, because a blank circle reads as a broken widget rather than as a
 * customised one.
 */
/**
 * Heroicons' `chevron-left` outline, lifted verbatim from the installed
 * package — `node_modules/@heroicons/react/24/outline/ChevronLeftIcon.js` in
 * `chatsupport_react` — the same sourcing `ui/composer.ts`'s link icon and
 * `ui/dom.ts`'s `LAUNCHER_ICONS` document for themselves.
 */
const BACK_ICON = ['M15.75 19.5 8.25 12l7.5-7.5'];

function buildLauncherIcon(spec: LauncherIcon): Node {
  if (spec.source === 'emoji' && spec.emoji.trim() !== '') {
    // `text`, so it goes through `textContent` — a merchant's "emoji" field is
    // free text and this is a shadow root on someone else's checkout page.
    return el('span', { attrs: { class: 'dh-launcher-emoji', 'aria-hidden': 'true' }, text: spec.emoji });
  }

  if (spec.source === 'image') {
    const src = safeImageUrl(spec.imageUrl);
    // `alt=""`, not the label: the launcher already carries an accessible name
    // (see `launcherName`), and naming the image too would make a screen
    // reader announce the button twice — the same rule `icon()` follows.
    if (src !== null) return el('img', { attrs: { class: 'dh-launcher-image', src, alt: '' } });
  }

  // `solidIcon` for the console's own glyphs, which are Heroicons SOLID
  // shapes — stroking a filled path produces a blot. The built-in `chat`
  // fallback is this package's own outline, so it keeps the outline renderer.
  const library = LAUNCHER_ICONS[spec.library];
  if (library !== undefined && SOLID_LAUNCHER_ICONS.has(spec.library)) {
    return solidIcon(library, 24);
  }
  return icon(library ?? ICONS.chat, 24);
}

/**
 * The classic header's avatar, or `null` when there is nothing to draw.
 *
 * `null` rather than an empty circle is the whole contract: this widget has
 * never drawn an avatar, so a merchant who has set neither initials nor a logo
 * must get the header they already have rather than a grey disc where their
 * brand is supposed to be.
 *
 * `aria-hidden` throughout — the title beside it already names who the
 * customer is talking to, and a screen reader announcing "D" before it would
 * be reading out a decoration.
 */
function buildHeaderAvatar(mode: AvatarMode, initials: string, logoUrl: string): HTMLElement | null {
  if (mode === 'logo') {
    const src = safeImageUrl(logoUrl);
    return src === null
      ? null
      : el('img', { attrs: { class: 'dh-avatar dh-avatar-image', src, alt: '', 'aria-hidden': 'true' } });
  }

  // Two characters, because that is what fits: the console lets a merchant
  // type a whole word into a field rendered as a 32px disc, and three letters
  // overflow it. Sliced rather than refused — a merchant who typed their full
  // name meant the first letters of it.
  const letters = initials.trim().slice(0, 2);
  return letters === ''
    ? null
    : el('span', { attrs: { class: 'dh-avatar', 'aria-hidden': 'true' }, text: letters });
}

/** Which of the three data-collecting surfaces is standing in for the chat. */
type SurfaceKind = 'preChat' | 'offline' | 'csat' | 'report' | 'composingNew';

/** The shape all three surfaces share, so one slot can hold any of them. */
interface ProductSurface {
  readonly node: HTMLElement;
  focus?(): void;
  destroy(): void;
}

export function createWidget(rawConfig: WidgetConfig): ChatWidget {
  const config = resolveConfig(rawConfig);
  const { store, rest } = createWidgetStore(config);
  const localParticipantId = config.identity.userId;

  const root = createWidgetRoot(`${STYLES}\n${themeCss(config)}`);
  const { host, shadow } = root;
  host.setAttribute('data-side', config.side);
  // Stamped for every value including `auto`, which the CSS treats as "no
  // opinion" (see ui/styles.ts). Always writing it — rather than removing the
  // attribute for `auto` — keeps this a plain assignment with no branch, and
  // leaves the resolved scheme readable on the element for anyone debugging a
  // merchant's page.
  host.setAttribute('data-theme', config.theme);
  host.setAttribute('data-position', config.position);
  host.setAttribute('data-launcher', config.launcher);
  host.setAttribute('data-design', config.design);

  let presentation: ResolvedPresentation = 'bubble';
  /**
   * The launcher's current shape.
   *
   * Mirrored in a local rather than read back off the host attribute because
   * {@link syncLauncher} needs it on every unread change, and because published
   * config can replace it after mount — so `config.launcher` is only ever the
   * BOOT value, not the current one.
   */
  let launcherStyle: LauncherStyle = config.launcher;
  /** Mirrored for the same reason as {@link launcherStyle}: a publish can replace it. */
  let design: WidgetDesign = config.design;
  /**
   * The merchant's own line under the title, or `''` for none.
   *
   * Mirrored for the same reason as {@link design}, and read by
   * {@link syncConnection} rather than written into the DOM once: the slot it
   * occupies belongs to the connection status, which repaints on every
   * transport change, so a value written here directly would be overwritten
   * by the next reconnect.
   */
  let subtitle = config.subtitle;
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
  /**
   * An agent opened a conversation while the panel was shut, and the customer
   * has not looked at it yet.
   *
   * A widget-local flag rather than anything in `ChatState`, because it
   * describes this UI's own "you have not seen this yet", not a fact about the
   * session — a second widget on another tab has its own answer. Cleared by
   * `openPanel`, which is the customer seeing it.
   */
  let agentInitiated = false;
  /** One escalation in flight at a time — see {@link requestHumanAgent}. */
  let requestingAgent = false;
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
  let online = isNavigatorOnline();

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
  /**
   * The screen a fresh panel opens on, and the one `close()` resets back to.
   *
   * `'home'` for almost everyone — see the routing rule "launcher opens ->
   * Home". The one exception is a host that passed `sessionId`: it has
   * already named the conversation it wants on screen, and landing on a
   * chooser-like Home instead would override an explicit instruction. This
   * is screen flow, not guest detection — the one guest-facing gate is
   * `sessions.length > 0` inside `ui/messages-screen.ts`'s and
   * `ui/home-screen.ts`'s own empty states, and there is no second one
   * anywhere in this package.
   */
  const initialScreenName: ScreenName = config.sessionId === undefined ? 'home' : 'conversation';

  const report = (error: unknown): void => config.onError(error);

  // ── published config ──────────────────────────────────────────────────
  //
  // Fetched, never awaited. `mount()` is synchronous and stays that way: a
  // widget that waited for a network round trip before painting would be a
  // blank launcher on every cold load, and — because `WIDGET_ALLOWED_ORIGINS`
  // is fleet-wide rather than per-tenant — a PERMANENTLY blank one on any
  // storefront whose origin nobody remembered to add. So the widget renders
  // the host's own config immediately and upgrades in place if the fetch
  // lands.
  //
  // Everything below reads `remote` through this holder rather than
  // capturing it, because it is replaced once, asynchronously, after mount.
  let remote: RemoteConfig = DEFAULT_REMOTE_CONFIG;

  /**
   * The last unread count seen, so the chime fires on a RISE and nothing else.
   * Seeded from the store rather than from 0 — see the selector that reads it.
   */
  /** One close in flight at a time — the round trip is long enough to double-tap. */
  let endingConversation = false;
  let lastUnread = store.getState().unreadCount;
  const chime = createChime(config.onError);

  /**
   * This VISITOR's own preference about noise, remembered per browser.
   *
   * Not a merchant setting and not synced anywhere: `behaviour.sound` is the
   * merchant deciding whether a chime exists at all, and this is the person
   * in front of the screen deciding they have heard enough of it. Both have to
   * agree before anything plays — see the unread selector.
   *
   * Keyed per publishable key like the consent record, so two tenants on one
   * browser cannot mute each other. A read that fails is "not muted", which is
   * the same as a first visit.
   */
  const MUTE_KEY = `chatsdk:${config.auth.publishableKey}:muted`;
  let muted = false;
  try {
    muted = globalThis.localStorage?.getItem(MUTE_KEY) === 'true';
  } catch {
    // Site data blocked. The visitor is simply not muted, and can mute again.
  }

  const unavailable = createUnavailable({
    // The SAME path the Reconnect control uses. A second retry route would be
    // a second set of rules about when retrying is even allowed, and core
    // already parks deliberately in states where it must not be forced.
    onRetry: () => reconnect('manual'),
  });

  const headerMenu = createHeaderMenu({
    onStartNew: () => openNewConversationFlow(),
    onEndConversation: () => endConversation(),
    onReportIssue: () => openReportIssue(),
    onMuteChange: (next) => {
      muted = next;
      try {
        globalThis.localStorage?.setItem(MUTE_KEY, String(next));
      } catch {
        // Refused storage is not worth failing a mute over: it holds for this
        // page either way, and is simply forgotten on the next load.
      }
    },
  });

  /**
   * Releases whatever `behaviour.autoOpen` armed — a timer, a pointer
   * listener, or nothing. Replaced wholesale each time config lands, and run
   * on `destroy`.
   *
   * A no-op by default rather than `null`, so neither caller has to branch.
   */
  let releaseAutoOpen: () => void = () => undefined;

  /**
   * Arms the merchant's chosen self-opening behaviour.
   *
   * ── Why this fires at most once, and never after the visitor has acted ───
   *
   * Both triggers are one-shot. A panel that reopens itself after somebody
   * closed it is not a greeting, it is an argument — and the customer closing
   * it is the clearest possible statement that they did not want it. So the
   * arming is released the first time it fires AND the first time the panel is
   * opened by any other route, including by hand.
   */
  function armAutoOpen(mode: AutoOpen, delaySec: number): void {
    releaseAutoOpen();
    releaseAutoOpen = () => undefined;
    if (mode === 'never' || open) return;

    // Fires only while the panel is still shut and the widget is still alive.
    // Both are checked at FIRING time rather than at arming time: seconds pass
    // in between, and the visitor may have opened it themselves meanwhile.
    const fire = (): void => {
      releaseAutoOpen();
      releaseAutoOpen = () => undefined;
      if (!destroyed && !open) openPanel();
    };

    if (mode === 'delay') {
      const timer = setTimeout(fire, delaySec * 1000);
      releaseAutoOpen = () => clearTimeout(timer);
      return;
    }

    // 'exit-intent' — the pointer heading for the browser chrome.
    //
    // Bound to `document`, and gated on a mouse: `mouseout` toward the top of
    // the viewport is the conventional signal, and it is meaningless on a
    // touch device, where the pointer never leaves because there is no
    // pointer. Rather than approximate it with something a merchant did not
    // choose (a scroll depth, a back gesture), a touch visitor simply gets
    // nothing — the same answer `'never'` gives.
    const onMouseOut = (event: MouseEvent): void => {
      // `relatedTarget === null` means the pointer left the document itself
      // rather than moving between two elements inside it.
      if (event.relatedTarget !== null || event.clientY > 0) return;
      fire();
    };
    document.addEventListener('mouseout', onMouseOut);
    releaseAutoOpen = () => document.removeEventListener('mouseout', onMouseOut);
  }
  const remoteConfigAbort = new AbortController();

  /** Applies the parts of published config that are safe to change in place. */
  const applyRemoteConfig = (next: RemoteConfig): void => {
    remote = next;

    // An attribute and a CSS rule rather than a flag threaded into
    // `message-list.ts`: that component owns WHEN the indicator shows (the
    // `typing.isTyping` state), and this setting is about whether it exists at
    // all — two different questions, and giving the component both would make
    // every one of its tests construct a config it does not otherwise need.
    // `display: none` also takes it out of the accessibility tree, so the
    // screen-reader label goes with it, which is what "turned off" has to mean.
    host.setAttribute('data-typing', next.typingIndicator ? 'on' : 'off');

    // Armed only now, never at mount: `autoOpen` is a merchant's setting and
    // arrives with the config, so arming before it lands could only ever use
    // the built-in default — and the built-in default is 'never'.
    //
    // `openOnLoad` is the host's own switch and is deliberately NOT consulted
    // here: a host that asked for an open panel has already got one, and a
    // console setting cannot un-ask for it.
    armAutoOpen(next.autoOpen, next.autoOpenDelaySec);
    armGreeting(next.greeting ?? '', next.greetingDelaySec);
    consent.update(next.consentRequired, next.consentText ?? '');
    messageList.setTranscriptEmail(next.transcriptEmail);
    reportButton.hidden = !next.reportIssue;
    syncHeaderMenu();
    // The gate may have just opened or closed under the composer.
    syncComposer();

    // Accent goes on the host's inline style rather than by rewriting the
    // `<style>` element: an inline custom property outranks the `:host` rule
    // themeCss wrote, so this upgrades the theme without reparsing a sheet or
    // racing anything already using the old value.
    //
    // Guarded on the host having said nothing, which is the precedence rule
    // from remote-config.ts applied to a value that already went through
    // `resolveConfig`'s defaults — by this point `config.accent` is populated
    // either way, so `rawConfig` is the only place the distinction survives.
    if (rawConfig.accent === undefined && next.accent !== undefined) {
      host.style.setProperty('--dh-accent', cssColor(next.accent));
    }

    // The accent as it stands AFTER that, because the header's own foreground
    // is computed from it — a published accent that changed the brand colour
    // has to be able to flip the header's text from white to near-black with
    // it, or a merchant switching to a pastel gets an unreadable header.
    const accent =
      rawConfig.accent === undefined && next.accent !== undefined ? next.accent : config.accent;

    if (rawConfig.title === undefined && next.title !== undefined) {
      identityHeader.setFallbackTitle(next.title);
    }
    if (rawConfig.launcher === undefined && next.launcher !== undefined) {
      launcherStyle = next.launcher;
      host.setAttribute('data-launcher', next.launcher);
    }
    if (rawConfig.launcherLabel === undefined) {
      // The launcher's label falls back to the TITLE (see config.ts), so a
      // publish that renames the widget renames the tab with it — but only
      // when the host has not named the title itself, or a console save would
      // reach a string the host explicitly set through the back door.
      const label =
        next.launcherLabel ?? (rawConfig.title === undefined ? next.title : undefined);
      if (label !== undefined) launcherLabel.textContent = label;
    }
    // Both of the above change what the launcher SHOWS, and its accessible
    // name has to quote that — see syncLauncher's WCAG 2.5.3 note.
    syncLauncher(store.getState());

    // Rebuilt rather than patched, for the same reason `applyRemoteConfig`
    // rebuilds the chip row: three unrelated element shapes (svg / span /
    // img) share this slot, so "patch the one that is there" would be three
    // branches of DOM surgery to save one `replaceChildren` on a config
    // change that happens at most once per publish.
    if (rawConfig.launcherIcon === undefined && Object.keys(next.launcherIcon).length > 0) {
      launcherGlyph.replaceChildren(
        buildLauncherIcon({ ...config.launcherIcon, ...next.launcherIcon }),
      );
    }
    if (rawConfig.launcherShadow === undefined && Object.keys(next.launcherShadow).length > 0) {
      const shadow = { ...config.launcherShadow, ...next.launcherShadow };
      host.style.setProperty('--dh-launcher-shadow', launcherShadowCss(shadow, 'resting'));
      host.style.setProperty('--dh-launcher-shadow-lift', launcherShadowCss(shadow, 'lifted'));
    }

    if (rawConfig.design === undefined && next.design !== undefined) {
      design = next.design;
      host.setAttribute('data-design', next.design);
    }
    // Unconditional, unlike the fields above: even a publish that says nothing
    // about the header can still have moved the ACCENT the header is painted
    // from, and the foreground has to be recomputed against it either way.
    applyHeaderAppearance(
      rawConfig.header === undefined ? { ...config.header, ...next.header } : config.header,
      accent,
      rawConfig.logoUrl === undefined ? (next.logoUrl ?? config.logoUrl) : config.logoUrl,
    );
    if (rawConfig.thread === undefined && Object.keys(next.thread).length > 0) {
      applyThreadAppearance({ ...config.thread, ...next.thread });
    }
    if (rawConfig.subtitle === undefined && next.subtitle !== undefined) {
      subtitle = next.subtitle;
      // Repainted through the connection sync rather than written straight to
      // the node: that function owns this slot and would overwrite anything
      // put there behind its back on the very next transport event.
      syncConnection();
    }
    // Unconditional for the same reason `applyHeaderAppearance` is: the avatar
    // reads `logoUrl`, which a publish can move without saying anything about
    // `avatarMode` — and it reads `design`, which the branch above may just
    // have changed out from under it.
    applyHeaderAvatar(
      rawConfig.avatarMode === undefined ? (next.avatarMode ?? config.avatarMode) : config.avatarMode,
      rawConfig.avatarInitials === undefined
        ? (next.avatarInitials ?? config.avatarInitials)
        : config.avatarInitials,
      rawConfig.logoUrl === undefined ? (next.logoUrl ?? config.logoUrl) : config.logoUrl,
    );
    applyBranding(
      rawConfig.showBranding === undefined
        ? (next.showBranding ?? config.showBranding)
        : config.showBranding,
      rawConfig.brandingText === undefined
        ? (next.brandingText ?? config.brandingText)
        : config.brandingText,
      rawConfig.brandingUrl === undefined
        ? (next.brandingUrl ?? config.brandingUrl)
        : config.brandingUrl,
    );
    // An attribute rather than a custom property, because the scheme selects a
    // whole palette rather than setting one value — the same `[data-*]`
    // attribute-selector mechanism the presentation variants use.
    if (rawConfig.theme === undefined && next.theme !== undefined) {
      host.setAttribute('data-theme', next.theme);
    }
    if (rawConfig.position === undefined && next.position !== undefined) {
      host.setAttribute('data-position', next.position);
    }
    if (rawConfig.offsetX === undefined && next.offsetX !== undefined) {
      host.style.setProperty('--dh-offset-x', cssPx(next.offsetX, config.offsetX));
    }
    if (rawConfig.offsetY === undefined && next.offsetY !== undefined) {
      host.style.setProperty('--dh-offset-y', cssPx(next.offsetY, config.offsetY));
    }
    if (rawConfig.cornerRadius === undefined && next.cornerRadius !== undefined) {
      host.style.setProperty('--dh-radius', cssPx(next.cornerRadius, config.cornerRadius));
    }
    // Only when the host left `font` alone as well: `font: 'inherit'` is a
    // statement about the HOST's typography, and a merchant's face published
    // later must not quietly cancel it. Same precedence rule, one level up.
    if (
      rawConfig.fontFamily === undefined &&
      config.font !== 'inherit' &&
      next.fontFamily !== undefined
    ) {
      host.style.setProperty('--dh-font', fontStackFor(next.fontFamily));
    }

    // Rebuilt whole, not patched: the chip list is short, changes at most
    // once per publish, and a chip mid-tap should not be re-keyed under the
    // customer's finger — the same "rebuild wholesale" choice `openSurface`
    // makes for `surfaceHost`, for the same reason.
    commonQuestionsHost.replaceChildren(
      createCommonQuestions(next.commonQuestions, {
        onSelect: (question) => {
          void store.client.sendMessage(question.prompt).catch(report);
        },
      }).node,
    );
    syncScreens();
    // A publish can move the subtitle Home's CTA card quotes, or (once
    // `pastSessions` has already landed) nothing about the recent row at
    // all — cheap and idempotent either way, so it is simplest to always
    // re-run rather than track which specific fields changed.
    syncSessionSurfaces();

    // Config is what decides whether a pre-chat gate or an out-of-hours form
    // exists at all, so it is also what first puts one on screen.
    syncProductSurfaces();

    // `enabled: false` and out-of-hours HIDE_WIDGET both mean "no launcher on
    // this page". Handled by hiding rather than by tearing the widget down:
    // the host still holds a `ChatWidget` handle and calling `open()` on a
    // destroyed one should not be the price of a merchant toggling a switch.
    launcher.hidden = !shouldMount(next);
  };

  /**
   * Paints the hero header from a resolved appearance and accent.
   *
   * Inline custom properties, for the same reason the accent uses them: they
   * outrank the `:host` rule `themeCss` wrote, so a publish landing after
   * mount repaints without reparsing a stylesheet.
   *
   * Nothing here checks `design`. The tokens are written either way and the
   * `classic` header simply never reads them (see ui/styles.ts) — which keeps
   * the "is the header painted at all" decision in exactly one place instead
   * of two that could disagree.
   */
  function applyHeaderAppearance(header: HeaderAppearance, accent: string, logoUrl: string): void {
    host.style.setProperty('--dh-header-bg', headerBaseColor(header));
    host.style.setProperty('--dh-header-fg', headerForeground(header, accent));
    host.style.setProperty('--dh-header-layers', headerLayers(header));
    heroHeader.render(heroContentFrom(header, logoUrl));

    // `platform` only means anything when no explicit colour was set —
    // "borrow the site's colour" and "use this hex" are not both answerable.
    if (header.colorSource === 'platform' && header.backgroundColor.trim() === '') {
      borrowPlatformColor();
    }
  }

  /**
   * The classic header's avatar. Rebuilt rather than patched — see
   * {@link buildHeaderAvatar} for why the slot holds three shapes.
   *
   * The hero design is skipped outright rather than hidden in CSS: its own
   * face row already answers "who am I talking to", and building an element
   * only to have a stylesheet refuse to show it is a node that exists to be
   * invisible.
   */
  function applyHeaderAvatar(mode: AvatarMode, initials: string, logoUrl: string): void {
    const avatar = design === 'hero' ? null : buildHeaderAvatar(mode, initials, logoUrl);
    avatarHost.hidden = avatar === null;
    avatarHost.replaceChildren(...(avatar === null ? [] : [avatar]));
  }

  /**
   * The message this reply is addressed to, or `null`.
   *
   * Held here rather than in the composer because it is the WIDGET that calls
   * `sendMessage`, and the id only ever travels on that call. The composer
   * renders the quote and knows nothing else about it.
   */
  let replyingTo: ChatMessage | null = null;

  function startReply(message: ChatMessage): void {
    replyingTo = message;
    // The excerpt is the message's own text, trimmed to one line's worth. Long
    // enough to identify which message, short enough not to become a second
    // transcript above the composer.
    const text = (message.content ?? '').trim().replace(/\s+/g, ' ');
    composer.setReplyTo(text.length > 90 ? `${text.slice(0, 90)}…` : text);
    composer.input.focus();
  }

  function cancelReply(): void {
    if (replyingTo === null) return;
    replyingTo = null;
    composer.setReplyTo(null);
  }

  /**
   * Puts a message's text on the clipboard.
   *
   * Rejects rather than reporting: the caller is a menu item that announces
   * its own outcome, and `report` would swallow the failure and leave it
   * silently claiming success. `navigator.clipboard` is genuinely absent in
   * some embedded webviews and refused outright in others, so the rejection
   * path is real rather than defensive.
   */
  async function copyMessage(message: ChatMessage): Promise<void> {
    const text = message.content ?? '';
    if (text === '') throw new Error('Nothing to copy');
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      throw new Error('Clipboard unavailable');
    }
    await navigator.clipboard.writeText(text);
  }

  /** The conversation's backdrop, through the same inline-property route. */
  function applyThreadAppearance(thread: ThreadAppearance): void {
    const tokens = threadTokens(thread);
    host.style.setProperty('--dh-thread-bg', tokens.bg);
    host.style.setProperty('--dh-thread-layers', tokens.layers);
    host.style.setProperty('--dh-thread-size', tokens.size);
    host.style.setProperty('--dh-thread-repeat', tokens.repeat);
  }

  /**
   * Repaints the header in the host page's own colour, once the page is
   * finished loading.
   *
   * Deferred to `load` rather than sampled now, and that wait is the whole
   * correctness of it: the host's stylesheets may still be arriving when the
   * widget mounts, so sampling immediately locks in whatever the UNSTYLED
   * document happened to be — usually white, on a site whose brand is not.
   *
   * A `null` sample changes nothing, deliberately. It means the page has no
   * opaque colour to borrow, which is a real answer rather than a failure, and
   * the accent already on the header is the right thing to leave there.
   */
  function borrowPlatformColor(): void {
    const sample = (): void => {
      if (destroyed) return;
      const color = samplePlatformColor();
      if (color === null) return;
      host.style.setProperty('--dh-header-bg', cssColor(color));
      host.style.setProperty('--dh-header-fg', readableOn(color));
    };

    if (typeof document === 'undefined' || document.readyState === 'complete') {
      sample();
      return;
    }
    // `once`, and never removed on teardown: a one-shot listener on `window`
    // is released by the browser after it fires, and the `destroyed` guard
    // above covers the case where teardown wins the race.
    window.addEventListener('load', sample, { once: true });
  }

  void fetchRemoteConfig({
    apiUrl: config.apiUrl,
    publishableKey: config.auth.publishableKey,
    signal: remoteConfigAbort.signal,
  })
    .then((fetched) => {
      if (destroyed) return;
      if (fetched === null) {
        // Visible, not silent. This is the WIDGET_ALLOWED_ORIGINS trap: the
        // browser refuses to say why a cross-origin read failed, so the
        // message names the likeliest cause rather than pretending to know.
        report(
          new Error(
            'widget config could not be read — rendering local defaults. ' +
              'If this page is cross-origin to the chat API, check that its origin is in WIDGET_ALLOWED_ORIGINS.',
          ),
        );
        return;
      }
      applyRemoteConfig(fetched);
    })
    .catch(report);

  // ── launcher ──────────────────────────────────────────────────────────
  const badge = el('span', { attrs: { class: 'dh-badge', hidden: true, 'aria-hidden': 'true' } });
  // `launcherLabel`, not `title` — they default to the same string, so the
  // sidebar tab reads exactly as it always did, but a merchant who wants a
  // short pill and a long header now gets both.
  const launcherLabel = el('span', {
    attrs: { class: 'dh-launcher-label' },
    text: config.launcherLabel,
  });
  /**
   * The slot the glyph lives in, so published config can swap it without
   * rebuilding the button — which would drop the click listener and, if the
   * customer happened to be mid-press, take the control out from under them.
   */
  const launcherGlyph = el('span', {
    attrs: { class: 'dh-launcher-glyph' },
    children: [buildLauncherIcon(config.launcherIcon)],
  });

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
    children: [launcherGlyph, launcherLabel, badge],
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
   * The way to a ticket without a conversation.
   *
   * Hidden until published config turns it on — see `reportIssue` in
   * remote-config.ts. Sits beside "Talk to a human" because the two are the
   * same kind of offer: both are the customer deciding the bot is not the
   * route to their answer.
   */
  const reportButton = el('button', {
    attrs: { class: 'dh-handoff dh-report-open', type: 'button', hidden: true },
    text: 'Report an issue',
    on: { click: () => openReportIssue() },
  });

  /**
   * Slot for the "Common Questions" chip row (`ui/common-questions.ts`).
   *
   * Rebuilt whenever remote config changes (`applyRemoteConfig` below) —
   * `remote.commonQuestions` is not known at mount, only after the config
   * fetch lands. Mounted onto the Home screen (`homeQuestionsSlot`, below)
   * and shown/hidden by {@link syncScreens}, the one place that decides
   * whether tapping a chip still makes sense right now.
   */
  const commonQuestionsHost = el('div', { attrs: { class: 'dh-common-questions-host', hidden: true } });

  /**
   * The hero header's content block — greeting, faces, call to action.
   *
   * Shown only on the Home screen and only under `design: 'hero'` — see
   * {@link syncScreens}. The CTA opens the same new-conversation flow every
   * other "start a conversation" affordance opens (Home's own CTA card,
   * Messages' "New conversation" button); see `ui/hero-header.ts` for the
   * one thing that stays a judgement call once three affordances lead there.
   */
  const heroHeader = createHeroHeader({ onCallToAction: () => openNewConversationFlow() });

  /**
   * The classic header's avatar slot.
   *
   * A wrapper rather than the avatar itself, for the reason the launcher's
   * glyph is one: three element shapes (img / span / nothing at all) share
   * this position, and a publish can swap between them. `replaceChildren` on
   * an empty wrapper is one line where patching in place would be three
   * branches of DOM surgery.
   *
   * Never mounted under the hero design — that layout has its own, richer
   * face row (`header.avatars`, `header.showLogo`), and two avatars in one
   * header is one more than any of them is asking for.
   */
  const avatarHost = el('div', { attrs: { class: 'dh-avatar-host' } });

  /**
   * `behaviour.greeting`, shown while the transcript is still empty.
   *
   * `text` rather than any markup path: this is merchant free text arriving
   * over a public endpoint and landing in a shadow root on someone else's
   * checkout page.
   */
  const greetingBubble = el('p', { attrs: { class: 'dh-greeting', hidden: true } });
  let greetingDue = false;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The consent notice, and the record of whether it has been answered.
   *
   * Its own storage adapter rather than the store's: `createWidgetStore` hands
   * core an adapter and does not expose it, and reaching through the store to
   * borrow one would couple this to core's internals for the sake of avoiding
   * a second `localStorage` handle — which is not a resource worth conserving.
   * Both use the same factory and the same documented `MemoryStorageAdapter`
   * fallback, so a browser with site data blocked behaves consistently: core
   * forgets the session, this forgets the consent, and neither throws.
   */
  const consent = createConsentGate(
    createBrowserStorageAdapter() ?? new MemoryStorageAdapter(),
    config.auth.publishableKey,
    { onAgree: () => syncComposer() },
    report,
  );

  /**
   * The platform credit under the composer.
   *
   * An `<a>` only when the merchant gave a URL that survives
   * {@link safeLinkUrl}; otherwise the same text as a plain span. Hidden
   * entirely by default — see `showBranding` in config.ts for why a widget
   * nobody has configured does not sprout a footer.
   *
   * `rel="noreferrer"` alongside `noopener`: this sits on a merchant's
   * checkout page, and the referrer would leak the URL of whatever page the
   * customer was buying from to whoever the credit points at.
   */
  const brandingLink = el('a', {
    attrs: { class: 'dh-branding-link', target: '_blank', rel: 'noopener noreferrer' },
  });
  const brandingText = el('span', { attrs: { class: 'dh-branding-text' } });
  const branding = el('div', {
    attrs: { class: 'dh-branding', hidden: true },
    children: [brandingText, brandingLink],
  });

  /** Paints the credit, or leaves it hidden. Re-run when a publish lands. */
  function applyBranding(show: boolean, text: string, url: string): void {
    const label = text.trim();
    // A footer switched on with nothing to say is still nothing to say.
    branding.hidden = !show || label === '';
    if (branding.hidden) return;

    const href = safeLinkUrl(url);
    brandingLink.hidden = href === null;
    brandingText.hidden = href !== null;
    if (href === null) {
      brandingText.textContent = label;
      return;
    }
    brandingLink.textContent = label;
    brandingLink.setAttribute('href', href);
  }

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
    onStartNewConversation: () => openNewConversationFlow(),
    onEmailTranscript: () => emailTranscript(),
    // Sent as the customer's own message, exactly as if they had typed it —
    // the bot suggested the words, but the person chose them. Routed through
    // the composer's own send path so a suggestion is subject to every rule a
    // typed message is, the consent gate and handoff keywords included.
    onQuickReply: (text) => void composer.submit(text),
    onCopyMessage: (message) => copyMessage(message),
    onReplyToMessage: (message) => startReply(message),
    onLoadOlder: () => {
      // `.catch`, not `void`: an unhandled rejection here surfaces on the
      // HOST's window and lands in the host's error tracker as a bug in their
      // page. Nothing this widget does may escape into that.
      store.client.loadOlderMessages().catch(report);
    },
  });

  const composer = createComposer({
    onCancelReply: () => cancelReply(),
    onSend: async (text) => {
      // SEND FIRST, then escalate, and only once the send has actually
      // settled. The customer typed a sentence and expects it to arrive;
      // swallowing it because it matched a keyword would lose the question,
      // and an agent picking the conversation up would inherit a handoff with
      // no context for it. A send that REJECTS escalates nothing, for the same
      // reason: there would be nothing in the transcript for them to read.
      //
      // The reply target is read and CLEARED before the await, not after: a
      // send that takes a second must not leave the quote chip on screen
      // looking like it still applies to whatever they type next, and a
      // rejected send must not silently re-address the retry.
      const addressedTo = replyingTo;
      cancelReply();
      await store.client.sendMessage(
        text,
        addressedTo === null ? undefined : { replyToMessageId: addressedTo.id },
      );
      // Only while the BOT is driving. `syncHandoff` already owns that rule
      // for the button, and reusing its condition — rather than re-deriving
      // one here — is what stops a keyword escalating a conversation a human
      // is already handling, which would ask the agent to hand off to
      // themselves.
      if (!handoffButton.hidden && asksForAHuman(text, remote.handoffKeywords)) {
        requestHumanAgent();
      }
    },
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

  /** Slot for whichever product surface is standing in for the conversation. */
  const surfaceHost = el('div', { attrs: { class: 'dh-surface-host', hidden: true } });

  // Declared HERE, beside the node they drive, rather than next to the
  // functions that read them: `showConversation()` runs during mount, well
  // before those functions appear, and consults `activeSurface` — so a
  // declaration further down leaves it in the temporal dead zone and every
  // single mount throws.
  /** The one surface currently standing in for the conversation, if any. */
  let activeSurface: { readonly kind: SurfaceKind; readonly view: ProductSurface } | null = null;
  /** The customer answered or skipped the pre-chat gate, for this widget's lifetime. */
  let preChatAnswered = false;
  /** A rating has been submitted (or the survey dismissed) for the current session. */
  let ratedSessionId: string | null = null;

  /**
   * The screen stack — home / messages / conversation. See `ui/screens.ts`'s
   * own header for the back-history rules; `onChange` is the one place every
   * screen-driven repaint fans out from (`syncScreens`, defined below).
   */
  const screens = createScreens({
    initial: initialScreenName,
    onChange: (name) => {
      syncScreens();
      // Focus follows navigation, same as any single-page app's route
      // change — but only while the panel is actually open and visible;
      // stealing focus into a closed/animating panel would pull it out of
      // whatever the host page was doing. `conversation` manages its own
      // focus at each of its own entry points (`selectSession`,
      // `openSurface`'s `view.focus?.()`) rather than here, because arriving
      // there means either an EXISTING conversation (focus the composer) or
      // a fresh surface (focus its own first field) — two different targets
      // this single callback cannot tell apart.
      if (!open) return;
      if (name === 'messages') messagesScreen.focus();
      else if (name === 'home') panel.focus({ preventScroll: true });
    },
  });

  const nav = createNav((tab: NavTab) => screens.swap(tab));

  const homeScreen = createHomeScreen({
    onStartNew: () => openNewConversationFlow(),
    onOpenConversation: (sessionId) => void selectSession(sessionId),
    onSeeAll: () => screens.swap('messages'),
  });
  // Moved onto Home rather than rebuilt — see home-screen.ts's own header on
  // why this screen arranges the shared component instead of owning a second
  // renderer for it. A one-time move, not a per-render one: `commonQuestions
  // Host`'s OWN visibility (set in `syncScreens`) is still what decides
  // whether anything inside this slot is ever seen, exactly as it did when
  // this node sat directly in the panel.
  homeQuestionsSlot(homeScreen).hidden = false;
  homeQuestionsSlot(homeScreen).appendChild(commonQuestionsHost);

  const messagesScreen = createMessagesScreen({
    onOpenConversation: (sessionId) => void selectSession(sessionId),
    onStartNew: () => openNewConversationFlow(),
  });

  const backButton = el('button', {
    attrs: {
      class: 'dh-icon-button dh-back',
      type: 'button',
      'aria-label': 'Back',
      hidden: true,
    },
    children: [icon(BACK_ICON, 18)],
    on: { click: () => screens.back() },
  });

  /**
   * The composer's ordinary prompt, read from the component rather than
   * restated here. Restating it would put the same sentence in two files, and
   * the copy would drift the first time either one was edited alone.
   */
  const composerPlaceholder = composer.input.placeholder;

  /**
   * The bar that says the network is gone and the messages are safe.
   *
   * Built here, beside the panel it belongs to, rather than with the other
   * screens: it is not a screen. It survives every navigation between Home,
   * Messages and a conversation, because losing your signal is a fact about
   * the whole panel.
   */
  const offlineBanner = createOfflineBanner();

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
      // Focusable ONLY programmatically (never by Tab) — the one thing this
      // enables is `panel.focus()` landing somewhere real when a navigation
      // lands on Home, which has no single "first field" the way Messages
      // (its search box) and a conversation (its composer) each do.
      tabindex: '-1',
    },
    children: [
      el('span', { attrs: { class: 'dh-grip', 'aria-hidden': 'true' } }),
      el('header', {
        attrs: { class: 'dh-header' },
        children: [
          // Shown only once there is somewhere to go back TO — see
          // `screens.ts`'s own back-stack rules and this file's `onChange`
          // above, which is the one place `backButton.hidden` is set.
          backButton,
          avatarHost,
          el('div', { children: [identityHeader.node, status] }),
          el('div', { attrs: { class: 'dh-header-spacer' } }),
          reconnectButton,
          headerMenu.node,
          closeButton,
        ],
      }),
      // Above the hero header and every screen, because it outranks all of
      // them: a customer with no signal needs to know that before they read a
      // greeting. Its own band rather than a line inside the header — see
      // ui/offline-banner.ts for why the status line under the title was not
      // enough on its own.
      offlineBanner.node,
      // Directly under the header row and painted as its continuation, so the
      // two read as one tall header rather than as a banner stacked on a bar.
      // Shown only on Home — see `syncScreens`.
      heroHeader.node,
      // The three screens `ui/screens.ts` knows about. `conversation` has no
      // node of its own here: it is whichever of surfaceHost/messageList.log
      // is showing, exactly the same "stand in for the transcript" mechanism
      // the product surfaces already used before screens existed.
      homeScreen.node,
      messagesScreen.node,
      // A form or survey standing IN PLACE OF the conversation, never on top
      // of it — a chooser and the conversation it chooses between are
      // alternatives, not a stack.
      // Above every other pane, and replacing all of them: when the service
      // cannot be reached there is no conversation, no list and no form worth
      // showing behind it.
      unavailable.node,
      surfaceHost,
      messageList.log,
      // Above the chips and below the transcript: the greeting is the first
      // thing said, and the chips are the answers to it.
      greetingBubble,
      // Sits right where the transcript is still empty — the chips ARE the
      // starting point of a conversation, so they read most naturally right
      // above where the customer is about to type, not competing with the
      // header or buried inside the (empty) log.
      handoffButton,
      reportButton,
      // Directly above the composer it gates, so the notice and the control it
      // disables are read as one thing rather than as an unrelated banner.
      consent.node,
      composer.node,
      // Under the composer, which is where a credit belongs: it is the least
      // important thing in the panel and must never sit between the customer
      // and the conversation.
      branding,
      // The bottom tab bar. Shown on Home/Messages, hidden while a
      // conversation is showing — same bottom-of-panel real estate the
      // composer needs there, and a customer typing does not also need a
      // tab bar competing for the same row. See `syncScreens`.
      nav.node,
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

  // Down HERE, not beside its own definition further up, and for the reason
  // `activeSurface` is declared where it is: this call reaches `heroHeader`,
  // which is built with the panel above, so running it any earlier puts that
  // const in the temporal dead zone and every single mount throws.
  applyHeaderAppearance(config.header, config.accent, config.logoUrl);
  applyHeaderAvatar(config.avatarMode, config.avatarInitials, config.logoUrl);
  applyBranding(config.showBranding, config.brandingText, config.brandingUrl);

  // Every pane needs an initial, correct visibility before anything else can
  // run — `screens.current()` is already `initialScreenName` at this point
  // (set at construction, above), so this is a plain repaint rather than a
  // navigation: `showConversation()` would call `screens.go('conversation')`
  // unconditionally and silently override "launcher opens -> Home" for
  // every visitor, on every mount, before a single click happened.
  syncScreens();

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
  const network = createNetworkStatus();
  const unsubscribeNetwork = network.subscribe((isOnline) => {
    online = isOnline;
    syncConnection();
    // Still called, and still self-gating: `reconnect` returns immediately
    // unless core has PARKED (suspended/closed), which is the one case
    // `reconnectPump` below deliberately will not touch — §8.1 gives those two
    // states exactly one way out and it is an explicit `connect()`.
    if (isOnline) reconnect('auto');
  });

  /**
   * The other half of coming back online, and the one that fixes the reported
   * "it just says Connecting… forever".
   *
   * `reconnect('auto')` above only ever applies where core has stopped. The
   * common case is the opposite: core is still retrying, but its full-jitter
   * backoff (§8.2) has climbed to the 30-second cap while the customer was in
   * a tunnel, so the signal returns and nothing visible happens for another
   * half a minute. The pump collapses that wait — immediately on the network
   * event, and otherwise capping any armed backoff at three seconds.
   *
   * It cannot become a second retry loop competing with core's: it drives
   * `retryNow()`, which acts only while `connectionState === 'reconnecting'`
   * (no socket open, a timer counting down) and is a no-op everywhere else.
   * That is the property the Reconnect button could not have, and the reason
   * that button stays inert while core is working — see
   * {@link WorkingConnectionState}.
   */
  const reconnectPump = createReconnectPump({ target: store.client, network });

  // ── state → DOM ───────────────────────────────────────────────────────
  function syncLauncher(state: ChatState): void {
    const unread = state.unreadCount;
    // Two independent reasons to mark the launcher, and either is enough.
    // `agentInitiated` covers the conversation an agent opened while the panel
    // was shut: `session.updated` is not a message, so `unreadCount` need not
    // have moved at all, and without this the only signal of a waiting
    // conversation would be a launcher that looks exactly like an idle one.
    const showBadge = !open && (unread > 0 || agentInitiated);
    badge.hidden = !showBadge;
    // Deliberately blank for a count of zero rather than the literal "0" —
    // `.dh-badge`'s `min-width` renders an empty badge as a plain dot, which
    // is what "someone is waiting, we cannot say how many messages" looks
    // like. A "0" badge would read as a bug.
    badge.textContent = unread === 0 ? '' : unread > 99 ? '99+' : String(unread);

    // The count goes in the NAME, not only in the badge. A red dot a screen
    // reader never mentions is not an unread indicator. The panel is
    // `aria-hidden` while closed, so its live region cannot speak here — this
    // attribute is the only accessible surface a closed widget has.
    launcher.setAttribute(
      'aria-label',
      showBadge ? `${launcherName()}, ${unreadLabel(unread)}` : launcherName(),
    );
  }

  /**
   * The launcher's name, minus any unread clause.
   *
   * ── WCAG 2.5.3, Label in Name ────────────────────────────────────────────
   *
   * Where the launcher SHOWS words — the `bubble-label` and `tab` shapes, and
   * the sidebar presentation's edge tab — those words have to appear in its
   * accessible name, or voice-control software cannot address the control by
   * what its user can see: "click Chat with us" finds nothing on a button
   * whose name is "Open chat".
   *
   * The name then stops swapping Open/Close, which is the APG disclosure
   * pattern rather than a loss: `aria-expanded` already carries the state, and
   * a name that changes under a voice-control user mid-session is the thing
   * 2.5.3 exists to prevent. The bare `bubble` shape keeps the swap, because
   * it shows no words for the name to have to match.
   */
  function launcherName(): string {
    const showsLabel = launcherStyle !== 'bubble' || presentation === 'sidebar';
    const visible = showsLabel ? (launcherLabel.textContent ?? '') : '';
    if (visible !== '') return visible;
    return open ? 'Close chat' : 'Open chat';
  }

  /** The unread half of the launcher's accessible name. */
  function unreadLabel(unread: number): string {
    if (unread === 0) return 'a new conversation is waiting';
    return `${unread} unread ${unread === 1 ? 'message' : 'messages'}`;
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
      (unread) => {
        // Strictly on the way UP, and never on the `immediate` first call:
        // `unreadCount` also falls (to zero, when the panel opens), and a
        // widget that chimed on a restored session's backlog would greet a
        // returning visitor with a noise about messages they have already
        // read. `lastUnread` starts at whatever the seeded state holds for
        // exactly that reason.
        // BOTH have to agree: the merchant enabled a chime, and this visitor
        // has not silenced it.
        if (remote.sound && !muted && unread > lastUnread) chime();
        lastUnread = unread;
        syncLauncher(store.getState());
      },
      { immediate: true },
    ),
    // The pre-chat gate lifts on the first message, and the rating appears
    // when a session ends — so both of those facts have to re-run the check.
    // Common Questions leaves for the same reason the pre-chat gate does: the
    // first message, whichever surface produced it, means the chips have done
    // their job.
    store.select((state) => state.messages.length, () => {
      syncProductSurfaces();
      syncScreens();
    }),
    store.select(
      (state) => (state.session === null ? null : `${state.session.id}:${state.session.status}`),
      () => syncProductSurfaces(),
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
    // The banner names how many messages are waiting, and that number moves
    // on its own clock: a send made while offline joins the queue without any
    // connection transition, and a flush on reconnect empties it without one
    // either. Selected on the COUNT rather than on `messages`, so the
    // once-per-message churn of a live conversation does not repaint a banner
    // that is not even showing.
    store.select((state) => countQueuedSends(state.messages), () => syncConnection()),
    // The count core's state cannot supply. `#scheduleRetry` emits this once
    // per scheduled retry, immediately after moving to `reconnecting` — so the
    // selector above has already re-rendered with the OLD count by the time
    // this runs, and this second render is what applies the new one.
    store.on('reconnecting', () => {
      failedAttempts += 1;
      syncConnection();
    }),
    // An agent STARTING a conversation with a customer who had none open.
    // Core has already replaced the session and seeded its first page by the
    // time this runs; the only thing left is whether the customer finds out.
    //
    // Opening is opt-in and off by default — see `openOnAgentInitiated`. Left
    // off, the launcher carries it instead: `agentInitiated` makes the badge
    // show even before `unreadCount` moves, because the frame that starts the
    // conversation is not itself a message and the first agent message may
    // arrive on the seeded history page rather than as a `message.new`.
    store.on('conversationStarted', () => {
      if (config.openOnAgentInitiated) {
        openPanel();
        return;
      }
      // Already looking at it — the transcript swap is the notification.
      if (open) return;
      agentInitiated = true;
      syncLauncher(store.getState());
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
      () => {
        syncHandoff(store.getState());
        // The menu's "End conversation" depends on the same session state.
        syncHeaderMenu();
      },
      { immediate: true },
    ),
    store.select(
      (state) => state.pastSessions,
      () => syncSessionSurfaces(),
      { immediate: true },
    ),
    // Keeps `aria-current` on the Messages screen's rows (and Home's
    // "Recent conversation" row) honest after a switch, a `startNewSession`,
    // or a server-side reactivation moved which session is the current one.
    // Renders from `pastSessions`, which this does not read — one input, two
    // triggers.
    store.select(
      (state) => state.session?.id ?? null,
      () => syncSessionSurfaces(),
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
   * stating: `.dh-log`, `.dh-home` and `.dh-messages` all carry an explicit
   * `display` in styles.ts, and a stylesheet `display` beats the UA's
   * `[hidden] { display: none }`. The attribute still does the job that
   * matters most — taking the pane out of the tab order and the accessibility
   * tree — and the inline style is what actually takes it off the screen.
   */
  // ── product surfaces: pre-chat, out-of-hours, CSAT ────────────────────
  //
  // All three stand IN PLACE OF the transcript and composer rather than
  // stacking above them, the same way the session chooser does: a form asking
  // the customer for something and the conversation it gates are alternatives,
  // not a pile. One at a time, in the order below, because they are mutually
  // exclusive states of the same conversation.
  //
  // Built lazily and torn down on every change rather than mounted once and
  // toggled: which fields a pre-chat form renders is a fact about the
  // PUBLISHED CONFIG, which arrives after mount and can be re-fetched, and a
  // long-lived form would keep rendering the field list it happened to be born
  // with.

  function closeSurface(): void {
    if (activeSurface === null) return;
    activeSurface.view.destroy();
    surfaceHost.replaceChildren();
    activeSurface = null;
    // Restores the transcript and composer the surface was standing in for.
    // Safe to call unconditionally: `showConversation` is idempotent and
    // re-syncs every pane either way.
    showConversation();
  }

  /**
   * Puts focus inside the panel, on whatever is actually on screen.
   *
   * ── Why this is not just "focus the composer" any more ────────────────
   *
   * It used to be, and that was correct while the panel WAS the conversation.
   * With screens, the composer is hidden on Home and Messages, and
   * `HTMLElement.focus()` on a hidden element is a silent no-op — so focus
   * stayed on the host page's body. That is not a cosmetic problem: the
   * panel's Escape handler is a listener ON the panel, so with focus outside
   * it the key never arrives and Escape stops closing the widget. A keyboard
   * user could open the thing and not get out of it.
   *
   * A SURFACE wins over the screen underneath it, and that is the case the
   * previous version missed entirely: `openSurface` focuses its view only
   * when the panel is already open, but the pre-chat gate is raised at MOUNT,
   * long before. Opening then hit `openSurface`'s idempotence guard, so
   * nothing focused it and nothing focused the screen it was covering either.
   *
   * `preventScroll` throughout: the panel is fixed-position, so any scroll the
   * browser performs to "reveal" it is always wrong.
   */
  function focusOnOpen(): void {
    if (activeSurface !== null) {
      // Surfaces that can take focus do; the rest fall through to the panel
      // rather than leaving focus outside it.
      if (activeSurface.view.focus !== undefined) {
        activeSurface.view.focus();
        return;
      }
      panel.focus({ preventScroll: true });
      return;
    }

    const openingOn = screens.current();
    if (openingOn === 'conversation' && !composer.node.hidden) {
      composer.input.focus({ preventScroll: true });
      return;
    }
    if (openingOn === 'messages') {
      messagesScreen.focus();
      return;
    }
    // Home has no single obvious first control, and this is also the honest
    // fallback for every case above that could not take focus: the ordinary
    // "focus the dialog" behaviour every other modal on the page uses.
    panel.focus({ preventScroll: true });
  }

  function openSurface(kind: SurfaceKind, build: () => ProductSurface): void {
    // Idempotent by KIND, not by identity: `syncProductSurfaces` runs on every
    // message and every session change, and rebuilding the form under the
    // customer on each one would wipe what they were halfway through typing.
    if (activeSurface?.kind === kind) return;
    closeSurface();
    const view = build();
    activeSurface = { kind, view };
    // The surface stands IN PLACE OF the conversation — same rule every
    // caller of this function already relied on before screens existed, just
    // expressed as a screen transition now: an auto-triggered surface (the
    // pre-chat gate, an out-of-hours form, a just-ended session's CSAT
    // survey) is exactly as interruptive landing on Home or Messages as it
    // was landing on the old single-panel conversation, and a user-triggered
    // one (Report an issue, a fresh "new conversation") was always heading
    // there anyway.
    screens.go('conversation');
    syncScreens();
    surfaceHost.replaceChildren(view.node);
    if (open) view.focus?.();
  }

  /**
   * Puts the right surface — or none — in front of the conversation.
   *
   * Ordered by precedence, and the order is the product decision: being CLOSED
   * outranks everything (there is no conversation to gate), a pre-chat gate
   * outranks a rating (a thread with no messages cannot be rated), and the
   * rating is what is left once a session has ended.
   */
  function syncProductSurfaces(): void {
    if (destroyed) return;
    const state = store.getState();

    if (shouldCollectOffline(remote)) {
      openSurface('offline', () =>
        createOfflineForm(
          remote.preChatEnabled ? [...remote.preChatFields] : [],
          {
            onSubmit: (message) =>
              store.client.sendMessage(
                `Offline message from ${message.name} (${message.contact}):\n\n${message.message}`,
                { metadata: { kind: 'offline_message', name: message.name, contact: message.contact } },
              ),
            onError: report,
          },
          remote.offlineMessage,
        ),
      );
      return;
    }

    const gateOnPreChat =
      remote.preChatEnabled &&
      remote.preChatFields.length > 0 &&
      !preChatAnswered &&
      state.messages.length === 0;
    if (gateOnPreChat) {
      openSurface('preChat', () =>
        createPreChatForm(
          [...remote.preChatFields],
          {
            onSubmit: async (answers) => {
              // Sent as a MESSAGE, not as an identity upsert. The answers are
              // free text a customer typed on a storefront page; promoting
              // them to a Contact would let anyone claim any email address by
              // typing it, which is the hole §14's key split exists to close.
              // The agent reads the lines; `metadata` carries the same facts
              // structured, for whatever consumes them later.
              const lines = remote.preChatFields
                .filter((field) => answers[field.id] !== undefined)
                .map((field) => `${field.label}: ${answers[field.id] ?? ''}`)
                .join('\n');
              await store.client.sendMessage(lines, {
                metadata: { kind: 'pre_chat', answers },
              });
              preChatAnswered = true;
              syncProductSurfaces();
            },
            onSkip: () => {
              preChatAnswered = true;
              syncProductSurfaces();
            },
            onError: report,
          },
          // Deliberately NOT `remote.greeting` any more.
          //
          // The console has these as two separate controls — "Opening →
          // Greeting" ("The first message") and "Before the chat starts →
          // Ask for details first" — and borrowing one for the other's
          // heading meant a merchant's opening line appeared as a form title
          // and never as a message. Now that the greeting has a surface of
          // its own (`armGreeting`), rendering it here too would show it
          // twice on the one screen where both are on display.
        ),
      );
      return;
    }

    const session = state.session;
    const ended = session !== null && (session.status === 'CLOSED' || session.status === 'RESOLVED');
    if (ended && session.id !== ratedSessionId && state.messages.length > 0) {
      const sessionId = session.id;
      openSurface('csat', () =>
        createCsatSurvey(remote.csatStyle, {
          onSubmit: async (score, comment) => {
            // No CSAT endpoint exists on chat-service, so the rating travels
            // the one channel that does work end to end. Stated plainly rather
            // than pretending: a survey that silently discards the answer is
            // worse than no survey.
            await store.client.sendMessage(
              comment === undefined ? `Rating: ${score}/5` : `Rating: ${score}/5 — ${comment}`,
              { metadata: { kind: 'csat', score, ...(comment === undefined ? {} : { comment }) } },
            );
            ratedSessionId = sessionId;
          },
          onError: report,
        }),
      );
      return;
    }

    closeSurface();
  }

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

    // The result is not read from this promise — `listSessions` writes the
    // page to `ChatState.pastSessions` (§9.4-style wholesale replace), and
    // the `pastSessions` subscription below re-renders Home and Messages
    // from there, so this call has exactly one job: get the data into the
    // store at all.
    store.client.listSessions({ limit: SESSION_PICKER_LIMIT }).catch((error: unknown) => {
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
   * The most recently active of `sessions`, or `null` — Home's "Recent
   * conversation" row. Computed rather than trusted to arrive pre-sorted:
   * nothing in this package's own contract with `listSessions` promises an
   * order, and getting this one wrong shows a customer the wrong
   * conversation under a label that says "Recent".
   */
  function mostRecentSession(sessions: readonly ChatSessionSummary[]): ChatSessionSummary | null {
    if (sessions.length === 0) return null;
    return sessions.reduce((latest, candidate) => {
      const latestWhen = new Date(latest.lastMessageAt ?? latest.createdAt).getTime();
      const candidateWhen = new Date(candidate.lastMessageAt ?? candidate.createdAt).getTime();
      return candidateWhen > latestWhen ? candidate : latest;
    });
  }

  /**
   * Feeds `pastSessions` to the two screens that render it. One function for
   * both, not two: they read the exact same array on the exact same two
   * triggers (the list arriving, the joined session changing), and separate
   * functions would be separate places for one of the two to be forgotten.
   */
  function syncSessionSurfaces(): void {
    if (destroyed) return;
    const state = store.getState();
    homeScreen.update(mostRecentSession(state.pastSessions), subtitle ?? '');
    messagesScreen.render(state.pastSessions, state.session?.id ?? null);
  }

  /** Puts the conversation back on screen. Idempotent. */
  function showConversation(): void {
    // `go` is a no-op when already on 'conversation' (see screens.ts), which
    // is exactly the common case here — a session switch, a surface closing
    // — so the repaint cannot be left to `onChange` alone: it fires only on
    // an ACTUAL screen change, and every one of those callers still needs
    // messageList.log/composer/surfaceHost re-evaluated against the activeSurface
    // that just changed underneath them.
    screens.go('conversation');
    syncScreens();
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
    // Consent joins the existing two conditions rather than getting a gate of
    // its own: this is already the ONE place that decides whether the composer
    // is usable, and a second writer is how the status line and the composer
    // ended up disagreeing about the connection before `syncConnection` was
    // consolidated.
    composer.setEnabled(
      closedSessionId === null && connectionState !== 'closed' && consent.agreed(),
    );
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
    const state = store.getState();
    const connectionState = state.connectionState;
    const status = resolveConnectionStatus(connectionState, online, failedAttempts);

    // The banner, from the same three inputs the status line above is resolved
    // from — plus the one thing only the transcript knows: how many messages
    // the customer has already composed that are waiting on the connection.
    // That count is what turns "you're offline" from a warning into a promise,
    // and it is the half a status line could never carry.
    offlineBanner.update(
      resolveOfflineBanner({
        connectionState,
        online,
        failedAttempts,
        queuedCount: countQueuedSends(state.messages),
      }),
    );

    // The whole-panel "we cannot reach the service" state, shown only once
    // core has actually STOPPED — never over a reconnect it is still working
    // through, which would tell the customer the service is down while it is
    // coming back. See ui/unavailable.ts for why this is a screen and not
    // just the status line it sits above.
    const givenUp = TERMINAL_CONNECTION_STATES.has(connectionState);
    unavailable.update(remote.supportEmail ?? '', reconnecting);
    const wasUnreachable = !unavailable.node.hidden;
    setPaneVisible(unavailable.node, givenUp);
    // The screens below have to be told, or they keep painting a composer
    // underneath it. Only on a CHANGE — `syncConnection` runs on every
    // transport event, and a repaint per heartbeat is work nobody asked for.
    if (wasUnreachable !== givenUp) syncScreens();

    // The merchant's subtitle stands in for `'Online'` and for nothing else.
    // Every other label is diagnostic, and a response-time promise painted
    // over "Not connected — use Reconnect to try again" would tell a customer
    // their message is on its way to somebody while it is going nowhere. A
    // healthy connection is the one state with nothing of its own to report,
    // so it is the one the merchant's words can have.
    statusText.textContent =
      connectionState === 'connected' && subtitle !== '' ? subtitle : status.label;
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
  /**
   * What the header menu offers right now.
   *
   * "End conversation" is conditional on there BEING a live one — offering it
   * over a session that is already closed is a control that does nothing, and
   * the menu's whole contract is that every item does something.
   */
  function syncHeaderMenu(): void {
    const session = store.getState().session;
    const live =
      session !== null && session.status !== 'CLOSED' && session.status !== 'RESOLVED';
    headerMenu.update({
      canEnd: live,
      privacyUrl: remote.privacyUrl ?? '',
      reportIssue: remote.reportIssue,
      muted,
    });
  }

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
   * The one place every screen- and surface-driven repaint fans out from.
   *
   * Runs on: a screen change (wired as `screens`'s own `onChange`), an
   * `activeSurface` mutation (`openSurface`/`closeSurface`, via
   * `showConversation`), a message arriving (the transcript's emptiness is
   * part of the condition below), and a config publish (`applyRemoteConfig`,
   * because `design` and `remote.commonQuestions` can both change under it).
   * One function rather than several called in pairs is what
   * `syncPreConversationPanes` — this function's single-panel-era ancestor —
   * already established: splitting related visibility rules across call
   * sites is how one of them ends up stale at a moment another is not.
   */
  function syncScreens(): void {
    if (destroyed) return;
    const current = screens.current();
    const state = store.getState();

    // Everything else is suppressed while the service is unreachable. This is
    // not decoration: leaving a composer that accepts text behind an "we
    // couldn't reach the support service" notice invites the customer to type
    // a message that has nowhere to go, which is the exact failure the whole
    // screen exists to prevent.
    const unreachable = !unavailable.node.hidden;

    const onHome = current === 'home' && !unreachable;
    const onMessages = current === 'messages' && !unreachable;
    const onConversation = current === 'conversation' && !unreachable;
    // The transcript and composer show only on the conversation screen, and
    // only while no product surface (an out-of-hours form, the pre-chat
    // gate, a CSAT survey, the new-conversation composer) is standing in for
    // them — the same "one at a time" rule `openSurface` always enforced,
    // now with a screen layered on top of it.
    const showingLog = onConversation && activeSurface === null;

    setPaneVisible(homeScreen.node, onHome);
    setPaneVisible(messagesScreen.node, onMessages);
    setPaneVisible(surfaceHost, onConversation && activeSurface !== null);
    setPaneVisible(messageList.log, showingLog);
    composer.node.hidden = !showingLog;
    // The tab bar and the composer trade the same bottom-of-panel row: a
    // customer typing does not also need two tabs competing for a glance,
    // and there is no tab for `conversation` to begin with (see nav.ts).
    setPaneVisible(nav.node, !onConversation);
    backButton.hidden = !screens.canGoBack();

    // Common Questions and the hero banner are both Home furniture now —
    // see home-screen.ts's own header on why it arranges rather than owns
    // the shared Common Questions component, and hero-header.ts's on why its
    // CTA now opens the same new-conversation flow Home's own CTA does.
    setPaneVisible(commonQuestionsHost, onHome && remote.commonQuestions.length > 0);
    setPaneVisible(heroHeader.node, onHome && design === 'hero');

    // The greeting stays conversation furniture — it is styled as the first
    // line of THIS chat, not a piece of Home, and disappears the moment
    // there is a real first message. `greetingDue` is the delay having
    // elapsed (see `armGreeting`); without it this pane would appear
    // instantly and the merchant's configured wait would be invisible.
    const beforeFirstMessage = showingLog && state.messages.length === 0;
    setPaneVisible(
      greetingBubble,
      beforeFirstMessage && greetingDue && greetingBubble.textContent !== '',
    );

    nav.update(current, state.unreadCount);
  }

  /**
   * The merchant's opening line, after `behaviour.greetingDelaySec`.
   *
   * ── Why this is not a message ────────────────────────────────────────────
   *
   * It never came from the server, it has no id, and it is not in anybody's
   * transcript — so putting it in the store would mean inventing a message
   * that core would then have to replay, deduplicate and reconcile against
   * history on every resume. It is presentation, and it lives where the other
   * pre-conversation panes live.
   *
   * It is styled as an inbound bubble because that is what it is FOR: the
   * console calls this field "The first message" and its help text is "Say
   * what you can help with, not just hello." Rendering it as a system notice
   * would tell the customer a different thing than the merchant wrote.
   */
  function armGreeting(text: string, delaySec: number): void {
    clearTimeout(greetingTimer);
    greetingBubble.textContent = text;
    greetingDue = delaySec <= 0;

    if (!greetingDue) {
      greetingTimer = setTimeout(() => {
        if (destroyed) return;
        greetingDue = true;
        syncScreens();
      }, delaySec * 1000);
    }
    syncScreens();
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
  /**
   * Emails the customer their own conversation.
   *
   * `POST /chat/sessions/:id/transcript/email`, which takes NO body — the
   * recipient is resolved server-side from the session's own record and is
   * never accepted from a client. That is the endpoint's security model, not
   * an omission here: an address the browser could choose would make this a
   * way to mail any conversation anywhere.
   *
   * Rejects rather than reporting, because the caller is a button that has to
   * change its own label on failure. `report` would swallow the outcome and
   * leave it saying "Sending…" forever.
   */
  async function emailTranscript(): Promise<void> {
    const sessionId = store.getState().session?.id ?? closedSessionId;
    // The button only exists on a closed conversation, so this is close to
    // unreachable — but "no session" must not become a request to
    // `/sessions/undefined/transcript/email`.
    if (sessionId === null || sessionId === undefined) {
      throw new Error('No conversation to send');
    }
    await rest.request('POST', `/chat/sessions/${encodeURIComponent(sessionId)}/transcript/email`, {
      body: {},
    });
  }

  /**
   * Opens the report form in the surface slot the other three forms share.
   *
   * Not a modal, deliberately: this widget has one slot, `openSurface` already
   * owns which form is in it, and a fourth pattern for a fourth form would be
   * a pattern for its own sake. It also means the form cannot be opened on top
   * of the pre-chat gate or the rating.
   */
  function openReportIssue(): void {
    openSurface('report', () =>
      createReportIssueForm({
        onSubmit: (report) => fileIssueReport(report),
        onCancel: () => closeSurface(),
        onError: report,
      }),
    );
  }

  /**
   * Files the report.
   *
   * Rejects rather than reporting, so the form can show its own message and
   * keep what the customer typed — `submitOnce` in ui/forms.ts is built around
   * exactly that contract.
   *
   * The body carries no tenant and no session: the tenant comes from the
   * verified token server-side and the session is in the path, which is the
   * rule the route states in its own header. Sending either would be rejected
   * with a 400 that says so.
   */
  async function fileIssueReport(issue: IssueReport): Promise<void> {
    const sessionId = store.getState().session?.id ?? closedSessionId;
    if (sessionId === null || sessionId === undefined) {
      throw new Error('No conversation to report against');
    }
    await rest.request('POST', `/chat/sessions/${encodeURIComponent(sessionId)}/report-issue`, {
      body: issue,
    });
  }

  /**
   * Ends the conversation, at the customer's request.
   *
   * `closeSession` goes through chat-service's own
   * `POST /chat/sessions/:id/close`, which is customer-owned — so this is the
   * customer closing THEIR session, not an agent action borrowed.
   *
   * Confirmed first, and it is the only control in this widget that asks. It
   * is not reversible from this side: chat-service reopens a session on an
   * AGENT's say-so, not a customer's, so a mis-tap ends the conversation
   * somebody was in the middle of and leaves them starting a new one with no
   * history in it.
   *
   * `confirm` rather than a bespoke sheet: it is the host page's own modal, it
   * is unmissable, and building a second confirmation UI for the one place
   * this widget needs one would be a surface to maintain for a single yes/no.
   */
  function endConversation(): void {
    if (endingConversation) return;
    const live = store.getState().session;
    if (live === null) return;
    // eslint-disable-next-line no-alert -- see the note above.
    if (!globalThis.confirm?.('End this conversation? You can always start a new one.')) return;

    endingConversation = true;
    store.client
      .closeSession()
      .catch(report)
      .finally(() => {
        endingConversation = false;
      });
  }

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
   * Opens the "new conversation" surface — topic chips (when the merchant
   * configured any) plus a message. Every entry point funnels through here:
   * Home's own CTA card, the hero's CTA, the Messages screen's "New
   * conversation" button, a closed conversation's own inline prompt
   * (`messageList`'s `onStartNewConversation`), and the ⋯ menu's "Start new
   * conversation". One destination rather than five, because this is the
   * only place a customer ever gets to set the topic/subject pair
   * `ui/new-conversation.ts` collects — see that module's own header.
   */
  function openNewConversationFlow(): void {
    openSurface('composingNew', () =>
      createNewConversationScreen([...remote.conversationTopics], {
        onStart: (input) => startNewConversation(input),
        onCancel: () => closeSurface(),
        onError: report,
      }),
    );
  }

  /**
   * Mints a session carrying `input`'s topic/subject, then sends the typed
   * message as its opening line — the two-jobs-one-field design
   * `ui/new-conversation.ts`'s own header documents.
   *
   * Rejects rather than catching: the surface this runs as `onStart` for
   * already disables its own button and shows its own message on failure
   * (`submitOnce`, ui/forms.ts), and a second recovery path here would be a
   * second, possibly different, account of the same failure.
   */
  async function startNewConversation(input: NewConversationInput): Promise<void> {
    // `startNewSession`, never `switchSession`: a switch joins a session that
    // already exists and deliberately mints nothing, so using it here would
    // drop the customer into whichever conversation the server picked rather
    // than the fresh one they asked for.
    //
    // `topic` spread conditionally, not passed as `undefined`:
    // `exactOptionalPropertyTypes` treats an explicit `undefined` as a
    // stated value, and core's own contract for this field is ABSENT means
    // "no topic chosen" (see `ui/new-conversation.ts`'s header).
    await store.client.startNewSession({
      ...(input.topic === undefined ? {} : { topic: input.topic }),
      subject: input.message,
    });
    await store.client.sendMessage(input.message);
    // Only reached on success. `closeSurface` is idempotent — a config
    // combination that also gates a pre-chat FORM on the new, still-empty
    // session (`syncProductSurfaces`, reactive on the session-id change
    // above) may already have replaced this surface with that one by the
    // time execution gets here, and this call is then a no-op rather than a
    // second transition fighting the first.
    closeSurface();
    if (open) composer.input.focus({ preventScroll: true });
  }

  // ── open / close ──────────────────────────────────────────────────────
  function openPanel(): void {
    if (open || destroyed) return;
    open = true;
    // Whatever route opened it, the self-opening behaviour has no further job:
    // a delay that fires into an already-open panel is a no-op, and an
    // exit-intent listener left bound would reopen it after the visitor closes
    // it — the "argument, not a greeting" case armAutoOpen exists to avoid.
    releaseAutoOpen();
    releaseAutoOpen = () => undefined;
    // Seeing the conversation is what clears the mark. Before `syncLauncher`
    // runs below, so the badge cannot survive the open that answered it.
    agentInitiated = false;

    restoreFocus = captureFocus();
    panel.setAttribute('data-open', 'true');
    panel.removeAttribute('aria-hidden');
    launcher.setAttribute('aria-expanded', 'true');
    // In `bubble` the launcher stays visible as the close affordance; the
    // other two cover it entirely, so leaving it in the tab order would strand
    // a keyboard user on a control they cannot see.
    launcher.hidden = presentation !== 'bubble';

    trap = trapFocus(panel, shadow);

    focusOnOpen();

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

    // Forgets the back stack — see screens.ts's own contract for this
    // method. A customer three rows deep in Messages who closes and reopens
    // the widget gets the same landing screen everyone else does, not
    // wherever they happened to leave off; `initialScreenName` is the one
    // exception, for a host that named a specific `sessionId`.
    screens.reset(initialScreenName);

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
      // Before anything else: an in-flight config fetch holds a timer and a
      // pending promise, and its `.then` would otherwise run against a torn-
      // down widget. The `destroyed` guard in there covers the race; this
      // releases the socket rather than leaving it to time out.
      remoteConfigAbort.abort();
      // A pending delay timer, or a document-level `mouseout` listener that
      // would otherwise outlive the shadow root.
      releaseAutoOpen();
      clearTimeout(greetingTimer);
      window.removeEventListener('resize', onResize);
      // Both hold a window listener or a timer that would otherwise outlive
      // the shadow root. The pump goes first: it subscribes to `network`.
      reconnectPump.destroy();
      unsubscribeNetwork();
      network.destroy();
      trap?.release();
      restoreFocus?.();
      // Before `store.destroy()`: these settle by unsubscribing from the
      // store, and `select`'s unsubscribe on an already-destroyed store is a
      // no-op rather than an error, but draining first keeps the ordering
      // obvious. A copy, because `finish` deletes from the set it walks.
      for (const cancel of [...pendingHistorySettles]) cancel();
      for (const unsubscribe of unsubscribers) unsubscribe();
      closeSurface();
      // Its pending storage read resolves after teardown otherwise, and would
      // touch a node that is on its way out.
      consent.destroy();
      // Its own document-level pointerdown listener, same as the message menu.
      headerMenu.destroy();
      composer.destroy();
      messagesScreen.destroy();
      // `disconnect: true` — this store built the client it wraps, so nothing
      // else on the page is using that socket.
      store.destroy({ disconnect: true });
      root.destroy();
    },
  };
}
