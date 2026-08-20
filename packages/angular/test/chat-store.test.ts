// `createChatStore` on its own — no DI, no injector, no zone. Covers the
// things the shared conformance suite deliberately does not: that the store
// keeps exactly ONE client registration however many selectors are derived
// from it, that it is readable the instant it is built (mid-session mount),
// that every §6.2/§6.3 action is a straight delegation, and that `tickState`
// is core's derivation rather than a local re-implementation.

import { createConformanceChatClient, buildMessage } from '@dhaam-ccrm/binding-conformance';
import type { ConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import { deriveTickStateFromState } from '@dhaam-ccrm/core';
import type { ChatClient, ChatState } from '@dhaam-ccrm/core';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { createChatStore, shallowEqual } from '../src/index.js';
import type { ChatStore } from '../src/index.js';

function store(initial?: Partial<ChatState>) {
  const client = createConformanceChatClient(initial);
  return { client, store: createChatStore(client) };
}

async function settle(client: ConformanceChatClient): Promise<void> {
  await client.__harness.flushMicrotasks();
}

describe('subscription bookkeeping', () => {
  it('registers exactly one client subscription no matter how many signals are derived', () => {
    const { client, store: chat } = store();

    expect(client.__harness.subscriberCount()).toBe(1);

    // Every `select()` is a `computed` over the ONE state signal, not a second
    // registration — which is why no selector in this binding can leak.
    for (let i = 0; i < 50; i += 1) {
      chat.select((s) => s.unreadCount);
      chat.select((s) => ({ n: s.unreadCount }), shallowEqual);
    }
    chat.tickState('nope', 'me');

    expect(client.__harness.subscriberCount(), '50 selectors later, still one registration').toBe(1);

    chat.destroy();
    expect(client.__harness.subscriberCount()).toBe(0);
  });

  it('destroy() is idempotent and leaves the last snapshot readable', async () => {
    const { client, store: chat } = store({ unreadCount: 2 });

    client.__harness.setState({ unreadCount: 5 });
    await settle(client);
    expect(chat.unreadCount()).toBe(5);

    chat.destroy();
    expect(() => chat.destroy()).not.toThrow();

    // Frozen at the last value seen — reads keep working, they just stop moving.
    client.__harness.setState({ unreadCount: 9 });
    await settle(client);
    expect(chat.unreadCount(), 'a destroyed store must not keep tracking the client').toBe(5);
  });
});

describe('on() after destroy', () => {
  it('registers nothing and returns a harmless no-op', () => {
    const { client, store: chat } = store();
    chat.destroy();

    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = chat.on('typing', () => {});
    }).not.toThrow();

    expect(client.__harness.eventListenerCount('typing'), 'nothing planted on the client').toBe(0);
    expect(() => unsubscribe?.()).not.toThrow();
  });
});

describe('initial read', () => {
  it('is seeded from getState() so a store built mid-session is correct before any notification', () => {
    // Core's store never replays: a consumer created after the interesting
    // frames already arrived gets nothing until the NEXT change. Reading
    // `getState()` at construction is the only thing standing between that and
    // a chat panel that renders empty until someone types.
    const { store: chat } = store({ unreadCount: 12, connectionState: 'connected' });

    expect(chat.unreadCount()).toBe(12);
    expect(chat.connectionState()).toBe('connected');
  });
});

