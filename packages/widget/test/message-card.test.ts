// @vitest-environment jsdom
//
// `metadata.richCards` — the bot's rich cards (chat-service-node
// docs/specs/chatbot-workflows-lookup.md §2). Two halves, tested apart:
// `readRichCards` is the untrusted-input parser and is asserted exhaustively;
// `buildCardList` is the DOM it draws. Wiring into the transcript is covered
// in message-list.test.ts, where the rows render.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCardList, buildCardView, readRichCards, readRichIntro, readRichLayout } from '../src/ui/message-card.js';
import type { RichCard } from '../src/ui/message-card.js';
import { STYLES } from '../src/ui/styles.js';

/** A card exactly as chat-service writes one for `order_detail` (§2.1). */
function orderCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'order',
    title: 'Order #10482',
    subtitle: 'Rasoi',
    badge: { label: 'Out for delivery', tone: 'warning' },
    rows: [
      { label: 'Placed', value: '1 Oct, 3:45 pm' },
      { label: 'Total', value: '₹549.00' },
    ],
    buttons: [{ label: 'Track order', url: 'https://track.example.com/o/10482' }],
    footer: 'Updated just now',
    ...overrides,
  };
}

const read = (cards: unknown): readonly RichCard[] => readRichCards({ richCards: cards });
const one = (card: Record<string, unknown>): RichCard | undefined => read([card])[0];

describe('readRichCards — the happy path', () => {
  it('normalises a full order card', () => {
    expect(read([orderCard()])).toEqual([
      {
        kind: 'order',
        title: 'Order #10482',
        subtitle: 'Rasoi',
        imageUrl: null,
        badge: { label: 'Out for delivery', tone: 'warning' },
        rows: [
          { label: 'Placed', value: '1 Oct, 3:45 pm' },
          { label: 'Total', value: '₹549.00' },
        ],
        buttons: [{ label: 'Track order', url: 'https://track.example.com/o/10482' }],
        footer: 'Updated just now',
      },
    ]);
  });

  it('keeps an https image and leaves optional parts empty when absent', () => {
    expect(one({ v: 1, kind: 'product', title: 'Paneer Tikka', imageUrl: 'https://cdn.example.com/p.jpg' })).toEqual({
      kind: 'product',
      title: 'Paneer Tikka',
      subtitle: '',
      imageUrl: 'https://cdn.example.com/p.jpg',
      badge: null,
      rows: [],
      buttons: [],
      footer: '',
    });
  });

  it('accepts every kind and every tone the contract names', () => {
    for (const kind of ['product', 'item', 'order', 'info']) {
      expect(one(orderCard({ kind }))?.kind).toBe(kind);
    }
    for (const tone of ['neutral', 'success', 'warning', 'danger', 'info']) {
      expect(one(orderCard({ badge: { label: 'x', tone } }))?.badge?.tone).toBe(tone);
    }
  });

  it('trims surrounding whitespace', () => {
    const card = one(orderCard({ title: '  Order #1  ', rows: [{ label: ' Total ', value: ' ₹1 ' }] }));
    expect(card?.title).toBe('Order #1');
    expect(card?.rows).toEqual([{ label: 'Total', value: '₹1' }]);
  });

  it('ignores fields the contract does not define', () => {
    const card = one(orderCard({ html: '<b>x</b>', onclick: 'alert(1)', style: 'color:red', extra: { a: 1 } }));
    expect(Object.keys(card ?? {}).sort()).toEqual(
      ['badge', 'buttons', 'footer', 'imageUrl', 'kind', 'rows', 'subtitle', 'title'],
    );
  });

  it('leaves the other metadata keys alone', () => {
    const bag = { options: ['Refund'], kind: 'reply', richCards: [orderCard()] };
    readRichCards(bag);
    expect(bag.options).toEqual(['Refund']);
  });
});

describe('readRichCards — clamps (contract §2 limits)', () => {
  // Over-long text is cut to the limit with an ellipsis, so the result is
  // exactly the limit long and visibly truncated rather than silently so.
  it.each([
    ['title', 80],
    ['subtitle', 120],
    ['footer', 60],
  ] as const)('cuts %s to %i characters', (field, limit) => {
    const card = one(orderCard({ [field]: 'x'.repeat(limit + 50) }));
    const value = card?.[field] as string;
    expect(value).toHaveLength(limit);
    expect(value.endsWith('…')).toBe(true);
  });

  it.each([
    ['title', 80],
    ['subtitle', 120],
    ['footer', 60],
  ] as const)('keeps %s of exactly %i characters whole', (field, limit) => {
    expect(one(orderCard({ [field]: 'y'.repeat(limit) }))?.[field]).toBe('y'.repeat(limit));
  });

  it('cuts a row label to 30 and a row value to 120', () => {
    const row = one(orderCard({ rows: [{ label: 'L'.repeat(31), value: 'V'.repeat(121) }] }))?.rows[0];
    expect(row?.label).toHaveLength(30);
    expect(row?.value).toHaveLength(120);
    expect(one(orderCard({ rows: [{ label: 'L'.repeat(30), value: 'V'.repeat(120) }] }))?.rows[0]).toEqual({
      label: 'L'.repeat(30),
      value: 'V'.repeat(120),
    });
  });

  it('cuts a badge label to 24 and a button label to 20', () => {
    const card = one(
      orderCard({
        badge: { label: 'B'.repeat(40), tone: 'info' },
        buttons: [{ label: 'C'.repeat(40), url: 'https://example.com/' }],
      }),
    );
    expect(card?.badge?.label).toHaveLength(24);
    expect(card?.buttons[0]?.label).toHaveLength(20);
  });

  it('never leaves half of an emoji at the cut', () => {
    // 79 ASCII characters then a surrogate pair: a naive slice(0, 79) keeps
    // the high surrogate alone, which renders as a replacement glyph.
    const title = one(orderCard({ title: `${'a'.repeat(78)}😀😀😀` }))?.title ?? '';
    expect(title.endsWith('…')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(title)).toBe(false);
  });

  it('keeps at most 10 cards, 8 rows and 3 buttons', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const buttons = Array.from({ length: 6 }, (_, i) => ({ label: `B${i}`, url: `https://example.com/${i}` }));
    const cards = read(Array.from({ length: 12 }, (_, i) => orderCard({ title: `Card ${i}`, rows, buttons })));
    expect(cards.map((c) => c.title)).toEqual(Array.from({ length: 10 }, (_, i) => `Card ${i}`));
    expect(cards[0]?.rows.map((r) => r.label)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    expect(cards[0]?.buttons.map((b) => b.label)).toEqual(['B0', 'B1', 'B2']);
  });

  it('caps the work on an enormous array instead of walking it', () => {
    const cards = read(Array.from({ length: 100_000 }, () => orderCard()));
    expect(cards).toHaveLength(10);
  });
});

