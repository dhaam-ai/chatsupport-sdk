// ChatProvider / useChatClient — the one seam every hook in this package is
// built on. PRD §4: "@dhaam-ccrm/react owns hooks/context/provider wrapping
// one core client instance ... mapping core's observable store to React
// re-renders" and explicitly excludes "WS/REST calls, reconnect logic, dedup
// logic, business rules of any kind." Nothing below does any of that — this
// file's entire job is "find the one ChatClient in context, or construct it."

import { createChatClient } from '@dhaam-ccrm/core';
import type { ChatClient, ChatClientConfig } from '@dhaam-ccrm/core';
import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

/**
 * `null` by default so a missing `<ChatProvider>` fails loudly at the first
 * hook call (see {@link useChatClient}) instead of silently handing every
 * hook `undefined` and letting the crash surface somewhere unrelated.
 */
const ChatClientContext = createContext<ChatClient | null>(null);
ChatClientContext.displayName = 'ChatClientContext';

export interface ChatProviderProps {
  /**
   * Either a `ChatClient` your app already constructed (you own its
   * lifecycle — call `connect()`/`disconnect()` yourself) or a
   * `ChatClientConfig` for the provider to build one from via
   * `createChatClient()` (PRD §6.1).
   *
   * Resolved exactly once, on this provider instance's first render — a
   * later render with a different `client` value does not reconstruct or
   * swap the underlying `ChatClient`. This is deliberate: core has no
   * "replace the live connection" operation (§8 models `connect`/
   * `disconnect` as the only transitions), so silently swapping instances
   * out from under every subscribed hook would either orphan the old
   * connection or require this package to invent teardown semantics core
   * doesn't have — exactly the kind of connection-lifecycle logic §4
   * reserves for core. To use a different client (e.g. a new user logged
   * in), remount this provider — `<ChatProvider key={userId} client={...}>`
   * is the documented way to do that.
   */
  client: ChatClient | ChatClientConfig;
  children?: ReactNode;
}

/** A `ChatClientConfig` has no `getState`/`subscribe`; a `ChatClient` has both (§6.4). */
function isChatClientInstance(value: ChatClient | ChatClientConfig): value is ChatClient {
  return (
    typeof (value as Partial<ChatClient>).getState === 'function' &&
    typeof (value as Partial<ChatClient>).subscribe === 'function'
  );
}

/**
 * Puts one `ChatClient` in context for `useChatClient` and every hook built
 * on it (`useChannel`, `useMessages`, `useTypingIndicator`, ...) to find.
 *
 * SSR-safe: `createChatClient()` does no I/O and touches no `window`/
 * `document` (core/src/index.ts's own module header — the only global it
 * touches is `WebSocket`, lazily, inside `connect()`), so constructing the
 * client during a server render is safe. This component never calls
 * `connect()` itself — that stays an explicit action your app takes (typically
 * in a `useEffect`, which never runs on the server), so nothing here opens a
 * socket during SSR either.
 *
 * StrictMode-safe: the `useState` lazy initializer below may run twice in
 * React 18 development StrictMode (one result discarded) — see
 * https://react.dev/reference/react/useState#my-initializer-or-updater-function-runs-twice.
 * `createChatClient()` only constructs objects; it does not connect, so
 * constructing (and discarding) a throwaway `ChatClient` is inert.
 */
export function ChatProvider({ client: clientOrConfig, children }: ChatProviderProps): ReactElement {
  const [client] = useState<ChatClient>(() =>
    isChatClientInstance(clientOrConfig) ? clientOrConfig : createChatClient(clientOrConfig),
  );

  return <ChatClientContext.Provider value={client}>{children}</ChatClientContext.Provider>;
}

/**
 * The escape hatch to the raw `ChatClient` — for calling an operation
 * (`connect`, `sendMessage`, `joinSession`, ...) directly rather than through
 * one of the domain hooks. Every other hook in this package calls this
 * first.
 *
 * The returned reference is stable for the lifetime of the enclosing
 * `<ChatProvider>` (see its docs), so it is safe to put in a `useEffect`/
 * `useMemo`/`useCallback` dependency array without causing extra runs.
 */
export function useChatClient(): ChatClient {
  const client = useContext(ChatClientContext);
  if (client === null) {
    throw new Error(
      '[@dhaam-ccrm/react] useChatClient() (and every hook built on it — useChannel, ' +
        'useMessages, useTypingIndicator, etc.) was called outside a <ChatProvider>. ' +
        'Wrap your component tree in <ChatProvider client={chatClient}> first.',
    );
  }
  return client;
}
