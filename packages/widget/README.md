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

## Rich cards from the bot

A bot flow's `lookup` and `card` steps post order, product and custom cards. They
arrive on an ordinary bot message (`senderType: 'BOT'`, `type: 'TEXT'`) as
`metadata.richCards`. There is no new message type. The wire contract is §2 of
chat-service-node's `docs/specs/chatbot-workflows-lookup.md`:

```ts
metadata.richCards: Array<{        // at most 5 drawn
  v: 1;                            // any other version: that card is skipped
  kind: 'product' | 'item' | 'order' | 'info';   // anything else draws as 'info'
  title: string;                   // ≤ 80, required
  subtitle?: string;               // ≤ 120 (a product's price, an order's store)
  imageUrl?: string;               // https only, ≤ 500
  badge?: { label: string;         // ≤ 24
            tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' };
  rows?: { label: string; value: string }[];     // ≤ 8; label ≤ 30, value ≤ 120
  buttons?: { label: string; url: string }[];    // ≤ 3; label ≤ 20, url https ≤ 500
  footer?: string;                 // ≤ 60
}>
metadata.richIntro?: string;       // ≤ 300, the intro line only (no card text)
```

**The text is always there.** `content` is a plain-text version of the cards
(contract rule 1). A widget older than this release, the transcript email,
WhatsApp and notifications all read that text, so no visitor gets an empty
message. Only the bot's own messages draw cards. A card bag on a customer or
agent message is ignored, because those clients write their own metadata.

**The duplicate-text rule.** When the widget draws at least one valid card and
the message carries a usable `metadata.richIntro`, the bubble above the cards
shows that intro instead of `content`, so the card text is not shown twice.
With no valid card, or no usable intro, the bubble shows `content` exactly as
before. The screen-reader announcement always reads the full `content`.

**The bag is untrusted, and the widget re-checks it** (`ui/message-card.ts`):

- Only `v: 1` cards with a non-empty `title` are drawn. Other cards in the same
  message still are.
- Text is trimmed and clipped to the limits above with an ellipsis. Lists are
  capped by reading only their first 5 cards, 8 rows and 3 buttons. Only the
  first 4 × limit characters of a string are read, so a huge value costs no
  more than a short one.
- Bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069) and
  control characters other than tab and newline are removed from every string,
  `richIntro` included. Zero-width joiners (U+200C, U+200D) are kept. A string
  with no visible character (letter, number, punctuation or symbol) counts as
  absent. A card whose title is only zero-width spaces is dropped, and so is a
  button, row or badge with an invisible label.
- Every URL must parse as absolute `https:` with no `user:password@`. A
  failing button or image is dropped alone and the card still draws. Images
  load lazily with `referrerpolicy="no-referrer"` and an empty `alt`, and are
  hidden if they fail to load. Buttons are real links with `target="_blank"`
  and `rel="noopener noreferrer"`.
- Unknown fields are ignored, only own properties are read (a polluted
  `Object.prototype` cannot add cards), and a malformed bag draws nothing and
  never throws.
- Every string goes in through `textContent`. Markup in a title prints as
  text.

Cards follow the theme: dark mode, the tenant's accent on the links, and status
chips that carry the status in words, with colour as a second cue. Link rows are
at least 44px tall, and nothing on a card animates.

The Flutter and Dart packages do not draw cards yet. They show the text
version.

To look at them without a chat-service, run `pnpm preview:cards` (below).

## Embedding the web form

The **web form** is the chat widget's offline path on its own: no launcher, no
panel, no socket, no session, no token mint. One publishable key serves every
surface below, and all of them render the same form and POST to the same
endpoint, so two surfaces on one tenant cannot disagree about what a
submission means.

### Three origins, and they are not the same thing

The single most common integration mistake here is collapsing these:

| Origin | What it is | Where it appears |
|---|---|---|
| **SDK CDN** — `https://cdn.dhaamai.com/` | Where our script files are served from, alongside `widget.js` | `<script src>` |
| **chat-service** — e.g. `https://chat.example.com` | Reads the form's config, receives the submission | `data-api-url` / `apiUrl` |
| **console host** — e.g. `https://console.dhaamdesk.com` | Serves the hosted page `/f/<publishableKey>` that the iframe points at | `data-hosted-origin` / `hostedOrigin` |

`hostedOrigin` has **no default**. This package has no canonical console origin
baked into it, and guessing one would point a merchant's contact page at
someone else's deployment — so it is required, explicit, and validated.

### 1. Script tag, form rendered inline

