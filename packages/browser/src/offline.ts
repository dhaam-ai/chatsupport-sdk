// The offline story's browser half: what the platform says about the network,
// a retry cadence that caps how long a recoverable outage can look stuck, and
// the one place the copy for "you are offline" is written.
//
// ---------------------------------------------------------------------------
// Why any of this is outside core
// ---------------------------------------------------------------------------
//
// Core owns the connection state machine and the durable send queue, and both
// are already correct: a dropped socket retries indefinitely (§8.2) and the
// queue flushes in FIFO order on reconnect (§8.4). Neither of those is what a
// customer complains about. They complain that the widget sat on "Connecting…"
// with no explanation while their train was in a tunnel, and that when the
// signal came back it stayed there for another half a minute.
//
// Both halves of that are outside core's reach by construction. `navigator`
// is a DOM global core has zero dependencies on (§4), and "how long is too
// long to look stuck" is a product decision, not a protocol one. So they live
// here, in the package whose whole charter is "the browser primitives every
// binding needs and none of them should own" — one implementation that
// @dhaam-ccrm/widget renders as DOM and @dhaam-ccrm/react returns from a hook,
// rather than two that drift the first time either is edited.
//
// Nothing here touches a browser global at module scope. Importing this file
// registers no listener and starts no timer, so it is safe in a file that also
// renders on a server.

// ---------------------------------------------------------------------------
// What the platform says about the network
// ---------------------------------------------------------------------------

/**
 * A live view of the browser's own connectivity signal.
 *
 * ── `false` is evidence; `true` is not ──────────────────────────────────────
 *
 * `navigator.onLine === false` means the OS has no network interface with a
 * route. That is a hard fact, and it is the one this whole module is built on:
 * when it is false, nothing this client sends can possibly leave the device,
 * so saying so is honest and actionable.
 *
 * `true` is much weaker. It means "an interface exists", which is equally true
 * of a hotel wifi that has not been paid for, a VPN that dropped, and an
 * Android device holding a cell association with no data. So a caller must
 * never read `true` as "the connection is fine" — that question is answered by
 * `connectionState`, not by this. {@link resolveOfflineBanner} is where the
 * two are combined, and it treats them exactly that asymmetrically.
 */
export interface NetworkStatus {
  /**
   * Whether the platform currently reports a network.
   *
   * `true` in every environment that cannot say (SSR, a `navigator` without
   * `onLine`) — the only safe default, since a server render must not paint a
   * false offline notice into the markup.
   *
   * Stable enough for `useSyncExternalStore`: it returns a primitive, so the
   * identity check that hook performs is a value comparison.
   */
  getSnapshot(): boolean;

  /**
   * Notified once per `online`/`offline` event, with the value as of that
   * event. Returns an unsubscribe.
   *
   * Deliberately NOT deduplicated against the previous value. A browser that
   * fires `online` while `navigator.onLine` is already `true` — Safari does
   * this on wake, and it is what a page restored from bfcache looks like — is
   * still telling us something changed about connectivity, and swallowing it
   * because the flag reads the same is how a client stays parked through the
   * one event that would have revived it. Everything downstream is idempotent
   * (`retryNow()` no-ops outside `reconnecting`, a repaint with unchanged
   * inputs writes no DOM, React bails out on an identical value), so the cost
   * of a redundant notification is nil and the cost of a missed one is a dead
   * connection.
   */
  subscribe(listener: (online: boolean) => void): () => void;

  /** Detaches both window listeners. Idempotent. */
  destroy(): void;
}

/** Reads `navigator.onLine`, defaulting to online wherever it cannot be read. */
export function isNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/**
 * Starts watching the browser's `online`/`offline` events.
 *
 * Events rather than polling, deliberately: they fire on the actual transition,
 * so the reaction to a network coming back is immediate rather than up to a
 * poll interval late — and "immediate" is the entire point of the reconnect
 * path built on top of this ({@link createReconnectPump}).
 *
 * In an environment with no `window` this returns a working object that is
 * permanently online and subscribes to nothing, so a caller needs no `typeof`
 * guard of its own.
 */
