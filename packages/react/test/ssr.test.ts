// @vitest-environment node
//
// Deliberately the 'node' vitest environment (no jsdom) rather than the
// 'jsdom' environment every other test file in this package opts into via
// the `@vitest-environment jsdom` pragma above their own imports — that is
// the whole point of this file: prove the provider and its hooks work with
// no `window`/`document` present at all, which is what a Next.js server
// render actually looks like. A jsdom-backed test could pass here for the
// wrong reason (a stray `window` read would silently succeed against
// jsdom's fake one instead of failing loudly).

import { describe, expect, it } from 'vitest';

// react-dom/server's ESM entry works fine in a plain Node environment; it is
// the browser-targeted react-dom entry (and jsdom-requiring APIs like
// createRoot/hydrateRoot) that need a DOM.
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatProvider } from '../src/context.js';
import { useChannel } from '../src/use-channel.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

describe('server-side rendering (getServerSnapshot)', () => {
  it('this file genuinely has no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders a hook consumer against a pre-built ChatClient with no DOM present', () => {
    const client = createFakeChatClient({ connectionState: 'idle' });

    function View() {
      const { connectionState } = useChannel();
      return h('div', null, connectionState);
    }

    const html = renderToStaticMarkup(h(ChatProvider, { client }, h(View)));

    expect(html).toContain('idle');
  });

  it('constructing the client from a ChatClientConfig during SSR does not throw (createChatClient touches no window/document — core/src/index.ts)', () => {
    function View() {
      const { connectionState } = useChannel();
      return h('div', null, connectionState);
    }

    const html = renderToStaticMarkup(
      h(
        ChatProvider,
        {
          client: {
            publishableKey: 'dhp' + '_test_0123456789abcdef',
            getToken: async () => 'token',
            wsUrl: 'wss://example.test/ws',
            localSender: { senderId: 'user_1', senderType: 'CUSTOMER' as const },
            history: { listMessages: async () => ({ messages: [], hasMore: false }) },
          },
        },
        h(View),
      ),
    );

    expect(html).toContain('idle');
  });
});
