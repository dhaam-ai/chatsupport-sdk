---
"@dhaam-ccrm/widget": minor
---

Draw the bot's rich cards (`metadata.richCards`) under its message.

chat-service's bot flows now post order, product and custom cards from their
`lookup` and `card` steps, on an ordinary `senderType: 'BOT'` text message
(chat-service-node `docs/specs/chatbot-workflows-lookup.md` §2; the wire shape
is restated in this repo's `docs/rich-cards-handoff.md`). The widget draws them
below the bot's bubble, styled like the console preview's cards: a bordered
card, a 44px image tile, the title and a sub-line, the price or status chip on
the right, label/value rows, a footer, and up to three link buttons at least
44px tall.

- New `ui/message-card.ts`. `readRichCards(metadata)` validates the untrusted
  bag:
  - it accepts `v: 1` only, clamps every string to the contract's limits, and
    caps the lists at 5 cards, 8 rows and 3 buttons;
  - it removes bidi overrides and isolates and control characters from all
    text, and treats a string with no visible character as absent;
  - it keeps a URL only if it parses as absolute `https:` without credentials;
  - unknown kinds draw as `info`, unknown tones as `neutral`, and only own
    properties are read. It never throws.

  `buildCardList(cards)` builds the DOM with `textContent` only. Images load
  lazily with `referrerpolicy="no-referrer"` and are hidden if they fail.
  Links open with `target="_blank" rel="noopener noreferrer"`.
- `readRichIntro(metadata)` reads `metadata.richIntro`. When at least one card
  is drawn and the intro is usable, the bubble shows the intro instead of
  `content`, so the card text is not said twice (the duplicate-text rule,
  contract §2 rule 1). With no valid card or no intro, the bubble shows
  `content` exactly as before. The screen-reader announcement always reads the
  full `content`.
- `ui/message-list.ts` draws cards for BOT messages only. A customer's or
  agent's own metadata never draws a card. The card cache is keyed on the bag
  and on the bot decision together. The suggested-reply chips
  (`metadata.options`) still follow the newest bot message, unchanged.
- `ui/styles.ts` adds the `.dh-card*` rules and four palette tokens
  (`--dh-tone-success`/`-warning`/`-info` in both palettes, `--dh-card-link` in
  dark). Every chip colour measures at least 4.79:1 against its own tint.
- `pnpm preview:cards` writes a static page of example cards, with no backend,
  into a fresh private temp directory.

Additive and backward compatible. A message without cards renders
byte-for-byte as before: the transcript DOM for fourteen card-less fixtures was
compared with the HEAD `message-list.ts` in both the customer and the staff
view, and is identical. The Flutter/Dart packages are unchanged and still show
the text version.

**Bundle, measured (`scripts/bundle.mjs`):** `dist/widget.js` was 125,298 B
gzip and is now 127,008 B gzip, **+1,710 B**. After the review's hardening it
stood at 127,023 B, 47 B over the 124 KiB `WIDGET_GZIP_BUDGET` (126,976 B).
Trims that change no rendering recovered 15 B, leaving it 32 B over. The budget
is now 125 KiB (128,000 B), with the reason recorded next to it, which leaves
992 B of headroom.
