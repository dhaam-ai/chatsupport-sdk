# @dhaam-ccrm/widget

The drop-in embeddable chat widget. One script tag, no build step, no framework.

```html
<script src="https://cdn.example.com/widget.js"
        data-publishable-key="dhp_live_…"
        data-token-endpoint="/api/chat-token"
        data-user-id="cus_123"
        data-api-url="https://chat.example.com"
        data-ws-url="wss://chat.example.com"
        data-mode="bubble"></script>
```

That is the whole integration. A launcher appears; clicking it opens the chat.

**32.6 KB gzipped** (106 KB raw), self-contained. `@dhaam-ccrm/core` is 17.4 KB
of that — the widget's own UI adds 15.2 KB.

## The two presentations

| `data-mode` | What it is | Good for |
|---|---|---|
| `bubble` | Floating launcher bottom-right, expands into a 384x560 card above itself | Desktop, alongside page content |
| `sidebar` | A vertical edge tab; opens a full-height panel that slides in from the side | Order tracking next to a live order |
| `sheet` | Bottom-anchored sheet sized in `dvh` | Phones |
| `auto` *(default)* | `sheet` at or below 640px, `bubble` above it | Most integrations |

`panel`, `side`, `drawer`, and `tab` are all accepted as synonyms for `sidebar`.
Only `auto` changes at runtime — a mode you name explicitly is honoured at every
width, because an integrator who asked for a sidebar on a 320px viewport has a
layout reason the widget cannot see.

**Why `sheet` exists** (the brief asked for two modes and a justification for a
third): a `bubble` panel needs ~380x560 plus a margin plus the launcher it must
not cover, and there is no way to fit that inside a 360px phone viewport that is
not simply "a full-screen panel with a wasted gutter". A `sidebar` at that width
is also full-screen, but anchored to an edge the thumb cannot reach. `sheet` is
what the other two have to degrade into below a certain width; naming it makes
the degradation explicit and testable instead of a pile of media queries. It is
sized in `dvh`, which is what keeps the composer above the on-screen keyboard on
iOS Safari.

## Configuration

Every `data-*` attribute has a JS-API equivalent via `mount()`.

| Attribute | Required | Default |
|---|---|---|
| `data-publishable-key` | yes | — |
| `data-token-endpoint` | yes¹ | — |
| `data-user-id` | yes | — |
| `data-api-url` / `data-ws-url` | yes | — |
| `data-mode` | no | `auto` |
| `data-side` | no | `right` |
| `data-breakpoint` | no | `640` |
| `data-title` | no | `Chat with us` |
| `data-accent` | no | `#1f2937` |
| `data-font` | no | `isolate` |
| `data-open` | no | `false` |
| `data-open-on-agent-initiated` | no | `false` |
| `data-session-id` | no | — |
| `data-auto="false"` | no | installs the API without mounting |

¹ Or a `getToken` function through `mount()`.

```js
const widget = window.DhaamChat.mount({
  auth: { publishableKey: 'dhp_live_…', getToken: () => myApp.freshChatToken() },
  identity: { userId: 'cus_123' },
  apiUrl: 'https://chat.example.com',
  wsUrl: 'wss://chat.example.com',
  mode: 'sidebar',
});
widget.open();
widget.store.client.sendMessage('Hello');   // the full §6.2/§6.3 surface
```

### The `window.DhaamChat` API

| Method | What it does |
|---|---|
| `mount(config)` | Mounts the widget and returns it. Idempotent — a second call returns the first widget. |
| `open()` / `close()` / `toggle()` | Drives the panel. |
| `on(event, handler)` | Subscribes to core's §6.5 event catalog. Returns an unsubscribe. |
| `destroy()` | Removes every node, listener, timer, and the socket. |
| `widget()` | The mounted widget, or `null` — the escape hatch to `store.client`. |

`on` is safe to call before the widget has mounted. A `<script>` tag mounts on
`DOMContentLoaded`, so the inline script next to it runs first; registrations
are held and attached at mount rather than dropped.

## When an agent starts the conversation

An agent can open a chat with a customer who has no open session. The server
creates it, moves that customer's connection into it, and pushes the session
snapshot; the widget swaps the transcript and emits `conversationStarted`.

Opening the panel for it is **opt-in**:

```html
<script src="https://cdn…/widget.js"
        data-publishable-key="dhp_live_…"
        data-open-on-agent-initiated></script>
```

or, to decide for yourself:

```js
DhaamChat.on('conversationStarted', () => DhaamChat.open());
```

The default is `false` on purpose. A panel that opens itself covers the page
the customer is actually using, moves focus into a composer they did not ask
for, and on `sheet` takes the whole viewport — so it is your call, per site.

Left off, nothing is lost: the launcher shows its unread indicator and says so
in its accessible name, and the conversation is waiting when the customer opens
it. The panel's open transition already honours `prefers-reduced-motion`.

