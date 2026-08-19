# `@dhaam-ccrm/js`

The framework-free binding for `@dhaam-ccrm/core`. A tiny imperative store over one
`ChatClient`: selector subscriptions with pluggable equality, event subscriptions,
core's tick derivation, and one call that tears it all down.

- **Zero runtime dependencies**, matching core.
- **No DOM anywhere.** `tsconfig.json` drops the `DOM` lib, so a `window` or `document`
  reference in `src/` is a compile error rather than a review comment. Imports cleanly in
  Node, under SSR, and in a worker.
- **~1.1 KB gzipped** for the whole barrel; ~1.05 KB for what a widget actually imports.
  Run `pnpm size` for the current numbers.
- **Nothing at module scope.** Importing this package registers no listener, reads no
  global, and starts no timer.

It renders nothing. Rendering is the widget layer's job; this is the reactivity
primitive that layer is built on.

## Quickstart

```js
import { createChat, shallowEqual } from '@dhaam-ccrm/js';

const chat = createChat({ publishableKey: 'dhp_live_…', getToken, localSender, history });

// A slice, with the equality that suits it. The listener fires only when the
// selected value changes — not on every state change.
const stopMessages = chat.select(
  (state) => state.messages,
  (messages, previous) => {
    renderMessages(messages);
    if (messages.length > previous.length) scrollToBottom();
  },
  { immediate: true },
);

// A composite selector builds a new object every call, so tell it how to compare.
chat.select(
  (state) => ({ connected: state.connectionState === 'connected', unread: state.unreadCount }),
  ({ connected, unread }) => renderBubble(connected, unread),
  { isEqual: shallowEqual, immediate: true },
);

// §6.5 events.
chat.on('sendFailed', ({ id, reason }) => showRetry(id, reason));

// Every §6.2/§6.3 operation is on the client itself — this package does not restate them.
await chat.client.connect();
await chat.client.sendMessage('hello');

stopMessages();
chat.destroy({ disconnect: true });
```

Already have a `ChatClient`? Use `createChatStore(client)` instead — it is the same store
without a binding to core's client factory, so a bundler drops that factory from your build.

## API

| Member | What it does |
| --- | --- |
| `createChatStore(client, options?)` | Wraps an existing `ChatClient`. |
| `createChat(config, options?)` | Builds the client from a `ChatClientConfig` first. Its own module, so it tree-shakes away when unused. |
| `store.client` | The `ChatClient`. Every `connect`/`sendMessage`/`markRead`/… lives here. |
| `store.getState()` | Core's snapshot, unwrapped and un-cloned — including its reference stability. |
| `store.subscribe(listener, opts?)` | Every change to the whole snapshot. |
| `store.select(selector, listener, opts?)` | Changes to one slice, with `isEqual` and `immediate`. Returns an idempotent unsubscribe. |
| `store.on(event, handler)` | One §6.5 event. |
| `store.tick(messageId, localParticipantId)` | Core's `deriveTickStateFromState`, with the `messages` lookup done for you. |
| `store.destroy(opts?)` | Drops every subscription. `{ disconnect: true }` also closes the connection. |
| `strictEqual` / `shallowEqual` | The two comparators `select` accepts. |
| `deriveTickState` / `deriveTickStateFromState` / `MESSAGE_TICK_STATES` | Re-exported from core, unchanged. |

### Equality is the whole point

PRD §6.4 assigns field-level diffing to bindings: core guarantees a full, consistent
snapshot on every notification and does no diffing of its own. There is no framework here
to lean on, so `select` keeps a `{raw, selected}` cache per subscription and gates on it
twice — first on the snapshot reference (core keeps `getState()` identical while nothing
changed), then on `isEqual`. On an `isEqual` miss the **old** reference is kept, so a
downstream identity check also sees "unchanged".

`strictEqual` (`Object.is`, the default) is right for `s => s.messages`. Pass
`shallowEqual` for anything that builds a new object or array per call — without it,
every subscriber fires on every message.

### Errors go somewhere

A throw from your selector, equality function, listener, or event handler is caught at the
boundary, routed to `options.onError` (default: one `console.error`), and contained: the
other subscribers are unaffected and the failing one is re-evaluated normally on the next
snapshot. Core already isolates a throwing listener so it cannot break the store — but
isolation without reporting means a broken selector simply stops updating, silently.

### Ticks come from core

`store.tick` delegates to `deriveTickStateFromState`. There is no derivation in this
package to drift from core's: v1 rendered the double-grey tick from *presence*, which is a
statement about a socket rather than about a message, and one canonical implementation is
what stops that recurring once per framework. `localParticipantId` is required and never
guessed; `null` yields `null` for every message.

`tick(id, …)` is O(n) in `messages`. Rendering a whole list is better served by calling
`deriveTickState` once per message you are already iterating.

## Conformance

This package runs the full `@dhaam-ccrm/binding-conformance` suite — the mechanism PRD §15
needs so "every binding behaves identically" is more than prose — in a bare Node
environment, with no checks skipped. That includes
`tick-derivation-binding-owned-computation-agrees-with-core`, which `@dhaam-ccrm/react`
skips: `store.tick` is a binding-owned tick computation, so it is exactly what that check
(and the suite's permanent `wrong-ticks` fixture) exists to catch drifting.

```
pnpm --filter @dhaam-ccrm/js build
pnpm vitest run packages/js
pnpm --filter @dhaam-ccrm/js typecheck
pnpm --filter @dhaam-ccrm/js size
```

## What this package is not

No reconnect, backoff, dedup, ordering, queueing, token refresh, or watermark logic — all
of it is core's, tested there. `messages` is passed through in the order core hands it
over and is never re-sorted. `ChatClient`'s ~18 operations are reached through
`store.client` rather than re-declared here, so there is no second surface to keep in step
with §6.2/§6.3 and no bytes spent on delegation.
