# Rich cards in the visitor widget: hand-off

For whoever continues the widget's bot-card work. It covers what shipped, how
it renders, the rules it enforces, how to preview and test it, and the gaps
still open.

Branch: `feat/bot-flow-commerce-cards`. Package: `@dhaam-ccrm/widget`.

## Contents

1. [What shipped](#what-shipped)
2. [The wire contract](#the-wire-contract)
3. [How it renders](#how-it-renders)
4. [Validation rules](#validation-rules)
5. [Preview](#preview)
6. [Tests](#tests)
7. [Bundle budget](#bundle-budget)
8. [Known gaps and next steps](#known-gaps-and-next-steps)

---

## What shipped

| File | What it is |
|---|---|
| `packages/widget/src/ui/message-card.ts` (new) | `readRichCards(metadata)`, `readRichIntro(metadata)` (pure, never throw) and `buildCardList(cards)` (DOM, `textContent` only). |
| `packages/widget/src/ui/message-list.ts` | Draws cards in each bot row, under the bubble. Swaps the bubble text for `richIntro` while cards are drawn. |
| `packages/widget/src/ui/styles.ts` | The `.dh-card*` rules and four palette tokens: `--dh-tone-success`, `--dh-tone-warning`, `--dh-tone-info` (light and dark) and `--dh-card-link` (dark only). |
| `packages/widget/scripts/preview-cards.mjs`, `preview-cards.entry.ts` (new) | `pnpm preview:cards`: a static page of example cards. |
| `packages/widget/scripts/bundle.mjs` | `WIDGET_GZIP_BUDGET` raised from 124 KiB to 125 KiB, with the reason in a comment. |
| `packages/widget/test/message-card.test.ts` (new) | Reader, builder and stylesheet tests. |
| `packages/widget/test/message-list.test.ts` | Transcript tests for cards and the intro line. |
| `packages/widget/test/preview-cards.test.ts` (new) | The preview's private temp directory and file mode. |
| `packages/widget/README.md`, `packages/widget/package.json`, `.changeset/widget-rich-cards.md` | Docs, the `preview:cards` script, and the release note. |

Nothing outside `packages/widget` changed in code. `@dhaam-ccrm/core` treats
`metadata` as an opaque bag and passes it through untouched, over the socket
and from history (`packages/rest/src/projection.ts` drops only `attachment`,
`__proto__`, `constructor` and `prototype`).

## The wire contract

The source of truth is chat-service-node's
`docs/specs/chatbot-workflows-lookup.md` §2. It is restated here so this page
stands on its own.

Cards arrive as `metadata.richCards` on an ordinary bot message
(`senderType: 'BOT'`, `type: 'TEXT'`). There is no new message type.

```ts
type RichCard = {
  v: 1,
  kind: 'product' | 'item' | 'order' | 'info',
  title: string,                       // ≤80
  subtitle?: string,                   // ≤120
  imageUrl?: string,                   // https only, ≤500
  badge?: { label: string /*≤24*/, tone: 'neutral'|'success'|'warning'|'danger'|'info' },
  rows?: { label: string /*≤30*/, value: string /*≤120*/ }[],     // ≤8
  buttons?: { label: string /*≤20*/, url: string /*https, ≤500*/ }[],   // ≤3
  footer?: string,                     // ≤60
  data?: Record<string, string | number | boolean>,   // the item's own attributes, for the HOST PAGE: never drawn (below)
}
metadata.richCards: RichCard[]         // ≤5
metadata.richIntro?: string            // ≤300, the intro line ONLY (no card text). Optional.
```

### Action buttons (in-widget "Track order")

A button is a link (`{ label, url }`, https, opens a new tab) **or** an action the widget handles itself:

```ts
{ label: string /*≤20*/, action: 'track_order', ref: string /* order number: printable ASCII, no spaces, ≤64 */ }
```

- The widget draws it as a `<button>` and, on tap, opens its own order-tracking panel
  (`ui/order-tracking.ts`) in the surface slot, built from **the card the button sits on**: title, store,
  status chip and rows. Nothing is fetched. The status label picks the timeline stage
  (placed, preparing, out for delivery, delivered); a cancelled order shows a note; an unrecognised
  label shows no timeline.
- chat-service puts the action on an order card **when nexusai sent no https `tracking_url`**; with a
  tracking URL the card keeps the merchant's link. A list card (`orders`) carries neither.
- **The widget adds this button itself** to an `order` card that has no tracking link or action of its own, when the title is `Order #<ref>` and the list has room (`withTrackAction` in `ui/message-card.ts`). The panel needs only the card, so it works against a chat-service that predates the action. A card that already tracks is left as sent.
- Renderers that do not know an action drop that one button and keep the card: older widgets, WhatsApp,
  and the plain-text `content` (an action has no address to print).
- `message-list` draws an action button only when it is given `onCardAction`; without a handler a card
  has no dead button.

Rules every producer and every renderer follows:

1. `content` is always a readable plain-text version of the cards. Old widgets,
   WhatsApp, transcripts and notification emails use it. **Duplicate-text
   rule:** a renderer that actually draws at least one valid card shows
   `richIntro` (a non-empty string, clamped to 300, text only) as the bubble
   text instead of `content`. With no valid card, or no `richIntro`, it shows
   `content` exactly as before. Screen-reader announcements, notifications,
   transcripts and the conversation-list preview keep using the full
   `content`.
2. The bag is untrusted. Renderers re-check types, clamp lengths, drop
   non-`https:` URLs, and ignore unknown fields and unknown `v`. Use
   `textContent` only, never `innerHTML`.
3. `badge.tone` for an order status is chosen by the producer:
   delivered/completed → success; cancelled/failed → danger;
   pending/placed/preparing → info; out-for-delivery/dispatched → warning;
   anything else → neutral.
4. Currency is formatted by the producer.

Who produces what (contract §2.1 and §2.2):

- **Order card:** title `Order #<number>`, the status as the badge, the store
  as the subtitle. Rows: Placed, ETA (if any), Items (the first 3, then "and N
  more"), Payment, Total. A `Track order` button if there is a tracking URL.
- **Item or product card:** the name as the title, the price as the subtitle,
  `imageUrl`. An `Out of stock` badge (danger) when unavailable. Description
  and Options rows (item detail only). A `View` button if there is a URL. A
  product search posts up to 5 cards in one message.

### `data`: the item's own attributes, for the host page

A product or item card may carry `data`: the upstream row's own scalar fields as it named them (for a dish: `menuId`,
`isMin`, `isMax`, `inventorEnabled`, `hasDetails`, `isAvailableNow`, `entityType`, `isVeg`, `description`, `id`, `price`,
`imageURL`, `name`; at most 40 keys, text ≤500). The widget **does not draw it** (the card shows the name, picture and price)
and drops it from its own model, but it stays on the message, so a host page that wants to act on a card (add the dish to its
cart, which needs the `menuId`) reads it from the message:

```ts
DhaamChat.on('message', (m) => {
  m.metadata?.richCards?.forEach((card, i) => {
    if (card.kind === 'product' && card.data) cart.prepare({ dishId: card.data.id, menuId: card.data.menuId, min: card.data.isMin, max: card.data.isMax });
  });
});
```

For an **item** (`kind: 'item'`, the item-detail step) `data` is the item's whole answer, nested: its own fields plus `products`
(the variants), `upsells`, `modifierGroups` (each with `modifiers`), `multiImage`, `discount` and `itemTemplates`, each with its
`minOption`/`maxOption`/`isMultiSelect`/`isDefault`/`price`/`isActive`, so the page can show the options (modifiers, upsells,
variants) when the customer taps Add to cart and validate the choice before it builds the order. It is all or nothing: when an item
is too large (depth 8, 3000 nodes, 48 KiB) `data` is absent, never cut. The menu the page is on is the page's own
(`DhaamChat.setPage({ attributes: { menuId } })`, which also prices the item in that menu).

Treat it as untrusted text and numbers, like the rest of the message.

## How it renders

- **Placement.** Cards draw in the bot's row, under the bubble and above the
  timestamp: `.dh-msg-content-wrap` holds author, bubble, `ul.dh-cards`, then
  meta. They are not inside the bubble, so the bubble's `pre-wrap` and colours
  do not apply to them.
- **Bot only.** `message.senderType === 'BOT'` is the trust boundary. Customer
  and agent clients write their own metadata (the reply quote is one), and a
  staff viewer sees customer messages as incoming rows, so a bag from them must
  never draw a link card.
- **Caching.** `createRow` keeps the built list, keyed on
  `isBot ? message.metadata : undefined`. It is rebuilt only when that key
  changes, so images do not reload on every typing flap, and the same bag that
  moves from a bot message to an agent message is decided again. Comparing
  references is safe because core deep-freezes every published state
  (`packages/core/src/state/store.ts`).
- **Bubble text.** `cardsIntro ?? visibleContent(message)`. `cardsIntro` is
  non-null only while at least one card is drawn and `richIntro` is usable. The
  live region uses `describeContent`, which still reads the full `content`.
- **Layout.** This mirrors the console preview's `ProductCard` and `OrderCard`
  in `chatsupport_react` (`app/components/chat/cards/`):
  - A bordered surface 260px wide (at most 100% of the row), with an optional
    44px image tile.
  - Product and item cards (`.dh-card-priced`) keep the price beside the name.
    Their chip ("Out of stock") goes under the name.
  - Order and info cards put the status chip top-right. It drops under the
    title when they do not fit on one line.
  - Rows are a `<dl>`. The footer is small, muted text.
  - Link buttons form a footer row, each at least 44px tall, with a visually
    hidden "(opens in a new tab)".
- **Theme.** Every colour is a palette token, so dark mode and the tenant
  accent apply with no rules of their own.
  - Chip colours measure at least 4.79:1 against their own tint in both
    palettes.
  - In dark mode, links use the accent mixed 60% with white
    (`--dh-card-link`). That mirrors the console's `--dh-primary-text`.
  - Nothing on a card animates.
- **Accessibility.**
  - The list has an explicit `role="list"`: Safari drops list semantics under
    `list-style: none` (MDN, CSS `list-style`, Accessibility).
  - The chip says the status in words; colour is a second cue.
  - Images have `alt=""`, since the title next to them carries the meaning.

## Validation rules

All in `readRichCards` and `readRichIntro` (`ui/message-card.ts`):

- **Version and title.** A card is drawn only with `v === 1` (the number) and a
  usable `title`. Other cards in the same message still draw.
- **Lists.** Only the first 5 cards, 8 rows and 3 buttons are read. A bad entry
  among them is skipped, not replaced by a later one.
- **Text cleaning.** Only the first 4 × limit characters of a string are
  examined. From those, the reader removes bidi embeddings, overrides and
  isolates (U+202A–U+202E, U+2066–U+2069) and control characters other than
  tab and newline. Zero-width joiners (U+200C, U+200D) are kept.
- **Visible characters.** The text must then contain a visible character: a
  letter, number, punctuation mark or symbol (`/[\p{L}\p{N}\p{P}\p{S}]/u`).
  Otherwise it counts as absent. This drops a card with an invisible title,
  and drops a button, row or badge with an invisible label.
- **Clamping.** Over-long text is cut to the limit with a trailing `…`, and a
  high surrogate left alone at the cut is removed.
- **URLs.** A URL must be at most 500 characters and parse with `new URL()` as
  `https:` with no username or password. The parsed `href` is what gets used. A
  bad image or button is dropped on its own; the card still draws.
- **Images and links.** Images load with `width`/`height` 44,
  `loading="lazy"`, `decoding="async"` and `referrerpolicy="no-referrer"`, and
  are hidden on `error`. Links are `<a target="_blank" rel="noopener
  noreferrer">`.
- **Unknown values.** An unknown `kind` draws as `info`, and an unknown `tone`
  as `neutral`.
- **Own properties only.** Only the bag's own properties are read, so a
  polluted `Object.prototype` cannot add cards or an intro.
- **Never throws.** A hostile getter or proxy yields no cards and no intro.

## Preview

```bash
pnpm build                                   # once: core resolves to its dist (see Tests for the build race)
cd packages/widget
open "$(pnpm --silent preview:cards)"        # add ?theme=dark or ?accent=%23be123c to the URL
```

The page draws the fixture messages in `scripts/preview-cards.entry.ts`
through the real `createMessageList` and stylesheet, with no backend. Each run
writes into a new private directory under the OS temp directory: `mkdtemp`,
flag `wx`, mode 0600. The example image hosts do not resolve, so the page
itself swaps in an inline image afterwards to show a loaded tile. The widget
only ever loads https images.

## Tests

```bash
npx vitest run packages/widget/test/message-card.test.ts \
               packages/widget/test/message-list.test.ts \
               packages/widget/test/preview-cards.test.ts
pnpm --filter @dhaam-ccrm/widget typecheck   # src, tests and scripts
pnpm --filter @dhaam-ccrm/widget build       # also enforces the bundle budget
```

- **What the tests cover:**
  - every clamp, URL refusal, garbage shape and prototype-pollution case;
  - bidi and invisible text;
  - `<img onerror>` in every field printing as text;
  - no HTML sink, at runtime and in the source;
  - 0, 1, 5 and 6 cards;
  - link and image attributes;
  - bot-only drawing, including a customer's message seen by staff;
  - the BOT↔AGENT cache key;
  - the intro line and the live region still reading the full `content`;
  - the preview's temp directory and file mode.
- **Mutation-checked.** Removing the own-property read, the bot-only check or
  the bot decision in the cache key each turns the matching tests red.
- **Byte-for-byte parity.** A card-less transcript was compared with HEAD's
  `message-list.ts` (14 fixtures, customer and staff views) and is identical.
  The temporary harness was deleted. To repeat the check, copy
  `git show HEAD:packages/widget/src/ui/message-list.ts` beside the current
  file and render both.
- **Build race (existed before this work).** A clean root `pnpm build` races:
  `packages/react` type-checks against the widget's `dist` while the widget is
  still emitting it, and a cold build does the same with `@dhaam-ccrm/js`.
  Build those packages one at a time (`pnpm --filter <pkg> build`) until that
  is fixed.

## Bundle budget

`dist/widget.js` was 125,298 B gzip before cards and is 127,008 B now
(+1,710 B). That went over the old 124 KiB budget, so it was raised to 125 KiB
(128,000 B), with the reason next to `WIDGET_GZIP_BUDGET` in
`scripts/bundle.mjs`. **Headroom is 992 B.** The next addition to the widget
needs a trim or another raise, with a reason.

## Known gaps and next steps

**(a) Flutter and Dart show the text version only.** `packages/flutter` and
`packages/dart` do not read `metadata.richCards`, so they show `content`, the
full text version. Port `readRichCards` and `readRichIntro` with the same
rules, then a card widget.

**(b) The staff portal thread draws no cards.** `src/ui/portal-thread.ts` has
its own row renderer and was not wired. Staff using the portal see `content`.
If cards are wanted there, reuse `readRichCards`/`buildCardList` with the same
bot-only rule.

**(c) `el()` reads its spec through the prototype chain (review finding 1).**
`applySpec` in `src/ui/dom.ts` reads `spec.attrs`, `spec.text`,
`spec.children` and `spec.on` with plain property access, so a polluted
`Object.prototype` on the host page becomes a gadget:

- `Object.prototype.attrs = { onclick: '…' }` puts an inline handler on every
  element the widget builds.
- `Object.prototype.on` attaches listeners everywhere.
- `Object.prototype.text` overwrites text.

The rich-card readers already read own properties only, but they build their
DOM through `el()`. Suggested fix, kept for the owner of `dom.ts`:

```diff
 function applySpec(node: Element, spec: ElementSpec): void {
-  for (const [name, value] of Object.entries(spec.attrs ?? {})) {
+  const own = <K extends keyof ElementSpec>(key: K): ElementSpec[K] | undefined =>
+    Object.prototype.hasOwnProperty.call(spec, key) ? spec[key] : undefined;
+  for (const [name, value] of Object.entries(own('attrs') ?? {})) {
+    // Never an inline event handler, whatever reaches here.
+    if (/^on/i.test(name)) continue;
     if (value === null || value === undefined || value === false) continue;
     node.setAttribute(name, value === true ? '' : String(value));
   }
-  if (spec.text !== undefined) node.textContent = spec.text;
-  for (const child of spec.children ?? []) node.appendChild(child);
-  for (const [type, handler] of Object.entries(spec.on ?? {})) {
+  const text = own('text');
+  if (text !== undefined) node.textContent = text;
+  for (const child of own('children') ?? []) node.appendChild(child);
+  for (const [type, handler] of Object.entries(own('on') ?? {})) {
     node.addEventListener(type, handler);
   }
 }
```

Add a test that sets each of those four keys on `Object.prototype`, calls
`el('div')`, and asserts there is no attribute, text, child or listener. Clean
up in `finally`.

**(d) Keyboard focus is lost on every row re-render (review finding 2).**
`MessageRow.update` in `src/ui/message-list.ts` calls
`bubbleWrap.replaceChildren(…)`, `contentWrap.replaceChildren(…)` and
`node.replaceChildren(…)` on every render, even when the children are already
in place. Moving a focused element out of the DOM drops focus. This was
measured in headless Chrome: a focused card link, and the existing reply
button the same way, are no longer `document.activeElement` after one
re-render. Typing indicators, ticks and presence all trigger renders.

Suggested fix: a helper that leaves the children alone when nothing changed.

```ts
/** Replaces `parent`'s children only when they differ, so a focused control inside is not detached. */
function setChildren(parent: Element, children: readonly Node[]): void {
  const current = parent.childNodes;
  if (current.length === children.length && children.every((child, i) => current[i] === child)) return;
  parent.replaceChildren(...children);
}
```

Use it for each `replaceChildren` in `update()`. In the incoming branch, the
content list becomes
`setChildren(contentWrap, cards === null ? [author, bubbleWrap, meta] : [author, bubbleWrap, cards, meta])`,
which also replaces the `insertBefore`.

jsdom does not reproduce the focus loss, so verify it in a real browser. For
example: bundle a page that focuses `.dh-card-btn`, calls `render` again, and
writes `document.activeElement === link` into `document.title`. Then read it
with `chrome --headless=new --dump-dom`. `Element.moveBefore()` is the
platform's own answer where it is supported.

**(e) Light-mode link contrast uses the raw tenant accent (review finding 9).**
Card links (and the existing quick-reply chips) use `var(--dh-accent)` on a
white card.

| Accent | Contrast on white |
|---|---|
| default teal `#0f766e` | 5.47:1 |
| `#2563eb` | 5.17:1 |
| `#22c55e` | 2.28:1 |
| `#0ea5e9` | 2.77:1 |
| `#f59e0b` | 2.15:1 |
| `#facc15` | 1.53:1 |

Dark mode already lifts the accent (`--dh-card-link`). Light mode needs the
mirror: darken a light accent (for example
`color-mix(in srgb, var(--dh-accent) 60%, #000)`) when it is below 4.5:1. That
can be decided in `themeCss()` from the configured accent. Apply the same fix
to `.dh-quick-reply`.

**(f) Phishing-label risk on buttons and images (review finding 8).** A button
says whatever its label says ("Track order") and opens whatever https URL the
merchant's template produced. The widget cannot tell a lookalike domain from
the real one. Options:

- show the destination hostname under or beside each button label;
- an image-host allowlist for `imageUrl`, mirroring chat-service's
  `FLOW_CARD_IMAGE_HOSTS`/trusted media hosts for WhatsApp (contract §2.3), so
  a card cannot load a tracking pixel from an arbitrary host.

**(g) The system-message heuristic can hide cards (review finding 10).**
`isSystemMessage` in `message-list.ts` classifies by `content` text: "has
joined the chat", "Conversation assigned to" and so on. A bot message whose
text happens to match is rendered as a system pill, and its cards and intro
are skipped. Prefer `senderType === 'SYSTEM'` (or a server flag) over content
matching, or exempt messages that carry `richCards`.

**(h) Truncation is not grapheme-safe (review finding 7).** The clamp keeps
surrogate pairs whole, but it can still cut inside a grapheme cluster: a ZWJ
family emoji, a flag, or a letter plus combining marks. Use
`Intl.Segmenter(undefined, { granularity: 'grapheme' })` where available, and
fall back to the current code-unit cut. Mind the bundle headroom.

**(i) Console tests that pin SDK file hashes.** `chatsupport_react`
pins SHA-256 hashes of SDK files in
`app/lib/settings/__tests__/prechat-dedup-sdk-differential.test.ts`
(`field-dedup.ts`, `offline-form.ts`, `webform-form.ts`) and
`app/lib/settings/__tests__/webform-sdk-parity.test.ts` (`field-dedup.ts`,
`webform-form.ts`), all under `packages/widget/src/ui/`.

**This change touches none of those three files**, so it does not move those
pins. However, `webform-form.ts` at this branch's base already hashes to
`e500d07686cbde7b64a6ed057354bd104b185fe241550791c5b6083efe3aefdd`. Both
console tests still pin
`55825514b25d0214007dc9bd061e8bf2d70a33fd7f42a5fb3ba6b6a5ae45c4ff`, so they
fail against this SDK regardless of rich cards.

Whoever merges should re-read the rule those tests guard, then re-pin, as the
tests' own messages ask. The SDK files this change does modify are:

- `src/ui/message-list.ts`
- `src/ui/styles.ts`
- `scripts/bundle.mjs`
- `package.json`
- `README.md`

It also adds `src/ui/message-card.ts`, `scripts/preview-cards.*`,
`test/message-card.test.ts` and `test/preview-cards.test.ts`, and extends
`test/message-list.test.ts`.
