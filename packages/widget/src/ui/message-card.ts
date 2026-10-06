// The bot's rich cards — `metadata.richCards` on a bot message.
//
// ── Where they come from ─────────────────────────────────────────────────
//
// chat-service's flow engine posts them for the `lookup` and `card` steps (an
// order, a catalogue item, a merchant's own card), on an ordinary
// `senderType: 'BOT'`, `type: 'TEXT'` message. The wire contract is
// chat-service-node docs/specs/chatbot-workflows-lookup.md §2. Two of its
// rules shape this file:
//
//   1. `content` is always a readable text version of the cards, so a widget
//      that predates this file shows the text alone and loses nothing. The
//      cards draw UNDER the bubble. The bubble keeps showing `content`,
//      except when cards are drawn and the message carries a short
//      `metadata.richIntro`: then it shows that, so the card text is not
//      said twice (`readRichIntro`). Announcements always use `content`.
//   2. The bag is untrusted. Every field is re-checked here: `v` must be 1,
//      text is clamped to the contract's limits and stripped of bidi
//      overrides, a URL must parse as https, unknown fields are ignored, and
//      nothing is ever parsed as markup.
//
// ── Why parse and draw are separate ──────────────────────────────────────
//
// Same split as quick-replies.ts. `readRichCards` is a pure function of the
// bag, the half worth asserting exhaustively; `buildCardList` only ever sees
// what it returned, so the DOM code has no validation of its own to get
// wrong.

import { el } from './dom.js';

export type RichCardKind = 'product' | 'item' | 'order' | 'info';
export type RichCardTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface RichCardRow {
  readonly label: string;
  readonly value: string;
}

export interface RichCardLinkButton {
  readonly label: string;
  /** Always an absolute `https:` URL. */
  readonly url: string;
}

/**
 * An action the WIDGET carries out itself, not a link. `track_order` opens the
 * widget's own tracking panel for order `ref`, drawn from the card's own fields.
 * Drawn only when the caller passes an `onAction` handler; otherwise dropped, so
 * a card shown somewhere with nothing to handle it still has no dead button.
 */
export interface RichCardActionButton {
  readonly label: string;
  readonly action: 'track_order';
  /** The order number: printable ASCII, no spaces, at most 64. */
  readonly ref: string;
}

export type RichCardButton = RichCardLinkButton | RichCardActionButton;

/** Called with the card the tapped button sits on. */
export type RichCardActionHandler = (card: RichCard, button: RichCardActionButton) => void;

/** An order number as an action's `ref` (the same rule as chat-service's). */
const ACTION_REF = /^[!-~]{1,64}$/;

/**
 * One card, as the renderer sees it — NOT the wire shape.
 *
 * Normalised so the builder has no optional fields to branch on: an absent
 * string is `''`, an absent image or badge is `null`, an absent list is `[]`.
 */
export interface RichCard {
  readonly kind: RichCardKind;
  readonly title: string;
  readonly subtitle: string;
  readonly imageUrl: string | null;
  readonly badge: { readonly label: string; readonly tone: RichCardTone } | null;
  readonly rows: readonly RichCardRow[];
  readonly buttons: readonly RichCardButton[];
  readonly footer: string;
}

// Contract §2 limits. Lists are capped by reading only their first N entries:
// a producer that sends more is out of contract, and walking an unbounded
// array on every render is how one bad message would stall the transcript.
const MAX_CARDS = 10;
const MAX_ROWS = 8;
const MAX_BUTTONS = 3;
const MAX_URL = 500;

const KINDS: ReadonlySet<string> = new Set(['product', 'item', 'order', 'info']);
const TONES: ReadonlySet<string> = new Set(['neutral', 'success', 'warning', 'danger', 'info']);

/**
 * `metadata.richCards` → the cards to draw. Never throws.
 *
 * The try/catch is not decoration: this runs inside `render()`, the one path
 * that repaints the whole scrollback, so a throw here would freeze the
 * transcript. JSON cannot carry a throwing getter or a proxy, but a host app
 * that builds messages itself can.
 */
export function readRichCards(metadata: unknown): readonly RichCard[] {
  try {
    const bag = record(metadata);
    return bag === null ? [] : list(own(bag, 'richCards'), MAX_CARDS, readCard);
  } catch {
    return [];
  }
}

