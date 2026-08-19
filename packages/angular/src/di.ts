// The DI seam: two tokens and one `provide*` function, which is the whole
// wiring surface an Angular app touches.
//
// ---------------------------------------------------------------------------
// Why tokens and factories rather than an `@Injectable()` class
// ---------------------------------------------------------------------------
//
// An Angular decorator is not runtime metadata — it is an instruction to the
// Angular compiler, and a decorated class that reaches a consumer uncompiled
// fails at first injection with "needs to be compiled using the JIT compiler,
// but '@angular/compiler' is not available". Making `@Injectable()` work would
// mean building this package with ng-packagr/ngc instead of the tsup pipeline
// every other package in this repo uses.
//
// `InjectionToken` + a factory needs no compiler, no decorator metadata and no
// `experimentalDecorators`: the package ships as plain ESM/CJS, is consumable
// from AOT builds unchanged, and `inject(CHAT_STORE)` reads at the call site
// exactly like `inject(SomeService)` would. It is also how modern Angular
// libraries increasingly expose services, alongside `provide*` functions for
// standalone bootstrap.

import { DestroyRef, InjectionToken, NgZone, inject, makeEnvironmentProviders } from '@angular/core';
import type { EnvironmentProviders } from '@angular/core';
import type { ChatClient, ChatClientConfig } from '@dhaam-ccrm/core';

import { createChatStore, resolveChatClient } from './chat-store.js';
import type { ChatStore } from './chat-store.js';

const MISSING_PROVIDER_HINT =
  'Add provideChatClient(clientOrConfig) to your application providers ' +
  '(bootstrapApplication(App, { providers: [provideChatClient(...)] })), ' +
  'or to the providers of the component/route that needs chat.';

/**
 * The one `ChatClient` this application's chat surface talks to (§6.1).
 *
 * Has a root factory that throws rather than resolving to `null`, so a
 * forgotten `provideChatClient()` fails at the first injection with an
 * actionable message instead of surfacing later as an inert store — the same
 * choice `@dhaam-ccrm/react`'s `useChatClient()` makes for a missing
 * `<ChatProvider>`.
 */
export const CHAT_CLIENT = new InjectionToken<ChatClient>('@dhaam-ccrm/angular:CHAT_CLIENT', {
  providedIn: 'root',
  factory: (): never => {
    throw new Error(`[@dhaam-ccrm/angular] No ChatClient has been provided. ${MISSING_PROVIDER_HINT}`);
  },
});

/**
 * The {@link ChatStore} over {@link CHAT_CLIENT}.
 *
 * The root factory builds one from whatever `CHAT_CLIENT` resolves to, so an
 * app that provides `CHAT_CLIENT` by hand (`{ provide: CHAT_CLIENT, useValue: myClient }`)
 * still gets a working store without calling `provideChatClient()`.
 */
export const CHAT_STORE = new InjectionToken<ChatStore>('@dhaam-ccrm/angular:CHAT_STORE', {
  providedIn: 'root',
  factory: (): ChatStore => chatStoreFactory(),
});

/**
 * Builds the store and ties its teardown to the injector that resolved it.
 *
 * Must run inside an injection context (both call sites — the `CHAT_STORE`
 * root factory and `provideChatClient`'s `useFactory` — do).
 */
function chatStoreFactory(): ChatStore {
  const store = createChatStore(inject(CHAT_CLIENT), {
    // Optional because a bare `EnvironmentInjector` (and a plain unit test)
    // has no `NgZone` at all. See chat-store.ts's header, mechanism 2, for
    // why this is belt-and-braces rather than the primary guarantee.
    ngZone: inject(NgZone, { optional: true }),
  });
  inject(DestroyRef).onDestroy(() => store.destroy());
  return store;
}

/**
 * Wires one `ChatClient` — or a `ChatClientConfig` to build one from — plus
 * its {@link CHAT_STORE} into an injector.
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideChatClient({ publishableKey, getToken, wsUrl, localSender, history })],
 * });
 * ```
 *
 * The client is resolved once, by the injector that receives these providers,
 * and lives as long as that injector. Constructing a client does no I/O and
 * opens no socket (`createChatClient` touches no `window`/`document` and only
 * probes the `WebSocket` global lazily inside `connect()`), so this is safe in
 * a server-rendered bootstrap; `connect()` stays an explicit action your app
 * takes.
 *
 * Returns `EnvironmentProviders`, so it belongs in the application config or a
 * lazy `Route.providers`. The latter gives that route subtree its own client
 * and its own store, destroyed with the subtree and leaving an outer one
 * untouched. That is deliberately the smallest scope on offer: a store per
 * component instance would mean a socket per component instance, which is
 * never what a chat surface wants. If you genuinely need one outside DI, call
 * `createChatStore(client)` and own its `destroy()`.
 */
export function provideChatClient(clientOrConfig: ChatClient | ChatClientConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CHAT_CLIENT, useFactory: (): ChatClient => resolveChatClient(clientOrConfig) },
    { provide: CHAT_STORE, useFactory: chatStoreFactory },
  ]);
}

/** `inject(CHAT_STORE)`, named. Must be called in an injection context. */
export function injectChatStore(): ChatStore {
  return inject(CHAT_STORE);
}

/** `inject(CHAT_CLIENT)`, named — the escape hatch to the raw client. Must be called in an injection context. */
export function injectChatClient(): ChatClient {
  return inject(CHAT_CLIENT);
}
