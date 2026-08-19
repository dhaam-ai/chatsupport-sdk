// The DI seam: `provideChatClient` → `inject(CHAT_STORE)`, and the teardown
// that hangs off the injector's `DestroyRef`.
//
// Runs against a real `EnvironmentInjector` (see angular-test-host.ts) rather
// than a mock, because the whole point of these assertions is that Angular's
// own injector — not a hand-written container — resolves and destroys these
// providers the way the package claims.

import { DestroyRef, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import * as core from '@dhaam-ccrm/core';
import { describe, expect, it, vi } from 'vitest';

import { CHAT_CLIENT, CHAT_STORE, injectChatClient, injectChatStore, provideChatClient } from '../src/index.js';
import { createAngularTestHost } from './angular-test-host.js';

function buildConfig(): core.ChatClientConfig {
  return {
    publishableKey: 'dhp' + '_test_0123456789abcdef',
    getToken: async () => 'token',
    wsUrl: 'wss://example.test/ws',
    localSender: { senderId: 'user_1', senderType: 'CUSTOMER' as const },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
  };
}

describe('provideChatClient', () => {
  it('hands the exact ChatClient instance it was given to CHAT_CLIENT', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);

    expect(host.injector.get(CHAT_CLIENT)).toBe(client);

    host.destroy();
  });

  it('constructs a client from a ChatClientConfig exactly once, however many injections there are', () => {
    const createChatClientSpy = vi.spyOn(core, 'createChatClient');
    const host = createAngularTestHost([provideChatClient(buildConfig())]);

    const first = host.injector.get(CHAT_CLIENT);
    const second = host.injector.get(CHAT_CLIENT);

    expect(first).toBe(second);
    expect(createChatClientSpy).toHaveBeenCalledTimes(1);
    expect(host.injector.get(CHAT_STORE).state().connectionState).toBe('idle');

    createChatClientSpy.mockRestore();
    host.destroy();
  });

  it('resolves one shared ChatStore per injector, not one per injection', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);

    expect(host.injector.get(CHAT_STORE)).toBe(host.injector.get(CHAT_STORE));
    expect(client.__harness.subscriberCount(), 'and it subscribed exactly once').toBe(1);

    host.destroy();
  });

  it('names the fix when it was never called, instead of failing as a bare missing provider', () => {
    const host = createAngularTestHost();

    expect(() => host.injector.get(CHAT_CLIENT)).toThrow(/provideChatClient/);

    host.destroy();
  });
});

describe('injector teardown', () => {
  it("drops the store's client subscription when the injector is destroyed", () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);

    host.injector.get(CHAT_STORE);
    expect(client.__harness.subscriberCount()).toBe(1);

    host.destroy();
    expect(client.__harness.subscriberCount()).toBe(0);
  });

  it('leaves the client itself connected — this package never invents connection lifecycle', () => {
    const client = createConformanceChatClient();
    const disconnect = vi.spyOn(client, 'disconnect');
    const host = createAngularTestHost([provideChatClient(client)]);

    host.injector.get(CHAT_STORE);
    host.destroy();

    expect(disconnect, 'destroying the injector must not close the app-owned connection').not.toHaveBeenCalled();
  });
});

describe('route-level scoping', () => {
  it('a child injector gets its own client and store, and destroying it leaves the parent working', async () => {
    const appClient = createConformanceChatClient({ unreadCount: 1 });
    const routeClient = createConformanceChatClient({ unreadCount: 2 });

    const app = createAngularTestHost([provideChatClient(appClient)]);
    const route = createEnvironmentInjector([provideChatClient(routeClient)], app.injector);

    const appStore = app.injector.get(CHAT_STORE);
    const routeStore = route.get(CHAT_STORE);

    expect(routeStore).not.toBe(appStore);
    expect(appStore.unreadCount()).toBe(1);
    expect(routeStore.unreadCount()).toBe(2);

    route.destroy();
    expect(routeClient.__harness.subscriberCount(), 'the route subtree cleaned itself up').toBe(0);
    expect(appClient.__harness.subscriberCount(), 'and left the outer one alone').toBe(1);

    appClient.__harness.setState({ unreadCount: 5 });
    await appClient.__harness.flushMicrotasks();
    expect(appStore.unreadCount()).toBe(5);

    app.destroy();
    expect(appClient.__harness.subscriberCount()).toBe(0);
  });
});