describe('readRichCards — URLs', () => {
  const image = (imageUrl: unknown) => one(orderCard({ imageUrl }))?.imageUrl;
  const button = (url: unknown) => one(orderCard({ buttons: [{ label: 'Go', url }] }))?.buttons;

  it.each([
    'http://cdn.example.com/p.jpg',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'blob:https://example.com/0f1e',
    'ftp://example.com/p.jpg',
    '//cdn.example.com/p.jpg',
    '/relative/p.jpg',
    'cdn.example.com/p.jpg',
    'https://user:secret@example.com/p.jpg',
    'https://example.com@evil.example/p.jpg',
    'https://',
    '',
    '   ',
    42,
    null,
    { href: 'https://example.com/' },
    ['https://example.com/'],
  ])('refuses %j as an image and as a link', (url) => {
    expect(image(url)).toBeNull();
    expect(button(url)).toEqual([]);
  });

  it('refuses a URL longer than 500 characters rather than cutting it', () => {
    const long = `https://example.com/${'a'.repeat(490)}`;
    expect(long.length).toBeGreaterThan(500);
    expect(image(long)).toBeNull();
    expect(button(long)).toEqual([]);
    const fits = `https://example.com/${'a'.repeat(480)}`;
    expect(fits.length).toBeLessThanOrEqual(500);
    expect(image(fits)).toBe(fits);
  });

  it('accepts https in any case and hands back the parsed form', () => {
    expect(image('HTTPS://CDN.Example.com/p.jpg')).toBe('https://cdn.example.com/p.jpg');
    expect(button(' https://example.com/track?id=1 ')).toEqual([
      { label: 'Go', url: 'https://example.com/track?id=1' },
    ]);
  });

  it('drops only the bad button, keeping the card and its good buttons', () => {
    const card = one(
      orderCard({
        buttons: [
          { label: 'Bad', url: 'javascript:alert(1)' },
          { label: 'Good', url: 'https://example.com/ok' },
        ],
      }),
    );
    expect(card?.title).toBe('Order #10482');
    expect(card?.buttons).toEqual([{ label: 'Good', url: 'https://example.com/ok' }]);
  });
});

