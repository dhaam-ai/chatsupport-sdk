import { describe, expect, it } from 'vitest';

import { ManualTimers } from '../presence/index.js';
import type { VisitorContext } from '../protocol/index.js';
import { PageContextSync } from './page-context-sync.js';

function harness(opts: { connected?: boolean; maxPerMinute?: number } = {}) {
  const timers = new ManualTimers();
  const sent: VisitorContext[] = [];
  let connected = opts.connected ?? true;
  const sync = new PageContextSync({
    isConnected: () => connected,
    send: (context) => sent.push(context),
    schedule: timers.schedule,
    clock: timers.clock,
    ...(opts.maxPerMinute === undefined ? {} : { maxPerMinute: opts.maxPerMinute }),
  });
  return {
    sync,
    timers,
    sent,
    setConnected: (value: boolean) => {
      connected = value;
    },
  };
}

describe('set()', () => {
  it('ignores anything that is not an object and reports it', () => {
    const h = harness();
    expect(h.sync.set('checkout')).toBe(false);
    expect(h.sync.set(null)).toBe(false);
    h.timers.advance(5_000);
    expect(h.sent).toEqual([]);
  });

  it('sends one context.update after a short quiet period, not immediately', () => {
    const h = harness();
    h.sync.set({ label: 'checkout', url: '/checkout' });
    expect(h.sent).toEqual([]);
    h.timers.advance(600);
    expect(h.sent).toEqual([{ label: 'checkout', url: '/checkout' }]);
  });

  it('coalesces a burst into the latest value', () => {
    const h = harness();
    h.sync.set({ label: 'cart' });
    h.timers.advance(100);
    h.sync.set({ label: 'checkout' });
    h.timers.advance(100);
    h.sync.set({ label: 'payment' });
    h.timers.advance(1_000);
    expect(h.sent).toEqual([{ label: 'payment' }]);
  });

  it('sends nothing when the content did not change, whatever the key order', () => {
    const h = harness();
    h.sync.set({ label: 'cart', attributes: { a: 1, b: 2 } });
    h.timers.advance(1_000);
    h.sync.set({ attributes: { b: 2, a: 1 }, label: 'cart' });
    h.timers.advance(1_000);
    expect(h.sent).toHaveLength(1);
  });

  it('drops a field the server would reject and still sends the rest', () => {
    const h = harness();
    h.sync.set({ label: 'Not A Label!', url: '/cart' });
    h.timers.advance(1_000);
    expect(h.sent).toEqual([{ url: '/cart' }]);
  });

  it('sends an empty context to clear the stored one', () => {
    const h = harness();
    h.sync.set({ label: 'cart' });
    h.timers.advance(1_000);
    h.sync.set({});
    h.timers.advance(1_000);
    expect(h.sent).toEqual([{ label: 'cart' }, {}]);
  });
});

describe('while not connected', () => {
  it('sends nothing, and lets the next hello carry the latest context', () => {
    const h = harness({ connected: false });
    h.sync.set({ label: 'cart' });
    h.sync.set({ label: 'checkout' });
    h.timers.advance(5_000);
    expect(h.sent).toEqual([]);
    expect(h.sync.forHello()).toEqual({ label: 'checkout' });
  });

  it('does not repeat in an update what the hello already carried', () => {
    const h = harness({ connected: false });
    h.sync.set({ label: 'cart' });
    expect(h.sync.forHello()).toEqual({ label: 'cart' });
    h.setConnected(true);
    h.sync.set({ label: 'cart' });
    h.timers.advance(5_000);
    expect(h.sent).toEqual([]);
  });

  it('a change made after the hello was built is sent as soon as the client flushes on connect', () => {
    const h = harness({ connected: false });
    h.sync.set({ label: 'cart' });
    h.sync.forHello();
    h.sync.set({ label: 'checkout' }); // not connected: only latched
    h.timers.advance(1_000);
    expect(h.sent).toEqual([]);

    h.setConnected(true);
    expect(h.sync.flush()).toBe(true);
    expect(h.sent).toEqual([{ label: 'checkout' }]);
    expect(h.sync.flush()).toBe(false); // nothing left to send
  });

  it('a socket that drops before the quiet period ends sends nothing', () => {
    const h = harness();
    h.sync.set({ label: 'cart' });
    h.setConnected(false);
    h.timers.advance(1_000);
    expect(h.sent).toEqual([]);
  });
});

describe('forHello()', () => {
  it('is undefined until something usable was set, and for an empty context', () => {
    const h = harness();
    expect(h.sync.forHello()).toBeUndefined();
    h.sync.set({});
    expect(h.sync.forHello()).toBeUndefined();
  });
});

describe('the rate cap', () => {
  it('holds the newest update back once the minute is used up, then sends it', () => {
    const h = harness({ maxPerMinute: 3 });
    for (const label of ['a', 'b', 'c']) {
      h.sync.set({ label });
      h.timers.advance(600);
    }
    expect(h.sent.map((c) => c.label)).toEqual(['a', 'b', 'c']);

    h.sync.set({ label: 'd' });
    h.timers.advance(600);
    expect(h.sent.map((c) => c.label)).toEqual(['a', 'b', 'c']); // over the cap: held

    h.sync.set({ label: 'e' });
    h.timers.advance(61_000);
    expect(h.sent.map((c) => c.label)).toEqual(['a', 'b', 'c', 'e']); // only the latest goes out
  });
});

describe('destroy()', () => {
  it('cancels a pending update', () => {
    const h = harness();
    h.sync.set({ label: 'cart' });
    h.sync.destroy();
    h.timers.advance(5_000);
    expect(h.sent).toEqual([]);
  });
});
