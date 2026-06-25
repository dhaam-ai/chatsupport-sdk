// 'menu'       → quick-reply menu below messages
// 'faq'        → FAQ list panel
// 'escalating' → connecting-to-agent screen
// 'free'       → normal free-text chat
export type FlowStep = 'menu' | 'faq' | 'escalating' | 'free';

export interface QuickReply {
  id: string;
  label: string;
  icon: string;
}

export interface ReplyTarget {
  id: string;
  content: string;
  senderType: string;
  senderName?: string;
}