/**
 * `metadata.richLayout` → how the flow wants its cards laid out: `row` (side by side)
 * for 'horizontal', `column` (a list) for 'vertical', or `null` for anything else,
 * which leaves the widget's own default. Never throws.
 */
export function readRichLayout(metadata: unknown): CardsView | null {
  try {
    const bag = record(metadata);
    const value = bag === null ? undefined : own(bag, 'richLayout');
    return value === 'horizontal' ? 'row' : value === 'vertical' ? 'column' : null;
  } catch {
    return null;
  }
}

/**
 * `metadata.richIntro` → the intro line to show in the bubble while cards are
 * drawn, or `''` when there is none. Never throws.
 *
 * The duplicate-text rule (contract §2 rule 1): `content` restates the cards
 * in plain text, so a bubble showing it above the cards says everything
 * twice. When the caller draws at least one card, it shows this short intro
 * instead. `content` stays the source for everything that does not see the
 * cards: screen-reader announcements, notifications, transcripts.
 *
 * Same cleaning as card text: hidden characters removed, at least one
 * visible character, clamped to 300.
 */
export function readRichIntro(metadata: unknown): string {
  try {
    const bag = record(metadata);
    return bag === null ? '' : text(own(bag, 'richIntro'), 300);
  } catch {
    return '';
  }
}

/**
 * The cards as a list, for under a bot bubble.
 *
 * Every string goes in through `el`'s `text`, i.e. `textContent` — a title
 * of `<img src=x onerror=…>` prints those characters. `role="list"` is
 * explicit because Safari drops the implicit role from a list styled
 * `list-style: none`, by design, and VoiceOver then reads the cards as loose
 * text (https://developer.mozilla.org/en-US/docs/Web/CSS/list-style#accessibility,
 * https://webkit.org/b/170179#c1).
 */
/**
 * An order card with no way to track it gets the widget's own "Track order" action.
 *
 * The panel it opens is drawn from the card itself, so the button needs nothing from the
 * backend: it works against a chat-service that predates the `track_order` action and
 * against a card whose merchant sent no tracking URL. A card that already carries its own
 * tracking link or action is left exactly as sent, and one with no order number in its
 * title (`Order #3742`) or no room for a third button gets none.
 */
function withTrackAction(card: RichCard): RichCard {
  if (card.kind !== 'order' || card.buttons.length >= MAX_BUTTONS) return card;
  if (card.buttons.some((b) => 'action' in b || /track/i.test(b.label))) return card;
  const ref = /#\s*(\S+)\s*$/.exec(card.title)?.[1];
  if (ref === undefined || !ACTION_REF.test(ref)) return card;
  return { ...card, buttons: [...card.buttons, { label: 'Track order', action: 'track_order', ref }] };
}

export function buildCardList(cards: readonly RichCard[], onAction?: RichCardActionHandler): HTMLElement {
  return el('ul', { attrs: { class: 'dh-cards', role: 'list' }, children: cards.map((card) => buildCard(onAction === undefined ? card : withTrackAction(card), onAction)) });
}

/** From this many cards the list can be switched between swiping sideways and a stacked, scrolling list. */
const VIEW_SWITCH_MIN = 3;
export type CardsView = 'row' | 'column';

/**
 * The cards as the bubble shows them: one or two are the plain list; three or more
 * come with a switch between a sideways swipe (the default: it keeps a long list
 * compact, and the next card peeks in as the cue) and a stacked list that scrolls
 * up and down inside its own box. Both scroll by touch, wheel and keyboard (the
 * list takes focus); the arrows in the bar move the swipe one card for a mouse.
 * The flow may say which one it opens in (`initial`, from `metadata.richLayout`); the
 * reader can still switch. The choice lives on the element, which the transcript keeps
 * across renders.
 * Nothing animates: the arrows jump, they do not glide.
 */
