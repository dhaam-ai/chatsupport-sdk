import { describe, expect, it, vi } from 'vitest';

import { ManualTimers } from '../presence/manual-timers.js';
import { buildCloseInfo } from './close.js';
import { PendingAckRegistry } from './pending-acks.js';
import type { AckOutcome } from './pending-acks.js';
import { decodeFrame } from './decode.js';
import type { AckExtraData, AckFrame } from '../protocol/frames.js';

const ID_A = '01J0000000000000000000000A';
const ID_B = '01J0000000000000000000000B';
const ID_C = '01J0000000000000000000000C';

function makeRegistry(timeoutMs = 10_000): { registry: PendingAckRegistry; timers: ManualTimers } {
  const timers = new ManualTimers();
  return { registry: new PendingAckRegistry({ schedule: timers.schedule, timeoutMs }), timers };
}

/** Builds a real ack frame by round-tripping it through the decoder. */
function ackFrame(ref: string, d: Record<string, unknown>): AckFrame<AckExtraData> {
  const result = decodeFrame(JSON.stringify({ v: 1, t: 'ack', id: ID_C, ref, ts: 1, d }));
  if (!result.ok || result.frame.t !== 'ack') throw new Error('test fixture is not an ack');
  return result.frame;
}

const closeInfo = buildCloseInfo({
  code: 1006,
  reason: '',
  wasClean: false,
  cause: 'peer',
  protocolError: null,
});

