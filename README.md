# Chat SDK — Multi-binding implementation

A modular chat SDK with zero dependencies, built from framework-free core, bindings for React/Vue/Angular/vanilla JS, and pluggable HTTP transports.

---

## Packages

| Package | Purpose | Size | Dependencies |
|---------|---------|------|---|
| **`@dhaam-ccrm/core`** | Transport, auth, state machine, connection/offline queue, presence, watermarks | 17.4 KB | none |
| **`@dhaam-ccrm/js`** | Framework-free binding: selector subscriptions, event subscriptions | 1.1 KB | `core` |
| **`@dhaam-ccrm/browser`** | Voice recording, waveform decode, read tracking — framework-agnostic | — | none |
| **`@dhaam-ccrm/react`** | React 18+ hooks: `useMessages`, `useUnreadCount`, `useVoiceRecorder`, etc. | — | `core`, React 18+ |
| **`@dhaam-ccrm/vue`** | Vue 3.3+ composables: `useMessages`, `useUnreadCount`, `useVoiceRecorder`, etc. | — | `core`, Vue 3.3+ |
| **`@dhaam-ccrm/angular`** | Angular 18+ signal stores, DI integration | — | `core`, Angular 18+ |
| **`@dhaam-ccrm/rest`** | `fetch`-based HTTP adapters: history, attachment upload, session actions | — | none |
| **`@dhaam-ccrm/node`** | Backend SDK: token minting, webhook verification (Node 18+) | — | none |
| **`@dhaam-ccrm/widget`** | Embeddable HTML/CSS/JS widget, no build step required | 32.6 KB | `core` |
| **`@dhaam-ccrm/binding-conformance`** | Test suite: every binding behaves identically | — | test-only |

---

## Feature parity matrix

Every binding implements the same semantics. **Transcription is not supported anywhere.**

| Feature | Core | React | Vue | Angular | JS | Widget |
|---------|------|-------|-----|---------|----|----|
| **Send text message** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **File attachment upload** | seam | ✓ | ✓ | ✓ | seam | ✓ |
| **Delivery ticks** (sent/delivered/read) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Unread count** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Mark read** (manual API) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Auto mark-read on scroll** | — | ✓ | ✓ | ✓ | — | — |
| **Voice recording** | — | ✓ | ✓ | ✓ | — | ✓ |
| **Waveform decode** | — | ✓ | ✓ | ✓ | — | — |
| **Typing indicator** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Presence** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Voice transcription** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Symbols:**
- ✓ = implemented and exported  
- — = not applicable (not a binding, or DOM-dependent feature)  
- seam = core declares the interface; you wire the HTTP implementation  
- ✗ = deliberately not supported anywhere

---

## Architecture

**Core owns everything stateful:** message ordering, dedup, the offline queue, token refresh, connection lifecycle and backoff, typing and presence subscriptions, read/delivery watermarks.

**Bindings own only reactivity projection:** mapping core's synchronous, reference-stable snapshot store onto React/Vue/Angular renders, or the vanilla `subscribe()` callback. No logic lives here.

**DOM primitives (`@dhaam-ccrm/browser`) live separately** because `@dhaam-ccrm/js` compiles without the `DOM` lib (to stay Node-safe), which meant voice recording, waveform decode, and read tracking could not live there. This package owns the state machines; bindings own the wiring to lifecycle.

**HTTP is a seam:** core declares `MessageHistorySource`, `AttachmentUploader`, `SessionActions` as interfaces. `@dhaam-ccrm/rest` implements them via `fetch`, but you can supply your own (mock, different transport, different auth seam, etc.).

---

## Quick start

### React

```tsx
import { ChatProvider, useMessages, useUnreadCount } from '@dhaam-ccrm/react';
import { createChatClient } from '@dhaam-ccrm/core';
import { RestClient, createHistorySource } from '@dhaam-ccrm/rest';

const rest = new RestClient({
  apiUrl: 'https://api.example.com',
  publishableKey: 'dhpk_live_…',
  getAccessToken: () => fetch('/api/token').then((r) => r.json()).then((j) => j.accessToken),
});

export function App() {
  return (
    <ChatProvider
      client={{
        publishableKey: 'dhpk_live_…',
        wsUrl: 'wss://ws.example.com',
        getToken: () => fetch('/api/token').then((r) => r.json()),
        localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
        history: createHistorySource(rest),
      }}
    >
      <Conversation />
    </ChatProvider>
  );
}

function Conversation() {
  const { messages, sendMessage } = useMessages();
  const { unreadCount, markRead } = useUnreadCount();

  return (
    <>
      <span>{unreadCount}</span>
      <ul>{messages.map((m) => <li key={m.id}>{m.content}</li>)}</ul>
      <button onClick={() => sendMessage('Hi')}>Send</button>
    </>
  );
}
```

### Vue

```ts
import { createChatPlugin, useMessages, useUnreadCount } from '@dhaam-ccrm/vue';
import { createApp } from 'vue';

const chat = createChatPlugin({
  publishableKey: 'dhpk_live_…',
  wsUrl: 'wss://ws.example.com',
  getToken: () => fetch('/api/token').then((r) => r.json()),
  localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
  history: { listMessages: (opts) => api.listMessages(opts) },
});

createApp(App).use(chat).mount('#app');
```

### Angular

```ts
import { provideChatClient } from '@dhaam-ccrm/angular';
import { bootstrapApplication } from '@angular/platform-browser';

bootstrapApplication(AppComponent, {
  providers: [
    provideChatClient({
      publishableKey: 'dhpk_live_…',
      wsUrl: 'wss://ws.example.com',
      getToken: () => fetch('/api/token').then((r) => r.json()),
      localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
      history: { listMessages: (opts) => api.listMessages(opts) },
    }),
  ],
});
```

### Vanilla JS

```ts
import { createChat } from '@dhaam-ccrm/js';

const chat = createChat({
  publishableKey: 'dhpk_live_…',
  wsUrl: 'wss://ws.example.com',
  getToken: () => fetch('/api/token').then((r) => r.json()),
  localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
  history: { listMessages: (opts) => api.listMessages(opts) },
});

chat.select(
  (state) => state.messages,
  (messages) => render(messages),
  { immediate: true },
);

await chat.client.sendMessage('Hello');
```

---

## Docs

- **[`@dhaam-ccrm/core`](packages/core)** — transport, auth, state machine
- **[`@dhaam-ccrm/js`](packages/js)** — framework-free binding
- **[`@dhaam-ccrm/browser`](packages/browser)** — voice, waveform, read tracking
- **[`@dhaam-ccrm/react`](packages/react)** — React hooks
- **[`@dhaam-ccrm/vue`](packages/vue)** — Vue composables
- **[`@dhaam-ccrm/angular`](packages/angular)** — Angular signal stores
- **[`@dhaam-ccrm/rest`](packages/rest)** — HTTP adapters
- **[`@dhaam-ccrm/widget`](packages/widget)** — embeddable widget
- **[`@dhaam-ccrm/node`](packages/node)** — backend token minting
- **[Architecture decisions](docs/adr)** — D1-D4 and rationale
- **[Project state](docs/spec/STATE.md)** — branches, test coverage, known gaps
- **[v1 → v2 migration](docs/MIGRATION-v1-to-v2.md)** — what moved, and where
- **[v1 integration guide](docs/v1-integration-guide.md)** — archived. This file
  was the root README until v2 replaced it; v1 is kept as the UI reference, so
  its guide is kept with it rather than deleted.

---

## License

MIT