describe('readRichCards — untrusted input', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['richCards'];
    delete (Object.prototype as Record<string, unknown>)['title'];
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'richCards'],
    ['a number', 7],
    ['an array', [orderCard()]],
    ['a bag with no richCards', { options: ['Refund'] }],
    ['richCards as an object', { richCards: orderCard() }],
    ['richCards as a string', { richCards: JSON.stringify([orderCard()]) }],
    ['richCards as null', { richCards: null }],
    ['richCards empty', { richCards: [] }],
  ])('returns nothing for %s', (_label, metadata) => {
    expect(readRichCards(metadata)).toEqual([]);
  });

  // One at a time, so each shape is actually inspected: only the first five
  // entries are ever read (see the cap test above).
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['a string', 'card'],
    ['true', true],
    ['an empty array', []],
    ['a card wrapped in an array', [orderCard()]],
    ['an empty object', {}],
    ['no title', { v: 1 }],
    ['a blank title', { v: 1, title: '   ' }],
    ['a numeric title', { v: 1, title: 42 }],
    ['an array title', { v: 1, title: ['Order'] }],
    ['an unknown version', { v: 2, title: 'From the future' }],
    ['a string version', { v: '1', title: 'Stringly versioned' }],
    ['a fractional version', { v: 1.5, title: 'Fractional' }],
    ['no version', { title: 'Unversioned' }],
  ])('drops a card that is %s', (_label, card) => {
    expect(read([card])).toEqual([]);
  });

  it('drops every card in an array of garbage without throwing', () => {
    expect(read([null, 'card', [], { v: 2, title: 'x' }, { v: 1, title: '' }])).toEqual([]);
  });

  it('keeps the good cards among bad ones', () => {
    expect(read([null, orderCard({ title: 'Kept' }), { v: 9, title: 'Dropped' }]).map((c) => c.title)).toEqual([
      'Kept',
    ]);
  });

  it('reads only the first ten entries, so a bad entry there is not replaced by an eleventh', () => {
    const cards = read([null, ...Array.from({ length: 10 }, (_, i) => orderCard({ title: `Card ${i}` }))]);
    expect(cards.map((c) => c.title)).toEqual(Array.from({ length: 9 }, (_, i) => `Card ${i}`));
  });

  it('falls back to info for an unknown or missing kind', () => {
    expect(one(orderCard({ kind: 'coupon' }))?.kind).toBe('info');
    expect(one(orderCard({ kind: 7 }))?.kind).toBe('info');
    expect(one(orderCard({ kind: undefined }))?.kind).toBe('info');
    expect(one(orderCard({ kind: '__proto__' }))?.kind).toBe('info');
  });

  it('falls back to neutral for an unknown tone, and drops a badge with no label', () => {
    expect(one(orderCard({ badge: { label: 'Paid', tone: 'rainbow' } }))?.badge).toEqual({
      label: 'Paid',
      tone: 'neutral',
    });
    expect(one(orderCard({ badge: { label: 'Paid' } }))?.badge?.tone).toBe('neutral');
    expect(one(orderCard({ badge: { label: 'Paid', tone: 'constructor' } }))?.badge?.tone).toBe('neutral');
    expect(one(orderCard({ badge: { tone: 'success' } }))?.badge).toBeNull();
    expect(one(orderCard({ badge: 'Delivered' }))?.badge).toBeNull();
    expect(one(orderCard({ badge: ['Delivered', 'success'] }))?.badge).toBeNull();
  });

  it('drops rows and buttons that are not well-formed objects', () => {
    const card = one(
      orderCard({
        rows: [null, 'Placed: today', ['Placed', 'today'], { label: 'Placed' }, { value: 'today' }, { label: '', value: 'x' }, { label: 'Total', value: 549 }, { label: 'Ok', value: 'Yes' }],
        buttons: [null, 'https://example.com', { url: 'https://example.com' }, { label: 'Go' }, { label: '  ', url: 'https://example.com' }],
      }),
    );
    expect(card?.rows).toEqual([{ label: 'Ok', value: 'Yes' }]);
    expect(card?.buttons).toEqual([]);
    expect(one(orderCard({ rows: 'Placed: today', buttons: { label: 'Go' } }))).toMatchObject({ rows: [], buttons: [] });
  });

  it('reads only its own keys, never ones inherited from a polluted prototype', () => {
    // A host page with a prototype-pollution bug must not be able to make
    // every bot message in this widget grow a card.
    (Object.prototype as Record<string, unknown>)['richCards'] = [orderCard()];
    expect(readRichCards({})).toEqual([]);
    expect(readRichCards({ options: ['x'] })).toEqual([]);

    (Object.prototype as Record<string, unknown>)['title'] = 'Inherited title';
    expect(read([{ v: 1 }])).toEqual([]);
  });

  it('ignores a __proto__ key, whether JSON-parsed or set as a literal prototype', () => {
    const parsed: unknown = JSON.parse(`{"__proto__": {"richCards": [${JSON.stringify(orderCard())}]}}`);
    expect(readRichCards(parsed)).toEqual([]);
    expect(readRichCards({ __proto__: { richCards: [orderCard()] } })).toEqual([]);
    const card: unknown = JSON.parse(`{"__proto__": {"v": 1, "title": "Smuggled"}}`);
    expect(read([card])).toEqual([]);
    // And parsing it pollutes nothing.
    expect(({} as Record<string, unknown>)['richCards']).toBeUndefined();
  });

  it('never throws, even on a hostile getter or a proxy', () => {
    const getter = Object.defineProperty({}, 'richCards', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(readRichCards(getter)).toEqual([]);

    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
        has() {
          throw new Error('boom');
        },
      },
    );
    expect(readRichCards(trap)).toEqual([]);
    expect(readRichCards({ richCards: [trap] })).toEqual([]);
  });

  it('takes markup in any text field as plain text', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const card = one(
      orderCard({
        title: payload,
        rows: [{ label: payload, value: payload }],
      }),
    );
    // Unchanged: escaping is the renderer's job (textContent), and mangling the
    // string here would print entities at the customer.
    expect(card?.title).toBe(payload);
    expect(card?.rows[0]).toEqual({ label: payload, value: payload });
  });
});

