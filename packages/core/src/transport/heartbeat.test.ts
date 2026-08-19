import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeartbeatScheduler } from './heartbeat.js';

describe('HeartbeatScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send a heartbeat before start() is called', () => {
    const sendHeartbeat = vi.fn();
    new HeartbeatScheduler({ intervalMs: 1000, timeoutMs: 500, sendHeartbeat, onTimeout: vi.fn() });

    vi.advanceTimersByTime(5000);

    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it('sends a heartbeat on each interval tick', () => {
    const sendHeartbeat = vi.fn();
    const scheduler = new HeartbeatScheduler({ intervalMs: 1000, timeoutMs: 500, sendHeartbeat, onTimeout: vi.fn() });

    scheduler.start();
    vi.advanceTimersByTime(3500);

    expect(sendHeartbeat).toHaveBeenCalledTimes(3);
  });

  it('calls onTimeout if no pong arrives within timeoutMs of a heartbeat', () => {
    const onTimeout = vi.fn();
    const scheduler = new HeartbeatScheduler({
      intervalMs: 1000,
      timeoutMs: 500,
      sendHeartbeat: vi.fn(),
      onTimeout,
    });

    scheduler.start();
    vi.advanceTimersByTime(1000); // first heartbeat fires
    vi.advanceTimersByTime(500); // timeout window elapses with no notePong()

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not call onTimeout if notePong() arrives before the timeout window elapses', () => {
    const onTimeout = vi.fn();
    const scheduler = new HeartbeatScheduler({
      intervalMs: 1000,
      timeoutMs: 500,
      sendHeartbeat: vi.fn(),
      onTimeout,
    });

    scheduler.start();
    vi.advanceTimersByTime(1000); // heartbeat fires
    scheduler.notePong();
    vi.advanceTimersByTime(500);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does not let a stray notePong() cancel a future heartbeat timeout', () => {
    const onTimeout = vi.fn();
    const scheduler = new HeartbeatScheduler({
      intervalMs: 1000,
      timeoutMs: 500,
      sendHeartbeat: vi.fn(),
      onTimeout,
    });

    scheduler.start();
    scheduler.notePong(); // no heartbeat has fired yet — should be a no-op
    vi.advanceTimersByTime(1000); // heartbeat fires, starting a fresh timeout window
    vi.advanceTimersByTime(500); // that window elapses with no second notePong()

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('stops sending heartbeats and stops any pending timeout after stop()', () => {
    const sendHeartbeat = vi.fn();
    const onTimeout = vi.fn();
    const scheduler = new HeartbeatScheduler({ intervalMs: 1000, timeoutMs: 500, sendHeartbeat, onTimeout });

    scheduler.start();
    vi.advanceTimersByTime(1000);
    scheduler.stop();
    vi.advanceTimersByTime(5000);

    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('is safe to call stop() when never started', () => {
    const scheduler = new HeartbeatScheduler({ sendHeartbeat: vi.fn(), onTimeout: vi.fn() });

    expect(() => scheduler.stop()).not.toThrow();
  });

  it('restarts cleanly if start() is called again while already running', () => {
    const sendHeartbeat = vi.fn();
    const scheduler = new HeartbeatScheduler({ intervalMs: 1000, timeoutMs: 500, sendHeartbeat, onTimeout: vi.fn() });

    scheduler.start();
    vi.advanceTimersByTime(1000);
    scheduler.start(); // restart — should not double up the interval
    vi.advanceTimersByTime(1000);

    expect(sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('uses the documented defaults when intervalMs/timeoutMs are omitted', () => {
    const sendHeartbeat = vi.fn();
    const scheduler = new HeartbeatScheduler({ sendHeartbeat, onTimeout: vi.fn() });

    scheduler.start();
    vi.advanceTimersByTime(24_999);
    expect(sendHeartbeat).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
  });
});