export function createNetworkStatus(): NetworkStatus {
  let online = isNavigatorOnline();
  const listeners = new Set<(online: boolean) => void>();

  const publish = (next: boolean): void => {
    online = next;
    // A copy, so a listener that unsubscribes itself (or another) from inside
    // the notification does not mutate the set being iterated.
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // One binding's render throwing must not stop the others from
        // learning that the network came back.
      }
    }
  };

  const onOnline = (): void => publish(true);
  const onOffline = (): void => publish(false);

  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWindow) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  let destroyed = false;
  return {
    getSnapshot: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      if (hasWindow) {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The retry cadence
// ---------------------------------------------------------------------------

/**
 * The longest a recoverable outage is allowed to look stuck.
 *
 * Core's full-jitter backoff (§8.2) is right about servers and wrong about
 * phones. Its whole job is to protect a recovering server from every client it
 * dropped reconnecting in lockstep, and it does that by growing the delay to a
 * 30-second cap. But the commonest outage a chat widget actually sees is not a
 * server restart — it is one device losing signal for ninety seconds. That
 * device is not part of a thundering herd, and making it wait out a 30-second
 * delay after its signal is back is how "it just says Connecting…" gets
 * reported.
 *
 * Three seconds is the ceiling this puts on that wait. It does not replace
 * backoff: core's early attempts are all faster than this (500ms, 1s, 2s), so
 * for the first several failures this timer never wins. It only bites once the
 * curve has climbed past it, which is exactly the regime where a single
 * device's retry rate is no longer anyone's problem.
 */
export const DEFAULT_RECONNECT_INTERVAL_MS = 3_000;

/**
 * The slice of `ChatClient` the pump drives.
 *
 * Structural, so this package still has no `@dhaam-ccrm/core` dependency — not
 * even a type-only one — and a real `ChatClient` satisfies it as-is. Same
 * reasoning as {@link TrackedMessage} in read-tracker.ts.
 *
 * `connectionState` is typed `string` rather than core's seven-member union
 * for that reason. Nothing here branches on a member this package would have
 * to keep in sync: the only state the pump acts in is named once, below.
 */
export interface ReconnectTarget {
  getState(): { readonly connectionState: string };
  subscribe(listener: () => void): () => void;

  /**
   * Core's `ChatClient.retryNow()` — abandon the armed backoff and attempt
   * now, returning whether an attempt actually started.
   *
   * NOT `connect()`, and the difference is the whole reason this is safe to
   * call on a timer. `connect()` returns the in-flight promise whenever one is
   * pending (which, on a client that has never reached `connection.ack`, is
   * the entire retry loop) so it would open no socket at all in exactly the
   * case that matters — and where it did run it would also reset the AUTH
   * escalation counter, which a network blip is no evidence to do.
   */
  retryNow(): boolean;
}

/** Cancels a repeating timer. */
export type CancelInterval = () => void;

/** Injectable `setInterval`, so the cadence is testable without real time. */
export type ScheduleInterval = (callback: () => void, delayMs: number) => CancelInterval;

const systemInterval: ScheduleInterval = (callback, delayMs) => {
  const id = setInterval(callback, delayMs);
  return () => clearInterval(id);
};

export interface ReconnectPumpOptions {
  readonly target: ReconnectTarget;

  /**
   * The platform's connectivity signal. When supplied, an offline→online edge
   * retries immediately instead of waiting out the interval — which is the
   * single most valuable thing in this module, because it turns "up to 30
   * seconds after your signal returns" into "the same instant".
   */
  readonly network?: NetworkStatus;

  /** Defaults to {@link DEFAULT_RECONNECT_INTERVAL_MS}. */
  readonly intervalMs?: number;

  /** Defaults to `setInterval`/`clearInterval`. */
  readonly schedule?: ScheduleInterval;
}

export interface ReconnectPump {
  /** Whether a cadence timer is currently armed. For tests and diagnostics. */
  readonly isArmed: boolean;

  /** Stops the timer and drops both subscriptions. Idempotent. */
  destroy(): void;
}

/**
 * Caps how long core will sit on an armed backoff, and collapses that wait to
 * zero the moment the platform says the network is back.
 *
 * ── Why this cannot become a second retry loop ─────────────────────────────
 *
 * A binding that retries on its own timer while core retries on its is the
 * classic way to end up hammering a downed server, and it is a mistake this
 * codebase has already made once (see @dhaam-ccrm/widget's
 * `WorkingConnectionState` note on why its Reconnect button is inert). This
 * cannot become that, for a reason in core rather than a rule here:
 * `retryNow()` acts ONLY while `connectionState === 'reconnecting'` — a state
 * that by definition means "no socket is open and a timer is counting down".
 * Every other state, including the `connecting` of an attempt already in
 * flight, returns `false` and does nothing. So this can never supersede a live
 * attempt, open a second socket, or shorten anything below core's own first
 * delay.
 *
 * The timer is armed only while the target is in that one state, so a healthy
 * connection has no periodic work at all.
 */
export function createReconnectPump(options: ReconnectPumpOptions): ReconnectPump {
  const { target, network } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS;
  const schedule = options.schedule ?? systemInterval;

  let cancel: CancelInterval | null = null;
  let destroyed = false;

  const disarm = (): void => {
    cancel?.();
    cancel = null;
  };

  const sync = (): void => {
    if (destroyed) return;
    const waiting = target.getState().connectionState === 'reconnecting';

    if (!waiting) {
      disarm();
      return;
    }
    if (cancel !== null) return;

    cancel = schedule(() => {
      // Re-checked rather than trusted: the subscription below disarms on
      // every transition, but a timer that fired in the same tick as a
      // transition must not act on the state it was armed for.
      if (target.getState().connectionState !== 'reconnecting') return;
      target.retryNow();
    }, intervalMs);
  };

  const unsubscribeTarget = target.subscribe(sync);
  sync();

  const unsubscribeNetwork =
    network === undefined
      ? null
      : network.subscribe((online) => {
          if (destroyed || !online) return;
          // The reason the last attempts failed is provably gone. Waiting out
          // a delay computed while it was still true is pure dead time.
          target.retryNow();
          // The retry moves the state to `connecting`, so the armed timer is
          // now for a state we have left.
          sync();
        });

  return {
    get isArmed(): boolean {
      return cancel !== null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      disarm();
      unsubscribeTarget();
      unsubscribeNetwork?.();
    },
  };
}

// ---------------------------------------------------------------------------
// What the customer is told
// ---------------------------------------------------------------------------

/**
 * How many consecutive failed attempts before an outage stops being a blip.
 *
 * One failure is the commonest event the transport has — a wifi handover, a
 * proxy recycling a socket — and core is usually back inside a second. A
 * banner on the FIRST failure would flash constantly on a healthy connection,
 * for a condition that resolves before the customer finishes reading it. Two
 * consecutive failures is the cheapest honest evidence that something is
 * actually wrong.
 *
 * Kept identical to @dhaam-ccrm/widget's `OUTAGE_ATTEMPT_THRESHOLD`, which
 * this now supplies.
 */
export const OUTAGE_ATTEMPT_THRESHOLD = 2;

/**
 * Which of the two things has gone wrong.
 *
 * `offline` — the device has no network. The customer can act on this.
 * `unreachable` — the device has a network but chat cannot be reached. They
 *   cannot act on it, so the copy promises what we are doing instead.
 */
export type OfflineBannerTone = 'offline' | 'unreachable';

/** Everything a banner needs, decided once. */
export interface OfflineBannerView {
  readonly tone: OfflineBannerTone;

  /** The full sentence, already accounting for `queuedCount`. */
  readonly message: string;

  /** How many composed messages are waiting on the connection. May be 0. */
  readonly queuedCount: number;
}

/** The shape {@link countQueuedSends} reads. `ChatMessage` satisfies it. */
export interface QueueableMessage {
  readonly delivery?: { readonly state: string } | undefined;
}

/**
 * How many messages the customer has composed that have not reached the
 * server yet.
 *
 * Read off the transcript rather than from a queue handle, because the
 * transcript is what a binding already has and core keeps the two in step: a
 * queued send is rendered as an ordinary optimistic message carrying
 * `delivery: { state: 'queued' }`, including after a reload, when
 * `SendQueue.restore()` rehydrates it. Counting `'failed'` here would be
 * wrong — a permanently failed send is not waiting on the network and will not
 * go out on reconnect; it needs `retryMessage()` and its own affordance.
 */
export function countQueuedSends(messages: readonly QueueableMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.delivery?.state === 'queued') count += 1;
  }
  return count;
}

