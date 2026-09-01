// @vitest-environment jsdom
//
// jsdom gives us a real `window` with real `online`/`offline` events, but its
// `navigator.onLine` is a read-only getter that is always `true`. So the
// initial-snapshot assertions stub the property directly, and every transition
// assertion goes through `window.dispatchEvent` — which is what the browser
// itself does, and what `createNetworkStatus` actually listens for.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  countQueuedSends,
  createNetworkStatus,
  createReconnectPump,
  DEFAULT_RECONNECT_INTERVAL_MS,
  isNavigatorOnline,
  OUTAGE_ATTEMPT_THRESHOLD,
  resolveOfflineBanner,
} from '../src/offline.js';
import type { CancelInterval, NetworkStatus, ReconnectTarget } from '../src/offline.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const restore: Array<() => void> = [];

afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

/** Overrides jsdom's always-true `navigator.onLine` for one test. */
function stubOnLine(value: boolean): void {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  restore.push(() => {
    if (original === undefined) {
      delete (window.navigator as { onLine?: boolean }).onLine;
      return;
    }
    Object.defineProperty(window.navigator, 'onLine', original);
  });
}

/** A `ChatClient`-shaped double: one mutable state field and a retry counter. */
function fakeTarget(connectionState = 'connected') {
  const listeners = new Set<() => void>();
  let state = connectionState;
  const retries: string[] = [];

  const target: ReconnectTarget = {
    getState: () => ({ connectionState: state }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // The real `ChatClient.retryNow()` contract: acts only while a backoff is
    // armed, and reports whether it did.
    retryNow() {
      retries.push(state);
      if (state !== 'reconnecting') return false;
      state = 'connecting';
      for (const listener of [...listeners]) listener();
      return true;
    },
  };

  return {
    target,
    retries,
    set(next: string) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    get state() {
      return state;
    },
  };
}

/** A manual `ScheduleInterval`: fires only when the test says so. */
function manualIntervals() {
  const armed: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];

  const schedule = (callback: () => void, delayMs: number): CancelInterval => {
    const entry = { callback, delayMs, cancelled: false };
    armed.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  return {
    schedule,
    get live() {
      return armed.filter((entry) => !entry.cancelled);
    },
    /** Fires every live timer once, in arming order. */
    tick() {
      for (const entry of armed.filter((e) => !e.cancelled)) entry.callback();
    },
  };
}

// ---------------------------------------------------------------------------
// createNetworkStatus
// ---------------------------------------------------------------------------

describe('createNetworkStatus', () => {
  it('starts from navigator.onLine and follows the window events', () => {
    stubOnLine(false);
    const status = createNetworkStatus();
    restore.push(() => status.destroy());

    expect(status.getSnapshot()).toBe(false);

    const seen: boolean[] = [];
    status.subscribe((online) => seen.push(online));

    window.dispatchEvent(new Event('online'));
    expect(status.getSnapshot()).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(status.getSnapshot()).toBe(false);

    expect(seen).toEqual([true, false]);
  });

  it('notifies on a repeated event, rather than deduping against the value', () => {
    // Safari fires `online` on wake, and a bfcache restore looks the same:
    // the event arrives with `navigator.onLine` already `true`. Swallowing it
    // is how a parked client stays parked through the one event that would
    // have revived it — and everything downstream is idempotent, so the
    // redundant notification costs nothing.
    stubOnLine(true);
    const status = createNetworkStatus();
    restore.push(() => status.destroy());

    const seen: boolean[] = [];
    status.subscribe((online) => seen.push(online));

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(seen).toEqual([true, true]);
  });

  it('keeps notifying the rest after one listener throws', () => {
    stubOnLine(true);
    const status = createNetworkStatus();
    restore.push(() => status.destroy());

    const seen: boolean[] = [];
    status.subscribe(() => {
      throw new Error('a binding’s render blew up');
    });
    status.subscribe((online) => seen.push(online));

    window.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([false]);
  });

  it('detaches on destroy, and destroy is idempotent', () => {
    stubOnLine(true);
    const status = createNetworkStatus();

    status.destroy();
    status.destroy();

    window.dispatchEvent(new Event('offline'));
    expect(status.getSnapshot()).toBe(true);
  });

  it('reports online where navigator cannot be read', () => {
    // The SSR default. A server render must never paint a false offline
    // notice into the markup.
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: undefined, configurable: true });
    restore.push(() => {
      if (original !== undefined) Object.defineProperty(window.navigator, 'onLine', original);
    });

    expect(isNavigatorOnline()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createReconnectPump
// ---------------------------------------------------------------------------

describe('createReconnectPump', () => {
  it('arms only while the target is waiting out a backoff', () => {
    const timers = manualIntervals();
    const client = fakeTarget('connected');
    const pump = createReconnectPump({ target: client.target, schedule: timers.schedule });
    restore.push(() => pump.destroy());

    expect(pump.isArmed).toBe(false);

    client.set('reconnecting');
    expect(pump.isArmed).toBe(true);
    expect(timers.live[0]?.delayMs).toBe(DEFAULT_RECONNECT_INTERVAL_MS);

    client.set('connecting');
    expect(pump.isArmed).toBe(false);
    expect(timers.live).toHaveLength(0);
  });

  it('does not re-arm on every state notification while still reconnecting', () => {
    const timers = manualIntervals();
    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({ target: client.target, schedule: timers.schedule });
    restore.push(() => pump.destroy());

    client.set('reconnecting');
    client.set('reconnecting');

    expect(timers.live).toHaveLength(1);
  });

  it('caps the wait: a fired tick retries, and the retry stands the target up', () => {
    const timers = manualIntervals();
    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({ target: client.target, schedule: timers.schedule });
    restore.push(() => pump.destroy());

    timers.tick();

    expect(client.retries).toEqual(['reconnecting']);
    expect(client.state).toBe('connecting');
    // The retry left `reconnecting`, so the cadence disarmed itself.
    expect(pump.isArmed).toBe(false);
  });

  it('a tick that fires after the state has moved does nothing', () => {
    const timers = manualIntervals();
    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({ target: client.target, schedule: timers.schedule });
    restore.push(() => pump.destroy());

    const armed = timers.live[0];
    client.set('connecting');
    // Fire the timer directly, bypassing the cancel — this is the same-tick
    // race the re-check inside the callback exists for.
    armed?.callback();

    expect(client.retries).toEqual([]);
  });

  it('retries immediately when the network comes back, without waiting out the interval', () => {
    stubOnLine(false);
    const timers = manualIntervals();
    const network = createNetworkStatus();
    restore.push(() => network.destroy());

    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({
      target: client.target,
      network,
      schedule: timers.schedule,
    });
    restore.push(() => pump.destroy());

    window.dispatchEvent(new Event('online'));

    expect(client.retries).toEqual(['reconnecting']);
    expect(client.state).toBe('connecting');
    expect(pump.isArmed).toBe(false);
  });

  it('ignores the offline edge — there is nothing to retry into', () => {
    stubOnLine(true);
    const timers = manualIntervals();
    const network = createNetworkStatus();
    restore.push(() => network.destroy());

    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({
      target: client.target,
      network,
      schedule: timers.schedule,
    });
    restore.push(() => pump.destroy());

    window.dispatchEvent(new Event('offline'));
    expect(client.retries).toEqual([]);
  });

  it('stops everything on destroy', () => {
    stubOnLine(false);
    const timers = manualIntervals();
    const network = createNetworkStatus();
    restore.push(() => network.destroy());

    const client = fakeTarget('reconnecting');
    const pump = createReconnectPump({
      target: client.target,
      network,
      schedule: timers.schedule,
    });

    pump.destroy();
    pump.destroy();

    window.dispatchEvent(new Event('online'));
    client.set('reconnecting');

    expect(client.retries).toEqual([]);
    expect(timers.live).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveOfflineBanner
// ---------------------------------------------------------------------------

describe('resolveOfflineBanner', () => {
  const base = { connectionState: 'reconnecting', online: true, failedAttempts: 0, queuedCount: 0 };

  it('says nothing during a healthy first connect or a single blip', () => {
    expect(resolveOfflineBanner({ ...base, connectionState: 'connecting' })).toBeNull();
    expect(resolveOfflineBanner({ ...base, failedAttempts: 1 })).toBeNull();
  });

  it('says nothing once connected, when the platform agrees there is a network', () => {
    expect(resolveOfflineBanner({ ...base, connectionState: 'connected' })).toBeNull();
  });

  it('speaks over a `connected` socket when the platform says the route is gone', () => {
    // The asymmetry, and the case it exists for: a socket stays "open" until a
    // write fails or a keepalive expires — tens of seconds on mobile — while
    // the customer watches their signal bar empty and keeps typing.
    expect(resolveOfflineBanner({ ...base, connectionState: 'connected', online: false })).toEqual({
      tone: 'offline',
      message: 'You’re offline. Messages will send when you’re back online.',
      queuedCount: 0,
    });
  });

  it('says nothing for closed or suspended — neither is about the network', () => {
    expect(resolveOfflineBanner({ ...base, connectionState: 'closed', online: false })).toBeNull();
    expect(resolveOfflineBanner({ ...base, connectionState: 'suspended', online: false })).toBeNull();
  });

  it('reports offline off the platform signal alone, with no failures needed', () => {
    const view = resolveOfflineBanner({ ...base, connectionState: 'connecting', online: false });
    expect(view).toEqual({
      tone: 'offline',
      message: 'You’re offline. Messages will send when you’re back online.',
      queuedCount: 0,
    });
  });

  it('prefers offline over unreachable — it is the reason the attempts fail', () => {
    const view = resolveOfflineBanner({ ...base, online: false, failedAttempts: 9 });
    expect(view?.tone).toBe('offline');
  });

  it('reports unreachable only once the outage threshold is met', () => {
    expect(resolveOfflineBanner({ ...base, failedAttempts: OUTAGE_ATTEMPT_THRESHOLD - 1 })).toBeNull();
    expect(resolveOfflineBanner({ ...base, failedAttempts: OUTAGE_ATTEMPT_THRESHOLD })).toEqual({
      tone: 'unreachable',
      message: 'Can’t reach chat — still trying.',
      queuedCount: 0,
    });
  });

  it('names the queued count, singular and plural', () => {
    expect(resolveOfflineBanner({ ...base, online: false, queuedCount: 1 })?.message).toBe(
      'You’re offline. 1 message will send when you’re back online.',
    );
    expect(resolveOfflineBanner({ ...base, online: false, queuedCount: 3 })?.message).toBe(
      'You’re offline. 3 messages will send when you’re back online.',
    );
    expect(
      resolveOfflineBanner({ ...base, failedAttempts: 2, queuedCount: 2 })?.message,
    ).toBe('Can’t reach chat — 2 messages will send when we reconnect.');
  });
});

// ---------------------------------------------------------------------------
// countQueuedSends
// ---------------------------------------------------------------------------

describe('countQueuedSends', () => {
  it('counts queued sends and nothing else', () => {
    expect(
      countQueuedSends([
        { delivery: { state: 'queued' } },
        { delivery: { state: 'queued' } },
        // Permanently failed: not waiting on the network, and it will NOT go
        // out on reconnect — it needs retryMessage() and its own affordance.
        { delivery: { state: 'failed' } },
        { delivery: { state: 'sent' } },
        // An inbound message has no delivery at all.
        {},
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty transcript', () => {
    expect(countQueuedSends([])).toBe(0);
  });
});

// Guards the seam rather than the implementation: a real `ChatClient` must
// stay assignable to `ReconnectTarget` with no adapter, which is the whole
// reason this package still has no @dhaam-ccrm/core dependency.
describe('ReconnectTarget', () => {
  it('is satisfied structurally by a ChatClient-shaped object', () => {
    const client = {
      getState: () => ({ connectionState: 'reconnecting', messages: [] }),
      subscribe: (_listener: () => void) => () => undefined,
      retryNow: () => true,
      // Everything else a real ChatClient carries.
      connect: async () => undefined,
      disconnect: vi.fn(),
    };
    const target: ReconnectTarget = client;
    expect(target.retryNow()).toBe(true);
  });
});

// Type-only: `NetworkStatus` must plug into useSyncExternalStore unchanged.
const _networkStatusShape: NetworkStatus = createNetworkStatus();
_networkStatusShape.destroy();
