// The page `pnpm preview:cards` builds: bot messages carrying
// `metadata.richCards`, drawn by the real transcript renderer
// (ui/message-list.ts) with the real stylesheet and theme tokens, in a shadow
// root shaped like the open widget panel. No chat-service, no network.
//
// Query string: `?theme=dark`, `?accent=%23be123c`, `?view=track` (opens the order-tracking panel).

import { createInitialChatState } from '@dhaam-ccrm/core';
import type { ChatMessage } from '@dhaam-ccrm/core';

import { resolveConfig } from '../src/config.js';
import { createMessageList } from '../src/ui/message-list.js';
import { createOrderTracking } from '../src/ui/order-tracking.js';
import { STYLES, themeCss } from '../src/ui/styles.js';

const params = new URLSearchParams(location.search);
const config = resolveConfig({
  apiUrl: 'https://chat.example.invalid',
  wsUrl: 'wss://chat.example.invalid',
  identity: { userId: 'preview' },
  auth: { publishableKey: 'pk_preview', tokenEndpoint: '/token' },
  accent: params.get('accent') ?? '#0f766e',
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
});

const host = document.createElement('div');
host.setAttribute('data-screen', 'conversation');
host.setAttribute('data-theme', config.theme);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
// The last rule is the preview's own frame: the panel in normal flow at the
// bubble presentation's 384px, tall enough to show the whole transcript,
// instead of fixed to a corner of the viewport.
style.textContent = `${STYLES}\n${themeCss(config)}\n.dh-panel { position: relative; margin: 16px; width: 384px; }`;
const panel = document.createElement('div');
panel.className = 'dh-panel';
panel.setAttribute('data-open', 'true');
shadow.append(style, panel);
document.body.append(host);

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 2, 9, minute)).toISOString();
const customer = (id: string, content: string, minute: number): ChatMessage => ({
  id, sessionId: 's', senderId: 'preview', senderType: 'CUSTOMER', type: 'TEXT', content, createdAt: at(minute), seq: minute,
});
const bot = (id: string, content: string, minute: number, metadata: Record<string, unknown>): ChatMessage => ({
  id, sessionId: 's', senderId: 'bot', senderType: 'BOT', type: 'TEXT', content, createdAt: at(minute), metadata,
});

const messages: ChatMessage[] = [
  customer('c1', 'Where is my order DH-10482?', 1),
  // `content` is the full text version (what an older widget shows and what a
  // screen reader hears); `richIntro` is what this widget's bubble shows
  // above the cards (contract §2 rule 1, the duplicate-text rule).
  bot('b1', 'Here are the details for order 10482.\nOrder #10482 (Rasoi): Out for delivery\nTotal: ₹549.00', 2, {
    richIntro: 'Here are the details for order 10482.',
    richCards: [{
      v: 1,
      kind: 'order',
      title: 'Order #10482',
      subtitle: 'Rasoi',
      badge: { label: 'Out for delivery', tone: 'warning' },
      rows: [
        { label: 'Placed', value: '2 Oct, 3:45 pm' },
        { label: 'ETA', value: '4:30 pm' },
        { label: 'Items', value: 'Paneer Tikka ×2, Garlic Naan ×1 and 2 more' },
        { label: 'Payment', value: 'Paid' },
        { label: 'Total', value: '₹549.00' },
      ],
      // The in-widget action: tap it and the page swaps to the order-tracking panel.
      buttons: [{ label: 'Track order', action: 'track_order', ref: '10482' }],
    }],
  }),
  customer('c2', 'Do you have paneer tikka?', 3),
  bot('b2', 'Here is what I found.\nPaneer Tikka, ₹249.00\nPaneer Butter Masala, ₹449.00 (out of stock)', 4, {
    richIntro: 'Here is what I found.',
    richCards: [
      { v: 1, kind: 'product', title: 'Paneer Tikka', subtitle: '₹249.00', imageUrl: 'https://cdn.example.invalid/paneer.jpg', buttons: [{ label: 'View', url: 'https://shop.example.com/i/1' }] },
      { v: 1, kind: 'product', title: 'Paneer Butter Masala (Family Pack, serves four)', subtitle: '₹449.00', imageUrl: 'https://cdn.example.invalid/pbm.jpg', badge: { label: 'Out of stock', tone: 'danger' }, buttons: [{ label: 'View', url: 'https://shop.example.com/i/2' }] },
    ],
  }),
  bot('b3', 'Your refund details. <img src=x onerror=alert(1)> stays text.', 5, {
    richCards: [{
      v: 1,
      kind: 'info',
      title: '<img src=x onerror=alert(1)>',
      subtitle: 'Markup in any field prints as text',
      badge: { label: 'Approved', tone: 'success' },
      rows: [{ label: 'Reference', value: 'RF-2291' }],
      buttons: [
        { label: 'Details', url: 'https://shop.example.com/r' },
        { label: 'Help', url: 'https://help.example.com/' },
        { label: 'Dropped', url: 'javascript:alert(1)' },
      ],
      footer: 'Refunds take 5–7 working days',
    }],
    options: ['Track another order', 'Talk about something else'],
  }),
];

// Four products, laid out as the console's "Show the cards" says: `?layout=vertical` (a list) or
// `?layout=horizontal` (side by side, the default). There is no Swipe/List switch to press.
const layout = params.get('layout');
messages.push(
  bot('b4', 'Here is what I found.', 6, {
    richIntro: 'Here is what I found.',
    ...(layout === 'vertical' || layout === 'horizontal' ? { richLayout: layout } : {}),
    richCards: ['Cheese Burst Pizza', 'Pizza Special', 'Pizza Delight', 'Paneer Pizza'].map((title, i) => ({
      v: 1, kind: 'product', title, subtitle: `₹${(380 + i * 120).toFixed(2)}`,
    })),
  }),
);

const list = createMessageList({
  onRetry: () => undefined,
  onLoadOlder: () => undefined,
  onStartNewConversation: () => undefined,
  onEmailTranscript: async () => undefined,
  onQuickReply: (text) => console.log('quick reply:', text),
  onReplyToMessage: () => undefined,
  // Tapping "Track order" swaps the transcript for the panel; its X swaps back, as in the widget.
  onCardAction: (card) => {
    const tracking = createOrderTracking(card, { onClose: () => panel.replaceChildren(list.log) });
    panel.replaceChildren(tracking.node);
    tracking.focus();
  },
});
panel.append(list.log);
const initial = createInitialChatState();
list.render({ ...initial, messages, pagination: { ...initial.pagination, initialLoaded: true } }, 'preview');

// The example hosts above do not resolve, so the widget hides those image
// tiles (its broken-image path). To show what a LOADED tile looks like, this
// preview page — not the widget — swaps one in from a local SVG after render.
const tile = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#f59e0b"/><circle cx="44" cy="44" r="22" fill="#fde68a"/></svg>',
);
for (const img of panel.querySelectorAll<HTMLImageElement>('.dh-card-img')) {
  img.hidden = false;
  img.src = tile;
}

// `?view=track`: open the tracking panel at once, as if "Track order" had been tapped.
if (params.get('view') === 'track') {
  panel.querySelector<HTMLButtonElement>('button.dh-card-btn')?.click();
}
