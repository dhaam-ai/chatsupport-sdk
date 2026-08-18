import { describe, expect, it, vi } from 'vitest';

import { ManualTimers } from '../presence/manual-timers.js';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  HeartbeatMonitor,
} from './heartbeat.js';

interface Harness {
  readonly monitor: HeartbeatMonitor;
  readonly timers: ManualTimers;
  readonly sendHeartbeat: ReturnType<typeof vi.fn>;
  readonly onDeadPeer: ReturnType<typeof vi.fn>;
}

function harness(intervalMs = 25_000, timeoutMs = 10_000): Harness {
  const timers = new ManualTimers();
  const sendHeartbeat = vi.fn();
  const onDeadPeer = vi.fn();

  const monitor = new HeartbeatMonitor({
    schedule: timers.schedule,
    intervalMs,
    timeoutMs,
    sendHeartbeat,
    onDeadPeer,
  });

  return { monitor, timers, sendHeartbeat, onDeadPeer };
}

describe('HeartbeatMonitor', () => {
  it('defaults to v1s 25s cadence with a 10s pong grace period', () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(25_000);
    expect(DEFAULT_HEARTBEAT_TIMEOUT_MS).toBe(10_000);

    const timers = new ManualTimers();
    const sendHeartbeat = vi.fn();
    const monitor = new HeartbeatMonitor({
      schedule: timers.schedule,
      sendHeartbeat,
      onDeadPeer: vi.fn(),
    });

    monitor.start();
    timers.advance(24_999);
    expect(sendHeartbeat).not.toHaveBeenCalled();

    timers.advance(1);
    expect(sendHeartbeat).toHaveBeenCalledOnce();
  });

  it('is idle before start', () => {
    const { monitor, timers, sendHeartbeat } = harness();

    timers.advance(120_000);

    expect(monitor.isRunning).toBe(false);
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  // The connection has just proved itself live; an immediate heartbeat would
  // be pure noise.
  it('waits one full interval before the first heartbeat', () => {
    const { monitor, timers, sendHeartbeat } = harness();

    monitor.start();
    expect(sendHeartbeat).not.toHaveBeenCalled();
    expect(monitor.isRunning).toBe(true);

    timers.advance(25_000);
    expect(sendHeartbeat).toHaveBeenCalledOnce();
  });

  it('keeps beating while the peer keeps ponging', () => {
    const { monitor, timers, sendHeartbeat, onDeadPeer } = harness();
    monitor.start();

    for (let beat = 1; beat <= 5; beat += 1) {
      timers.advance(25_000);
      expect(sendHeartbeat).toHaveBeenCalledTimes(beat);
      expect(monitor.isAwaitingPong).toBe(true);

      timers.advance(1_000);
      monitor.notePong();
      expect(monitor.isAwaitingPong).toBe(false);
    }

    expect(onDeadPeer).not.toHaveBeenCalled();
  });

  it('restarts the interval from the pong, not from the heartbeat', () => {
    const { monitor, timers, sendHeartbeat } = harness();
    monitor.start();

    timers.advance(25_000); // beat 1
    timers.advance(5_000);
    monitor.notePong();

    timers.advance(24_999);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);

    timers.advance(1);
    expect(sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  describe('detecting a silent peer', () => {
    it('reports a dead peer when no pong arrives in time', () => {
      const { monitor, timers, sendHeartbeat, onDeadPeer } = harness();
      monitor.start();

      timers.advance(25_000);
      expect(sendHeartbeat).toHaveBeenCalledOnce();
      expect(onDeadPeer).not.toHaveBeenCalled();

      timers.advance(9_999);
      expect(onDeadPeer).not.toHaveBeenCalled();

      timers.advance(1);
      expect(onDeadPeer).toHaveBeenCalledOnce();
    });

    // A dead peer never delivers a close frame, so the whole point is to
    // stop believing the connection is live within a bounded window.
    it('detects within one interval plus one timeout of the last pong', () => {
      const { monitor, timers, onDeadPeer } = harness(25_000, 10_000);
      monitor.start();

      timers.advance(34_999);
      expect(onDeadPeer).not.toHaveBeenCalled();

      timers.advance(1);
      expect(onDeadPeer).toHaveBeenCalledOnce();
    });

    it('stops itself before reporting, leaving no timer live', () => {
      const timers = new ManualTimers();
      let runningInsideHandler: boolean | null = null;

      const monitor: HeartbeatMonitor = new HeartbeatMonitor({
        schedule: timers.schedule,
        intervalMs: 25_000,
        timeoutMs: 10_000,
        sendHeartbeat: () => {},
        onDeadPeer: () => {
          runningInsideHandler = monitor.isRunning;
        },
      });

      monitor.start();
      timers.advance(35_000);

      expect(runningInsideHandler).toBe(false);
      expect(timers.pendingCount).toBe(0);
    });

    it('reports a dead peer only once', () => {
      const { monitor, timers, onDeadPeer } = harness();
      monitor.start();

      timers.advance(35_000);
      timers.advance(300_000);

      expect(onDeadPeer).toHaveBeenCalledOnce();
    });

    it('does not fire when a pong lands on the deadline boundary', () => {
      const { monitor, timers, onDeadPeer } = harness();
      monitor.start();

      timers.advance(25_000);
      timers.advance(9_999);
      monitor.notePong();
      timers.advance(1);

      expect(onDeadPeer).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('cancels the pending heartbeat', () => {
      const { monitor, timers, sendHeartbeat } = harness();
      monitor.start();

      monitor.stop();
      timers.advance(300_000);

      expect(sendHeartbeat).not.toHaveBeenCalled();
      expect(monitor.isRunning).toBe(false);
      expect(timers.pendingCount).toBe(0);
    });

    it('cancels a pending pong deadline', () => {
      const { monitor, timers, onDeadPeer } = harness();
      monitor.start();
      timers.advance(25_000);

      monitor.stop();
      timers.advance(300_000);

      expect(onDeadPeer).not.toHaveBeenCalled();
      expect(monitor.isAwaitingPong).toBe(false);
    });

    it('is safe to call when never started or twice over', () => {
      const { monitor } = harness();

      expect(() => {
        monitor.stop();
        monitor.stop();
      }).not.toThrow();
    });
  });

  describe('restart', () => {
    it('leaves exactly one timer outstanding', () => {
      const { monitor, timers, sendHeartbeat } = harness();

      monitor.start();
      monitor.start();
      monitor.start();

      expect(timers.pendingCount).toBe(1);
      timers.advance(25_000);
      expect(sendHeartbeat).toHaveBeenCalledOnce();
    });

    it('clears a pending pong deadline when restarted mid-flight', () => {
      const { monitor, timers, onDeadPeer, sendHeartbeat } = harness();
      monitor.start();
      timers.advance(25_000);
      expect(monitor.isAwaitingPong).toBe(true);

      monitor.start();

      expect(monitor.isAwaitingPong).toBe(false);
      timers.advance(25_000);
      expect(onDeadPeer).not.toHaveBeenCalled();
      expect(sendHeartbeat).toHaveBeenCalledTimes(2);
    });
  });

  describe('notePong outside a heartbeat window', () => {
    it('ignores a pong before any heartbeat was sent', () => {
      const { monitor, timers, sendHeartbeat } = harness();
      monitor.start();

      monitor.notePong();
      timers.advance(24_999);

      // The interval was not restarted by the unsolicited pong.
      expect(sendHeartbeat).not.toHaveBeenCalled();
      timers.advance(1);
      expect(sendHeartbeat).toHaveBeenCalledOnce();
    });

    // Otherwise a peer that streams pongs could postpone its deadline forever
    // while never actually answering a heartbeat.
    it('ignores extra pongs after the first', () => {
      const { monitor, timers, sendHeartbeat } = harness();
      monitor.start();
      timers.advance(25_000);

      monitor.notePong();
      monitor.notePong();
      monitor.notePong();

      expect(timers.pendingCount).toBe(1);
      timers.advance(25_000);
      expect(sendHeartbeat).toHaveBeenCalledTimes(2);
    });

    it('ignores a pong when stopped', () => {
      const { monitor, timers, sendHeartbeat } = harness();

      monitor.notePong();
      timers.advance(300_000);

      expect(monitor.isRunning).toBe(false);
      expect(sendHeartbeat).not.toHaveBeenCalled();
    });
  });

  it('uses only the injected scheduler', () => {
    const schedule = vi.fn((_callback: () => void, _delayMs: number): (() => void) => () => {});
    const monitor = new HeartbeatMonitor({
      schedule,
      intervalMs: 1_234,
      timeoutMs: 567,
      sendHeartbeat: vi.fn(),
      onDeadPeer: vi.fn(),
    });

    monitor.start();

    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0]?.[1]).toBe(1_234);
  });
});
