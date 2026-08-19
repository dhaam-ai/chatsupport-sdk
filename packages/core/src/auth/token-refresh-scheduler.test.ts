import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenRefreshScheduler } from './token-refresh-scheduler.js';

describe('TokenRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire before the scheduled delay elapses', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(10_000);
    vi.advanceTimersByTime(9_999);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('fires once the scheduled delay elapses', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(10_000);
    vi.advanceTimersByTime(10_000);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('replaces a previously scheduled refresh rather than firing both', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(10_000);
    vi.advanceTimersByTime(5_000);
    scheduler.scheduleIn(10_000); // reschedules — the original 10s-from-start firing must not happen

    vi.advanceTimersByTime(5_000); // 10s from the very start, but only 5s from the reschedule
    expect(onRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000); // now 10s from the reschedule
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('treats a negative delay as "fire on the next tick", not in the past', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(-5_000);
    vi.advanceTimersByTime(0);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents a scheduled refresh from firing', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(10_000);
    scheduler.cancel();
    vi.advanceTimersByTime(60_000);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('cancel() is safe to call when nothing is scheduled', () => {
    const scheduler = new TokenRefreshScheduler({ onRefresh: vi.fn() });

    expect(() => scheduler.cancel()).not.toThrow();
  });

  it('can be scheduled again after firing', () => {
    const onRefresh = vi.fn();
    const scheduler = new TokenRefreshScheduler({ onRefresh });

    scheduler.scheduleIn(1_000);
    vi.advanceTimersByTime(1_000);
    scheduler.scheduleIn(1_000);
    vi.advanceTimersByTime(1_000);

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
