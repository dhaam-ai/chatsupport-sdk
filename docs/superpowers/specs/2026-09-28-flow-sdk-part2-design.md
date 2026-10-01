# SDK integration for the server-side flow engine (Part 2) — Design

Source contract: `chat-service-node/docs/specs/chatbot-workflows-commerce.md` §4 (visitor events),
§6 (invites), §8 (bot message metadata). Continues Part 1
(`2026-09-26-flow-sdk-contract-design.md`), which shipped page context, buttons, and input hints.

## Ground rule from the contract (unchanged from Part 1)

Flows run on chat-service-node. The SDK never executes flows. The SDK (a) tells the server
what happened (page, now events too), and (b) renders what the bot sends (text, now cards too).

## Why now

Of the 9 flow templates in `chatsupport-react/app/lib/settings/flows/templates.ts`, 4 use an
`event` trigger (Search found nothing, About to leave with a cart, Cart idle, Out of stock) and
3 of those need product/discount/order cards. None of this reaches a visitor today: the widget
never sends `visitor.event`, never renders a `flow.invite`, and has no renderer for
`metadata.products` / `metadata.discount` / `metadata.order`. The 4 page/open-trigger templates
(Checkout help, Payment failed, Where is my order except its order card, While we're closed)
already work from Part 1.

**The backend is already done.** `chat-service-node/src/api/websocket/v2/protocol/types.ts`
already defines `visitor.event`, `flow.invite`, `flow.inviteDismissed` on the wire, and
`chat-service-node/src/application/flows/flow-messages.ts` already emits `metadata.products`,
`metadata.discount`, `metadata.order` for the corresponding steps. This is a client-only change.

## Scope

- **E1. Visitor events.** New client frame `visitor.event`, sent for exactly the 4 names the
  templates use: `search`, `cart_updated`, `exit_intent`, `product_viewed`. (`checkout_error`
  and `custom` are valid on the wire per `VISITOR_EVENT_NAMES` but no template reads them yet —
  not built now, YAGNI.)
- **E2. Invites.** Receive server-pushed `flow.invite`, render an invite bubble, accept it by
  reconnecting with `inviteId` on `connection.hello`, dismiss it with `flow.inviteDismissed`.
- **E3. Cards.** Renderers for `metadata.discount`, `metadata.products` (max 3, per
  `sendProducts`), `metadata.order`.
- **E4. Exit-intent wiring.** The widget's existing `mouseout`-to-top auto-open detector
  (`widget.ts:1159-1166`) also fires `sendVisitorEvent('exit_intent')` — one detector, two
  effects, not two listeners.
- **E5. Customer app.** `dh-hyperlocal-customer-app-react` sends `cart_updated` from the cart
  slice, `search` from search results, `product_viewed` from product/store pages.

Not in scope: `onAction` (buttons already cover the templates' interactions — cards are
read-only display plus the existing button mechanism where a flow needs a choice, e.g. Cart
idle's "Yes please/No thanks"), `checkout_error`/`custom` events, any nexusai legacy `cards`
vocabulary compatibility (comment in `flow-messages.ts` names it for "older renderers" — not
this widget).

## Design

### Core (`packages/core`)

- `protocol/frames.ts`: add to `CLIENT_TO_SERVER_FRAME_TYPES`: `'visitor.event'`,
  `'flow.inviteDismissed'`. Add to `SERVER_PUSH_FRAME_TYPES`: `'flow.invite'`. New payload
  types `VisitorEventPayload { name: VisitorEventName; props?: Record<string, string|number|boolean> }`,
  `FlowInviteDismissedPayload { inviteId: string }`, `FlowInvitePayload { inviteId, text, buttons?, autoOpen? }` —
  copied field-for-field from `chat-service-node/.../protocol/types.ts:604-626` (the source of truth).
  `ConnectionHelloPayload` gains `inviteId?: string`.
- `protocol/validate.ts`: `visitor.event` validator mirrors the server's per-event prop rules
  (`chat-service-node/.../flows/facts.ts:155-183` `EVENT_PROPS`) so a client never sends what
  the server would silently drop — same "don't waste a frame" reasoning as `context.update`'s
  coalescing. `flow.inviteDismissed` validates `inviteId` as an opaque string like other id
  fields (`validate.ts:290`'s existing rule).
- `client`: `client.sendVisitorEvent(name, props)` — validates locally, drops with a logger
  warning on failure (never throws, same contract as `setPageContext`), sends immediately (no
  coalescing — each event is a distinct fact, unlike page context which is a single current
  value). `client.acceptInvite(inviteId)` — stores the id and reconnects/re-hellos carrying it;
  clears it once one hello has carried it (accept-once, matching the server's "only once" rule
  in `flow-adapters.ts`). `client.dismissInvite(inviteId)` sends `flow.inviteDismissed`
  immediately. New store event `flowInvite: { inviteId, text, buttons?, autoOpen? }` on receipt
  of the push frame, and `flowInviteCleared: { inviteId }` when it is accepted, dismissed, or
  expires — the widget's bubble subscribes to both rather than polling state.

### Widget (`packages/widget`)

- `config.ts` / `ChatWidget`: `sendEvent(name, props)` and `dismissInvite()` on the public
  interface, mirroring `setPage`'s doc comment style.
- `ui/invite-bubble.ts` (new): a small bubble anchored to the launcher, text from
  `FlowInvitePayload.text`, optional buttons that behave like a one-tap accept (tapping opens
  the panel with that `inviteId` in flight). `autoOpen: true` skips the bubble and opens the
  panel directly (Amendment D, same as an already-covered case for "The chat opens" flows).
  Dismissed by the existing close affordance already used elsewhere in the widget chrome →
  calls `dismissInvite()`.
- `widget.ts`: `armAutoOpen`'s `mode === 'exit-intent'` branch calls both `fire()` (existing UI
  auto-open) and `client.sendVisitorEvent('exit_intent', {})` from the same `onMouseOut` — no
  second listener registered.
- `ui/message-list.ts`: three new metadata branches alongside the existing `buttons`/`input`
  ones (`ui/quick-replies.ts`'s `readQuickReplies` is the pattern to follow — a structured
  reader per metadata shape, defensive against malformed data):
  - `metadata.discount` → a card: label, dashed-border code box, "Copy code"
    (`navigator.clipboard`, falls back to text-select on failure — never throws).
  - `metadata.products` (≤3, per `sendProducts`'s own cap) → a horizontal card row: image (if
    present), name, price; no add-to-cart action (out of scope — `onAction` is Part 3).
  - `metadata.order` → a card: order number, status, ETA if present.
  - Malformed/missing fields inside a recognized metadata key render nothing for that field
    rather than throwing (same defensiveness as existing button parsing).

### Customer app (`dh-hyperlocal-customer-app-react`)

Same shape as Part 1's `ChatWidgetMount.tsx` route wiring — call the widget, not chat-service
directly. `redux/analytics/analytics.middleware.ts` already exists for exactly this job: a
plain Redux `Middleware` that intercepts cart/product/search actions (`addToCart`,
`fetchItemDetail.fulfilled`, `trackSearch`, …) and fires an external side effect
(`analyticsService.dispatchEvent`) after `next(action)`. Chat-flow events reuse that same
middleware and the same intercepted actions — one more `dispatchEvent`-style call per branch,
not a second middleware or a new Redux Toolkit API (`createListenerMiddleware`) this codebase
doesn't otherwise use:

- `addToCart.match(action)` branch (already reads `state.cart` after `next`): add
  `widget.sendEvent('cart_updated', { items: state.cart.items.length, value, currency })`
  alongside the existing `dispatchEvent('add_to_cart', …)` call.
- `trackSearch.match(action)` branch: add `widget.sendEvent('search', { query, results })` from
  the same payload already used for `dispatchEvent('search', …)`.
- `fetchItemDetail.fulfilled.match(action)` branch: add
  `widget.sendEvent('product_viewed', { productId, inStock })` from the same fulfilled payload
  already read for the view-item analytics call.
- The widget instance is reached the same way `ChatWidgetMount.tsx` reaches it (`DhaamChat.widget()` /
  the module's `getWidget()`) — the middleware calls it defensively (widget not yet mounted →
  no-op, matching `sendEvent`'s own "never throws" contract) rather than importing store state
  into the SDK.

## Errors and safety

- Every new client entry point (`sendVisitorEvent`, `acceptInvite`, `dismissInvite`) follows
  Part 1's rule: malformed input is dropped with a `logger.warn`, never thrown — a bad event
  must never break chat, same as a bad page context.
- No personal data in event `props` — same constraint as Part 1's `attributes`, and the
  server's own prop allow-list (`EVENT_PROPS`) backstops this regardless.
- An invite bubble that fails to render (bad payload) is simply not shown — never a broken
  launcher.

## Testing

- Core: frame validators (`visitor.event` per-event prop rules, `flow.inviteDismissed`),
  client tests for `sendVisitorEvent`/`acceptInvite`/`dismissInvite` incl. malformed-input
  drops, `flowInvite`/`flowInviteCleared` store events.
- Widget: fake-socket integration tests — invite bubble appears on push and clears on
  accept/dismiss/expiry; `autoOpen` invite opens the panel directly; exit-intent mouseout fires
  both the existing auto-open and the new event exactly once; discount/products/order cards
  render from `metadata`, and render nothing (not a crash) on malformed metadata.
- Customer app: unit test per event call site (cart mutation → one `cart_updated` call with
  correct payload; search settling → one `search` call; product mount → one `product_viewed`
  call).

## Risks

- Same as Part 1: backend engine flag off → nothing changes for visitors. The customer app and
  any other host receive this only after SDK repack + refresh + redeploy.
- `cart_updated` firing from a listener middleware must not fire on every unrelated state
  change — scoped to the cart slice's own actions only, verified by the unit test above.
