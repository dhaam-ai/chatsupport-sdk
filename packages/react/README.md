# `@dhaam-ccrm/react`

React bindings for [`@dhaam-ccrm/core`](../core) — `useSyncExternalStore` hooks
over one `ChatClient` instance, and nothing else. No reconnect, backoff, dedup,
ordering, queueing, token-refresh or watermark logic lives here; all of it is
core's, and is tested there.

Every type below is a type-only re-export from core, never a hand-copied shape.

## Install

```sh
npm install @dhaam-ccrm/react @dhaam-ccrm/core
```

`@dhaam-ccrm/core` is a **peer dependency**, not a bundled one. That matters:
this package re-exports core's error classes as runtime values, so two copies of
core in one tree would make `err instanceof ChatClientConfigError` silently
false. React 18+ is likewise a peer (`useSyncExternalStore`).

## Minimal working example

```tsx
import { ChatProvider, useMessages, useChatState } from '@dhaam-ccrm/react';
import { createTokenProvider, type ChatMessage } from '@dhaam-ccrm/core';
import { RestClient, createHistorySource } from '@dhaam-ccrm/rest';

const rest = new RestClient({
  apiUrl: 'https://api.example.com',
  publishableKey: 'dhpk_live_…',
  getAccessToken: async () => (await (await fetch('/api/token', { method: 'POST' })).json()).accessToken,
});

const config = {
  publishableKey: 'dhpk_live_…',
  wsUrl: 'wss://ws.example.com',
  getToken: createTokenProvider(async () => (await fetch('/api/token', { method: 'POST' })).json()),
  localSender: { senderId: 'user_123', senderType: 'CUSTOMER' },
  history: createHistorySource<ChatMessage>(rest),
};

function Conversation() {
  const { messages, sendMessage } = useMessages();
  const { connectionState } = useChatState();

  return (
    <>
      <span>{connectionState}</span>
      <ul>{messages.map((m) => <li key={m.id}>{m.content}</li>)}</ul>
      <button onClick={() => sendMessage('Hello')}>Send</button>
    </>
  );
}

export function App() {
  // Build the config once. ChatProvider resolves its `client` prop on first
  // render only, so a new object every render is ignored, not re-applied.
  return (
    <ChatProvider client={config}>
      <Conversation />
    </ChatProvider>
  );
}
```

`ChatProvider` accepts either a `ChatClientConfig` (it constructs the client) or
a `ChatClient` you built yourself.

## Hooks

| Hook | Gives you |
|---|---|
| `useChatClient()` | The `ChatClient` from context |
| `useChatState()` | The whole `ChatState` snapshot |
| `useChatSelector(fn, isEqual?)` | A memoised slice; re-renders only when the slice changes |
| `useMessages()` | `messages`, `sendMessage`, `sendAttachment`, `loadOlderMessages` |
| `useChannel()` | Session lifecycle — connect, reopen, close |
| `useTypingIndicator()` | Who is typing, plus a debounced emitter |
| `useUnreadCount()` | Unread count from core's watermarks |
| `useChatError()` | The last `ChatError` |
| `useReadTracker()` | Reports reads when rows are actually on screen |
| `useVoiceRecorder()` | `MediaRecorder` capture with amplitude |

The DOM-side hooks (`useReadTracker`, `useVoiceRecorder`) are SSR-safe: no
`window`, `navigator`, `IntersectionObserver` or `MediaRecorder` is touched at
module scope or during a render pass — only inside effects and event handlers.

## Browser primitives

Voice recording, waveform decode, and read tracking are implemented in
[`@dhaam-ccrm/browser`](../browser), a framework-free package with zero
dependencies. The React hooks here (`useVoiceRecorder`, `useAudioWaveform`,
`useReadTracker`) are thin wrappers that wire those state machines to component
lifecycle. This separation exists because `@dhaam-ccrm/js` compiles without the
DOM lib — these primitives could not live there, and living in React only would
mean Vue and Angular had to re-implement or import React. Installing
`@dhaam-ccrm/browser` is automatic when you install this package.

## Ticks

Message delivery state (sent / delivered / read) is derived from core's
snapshot, not re-implemented here. Core's `deriveTickState` and
`deriveTickStateFromState` are re-exported so a React consumer never needs a
second import specifier:

```tsx
import { useMessages, deriveTickStateFromState } from '@dhaam-ccrm/react';
import { useChatState } from '@dhaam-ccrm/react';

function MessageRow({ messageId }) {
  const { state } = useChatState();
  const tick = deriveTickStateFromState(state, messageId, localParticipantId);
  return <span>{tick}</span>;
}
```

The same `deriveTickStateFromState` is available from every binding and from
core; there is one implementation and nothing drifts.

## License

MIT
