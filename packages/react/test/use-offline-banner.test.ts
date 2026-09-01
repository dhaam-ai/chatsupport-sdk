// @vitest-environment jsdom
//
// The React binding's half of the offline story.
//
// The DECISION — show it? which tone? what sentence? — belongs to
// `resolveOfflineBanner` in @dhaam-ccrm/browser and is tested there against
// every combination of its four inputs. Restating that here would be a second
// copy of the same table, drifting the first time either was edited.
//
// So this file tests only what React adds, which is the part that can be wrong
// in ways the pure function cannot be:
//
//   the platform's `online`/`offline` events reaching a component at all
//   (`useSyncExternalStore` over a listener source, and the SSR snapshot);
//
//   `failedAttempts`, which no state snapshot carries — it is counted from
//   core's `reconnecting` event and reset by `connected`, and getting the
//   reset wrong is what pins a banner up forever after one bad minute;
//
//   the reconnect cadence being started, stopped on unmount, and driven off
//   the `online` event rather than only off its timer;
//
//   and that none of the above leaks a listener or a timer past unmount.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, MessageDelivery } from '@dhaam-ccrm/core';

import { ChatProvider } from '../src/context.js';
import { OfflineBanner } from '../src/offline-banner.js';
import { useNetworkStatus, useOfflineBanner } from '../src/use-offline-banner.js';
import { createFakeChatClient } from './fake-chat-client.js';
import type { FakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** What the browser does: flip the flag, then fire the event. */
function goOffline(): void {
  setOnLine(false);
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
}

function goOnline(): void {
  setOnLine(true);
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}

beforeEach(() => {
  setOnLine(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// useNetworkStatus
// ---------------------------------------------------------------------------

describe('useNetworkStatus', () => {
  it('re-renders on the browser’s own connectivity events', () => {
    const client = createFakeChatClient();

    function View() {
      return h('div', { 'data-testid': 'online' }, String(useNetworkStatus()));
    }

    render(h(ChatProvider, { client }, h(View)));
    expect(screen.getByTestId('online').textContent).toBe('true');

    goOffline();
    expect(screen.getByTestId('online').textContent).toBe('false');

    goOnline();
    expect(screen.getByTestId('online').textContent).toBe('true');
  });

  it('drops its window listeners on unmount', () => {
    const client = createFakeChatClient();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    function View() {
      return h('div', null, String(useNetworkStatus()));
    }

    const view = render(h(ChatProvider, { client }, h(View)));
    const added = add.mock.calls.filter(([type]) => type === 'online' || type === 'offline').length;
    expect(added).toBeGreaterThan(0);

    view.unmount();

    const removed = remove.mock.calls.filter(([type]) => type === 'online' || type === 'offline').length;
    expect(removed).toBe(added);

    add.mockRestore();
    remove.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// useOfflineBanner
// ---------------------------------------------------------------------------

function BannerProbe() {
  const { banner, online, queuedCount, failedAttempts } = useOfflineBanner();
  return h(
    'div',
    null,
    h('div', { 'data-testid': 'message' }, banner?.message ?? ''),
    h('div', { 'data-testid': 'tone' }, banner?.tone ?? ''),
    h('div', { 'data-testid': 'online' }, String(online)),
    h('div', { 'data-testid': 'queued' }, String(queuedCount)),
    h('div', { 'data-testid': 'failed' }, String(failedAttempts)),
  );
}

const read = (id: string): string => screen.getByTestId(id).textContent ?? '';

/** One customer-sent message in a given delivery state. */
function outgoing(id: string, content: string, delivery: MessageDelivery): ChatMessage {
  return {
    id,
    sessionId: 'sess_1',
    senderId: 'cus_1',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content,
    createdAt: '2026-09-01T00:00:00.000Z',
    delivery,
  };
}

function mountProbe(client: FakeChatClient) {
  return render(h(ChatProvider, { client }, h(BannerProbe)));
}

describe('useOfflineBanner', () => {
  it('says nothing on a healthy connection', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    mountProbe(client);
    expect(read('message')).toBe('');
  });

  it('speaks the moment the platform reports no network', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    mountProbe(client);

    goOffline();

    expect(read('tone')).toBe('offline');
    expect(read('message')).toBe('You’re offline. Messages will send when you’re back online.');
  });

  it('counts the messages waiting on the connection', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    mountProbe(client);
    goOffline();

    act(() => {
      client.emitState({
        messages: [
          outgoing('m1', 'first', { state: 'queued' }),
          outgoing('m2', 'second', { state: 'queued' }),
          // Failed is NOT waiting on the network — it needs retryMessage(),
          // and counting it here would promise a delivery that is not coming.
          outgoing('m3', 'dead', { state: 'failed', reason: 'rejected', retryable: false }),
        ],
      });
    });

    expect(read('queued')).toBe('2');
    expect(read('message')).toBe('You’re offline. 2 messages will send when you’re back online.');
  });

  it('counts failed attempts from `reconnecting`, and resets them on `connected`', () => {
    const client = createFakeChatClient({ connectionState: 'connecting' });
    mountProbe(client);

    // One failure is a blip. Two is an outage — and neither number is in any
    // state snapshot, which is the whole reason this is tracked here.
    act(() => {
      client.emitState({ connectionState: 'reconnecting' });
      client.emitEvent('reconnecting', { attempt: 0, delayMs: 500 });
    });
    expect(read('failed')).toBe('1');
    expect(read('message')).toBe('');

    act(() => {
      client.emitEvent('reconnecting', { attempt: 1, delayMs: 1000 });
    });
    expect(read('failed')).toBe('2');
    expect(read('tone')).toBe('unreachable');
    expect(read('message')).toBe('Can’t reach chat — still trying.');

    // A completed handshake is the only proof the run is over. Without this
    // reset the bar stays up forever after one bad minute.
    act(() => {
      client.emitState({ connectionState: 'connected' });
    });
    expect(read('failed')).toBe('0');
    expect(read('message')).toBe('');
  });

  it('exposes retryNow, delegating straight to the client', () => {
    const client = createFakeChatClient({ connectionState: 'reconnecting' });

    function View() {
      const { retryNow } = useOfflineBanner({ retry: false });
      return h('button', { onClick: () => retryNow() }, 'try again');
    }

    render(h(ChatProvider, { client }, h(View)));
    fireEvent.click(screen.getByText('try again'));

    expect(client.retryNow).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The reconnect cadence
// ---------------------------------------------------------------------------

describe('the reconnect cadence', () => {
  it('retries the moment the network comes back, without waiting out the interval', () => {
    vi.useFakeTimers();
    const client = createFakeChatClient({ connectionState: 'reconnecting' });
    mountProbe(client);

    goOffline();
    expect(client.retryNow).not.toHaveBeenCalled();

    goOnline();
    expect(client.retryNow).toHaveBeenCalledTimes(1);
  });

  it('caps an armed backoff at three seconds', () => {
    vi.useFakeTimers();
    const client = createFakeChatClient({ connectionState: 'connected' });
    mountProbe(client);

    // Armed only while a backoff is counting down, so a healthy connection
    // has no periodic work at all.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(client.retryNow).not.toHaveBeenCalled();

    act(() => {
      client.emitState({ connectionState: 'reconnecting' });
    });
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(client.retryNow).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(client.retryNow).toHaveBeenCalledTimes(1);
  });

  it('does not run at all when the host opts out', () => {
    vi.useFakeTimers();
    const client = createFakeChatClient({ connectionState: 'reconnecting' });

    function View() {
      useOfflineBanner({ retry: false });
      return h('div', null, 'x');
    }
    render(h(ChatProvider, { client }, h(View)));

    goOnline();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(client.retryNow).not.toHaveBeenCalled();
  });

  it('stops on unmount — no timer and no listener outlive the component', () => {
    vi.useFakeTimers();
    const client = createFakeChatClient({ connectionState: 'reconnecting' });
    const view = mountProbe(client);

    view.unmount();

    goOnline();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(client.retryNow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// <OfflineBanner />
// ---------------------------------------------------------------------------

describe('<OfflineBanner />', () => {
  it('renders nothing when there is nothing to say', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    const view = render(h(ChatProvider, { client }, h(OfflineBanner)));
    expect(view.container.textContent).toBe('');
  });

  it('renders the sentence politely, with the tone as an attribute', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    render(h(ChatProvider, { client }, h(OfflineBanner)));

    goOffline();

    const bar = screen.getByRole('status');
    expect(bar.textContent).toBe('You’re offline. Messages will send when you’re back online.');
    // Polite, not an alert: an alert interrupts a screen reader mid-message.
    expect(bar.getAttribute('aria-live')).toBe('polite');
    expect(bar.getAttribute('data-tone')).toBe('offline');
  });

  it('merges a host’s style over the defaults rather than replacing them', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });
    render(
      h(ChatProvider, { client }, h(OfflineBanner, { style: { background: 'rgb(0, 0, 0)' }, className: 'mine' })),
    );

    goOffline();

    const bar = screen.getByRole('status');
    expect(bar.className).toBe('mine');
    expect(bar.style.background).toBe('rgb(0, 0, 0)');
    // The layout the override did not mention is still there.
    expect(bar.style.display).toBe('flex');
  });
});