```html
<script src="https://cdn.dhaamai.com/form.js"
        data-publishable-key="dhp_live_…"
        data-api-url="https://chat.example.com"></script>

<div data-dhaam-form></div>
```

Every element matching `[data-dhaam-form]` gets a form. `data-target` picks a
different selector; `data-auto="false"` installs the API without mounting
anything. The API is `window.DhaamForm`:

| Method | What it does |
|---|---|
| `mount(target, options)` | Mounts a form into `target` and returns it. One form per element — a second call returns the first. |
| `get(target)` | The form mounted in `target`, or `null`. |

One element of ours enters your page — `<dh-web-form>` — and everything else
lives in an **open** shadow root, so your CSS and ours cannot reach each other
but an accessibility audit can still walk the tree.

### 2. Bundler / framework, same form

```js
import { mountForm } from '@dhaam-ccrm/widget';

const form = mountForm(document.querySelector('#contact'), {
  apiUrl: 'https://chat.example.com',
  publishableKey: 'dhp_live_…',
  onSubmitted: (receipt) => console.log(receipt.receiptId),
});
// form.focus() moves keyboard focus into it; form.destroy() removes it.
```

Importing from the package installs **no** global and scans **no** document —
those are properties of the script-tag artifact, not of the module.

### 3. iframe embed, for full style isolation

When a shadow root is not enough — a host stylesheet with `!important`
everywhere, a CSP that forbids the form's own styles, a compliance rule that
wants the form on its own origin — embed the hosted page instead:

```html
<script src="https://cdn.dhaamai.com/form-embed.js"
        data-publishable-key="dhp_live_…"
        data-hosted-origin="https://console.dhaamdesk.com"></script>

<div data-dhaam-form></div>
```

or from a bundler:

```js
import { embedForm } from '@dhaam-ccrm/widget';

const embed = embedForm(document.querySelector('#contact'), {
  publishableKey: 'dhp_live_…',
  hostedOrigin: 'https://console.dhaamdesk.com',
  title: 'Contact form',          // the iframe's accessible name
  signal: controller.signal,      // optional; aborting tears the embed down
  onUnreachable: () => showEmailFallback(),   // optional; see below
});
// embed.iframe is the one element added to your page; embed.destroy() removes it.
```

**The frame resizes itself.** The page inside measures its own content and
posts its height up; the embed applies it, so the iframe never shows a
scrollbar of its own and your page never has to guess a height. Heights are
accepted only from `hostedOrigin` **and** only from that exact frame —
everything else on the `message` channel is ignored silently, because a page
with two embeds on it sees both of their traffic and that is not an error.

**When the frame never loads.** A typo in `hostedOrigin`, a hosted page served
with `X-Frame-Options: SAMEORIGIN`, a console that is down — from your page all
three look the same, and the browser gives us nothing to detect them with: a
refused frame fires no `onerror`, `onload` fires for the browser's own error
document, and reading into a cross-origin frame is forbidden. So the only fact
available is that no height ever arrived. `onUnreachable` reports exactly that,
once, `EMBED_UNREACHABLE_TIMEOUT_MS` (10 seconds) after the embed goes onto the
page. It removes nothing and resizes nothing, and a frame that turns up late
still resizes normally.

Its default is **nothing at all** — no console output and no timer for a caller
who did not ask. What to do about an unreachable console is your call: a
fallback block, a `mailto:` link, your own error reporting.

**Under a strict Content-Security-Policy** this adds exactly one directive:

```
frame-src https://console.dhaamdesk.com;
```

That is the only directive the embed itself **adds**. In particular **no
`style-src 'unsafe-inline'`**: every style is assigned through the CSSOM
(`iframe.style.height = …`), never as a `style` attribute string and never as an
injected `<style>` element. No `script-src 'unsafe-inline'` either — nothing is
evaluated — and no `connect-src`, because this side makes no request at all. The
page inside the frame does its own reading, under the console host's policy
rather than yours.

One qualifier, because it is the thing that will actually bite: if you load
`form-embed.js` from our CDN, your `script-src` still has to admit that file,
exactly as it already does for `widget.js` or `form.js`. The claim here is that
this bundle needs no *new* `script-src`, `style-src` or `connect-src` grant —
not that `frame-src` is the only directive your page ends up with.

**Serving the hosted page.** `/f/<publishableKey>?embed=1&origin=<embedder>`
is the contract; the full protocol — URL shape, message shape, origin rules —
is written out in the header of `src/form-embed.ts`. A page joins it in one
line:

