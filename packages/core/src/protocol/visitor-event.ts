// `client.sendVisitorEvent(name, props)`'s business-rule check
// (chatbot-workflows-commerce.md §4) — is this one of the events this SDK
// sends today, and are its props the server will actually keep?
//
// Mirrors chat-service-node's own `EVENT_PROPS`/`boundEvent`
// (application/flows/facts.ts:155-203) so this client never sends what the
// server would silently drop — same "don't waste a frame" reasoning as
// `context.update`'s coalescing, and the same normalize-on-the-way-out
// pattern as `visitor-context.ts`.
//
// `checkout_error` and `custom` are valid VisitorEventNames on the wire
// (frames.ts's VISITOR_EVENT_NAMES has 6 entries) but no flow template reads
// them yet, so they are deliberately NOT built here (YAGNI) — treated exactly
// like any other unrecognised name until a caller needs them.

import type { VisitorEventName, VisitorEventPayload } from './frames.js';

type PropKind = 'text' | 'count' | 'amount' | 'flag' | 'currency' | 'id';
interface PropRule {
  readonly key: string;
  readonly kind: PropKind;
  readonly max?: number;
  readonly required?: boolean;
}

const MAX_STRING = 200;
const MAX_ID = 80;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** The 4 events this SDK sends today, and the props each may carry. */
const EVENT_PROPS: Record<string, readonly PropRule[]> = {
  search: [
    { key: 'query', kind: 'text', max: MAX_STRING, required: true },
    { key: 'results', kind: 'count', required: true },
  ],
  cart_updated: [
    { key: 'items', kind: 'count', required: true },
    { key: 'value', kind: 'amount' },
    { key: 'currency', kind: 'currency' },
  ],
  exit_intent: [],
  product_viewed: [
    { key: 'productId', kind: 'id', required: true },
    { key: 'inStock', kind: 'flag' },
    { key: 'price', kind: 'amount' },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propValue(rule: PropRule, v: unknown): string | number | boolean | undefined {
  switch (rule.kind) {
    case 'text':
      return typeof v === 'string' && v.trim() !== '' ? v.slice(0, rule.max ?? MAX_STRING) : undefined;
    case 'count':
      return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined;
    case 'amount':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
    case 'flag':
      return typeof v === 'boolean' ? v : undefined;
    case 'currency': {
      const upper = typeof v === 'string' ? v.trim().toUpperCase() : '';
      return CURRENCY_RE.test(upper) ? upper : undefined;
    }
    case 'id':
      return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID ? v : undefined;
  }
}

/**
 * `client.sendVisitorEvent(name, props)`'s validation: `null` for anything
 * this SDK does not send today (an unrecognised name, or a recognised one
 * missing a required prop) — the same "drop the whole event" rule the
 * server's own `boundEvent` applies, so a call that would be silently
 * discarded server-side is never sent at all.
 */
export function normalizeVisitorEvent(name: unknown, props: unknown): VisitorEventPayload | null {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_PROPS, name)) return null;
  const input = props === undefined || props === null ? {} : props;
  if (!isPlainObject(input)) return null;

  const kept: [string, string | number | boolean][] = [];
  for (const rule of EVENT_PROPS[name]!) {
    const value = propValue(rule, input[rule.key]);
    if (value !== undefined) kept.push([rule.key, value]);
    else if (rule.required) return null;
  }

  return { name: name as VisitorEventName, props: Object.fromEntries(kept) };
}
