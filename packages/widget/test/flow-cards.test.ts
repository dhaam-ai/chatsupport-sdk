// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { readFlowCard, renderFlowCard } from '../src/ui/flow-cards.js';

describe('readFlowCard — discount', () => {
  it('reads a well-formed discount', () => {
    expect(readFlowCard({ discount: { code: 'SAVE10', label: '10% off', terms: 'Ends Friday' } })).toEqual({
      kind: 'discount',
      code: 'SAVE10',
      label: '10% off',
      terms: 'Ends Friday',
    });
  });

  it('drops the card entirely when code is missing or blank', () => {
    expect(readFlowCard({ discount: { label: '10% off' } })).toBeNull();
    expect(readFlowCard({ discount: { code: '   ' } })).toBeNull();
  });

  it('keeps the code alone when label/terms are absent', () => {
    expect(readFlowCard({ discount: { code: 'SAVE10' } })).toEqual({
      kind: 'discount',
      code: 'SAVE10',
      label: undefined,
      terms: undefined,
    });
  });
});

describe('readFlowCard — products', () => {
  it('reads up to 3 products, dropping the rest', () => {
    const products = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
      price: 10 + i,
      currency: 'INR',
    }));
    const card = readFlowCard({ products });
    expect(card?.kind).toBe('products');
    expect(card?.kind === 'products' && card.items).toHaveLength(3);
  });

  it('skips an entry missing id or name, keeping the rest', () => {
    const card = readFlowCard({
      products: [{ id: 'p1' }, { id: 'p2', name: 'Good one' }, { name: 'no id' }],
    });
    expect(card).toEqual({ kind: 'products', items: [{ id: 'p2', name: 'Good one', price: undefined, currency: undefined, imageUrl: undefined, url: undefined }] });
  });

  it('is null when nothing in the array is usable', () => {
    expect(readFlowCard({ products: [{ id: 'p1' }, {}] })).toBeNull();
  });

  it('is null when products is not an array', () => {
    expect(readFlowCard({ products: 'nope' })).toBeNull();
  });
});

describe('readFlowCard — order', () => {
  it('reads a well-formed order', () => {
    expect(readFlowCard({ order: { number: 'ORD-1', statusLabel: 'On the way', eta: '10 min' } })).toEqual({
      kind: 'order',
      number: 'ORD-1',
      statusLabel: 'On the way',
      eta: '10 min',
      trackingUrl: undefined,
    });
  });

  it('drops the card entirely when number or statusLabel is missing', () => {
    expect(readFlowCard({ order: { statusLabel: 'On the way' } })).toBeNull();
    expect(readFlowCard({ order: { number: 'ORD-1' } })).toBeNull();
  });
});

describe('readFlowCard — malformed input never throws', () => {
  it('is null for null/undefined/non-object metadata', () => {
    expect(readFlowCard(null)).toBeNull();
    expect(readFlowCard(undefined)).toBeNull();
    expect(readFlowCard('a string')).toBeNull();
  });

  it('is null when metadata has none of the three keys', () => {
    expect(readFlowCard({ flow: { runId: 'r1' } })).toBeNull();
  });
});

describe('renderFlowCard', () => {
  it('renders the discount code as text and a copy button', () => {
    const node = renderFlowCard({ kind: 'discount', code: 'SAVE10', label: '10% off', terms: undefined });
    expect(node.querySelector('.dh-discount-code')?.textContent).toBe('SAVE10');
    expect(node.querySelector('.dh-discount-copy')?.textContent).toBe('Copy code');
  });

  it('copy falls back to selecting the code text when navigator.clipboard is unavailable', () => {
    const node = renderFlowCard({ kind: 'discount', code: 'SAVE10', label: undefined, terms: undefined });
    document.body.appendChild(node);
    const button = node.querySelector<HTMLButtonElement>('.dh-discount-copy')!;
    expect(() => button.click()).not.toThrow();
  });

  it('renders at most the products it was given, name and price as text', () => {
    const node = renderFlowCard({
      kind: 'products',
      items: [{ id: 'p1', name: 'Cap', price: 199, currency: 'INR', imageUrl: undefined, url: undefined }],
    });
    expect(node.querySelectorAll('.dh-product-item')).toHaveLength(1);
    expect(node.querySelector('.dh-product-name')?.textContent).toBe('Cap');
    expect(node.querySelector('.dh-product-price')?.textContent).toBe('INR 199');
  });

  it('renders the order number, status, and eta when present', () => {
    const node = renderFlowCard({ kind: 'order', number: 'ORD-1', statusLabel: 'Out for delivery', eta: '10 min', trackingUrl: undefined });
    expect(node.textContent).toContain('ORD-1');
    expect(node.textContent).toContain('Out for delivery');
    expect(node.textContent).toContain('10 min');
  });

  it('never renders markup — an attacker-supplied name stays text', () => {
    const node = renderFlowCard({
      kind: 'products',
      items: [{ id: 'p1', name: '<img src=x onerror=alert(1)>', price: undefined, currency: undefined, imageUrl: undefined, url: undefined }],
    });
    expect(node.querySelector('img')).toBeNull();
  });
});
