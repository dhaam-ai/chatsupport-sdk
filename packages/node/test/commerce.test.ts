import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/http.js';
import { ChatApiError, ChatTransportError, isRetryableContactsError } from '../src/errors.js';
import {
  InvalidCommerceEventError,
  buildCommerceEventBody,
  recordCommerceEvent,
} from '../src/commerce.js';
import type {
  CartAbandonedEvent,
  CartConvertedEvent,
  CartUpdatedEvent,
  OrderCancelledEvent,
  OrderCompletedEvent,
  OrderPlacedEvent,
} from '../src/types.js';
import { SECRET_KEY_LIVE } from './fixtures.js';
import { stubFetch, unreachableFetch } from './stub-fetch.js';

const API_URL = 'https://chat.example.com';
const OCCURRED_AT = '2026-08-21T10:00:00.000Z';

function http(fetch: typeof globalThis.fetch): HttpClient {
  // Constructed directly rather than through `ChatServerClient` — the
  // client wiring for `recordCommerceEvent()` is T26's job, and this module
  // is testable on its own against the same seam `pagination.ts`'s functions
  // are: an `HttpClient` carrying the secret key as a bearer header.
  return new HttpClient({
    apiUrl: API_URL,
    authHeaders: () => ({ Authorization: `Bearer ${SECRET_KEY_LIVE}` }),
    fetch,
  });
}

const ORDER_PLACED: OrderPlacedEvent = {
  eventId: 'evt_order_placed',
  type: 'order.placed',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  orderId: 'ord_1',
};

const ORDER_COMPLETED: OrderCompletedEvent = {
  eventId: 'evt_order_completed',
  type: 'order.completed',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  orderId: 'ord_1',
  value: 84.5,
};

const ORDER_CANCELLED: OrderCancelledEvent = {
  eventId: 'evt_order_cancelled',
  type: 'order.cancelled',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  orderId: 'ord_1',
};

const CART_UPDATED: CartUpdatedEvent = {
  eventId: 'evt_cart_updated',
  type: 'cart.updated',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  cartId: 'cart_1',
  items: [{ name: 'Trail runner, size 10', quantity: 1, unitPrice: 129 }],
};

const CART_ABANDONED: CartAbandonedEvent = {
  eventId: 'evt_cart_abandoned',
  type: 'cart.abandoned',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  cartId: 'cart_1',
};

const CART_CONVERTED: CartConvertedEvent = {
  eventId: 'evt_cart_converted',
  type: 'cart.converted',
  occurredAt: OCCURRED_AT,
  customerId: 'cust_1',
  cartId: 'cart_1',
};

// ── buildCommerceEventBody — happy path ───────────────────────────────────

