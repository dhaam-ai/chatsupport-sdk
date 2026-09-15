# `@dhaam-ccrm/react`

React bindings for [`@dhaam-ccrm/core`](../core) — `useSyncExternalStore` hooks
over one `ChatClient` instance, and nothing else. No reconnect, backoff, dedup,
ordering, queueing, token-refresh or watermark logic lives here; all of it is
core's, and is tested there.

Every type below is a type-only re-export from core, never a hand-copied shape.

## Install

```sh
npm install @dhaam-ccrm/react @dhaam-ccrm/core @dhaam-ccrm/widget
```

`@dhaam-ccrm/core` is a **peer dependency**, not a bundled one. That matters:
this package re-exports core's error classes as runtime values, so two copies of
core in one tree would make `err instanceof ChatClientConfigError` silently
false. React 18+ is likewise a peer (`useSyncExternalStore`).

`@dhaam-ccrm/widget` is a peer for the same reason and is required even if you
only use the hooks: [`<DhaamForm>`](#web-form-at-a-route) is exported from this
package's single entry point, so the import exists whether or not you render it.
Bundlers drop the code itself if you never use it — but the package has to be
installed for the import to resolve.

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

## Web form at a route

> **Focus on a route change is yours, not ours.** This component does not move
> focus when it mounts — auto-focusing a form on every route render is itself a
> problem for keyboard and screen-reader users, who expect focus at the top of
> the new view. Use whatever focus-target or skip-link convention your router
> already has.

`<DhaamForm>` is the standalone web form — no chat widget, no launcher, no
socket, no session, no token mint. Its only credential is the publishable key,
which authenticates nothing on its own, so it is safe in a page any visitor can
read. Mount it at a route of your own app:

```tsx
import { DhaamForm } from '@dhaam-ccrm/react';
import { Route, Routes } from 'react-router-dom';

export function App() {
  return (
    <Routes>
      <Route
        path="/contact"
        element={
          <DhaamForm
            publishableKey="dhp_live_…"
            apiUrl="https://chat.example.com"
            className="contact-form"
            onSubmitted={(receipt) => track('contact_form_sent', receipt.receiptId)}
          />
        }
      />
    </Routes>
  );
}
```

react-router is only the example — the component has no router dependency and
works under any of them, or under none: a route here is just "rendered while the
visitor is on that page."

| Prop | |
|---|---|
| `publishableKey` | Required. `dhp_…`. Changing it remounts the form |
| `apiUrl` | Required. Origin of chat-service. Named exactly as `mountForm`'s own option, not renamed |
| `className` | Applied to the host `<div>`, for your own layout and width |
| `onSubmitted` | Fired once, after an accepted submission, with the receipt |
| `onError` | Diagnostics for **you**. Never shown to the visitor |

The form itself — its markup, styles, honeypot, field caps and error copy —
comes from [`@dhaam-ccrm/widget`](../widget)'s `mountForm`, unchanged. This
component adds the one thing a route needs and that package cannot have an
opinion about: mounting and unmounting on your navigation.

**What unmounting guarantees.** Navigating away removes the form *and* aborts
the boot read it started, so nothing lands on a page the visitor has left.
Coming back to the route mounts exactly one form. Nothing is left on `window` or
`document` — the form's own listeners live inside its shadow root and leave with
it.

**StrictMode.** React 18's dev double-invoke (mount → cleanup → mount) leaves one
form and one live boot read, and reports nothing to `onError`.

**Server rendering.** Safe: no `window`/`document` is touched at module scope or
during render, and the server emits just the empty host `<div>` that the client
fills in. Nothing is validated during a server render either — a bad key fails in
the browser, where the credential would actually have been exposed, not in your
build.

**A secret key stops the mount.** Passing `dhk_`/`dhsk_`/`sk_` where the
publishable key belongs throws a `FormConfigError` out of the effect rather than
being quietly reported: a secret key in a page any visitor can read is not
something to degrade gracefully around.

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
