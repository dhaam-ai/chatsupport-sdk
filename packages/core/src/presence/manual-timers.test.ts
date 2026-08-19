import { describe, expect, it, vi } from 'vitest';
import { ManualTimers } from './manual-timers.js';
import { PRESENCE_INTENT_TYPES } from './intents.js';
import { CLIENT_TO_SERVER_FRAME_TYPES } from '../protocol/index.js';

describe('ManualTimers', () => {
  it('does not fire a timer before it is due', () => {
    const timers = new ManualTimers();
    const fired = vi.fn();

    timers.schedule(fired, 100);
    timers.advance(99);

    expect(fired).not.toHaveBeenCalled();
  });

  it('fires a timer exactly at its due time', () => {
    const timers = new ManualTimers();
    const fired = vi.fn();

    timers.schedule(fired, 100);
    timers.advance(100);

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('fires a one-shot timer only once, however far time advances', () => {
    const timers = new ManualTimers();
    const fired = vi.fn();

    timers.schedule(fired, 100);
    timers.advance(1_000_000);

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('fires due timers in due order, ties broken by scheduling order', () => {
    const timers = new ManualTimers();
    const order: string[] = [];

    timers.schedule(() => order.push('c'), 300);
    timers.schedule(() => order.push('a1'), 100);
    timers.schedule(() => order.push('a2'), 100);
    timers.schedule(() => order.push('b'), 200);

    timers.advance(500);

    expect(order).toEqual(['a1', 'a2', 'b', 'c']);
  });

  it('exposes the scheduled due time to the callback via the clock', () => {
    const timers = new ManualTimers();
    const seen: number[] = [];

    timers.schedule(() => seen.push(timers.clock()), 100);
    timers.schedule(() => seen.push(timers.clock()), 250);

    timers.advance(1000);

    // Not [1000, 1000] — each callback must observe its own due time, which is
    // what lets a timing-sensitive unit under test read `clock()` meaningfully.
    expect(seen).toEqual([100, 250]);
    expect(timers.clock()).toBe(1000);
  });

  it('starts the clock at a caller-supplied origin', () => {
    const timers = new ManualTimers(1_700_000_000_000);
    expect(timers.clock()).toBe(1_700_000_000_000);

    timers.advance(5);
    expect(timers.clock()).toBe(1_700_000_000_005);
  });

  it('does not fire a cancelled timer', () => {
    const timers = new ManualTimers();
    const fired = vi.fn();

    const cancel = timers.schedule(fired, 100);
    cancel();
    timers.advance(500);

    expect(fired).not.toHaveBeenCalled();
  });

  it('treats cancelling twice, or after firing, as a no-op', () => {
    const timers = new ManualTimers();
    const fired = vi.fn();

    const cancel = timers.schedule(fired, 100);
    timers.advance(100);

    expect(() => {
      cancel();
      cancel();
    }).not.toThrow();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('fires a timer re-armed from inside a callback within the same advance', () => {
    // The typing throttle re-arms its idle timer from inside a firing timer;
    // if the fake dropped that, the throttle tests would pass for wrong reasons.
    const timers = new ManualTimers();
    const fired = vi.fn();

    timers.schedule(() => {
      timers.schedule(fired, 50);
    }, 100);

    timers.advance(200);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(timers.clock()).toBe(200);
  });

  it('skips a timer cancelled from inside an earlier timer callback', () => {
    const timers = new ManualTimers();
    const second = vi.fn();

    const cancelSecond = timers.schedule(second, 200);
    timers.schedule(() => cancelSecond(), 100);

    timers.advance(500);

    expect(second).not.toHaveBeenCalled();
  });

  it('tracks how many timers are still pending', () => {
    const timers = new ManualTimers();

    const cancelA = timers.schedule(() => {}, 100);
    timers.schedule(() => {}, 200);
    expect(timers.pendingCount).toBe(2);

    cancelA();
    expect(timers.pendingCount).toBe(1);

    timers.advance(200);
    expect(timers.pendingCount).toBe(0);
  });
});

describe('PRESENCE_INTENT_TYPES', () => {
  it('names only real client→server frame types from the protocol catalog', () => {
    for (const type of PRESENCE_INTENT_TYPES) {
      expect(CLIENT_TO_SERVER_FRAME_TYPES).toContain(type);
    }
  });

  it('covers exactly the six §7.3 frames this module owns', () => {
    expect([...PRESENCE_INTENT_TYPES]).toEqual([
      'typing.start',
      'typing.stop',
      'message.markRead',
      'message.markDelivered',
      'presence.set',
      'presence.query',
    ]);
  });
});