describe('buildCommerceEventBody — one variant per event type', () => {
  it('order.placed: required fields only', () => {
    expect(buildCommerceEventBody(ORDER_PLACED)).toEqual({
      eventId: 'evt_order_placed',
      type: 'order.placed',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      orderId: 'ord_1',
    });
  });

  it('order.placed: every optional field supplied', () => {
    const event: OrderPlacedEvent = {
      ...ORDER_PLACED,
      merchant: 'Acme Outfitters',
      category: 'apparel',
      cartId: 'cart_9',
      value: 84.5,
    };
    expect(buildCommerceEventBody(event)).toEqual({
      eventId: 'evt_order_placed',
      type: 'order.placed',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      orderId: 'ord_1',
      merchant: 'Acme Outfitters',
      category: 'apparel',
      cartId: 'cart_9',
      value: 84.5,
    });
  });

  it('order.completed', () => {
    expect(buildCommerceEventBody(ORDER_COMPLETED)).toEqual({
      eventId: 'evt_order_completed',
      type: 'order.completed',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      orderId: 'ord_1',
      value: 84.5,
    });
  });

  it('order.cancelled', () => {
    expect(buildCommerceEventBody(ORDER_CANCELLED)).toEqual({
      eventId: 'evt_order_cancelled',
      type: 'order.cancelled',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      orderId: 'ord_1',
    });
  });

  it('cart.updated, with a line item', () => {
    expect(buildCommerceEventBody(CART_UPDATED)).toEqual({
      eventId: 'evt_cart_updated',
      type: 'cart.updated',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      cartId: 'cart_1',
      items: [{ name: 'Trail runner, size 10', quantity: 1, unitPrice: 129 }],
    });
  });

  it('cart.updated with an empty items array — a valid, emptied-but-still-open cart', () => {
    const event: CartUpdatedEvent = { ...CART_UPDATED, items: [] };
    expect(buildCommerceEventBody(event)).toEqual(
      expect.objectContaining({ items: [] }),
    );
  });

  it('cart.abandoned', () => {
    expect(buildCommerceEventBody(CART_ABANDONED)).toEqual({
      eventId: 'evt_cart_abandoned',
      type: 'cart.abandoned',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      cartId: 'cart_1',
    });
  });

  it('cart.converted, with the optional orderId', () => {
    const event: CartConvertedEvent = { ...CART_CONVERTED, orderId: 'ord_5' };
    expect(buildCommerceEventBody(event)).toEqual({
      eventId: 'evt_cart_converted',
      type: 'cart.converted',
      occurredAt: OCCURRED_AT,
      customerId: 'cust_1',
      cartId: 'cart_1',
      orderId: 'ord_5',
    });
  });

  it('a line item sku is included when supplied', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ sku: 'SKU-1', name: 'Trail runner', quantity: 1, unitPrice: 129 }],
    };
    const body = buildCommerceEventBody(event);
    expect(body['items']).toEqual([{ sku: 'SKU-1', name: 'Trail runner', quantity: 1, unitPrice: 129 }]);
  });

  it('omits an absent sku rather than sending an explicit undefined/null', () => {
    const body = buildCommerceEventBody(CART_UPDATED);
    const items = body['items'] as Array<Record<string, unknown>>;
    expect('sku' in items[0]!).toBe(false);
  });

  it('is pure — repeated calls on the identical event produce an identical body, never a minted id', () => {
    // The eventId is caller-supplied and this function never touches it —
    // a retry with the SAME event object must produce the SAME wire body,
    // every time. If this function ever started minting or mutating an id,
    // the release-on-reject retry contract would silently break.
    expect(buildCommerceEventBody(CART_ABANDONED)).toEqual(buildCommerceEventBody(CART_ABANDONED));
  });
});

// ── buildCommerceEventBody — strictness (unknown-key rejection) ──────────

describe('buildCommerceEventBody — rejects unknown fields locally', () => {
  it('rejects a typo field on the base shape', () => {
    const event = { ...ORDER_CANCELLED, custommerId: 'oops' } as unknown as OrderCancelledEvent;
    expect(() => buildCommerceEventBody(event)).toThrow(InvalidCommerceEventError);
    expect(() => buildCommerceEventBody(event)).toThrow(/custommerId/);
  });

  it('rejects a field that is valid on a DIFFERENT variant', () => {
    // `value` belongs to order.placed/order.completed, not cart.abandoned —
    // the server's per-variant `.strict()` schema would reject this the
    // same way, and it should fail here with the same specificity.
    const event = { ...CART_ABANDONED, value: 10 } as unknown as CartAbandonedEvent;
    expect(() => buildCommerceEventBody(event)).toThrow(/value/);
  });

  it('names every offending key, not just the first', () => {
    const event = { ...CART_ABANDONED, foo: 1, bar: 2 } as unknown as CartAbandonedEvent;
    try {
      buildCommerceEventBody(event);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toMatch(/foo/);
      expect((error as Error).message).toMatch(/bar/);
    }
  });

  it('does NOT reject an unknown key on a line item — CommerceCartItem is not .strict() server-side', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ name: 'x', quantity: 1, unitPrice: 1, extra: 'allowed' } as never],
    };
    expect(() => buildCommerceEventBody(event)).not.toThrow();
  });
});

