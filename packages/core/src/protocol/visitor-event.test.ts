import { describe, expect, it } from 'vitest';
import { normalizeVisitorEvent } from './visitor-event.js';

describe('normalizeVisitorEvent — the 4 built events', () => {
  it('search: keeps query and results when both are present and valid', () => {
    expect(normalizeVisitorEvent('search', { query: 'blue shoes', results: 0 })).toEqual({
      name: 'search',
      props: { query: 'blue shoes', results: 0 },
    });
  });

  it('search: drops the whole event when results is missing (server-required)', () => {
    expect(normalizeVisitorEvent('search', { query: 'blue shoes' })).toBeNull();
  });

  it('search: drops the whole event when query is blank', () => {
    expect(normalizeVisitorEvent('search', { query: '  ', results: 3 })).toBeNull();
  });

  it('cart_updated: keeps items, drops an invalid value, currency is upper-cased', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: 2, value: 999, currency: 'inr' })).toEqual({
      name: 'cart_updated',
      props: { items: 2, value: 999, currency: 'INR' },
    });
  });

  it('cart_updated: drops the whole event when items is missing (server-required)', () => {
    expect(normalizeVisitorEvent('cart_updated', { value: 100 })).toBeNull();
  });

  it('cart_updated: drops a negative items count', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: -5, value: 'free' })).toBeNull();
  });

  it('cart_updated: drops an unrecognised currency without failing the whole event', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: 1, currency: 'not-a-currency' })).toEqual({
      name: 'cart_updated',
      props: { items: 1 },
    });
  });

  it('exit_intent: has no props at all, and none are required', () => {
    expect(normalizeVisitorEvent('exit_intent', {})).toEqual({ name: 'exit_intent', props: {} });
    expect(normalizeVisitorEvent('exit_intent', undefined)).toEqual({ name: 'exit_intent', props: {} });
  });

  it('product_viewed: keeps productId and inStock', () => {
    expect(normalizeVisitorEvent('product_viewed', { productId: 'prod_1', inStock: true })).toEqual({
      name: 'product_viewed',
      props: { productId: 'prod_1', inStock: true },
    });
  });

  it('product_viewed: drops the whole event when productId is missing (server-required)', () => {
    expect(normalizeVisitorEvent('product_viewed', { inStock: true })).toBeNull();
  });
});

describe('normalizeVisitorEvent — not built yet (YAGNI) and malformed input', () => {
  it('rejects checkout_error and custom — valid on the wire, not built now', () => {
    expect(normalizeVisitorEvent('checkout_error', {})).toBeNull();
    expect(normalizeVisitorEvent('custom', { event: 'anything' })).toBeNull();
  });

  it('rejects an unrecognised name outright', () => {
    expect(normalizeVisitorEvent('made_up_event', {})).toBeNull();
  });

  it('rejects a non-string name', () => {
    expect(normalizeVisitorEvent(42, {})).toBeNull();
    expect(normalizeVisitorEvent(null, {})).toBeNull();
  });

  it('rejects props that is not an object', () => {
    expect(normalizeVisitorEvent('exit_intent', 'nope')).toBeNull();
    expect(normalizeVisitorEvent('exit_intent', ['a'])).toBeNull();
  });

  it('never throws on any input', () => {
    expect(() => normalizeVisitorEvent(undefined, undefined)).not.toThrow();
    expect(() => normalizeVisitorEvent({}, {})).not.toThrow();
  });
});
