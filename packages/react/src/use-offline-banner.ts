// useOfflineBanner — everything a React app needs to render "you're offline,
// your messages are safe", plus the reconnect behaviour that makes the second
// half of that sentence true quickly rather than eventually.
//
// ── Why the copy is not written here ──────────────────────────────────────
//
// The decision (show it? which tone? what sentence?) comes from
// `resolveOfflineBanner` in @dhaam-ccrm/browser, which @dhaam-ccrm/widget also
// renders from. Two implementations of "when is a connection bad enough to
// mention" is two answers, and the drift shows up as a widget and a React host
// on the same page saying different things about the same socket. This file is
// wiring: it collects the four inputs that decision needs, three of which are
// React-shaped problems (a store subscription, a browser event source, and an
// event counter that no snapshot carries).
//
// ── Why it also runs the reconnect pump ───────────────────────────────────
//
// Because a banner that only describes the problem is the bug this replaces.
// Core retries indefinitely (§8.2) but its backoff climbs to a 30-second cap,
// so a phone leaving a tunnel sits on "Connecting…" long after its signal is
// back. `createReconnectPump` collapses that: immediately on the browser's
// `online` event, and otherwise capping any armed backoff at three seconds. It
// drives core's `retryNow()`, which acts only while a backoff is counting
// down, so this cannot become a second retry loop racing core's.
//
// A host that wants the state but not the behaviour passes `retry: false`.

import type { ChatState } from '@dhaam-ccrm/core';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  countQueuedSends,
  createNetworkStatus,
  createReconnectPump,
  isNavigatorOnline,
  resolveOfflineBanner,
} from '@dhaam-ccrm/browser';
import type { OfflineBannerTone, OfflineBannerView } from '@dhaam-ccrm/browser';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export { DEFAULT_RECONNECT_INTERVAL_MS } from '@dhaam-ccrm/browser';
export type { OfflineBannerTone, OfflineBannerView } from '@dhaam-ccrm/browser';

// ---------------------------------------------------------------------------
// useNetworkStatus
// ---------------------------------------------------------------------------

/**
 * Whether the browser currently reports a network.
 *
 * SSR-safe: the server snapshot is `true` unconditionally, which is the only
 * answer that does not render a false offline notice into markup that will
 * hydrate on a perfectly connected machine.
 *
 * Read `false` as hard evidence and `true` as no evidence at all — see
 * `NetworkStatus` in @dhaam-ccrm/browser for the asymmetry and why it matters.
 * Prefer {@link useOfflineBanner}, which combines this with the connection
 * state correctly; this is exported for a host that wants the raw signal.
 */
export function useNetworkStatus(): boolean {
  // One status object per mounted hook, created lazily inside the state
  // initialiser so that no `window` is touched during a server render — and
  // never re-created by a re-render, which would drop the listeners.
  const [status] = useState(createNetworkStatus);
  useEffect(() => () => status.destroy(), [status]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => status.subscribe(() => onStoreChange()),
    [status],
  );

  return useSyncExternalStore(subscribe, status.getSnapshot, serverOnline);
}