// ── buildCommerceEventBody — required fields and types ────────────────────

describe('buildCommerceEventBody — required fields', () => {
  it('rejects an unrecognised type', () => {
    const event = { ...ORDER_CANCELLED, type: 'order.shipped' } as unknown as OrderCancelledEvent;
    expect(() => buildCommerceEventBody(event)).toThrow(/type must be one of/);
  });

  it('rejects a missing eventId', () => {
    const event = { ...ORDER_CANCELLED, eventId: '' };
    expect(() => buildCommerceEventBody(event)).toThrow(/eventId/);
  });

  it('rejects a missing customerId', () => {
    const { customerId: _drop, ...rest } = ORDER_CANCELLED;
    expect(() => buildCommerceEventBody(rest as unknown as OrderCancelledEvent)).toThrow(/customerId/);
  });

  it('rejects order.completed missing its required value', () => {
    const { value: _drop, ...rest } = ORDER_COMPLETED;
    expect(() => buildCommerceEventBody(rest as unknown as OrderCompletedEvent)).toThrow(/value/);
  });

  it('rejects order.completed with a non-numeric value', () => {
    const event = { ...ORDER_COMPLETED, value: '84.5' } as unknown as OrderCompletedEvent;
    expect(() => buildCommerceEventBody(event)).toThrow(/value/);
  });

  it('rejects cart.updated missing items entirely', () => {
    const { items: _drop, ...rest } = CART_UPDATED;
    expect(() => buildCommerceEventBody(rest as unknown as CartUpdatedEvent)).toThrow(/items/);
  });

  it('rejects a line item missing a required field', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ name: 'x', unitPrice: 1 } as never],
    };
    expect(() => buildCommerceEventBody(event)).toThrow(/items\[0\]\.quantity/);
  });

  it('names the offending line item by index in a multi-item cart', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [
        { name: 'ok', quantity: 1, unitPrice: 1 },
        { name: '', quantity: 1, unitPrice: 1 },
      ],
    };
    expect(() => buildCommerceEventBody(event)).toThrow(/items\[1\]\.name/);
  });
});

// ── buildCommerceEventBody — the three published caps ──────────────────────

describe('buildCommerceEventBody — contractual caps', () => {
  it('accepts exactly 500 items', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      name: `item ${i}`,
      quantity: 1,
      unitPrice: 1,
    }));
    const event: CartUpdatedEvent = { ...CART_UPDATED, items };
    expect(() => buildCommerceEventBody(event)).not.toThrow();
  });

  it('rejects 501 items — refused outright, not truncated', () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      name: `item ${i}`,
      quantity: 1,
      unitPrice: 1,
    }));
    const event: CartUpdatedEvent = { ...CART_UPDATED, items };
    expect(() => buildCommerceEventBody(event)).toThrow(/at most 500/);
    // Not silently clamped: the thrown error is the entire effect. Prove no
    // truncated body escapes by checking the function only ever throws or
    // returns, never partially mutates a body a caller could still read.
  });

  it('accepts a 300-character item name', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ name: 'x'.repeat(300), quantity: 1, unitPrice: 1 }],
    };
    expect(() => buildCommerceEventBody(event)).not.toThrow();
  });

  it('rejects a 301-character item name', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ name: 'x'.repeat(301), quantity: 1, unitPrice: 1 }],
    };
    expect(() => buildCommerceEventBody(event)).toThrow(/items\[0\]\.name.*at most 300/);
  });

  it('accepts a 64-character sku', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ sku: 'x'.repeat(64), name: 'x', quantity: 1, unitPrice: 1 }],
    };
    expect(() => buildCommerceEventBody(event)).not.toThrow();
  });

  it('rejects a 65-character sku', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ sku: 'x'.repeat(65), name: 'x', quantity: 1, unitPrice: 1 }],
    };
    expect(() => buildCommerceEventBody(event)).toThrow(/items\[0\]\.sku.*at most 64/);
  });

  it('accepts an empty-string sku — the schema has no minLength for it', () => {
    const event: CartUpdatedEvent = {
      ...CART_UPDATED,
      items: [{ sku: '', name: 'x', quantity: 1, unitPrice: 1 }],
    };
    expect(() => buildCommerceEventBody(event)).not.toThrow();
  });
});