```js
import { mountForm, parentOriginFromLocation } from '@dhaam-ccrm/widget';

mountForm(document.querySelector('#form'), {
  apiUrl: 'https://chat.example.com',
  publishableKey,
  parentOrigin: parentOriginFromLocation(location.search),
});
```

`parentOrigin` is what turns the height reporting on. Given an origin it
cannot validate — absent, `"null"` from a sandboxed embedder, a wildcard — it
posts **nothing**, and never falls back to `'*'`.

Three obligations come with serving that page, and none of them is optional in
practice. The header of `src/form-embed.ts` is the spec of record; this is the
short version.

**1. Do not send `X-Frame-Options: DENY` or `SAMEORIGIN`.** This is the one that
will happen to you, because nobody chooses it: helmet, Django's
`XFrameOptionsMiddleware`, Rails' default headers and most nginx hardening
snippets all send `SAMEORIGIN` on their own. The browser then refuses the frame
outright — nothing inside it runs, no height is ever posted — and the merchant
sees an empty 320px box. Use `Content-Security-Policy: frame-ancestors` instead
— but build it from the `?origin=` **only after checking that origin against the
tenant's registered origins**, and refuse (or send `frame-ancestors 'none'`) when
it does not match.

> ⚠️ Reflecting `?origin=` back unchecked is a security no-op that reads like
> access control. The framing page supplies that parameter, so a hostile page
> frames with `?origin=https://evil.example` and a page that only checks its
> *syntax* answers `frame-ancestors https://evil.example` — permitting exactly
> the page that asked. The list to check against already exists and is already
> enforced by `GET /widget/form`, which answers 403 `ORIGIN_NOT_ALLOWED` to an
> origin that is not on the tenant's list. An empty list means unrestricted
> there, so degrade the same way rather than locking out tenants who have not
> filled it in.

It is not the same thing as the merchant's `frame-src` — that is the embedder's
policy about what it will load, `frame-ancestors` is yours about who may frame
you — and neither substitutes for the other. Nor does the SDK's own origin check
help you here: that runs as JavaScript on the embedder's page, so it protects an
honest embedder from a third party and can never protect you from the embedder.

**2. Every response must post a height, error pages included.** A 401 for a
revoked key, a 404 for an unknown one, a 429, a 500, the edge's own error page:
each is a document inside somebody's contact page, and one that posts no height
is not a frame at its natural size. `scrolling="no"` and `overflow: hidden` are
both set unconditionally, so it is a **320px clipping of itself with no
scrollbar** — on anything taller, the submit button cannot be reached and no
scroll gesture will reveal it. One inline script on the error template, posting
`{ type: 'dhaam-form:resize', height }` to the validated `?origin=`, discharges
this; it needs none of the SDK.

**3. What gets measured is the form element's border box — and nothing around
it.** The `ResizeObserver` watches `root.host`, so a logo, your branding, a
wrapper's padding or a cookie bar above the form is **not** in the number, and
under `overflow: hidden` it is clipped by exactly its own height. A branded
hosted page is the likeliest thing to build here and the likeliest way to get
this wrong, because it looks right locally: opening `/f/<key>` directly shows it
at full window height, where nothing is clipped. Either put the chrome inside
the measured element, or add its height to what you post.

### 4. React

*(added by the React binding — see its own README.)*

## Development

```bash
pnpm build            # dist/index.js (bundler users) + dist/widget.js (script tag)
pnpm size             # gzipped weight and what dominates it
pnpm typecheck        # src AND test — tsup does not typecheck tests
pnpm dev:harness      # a deliberately hostile host page on :4599
pnpm verify:browser   # 25 real-Chrome checks against that harness
pnpm preview:cards    # writes a static page of bot rich cards; prints its path
```

`preview:cards` needs no backend. It draws fixture bot messages carrying
`metadata.richCards` (in `scripts/preview-cards.entry.ts`) with the real
transcript renderer and stylesheet. Each run writes one HTML file into a new
private directory under the OS temp directory (`mkdtemp`, file mode 0600), and
nothing into the package. Open it with `open "$(pnpm --silent preview:cards)"`,
and add
`?theme=dark` or `?accent=%23be123c` to the URL to check the dark palette and a
tenant accent. Build the workspace once first, since `@dhaam-ccrm/core` resolves to
its `dist`.

`verify:browser` is not decoration. It caught two defects the 70 jsdom tests
could not: the `!important` font leak above, and every presentation rendering
off screen because a per-presentation offset selector out-specified the
open-state rule meant to clear it. jsdom has no cascade competition and computes
no layout, so both classes of bug are invisible to it.
