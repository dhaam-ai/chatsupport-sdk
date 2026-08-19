// Proves the GAP-1 workaround in src/ticks-oracle.ts actually computes the
// right answers — independent of whether `@dhaam-ccrm/core` currently
// exports deriveTickState or not (see that file's header). If core's barrel
// is ever fixed, `resolveTickOracle().source` flips to 'core' and this file
// keeps passing unmodified — it is asserting on behaviour, not on which
// branch answered.

import { describe, expect, it } from 'vitest';

import { buildMessage } from '../src/harness/builders.js';
import { resolveTickOracle } from '../src/ticks-oracle.js';

describe('resolveTickOracle', () => {
  it('resolves to a usable oracle (either the real core export or the documented mirror)', () => {
    const oracle = resolveTickOracle();
    expect(['core', 'mirror']).toContain(oracle.source);
    expect(typeof oracle.deriveTickState).toBe('function');
    expect(typeof oracle.deriveTickStateFromState).toBe('function');
  });

  it('is memoized — repeated calls return the same resolved oracle', () => {
    expect(resolveTickOracle()).toBe(resolveTickOracle());
  });

  it('derives "pending" for a queued send', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', delivery: { state: 'queued' } });
    expect(
      oracle.deriveTickState({ message, localParticipantId: 'me', deliveredWatermarks: {}, readWatermarks: {} }),
    ).toBe('pending');
  });

  it('derives "sent" for a confirmed message no one else has a watermark for', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', seq: 5 });
    expect(
      oracle.deriveTickState({ message, localParticipantId: 'me', deliveredWatermarks: {}, readWatermarks: {} }),
    ).toBe('sent');
  });

  it('derives "delivered" once another participant\'s delivered watermark reaches seq', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', seq: 5 });
    expect(
      oracle.deriveTickState({ message, localParticipantId: 'me', deliveredWatermarks: { other: 5 }, readWatermarks: {} }),
    ).toBe('delivered');
  });

  it('derives "read" once another participant\'s read watermark reaches createdAt, outranking delivered', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', seq: 5, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(
      oracle.deriveTickState({
        message,
        localParticipantId: 'me',
        deliveredWatermarks: { other: 5 },
        readWatermarks: { other: '2026-01-01T00:00:01.000Z' },
      }),
    ).toBe('read');
  });

  it('never counts our own watermark as "another participant"', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', seq: 5 });
    expect(
      oracle.deriveTickState({ message, localParticipantId: 'me', deliveredWatermarks: { me: 999 }, readWatermarks: {} }),
    ).toBe('sent');
  });

  it('returns null when localParticipantId is null, a message is not ours, delivery failed, or seq is absent and not queued', () => {
    const oracle = resolveTickOracle();
    const mine = buildMessage({ senderId: 'me', seq: 5 });
    const theirs = buildMessage({ senderId: 'someone-else', seq: 5 });
    const failed = buildMessage({ senderId: 'me', delivery: { state: 'failed', reason: 'rejected' } });
    const noSeq = buildMessage({ senderId: 'me' });

    expect(oracle.deriveTickState({ message: mine, localParticipantId: null, deliveredWatermarks: {}, readWatermarks: {} })).toBeNull();
    expect(oracle.deriveTickState({ message: theirs, localParticipantId: 'me', deliveredWatermarks: {}, readWatermarks: {} })).toBeNull();
    expect(oracle.deriveTickState({ message: failed, localParticipantId: 'me', deliveredWatermarks: {}, readWatermarks: {} })).toBeNull();
    expect(oracle.deriveTickState({ message: noSeq, localParticipantId: 'me', deliveredWatermarks: {}, readWatermarks: {} })).toBeNull();
  });

  it('deriveTickStateFromState is a projection of the same rule from a ChatState-shaped value', () => {
    const oracle = resolveTickOracle();
    const message = buildMessage({ senderId: 'me', seq: 5 });
    const state = { deliveredWatermarks: { other: 5 }, readWatermarks: {} };
    expect(oracle.deriveTickStateFromState(state, message, 'me')).toBe('delivered');
  });
});