describe('select', () => {
  it('exposes the identical frozen snapshot core handed out — no copy, no re-wrap', async () => {
    const { client, store: chat } = store();

    client.__harness.setState({ unreadCount: 1 });
    await settle(client);

    expect(chat.state(), 'the exposed snapshot must be core’s own object').toBe(client.getState());
    expect(Object.isFrozen(chat.state())).toBe(true);
  });

  it('keeps the previous value when isEqual says nothing changed, so identity checks see "unchanged"', async () => {
    const { client, store: chat } = store({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
    const slice = chat.select((s) => ({ hasMore: s.pagination.hasMore }), shallowEqual);

    const before = slice();
    client.__harness.setState({ unreadCount: 3 });
    await settle(client);

    expect(slice(), 'same reference back — this is what stops every consumer re-rendering').toBe(before);

    client.__harness.setState({ pagination: { hasMore: false, loadingMore: false, initialLoaded: true } });
    await settle(client);
    expect(slice()).not.toBe(before);
    expect(slice()).toEqual({ hasMore: false });
  });

  it('re-throws a selector error on every read until its inputs change, and contains it to that signal', async () => {
    const { client, store: chat } = store({ unreadCount: 0 });
    const boom = chat.select((s) => {
      if (s.unreadCount === 1) throw new Error('selector blew up');
      return s.unreadCount;
    });
    const sibling = chat.select((s) => s.unreadCount);

    expect(boom()).toBe(0);

    client.__harness.setState({ unreadCount: 1 });
    await settle(client);

    expect(() => boom()).toThrow(/selector blew up/);
    expect(sibling(), 'the sibling signal is untouched').toBe(1);

    client.__harness.setState({ unreadCount: 2 });
    await settle(client);
    expect(boom(), 'and it recovers once its inputs move on').toBe(2);
  });
});

describe('tickState', () => {
  it('agrees with core’s deriveTickStateFromState across the whole watermark table', async () => {
    const { client, store: chat } = store();
    const message = buildMessage({ id: 'm1', senderId: 'me', seq: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    const tick = chat.tickState('m1', 'me');

    const cases: { patch: Partial<ChatState>; expected: string | null }[] = [
      { patch: { messages: [message], deliveredWatermarks: {}, readWatermarks: {} }, expected: 'sent' },
      { patch: { deliveredWatermarks: { other: 12 } }, expected: 'delivered' },
      { patch: { readWatermarks: { other: '2026-01-01T00:00:05.000Z' } }, expected: 'read' },
      // Our OWN delivery watermark must never count — the case v1 got wrong.
      { patch: { deliveredWatermarks: { me: 999 }, readWatermarks: {} }, expected: 'sent' },
    ];

    for (const testCase of cases) {
      client.__harness.setState(testCase.patch);
      await settle(client);
      expect(tick(), JSON.stringify(testCase.patch)).toBe(testCase.expected);
      expect(tick(), 'and it is core’s answer, not a second implementation').toBe(
        deriveTickStateFromState(client.getState(), message, 'me'),
      );
    }

    chat.destroy();
  });

  it('is null for a message id the state does not hold', () => {
    const { store: chat } = store();
    expect(chat.tickState('missing', 'me')()).toBeNull();
  });

  it('tracks a signal message id, the way a component input() supplies one', async () => {
    const { client, store: chat } = store();
    client.__harness.setState({
      messages: [
        buildMessage({ id: 'a', senderId: 'me', delivery: { state: 'queued' } }),
        buildMessage({ id: 'b', senderId: 'me', seq: 3 }),
      ],
      deliveredWatermarks: { other: 5 },
    });
    await settle(client);

    const messageId = signal('a');
    const localId = signal<string | null>('me');
    const tick = chat.tickState(messageId, localId);

    expect(tick()).toBe('pending');

    messageId.set('b');
    expect(tick(), 'switching the id re-derives without rebuilding the signal').toBe('delivered');

    localId.set(null);
    expect(tick(), 'and an unknown local identity means no tick, ever').toBeNull();
  });

  it('does not recompute for a state change that touches none of its inputs', async () => {
    const { client, store: chat } = store();
    const message = buildMessage({ id: 'm1', senderId: 'me', seq: 1 });
    client.__harness.setState({ messages: [message] });
    await settle(client);

    const spy = vi.spyOn(Array.prototype, 'find');
    const tick = chat.tickState('m1', 'me');
    tick();
    const afterFirstRead = spy.mock.calls.length;

    client.__harness.setState({ typing: { isTyping: true, participantId: 'p' } });
    await settle(client);
    tick();

    expect(spy.mock.calls.length, 'typing changed; messages/watermarks did not, so nothing recomputed').toBe(
      afterFirstRead,
    );
    spy.mockRestore();
  });
});

/**
 * Every operation the store forwards verbatim. `reopenSession` is absent
 * deliberately: the conformance harness has no behaviour for it and throws by
 * design, so it is covered by the type assertion below rather than by a call.
 */
type DelegatedAction =
  | 'connect'
  | 'disconnect'
  | 'joinSession'
  | 'leaveSession'
  | 'requestAgent'
  | 'closeSession'
  | 'sendMessage'
  | 'sendAttachment'
  | 'loadOlderMessages'
  | 'markRead'
  | 'startTyping'
  | 'stopTyping'
  | 'setPresence'
  | 'queryPresence';

/** Compile-time: every name below exists, spelled identically, on BOTH sides of the delegation. */
type AssertNamesMatch<T extends keyof ChatClient & keyof ChatStore> = T;
type _DelegatedNamesExistOnBoth = AssertNamesMatch<DelegatedAction | 'reopenSession'>;

describe('actions', () => {
  it('delegates every §6.2/§6.3 operation straight to the client', async () => {
    const { client, store: chat } = store();
    const file = new Blob(['x']);

    // Optional parameters are forwarded positionally, so the expected arg list
    // carries the explicit `undefined` the delegation actually passes.
    const calls: [DelegatedAction, unknown[]][] = [
      ['connect', []],
      ['disconnect', []],
      ['joinSession', ['s1']],
      ['leaveSession', []],
      ['requestAgent', ['because']],
      ['closeSession', []],
      ['sendMessage', ['hello', { replyToMessageId: 'r1' }]],
      ['sendAttachment', [file, undefined]],
      ['loadOlderMessages', []],
      ['markRead', []],
      ['startTyping', []],
      ['stopTyping', []],
      ['setPresence', ['ONLINE']],
      ['queryPresence', [['p1']]],
    ];

    for (const [name, args] of calls) {
      const spy = vi.spyOn(client, name);
      await (chat[name] as (...a: unknown[]) => unknown)(...args);
      expect(spy, `${name} must delegate`).toHaveBeenCalledWith(...args);
      spy.mockRestore();
    }
  });

  it('exposes the raw client for anything it does not wrap', () => {
    const { client, store: chat } = store();
    expect(chat.client).toBe(client);
  });
});

describe('shallowEqual', () => {
  it('compares one level deep and nothing further', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);

    const nested = { n: 1 };
    expect(shallowEqual({ nested }, { nested })).toBe(true);
    expect(shallowEqual({ nested: { n: 1 } }, { nested: { n: 1 } }), 'one level, not deep').toBe(false);
  });
});
