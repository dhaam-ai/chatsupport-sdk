import { describe, expect, it } from 'vitest';

import { normalizeVisitorContext, visitorContextKey } from './visitor-context.js';

describe('normalizeVisitorContext', () => {
  it('is null for anything that is not an object', () => {
    for (const bad of [undefined, null, 'x', 4, ['a']]) expect(normalizeVisitorContext(bad)).toBeNull();
  });

  it('keeps a valid context whole', () => {
    const ctx = {
      label: 'checkout',
      url: 'https://shop.example/checkout?step=2',
      attributes: { cartValue: 1299, currency: 'INR', vip: true, tier: 'gold' },
      store: { id: '7', outletId: '3f2c' },
    };
    expect(normalizeVisitorContext(ctx)).toEqual(ctx);
  });

  it('is {} when nothing in the object is usable (an empty context clears the stored one)', () => {
    expect(normalizeVisitorContext({})).toEqual({});
    expect(normalizeVisitorContext({ foo: 1, sessionId: 's' })).toEqual({});
  });

  describe('label', () => {
    it('trims and lower-cases, since the server matches labels exactly in lower case', () => {
      expect(normalizeVisitorContext({ label: '  Checkout ' })).toEqual({ label: 'checkout' });
    });
    it('drops a label the server would reject, and keeps the rest', () => {
      expect(normalizeVisitorContext({ label: 'has space', url: '/cart' })).toEqual({ url: '/cart' });
      expect(normalizeVisitorContext({ label: '-leading' })).toEqual({});
      expect(normalizeVisitorContext({ label: 'x'.repeat(65) })).toEqual({});
      expect(normalizeVisitorContext({ label: 42 })).toEqual({});
    });
    it('accepts exactly 64 characters', () => {
      const label = 'a'.repeat(64);
      expect(normalizeVisitorContext({ label })).toEqual({ label });
    });
  });

  describe('url', () => {
    it('accepts http(s) URLs and paths', () => {
      expect(normalizeVisitorContext({ url: 'http://a.co/x' })).toEqual({ url: 'http://a.co/x' });
      expect(normalizeVisitorContext({ url: '/checkout/pay' })).toEqual({ url: '/checkout/pay' });
    });
    it('drops other schemes, relative strings, empty and over-long values', () => {
      for (const url of ['javascript:alert(1)', 'data:text/html,x', 'checkout', '', 'ftp://a.co', `/${'a'.repeat(2048)}`]) {
        expect(normalizeVisitorContext({ url })).toEqual({});
      }
    });
    it('accepts exactly 2048 characters', () => {
      const url = `/${'a'.repeat(2047)}`;
      expect(normalizeVisitorContext({ url })).toEqual({ url });
    });
  });

  describe('attributes', () => {
    it('drops keys with a bad shape, non-scalar values, long strings and non-finite numbers', () => {
      const result = normalizeVisitorContext({
        attributes: {
          ok: 1,
          'has space': 1,
          nested: { a: 1 },
          list: [1],
          nothing: null,
          long: 'x'.repeat(201),
          nan: Number.NaN,
          inf: Number.POSITIVE_INFINITY,
          fine: 'x'.repeat(200),
        },
      });
      expect(result).toEqual({ attributes: { ok: 1, fine: 'x'.repeat(200) } });
    });
    it('keeps at most 20 keys', () => {
      const attributes = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
      const result = normalizeVisitorContext({ attributes });
      expect(Object.keys(result!.attributes!)).toHaveLength(20);
    });
    it('upper-cases a currency code and drops one that is not ISO 4217', () => {
      expect(normalizeVisitorContext({ attributes: { currency: 'inr' } })).toEqual({ attributes: { currency: 'INR' } });
      expect(normalizeVisitorContext({ attributes: { currency: 'rupees', a: 1 } })).toEqual({ attributes: { a: 1 } });
      expect(normalizeVisitorContext({ attributes: { currency: 5 } })).toEqual({});
    });
    it('omits the bag when nothing survives', () => {
      expect(normalizeVisitorContext({ attributes: { 'bad key': 1 } })).toEqual({});
    });
  });

  describe('store', () => {
    it('needs a non-empty id of at most 80 characters, and accepts a numeric id as text', () => {
      expect(normalizeVisitorContext({ store: { id: 7 } })).toEqual({ store: { id: '7' } });
      expect(normalizeVisitorContext({ store: { id: '' } })).toEqual({});
      expect(normalizeVisitorContext({ store: { id: 'x'.repeat(81) } })).toEqual({});
      expect(normalizeVisitorContext({ store: {} })).toEqual({});
      expect(normalizeVisitorContext({ store: 'x' })).toEqual({});
    });
    it('drops only a bad outletId, not the store', () => {
      expect(normalizeVisitorContext({ store: { id: '7', outletId: '' } })).toEqual({ store: { id: '7' } });
    });
  });
});

describe('visitorContextKey', () => {
  it('is the same for the same content in any key order, and different otherwise', () => {
    const a = visitorContextKey({ label: 'x', attributes: { a: 1, b: 2 } });
    const b = visitorContextKey({ attributes: { b: 2, a: 1 }, label: 'x' });
    expect(a).toBe(b);
    expect(visitorContextKey({ label: 'y' })).not.toBe(a);
    expect(visitorContextKey({})).toBe(visitorContextKey({}));
  });
});
