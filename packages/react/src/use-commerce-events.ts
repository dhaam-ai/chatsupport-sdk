// Browser commerce events (publishable key + customer token); self-contained, no ChatProvider or core/rest changes.
// Only these four types: the merchant backend sends no cart events, so browser events do not overlap with it.

import { useMemo } from 'react';

const BASE_PATH = '/chat-services/api/v1';
const MAX_ITEMS = 500;
const MAX_ITEM_NAME_LENGTH = 300;
const MAX_ITEM_SKU_LENGTH = 64;

export interface CommerceCartItem {
  readonly sku?: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

interface EventBase {
  /** Idempotency key. After ANY failure retry with the SAME id; never mint a new one. */
  readonly eventId: string;
  /** ISO-8601 timestamp. */
  readonly occurredAt: string;
}

export interface OrderPlacedFields extends EventBase {
  readonly orderId: string;
  readonly merchant?: string;
  readonly category?: string;
  readonly cartId?: string;
  readonly value?: number;
}

export interface CartUpdatedFields extends EventBase {
  readonly cartId: string;
  /** May be `[]` for an emptied, still-open cart. */
  readonly items: readonly CommerceCartItem[];
}

export interface CartAbandonedFields extends EventBase {
  readonly cartId: string;
}

export interface CartConvertedFields extends EventBase {
  readonly cartId: string;
  readonly orderId?: string;
}

export interface CommerceEventResult {
  readonly eventId: string;
  readonly type: string;
  readonly contactId: string;
  /** `false` when the server replayed an already-accepted `eventId`. */
  readonly applied: boolean;
}

export interface UseCommerceEventsOptions {
  /** Origin only, e.g. `https://chat.example.com`. */
  readonly apiUrl: string;
  /** `dhp_live_…` / `dhp_test_…`. A secret key is refused. */
  readonly publishableKey: string;
  /** The customer's current access token; called per request so a refreshed token is picked up. */
  readonly getToken: () => Promise<string> | string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

export interface UseCommerceEventsResult {
  readonly orderPlaced: (event: OrderPlacedFields) => Promise<CommerceEventResult>;
  readonly cartUpdated: (event: CartUpdatedFields) => Promise<CommerceEventResult>;
  readonly cartAbandoned: (event: CartAbandonedFields) => Promise<CommerceEventResult>;
  readonly cartConverted: (event: CartConvertedFields) => Promise<CommerceEventResult>;
}

/** Thrown locally, before anything is sent. Names fields, never values. */
export class InvalidCommerceEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommerceEventError';
  }
}

/** The server rejected the event, or the response was not the documented shape. */
export class CommerceEventError extends Error {
  readonly code: string;
  readonly status: number;
  /** `404 CART_NOT_FOUND` / `422 INVALID_CART_TRANSITION` / 5xx / 429 are worth retrying with the same `eventId`. */
  readonly retryable: boolean;

