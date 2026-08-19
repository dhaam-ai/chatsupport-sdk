// @vitest-environment node
//
// Deliberately vitest's `node` environment rather than the `jsdom` the
// component tests opt into: that is the whole point of this file. Nuxt renders
// on the server, where there is no `window` and no `document`, and a
// jsdom-backed test would pass for the wrong reason — a stray `window` read
// would silently hit jsdom's fake one instead of failing.
//
// `vue/server-renderer` is a subpath of the `vue` package itself, so this needs
// no extra dependency and no extra peer.

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatClientConfig } from '@dhaam-ccrm/core';
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

import {
  createChatPlugin,
  provideChatClient,
  useChannel,
  useMessages,
  useMessageTicks,
  useUnreadCount,
} from '../src/index.js';

function buildConfig(): ChatClientConfig {
  return {
    publishableKey: 'dhp' + '_test_0123456789abcdef',
    getToken: async () => 'token',
    wsUrl: 'wss://example.test/ws',
    localSender: { senderId: 'participant_local', senderType: 'CUSTOMER' as const },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
  };
}

const Widget = defineComponent({
  setup() {
    const { connectionState } = useChannel();
    const { messages } = useMessages();
    const { unreadCount } = useUnreadCount();
    const ticks = useMessageTicks('participant_local');

    return () =>
      h('div', [
        h('span', { class: 'state' }, connectionState.value),
        h('span', { class: 'count' }, String(messages.value.length)),
        h('span', { class: 'unread' }, String(unreadCount.value)),
        h('span', { class: 'ticks' }, String(ticks.value.size)),
      ]);
  },
});

describe('server-side rendering', () => {
  it('this file genuinely has no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders the initial snapshot through the plugin with no DOM present', async () => {
    const client = createConformanceChatClient({
      connectionState: 'connected',
      unreadCount: 7,
      messages: [
        {
          id: 'msg_1',
          sessionId: 'session_1',
          senderId: 'participant_local',
          senderType: 'CUSTOMER',
          type: 'TEXT',
          content: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
          seq: 3,
        },
      ],
    });

    const app = createSSRApp(Widget);
    app.use(createChatPlugin(client));

    const html = await renderToString(app);

    expect(html).toContain('connected');
    expect(html).toContain('class="count">1');
    expect(html).toContain('class="unread">7');
    // The tick derivation runs on the server too — `sent`, from core's table.
    expect(html).toContain('class="ticks">1');
  });

  it('renders through provideChatClient inside a setup()', async () => {
    const client = createConformanceChatClient({ connectionState: 'authenticating' });
    const Root = defineComponent({
      setup() {
        provideChatClient(client);
        return () => h(Widget);
      },
    });

    const html = await renderToString(createSSRApp(Root));

    expect(html).toContain('authenticating');
  });

  it('builds a client from a ChatClientConfig during a server render without connecting', async () => {
    const app = createSSRApp(Widget);
    const plugin = createChatPlugin(buildConfig());
    app.use(plugin);

    const html = await renderToString(app);

    expect(html).toContain('idle');
    expect(plugin.client.getState().connectionState).toBe('idle');
  });

  it('warns about nothing during a server render — a component setup always has an effect scope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createConformanceChatClient();

    const app = createSSRApp(Widget);
    app.use(createChatPlugin(client));
    await renderToString(app);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves its subscriptions on the client, which is why the client must be per-request', async () => {
    // Vue never unmounts a server-rendered tree, so no component scope is ever
    // stopped and nothing calls the unsubscribes. That is not a bug this
    // package can fix — there is no public "am I rendering on the server?"
    // signal — and it costs nothing when the client is built per request and
    // discarded with it, which is required anyway: a ChatClient holds one
    // user's session and token.
    const client = createConformanceChatClient();
    expect(client.__harness.subscriberCount()).toBe(0);

    const app = createSSRApp(Widget);
    app.use(createChatPlugin(client));
    await renderToString(app);

    expect(client.__harness.subscriberCount()).toBeGreaterThan(0);
  });
});