describe('buildCardView: laid out as the merchant set it, with no Swipe/List switch', () => {
  const view = (n: number, initial: 'row' | 'column' | null = null) =>
    buildCardView(read(Array.from({ length: n }, (_, i) => orderCard({ title: `Card ${i}` }))), initial);

  it('leaves one or two cards as the plain list, with nothing around it', () => {
    for (const n of [1, 2]) {
      const root = view(n);
      expect(root.tagName).toBe('UL');
      expect(root.classList.contains('dh-cards')).toBe(true);
      expect(root.querySelector('.dh-cards-bar')).toBeNull();
    }
  });

  it('wraps three or more in a view that opens swiping sideways when nothing was set, with arrows', () => {
    const root = view(10);
    expect(root.classList.contains('dh-cards-view')).toBe(true);
    expect(root.getAttribute('data-view')).toBe('row');
    const list = root.querySelector('ul.dh-cards') as HTMLElement;
    expect(list.getAttribute('role')).toBe('list');
    expect(list.querySelectorAll(':scope > li.dh-card')).toHaveLength(10);
    // The scrolling box can be reached and scrolled from the keyboard, and says what it holds.
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('aria-label')).toBe('10 cards');
    expect(root.querySelectorAll('.dh-cards-nav')).toHaveLength(2);
  });

  it('draws no Swipe or List switch, in either layout', () => {
    for (const initial of [null, 'row', 'column'] as const) {
      const root = view(5, initial);
      expect(root.querySelector('.dh-cards-mode')).toBeNull();
      expect(root.textContent).not.toContain('Swipe');
      expect(root.textContent).not.toMatch(/List/);
    }
  });

  it('opens in the layout the merchant chose: a list for "column" (no arrows), sideways with arrows for "row"', () => {
    const list = view(4, 'column');
    expect(list.getAttribute('data-view')).toBe('column');
    expect(list.querySelector('.dh-cards-bar')).toBeNull(); // a list scrolls by itself
    const swipe = view(4, 'row');
    expect(swipe.getAttribute('data-view')).toBe('row');
    expect(swipe.querySelectorAll('.dh-cards-nav')).toHaveLength(2);
    // Fewer than three cards have no view to open in.
    expect(buildCardView(read([orderCard(), orderCard()]), 'column').tagName).toBe('UL');
  });

  it('readRichLayout: horizontal and vertical only; anything else leaves the default, and it never throws', () => {
    expect(readRichLayout({ richLayout: 'horizontal' })).toBe('row');
    expect(readRichLayout({ richLayout: 'vertical' })).toBe('column');
    for (const bad of [{ richLayout: 'diagonal' }, { richLayout: 1 }, {}, null, undefined, 'x', []]) {
      expect(readRichLayout(bad)).toBeNull();
    }
    expect(readRichLayout(Object.create({ richLayout: 'vertical' }))).toBeNull();
    expect(readRichLayout({ get richLayout(): string { throw new Error('boom'); } })).toBeNull();
  });

  it('the arrows move the swipe one card at a time, without gliding', () => {
    const root = view(4);
    const list = root.querySelector('ul.dh-cards') as HTMLElement;
    const calls: unknown[] = [];
    list.scrollBy = ((arg: unknown) => void calls.push(arg)) as typeof list.scrollBy;
    const [prev, next] = [...root.querySelectorAll<HTMLButtonElement>('.dh-cards-nav')];
    next!.click();
    prev!.click();
    const lefts = calls.map((c) => (c as { left: number }).left);
    expect(lefts[0]).toBeGreaterThan(0);
    expect(lefts[1]).toBe(-lefts[0]!);
    expect(calls.every((c) => (c as { behavior?: string }).behavior === undefined)).toBe(true);
  });

  it('is styled for both: a snapping sideways scroller, and a height-capped list that scrolls up and down', () => {
    const rule = (selector: string) => STYLES.slice(STYLES.indexOf(selector)).split('}')[0]!;
    expect(rule('.dh-cards-view[data-view="row"] > .dh-cards {')).toMatch(/overflow-x: auto[\s\S]*scroll-snap-type: x mandatory/);
    expect(rule('.dh-cards-view[data-view="column"] > .dh-cards {')).toMatch(/max-height: \d+px[\s\S]*overflow-y: auto/);
    expect(STYLES.slice(STYLES.indexOf('.dh-cards-view {'), STYLES.indexOf('.dh-cards-view[data-view="column"] > .dh-cards > .dh-card'))).not.toMatch(
      /transition|animation|(?<!over)scroll-behavior/,
    );
  });
});