export function buildCardView(cards: readonly RichCard[], initial: CardsView | null = null, onAction?: RichCardActionHandler): HTMLElement {
  const list = buildCardList(cards, onAction);
  if (cards.length < VIEW_SWITCH_MIN) return list;

  list.setAttribute('tabindex', '0');
  list.setAttribute('aria-label', `${cards.length} cards`);

  const step = (direction: -1 | 1): HTMLButtonElement =>
    el('button', {
      attrs: { type: 'button', class: 'dh-cards-nav', 'aria-label': direction < 0 ? 'Previous card' : 'Next card' },
      text: direction < 0 ? '‹' : '›',
      on: {
        click: () => {
          const first = list.firstElementChild as HTMLElement | null;
          const by = (first?.offsetWidth ?? 240) + 8;
          if (typeof list.scrollBy === 'function') list.scrollBy({ left: direction * by });
        },
      },
    });
  const nav = el('div', { attrs: { class: 'dh-cards-steps' }, children: [step(-1), step(1)] });
  // The layout is the merchant's choice (`initial`, from the console's "Show the cards"): there is
  // no Swipe/List switch for the reader. Only a swipe needs arrows; a list scrolls by itself.
  const view = initial ?? 'row';
  const root = el('div', { attrs: { class: 'dh-cards-view' }, children: [list] });
  root.setAttribute('data-view', view);
  if (view === 'row') root.prepend(el('div', { attrs: { class: 'dh-cards-bar' }, children: [nav] }));
  return root;
}

function buildCard(card: RichCard, onAction?: RichCardActionHandler): HTMLElement {
  const textColumn = el('div', {
    attrs: { class: 'dh-card-text' },
    children: [el('p', { attrs: { class: 'dh-card-title' }, text: card.title })],
  });
  const side = el('div', { attrs: { class: 'dh-card-side' } });
  // As the console preview lays them out. A product or item card's subtitle
  // is its price (contract §2.2), set beside the name, with any chip ("Out of
  // stock") under the name — two things on the right would squeeze the name
  // to a word per line. An order or info card is the other way round: the
  // sub-line (the store) under the title, the status chip on the right.
  const priced = card.kind === 'product' || card.kind === 'item';
  if (card.subtitle !== '') {
    (priced ? side : textColumn).append(el('p', { attrs: { class: 'dh-card-sub' }, text: card.subtitle }));
  }
  // Words on the chip, never colour alone: `data-tone` only picks the colour.
  if (card.badge !== null) {
    (priced ? textColumn : side).append(
      el('span', { attrs: { class: 'dh-card-badge', 'data-tone': card.badge.tone }, text: card.badge.label }),
    );
  }

  const head = el('div', { attrs: { class: priced ? 'dh-card-head dh-card-priced' : 'dh-card-head' } });
  if (card.imageUrl !== null) {
    const image = el('img', {
      // `src` LAST: attributes are set in this order, and the referrer
      // policy and lazy hint must already be on the element when the source
      // is assigned. Explicit size so a lazy image is never a 0x0 box that
      // never intersects; empty `alt` because the title beside it carries the
      // meaning (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img).
      // A failed load hides the tile instead of drawing a broken one.
      attrs: {
        class: 'dh-card-img', alt: '', width: 44, height: 44,
        loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: card.imageUrl,
      },
      on: { error: () => { image.hidden = true; } },
    });
    head.append(image);
  }
  head.append(textColumn);
  if (side.childElementCount > 0) head.append(side);

  const body = el('div', { attrs: { class: 'dh-card-body' }, children: [head] });
  if (card.rows.length > 0) {
    body.append(
      el('dl', {
        attrs: { class: 'dh-card-rows' },
        children: card.rows.map((row) =>
          el('div', {
            attrs: { class: 'dh-card-row' },
            children: [el('dt', { text: row.label }), el('dd', { text: row.value })],
          }),
        ),
      }),
    );
  }
  if (card.footer !== '') body.append(el('p', { attrs: { class: 'dh-card-footer' }, text: card.footer }));

  const item = el('li', { attrs: { class: 'dh-card', 'data-kind': card.kind }, children: [body] });
  const buttons = card.buttons.flatMap((button): HTMLElement[] => {
    if ('action' in button) {
      // An action is a button, not a link: it does something in this widget.
      if (onAction === undefined) return [];
      return [
        el('button', {
          attrs: { class: 'dh-card-btn', type: 'button' },
          text: button.label,
          on: { click: () => onAction(card, button) },
        }),
      ];
    }
    // A real link: it navigates, so it is announced and behaves as one.
    // `noopener` so the opened page cannot script this one through
    // `window.opener`; `noreferrer` so it never learns the host page's
    // URL, which on a storefront can carry an order id.
    return [
      el('a', {
        attrs: { class: 'dh-card-btn', href: button.url, target: '_blank', rel: 'noopener noreferrer' },
        text: button.label,
        children: [el('span', { attrs: { class: 'dh-sr' }, text: ' (opens in a new tab)' })],
      }),
    ];
  });
  if (buttons.length > 0) item.append(el('div', { attrs: { class: 'dh-card-actions' }, children: buttons }));
  return item;
}