  constructor(code: string, status: number, retryable: boolean) {
    super(`commerce event failed: ${code} (HTTP ${status})`);
    this.name = 'CommerceEventError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(message: string): never {
  throw new InvalidCommerceEventError(message);
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') fail(`${field} is required and must be a non-empty string`);
  return value as string;
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} is required and must be a finite number`);
  return value as number;
}

function optStr(body: Record<string, unknown>, field: string): string | undefined {
  return body[field] === undefined ? undefined : str(body[field], field);
}

function item(raw: unknown, index: number): CommerceCartItem {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(`items[${index}] must be an object`);
  const r = raw as Record<string, unknown>;
  const name = str(r['name'], `items[${index}].name`);
  if (name.length > MAX_ITEM_NAME_LENGTH) fail(`items[${index}].name must be at most ${MAX_ITEM_NAME_LENGTH} characters`);
  const quantity = num(r['quantity'], `items[${index}].quantity`);
  const unitPrice = num(r['unitPrice'], `items[${index}].unitPrice`);
  let sku: string | undefined;
  if (r['sku'] !== undefined) {
    if (typeof r['sku'] !== 'string') fail(`items[${index}].sku must be a string`);
    sku = r['sku'] as string;
    if (sku.length > MAX_ITEM_SKU_LENGTH) fail(`items[${index}].sku must be at most ${MAX_ITEM_SKU_LENGTH} characters`);
  }
  return { ...(sku === undefined ? {} : { sku }), name, quantity, unitPrice };
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'order.placed': ['orderId', 'merchant', 'category', 'cartId', 'value'],
  'cart.updated': ['cartId', 'items'],
  'cart.abandoned': ['cartId'],
  'cart.converted': ['cartId', 'orderId'],
};

/** Mirrors the server's strict public schema: unknown keys (incl. customerId/tenantId) are refused. */
function buildBody(type: string, event: object): Record<string, unknown> {
  const body = event as Record<string, unknown>;
  const allowed = new Set<string>(['eventId', 'occurredAt', ...ALLOWED[type]!]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) fail(`unrecognised field(s) for a "${type}" event: ${unknown.join(', ')}`);

  const out: Record<string, unknown> = {
    eventId: str(body['eventId'], 'eventId'),
    type,
    occurredAt: str(body['occurredAt'], 'occurredAt'),
  };
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };

  switch (type) {
    case 'order.placed':
      out['orderId'] = str(body['orderId'], 'orderId');
      set('merchant', optStr(body, 'merchant'));
      set('category', optStr(body, 'category'));
      set('cartId', optStr(body, 'cartId'));
      if (body['value'] !== undefined) out['value'] = num(body['value'], 'value');
      break;
    case 'cart.updated': {
      out['cartId'] = str(body['cartId'], 'cartId');
      const items = body['items'];
      if (!Array.isArray(items)) fail('items is required and must be an array (use [] for an emptied cart)');
      if ((items as unknown[]).length > MAX_ITEMS) fail(`items may contain at most ${MAX_ITEMS} entries`);
      out['items'] = (items as unknown[]).map(item);
      break;
    }
    case 'cart.abandoned':
      out['cartId'] = str(body['cartId'], 'cartId');
      break;
    case 'cart.converted':
      out['cartId'] = str(body['cartId'], 'cartId');
      set('orderId', optStr(body, 'orderId'));
      break;
  }
  return out;
}

function readError(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function createCommerceSender(options: UseCommerceEventsOptions) {
  if (!options.apiUrl) throw new Error('apiUrl is required');
  if (!options.publishableKey) throw new Error('publishableKey is required');
  const apiUrl = options.apiUrl.replace(/\/+$/, '');

  return async (type: string, event: object): Promise<CommerceEventResult> => {
    const body = buildBody(type, event);
    const doFetch = options.fetch ?? globalThis.fetch;
    if (typeof doFetch !== 'function') throw new Error('no fetch implementation available — pass options.fetch');

    const token = await options.getToken();
    const response = await doFetch(`${apiUrl}${BASE_PATH}/contacts/commerce-events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Publishable-Key': options.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const code = readError(parsed) ?? `HTTP_${response.status}`;
      const retryable =
        response.status >= 500 ||
        response.status === 429 ||
        code === 'CART_NOT_FOUND' ||
        code === 'INVALID_CART_TRANSITION';
      throw new CommerceEventError(code, response.status, retryable);
    }

    const data = (parsed as { data?: Record<string, unknown> } | null)?.data;
    if (
      !data ||
      typeof data['eventId'] !== 'string' ||
      typeof data['type'] !== 'string' ||
      typeof data['contactId'] !== 'string' ||
      typeof data['applied'] !== 'boolean'
    ) {
      throw new CommerceEventError('MALFORMED_RESPONSE', response.status, false);
    }
    return {
      eventId: data['eventId'],
      type: data['type'],
      contactId: data['contactId'],
      applied: data['applied'],
    };
  };
}

/** Resolves with the server outcome (`applied: false` is a replay); after ANY rejection retry with the SAME `eventId`. */
export function useCommerceEvents(options: UseCommerceEventsOptions): UseCommerceEventsResult {
  const { apiUrl, publishableKey, getToken, fetch: fetchImpl } = options;
  return useMemo(() => {
    const send = createCommerceSender({
      apiUrl,
      publishableKey,
      getToken,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
    return {
      orderPlaced: (event) => send('order.placed', event),
      cartUpdated: (event) => send('cart.updated', event),
      cartAbandoned: (event) => send('cart.abandoned', event),
      cartConverted: (event) => send('cart.converted', event),
    };
  }, [apiUrl, publishableKey, getToken, fetchImpl]);
}