describe('buildCardList', () => {
  const build = (cards: readonly unknown[]) => buildCardList(read(cards));
  const texts = (root: ParentNode, selector: string) =>
    [...root.querySelectorAll(selector)].map((node) => node.textContent);

  it('is a list of cards, one item per card', () => {
    const list = build([orderCard({ title: 'A' }), orderCard({ title: 'B' })]);
    expect(list.tagName).toBe('UL');
    // Explicit: Safari drops the implicit list role from a list styled
    // `list-style: none` (MDN, CSS list-style, Accessibility), and VoiceOver
    // then reads the cards as loose text.
    expect(list.getAttribute('role')).toBe('list');
    expect([...list.children].map((c) => c.tagName)).toEqual(['LI', 'LI']);
    expect(texts(list, '.dh-card-title')).toEqual(['A', 'B']);
  });

  it('draws every part of an order card', () => {
    const card = build([orderCard()]).querySelector('.dh-card')!;
    expect(card.getAttribute('data-kind')).toBe('order');
    expect(texts(card, '.dh-card-title')).toEqual(['Order #10482']);
    expect(texts(card, '.dh-card-sub')).toEqual(['Rasoi']);
    expect(texts(card, '.dh-card-footer')).toEqual(['Updated just now']);
    expect(texts(card, '.dh-card-row dt')).toEqual(['Placed', 'Total']);
    expect(texts(card, '.dh-card-row dd')).toEqual(['1 Oct, 3:45 pm', '₹549.00']);
    // The order card's sub-line is the store, under the title.
    expect(card.querySelector('.dh-card-text .dh-card-sub')).not.toBeNull();
  });

  it('names the status in words on the chip, with the tone only as a hook for colour', () => {
    const badge = build([orderCard()]).querySelector('.dh-card-badge')!;
    expect(badge.textContent).toBe('Out for delivery');
    expect(badge.getAttribute('data-tone')).toBe('warning');
  });

  it.each(['product', 'item'])('puts a %s card’s price beside the name and its chip under it, as the console preview does', (kind) => {
    const card = build([
      { v: 1, kind, title: 'Paneer Tikka', subtitle: '₹249.00', badge: { label: 'Out of stock', tone: 'danger' } },
    ]).querySelector('.dh-card')!;
    expect(texts(card, '.dh-card-side .dh-card-sub')).toEqual(['₹249.00']);
    expect(texts(card, '.dh-card-text .dh-card-badge')).toEqual(['Out of stock']);
    expect(card.querySelector('.dh-card-text .dh-card-sub')).toBeNull();
    expect(card.querySelector('.dh-card-side .dh-card-badge')).toBeNull();
  });

  it('puts an order card’s status chip on the right', () => {
    const card = build([orderCard()]).querySelector('.dh-card')!;
    expect(texts(card, '.dh-card-side .dh-card-badge')).toEqual(['Out for delivery']);
    expect(card.querySelector('.dh-card-side .dh-card-sub')).toBeNull();
  });

  it('omits the parts a card does not have', () => {
    const card = build([{ v: 1, title: 'Just a title' }]).querySelector('.dh-card')!;
    expect(card.getAttribute('data-kind')).toBe('info');
    for (const part of ['.dh-card-img', '.dh-card-sub', '.dh-card-badge', '.dh-card-rows', '.dh-card-footer', '.dh-card-actions']) {
      expect(card.querySelector(part)).toBeNull();
    }
  });

  it('makes each button a real link that opens in a new tab without a referrer or opener', () => {
    const links = [...build([orderCard({
      buttons: [
        { label: 'Track order', url: 'https://track.example.com/o/1' },
        { label: 'Help', url: 'https://help.example.com/' },
      ],
    })]).querySelectorAll<HTMLAnchorElement>('.dh-card-actions a')];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.classList.contains('dh-card-btn')).toBe(true);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://track.example.com/o/1', 'https://help.example.com/']);
    // The visible label, plus the new-tab warning for a screen reader.
    expect(links[0]!.textContent).toBe('Track order (opens in a new tab)');
    expect(links[0]!.querySelector('.dh-sr')?.textContent).toBe(' (opens in a new tab)');
  });

  it('loads an image lazily, without a referrer, as decoration', () => {
    const img = build([orderCard({ imageUrl: 'https://cdn.example.com/p.jpg' })]).querySelector('img')!;
    expect(img.classList.contains('dh-card-img')).toBe(true);
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/p.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['44', '44']);
    // Decorative: the title next to it already says what it is.
    expect(img.getAttribute('alt')).toBe('');
    expect(img.hidden).toBe(false);
  });

  it('sets the referrer policy before the source, so the first request already carries it', () => {
    const img = build([orderCard({ imageUrl: 'https://cdn.example.com/p.jpg' })]).querySelector('img')!;
    const names = [...img.attributes].map((a) => a.name);
    expect(names.indexOf('referrerpolicy')).toBeLessThan(names.indexOf('src'));
    expect(names.indexOf('loading')).toBeLessThan(names.indexOf('src'));
  });

  it('hides an image that fails to load instead of leaving a broken-image glyph', () => {
    const img = build([orderCard({ imageUrl: 'https://cdn.example.com/missing.jpg' })]).querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
  });

  it('draws one card or ten, and never an eleventh', () => {
    expect(build([orderCard()]).querySelectorAll('.dh-card')).toHaveLength(1);
    expect(build(Array.from({ length: 10 }, () => orderCard())).querySelectorAll('.dh-card')).toHaveLength(10);
    expect(build(Array.from({ length: 11 }, () => orderCard())).querySelectorAll('.dh-card')).toHaveLength(10);
  });

  describe('markup in the data stays text', () => {
    const PAYLOADS = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '"><svg onload=alert(1)>',
      '&lt;b&gt;bold&lt;/b&gt;',
    ];

    it.each(PAYLOADS)('renders %j literally in every field', (payload) => {
      const list = build([
        {
          v: 1,
          kind: 'order',
          title: payload,
          subtitle: payload,
          badge: { label: payload.slice(0, 24), tone: 'info' },
          rows: [{ label: payload.slice(0, 30), value: payload }],
          buttons: [{ label: payload.slice(0, 20), url: 'https://example.com/' }],
          footer: payload,
        },
      ]);
      expect(texts(list, '.dh-card-title')).toEqual([payload]);
      expect(texts(list, '.dh-card-sub')).toEqual([payload]);
      expect(texts(list, '.dh-card-footer')).toEqual([payload]);
      expect(texts(list, '.dh-card-row dd')).toEqual([payload]);
      expect(texts(list, '.dh-card-row dt')).toEqual([payload.slice(0, 30)]);
      expect(texts(list, '.dh-card-badge')).toEqual([payload.slice(0, 24)]);
      expect(list.querySelector('.dh-card-btn')!.firstChild?.textContent).toBe(payload.slice(0, 20));
      // Nothing was parsed: no element the payload names exists, and no
      // attribute carries an event handler.
      expect(list.querySelectorAll('img, script, svg, b')).toHaveLength(0);
      expect([...list.querySelectorAll('*')].flatMap((n) => [...n.attributes]).some((a) => a.name.startsWith('on'))).toBe(false);
    });

    it('never assigns markup through an HTML sink', () => {
      const sinks = [
        vi.spyOn(Element.prototype, 'innerHTML', 'set'),
        vi.spyOn(Element.prototype, 'outerHTML', 'set'),
        vi.spyOn(Element.prototype, 'insertAdjacentHTML'),
      ];
      try {
        build([orderCard({ title: PAYLOADS[0], imageUrl: 'https://cdn.example.com/p.jpg' })]);
        for (const sink of sinks) expect(sink).not.toHaveBeenCalled();
      } finally {
        for (const sink of sinks) sink.mockRestore();
      }
    });

    it('has no HTML sink anywhere in its source', () => {
      // A string path, not `new URL(...)`: under jsdom the global URL is jsdom's, which node:fs refuses.
      const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/message-card.ts'), 'utf8');
      expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/);
    });
  });
});

