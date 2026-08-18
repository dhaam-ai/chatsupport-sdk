// @vitest-environment jsdom
//
// The load-bearing tests for this package: everything else is thin wiring,
// this file is the one place a bug would silently break the whole premise
// (React re-rendering correctly, and not too often, off core's store).

import { act, cleanup, render } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider } from '../src/context.js';
import { useChannel } from '../src/use-channel.js';
import { useChatSelector } from '../src/use-chat-selector.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

describe('useChatSelector — re-renders on a real change', () => {
  it('re-renders a subscribed component when its selected slice changes', () => {
    const client = createFakeChatClient({ unreadCount: 0 });
    const renderedValues: number[] = [];

    function Badge() {
      const unreadCount = useChatSelector((state) => state.unreadCount);
      renderedValues.push(unreadCount);
      return h('div', { 'data-testid': 'badge' }, unreadCount);
    }

    const { getByTestId } = render(h(ChatProvider, { client }, h(Badge)));

    expect(getByTestId('badge').textContent).toBe('0');

    act(() => {
      client.emitState({ unreadCount: 3 });
    });

    expect(getByTestId('badge').textContent).toBe('3');
    expect(renderedValues).toEqual([0, 3]);
  });

  it("does NOT re-render when a redundant patch (same values) is applied — core's own setState no-op contract, held through the hook", () => {
    const client = createFakeChatClient({ unreadCount: 5 });
    let renderCount = 0;

    function Consumer() {
      useChatSelector((state) => state.unreadCount);
      renderCount += 1;
      return null;
    }

    render(h(ChatProvider, { client }, h(Consumer)));
    expect(renderCount).toBe(1);

    act(() => {
      client.emitState({ unreadCount: 5 }); // same value: the fake client's emitState (mirroring core's) treats this as a no-op
    });

    expect(renderCount).toBe(1);
  });
});

describe('useChatSelector — a selector isolates its slice', () => {
  it('does not re-render a `typing` consumer when an unrelated field (messages) changes', () => {
    const client = createFakeChatClient();
    let typingRenderCount = 0;
    let messagesRenderCount = 0;

    function TypingConsumer() {
      const typing = useChatSelector((state) => state.typing);
      typingRenderCount += 1;
      return h('div', { 'data-testid': 'typing' }, String(typing.isTyping));
    }

    function MessagesConsumer() {
      const messages = useChatSelector((state) => state.messages);
      messagesRenderCount += 1;
      return h('div', { 'data-testid': 'count' }, messages.length);
    }

    render(h(ChatProvider, { client }, h(TypingConsumer), h(MessagesConsumer)));

    expect(typingRenderCount).toBe(1);
    expect(messagesRenderCount).toBe(1);

    act(() => {
      client.emitState({
        messages: [
          {
            id: 'm1',
            sessionId: 's1',
            senderId: 'u1',
            senderType: 'CUSTOMER',
            type: 'TEXT',
            content: 'hi',
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });

    expect(messagesRenderCount).toBe(2); // its own slice changed
    expect(typingRenderCount).toBe(1); // `typing` kept the same reference — core's shallow-patch semantics (see state/store.ts)
  });

  it('a composite selector (useChannel) that builds a new object every call is still rescued by shallowEqual', () => {
    const client = createFakeChatClient();
    let renderCount = 0;

    function ChannelConsumer() {
      const { connectionState } = useChannel();
      renderCount += 1;
      return h('div', { 'data-testid': 'state' }, connectionState);
    }

    const { getByTestId } = render(h(ChatProvider, { client }, h(ChannelConsumer)));
    expect(renderCount).toBe(1);

    // Changes the top-level ChatState identity (a genuinely new `messages`
    // array reference) without touching anything useChannel's selector
    // reads. Without shallowEqual, useChannel's selector — which returns a
    // brand-new `{ connectionState, session, pastSessions, lastError }`
    // object on every invocation — would report "changed" here regardless.
    act(() => {
      client.emitState({ messages: [] });
    });
    expect(renderCount).toBe(1);

    act(() => {
      client.emitState({ connectionState: 'connected' });
    });
    expect(renderCount).toBe(2);
    expect(getByTestId('state').textContent).toBe('connected');
  });
});

describe('useChatSelector — no infinite loop', () => {
  it('a selector that allocates a fresh object every call renders exactly once per real change, never loops', () => {
    const client = createFakeChatClient();
    let renderCount = 0;

    function BadSelectorConsumer() {
      // The exact anti-pattern this hook's own docs warn against: a
      // selector with no memoization would return a new object reference
      // on every getSnapshot() call.
      const slice = useChatSelector((state) => ({ isTyping: state.typing.isTyping }));
      renderCount += 1;
      return h('div', null, String(slice.isTyping));
    }

    expect(() => render(h(ChatProvider, { client }, h(BadSelectorConsumer)))).not.toThrow();

    expect(renderCount).toBe(1);
  });

  it('proves the failure mode is real: the same selector wired to raw useSyncExternalStore with no memoization throws synchronously', () => {
    const client = createFakeChatClient();

    function subscribe(onStoreChange: () => void) {
      return client.subscribe(() => onStoreChange());
    }
    function getSnapshot() {
      // No cache at all — this is what useChatSelector's cacheRef exists to avoid.
      return { isTyping: client.getState().typing.isTyping };
    }

    function RawBadConsumer() {
      const slice = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      return h('div', null, String(slice.isTyping));
    }

    // A fresh object out of getSnapshot on every call means React's
    // post-commit "is the store still consistent" check (useSyncExternalStore's
    // tearing guard) never agrees with what it just rendered, so it keeps
    // forcing another render — until React's own nested-update guard trips.
    // Empirically (React 18.3) this surfaces as "Maximum update depth
    // exceeded", not the "getSnapshot should be cached" message some other
    // unstable-snapshot cases produce — either way, it is a thrown error,
    // not a silent infinite loop, and this test pins the message we
    // actually get so a future React upgrade that changes it is visible.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(h(RawBadConsumer))).toThrow(/maximum update depth exceeded/i);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('unmount', () => {
  it('unsubscribes from the client', () => {
    const client = createFakeChatClient();

    function Consumer() {
      useChatSelector((state) => state.connectionState);
      return null;
    }

    const { unmount } = render(h(ChatProvider, { client }, h(Consumer)));
    expect(client.listenerCount()).toBe(1);

    unmount();
    expect(client.listenerCount()).toBe(0);
  });
});
