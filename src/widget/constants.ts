import type { QuickReply } from './types';

export const MAIN_MENU: QuickReply[] = [
  { id: 'order_details', icon: '📦', label: 'Check Order Details' },
  { id: 'track_order',   icon: '🚚', label: 'Track My Order' },
  { id: 'faq',           icon: '❓', label: 'FAQs & Help' },
  { id: 'human',         icon: '👤', label: 'Talk to a Human Agent' },
];

export const FAQ_ITEMS: QuickReply[] = [
  { id: 'faq_return',   icon: '🔄', label: 'How do I return an item?' },
  { id: 'faq_refund',   icon: '💰', label: 'When will I get my refund?' },
  { id: 'faq_address',  icon: '📍', label: 'How do I change my delivery address?' },
  { id: 'faq_cancel',   icon: '❌', label: 'How do I cancel my order?' },
  { id: 'faq_track',    icon: '🚚', label: 'How do I track my order?' },
  { id: 'faq_payment',  icon: '💳', label: 'What payment methods are accepted?' },
  { id: 'faq_contact',  icon: '📞', label: 'How do I contact support?' },
];

export const defaultTheme = {
  primaryColor:        '#5b4fcf',
  headerBackground:    '#5b4fcf',
  headerText:          '#ffffff',
  customerBubbleColor: '#5b4fcf',
  agentBubbleColor:    '#f0effe',
  fontFamily:          '"Outfit", "DM Sans", system-ui, sans-serif',
  borderRadius:        '16px',
  position:            'bottom-right' as 'bottom-right' | 'bottom-left',
};

export type FullTheme = typeof defaultTheme;
