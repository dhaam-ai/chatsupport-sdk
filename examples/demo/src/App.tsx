import { useMemo } from 'react';

import { ChatProvider } from '@dhaam-ccrm/react';

import { buildChatConfig } from './chat-client';
import { readRuntimeConfig } from './runtime-config';
import { Composer } from './components/Composer';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MessageList } from './components/MessageList';
import { UnreadBadge } from './components/UnreadBadge';

export function App(): JSX.Element {
  const runtime = useMemo(readRuntimeConfig, []);

  // Built once. ChatProvider resolves its `client` prop on first render only,
  // so handing it a new config object every render would be misleading rather
  // than merely wasteful — the second one is ignored.
  const config = useMemo(() => buildChatConfig(runtime), [runtime]);

  return (
    <ChatProvider client={config}>
      <header className="app-header">
        <h1>Chat SDK reference integration</h1>
        <p className="subtitle">
          Signed in as <strong>{runtime.displayName}</strong> ({runtime.userId})
        </p>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <ConnectionPanel />
          <section className="panel" aria-labelledby="unread-heading">
            <h2 id="unread-heading">Unread</h2>
            <UnreadBadge />
          </section>
        </aside>

        <section className="panel conversation" aria-labelledby="conversation-heading">
          <h2 id="conversation-heading">Conversation</h2>
          <MessageList localSenderId={runtime.userId} />
          <Composer />
        </section>
      </main>
    </ChatProvider>
  );
}