// jsdom lays nothing out, so these read the sheet itself. The real paint is
// checked in a browser (see the package README's rich-card preview).
describe('the rich-card stylesheet', () => {
  const rule = (selector: string) => {
    const start = STYLES.indexOf(`\n${selector} {`);
    expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
    return STYLES.slice(start, STYLES.indexOf('}', start));
  };

  it('gives every card link at least a 44px tap target', () => {
    expect(rule('.dh-card-btn')).toContain('min-height: 44px');
  });

  it('defines every tone colour in the light palette and in both dark ones', () => {
    // Light on :host; dark once under the OS media query and once under the
    // explicit data-theme attribute (styles.ts DARK_TOKENS).
    for (const token of ['--dh-tone-success', '--dh-tone-warning', '--dh-tone-info']) {
      expect(STYLES.split(`${token}:`).length - 1, token).toBe(3);
    }
    // The lifted link colour is dark-only (twice); light falls back to the accent.
    expect(STYLES.split('--dh-card-link:').length - 1).toBe(2);
    expect(rule('.dh-card-btn')).toContain('color: var(--dh-card-link, var(--dh-accent))');
    for (const tone of ['success', 'warning', 'danger', 'info']) {
      expect(STYLES).toContain(`.dh-card-badge[data-tone="${tone}"]`);
    }
  });

  it('animates nothing, so reduced motion has nothing to switch off', () => {
    const cardCss = STYLES.slice(STYLES.indexOf('\n.dh-cards {'), STYLES.indexOf('.dh-card-btn:focus-visible'));
    expect(cardCss).not.toMatch(/transition|animation/);
  });
});

