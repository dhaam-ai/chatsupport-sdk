# `@dhaam-ccrm/core`

The framework-agnostic heart of the chat SDK. Transport, auth, connection state
machine, message ordering and dedup, offline send queue, presence and unread
watermarks — as plain TypeScript, with **zero framework, UI and DOM-document
dependencies** and zero runtime dependencies.

If you use React, Vue or Angular you still install this package: the bindings
(`@dhaam-ccrm/react`, `/vue`, `/angular`, `/js`) are thin projections of the
store this package owns, and they declare it as a **peer dependency** so there
is exactly one copy of it in your tree.

> This package takes a **publishable** key (`dhpk_live_…`), which identifies a
> tenant and grants nothing on its own. It is safe to ship to a browser. The
> secret key (`dhsk_…`) belongs to [`@dhaam-ccrm/node`](../node) and runs only
> on your own server. There is no dependency edge between these two packages in
> either direction — deliberately.

## Install

```sh
npm install @dhaam-ccrm/core
```

## Minimal working example

Core does not do HTTP. It declares seams — `history`, `uploader`,
`sessionActions` — and [`@dhaam-ccrm/rest`](../rest) implements them over
`fetch`. It also never fetches your token: you supply `getToken`, and core owns
*when* it is called (before the first connect, before every reconnect, and on
proactive and reactive refresh).

```ts
import { createChatClient, createTokenProvider, type ChatMessage } from '@dhaam-ccrm/core';
import { RestClient, createHistorySource } from '@dhaam-ccrm/rest';

const rest = new RestClient({
  apiUrl: 'https://api.example.com',
  publishableKey: 'dhpk_live_…',
  // Your own endpoint, authenticated by your own session — never chat-service directly.
  getAccessToken: async () => (await (await fetch('/api/token', { method: 'POST' })).json()).accessToken,
});

const client = createChatClient({
  publishableKey: 'dhpk_live_…',
  wsUrl: 'wss://ws.example.com',
  getToken: createTokenProvider(async () => (await fetch('/api/token', { method: 'POST' })).json()),
  localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
  history: createHistorySource<ChatMessage>(rest),
});

client.subscribe((state) => {
  console.log(state.connectionState, state.messages.length);
});

await client.connect();
await client.sendMessage('Hello');
```

`getToken` must return a **fresh** token each call. Returning a cached one
defeats the refresh entirely — core would reinstall the same expiring
credential forever.

## What core owns, and what it does not

| Core owns | You supply |
|---|---|
| Reconnect and backoff, connection state machine | `getToken` — a token from *your* endpoint |
| Message ordering, dedup, tick state | `history` / `uploader` / `sessionActions` (see `@dhaam-ccrm/rest`) |
| Offline send queue and retention | `storage` (defaults to browser storage) |
| Presence, typing, unread watermarks | *when* to report a read (a DOM question core cannot answer) |

`state` is a synchronous, reference-stable snapshot: `getState()` plus
`subscribe()` is exactly `useSyncExternalStore`'s contract, and every binding is
built on that pair and nothing else.

## Credentials

No credential is ever passed to `logger` or included in any log line core
emits, and no error raised by this package contains credential material — not a
token, nor any prefix, length or digest of one. `parsePublishableKey` throws
`SecretKeyInClientError` if you hand it a secret key, so a paste-into-the-wrong-
config-field mistake fails loudly at startup rather than silently shipping.

## License

MIT
