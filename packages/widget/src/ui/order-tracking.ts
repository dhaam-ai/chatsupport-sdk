// The order-tracking panel a card's "Track order" action opens.
//
// ── What it is, and what it is not ───────────────────────────────────────
//
// A read-only view of ONE order, drawn from the card the customer tapped:
// its title, store, status chip and rows. Nothing is fetched. The bot already
// looked the order up under the customer's verified identity to build the
// card, so the panel shows exactly what the card showed, laid out as a
// timeline plus the items and the total. It stands in place of the transcript
// in the widget's one surface slot (`openSurface` in widget.ts), like the
// report form, so there is no modal and no second pattern.
//
// ── The timeline is derived from the status WORDS ────────────────────────
//
// The card carries a label ("Out for delivery"), not a code, so the stage is
// read from it. A label this file does not recognise draws no timeline rather
// than a wrong one; the status chip and the rows still say everything the
// card said. A cancelled order draws a one-line note instead of stages that
// would never complete.
//
// All text goes in through `textContent`, so a title or an item name of
// `<img onerror=…>` prints those characters.

import { ICONS, el, icon } from './dom.js';
import type { RichCard } from './message-card.js';

export interface OrderTrackingCallbacks {
  /** The customer closing the panel. */
  readonly onClose: () => void;
}

export interface OrderTrackingView {
  readonly node: HTMLElement;
  focus(): void;
  destroy(): void;
}

const STAGES = ['Order placed', 'Being prepared', 'Out for delivery', 'Delivered'] as const;

/**
 * The index of the stage a status label is at, `'cancelled'`, or `null` when
 * the label is not one this panel knows. Order matters: "Out for delivery"
 * contains "deliver", so it is tested before "delivered".
 */
export function stageOf(label: string): number | 'cancelled' | null {
  const s = label.trim().toLowerCase();
  if (s === '') return null;
  if (/cancel|reject|fail|refund/.test(s)) return 'cancelled';
  if (/out for delivery|dispatch|on the way|shipped|picked up/.test(s)) return 2;
  if (/deliver|complet/.test(s)) return 3;
  if (/prepar|packed|ready|cooking|accepted|confirm|processing/.test(s)) return 1;
  if (/placed|pending|new|received|created/.test(s)) return 0;
  return null;
}

/** "1 × A, 1 × B, and 2 more" → ["1 × A", "1 × B", "and 2 more"]. */
function itemLines(value: string): string[] {
  return value.split(', ').map((part) => part.trim()).filter((part) => part !== '');
}

export function createOrderTracking(card: RichCard, callbacks: OrderTrackingCallbacks): OrderTrackingView {
  const close = el('button', {
    attrs: { class: 'dh-track-close', type: 'button', 'aria-label': 'Close order details' },
    children: [icon(ICONS.close, 16)],
    on: { click: () => callbacks.onClose() },
  });

  const head = el('div', {
    attrs: { class: 'dh-track-head' },
    children: [el('h3', { attrs: { class: 'dh-track-title', id: 'dh-track-heading' }, text: card.title }), close],
  });

  const summary = el('div', { attrs: { class: 'dh-track-summary' } });
  if (card.subtitle !== '') summary.append(el('p', { attrs: { class: 'dh-track-store' }, text: card.subtitle }));
  if (card.badge !== null) {
    summary.append(el('span', { attrs: { class: 'dh-card-badge', 'data-tone': card.badge.tone }, text: card.badge.label }));
  }

  const body = el('div', { attrs: { class: 'dh-track-body' }, children: [summary] });

  const stage = card.badge === null ? null : stageOf(card.badge.label);
  if (stage === 'cancelled') {
    body.append(el('p', { attrs: { class: 'dh-track-note' }, text: 'This order was cancelled.' }));
  } else if (stage !== null) {
    body.append(
      el('ol', {
        attrs: { class: 'dh-track-steps' },
        children: STAGES.map((label, index) => {
          const state = index < stage ? 'done' : index === stage ? 'current' : 'todo';
          // A finished or current stage carries a tick; the words and the state are
          // on the item itself, so colour is never the only cue.
          const dot = el('span', {
            attrs: { class: 'dh-track-dot', 'aria-hidden': 'true' },
            children: state === 'todo' ? [] : [icon(['M5 12l5 5L20 7'], 12)],
          });
          return el('li', {
            attrs: { class: 'dh-track-step', 'data-state': state, ...(state === 'current' ? { 'aria-current': 'step' } : {}) },
            children: [dot, el('span', { attrs: { class: 'dh-track-step-label' }, text: label })],
          });
        }),
      }),
    );
  }

  const items = card.rows.find((row) => row.label === 'Items');
  const total = card.rows.find((row) => row.label === 'Total');
  const others = card.rows.filter((row) => row !== items && row !== total);

  if (others.length > 0) {
    body.append(
      el('dl', {
        attrs: { class: 'dh-card-rows dh-track-info' },
        children: others.map((row) =>
          el('div', { attrs: { class: 'dh-card-row' }, children: [el('dt', { text: row.label }), el('dd', { text: row.value })] }),
        ),
      }),
    );
  }

  if (items !== undefined || total !== undefined) {
    const box = el('div', { attrs: { class: 'dh-track-box' } });
    if (items !== undefined) {
      box.append(el('div', { attrs: { class: 'dh-track-box-head' }, text: 'Items' }));
      for (const line of itemLines(items.value)) box.append(el('div', { attrs: { class: 'dh-track-item' }, text: line }));
    }
    if (total !== undefined) {
      box.append(
        el('div', {
          attrs: { class: 'dh-track-item dh-track-total' },
          children: [el('span', { text: 'Total' }), el('span', { text: total.value })],
        }),
      );
    }
    body.append(box);
  }

  const node = el('div', {
    attrs: { class: 'dh-track', role: 'group', 'aria-labelledby': 'dh-track-heading' },
    children: [head, body],
  });

  return {
    node,
    focus() {
      close.focus({ preventScroll: true });
    },
    destroy() {
      // Nothing document-level to release: every listener is on a node inside `node`.
    },
  };
}