export interface OfflineBannerInput {
  /** Core's `ChatState.connectionState`. */
  readonly connectionState: string;

  /** {@link NetworkStatus.getSnapshot}. */
  readonly online: boolean;

  /**
   * Consecutive failed connection attempts, reset on every successful connect.
   *
   * Counted from core's `reconnecting` event, which fires once per scheduled
   * retry, rather than derived from `connectionState`: the state cycles
   * `connecting → reconnecting → connecting` indefinitely, so it says whether
   * an attempt is in flight but never how many have already failed. That
   * missing number is precisely what separates a healthy first connect from an
   * outage.
   */
  readonly failedAttempts: number;

  /** {@link countQueuedSends}. */
  readonly queuedCount: number;
}

/**
 * The single decision behind every offline banner this SDK draws.
 *
 * Returns `null` when there is nothing to say — which is most of the time, and
 * is deliberately also the answer during a healthy first connect and a single
 * blip. A banner that appears for every reconnect teaches customers to ignore
 * banners.
 *
 * ── The precedence, which is where the asymmetry pays off ────────────────
 *
 * `closed` and `suspended` are silent before anything else is considered.
 * `closed` is the customer's own `disconnect()`, not a fault. `suspended` is a
 * credential or protocol failure that no amount of network will fix, and core
 * has stopped retrying — so "your messages will send when you're back online"
 * would be a straight lie there. That state belongs to an explicit "Reconnect"
 * affordance instead.
 *
 * Then `online === false` wins over EVERYTHING, `connected` included. That
 * looks wrong for about a second and is the whole reason {@link NetworkStatus}
 * documents the asymmetry: the platform reporting no route is a hard fact,
 * while a socket reporting itself open is not. A socket whose route has gone
 * is half-open — it stays "open" until a write fails or a keepalive expires,
 * which on mobile is tens of seconds — and during all of it a customer who has
 * just watched their signal bar empty is typing into something that cannot
 * deliver. Telling them the truth immediately, and promising the queue, is
 * strictly better than a banner that arrives once the socket catches up.
 *
 * Only after that does `connected` short-circuit, which is the case the
 * asymmetry protects: `online === true` is NOT evidence of anything (a captive
 * portal, a dropped VPN, Android's flag lagging the real interface), so it must
 * never on its own suppress a banner — but an open socket may, because that IS
 * evidence.
 */