// ── recordCommerceEvent — the sender ───────────────────────────────────────

const RESULT_BODY = {
  success: true,
  data: { eventId: 'evt_cart_abandoned', type: 'cart.abandoned', contactId: 'contact_1', applied: true },
};

describe('recordCommerceEvent', () => {
  it('POSTs to the documented path with the built body', async () => {
    const stub = stubFetch([{ status: 200, body: RESULT_BODY }]);
    await recordCommerceEvent(http(stub.fetch), CART_ABANDONED);

    const request = stub.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${API_URL}/chat-services/api/v1/contacts/commerce-events`);
    expect(JSON.parse(request.body as string)).toEqual(buildCommerceEventBody(CART_ABANDONED));
  });

  it('sends the secret key as a bearer token', async () => {
    const stub = stubFetch([{ status: 200, body: RESULT_BODY }]);
    await recordCommerceEvent(http(stub.fetch), CART_ABANDONED);
    expect(stub.lastRequest().headers['authorization']).toBe(`Bearer ${SECRET_KEY_LIVE}`);
  });

  it('unwraps the { success, data } envelope into a CommerceEventResult', async () => {
    const stub = stubFetch([{ status: 200, body: RESULT_BODY }]);
    const result = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED);
    expect(result).toEqual({
      eventId: 'evt_cart_abandoned',
      type: 'cart.abandoned',
      contactId: 'contact_1',
      applied: true,
    });
  });

  it('returns applied: false as-is on a replay — no local dedup logic of its own', async () => {
    const stub = stubFetch([
      { status: 200, body: { success: true, data: { ...RESULT_BODY.data, applied: false } } },
    ]);
    const result = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED);
    expect(result.applied).toBe(false);
  });

  it('never sends a request when local validation fails', async () => {
    const stub = stubFetch([]);
    const invalid = { ...CART_ABANDONED, cartId: '' };
    await expect(recordCommerceEvent(http(stub.fetch), invalid)).rejects.toThrow(
      InvalidCommerceEventError,
    );
    expect(stub.requests).toHaveLength(0);
  });

  it('raises ChatTransportError when the request never reached the server', async () => {
    await expect(
      recordCommerceEvent(http(unreachableFetch()), CART_ABANDONED),
    ).rejects.toThrow(ChatTransportError);
  });

  describe('malformed success responses', () => {
    it('rejects a 200 without a { success, data } envelope', async () => {
      const stub = stubFetch([{ status: 200, body: { ok: true } }]);
      await expect(recordCommerceEvent(http(stub.fetch), CART_ABANDONED)).rejects.toThrow(ChatApiError);
    });

    it('rejects a result missing applied', async () => {
      const { applied: _drop, ...rest } = RESULT_BODY.data;
      const stub = stubFetch([{ status: 200, body: { success: true, data: rest } }]);
      await expect(recordCommerceEvent(http(stub.fetch), CART_ABANDONED)).rejects.toThrow(/applied/);
    });

    it('rejects a result with an unrecognised type', async () => {
      const stub = stubFetch([
        { status: 200, body: { success: true, data: { ...RESULT_BODY.data, type: 'order.shipped' } } },
      ]);
      await expect(recordCommerceEvent(http(stub.fetch), CART_ABANDONED)).rejects.toThrow(ChatApiError);
    });
  });

  describe('server rejections — the release-on-reject codes', () => {
    it('surfaces 404 CART_NOT_FOUND as a ChatApiError callers can identify as retryable', async () => {
      const stub = stubFetch([
        { status: 404, body: { success: false, error: { code: 'CART_NOT_FOUND', message: 'No cart found' } } },
      ]);
      try {
        await recordCommerceEvent(http(stub.fetch), CART_ABANDONED);
        expect.unreachable('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ChatApiError);
        expect((error as ChatApiError).code).toBe('CART_NOT_FOUND');
        expect((error as ChatApiError).status).toBe(404);
        expect(isRetryableContactsError(error)).toBe(true);
      }
    });

    it('surfaces 422 INVALID_CART_TRANSITION as retryable-with-the-same-eventId', async () => {
      const stub = stubFetch([
        {
          status: 422,
          body: {
            success: false,
            error: { code: 'INVALID_CART_TRANSITION', message: 'This cart is CONVERTED' },
          },
        },
      ]);
      const error = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ChatApiError);
      expect((error as ChatApiError).code).toBe('INVALID_CART_TRANSITION');
      expect(isRetryableContactsError(error)).toBe(true);
    });

    it('surfaces 400 VALIDATION_ERROR as fatal, not retryable', async () => {
      const stub = stubFetch([
        { status: 400, body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad' } } },
      ]);
      const error = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED).catch((e: unknown) => e);
      expect(isRetryableContactsError(error)).toBe(false);
    });

    it('surfaces 401 AUTH_INVALID as fatal', async () => {
      const stub = stubFetch([
        { status: 401, body: { success: false, error: { code: 'AUTH_INVALID', message: 'bad key' } } },
      ]);
      const error = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED).catch((e: unknown) => e);
      expect(isRetryableContactsError(error)).toBe(false);
    });

    it(
      "does not trust the generic ChatApiError.retryable flag for this route — " +
        'the server never sends one, so the generic HTTP layer coerces its absence to false ' +
        'even on a 500; isRetryableContactsError is what actually answers the question',
      async () => {
        const stub = stubFetch([
          { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } } },
        ]);
        const error = await recordCommerceEvent(http(stub.fetch), CART_ABANDONED).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ChatApiError);
        // The generic layer's own flag: misleadingly false.
        expect((error as ChatApiError).retryable).toBe(false);
        // The domain-aware classifier: correctly true.
        expect(isRetryableContactsError(error)).toBe(true);
      },
    );
  });
});

// ── isRetryableContactsError ───────────────────────────────────────────────

describe('isRetryableContactsError', () => {
  function apiError(code: string, status: number): ChatApiError {
    return new ChatApiError({ code, message: 'x', status, retryable: false });
  }

  it.each([
    ['CART_NOT_FOUND', 404],
    ['INVALID_CART_TRANSITION', 422],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
  ] as const)('%s is retryable with the same eventId', (code, status) => {
    expect(isRetryableContactsError(apiError(code, status))).toBe(true);
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['AUTH_INVALID', 401],
    ['CONTACT_NOT_FOUND', 404],
  ] as const)('%s is fatal — needs a caller-side fix first', (code, status) => {
    expect(isRetryableContactsError(apiError(code, status))).toBe(false);
  });

  it('treats an unrecognised future code as fatal, not retryable, by default', () => {
    expect(isRetryableContactsError(apiError('SOME_FUTURE_CODE', 418))).toBe(false);
  });

  it('is always true for ChatTransportError — nothing was applied', () => {
    expect(isRetryableContactsError(new ChatTransportError(new Error('ECONNREFUSED')))).toBe(true);
  });

  it('is false for a local InvalidCommerceEventError', () => {
    expect(isRetryableContactsError(new InvalidCommerceEventError('bad input'))).toBe(false);
  });

  it('is false for an arbitrary thrown value', () => {
    expect(isRetryableContactsError(new Error('unrelated'))).toBe(false);
    expect(isRetryableContactsError('a string')).toBe(false);
    expect(isRetryableContactsError(undefined)).toBe(false);
  });
});
