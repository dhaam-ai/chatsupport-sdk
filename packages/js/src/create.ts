// The one-call entry point: config in, live store out.
//
// Deliberately its own module rather than an overload of `createChatStore`.
// It is the only file in this package that imports `createChatClient`, and
// therefore the only one that pulls core's whole client assembly (connection
// state machine, transport, send queue, storage adapters) into a bundle. A
// widget built on a client the host page already owns imports `createChatStore`
// alone; with `"sideEffects": false` and ESM, this module — and core's factory
// behind it — drops out of that build entirely.

import { createChatClient } from '@dhaam-ccrm/core';
import type { ChatClientConfig } from '@dhaam-ccrm/core';

import { createChatStore } from './store.js';
import type { ChatStore, ChatStoreOptions } from './types.js';

/**
 * Builds a `ChatClient` from `config` (§6.1) and wraps it in a
 * {@link ChatStore}. The client is reachable afterwards as `store.client` —
 * call `store.client.connect()` yourself; nothing here opens a socket, so
 * this is safe to call during a server render.
 *
 * This store is the only owner of the client it just built, so tear it down
 * with `store.destroy({ disconnect: true })`. Plain `destroy()` drops the
 * subscriptions and leaves the connection open, which is right for a shared
 * client and a leak for this one.
 */
export function createChat(config: ChatClientConfig, options?: ChatStoreOptions): ChatStore {
  return createChatStore(createChatClient(config), options);
}
