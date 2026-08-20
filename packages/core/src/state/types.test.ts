import { describe, expect, it } from 'vitest';

import { CONNECTION_STATE_VALUES, createInitialChatState } from './types.js';
import type { ChatState, ConnectionState, MessageDelivery } from './types.js';

describe('CONNECTION_STATE_VALUES', () => {
  it('models exactly the seven states of §8.1', () => {
    // Asserted as a set, not a length, so a rename shows up as a diff of the
    // offending name rather than a bare count mismatch.
    expect([...CONNECTION_STATE_VALUES]).toEqual([
      'idle',
      'connecting',
      'authenticating',
      'connected',
      'reconnecting',
      'suspended',
      'closed',
    ]);
  });

  it('derives the ConnectionState union from the same array', () => {
    // Compile-time: every literal must be assignable, and the array's element
    // type must be exactly the union. If someone adds a value to the array
    // without it being a real §8.1 state, or narrows the type by hand, this
    // stops compiling.
    const all: ConnectionState[] = [...CONNECTION_STATE_VALUES];
    expect(all).toHaveLength(7);

    // @ts-expect-error — 'reconnected' is not a §8.1 state.
    const bogus: ConnectionState = 'reconnected';
    expect(bogus).toBe('reconnected');
  });
});

describe('createInitialChatState', () => {
  it('starts idle with every collection empty and no error', () => {
    expect(createInitialChatState()).toEqual({
      connectionState: 'idle',
      session: null,
      messages: [],
      typing: { isTyping: false },
      unreadCount: 0,
      pagination: { hasMore: false, loadingMore: false, initialLoaded: false },
      uploading: false,
      pastSessions: [],
      readWatermarks: {},
      deliveredWatermarks: {},
      presence: {},
      lastError: null,
    });
  });

  it('exposes exactly the twelve fields §6.4 specifies', () => {
    // Guards against a field being quietly added to ChatState without a PRD
    // change — bindings are built against exactly this surface. `presence` was
    // added by the 2026-08-18 §6.4 amendment and `deliveredWatermarks` by the
    // 2026-08-19 one; this test is what forced both amendments to be written
    // down rather than slipped in.
    expect(Object.keys(createInitialChatState()).sort()).toEqual(
      [
        'connectionState',
        'deliveredWatermarks',
        'lastError',
        'messages',
        'pagination',
        'pastSessions',
        'presence',
        'readWatermarks',
        'session',
        'typing',
        'unreadCount',
        'uploading',
      ].sort(),
    );
  });

  it('returns a fresh graph per call, so two stores never share state', () => {
    const a = createInitialChatState();
    const b = createInitialChatState();

    expect(a).not.toBe(b);
    // The nested containers matter more than the root: sharing these is what
    // would actually let one store's mutation surface in another.
    expect(a.messages).not.toBe(b.messages);
    expect(a.pastSessions).not.toBe(b.pastSessions);
    expect(a.readWatermarks).not.toBe(b.readWatermarks);
    expect(a.deliveredWatermarks).not.toBe(b.deliveredWatermarks);
    expect(a.typing).not.toBe(b.typing);
    expect(a.pagination).not.toBe(b.pagination);
  });

  it('types the initial state as a full ChatState', () => {
    // Compile-time assertion: the factory must satisfy the whole interface,
    // not a partial of it.
    const state: ChatState = createInitialChatState();
    expect(state.connectionState).toBe('idle');
  });
});

describe('MessageDelivery — failed variant carries code and retryable', () => {
  it('requires retryable but not code, mirroring ErrorPayload.retryable (§7.4)', () => {
    // Compile-time: `retryable` is mandatory even with no `code` — the
    // variant this SDK produces for every `SendFailureReason` that never had
    // a wire `ErrorPayload` behind it (`sessionClosed`, `expired`, `evicted`,
    // `storage`).
    const noCode: MessageDelivery = { state: 'failed', reason: 'evicted', retryable: true };
    expect(noCode.state).toBe('failed');

    // @ts-expect-error — retryable is required, not optional.
    const missingRetryable: MessageDelivery = { state: 'failed', reason: 'evicted' };
    expect(missingRetryable).toBeDefined();
  });

  it('accepts the server-mirrored SESSION_CLOSED / retryable: false shape (§7.4)', () => {
    const delivery: MessageDelivery = {
      state: 'failed',
      reason: 'rejected',
      code: 'SESSION_CLOSED',
      retryable: false,
    };
    expect(delivery).toEqual({
      state: 'failed',
      reason: 'rejected',
      code: 'SESSION_CLOSED',
      retryable: false,
    });
  });
});
