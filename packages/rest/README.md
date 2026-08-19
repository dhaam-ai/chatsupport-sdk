# `@dhaam-ccrm/rest`

`fetch`-based REST adapters for the seams [`@dhaam-ccrm/core`](../core)
declares but deliberately does not implement: message history, attachment
upload, and session actions.

Core owns the WebSocket, the state machine and the queue. It does **not** do
HTTP — that is an injected dependency, so a host can supply its own transport,
its own retry policy, or a mock. This package is the default implementation of
that seam.

## Install

```sh
npm install @dhaam-ccrm/rest
```

Zero runtime dependencies — `fetch` is built in on Node 18+ and every supported
browser.

> **No dependency on `@dhaam-ccrm/core`, in either direction.** The adapters
> satisfy core's interfaces *structurally*: the wire shapes are declared locally
> rather than imported. So this package installs and is usable on its own, and
> upgrading core does not force an upgrade here.

## Minimal working example

```ts
import {
  RestClient,
  createHistorySource,
  createAttachmentUploader,
  createSessionActions,
} from '@dhaam-ccrm/rest';
// The wire types are the consumer's own. If you use core, they are core's;
// this package does not import them, which is why it has no core dependency.
import type { ChatMessage, ChatSession, AttachmentMetadata } from '@dhaam-ccrm/core';

const rest = new RestClient({
  apiUrl: 'https://api.example.com',
  publishableKey: 'dhpk_live_…',
  // Called once per HTTP request. Core never exposes the token it is currently
  // using, so keep your own copy and hand it to both core and this client.
  getAccessToken: async () => (await (await fetch('/api/token', { method: 'POST' })).json()).accessToken,
});

// Hand these straight to createChatClient(...).
// The explicit type arguments are load-bearing: these factories are generic
// over the wire shape and infer `unknown` without them, which then fails to
// satisfy core's `MessageHistorySource`.
const history = createHistorySource<ChatMessage>(rest);
const uploader = createAttachmentUploader<AttachmentMetadata>(rest);
const sessionActions = createSessionActions<ChatSession>(rest);
```

## Errors

| Type | Means |
|---|---|
| `RestApiError` | The server evaluated the request and said no. Retrying it unchanged is usually pointless. |
| `RestTransportError` | The request never produced a verdict — DNS, connection refused, TLS, abort. Retrying is exactly right. |

They are separate types because collapsing them is how a client retries a
rejected request forever, or gives up on a transient blip.

## License

MIT
