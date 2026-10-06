// @vitest-environment jsdom
//
// The panel a card's "Track order" action opens (ui/order-tracking.ts): a timeline derived from the
// status words, plus the card's own rows. Nothing is fetched, so the card IS the data.

import { describe, expect, it, vi } from 'vitest';

import { createOrderTracking, stageOf } from '../src/ui/order-tracking.js';
import type { RichCard } from '../src/ui/message-card.js';

const card = (overrides: Partial<RichCard> = {}): RichCard => ({
  kind: 'order',
  title: 'Order #3742',
  subtitle: 'Food Hub',
  imageUrl: null,
  badge: { label: 'Out for delivery', tone: 'warning' },
  rows: [
    { label: 'Placed', value: '28 Sept 2026, 09:14 UTC' },
    { label: 'Items', value: '1 × jucy chicken, 1 × Pizza Delight' },
    { label: 'Total', value: '₹1,092.70' },
  ],
  buttons: [],
  footer: '',
  ...overrides,
});

const build = (c: RichCard = card()) => {
  const onClose = vi.fn();
  const view = createOrderTracking(c, { onClose });
  return {
    view,
    onClose,
    q: (s: string) => view.node.querySelector<HTMLElement>(s),
    all: (s: string) => [...view.node.querySelectorAll<HTMLElement>(s)],
  };
};

describe('stageOf', () => {
  it.each([
    ['Order placed', 0],
    ['Pending', 0],
    ['Being prepared', 1],
    ['Preparing', 1],
    ['Ready', 1],
    ['Out for delivery', 2],
    ['Dispatched', 2],
    ['Delivered', 3],
    ['Completed', 3],
  ])('%s is stage %s', (label, stage) => expect(stageOf(label)).toBe(stage));

  it.each(['Cancelled', 'Failed', 'Rejected'])('%s is cancelled', (label) => expect(stageOf(label)).toBe('cancelled'));
  it.each(['', '   ', 'On hold', 'Shrug'])('%j has no stage', (label) => expect(stageOf(label)).toBeNull());
});

describe('createOrderTracking', () => {
  it('heads the panel with the order, the store and the status chip', () => {
    const { q } = build();
    expect(q('.dh-track-title')?.textContent).toBe('Order #3742');
    expect(q('.dh-track-store')?.textContent).toBe('Food Hub');
    expect(q('.dh-card-badge')?.textContent).toBe('Out for delivery');
  });

  it('draws four stages, done before the current one and still to come after it', () => {
    const { all } = build();
    expect(all('.dh-track-step').map((n) => n.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'todo']);
    expect(all('.dh-track-step-label').map((n) => n.textContent)).toEqual([
      'Order placed',
      'Being prepared',
      'Out for delivery',
      'Delivered',
    ]);
    expect(all('.dh-track-step[aria-current="step"]')).toHaveLength(1);
  });

  it('a delivered order has the last stage as its current one', () => {
    const { all } = build(card({ badge: { label: 'Delivered', tone: 'success' } }));
    expect(all('.dh-track-step').map((n) => n.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'current']);
  });

  it('a cancelled order draws a note, not stages that would never finish', () => {
    const { q, all } = build(card({ badge: { label: 'Cancelled', tone: 'danger' } }));
    expect(all('.dh-track-step')).toHaveLength(0);
    expect(q('.dh-track-note')?.textContent).toBe('This order was cancelled.');
  });

  it('an unrecognised status draws no timeline but keeps the chip and the rows', () => {
    const { q, all } = build(card({ badge: { label: 'On hold', tone: 'neutral' } }));
    expect(all('.dh-track-step')).toHaveLength(0);
    expect(q('.dh-card-badge')?.textContent).toBe('On hold');
    expect(q('.dh-track-info')?.textContent).toContain('28 Sept 2026');
  });

  it('lists the items one per line and shows the total last', () => {
    const { all } = build();
    const lines = all('.dh-track-item').map((n) => n.textContent);
    expect(lines).toEqual(['1 × jucy chicken', '1 × Pizza Delight', 'Total₹1,092.70']);
  });

  it('prints card text as text, so markup in a title or item is not parsed', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { view } = build(card({ title: evil, subtitle: evil, rows: [{ label: 'Items', value: evil }] }));
    expect(view.node.querySelector('img')).toBeNull();
    expect(view.node.textContent).toContain(evil);
  });

  it('closes through the X, which is a labelled button and takes focus', () => {
    const { view, q, onClose } = build();
    const close = q('.dh-track-close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('Close order details');
    document.body.append(view.node);
    view.focus();
    expect(document.activeElement).toBe(close);
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
    view.destroy();
  });

  it('a card with no rows and no badge is still a panel with a heading and a close', () => {
    const { q, all } = build(card({ badge: null, rows: [], subtitle: '' }));
    expect(q('.dh-track-title')?.textContent).toBe('Order #3742');
    expect(all('.dh-track-step')).toHaveLength(0);
    expect(q('.dh-track-box')).toBeNull();
  });
});
