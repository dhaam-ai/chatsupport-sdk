// The one seam every composable in this package is built on: find the one
// `ChatClient` provided to this app/subtree, or construct it from a config.
// PRD §4 gives this package "composables/provide-inject wrapping one core
// client instance ... mapping core's observable store to Vue's reactivity"
// and explicitly excludes "WS/REST calls, reconnect logic, dedup logic,
// business rules of any kind." Nothing below does any of that.
//
// Two entry points rather than React's one `<ChatProvider>` component,
// because Vue has two idiomatic scopes for this and they are not
// interchangeable:
//
//   createChatPlugin(...)  → `app.use(chat)`. App-wide, available to every
//                            component including the root. The Nuxt/Vite
//                            default; a plugin is what a Vue app author
//                            reaches for.
//   provideChatClient(...) → called inside a `setup()`. Scopes the client to
//                            one subtree, which is how you run two clients
//                            (two widgets, two tenants) in one app, and is
//                            the direct analogue of nesting `<ChatProvider>`.
//
// There is deliberately NO `<ChatProvider>` component here. Vue has no JSX
// convention to make that ergonomic, a render-function wrapper component
// would be strictly more machinery than `provide`, and `app.use()` covers
// the common case that React needs a root component for.

import { createChatClient } from '@dhaam-ccrm/core';
import type { ChatClient, ChatClientConfig } from '@dhaam-ccrm/core';
import { inject, provide } from 'vue';
import type { App, InjectionKey } from 'vue';

/**
 * The provide/inject key both entry points below write and {@link useChatClient}
 * reads.
 *
 * A `Symbol`, not a string: a string key collides silently with any other
 * library that picked the same word, and the failure mode of a collision here
 * is "every composable in your app is talking to somebody else's object."
 * Exported so an app that wants to `provide` the client itself (a Nuxt plugin
 * writing `nuxtApp.vueApp.provide(...)`, a test harness) can use the same key
 * rather than reaching for {@link provideChatClient} inside a `setup()` it does
 * not have.
 */
export const chatClientKey: InjectionKey<ChatClient> = Symbol('dhaam-ccrm.chatClient');

/** A `ChatClientConfig` has no `getState`/`subscribe`; a `ChatClient` has both (§6.4). */
function isChatClientInstance(value: ChatClient | ChatClientConfig): value is ChatClient {
  return (
    typeof (value as Partial<ChatClient>).getState === 'function' &&
    typeof (value as Partial<ChatClient>).subscribe === 'function'
  );
}

/**
 * Either the `ChatClient` your app already built (you own its lifecycle —
 * call `connect()`/`disconnect()` yourself) or a `ChatClientConfig` for this
 * package to build one from via `createChatClient()` (PRD §6.1).
 */
export type ChatClientSource = ChatClient | ChatClientConfig;

function resolveClient(source: ChatClientSource): ChatClient {
  return isChatClientInstance(source) ? source : createChatClient(source);
}

/**
 * A Vue plugin putting one `ChatClient` in the app's injection context.
 *
 *     const chat = createChatPlugin({ publishableKey, getToken, ... });
 *     app.use(chat);
 *     await chat.client.connect();
 *
 * The client is resolved once, here, not per `app.use()` call — so `chat.client`
 * is the same instance every composable in the app will see, and installing the
 * same plugin into two apps (an SSR entry and a client entry, say) shares one
 * client rather than silently building a second one. Constructing a second
 * client for a second app is a decision only the app can make; call
 * `createChatPlugin` twice to do it.
 *
 * SSR-safe: `createChatClient()` does no I/O and touches no `window`/`document`
 * (core/src/index.ts's own module header — the only global it touches is
 * `WebSocket`, lazily, inside `connect()`), and this never calls `connect()`.
 * Build the client per request on the server, as you would any per-user object.
 */
export interface ChatPlugin {
  install(app: App): void;
  /** The resolved client — for `connect()`/`disconnect()` and anything else the app drives directly. */
  readonly client: ChatClient;
}

export function createChatPlugin(source: ChatClientSource): ChatPlugin {
  const client = resolveClient(source);
  return {
    client,
    install(app: App): void {
      app.provide(chatClientKey, client);
    },
  };
}

/**
 * Provides one `ChatClient` to this component's subtree. Call from a `setup()`;
 * returns the resolved client so the caller can drive it.
 *
 * Resolved once per call, on the `setup()` call that made it — a component that
 * re-renders does not re-run `setup()`, so there is no "the config prop changed,
 * swap the client" path here. That is deliberate and matches the React
 * binding's reasoning exactly: core has no "replace the live connection"
 * operation (§8 models `connect`/`disconnect` as the only transitions), so
 * swapping instances out from under every subscribed composable would either
 * orphan the old connection or require this package to invent teardown
 * semantics core does not have. To use a different client (a new user logged
 * in), remount the providing component — `<ChatRoot :key="userId">` is the
 * documented way.
 */
export function provideChatClient(source: ChatClientSource): ChatClient {
  const client = resolveClient(source);
  provide(chatClientKey, client);
  return client;
}

/**
 * The escape hatch to the raw `ChatClient` — for calling an operation
 * (`connect`, `sendMessage`, `joinSession`, ...) directly rather than through
 * one of the domain composables. Every other composable in this package calls
 * this first.
 *
 * Must be called where `inject()` works: inside a `setup()`, or inside
 * `app.runWithContext(...)` (Vue 3.3+) for a composable running outside a
 * component — a Pinia store action, a Nuxt plugin. That is the whole reason
 * this package's minimum Vue is 3.3.
 *
 * The returned reference is stable for as long as the provider that supplied
 * it lives, so it is safe to close over.
 */
export function useChatClient(): ChatClient {
  // `null` as the explicit default rather than letting `inject` return
  // `undefined`: Vue warns "injection not found" only when no default is
  // given, and that warning is strictly worse than the error below — it
  // names the symbol, not the mistake, and it does not stop execution.
  const client = inject(chatClientKey, null);
  if (client === null) {
    throw new Error(
      '[@dhaam-ccrm/vue] useChatClient() (and every composable built on it — useChannel, ' +
        'useMessages, useTypingIndicator, etc.) found no ChatClient. Install the plugin ' +
        '(app.use(createChatPlugin(client))) or call provideChatClient(client) in an ancestor ' +
        "setup(). If you are calling this outside a component's setup(), wrap the call in " +
        'app.runWithContext(() => ...) so inject() can resolve.',
    );
  }
  return client;
}
