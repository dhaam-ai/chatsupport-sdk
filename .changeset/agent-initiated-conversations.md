---
"@dhaam-ccrm/core": minor
"@dhaam-ccrm/widget": minor
---

Surface the conversation an agent starts with a customer who has no open
session.

A support agent can now open a chat from the console against a customer who is
not already talking to anyone. The server creates the session, moves that
customer's connection into it, and pushes the **existing** `session.updated`
frame carrying the new snapshot. Nothing on the wire changed and nothing needed
to: `SERVER_PUSH_FRAME_TYPES` is a closed catalog, `validate.ts` rejects any
unknown `t`, and the transport drops it with a warning — so a new frame type
would have meant a protocol version bump plus a coordinated server release.

Core already replaced the conversation wholesale on that frame (`commitSession`
plus `seedReplacedSession` for page one). The gap was that nothing told the app
it had happened, so a closed chat panel had no reason to open.

- **`conversationStarted`** (`@dhaam-ccrm/core`, §6.5) — `{ session,
  previousSessionId }`, emitted when a server-pushed `session.updated` names a
  session other than the one on screen. Disjoint from `statusChange` by
  construction, same id vs different id, so exactly one of the two fires per
  snapshot and no existing subscriber sees an extra occurrence. Emitted for
  `session.updated` only: a `connection.ack` resolving a different session is
  an ordinary reconnect and would fire on nearly every page load. Emitted after
  the commit, so a handler reading `ChatState` sees the conversation being
  announced rather than the one it replaced.

- **`openOnAgentInitiated`** (`@dhaam-ccrm/widget`, `data-open-on-agent-
  initiated`) — opens the panel for it. Defaults to **false**: a panel that
  opens itself covers the page the customer is actually using, moves focus into
  a composer they did not ask for, and on `sheet` takes the whole viewport, so
  it is the host's call to make per site.

- **`DhaamChat.on(event, handler)`** — the host-page subscription, generic over
  the whole §6.5 catalog rather than a hand-picked subset. Registrations are
  buffered and attached at mount: a `<script>` tag mounts on
  `DOMContentLoaded`, so the inline script a host writes next to it would
  otherwise subscribe against a null widget and be silently dropped.

Default-off had to stay honest, so the launcher carries it instead. Its badge
now shows for an unseen agent-initiated conversation as well as for
`unreadCount > 0` — the frame that starts a conversation is not a message, and
the first agent message can arrive on the seeded history page rather than as a
`message.new`, so `unreadCount` need not have moved at all. The state is also
in the launcher's accessible name, because the panel is `aria-hidden` while
closed and its live region cannot speak there.

Additive and backward compatible throughout. Every existing subscriber, config
and host-API method behaves exactly as before; `prefers-reduced-motion` needed
no change, since the open transition is CSS-driven off `data-open` and
ui/styles.ts already collapses `.dh-panel` transitions under it.
