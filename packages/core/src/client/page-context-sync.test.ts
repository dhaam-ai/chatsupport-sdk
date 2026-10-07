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

describe('the visitor\'s time zone', () => {
  const zoned = (zone: string | undefined, opts: { connected?: boolean } = {}) => {
    const timers = new ManualTimers();
    const sent: VisitorContext[] = [];
    const sync = new PageContextSync({
      isConnected: () => opts.connected ?? true,
      send: (context) => sent.push(context),
      schedule: timers.schedule,
      clock: timers.clock,
      timeZone: () => zone,
    });
    return { sync, timers, sent };
  };

  it('rides every context the host sets, in the hello and in each update', () => {
    const h = zoned('Asia/Kolkata', { connected: false });
    h.sync.set({ label: 'checkout', url: '/checkout', attributes: { currency: 'inr' } });
    expect(h.sync.forHello()).toEqual({ label: 'checkout', url: '/checkout', attributes: { currency: 'INR', timezone: 'Asia/Kolkata' } });
    const u = zoned('Europe/London');
    u.sync.set({ label: 'cart' });
    u.timers.advance(5_000);
    expect(u.sent).toEqual([{ label: 'cart', attributes: { timezone: 'Europe/London' } }]);
  });

  it('the hello says it even when the host set no context at all; and an empty set() still keeps it', () => {
    expect(zoned('Asia/Kolkata').sync.forHello()).toEqual({ attributes: { timezone: 'Asia/Kolkata' } });
    const h = zoned('Asia/Kolkata');
    h.sync.set({});
    h.timers.advance(5_000);
    expect(h.sent).toEqual([{ attributes: { timezone: 'Asia/Kolkata' } }]);
  });

  it('a host\'s own timezone wins, and no zone to give adds nothing', () => {
    const h = zoned('Asia/Kolkata', { connected: false });
    h.sync.set({ attributes: { timezone: 'America/New_York' } });
    expect(h.sync.forHello()).toEqual({ attributes: { timezone: 'America/New_York' } });
    expect(zoned(undefined).sync.forHello()).toBeUndefined();
  });

  it('is off unless asked for: a sync built without it sends exactly what it was given', () => {
    const h = harness({ connected: false });
    expect(h.sync.forHello()).toBeUndefined();
    h.sync.set({ label: 'cart' });
    expect(h.sync.forHello()).toEqual({ label: 'cart' });
  });
});

describe('the visitor\'s position (the browser\'s GPS fix)', () => {
  const positioned = (opts: { connected?: boolean } = {}) => {
    const timers = new ManualTimers();
    const sent: VisitorContext[] = [];
    let fix: { lat: number; lng: number } | undefined;
    const sync = new PageContextSync({
      isConnected: () => opts.connected ?? true,
      send: (context) => sent.push(context),
      schedule: timers.schedule,
      clock: timers.clock,
      location: () => fix,
    });
    return { sync, timers, sent, locate: (value: { lat: number; lng: number } | undefined) => { fix = value; } };
  };

  it('rides the hello and every update once the visitor has allowed it, held to three decimals', () => {
    const h = positioned({ connected: false });
    h.locate({ lat: 17.408084, lng: 78.491033 });
    h.sync.set({ label: 'cart' });
    expect(h.sync.forHello()).toEqual({ label: 'cart', location: { lat: 17.408, lng: 78.491 } });
  });

  it('arrives after the page\'s context was set: a connected chat learns it with one context.update', () => {
    const h = positioned();
    h.sync.set({ label: 'cart' });
    h.timers.advance(1_000);
    expect(h.sent).toEqual([{ label: 'cart' }]);
    h.locate({ lat: 17.408084, lng: 78.491033 });
    h.sync.refresh();
    h.timers.advance(1_000);
    expect(h.sent).toEqual([{ label: 'cart' }, { label: 'cart', location: { lat: 17.408, lng: 78.491 } }]);
  });

  it('a move too small to matter (inside the three decimals) is not a new context; a real one is', () => {
    const h = positioned();
    h.locate({ lat: 17.40801, lng: 78.49101 });
    h.sync.set({ label: 'cart' });
    h.timers.advance(1_000);
    h.locate({ lat: 17.40804, lng: 78.49104 });
    h.sync.refresh();
    h.timers.advance(1_000);
    expect(h.sent).toHaveLength(1);
    h.locate({ lat: 17.42, lng: 78.5 });
    h.sync.refresh();
    h.timers.advance(1_000);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toEqual({ label: 'cart', location: { lat: 17.42, lng: 78.5 } });
  });

  it('works when the host set no context at all (a bare hello still says where)', () => {
    const h = positioned({ connected: false });
    h.locate({ lat: 12.97, lng: 77.59 });
    expect(h.sync.forHello()).toEqual({ location: { lat: 12.97, lng: 77.59 } });
  });

  it('a host\'s own position wins, and a fix that is out of range adds nothing', () => {
    const own = positioned({ connected: false });
    own.locate({ lat: 1, lng: 2 });
    own.sync.set({ location: { lat: 40.7128, lng: -74.006 } });
    expect(own.sync.forHello()).toEqual({ location: { lat: 40.713, lng: -74.006 } });
    const bad = positioned({ connected: false });
    bad.locate({ lat: 91, lng: 2 });
    bad.sync.set({ label: 'cart' });
    expect(bad.sync.forHello()).toEqual({ label: 'cart' });
  });

  it('refresh() with nothing to say is a no-op: no frame, no context invented', () => {
    const h = positioned();
    h.sync.refresh();
    h.timers.advance(5_000);
    expect(h.sent).toEqual([]);
  });

  it('is off unless asked for: a sync built without a position never sends one', () => {
    const h = harness({ connected: false });
    h.sync.refresh();
    h.sync.set({ label: 'cart', location: { lat: 1, lng: 2 } });
    // (a host that sets its own position still has it normalised through)
    expect(h.sync.forHello()).toEqual({ label: 'cart', location: { lat: 1, lng: 2 } });
  });
});