function readCard(card: Record<string, unknown>): RichCard | null {
  // `v` is the version gate. A card shape this build has never seen is
  // dropped, not guessed at; the text in `content` still reaches the customer.
  if (own(card, 'v') !== 1) return null;
  const title = text(own(card, 'title'), 80);
  if (title === '') return null;

  const kind = own(card, 'kind');
  const badge = record(own(card, 'badge'));
  const badgeLabel = badge === null ? '' : text(own(badge, 'label'), 24);
  const tone = badge === null ? undefined : own(badge, 'tone');

  return {
    kind: typeof kind === 'string' && KINDS.has(kind) ? (kind as RichCardKind) : 'info',
    title,
    subtitle: text(own(card, 'subtitle'), 120),
    imageUrl: httpsUrl(own(card, 'imageUrl')),
    badge:
      badgeLabel === ''
        ? null
        : { label: badgeLabel, tone: typeof tone === 'string' && TONES.has(tone) ? (tone as RichCardTone) : 'neutral' },
    rows: list(own(card, 'rows'), MAX_ROWS, (row) => {
      const label = text(own(row, 'label'), 30);
      const value = text(own(row, 'value'), 120);
      return label !== '' && value !== '' ? { label, value } : null;
    }),
    buttons: list(own(card, 'buttons'), MAX_BUTTONS, (button): RichCardButton | null => {
      const label = text(own(button, 'label'), 20);
      if (label === '') return null;
      if (own(button, 'action') === 'track_order') {
        const ref = own(button, 'ref');
        return typeof ref === 'string' && ACTION_REF.test(ref.trim()) ? { label, action: 'track_order', ref: ref.trim() } : null;
      }
      const url = httpsUrl(own(button, 'url'));
      return url !== null ? { label, url } : null;
    }),
    footer: text(own(card, 'footer'), 60),
  };
}

/** The first `max` entries of an array that `read` accepts. */
function list<T>(value: unknown, max: number, read: (entry: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value.slice(0, max)) {
    const object = record(entry);
    const item = object === null ? null : read(object);
    if (item !== null) out.push(item);
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * An OWN property only. A plain `bag[key]` read walks the prototype chain, so
 * a host page with a prototype-pollution bug (`Object.prototype.richCards =
 * …`) would otherwise put a card, with link buttons, on every bot message.
 */
function own(object: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

/**
 * Removed from every card string: bidi embeddings, overrides and isolates
 * (U+202A–U+202E, U+2066–U+2069) and control characters other than tab and
 * newline. An override flips how the rest of a label reads, so "Track order"
 * could display as something else entirely. Zero-width joiners (U+200C,
 * U+200D) are kept: scripts and emoji sequences need them.
 */
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * Something a reader can see: a letter, number, punctuation mark or symbol
 * (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape).
 * A string of only spaces or zero-width characters is treated as absent, so
 * it cannot make an invisible title or an unlabelled button.
 */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** A high surrogate with its pair cut off: half an emoji renders as a replacement glyph. */
const LONE_HIGH = /[\uD800-\uDBFF]$/;

/**
 * A cleaned string of at most `max` characters, or `''`.
 *
 * Only the first `4 × max` code units are looked at, so a multi-megabyte
 * value costs no more than a short one. Hidden characters are removed, then
 * the string is trimmed, then it must contain something visible.
 *
 * Over-long text is cut with an ellipsis — the same convention as the reply
 * quote's excerpt — so a truncation is visible rather than silent. A high
 * surrogate left alone at a cut is dropped: half an emoji renders as a
 * replacement glyph.
 */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const clean = value.slice(0, max * 4).replace(LONE_HIGH, '').replace(HIDDEN, '').trim();
  if (!VISIBLE.test(clean)) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(LONE_HIGH, '').trimEnd()}…`;
}

/**
 * An absolute `https:` URL, or `null`.
 *
 * Parsed with `URL` rather than matched with a regex, and the PARSED form is
 * returned, so what lands in `src`/`href` is exactly what was checked. Too
 * long is refused rather than cut, because a cut URL points somewhere else.
 * Credentials are refused too: `https://shop.example@evil.example/` reads as
 * the shop and opens the other host.
 */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}