export function resolveOfflineBanner(input: OfflineBannerInput): OfflineBannerView | null {
  const { connectionState, online, failedAttempts, queuedCount } = input;

  if (connectionState === 'closed' || connectionState === 'suspended') return null;

  // Before the connection state and before the attempt count. "There is no
  // network" is more specific and more actionable than "we cannot reach the
  // server", it is the REASON any attempts are failing rather than a separate
  // fact, and it needs no failure count behind it — the device told us.
  if (!online) {
    return { tone: 'offline', message: offlineMessage(queuedCount), queuedCount };
  }

  if (connectionState === 'connected') return null;

  if (failedAttempts >= OUTAGE_ATTEMPT_THRESHOLD) {
    return { tone: 'unreachable', message: unreachableMessage(queuedCount), queuedCount };
  }

  return null;
}

/** `1 message` / `3 messages`. */
function plural(count: number): string {
  return count === 1 ? '1 message' : `${String(count)} messages`;
}

function offlineMessage(queuedCount: number): string {
  return queuedCount === 0
    ? 'You’re offline. Messages will send when you’re back online.'
    : `You’re offline. ${plural(queuedCount)} will send when you’re back online.`;
}

function unreachableMessage(queuedCount: number): string {
  return queuedCount === 0
    ? 'Can’t reach chat — still trying.'
    : `Can’t reach chat — ${plural(queuedCount)} will send when we reconnect.`;
}