describe('readRichCards — hidden and invisible characters', () => {
  // Bidi embeddings, overrides and isolates.
  const BIDI = ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩'];

  it.each(BIDI.map((c) => [`U+${c.codePointAt(0)!.toString(16).toUpperCase()}`, c]))(
    'strips %s from every text field',
    (_name, c) => {
      const card = one({
        v: 1,
        title: `${c}Order${c} #1`,
        subtitle: `${c}Rasoi`,
        badge: { label: `${c}Paid`, tone: 'success' },
        rows: [{ label: `${c}Total`, value: `₹1${c}` }],
        buttons: [{ label: `${c}Track`, url: 'https://example.com/' }],
        footer: `Updated${c}`,
      });
      expect(card).toMatchObject({
        title: 'Order #1',
        subtitle: 'Rasoi',
        badge: { label: 'Paid', tone: 'success' },
        rows: [{ label: 'Total', value: '₹1' }],
        buttons: [{ label: 'Track', url: 'https://example.com/' }],
        footer: 'Updated',
      });
    },
  );

  it('takes the override off an RLO-prefixed button label, leaving the characters as sent', () => {
    // U+202E would make "redro kcarT" DISPLAY as "Track order". Stripped, it
    // shows as what it really is.
    const card = one(orderCard({ buttons: [{ label: '‮redro kcarT', url: 'https://example.com/' }] }));
    expect(card?.buttons[0]?.label).toBe('redro kcarT');
    expect(card?.buttons[0]?.label).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('strips control characters but keeps tab and newline', () => {
    expect(one(orderCard({ title: 'Order\u0000\u0007\u001B\u007F\u0085 #1' }))?.title).toBe('Order #1');
    expect(one(orderCard({ footer: 'Line one\nLine\ttwo' }))?.footer).toBe('Line one\nLine\ttwo');
  });

  it('keeps zero-width joiners and non-joiners, which scripts and emoji need', () => {
    const family = '👨‍👩‍👧';
    const devanagari = 'क्‍ष';
    const persian = 'می‌خواهم';
    expect(one(orderCard({ title: family }))?.title).toBe(family);
    expect(one(orderCard({ title: devanagari }))?.title).toBe(devanagari);
    expect(one(orderCard({ title: persian }))?.title).toBe(persian);
  });

  it.each([
    ['zero-width spaces', '​​​'],
    ['a lone joiner', '‍'],
    ['a bidi override and spaces', ' ‮ ⁦ '],
    ['control characters', '\u0000\u0007'],
    ['a combining mark alone', '́'],
    ['no-break spaces', '  '],
  ])('drops a card whose title is only %s', (_label, title) => {
    expect(read([orderCard({ title })])).toEqual([]);
  });

  it('drops an invisible button label, row label, row value or badge label', () => {
    const card = one(
      orderCard({
        badge: { label: '​', tone: 'danger' },
        rows: [
          { label: '​', value: 'shown?' },
          { label: 'Shown?', value: '​​' },
          { label: 'Kept', value: 'Yes' },
        ],
        buttons: [
          { label: '​', url: 'https://example.com/a' },
          { label: 'Kept', url: 'https://example.com/b' },
        ],
      }),
    );
    expect(card?.badge).toBeNull();
    expect(card?.rows).toEqual([{ label: 'Kept', value: 'Yes' }]);
    expect(card?.buttons).toEqual([{ label: 'Kept', url: 'https://example.com/b' }]);
  });

  it('keeps a title that is only an emoji or only punctuation', () => {
    expect(one(orderCard({ title: '🍕' }))?.title).toBe('🍕');
    expect(one(orderCard({ title: '#1' }))?.title).toBe('#1');
  });

  it('reads only the start of a multi-megabyte field', () => {
    const card = one(orderCard({ title: 'x'.repeat(5_000_000), footer: `${' '.repeat(5_000_000)}late` }));
    expect(card?.title).toHaveLength(80);
    // The footer's text sits past the window, so it is treated as absent.
    expect(card?.footer).toBe('');
  });
});

describe('readRichIntro', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['richIntro'];
  });

  it('returns the intro line, trimmed', () => {
    expect(readRichIntro({ richIntro: '  Here is what I found.  ' })).toBe('Here is what I found.');
  });

  it('keeps a newline, since the bubble shows line breaks', () => {
    expect(readRichIntro({ richIntro: 'Here are the details.\nTap a card for more.' })).toBe(
      'Here are the details.\nTap a card for more.',
    );
  });

  it.each([
    ['no metadata', undefined],
    ['null metadata', null],
    ['string metadata', 'Here'],
    ['array metadata', [{ richIntro: 'Here' }]],
    ['no richIntro', { richCards: [] }],
    ['a number', { richIntro: 42 }],
    ['an object', { richIntro: { text: 'Here' } }],
    ['an array', { richIntro: ['Here'] }],
    ['true', { richIntro: true }],
    ['an empty string', { richIntro: '' }],
    ['spaces', { richIntro: '   ' }],
    ['zero-width spaces', { richIntro: '​​' }],
    ['a bidi override alone', { richIntro: '‮' }],
  ])('returns nothing for %s', (_label, metadata) => {
    expect(readRichIntro(metadata)).toBe('');
  });

  it('clamps to 300 with an ellipsis, and keeps exactly 300 whole', () => {
    const cut = readRichIntro({ richIntro: 'a'.repeat(301) });
    expect(cut).toHaveLength(300);
    expect(cut.endsWith('…')).toBe(true);
    expect(readRichIntro({ richIntro: 'b'.repeat(300) })).toBe('b'.repeat(300));
  });

  it('handles a 5 MB value by reading only its start', () => {
    const started = performance.now();
    const intro = readRichIntro({ richIntro: 'a'.repeat(5 * 1024 * 1024) });
    expect(intro).toHaveLength(300);
    // Generous: the point is that it does not walk five megabytes.
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('returns markup unchanged, as text for textContent to print', () => {
    expect(readRichIntro({ richIntro: '<img src=x onerror=alert(1)>' })).toBe('<img src=x onerror=alert(1)>');
  });

  it('strips bidi overrides and control characters', () => {
    expect(readRichIntro({ richIntro: '‮Here⁦ is\u0000 what I found.' })).toBe('Here is what I found.');
  });

  it('reads only its own key and never throws', () => {
    (Object.prototype as Record<string, unknown>)['richIntro'] = 'Inherited';
    expect(readRichIntro({})).toBe('');
    const getter = Object.defineProperty({}, 'richIntro', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(readRichIntro(getter)).toBe('');
  });
});

describe('action buttons: "Track order" that the widget handles itself', () => {
  const action = { label: 'Track order', action: 'track_order', ref: '3742' };

  it('reads a track_order action with its order number', () => {
    expect(one(orderCard({ buttons: [action] }))?.buttons).toEqual([{ label: 'Track order', action: 'track_order', ref: '3742' }]);
  });

  it('drops an unknown action, a missing, spaced or over-long ref, and keeps the link beside them', () => {
    const bad = [
      { label: 'A', action: 'open_url', ref: '1' },
      { label: 'B', action: 'track_order' },
      { label: 'C', action: 'track_order', ref: 'a b' },
      { label: 'D', action: 'track_order', ref: 'x'.repeat(65) },
    ];
    // Only the first 3 buttons are ever read (contract §2), so each bad one is tried beside the link.
    for (const b of bad) {
      expect(one(orderCard({ buttons: [{ label: 'Link', url: 'https://track.example.com/o/1' }, b] }))?.buttons).toEqual([
        { label: 'Link', url: 'https://track.example.com/o/1' },
      ]);
    }
  });

  it('draws a real button and hands the card and the action to the handler on tap', () => {
    const onAction = vi.fn();
    const card = one(orderCard({ buttons: [action] }))!;
    const list = buildCardList([card], onAction);
    const button = list.querySelector<HTMLButtonElement>('button.dh-card-btn')!;
    expect(button.textContent).toBe('Track order');
    expect(button.type).toBe('button');
    button.click();
    expect(onAction).toHaveBeenCalledWith(card, { label: 'Track order', action: 'track_order', ref: '3742' });
  });

  describe('the widget’s own "Track order" on an order card that has none', () => {
    const tapOf = (card: Record<string, unknown>) => {
      const onAction = vi.fn();
      const list = buildCardList([one(card)!], onAction);
      return { list, onAction, buttons: [...list.querySelectorAll<HTMLElement>('.dh-card-btn')] };
    };

    it('adds a Track order button from the order number in the title, with no URL', () => {
      const { buttons, onAction } = tapOf(orderCard({ buttons: [] }));
      expect(buttons.map((b) => b.tagName + ':' + b.textContent)).toEqual(['BUTTON:Track order']);
      buttons[0]!.click();
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ title: 'Order #10482' }), {
        label: 'Track order', action: 'track_order', ref: '10482',
      });
    });

    it('leaves a card that already tracks alone: its own link, or its own action', () => {
      const link = tapOf(orderCard()).buttons; // the fixture carries a Track order LINK
      expect(link.map((b) => b.tagName)).toEqual(['A']);
      const own = tapOf(orderCard({ buttons: [action] })).buttons;
      expect(own.map((b) => b.tagName)).toEqual(['BUTTON']);
    });

    it('keeps other buttons and adds Track order beside them', () => {
      const { buttons } = tapOf(orderCard({ buttons: [{ label: 'Help', url: 'https://help.example.com/' }] }));
      expect(buttons.map((b) => b.textContent?.replace(' (opens in a new tab)', ''))).toEqual(['Help', 'Track order']);
    });

    it.each([
      ['a card that is not an order', { kind: 'product', title: 'Pizza #12', buttons: [] }],
      ['an order title with no number', { title: 'Your order', buttons: [] }],
      ['an order number that cannot be a ref', { title: 'Order # ', buttons: [] }],
    ])('adds nothing for %s', (_name, overrides) => {
      expect(tapOf(orderCard(overrides)).buttons).toEqual([]);
    });

    it('adds nothing when nothing can handle the tap', () => {
      expect(buildCardList([one(orderCard({ buttons: [] }))!]).querySelector('.dh-card-btn')).toBeNull();
    });
  });

  it('draws no action button when nothing can handle it, and no empty actions row', () => {
    const list = buildCardList([one(orderCard({ buttons: [action] }))!]);
    expect(list.querySelector('.dh-card-btn')).toBeNull();
    expect(list.querySelector('.dh-card-actions')).toBeNull();
  });
});

