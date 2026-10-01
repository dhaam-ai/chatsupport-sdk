// The commerce cards a flow step can send inside a bot message's own
// metadata (chatbot-workflows-commerce.md §8; chat-service-node's
// application/flows/flow-messages.ts's `botMessage` and interpreter.ts's
// `Product`/`OrderSummary`): a discount code, a short list of products, or
// an order's status. Read-only display — no add-to-cart action, no button
// wiring here (`onAction` is Part 3).
//
// Same defensive posture as quick-replies.ts's `readQuickReplies` and
// message-list.ts's `readReplyQuote`: this metadata arrives from a flow
// step two services away, so a missing or malformed field renders nothing
// for that field rather than throwing, and a bag with nothing usable in it
// renders no card at all.

import { el } from './dom.js';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface DiscountCard {
  readonly kind: 'discount';
  readonly code: string;
  readonly label: string | undefined;
  readonly terms: string | undefined;
}

export interface ProductCardItem {
  readonly id: string;
  readonly name: string;
  readonly price: number | undefined;
  readonly currency: string | undefined;
  readonly imageUrl: string | undefined;
  readonly url: string | undefined;
}

export interface ProductsCard {
  readonly kind: 'products';
  readonly items: readonly ProductCardItem[];
}

export interface OrderCard {
  readonly kind: 'order';
  readonly number: string;
  readonly statusLabel: string;
  readonly eta: string | undefined;
  readonly trackingUrl: string | undefined;
}

export type FlowCard = DiscountCard | ProductsCard | OrderCard;

/** A chat bubble is not a storefront — more than this reads as a catalogue page, not a suggestion. */
const MAX_PRODUCTS = 3;

function readDiscount(bag: Record<string, unknown>): DiscountCard | null {
  const d = record(bag['discount']);
  if (d === null) return null;
  const code = str(d['code']);
  if (code === undefined) return null;
  return { kind: 'discount', code, label: str(d['label']), terms: str(d['terms']) };
}

function readProducts(bag: Record<string, unknown>): ProductsCard | null {
  const raw = bag['products'];
  if (!Array.isArray(raw)) return null;

  const items: ProductCardItem[] = [];
  for (const entry of raw) {
    const p = record(entry);
    const id = str(p?.['id']);
    const name = str(p?.['name']);
    if (id === undefined || name === undefined) continue;
    items.push({
      id,
      name,
      price: num(p?.['price']),
      currency: str(p?.['currency']),
      imageUrl: str(p?.['imageUrl']),
      url: str(p?.['url']),
    });
    if (items.length === MAX_PRODUCTS) break;
  }
  return items.length === 0 ? null : { kind: 'products', items };
}

function readOrder(bag: Record<string, unknown>): OrderCard | null {
  const o = record(bag['order']);
  if (o === null) return null;
  const number = str(o['number']);
  const statusLabel = str(o['statusLabel']);
  if (number === undefined || statusLabel === undefined) return null;
  return { kind: 'order', number, statusLabel, eta: str(o['eta']), trackingUrl: str(o['trackingUrl']) };
}

/**
 * `message.metadata` → the one commerce card it carries, or `null`. A flow
 * step sends at most one of `discount`/`products`/`order` per message
 * (flow-messages.ts's `botMessage`), so the first recognised, well-formed
 * key wins. Never throws.
 */
export function readFlowCard(metadata: unknown): FlowCard | null {
  const bag = record(metadata);
  if (bag === null) return null;
  return readDiscount(bag) ?? readProducts(bag) ?? readOrder(bag);
}

function selectText(node: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderDiscount(card: DiscountCard): HTMLElement {
  const codeBox = el('span', { attrs: { class: 'dh-discount-code' }, text: card.code });
  const copy = el('button', {
    attrs: { class: 'dh-discount-copy', type: 'button' },
    text: 'Copy code',
    on: {
      click: () => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          selectText(codeBox);
          return;
        }
        navigator.clipboard.writeText(card.code).catch(() => selectText(codeBox));
      },
    },
  });

  const children: HTMLElement[] = [];
  if (card.label !== undefined) children.push(el('div', { attrs: { class: 'dh-discount-label' }, text: card.label }));
  children.push(codeBox, copy);
  if (card.terms !== undefined) children.push(el('div', { attrs: { class: 'dh-discount-terms' }, text: card.terms }));

  return el('div', { attrs: { class: 'dh-flow-card dh-discount-card' }, children });
}

function renderProducts(card: ProductsCard): HTMLElement {
  const rows = card.items.map((item) => {
    const children: HTMLElement[] = [];
    if (item.imageUrl !== undefined && /^https?:/.test(item.imageUrl)) {
      children.push(
        el('img', { attrs: { class: 'dh-product-image', src: item.imageUrl, alt: item.name, loading: 'lazy' } }),
      );
    }
    children.push(el('span', { attrs: { class: 'dh-product-name' }, text: item.name }));
    if (item.price !== undefined) {
      const price = item.currency !== undefined ? `${item.currency} ${item.price}` : String(item.price);
      children.push(el('span', { attrs: { class: 'dh-product-price' }, text: price }));
    }
    return el('div', { attrs: { class: 'dh-product-item' }, children });
  });
  return el('div', { attrs: { class: 'dh-flow-card dh-products-card' }, children: rows });
}

function renderOrder(card: OrderCard): HTMLElement {
  const children = [
    el('div', { attrs: { class: 'dh-order-number' }, text: `Order ${card.number}` }),
    el('div', { attrs: { class: 'dh-order-status' }, text: card.statusLabel }),
  ];
  if (card.eta !== undefined) children.push(el('div', { attrs: { class: 'dh-order-eta' }, text: `ETA ${card.eta}` }));
  return el('div', { attrs: { class: 'dh-flow-card dh-order-card' }, children });
}

/** Builds the DOM for one card. */
export function renderFlowCard(card: FlowCard): HTMLElement {
  switch (card.kind) {
    case 'discount':
      return renderDiscount(card);
    case 'products':
      return renderProducts(card);
    case 'order':
      return renderOrder(card);
  }
}
