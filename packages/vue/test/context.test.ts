// @vitest-environment node
//
// The provide/inject seam. No DOM: `createApp`/`app.provide`/`runWithContext`
// are all pure runtime-core, and proving that here is half of this package's
// SSR story (the other half is ssr.test.ts, which actually renders).

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatClientConfig } from '@dhaam-ccrm/core';
import { describe, expect, it } from 'vitest';
import { createApp } from 'vue';

import { chatClientKey, createChatPlugin, useChatClient } from '../src/index.js';

/** A minimally-valid `ChatClientConfig` — every required seam, none of them reachable without connecting. */
function buildConfig(): ChatClientConfig {
  return {
    // Split so no scanner mistakes this for a real credential.
    publishableKey: 'dhp' + '_test_0123456789abcdef',
    getToken: async () => 'token',
    wsUrl: 'wss://example.test/ws',
    localSender: { senderId: 'participant_local', senderType: 'CUSTOMER' as const },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
  };
}

describe('useChatClient', () => {
  it('throws a message naming the fix when no client was provided', () => {
    const app = createApp({ render: () => null });

    expect(() => app.runWithContext(() => useChatClient())).toThrowError(/createChatPlugin|provideChatClient/);
  });

  it('returns the injected client', () => {
    const client = createConformanceChatClient();
    const app = createApp({ render: () => null });
    app.provide(chatClientKey, client);

    expect(app.runWithContext(() => useChatClient())).toBe(client);
  });
});

describe('createChatPlugin', () => {
  it('passes a ChatClient instance straight through', () => {
    const client = createConformanceChatClient();
    const plugin = createChatPlugin(client);

    expect(plugin.client).toBe(client);
  });

  it('builds one ChatClient from a ChatClientConfig and reuses it across installs', () => {
    const plugin = createChatPlugin(buildConfig());

    expect(typeof plugin.client.getState).toBe('function');
    expect(typeof plugin.client.subscribe).toBe('function');
    expect(plugin.client.getState().connectionState).toBe('idle');

    const first = createApp({ render: () => null });
    const second = createApp({ render: () => null });
    first.use(plugin);
    second.use(plugin);

    // One plugin means one client — installing into two apps must not quietly
    // construct a second one, which would open a second connection the moment
    // either app called connect().
    expect(first.runWithContext(() => useChatClient())).toBe(plugin.client);
    expect(second.runWithContext(() => useChatClient())).toBe(plugin.client);
  });

  it('constructing from a config opens no connection and touches no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    const plugin = createChatPlugin(buildConfig());

    expect(plugin.client.getState().connectionState).toBe('idle');
  });

  it('makes the client reachable through app.use()', () => {
    const client = createConformanceChatClient({ unreadCount: 9 });
    const app = createApp({ render: () => null });
    app.use(createChatPlugin(client));

    expect(app.runWithContext(() => useChatClient().getState().unreadCount)).toBe(9);
  });
});
