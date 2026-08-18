import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore } from '../state/index.js';
import type { OutboundIntent } from './intents.js';
import { ManualTimers } from './manual-timers.js';
import {
  DEFAULT_REMOTE_TYPING_TIMEOUT_MS,
  DEFAULT_TYPING_IDLE_MS,
  DEFAULT_TYPING_START_INTERVAL_MS,
  TypingController,
  assertTypingTimings,
} from './typing.js';
import type { TypingTimings } from './typing.js';

interface Harness {
  readonly store: ChatStore;
  readonly timers: ManualTimers;
  readonly intents: OutboundIntent[];
  readonly typing: TypingController;
}

function harness(overrides: { localParticipantId?: string } = {}): Harness {
  const store = new ChatStore();
  const timers = new ManualTimers();
  const intents: OutboundIntent[] = [];

  const typing = new TypingController({
    store,
    emitIntent: (intent) => intents.push(intent),
    schedule: timers.schedule,
    clock: timers.clock,
    ...overrides,
  });

  return { store, timers, intents, typing };
}

/** `subscribe` is microtask-batched (§6.4), so state assertions await a tick. */
const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()));

describe('TypingController — inbound', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('applies typing.start to ChatState.typing', async () => {
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-1' });
  });

  it('clears ChatState.typing on typing.stop', async () => {
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStop({ participantId: 'agent-1' });
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });

  it('omits participantId entirely when nobody is typing (exactOptionalPropertyTypes)', async () => {
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStop({ participantId: 'agent-1' });
    await flush();

    expect('participantId' in h.store.getState().typing).toBe(false);
  });

  it('emits the §6.5 typing event on start and stop', () => {
    const events: unknown[] = [];
    h.store.on('typing', (payload) => events.push(payload));

    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStop({ participantId: 'agent-1' });

    expect(events).toEqual([
      { isTyping: true, participantId: 'agent-1' },
      { isTyping: false, participantId: 'agent-1' },
    ]);
  });

  it('ignores an inbound frame carrying no participantId', async () => {
    h.typing.applyTypingStart({});
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });

  it('ignores our own typing echoed back by the server', async () => {
    const self = harness({ localParticipantId: 'customer-1' });
    self.typing.applyTypingStart({ participantId: 'customer-1' });
    await flush();

    expect(self.store.getState().typing).toEqual({ isTyping: false });
  });

  it('ignores a stop for someone who was not typing, emitting no event', () => {
    const events: unknown[] = [];
    h.store.on('typing', (payload) => events.push(payload));

    h.typing.applyTypingStop({ participantId: 'agent-1' });

    expect(events).toEqual([]);
  });
});

describe('TypingController — auto-clear when stop never arrives (§12.4)', () => {
  it('clears the indicator after the timeout when no typing.stop arrives', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    await flush();
    expect(h.store.getState().typing.isTyping).toBe(true);

    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS);
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });

  it('emits a stop event when the auto-clear fires, indistinguishable from a real stop', () => {
    const h = harness();
    const events: unknown[] = [];
    h.store.on('typing', (payload) => events.push(payload));

    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS);

    expect(events).toEqual([
      { isTyping: true, participantId: 'agent-1' },
      { isTyping: false, participantId: 'agent-1' },
    ]);
  });

  it('does not clear early', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });

    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS - 1);
    await flush();

    expect(h.store.getState().typing.isTyping).toBe(true);
  });

  it('a keepalive typing.start re-arms the timeout instead of stacking a second one', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });

    // Refresh just before expiry, repeatedly — the indicator must stay up.
    for (let i = 0; i < 5; i += 1) {
      h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS - 1);
      h.typing.applyTypingStart({ participantId: 'agent-1' });
    }
    await flush();
    expect(h.store.getState().typing.isTyping).toBe(true);
    expect(h.timers.pendingCount).toBe(1);

    // ...and still clears once the refreshes stop.
    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS);
    await flush();
    expect(h.store.getState().typing.isTyping).toBe(false);
  });

  it('emits no duplicate event when a real stop beats the auto-clear', () => {
    const h = harness();
    const events: unknown[] = [];
    h.store.on('typing', (payload) => events.push(payload));

    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStop({ participantId: 'agent-1' });
    h.timers.advance(DEFAULT_REMOTE_TYPING_TIMEOUT_MS * 10);

    expect(events.filter((e) => (e as { isTyping: boolean }).isTyping === false)).toHaveLength(1);
  });

  it('times out each typer independently in a multi-agent session (§12.9)', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.timers.advance(2_000);
    h.typing.applyTypingStart({ participantId: 'agent-2' });

    // agent-1 expires at t=5000, agent-2 at t=7000.
    h.timers.advance(3_100);
    await flush();
    expect(h.typing.remoteTypers).toEqual(['agent-2']);
    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-2' });

    h.timers.advance(2_000);
    await flush();
    expect(h.store.getState().typing).toEqual({ isTyping: false });
  });
});