describe('inject helpers', () => {
  it('injectChatStore()/injectChatClient() resolve the same objects as the tokens', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);

    runInInjectionContext(host.injector, () => {
      expect(injectChatClient()).toBe(client);
      expect(injectChatStore()).toBe(host.injector.get(CHAT_STORE));
    });

    host.destroy();
  });
});

describe('ChatStore.on inside an injection context', () => {
  it("adopts the caller's DestroyRef and unsubscribes with it", () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);
    const store = host.injector.get(CHAT_STORE);

    const seen: unknown[] = [];
    runInInjectionContext(host.injector, () => {
      store.on('typing', (payload) => seen.push(payload));
    });

    expect(client.__harness.eventListenerCount('typing')).toBe(1);
    client.__harness.emit('typing', { isTyping: true, participantId: 'p1' });
    expect(seen).toHaveLength(1);

    host.destroy();

    expect(client.__harness.eventListenerCount('typing'), 'destroying the context must have unsubscribed it').toBe(0);
  });

  it('honours an explicitly supplied DestroyRef over the ambient one', () => {
    const client = createConformanceChatClient();
    const outerHost = createAngularTestHost([provideChatClient(client)]);
    const innerHost = createAngularTestHost();
    const store = outerHost.injector.get(CHAT_STORE);

    runInInjectionContext(outerHost.injector, () => {
      store.on('typing', () => {}, { destroyRef: innerHost.injector.get(DestroyRef) });
    });

    expect(client.__harness.eventListenerCount('typing')).toBe(1);

    // The ambient context is still alive; the one that was named is not.
    innerHost.destroy();
    expect(client.__harness.eventListenerCount('typing'), 'the SUPPLIED DestroyRef is what governs').toBe(0);

    outerHost.destroy();
  });

  it('degrades to caller-owned teardown outside any injection context, rather than throwing NG0203', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);
    const store = host.injector.get(CHAT_STORE);

    // No `runInInjectionContext` — this is a plain function call.
    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = store.on('typing', () => {});
    }).not.toThrow();

    expect(client.__harness.eventListenerCount('typing')).toBe(1);
    unsubscribe?.();
    expect(client.__harness.eventListenerCount('typing')).toBe(0);

    host.destroy();
  });

  it('passing destroyRef: null opts out of the ambient context', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);
    const ambient = createAngularTestHost();
    const store = host.injector.get(CHAT_STORE);

    let unsubscribe: (() => void) | undefined;
    runInInjectionContext(ambient.injector, () => {
      unsubscribe = store.on('typing', () => {}, { destroyRef: null });
    });

    ambient.destroy();
    expect(client.__harness.eventListenerCount('typing'), 'opted out — the ambient context does not own it').toBe(1);

    unsubscribe?.();
    expect(client.__harness.eventListenerCount('typing')).toBe(0);

    host.destroy();
  });

  it('the store still owns every handler it registered — destroy() leaves nothing on the client', () => {
    const client = createConformanceChatClient();
    const host = createAngularTestHost([provideChatClient(client)]);
    const store = host.injector.get(CHAT_STORE);

    // Neither of these has any other owner: no injection context, and one
    // explicitly opted out.
    store.on('typing', () => {});
    store.on('message', () => {}, { destroyRef: null });
    expect(client.__harness.eventListenerCount('typing')).toBe(1);
    expect(client.__harness.eventListenerCount('message')).toBe(1);

    host.destroy();

    expect(client.__harness.eventListenerCount('typing')).toBe(0);
    expect(client.__harness.eventListenerCount('message')).toBe(0);
  });
});
