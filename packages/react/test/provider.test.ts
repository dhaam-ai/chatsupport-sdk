// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider, useChatClient } from '../src/context.js';
import { useChatSelector } from '../src/use-chat-selector.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

/**
 * Deliberately subscribes via `useChatSelector` (not a one-off
 * `client.getState()` read) — the listener-count assertions below need a
 * real subscribing consumer, the same shape any hook in this package
 * produces.
 */
function ShowConnectionState() {
  const connectionState = useChatSelector((state) => state.connectionState);
  return h('div', { 'data-testid': 'conn' }, connectionState);
}

function CallsUseChatClientDirectly() {
  useChatClient();
  return null;
}

describe('useChatClient outside a provider', () => {
  it('throws a message that names the fix, instead of a bare "cannot read property of null"', () => {
    // Swallow the expected React error-boundary console.error noise so the
    // test output stays readable; the assertion is on the thrown error.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(h(CallsUseChatClientDirectly))).toThrow(/ChatProvider/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('ChatProvider given a pre-built ChatClient', () => {
  it('hands that exact instance to useChatClient', () => {
    const client = createFakeChatClient({ connectionState: 'connected' });

    render(h(ChatProvider, { client }, h(ShowConnectionState)));

    expect(screen.getByTestId('conn').textContent).toBe('connected');
  });
});

describe('ChatProvider given a ChatClientConfig', () => {
  it('constructs the client exactly once, even across re-renders with a fresh-but-equivalent config object', async () => {
    const core = await import('@dhaam-ccrm/core');
    const createChatClientSpy = vi.spyOn(core, 'createChatClient');

    const buildConfig = () => ({
      publishableKey: 'dhpk_test_0123456789abcdef',
      getToken: async () => 'token',
      wsUrl: 'wss://example.test/ws',
      localSender: { senderId: 'user_1', senderType: 'CUSTOMER' as const },
      history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    });

    const { rerender } = render(h(ChatProvider, { client: buildConfig() }, h(ShowConnectionState)));

    expect(screen.getByTestId('conn').textContent).toBe('idle');
    expect(createChatClientSpy).toHaveBeenCalledTimes(1);

    // A brand new (but equivalent) config object on a later render must not
    // trigger a second construction — see ChatProviderProps.client's doc for
    // why this is deliberate.
    rerender(h(ChatProvider, { client: buildConfig() }, h(ShowConnectionState)));

    expect(createChatClientSpy).toHaveBeenCalledTimes(1);
    createChatClientSpy.mockRestore();
  });
});

describe('React 18 StrictMode', () => {
  it('does not double-subscribe or leak a listener across the dev double-mount', () => {
    const client = createFakeChatClient();

    const { unmount } = render(
      h(StrictMode, null, h(ChatProvider, { client }, h(ShowConnectionState))),
    );

    // StrictMode mounts, cleans up, and mounts again in dev — if this hook's
    // subscription leaked one registration per pass instead of relying on
    // useSyncExternalStore's own subscribe/unsubscribe bookkeeping, this
    // would read 2, not 1.
    expect(client.listenerCount()).toBe(1);

    unmount();
    expect(client.listenerCount()).toBe(0);
  });
});