describe('TypingController — multi-typer projection onto the single §6.4 slot', () => {
  it('surfaces the most recently started typer', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStart({ participantId: 'agent-2' });
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-2' });
  });

  it('keeps the indicator up for the remaining typer when one of two stops', async () => {
    // The concrete bug a single-slot implementation has: A starts, B starts,
    // A stops, and the indicator wrongly clears while B is still typing.
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStart({ participantId: 'agent-2' });
    h.typing.applyTypingStop({ participantId: 'agent-1' });
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-2' });
  });

  it('promotes a re-starting typer to most-recent', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStart({ participantId: 'agent-2' });
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    await flush();

    expect(h.typing.remoteTypers).toEqual(['agent-2', 'agent-1']);
    expect(h.store.getState().typing).toEqual({ isTyping: true, participantId: 'agent-1' });
  });

  it('does not notify subscribers on a keepalive refresh that changes nothing', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    await flush();

    const listener = vi.fn();
    h.store.subscribe(listener);

    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('TypingController — outbound throttle', () => {
  it('emits typing.start immediately on the first call (leading edge)', () => {
    const h = harness();
    h.typing.startTyping();

    expect(h.intents).toEqual([{ t: 'typing.start', d: {} }]);
  });

  it('emits far fewer frames than calls when typing continuously', () => {
    const h = harness();

    // 200 keystrokes at 25ms apart — 5 seconds of continuous typing.
    for (let i = 0; i < 200; i += 1) {
      h.typing.startTyping();
      h.timers.advance(25);
    }

    const starts = h.intents.filter((intent) => intent.t === 'typing.start');
    // One leading-edge start plus one refresh per 3s window — single digits,
    // not 200.
    expect(starts.length).toBeLessThanOrEqual(3);
    expect(h.intents.length).toBeLessThan(10);
  });

  it('suppresses every start within the refresh interval', () => {
    const h = harness();
    h.typing.startTyping();
    h.timers.advance(DEFAULT_TYPING_START_INTERVAL_MS - 1);
    h.typing.startTyping();

    expect(h.intents.filter((i) => i.t === 'typing.start')).toHaveLength(1);
  });

  it('emits a refresh start once the interval has elapsed', () => {
    const h = harness();
    h.typing.startTyping();
    h.timers.advance(DEFAULT_TYPING_START_INTERVAL_MS);
    h.typing.startTyping();

    expect(h.intents.filter((i) => i.t === 'typing.start')).toHaveLength(2);
  });

  it('auto-emits typing.stop after the idle window with no further calls', () => {
    const h = harness();
    h.typing.startTyping();
    h.timers.advance(DEFAULT_TYPING_IDLE_MS);

    expect(h.intents).toEqual([
      { t: 'typing.start', d: {} },
      { t: 'typing.stop', d: {} },
    ]);
    expect(h.typing.isSendingTyping).toBe(false);
  });

  it('re-arms the idle timer on a suppressed call, so typing does not auto-stop mid-flow', () => {
    const h = harness();
    h.typing.startTyping();

    // Keystrokes inside the refresh window: each emits nothing but must push
    // the idle deadline out.
    for (let i = 0; i < 10; i += 1) {
      h.timers.advance(DEFAULT_TYPING_IDLE_MS - 100);
      h.typing.startTyping();
    }

    expect(h.intents.filter((i) => i.t === 'typing.stop')).toHaveLength(0);
    expect(h.typing.isSendingTyping).toBe(true);
  });

  it('emits typing.stop explicitly and cancels the pending idle timer', () => {
    const h = harness();
    h.typing.startTyping();
    h.typing.stopTyping();
    h.timers.advance(DEFAULT_TYPING_IDLE_MS * 10);

    expect(h.intents).toEqual([
      { t: 'typing.start', d: {} },
      { t: 'typing.stop', d: {} },
    ]);
  });

  it('ignores stopTyping when not currently typing', () => {
    const h = harness();
    h.typing.stopTyping();
    h.typing.startTyping();
    h.typing.stopTyping();
    h.typing.stopTyping();

    expect(h.intents.filter((i) => i.t === 'typing.stop')).toHaveLength(1);
  });

  it('emits a fresh leading-edge start after a stop, regardless of the interval', () => {
    const h = harness();
    h.typing.startTyping();
    h.typing.stopTyping();
    h.typing.startTyping();

    expect(h.intents).toEqual([
      { t: 'typing.start', d: {} },
      { t: 'typing.stop', d: {} },
      { t: 'typing.start', d: {} },
    ]);
  });

  it('omits participantId on outbound frames — the server knows the sender (§7.3)', () => {
    const h = harness();
    h.typing.startTyping();

    expect(h.intents[0]?.d).toEqual({});
  });
});

describe('TypingController — timing validation', () => {
  it('accepts the defaults', () => {
    expect(() =>
      assertTypingTimings({
        remoteTypingTimeoutMs: DEFAULT_REMOTE_TYPING_TIMEOUT_MS,
        startIntervalMs: DEFAULT_TYPING_START_INTERVAL_MS,
        idleMs: DEFAULT_TYPING_IDLE_MS,
      }),
    ).not.toThrow();
  });

  /** Builds a controller with only the timings varied, so the throw is the timings'. */
  const withTimings = (timings: Partial<TypingTimings>): (() => TypingController) => {
    return () =>
      new TypingController({
        store: new ChatStore(),
        emitIntent: () => {},
        ...timings,
      });
  };

  it('rejects a refresh interval that would let the receiver time out mid-typing', () => {
    expect(withTimings({ startIntervalMs: 5_000, remoteTypingTimeoutMs: 5_000 })).toThrow(RangeError);
  });

  it('rejects an idle window at or beyond the receiver timeout', () => {
    expect(withTimings({ idleMs: 6_000, remoteTypingTimeoutMs: 5_000 })).toThrow(RangeError);
  });

  it('rejects non-positive timings', () => {
    expect(withTimings({ idleMs: 0 })).toThrow(RangeError);
    expect(withTimings({ startIntervalMs: -1 })).toThrow(RangeError);
    expect(withTimings({ remoteTypingTimeoutMs: 0 })).toThrow(RangeError);
  });

  it('exposes the resolved timings', () => {
    const h = harness();
    expect(h.typing.timings).toEqual({
      remoteTypingTimeoutMs: DEFAULT_REMOTE_TYPING_TIMEOUT_MS,
      startIntervalMs: DEFAULT_TYPING_START_INTERVAL_MS,
      idleMs: DEFAULT_TYPING_IDLE_MS,
    });
  });

  it('honours custom timings end to end', () => {
    const store = new ChatStore();
    const timers = new ManualTimers();
    const intents: OutboundIntent[] = [];
    const typing = new TypingController({
      store,
      emitIntent: (intent) => intents.push(intent),
      schedule: timers.schedule,
      clock: timers.clock,
      remoteTypingTimeoutMs: 1_000,
      startIntervalMs: 400,
      idleMs: 200,
    });

    typing.startTyping();
    timers.advance(200);
    expect(intents).toEqual([
      { t: 'typing.start', d: {} },
      { t: 'typing.stop', d: {} },
    ]);
  });
});

describe('TypingController — dispose', () => {
  it('clears typing state and cancels every pending timer', async () => {
    const h = harness();
    h.typing.applyTypingStart({ participantId: 'agent-1' });
    h.typing.applyTypingStart({ participantId: 'agent-2' });
    h.typing.startTyping();

    h.typing.dispose();
    await flush();

    expect(h.store.getState().typing).toEqual({ isTyping: false });
    expect(h.timers.pendingCount).toBe(0);
    expect(h.typing.isSendingTyping).toBe(false);
  });

  it('emits no further intents after disposal', () => {
    const h = harness();
    h.typing.startTyping();
    const countAtDispose = h.intents.length;

    h.typing.dispose();
    h.timers.advance(60_000);

    expect(h.intents).toHaveLength(countAtDispose);
  });
});
