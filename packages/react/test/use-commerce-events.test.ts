// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommerceEventError,
  InvalidCommerceEventError,
  useCommerceEvents,
  type UseCommerceEventsResult,
} from '../src/use-commerce-events.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

const at = '2026-10-14T10:00:00.000Z';

function setup(response: { status: number; body: unknown }) {
  const fetchMock = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(response.body), { status: response.status }),
  );
  let api: UseCommerceEventsResult | undefined;
  function Probe() {
    api = useCommerceEvents({
      apiUrl: 'https://chat.test/',
      publishableKey: 'dhp_live_abc',
      getToken: () => 'tok-1',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return null;
  }
  render(h(Probe));
  return { api: api!, fetchMock };
}

const ok = { status: 200, body: { success: true, data: { eventId: 'e1', type: 'cart.abandoned', contactId: 'c1', applied: true } } };

describe('useCommerceEvents', () => {
  it('posts with the publishable key and customer token to the commerce route', async () => {
    const { api, fetchMock } = setup(ok);
    const result = await api.cartAbandoned({ eventId: 'e1', occurredAt: at, cartId: 'k1' });

    expect(result).toEqual({ eventId: 'e1', type: 'cart.abandoned', contactId: 'c1', applied: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://chat.test/chat-services/api/v1/contacts/commerce-events');
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer tok-1', 'X-Publishable-Key': 'dhp_live_abc' });
    expect(JSON.parse(init!.body as string)).toEqual({ eventId: 'e1', type: 'cart.abandoned', occurredAt: at, cartId: 'k1' });
  });

  it('sets the type per method', async () => {
    const { api, fetchMock } = setup(ok);
    await api.cartUpdated({ eventId: 'e1', occurredAt: at, cartId: 'k1', items: [] });
    await api.cartConverted({ eventId: 'e2', occurredAt: at, cartId: 'k1', orderId: 'o1' });
    await api.orderPlaced({ eventId: 'e3', occurredAt: at, orderId: 'o1' });
    const types = fetchMock.mock.calls.map((c) => JSON.parse(c[1]!.body as string).type);
    expect(types).toEqual(['cart.updated', 'cart.converted', 'order.placed']);
  });

  it('refuses customerId locally and sends nothing', async () => {
    const { api, fetchMock } = setup(ok);
    await expect(
      api.cartAbandoned({ eventId: 'e1', occurredAt: at, cartId: 'k1', customerId: 'x' } as never),
    ).rejects.toBeInstanceOf(InvalidCommerceEventError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the 500 item cap', async () => {
    const { api } = setup(ok);
    const items = Array.from({ length: 501 }, () => ({ name: 'a', quantity: 1, unitPrice: 1 }));
    await expect(api.cartUpdated({ eventId: 'e1', occurredAt: at, cartId: 'k1', items })).rejects.toThrow(/at most 500/);
  });

  it('maps a server rejection to a retryable CommerceEventError', async () => {
    const { api } = setup({ status: 404, body: { success: false, error: { code: 'CART_NOT_FOUND', message: 'x' } } });
    const error = await api.cartAbandoned({ eventId: 'e1', occurredAt: at, cartId: 'k1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommerceEventError);
    expect(error).toMatchObject({ code: 'CART_NOT_FOUND', status: 404, retryable: true });
  });

  it('treats a 401 as not retryable', async () => {
    const { api } = setup({ status: 401, body: { error: { code: 'AUTH_INVALID', message: 'x' } } });
    const error = await api.cartAbandoned({ eventId: 'e1', occurredAt: at, cartId: 'k1' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'AUTH_INVALID', retryable: false });
  });
});