/** The SSR snapshot. A module-scope function, so its identity is stable. */
function serverOnline(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// useOfflineBanner
// ---------------------------------------------------------------------------

export interface UseOfflineBannerOptions {
  /**
   * Whether to run the reconnect cadence. Defaults to `true`.
   *
   * `false` makes the hook purely observational — useful when several
   * components read the banner state and only one should own the retrying, or
   * when a host drives reconnection itself.
   */
  readonly retry?: boolean;

  /** Cadence ceiling, in ms. Defaults to `DEFAULT_RECONNECT_INTERVAL_MS`. */
  readonly intervalMs?: number;
}

export interface UseOfflineBannerResult {
  /**
   * What to render, or `null` when there is nothing worth saying — which is
   * most of the time, including during a healthy first connect and a single
   * blip. Render nothing on `null`; do not substitute copy of your own.
   */
  readonly banner: OfflineBannerView | null;

  /** The raw platform signal. See {@link useNetworkStatus} on how to read it. */
  readonly online: boolean;

  /** Composed messages waiting on the connection. They send themselves (§8.4). */
  readonly queuedCount: number;

  /**
   * Consecutive failed connection attempts since the last successful connect.
   *
   * Counted from core's `reconnecting` event rather than derived from
   * `connectionState`, because the state cycles `connecting → reconnecting →
   * connecting` indefinitely: it says whether an attempt is in flight, never
   * how many have already failed. That missing number is the whole difference
   * between a first connect and an outage.
   */
  readonly failedAttempts: number;

  /**
   * Abandons an armed backoff and attempts now, returning whether an attempt
   * started. Already wired to the browser's `online` event and to the cadence
   * — this is for an explicit "Try again" control.
   *
   * It is a no-op (`false`) unless core is waiting out a backoff. In
   * particular it will NOT revive a `suspended` or `closed` client: §8.1 gives
   * those exactly one way out and it is `connect()`.
   */
  retryNow: () => boolean;
}

function selectConnectionState(state: ChatState): string {
  return state.connectionState;
}

function selectQueuedCount(state: ChatState): number {
  return countQueuedSends(state.messages);
}

/**
 * The offline banner's state, and the reconnect behaviour behind it.
 *
 * ```tsx
 * const { banner, retryNow } = useOfflineBanner();
 * if (banner === null) return null;
 * return <div role="status" data-tone={banner.tone}>{banner.message}</div>;
 * ```
 *
 * Every value re-renders only when it actually changes: the two `ChatState`
 * reads go through `useChatSelector`, and `queuedCount` is selected as a
 * NUMBER rather than as the message array, so the once-per-message churn of a
 * live conversation does not re-render a banner that is not even showing.
 */
export function useOfflineBanner(options: UseOfflineBannerOptions = {}): UseOfflineBannerResult {
  const { retry = true, intervalMs } = options;
  const client = useChatClient();

  const online = useNetworkStatus();
  const connectionState = useChatSelector(selectConnectionState);
  const queuedCount = useChatSelector(selectQueuedCount);

  // The one input no snapshot carries. `reconnecting` fires once per scheduled
  // retry; `connected` is the only proof the run of failures is over, and it
  // is read off the state above rather than from a second event subscription
  // so the reset cannot lag the render that needs it.
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (connectionState === 'connected') setFailedAttempts(0);
  }, [connectionState]);

  useEffect(() => {
    return client.on('reconnecting', () => {
      setFailedAttempts((previous) => previous + 1);
    });
  }, [client]);

  // The pump owns its own `NetworkStatus`. It could have shared the one behind
  // `useNetworkStatus` above, but that object's lifetime is a render concern
  // and the pump's is an effect's — sharing would make an unmount ordering
  // question out of something that costs two window listeners.
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useEffect(() => {
    if (!retry) return;

    const network = createNetworkStatus();
    const pump = createReconnectPump({
      target: client,
      network,
      ...(intervalRef.current === undefined ? {} : { intervalMs: intervalRef.current }),
    });

    return () => {
      pump.destroy();
      network.destroy();
    };
    // `intervalMs` is read through a ref: a host passing an inline number is
    // not asking for the timer to be torn down and rebuilt on every render,
    // and a changed cadence takes effect on the next arming anyway.
  }, [client, retry]);

  const retryNow = useCallback(() => client.retryNow(), [client]);

  const banner = resolveOfflineBanner({ connectionState, online, failedAttempts, queuedCount });

  return { banner, online, queuedCount, failedAttempts, retryNow };
}

/**
 * A one-off, non-reactive read of the platform's connectivity signal —
 * `true` wherever it cannot be read, including on a server.
 *
 * Re-exported so a host that needs the value outside a component (an event
 * handler deciding whether to bother with a fetch) does not add
 * @dhaam-ccrm/browser as a second dependency. Inside a component, use
 * {@link useNetworkStatus}: this one does not re-render on a change.
 */
export { isNavigatorOnline };
