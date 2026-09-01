---
"@dhaam-ccrm/core": minor
"@dhaam-ccrm/browser": minor
"@dhaam-ccrm/react": minor
"@dhaam-ccrm/widget": minor
---

Tell the customer their messages are safe while the network is gone, and stop
making them wait half a minute after it comes back.

The connection machinery was already right and the customer could not tell. A
dropped socket retries indefinitely (§8.2) and the durable queue flushes in
FIFO order on reconnect (§8.4) — but on screen, losing signal mid-sentence
produced a 12px grey caption under the title, and the sentence it could not fit
was the one that matters: *what happens to what I already typed*. So customers
stopped typing, and the queue that would have delivered their question the
moment their train left the tunnel never got used.

The second half was the wait. Full-jitter backoff is exactly right about
servers — it protects a restarting one from every client it dropped
reconnecting in lockstep — and exactly wrong about one handset leaving a
tunnel, which is not part of any herd and was made to sit out a delay that had
already grown to the 30-second cap. That is the "it just says Connecting…
forever" report.

- **`ChatClient.retryNow()`** (`@dhaam-ccrm/core`) — abandons an armed backoff
  and attempts immediately, reporting whether one started. Deliberately narrow,
  and deliberately not a second `connect()`: it settles no promise, leaves the
  auth escalation counter alone (a network blip is no evidence a rejected token
  was fixed), and resets only the transport attempt counter. It acts **only**
  in `reconnecting` — no socket open, a timer counting down — and no-ops
  everywhere else, including the `connecting` of an attempt already in flight
  and the `suspended`/`closed` that §8.1 makes recoverable by `connect()` alone.
  That one restriction is what lets everything below drive it on a timer
  without becoming the competing retry loop a binding must never be.

- **`createNetworkStatus`, `createReconnectPump`, `resolveOfflineBanner`,
  `countQueuedSends`** (`@dhaam-ccrm/browser`) — the platform's connectivity
  signal, a cadence that caps any armed backoff at three seconds and collapses
  it to zero on the browser's `online` event, and the single place the copy and
  the show/hide rule are written. One implementation, rendered as DOM by the
  widget and returned from a hook by React, rather than two that disagree about
  the same socket the first time either is edited.

- **The bar itself** — `@dhaam-ccrm/widget` draws it under the header, across
  every screen; `@dhaam-ccrm/react` ships `useOfflineBanner()` plus an optional
  `<OfflineBanner />` (the one rendered component in an otherwise headless
  package, because the bar is the SDK's own promise about its own queue, and
  every host writing that div themselves is every host getting a chance to skip
  it). It names the count — "You're offline. 3 messages will send when you're
  back online." — and **the composer stays enabled underneath it**, which is
  what makes the promise true rather than decorative.

Two judgement calls worth knowing about. `navigator.onLine === false` now
outranks a `connected` socket: a route that has gone leaves a half-open socket
reporting itself open for tens of seconds on mobile, and the customer is typing
into it the whole time. The reverse is not symmetric — `onLine === true` is not
evidence of anything (a hotel wifi nobody paid for, a dropped VPN), so it never
suppresses the bar on its own. And nothing appears for a single failed attempt:
one blip is a wifi handover the client fixes inside a second, and a banner per
reconnect teaches customers to ignore banners.

Additive throughout. No existing state field, event, config option or default
changed.