## Auth: the browser never holds a secret

The page gets a **publishable key** (`dhp_…`), which identifies a tenant and
grants nothing. The access token comes from **your own backend**, which is the
only thing holding the secret key (`dhk_…`).

Three independent mechanisms keep it that way, so no single mistake defeats all
three:

1. **Type** — `WidgetConfig` has no secret-key field. A bundle cannot transmit
   a credential it has no slot to receive.
2. **Value** — the publishable slot goes through core's `parsePublishableKey`,
   which throws `SecretKeyInClientError` before a socket is opened.
3. **Sweep** — *every* `data-*` value is checked with the same predicate,
   including attributes the parser does not recognise. The realistic accident
   is not a secret in the publishable slot; it is someone adding
   `data-secret-key` because the pair looked symmetrical.

The sweep asks core rather than keeping its own prefix list: that table has been
renamed twice already, and a stale second copy fails open.

No error raised anywhere in this package contains a key, a token, a prefix of
one, or its length.

## Shadow DOM

One element enters your page — `<dh-chat-widget>` — and everything else lives in
an **open** shadow root. `open` rather than `closed` because style encapsulation
is identical either way, while `closed` would hide the tree from axe-core,
Lighthouse, and the browser's own accessibility inspector.

**Fonts.** The usual claim is that a shadow root "does not inherit fonts". That
is not what the cascade does: *inherited* properties cross the boundary fine,
because the shadow tree inherits from its host element, which is an ordinary
light-DOM node. What does not cross is anything needing a selector to match.

So the hazard is the reverse of the folklore — left alone the widget silently
adopts your typography. The reset therefore lives on `.dh-launcher` and
`.dh-panel`, **not** on `:host`: a host rule matching the host element beats a
`:host` rule, and an `!important` one beats it unconditionally. A page with
`* { font-family: … !important }` rendered the entire widget in its display face
until the reset moved inside the shadow tree, where no host selector can reach.
Set `data-font="inherit"` to adopt your typography deliberately.

**Stacking.** A shadow root does not lift its host out of the page's z-order.
v1 wrote `z-index: 999999` and lost to anything bidding higher — a race that
cannot be won by escalating. The container is promoted to the **top layer** via
`popover="manual"`, which outranks every z-index by construction, falling back
to `2147483647` (the actual maximum) where the API is missing. `manual` and not
`auto`, because an auto popover light-dismisses on an outside click and would
close the widget whenever a user clicked the page behind it.

## It must not break your page

- No global CSS, and nothing injected into `document.head`.
- No `document.body` style mutation. The panel uses `overscroll-behavior:
  contain` rather than locking the host's scroll.
- Every promise is caught. An unhandled rejection here would land in *your*
  error tracker as a defect in *your* product.
- Loading the script twice mounts one widget. The guard is a string key on
  `globalThis`, because two script tags evaluate two separate module scopes and
  a module-level variable cannot see across them.
- The container is `pointer-events: none` while it spans the viewport in the top
  layer; only the launcher and panel take clicks.

## Accessibility

Verified against Chrome's own accessibility tree, not just asserted:

- Launcher is a `button` with an accessible name and `aria-expanded`. The unread
  count is in the **name** ("Open chat, 3 unread messages"), not only in the
  badge — a red dot a screen reader never mentions is not an indicator.
- Panel is a labelled `dialog` with `aria-modal="true"`, and that claim is
  honest: focus really is trapped, Escape always closes, and focus returns to
  whatever opened it. Announcing modality without the trap tells a screen-reader
  user the page behind is inert when it is not.
- Closed, the panel is `aria-hidden` and out of the tab order.
- New **incoming** messages go to a polite live region — never the log itself,
  which would announce the whole backfill on every "load earlier", and never
  your own messages back at you.
- Ticks carry words, not just colour: `Sending` / `Sent` / `Delivered` / `Read`.
- Connection state is words plus a dot, never the dot alone.
- `prefers-reduced-motion` and `prefers-color-scheme` are both honoured.

## Delivery ticks

Rendered from core's `deriveTickState` and nothing else. This package computes
no delivery state of its own — v1 drew the double tick from *presence*, and
connectivity is not delivery: a participant can be online and not caught up.

## Development

```bash
pnpm build            # dist/index.js (bundler users) + dist/widget.js (script tag)
pnpm size             # gzipped weight and what dominates it
pnpm typecheck        # src AND test — tsup does not typecheck tests
pnpm dev:harness      # a deliberately hostile host page on :4599
pnpm verify:browser   # 25 real-Chrome checks against that harness
```

`verify:browser` is not decoration. It caught two defects the 70 jsdom tests
could not: the `!important` font leak above, and every presentation rendering
off screen because a per-presentation offset selector out-specified the
open-state rule meant to clear it. jsdom has no cascade competition and computes
no layout, so both classes of bug are invisible to it.
