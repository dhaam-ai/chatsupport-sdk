# @dhaam-ccrm/vue

Vue 3 composables over one `@dhaam-ccrm/core` `ChatClient`. Thin by construction:
this package maps core's observable store onto Vue's reactivity and delegates
operations. It contains no WebSocket, REST, reconnect, backoff, dedup, ordering,
queueing, token-refresh or watermark logic — all of that is core's, and is tested
there.

Conformance: this binding passes the shared
[`@dhaam-ccrm/binding-conformance`](../binding-conformance) suite (18/18, no
skips), which is what makes "React, Vue, Angular and vanilla behave identically"
(PRD §15) checkable rather than merely asserted.

## Install

```sh
pnpm add @dhaam-ccrm/vue @dhaam-ccrm/core
```

`vue` is a **peer dependency**, `>=3.3.0 <4` — see "Minimum Vue version" below.

## Providing the client

```ts
import { createApp } from 'vue';
import { createChatPlugin } from '@dhaam-ccrm/vue';

const chat = createChatPlugin({
  publishableKey: 'dhp_live_…',
  getToken: async () => (await fetch('/api/chat-token')).text(),
  localSender: { senderId: currentUserId, senderType: 'CUSTOMER' },
  history: { listMessages },
});

createApp(App).use(chat).mount('#app');
await chat.client.connect();
```

`createChatPlugin` accepts either a `ChatClient` you built yourself or a
`ChatClientConfig` to build one from. For a client scoped to one subtree — two
widgets, two tenants — call `provideChatClient(clientOrConfig)` in a `setup()`
instead.

## Composables

| Composable | Returns |
| --- | --- |
| `useChatSelector(selector, isEqual?)` | `Readonly<ShallowRef<T>>` — the primitive everything else is built on |
| `useChatState()` | `Readonly<ShallowRef<ChatState>>` — the escape hatch |
| `useChannel()` | `connectionState`, `session`, `pastSessions`, `lastError` + `connect`/`disconnect`/`joinSession`/`leaveSession`/`requestAgent`/`reopenSession`/`closeSession` |
| `useMessages()` | `messages`, `pagination`, `uploading` + `sendMessage`/`sendAttachment`/`loadOlderMessages` |
| `useTypingIndicator()` | `isTyping`, `participantId` + `startTyping`/`stopTyping` |
| `useUnreadCount()` | `unreadCount` + `markRead` |
| `useChatError()` | `Readonly<ShallowRef<ChatError \| null>>` |
| `useMessageTicks(localParticipantId)` | `ComputedRef<ReadonlyMap<messageId, MessageTickState>>` |
| `useChatEvent(event, handler)` | unsubscribe; registers a §6.5 event handler for the scope's lifetime |
| `useChatClient()` | the raw `ChatClient` |

Every state value is a ref; every action is a plain function.

```vue
<script setup lang="ts">
import { useMessages, useMessageTicks, useTypingIndicator } from '@dhaam-ccrm/vue';

const { messages, sendMessage } = useMessages();
const { isTyping } = useTypingIndicator();
const ticks = useMessageTicks(props.participantId);
</script>

<template>
  <li v-for="m in messages" :key="m.id">
    {{ m.content }}
    <Tick v-if="ticks.get(m.id)" :state="ticks.get(m.id)!" />
  </li>
  <p v-if="isTyping">typing…</p>
</template>
```

## Three decisions worth knowing

**`shallowRef`, not `ref`, not `computed`.** Core's snapshots are immutable and
replaced wholesale, so deep reactivity has nothing to observe: `ref()` would
proxy every message on every update, and would hand a consumer a proxy rather
than the object core produced — breaking every reference comparison against a
raw slice. `computed()` cannot express a custom equality, so a selector that
builds an object would notify on every store change. A `shallowRef` written only
when `isEqual` says the selected value changed is exact and version-independent.
See `src/use-chat-selector.ts`.

**One ref per field, not one ref per composable.** React must select
`{ connectionState, session, pastSessions, lastError }` as one composite with a
shallow equality, because a component re-renders as a unit. Vue's unit of
invalidation is the ref, so `useChannel()` is four independent selectors and a
template rendering only `{{ connectionState }}` is untouched when `pastSessions`
changes. The cost is four `Set` entries.

**`onScopeDispose`, not `onUnmounted`.** `onUnmounted` needs a component
instance; called from a Pinia store, a bare `effectScope()`, or after an `await`
in an async `setup()`, it registers nothing and the subscription outlives its
consumer. `onScopeDispose` covers both. To call a composable with no component at
all, wrap it: `app.runWithContext(() => scope.run(() => useUnreadCount()))`.

## SSR / Nuxt

Nothing in this package touches `window` or `document` — not at module scope, not
anywhere. `createChatClient()` opens no socket, and no composable calls
`connect()`; a server render produces the initial snapshot and nothing else.
`packages/vue/test/ssr.test.ts` runs in Node with no DOM to prove it.

Build the `ChatClient` per request on the server, as you would any per-user
object: Vue never unmounts a server-rendered tree, so nothing stops the effect
scopes a render created, and a client shared across requests would accumulate
their subscriptions (as well as leaking one user's session to another).

## Minimum Vue version

`>=3.3.0`. `shallowRef`, `effectScope` and `onScopeDispose` are all 3.2, but
`toValue`/`MaybeRefOrGetter` (which is what lets `useMessageTicks` take a ref,
getter or plain value for the local participant id) and `app.runWithContext()`
(the supported way to run an injecting composable outside a `setup()`, which this
package's own error message points callers at) both landed in 3.3. Tested against
3.5.