/** Resolves once every already-queued microtask has run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PendingAckRegistry', () => {
  it('starts empty', () => {
    const { registry } = makeRegistry();

    expect(registry.size).toBe(0);
    expect(registry.has(ID_A)).toBe(false);
  });

  it('tracks a frame from the moment register returns', () => {
    const { registry } = makeRegistry();

    void registry.register(ID_A);

    expect(registry.size).toBe(1);
    expect(registry.has(ID_A)).toBe(true);
  });

  it('resolves with the ack frame, carrying its extra data', async () => {
    const { registry } = makeRegistry();
    const pending = registry.register(ID_A);
    const frame = ackFrame(ID_A, { ok: true, seq: 13 });

    expect(registry.settle(ID_A, { status: 'acked', frame })).toBe(true);

    await expect(pending).resolves.toEqual({ status: 'acked', frame });
    expect(registry.size).toBe(0);
  });

  it('resolves rejections rather than throwing them', async () => {
    const { registry } = makeRegistry();
    const pending = registry.register(ID_A);
    const error = { code: 'SESSION_CLOSED', message: 'closed', retryable: false } as const;

    registry.settle(ID_A, { status: 'rejected', error });

    // Rejecting would make an unawaited fire-and-forget send crash the host.
    await expect(pending).resolves.toEqual({ status: 'rejected', error });
  });

  it('settles the right frame when several are in flight', async () => {
    const { registry } = makeRegistry();
    const first = registry.register(ID_A);
    const second = registry.register(ID_B);

    registry.settle(ID_B, { status: 'acked', frame: ackFrame(ID_B, { ok: true }) });

    await expect(second).resolves.toMatchObject({ status: 'acked' });
    expect(registry.size).toBe(1);
    expect(registry.has(ID_A)).toBe(true);

    registry.settle(ID_A, { status: 'timeout' });
    await expect(first).resolves.toEqual({ status: 'timeout' });
  });

  describe('timeouts', () => {
    it('settles with timeout when nothing answers', async () => {
      const { registry, timers } = makeRegistry(10_000);
      const pending = registry.register(ID_A);

      timers.advance(9_999);
      expect(registry.size).toBe(1);

      timers.advance(1);

      await expect(pending).resolves.toEqual({ status: 'timeout' });
      expect(registry.size).toBe(0);
    });

    it('cancels the timeout once settled, so a fired timer cannot re-settle', async () => {
      const { registry, timers } = makeRegistry(10_000);
      const pending = registry.register(ID_A);

      registry.settle(ID_A, { status: 'acked', frame: ackFrame(ID_A, { ok: true }) });
      timers.advance(60_000);

      expect(timers.pendingCount).toBe(0);
      await expect(pending).resolves.toMatchObject({ status: 'acked' });
    });

    it('uses an injected scheduler, never a global timer', () => {
      const schedule = vi.fn((_callback: () => void, _delayMs: number): (() => void) => () => {});
      const registry = new PendingAckRegistry({ schedule, timeoutMs: 4_321 });

      void registry.register(ID_A);

      expect(schedule).toHaveBeenCalledOnce();
      expect(schedule.mock.calls[0]?.[1]).toBe(4_321);
    });
  });

  describe('settling on close', () => {
    // The headline guarantee: a promise must never outlive its socket.
    it('settles every outstanding frame', async () => {
      const { registry } = makeRegistry();
      const pending = [ID_A, ID_B, ID_C].map((id) => registry.register(id));

      expect(registry.settleAll({ status: 'disconnected', close: closeInfo })).toBe(3);

      const outcomes = await Promise.all(pending);
      expect(outcomes).toEqual([
        { status: 'disconnected', close: closeInfo },
        { status: 'disconnected', close: closeInfo },
        { status: 'disconnected', close: closeInfo },
      ]);
      expect(registry.size).toBe(0);
    });

    it('leaves no timer behind to fire after the close', async () => {
      const { registry, timers } = makeRegistry(10_000);
      const pending = registry.register(ID_A);

      registry.settleAll({ status: 'disconnected', close: closeInfo });
      timers.advance(120_000);

      expect(timers.pendingCount).toBe(0);
      // Still the close outcome, not the timeout the cancelled timer carried.
      await expect(pending).resolves.toEqual({ status: 'disconnected', close: closeInfo });
    });

    it('is a no-op on an empty registry', () => {
      const { registry } = makeRegistry();

      expect(registry.settleAll({ status: 'disconnected', close: closeInfo })).toBe(0);
    });

    it('survives a handler that re-registers while settling', async () => {
      const { registry } = makeRegistry();
      const first = registry.register(ID_A);

      // A caller re-queueing on disconnect is exactly what §8.4 describes.
      const requeued = first.then(() => registry.register(ID_B));
      registry.settleAll({ status: 'disconnected', close: closeInfo });
      await flush();

      expect(registry.has(ID_B)).toBe(true);
      registry.settle(ID_B, { status: 'timeout' });
      await expect(requeued).resolves.toEqual({ status: 'timeout' });
    });
  });

  describe('unmatched settles', () => {
    it('reports false for a ref that was never registered', () => {
      const { registry } = makeRegistry();

      expect(registry.settle(ID_A, { status: 'timeout' })).toBe(false);
    });

    it('reports false for a late ack arriving after its own timeout', async () => {
      const { registry, timers } = makeRegistry(1_000);
      const pending = registry.register(ID_A);

      timers.advance(1_000);
      await expect(pending).resolves.toEqual({ status: 'timeout' });

      expect(registry.settle(ID_A, { status: 'acked', frame: ackFrame(ID_A, { ok: true }) })).toBe(
        false,
      );
    });

    it('ignores a second settle of the same id', async () => {
      const { registry } = makeRegistry();
      const pending = registry.register(ID_A);

      registry.settle(ID_A, { status: 'timeout' });
      expect(registry.settle(ID_A, { status: 'rejected', error: { code: 'INTERNAL', message: 'x', retryable: true } })).toBe(false);

      await expect(pending).resolves.toEqual({ status: 'timeout' });
    });
  });

  // Unreachable with ULID keys, but a displaced entry must still settle —
  // dropping it silently is precisely the hang this registry exists to prevent.
  it('settles a displaced entry rather than orphaning it', async () => {
    const { registry } = makeRegistry();
    const first = registry.register(ID_A);
    const second = registry.register(ID_A);

    await expect(first).resolves.toEqual({ status: 'disconnected', close: null });
    expect(registry.size).toBe(1);

    registry.settle(ID_A, { status: 'timeout' });
    await expect(second).resolves.toEqual({ status: 'timeout' });
  });

  it('never leaves a promise unsettled across a full lifecycle', async () => {
    const { registry, timers } = makeRegistry(5_000);
    const settled: AckOutcome[] = [];

    const all = [ID_A, ID_B, ID_C].map((id) =>
      registry.register(id).then((outcome) => {
        settled.push(outcome);
        return outcome;
      }),
    );

    registry.settle(ID_A, { status: 'acked', frame: ackFrame(ID_A, { ok: true }) });
    timers.advance(5_000); // B and C would time out...
    registry.settleAll({ status: 'disconnected', close: closeInfo }); // ...and close finds none left

    await Promise.all(all);
    expect(settled).toHaveLength(3);
  });
});