describe('add_to_cart: product cards hand the product to the host app', () => {
  const product = (buttons: unknown[] = []) => ({
    v: 1,
    kind: 'product',
    title: 'Cheese Burst Pizza',
    subtitle: '₹380.00',
    imageUrl: 'https://cdn.example.com/p.avif',
    buttons,
  });
  const add = { label: 'Add to cart', action: 'add_to_cart', ref: 'item_42' };
  const tap = (card: Record<string, unknown>, onAction: (c: RichCard, b: never) => void | Promise<void>, supports?: (a: string) => boolean) => {
    const list = buildCardList([one(card)!], onAction as never, supports as never);
    return list.querySelector<HTMLButtonElement>('button.dh-card-btn');
  };

  it('reads the product id, and the variant when there is one', () => {
    expect(one(product([add]))?.buttons).toEqual([{ label: 'Add to cart', action: 'add_to_cart', ref: 'item_42' }]);
    expect(one(product([{ ...add, variantId: 'v_7' }]))?.buttons).toEqual([
      { label: 'Add to cart', action: 'add_to_cart', ref: 'item_42', variantId: 'v_7' },
    ]);
  });

  it('drops a button without a usable product id, and a variant that is not an id', () => {
    expect(one(product([{ label: 'A', action: 'add_to_cart' }, { label: 'B', action: 'add_to_cart', ref: 'a b' }]))?.buttons).toEqual([]);
    expect(one(product([{ ...add, variantId: 'has space' }]))?.buttons).toEqual([
      { label: 'Add to cart', action: 'add_to_cart', ref: 'item_42' },
    ]);
  });

  it('draws nothing when the host cannot add to a cart', () => {
    const onAction = vi.fn();
    expect(tap(product([add]), onAction, (a) => a !== 'add_to_cart')).toBeNull();
    expect(tap(product([add]), onAction)).not.toBeNull();
  });

  it('waits on the host: Adding..., then Added, then the label again', async () => {
    vi.useFakeTimers();
    let done!: () => void;
    const onAction = vi.fn(() => new Promise<void>((resolve) => { done = resolve; }));
    const button = tap(product([add]), onAction)!;
    button.click();
    expect(button.textContent).toBe('Adding…');
    expect(button.disabled).toBe(true);
    button.click(); // a double tap while busy adds nothing more
    expect(onAction).toHaveBeenCalledTimes(1);
    done();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe('Added');
    expect(button.getAttribute('data-state')).toBe('added');
    await vi.advanceTimersByTimeAsync(2000);
    expect(button.textContent).toBe('Add to cart');
    expect(button.disabled).toBe(false);
    vi.useRealTimers();
  });

  it('says Try again, and can be tapped again, when the host refuses or throws', async () => {
    for (const onAction of [vi.fn(() => Promise.reject(new Error('no store'))), vi.fn(() => { throw new Error('boom'); })]) {
      const button = tap(product([add]), onAction)!;
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(button.textContent).toBe('Try again');
      expect(button.getAttribute('data-state')).toBe('error');
      expect(button.disabled).toBe(false);
    }
  });
});
