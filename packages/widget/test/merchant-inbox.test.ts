// @vitest-environment jsdom
//
// Merchant inbox (US-25). Covers every acceptance criterion and case the
// story lists that lives in this package:
//   - Customers / Dhaam Support tabs, rows with name, order number, last message,
//     channel and unread count
//   - Open a chat from a row; unanswered chats sorted oldest first
//   - unanswered chats sorted oldest first
//   - status shown as text; unread count read out
//   - escalated chat shown as "Escalated" and read-only
//   - empty inbox explains itself and links to chat hours
//   - no conversation permission → Customers tab not shown
//   - new-message alert: fires for new customer messages only
// Admin behaviour is asserted unchanged at the end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary, ChatState } from '@dhaam-ccrm/js';

import { createMessagesScreen } from '../src/ui/messages-screen.js';
import {
  channelLabel,
  createInboxAlertDetector,
  deriveUnreadCount,
  isUnanswered,
  markConversationSeen,
  orderLabel,
  sortMerchantInbox,
} from '../src/ui/merchant-inbox.js';
import { listPartyConversations } from '../src/portal/portal-staff-client.js';
import { createPortalThread } from '../src/ui/portal-thread.js';

type Extra = Partial<{
  customerName: string;
  orderNumber: string;
  channel: number;
  escalated: boolean;
  awaitingReply: boolean;
  chatType: string;
  targetRole: string;
}>;

function row(overrides: Partial<ChatSessionSummary> & Extra = {}): ChatSessionSummary {
  return {
    id: 's1',
    status: 'OPEN',
    mode: 'HUMAN',
    createdAt: '2026-10-26T09:00:00.000Z',
    closedAt: null,
    lastMessageAt: '2026-10-26T09:30:00.000Z',
    lastMessagePreview: 'Can you add extra cheese to my burger?',
    unreadCount: 0,
    customerName: 'Rahul Sharma',
    chatType: 'merchant',
    targetRole: 'merchant',
    ...overrides,
  } as unknown as ChatSessionSummary;
}

function adminRow(overrides: Partial<ChatSessionSummary> & Extra = {}): ChatSessionSummary {
  return row({ id: 'adm1', chatType: 'admin', targetRole: 'admin', customerName: 'Dhaam Support', ...overrides });
}

function merchantScreen(extra: Record<string, unknown> = {}) {
  const onOpenConversation = vi.fn();
  const screen = createMessagesScreen({ onOpenConversation, userRole: 'merchant', ...extra });
  document.body.appendChild(screen.node);
  return { screen, onOpenConversation };
}

const tabs = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLButtonElement>('.dh-mtab'));
const visibleRows = (node: HTMLElement) =>
  Array.from(node.querySelectorAll<HTMLLIElement>('.dh-mrow-item')).filter((li) => !li.hidden);
const visibleNames = (node: HTMLElement) =>
  visibleRows(node).map((li) => li.querySelector('.dh-mrow-name')?.textContent);
const emptyState = (node: HTMLElement) => node.querySelector<HTMLLIElement>('.dh-messages-empty')!;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Pure rules ──────────────────────────────────────────────────────────────

describe('merchant inbox rules', () => {
  it('sorts unanswered chats first, oldest first, then the rest newest first', () => {
    const sorted = sortMerchantInbox([
      row({ id: 'answered-old', awaitingReply: false, lastMessageAt: '2026-10-26T08:00:00Z' }),
      row({ id: 'waiting-new', awaitingReply: true, lastMessageAt: '2026-10-26T10:00:00Z' }),
      row({ id: 'answered-new', awaitingReply: false, lastMessageAt: '2026-10-26T11:00:00Z' }),
      row({ id: 'waiting-old', awaitingReply: true, lastMessageAt: '2026-10-26T07:00:00Z' }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['waiting-old', 'waiting-new', 'answered-new', 'answered-old']);
  });

  it('does not mutate its input', () => {
    const input = [row({ id: 'a', awaitingReply: false }), row({ id: 'b', awaitingReply: true })];
    sortMerchantInbox(input);
    expect(input.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('never counts a resolved or escalated chat as unanswered', () => {
    expect(isUnanswered(row({ awaitingReply: true, status: 'RESOLVED' }))).toBe(false);
    expect(isUnanswered(row({ awaitingReply: true, escalated: true }))).toBe(false);
    expect(isUnanswered(row({ unreadCount: 2 }))).toBe(true); // no sender signal → unread fallback
  });

  it('labels channels and orders', () => {
    expect(channelLabel(row({ channel: 1 }))).toBe('App');
    expect(channelLabel(row({ channel: 2 }))).toBe('WhatsApp');
    expect(channelLabel(row())).toBeNull();
    expect(orderLabel(row({ orderNumber: '20345' }))).toBe('#20345');
    expect(orderLabel(row({ orderNumber: '#20345' }))).toBe('#20345');
    expect(orderLabel(row())).toBeNull();
  });

  it('derives unread from "customer spoke last after I last opened it"; a server count wins', () => {
    expect(deriveUnreadCount('s1', 4, false, undefined)).toBe(4);
    expect(deriveUnreadCount('s1', undefined, false, '2026-10-26T10:00:00Z')).toBe(0);
    expect(deriveUnreadCount('s1', undefined, true, '2026-10-26T10:00:00Z')).toBe(1);
    markConversationSeen('s1', '2026-10-26T10:00:00Z');
    expect(deriveUnreadCount('s1', undefined, true, '2026-10-26T10:00:00Z')).toBe(0);
    expect(deriveUnreadCount('s1', undefined, true, '2026-10-26T10:05:00Z')).toBe(1);
  });
});

describe('new-message alert detection', () => {
  const base = {
    sessionId: 's1',
    customerName: 'Rahul',
    preview: 'Hi',
    orderNumber: '20345',
    customerSpokeLast: true,
  };

  it('stays quiet on the first load, so a full inbox does not ring once per old chat', () => {
    const detector = createInboxAlertDetector();
    expect(detector.detect([{ ...base, lastMessageAt: '2026-10-26T10:00:00Z' }])).toEqual([]);
  });

  it('alerts once for a newer customer message, and not again for the same one', () => {
    const detector = createInboxAlertDetector();
    detector.detect([{ ...base, lastMessageAt: '2026-10-26T10:00:00Z' }]);
    const alerts = detector.detect([{ ...base, lastMessageAt: '2026-10-26T10:01:00Z' }]);
    expect(alerts).toEqual([{ sessionId: 's1', customerName: 'Rahul', preview: 'Hi', orderNumber: '20345' }]);
    expect(detector.detect([{ ...base, lastMessageAt: '2026-10-26T10:01:00Z' }])).toEqual([]);
  });

  it('alerts for a brand-new chat that appears after the first load', () => {
    const detector = createInboxAlertDetector();
    detector.detect([]);
    expect(detector.detect([{ ...base, sessionId: 'new', lastMessageAt: '2026-10-26T10:00:00Z' }])).toHaveLength(1);
  });

  it('does not alert when the merchant sent the latest message', () => {
    const detector = createInboxAlertDetector();
    detector.detect([{ ...base, lastMessageAt: '2026-10-26T10:00:00Z' }]);
    expect(
      detector.detect([{ ...base, customerSpokeLast: false, lastMessageAt: '2026-10-26T10:02:00Z' }]),
    ).toEqual([]);
  });
});

// ── Screen ──────────────────────────────────────────────────────────────────

describe('merchant inbox screen — tabs and rows', () => {
  it('shows Customers and Dhaam Support tabs with Customers active by default', () => {
    const { screen } = merchantScreen();
    const [customers, admin] = tabs(screen.node);
    expect(customers?.textContent).toContain('Customers');
    expect(admin?.textContent).toContain('Dhaam Support');
    expect(customers?.getAttribute('aria-selected')).toBe('true');
  });

  it('renders customer name, order number, last message, channel, status text and unread count', () => {
    const { screen } = merchantScreen();
    screen.render([row({ orderNumber: '20345', channel: 1, unreadCount: 2 })], null);

    const li = visibleRows(screen.node)[0]!;
    expect(li.querySelector('.dh-mrow-name')?.textContent).toBe('Rahul Sharma');
    expect(li.querySelector('.dh-mrow-order')?.textContent).toBe('#20345');
    expect(li.querySelector('.dh-mrow-preview')?.textContent).toBe('Can you add extra cheese to my burger?');
    expect(li.querySelector('.dh-mrow-channel')?.textContent).toBe('App');
    expect(li.querySelector('.dh-mrow-status-pill')?.textContent).toBe('Open');
    expect(li.querySelector('.dh-mrow-unread-badge')?.textContent).toBe('2');
  });

  it('reads the status and unread count out in the row label', () => {
    const { screen } = merchantScreen();
    screen.render([row({ orderNumber: '20345', channel: 2, unreadCount: 2 })], null);
    const label = screen.node.querySelector('.dh-mrow-btn')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Rahul Sharma');
    expect(label).toContain('order #20345');
    expect(label).toContain('Open');
    expect(label).toContain('via WhatsApp');
    expect(label).toContain('2 unread messages');
  });

  it('hides the order chip and channel when the row has none', () => {
    const { screen } = merchantScreen();
    screen.render([row()], null);
    expect(screen.node.querySelector<HTMLElement>('.dh-mrow-order')?.hidden).toBe(true);
    expect(screen.node.querySelector<HTMLElement>('.dh-mrow-channel')?.hidden).toBe(true);
  });

  it('badges each tab with its UNREAD conversation count, read out as text, hidden at zero', () => {
    const { screen } = merchantScreen();
    screen.render(
      [
        row({ id: 'c1', unreadCount: 2 }),
        row({ id: 'c2', unreadCount: 1 }),
        row({ id: 'c3', unreadCount: 0 }),
        adminRow({ unreadCount: 0 }),
      ],
      null,
    );
    const [customersBadge, adminBadge] = Array.from(screen.node.querySelectorAll<HTMLElement>('.dh-mtab-count'));
    expect(customersBadge?.textContent).toBe('2');
    expect(customersBadge?.getAttribute('aria-label')).toBe('2 unread');
    expect(customersBadge?.hidden).toBe(false);
    expect(adminBadge?.hidden).toBe(true);
  });

  it('opens a chat when a row is clicked', () => {
    const { screen, onOpenConversation } = merchantScreen();
    screen.render([row({ id: 'chat-1' })], null);
    screen.node.querySelector<HTMLButtonElement>('.dh-mrow-btn')?.click();
    expect(onOpenConversation).toHaveBeenCalledWith('chat-1', 'Rahul Sharma', expect.any(String));
  });

  it('switches to the Dhaam Support tab and shows only support chats there', () => {
    const { screen } = merchantScreen();
    screen.render([row({ id: 'c1' }), adminRow()], null);
    tabs(screen.node)[1]!.click();
    expect(visibleRows(screen.node)).toHaveLength(1);
  });
});

describe('merchant inbox screen — sorting and search', () => {
  it('lists unanswered chats oldest first, above answered ones', () => {
    const { screen } = merchantScreen();
    screen.render(
      [
        row({ id: 'a', customerName: 'Answered', awaitingReply: false, lastMessageAt: '2026-10-26T12:00:00Z' }),
        row({ id: 'n', customerName: 'Newer wait', awaitingReply: true, lastMessageAt: '2026-10-26T11:00:00Z' }),
        row({ id: 'o', customerName: 'Older wait', awaitingReply: true, lastMessageAt: '2026-10-26T08:00:00Z' }),
      ],
      null,
    );
    expect(visibleNames(screen.node)).toEqual(['Older wait', 'Newer wait', 'Answered']);
  });

  it('shows a no-results state for a search that matches nothing', () => {
    const { screen } = merchantScreen();
    screen.render([row()], null);
    const input = screen.node.querySelector<HTMLInputElement>('.dh-messages-search-input')!;
    input.value = 'pizza hut';
    input.dispatchEvent(new Event('input'));
    expect(emptyState(screen.node).hidden).toBe(false);
    expect(emptyState(screen.node).textContent).toContain('No results for "pizza hut"');
  });
});

describe('merchant inbox screen — cases', () => {
  it('shows a chat passed to Dhaam as "Escalated" and read-only', () => {
    const { screen } = merchantScreen();
    screen.render([row({ escalated: true, status: 'ASSIGNED' })], null);
    const li = visibleRows(screen.node)[0]!;
    expect(li.getAttribute('data-escalated')).toBe('true');
    expect(li.querySelector('.dh-mrow-status-pill')?.textContent).toBe('Escalated');
    expect(li.querySelector('.dh-mrow-btn')?.getAttribute('aria-label')).toContain('Escalated, read-only');
  });

  it('explains an empty inbox and links to chat hours', () => {
    const onOpenChatHours = vi.fn();
    const { screen } = merchantScreen({ onOpenChatHours });
    screen.render([], null);

    const empty = emptyState(screen.node);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('No conversations yet');
    expect(empty.textContent).toContain('chat hours');

    const link = empty.querySelector<HTMLButtonElement>('.dh-minbox-hours-link')!;
    expect(link.hidden).toBe(false);
    link.click();
    expect(onOpenChatHours).toHaveBeenCalledTimes(1);
  });

  it('omits the chat-hours link when the host has not wired it', () => {
    const { screen } = merchantScreen();
    screen.render([], null);
    expect(screen.node.querySelector('.dh-minbox-hours-link')).toBeNull();
  });

  it('shows the Dhaam support empty state on an empty Admin tab, without the hours link', () => {
    const { screen } = merchantScreen({ onOpenChatHours: vi.fn() });
    screen.render([], null);
    tabs(screen.node)[1]!.click();
    expect(emptyState(screen.node).textContent).toContain('No messages yet');
    expect(screen.node.querySelector<HTMLElement>('.dh-minbox-hours-link')?.hidden).toBe(true);
  });

  it('does not show the Customers tab without conversation permission', () => {
    const { screen } = merchantScreen({ canViewCustomerConversations: false });
    screen.render([row({ id: 'c1' }), adminRow()], null);
    const [customers, admin] = tabs(screen.node);
    expect(customers?.hidden).toBe(true);
    expect(admin?.getAttribute('aria-selected')).toBe('true');
    expect(visibleNames(screen.node)).toEqual(['Dhaam Support']);
  });
});

describe('admin view is unchanged', () => {
  it('keeps total-count badges and the plain empty text', () => {
    const screen = createMessagesScreen({ onOpenConversation: vi.fn(), userRole: 'admin' });
    document.body.appendChild(screen.node);
    screen.render([], null);
    expect(emptyState(screen.node).textContent).toBe('No customer conversations yet.');
    expect(screen.node.querySelector('.dh-mtab-count')?.textContent).toBe('0');
  });

  it('keeps the original admin row DOM — no order chip, channel or meta line at all', () => {
    const screen = createMessagesScreen({ onOpenConversation: vi.fn(), userRole: 'admin' });
    document.body.appendChild(screen.node);
    screen.render([row({ orderNumber: '20345', channel: 1, unreadCount: 3, awaitingReply: true })], null);
    expect(screen.node.querySelector('.dh-mrow-order')).toBeNull();
    expect(screen.node.querySelector('.dh-mrow-channel')).toBeNull();
    expect(screen.node.querySelector('.dh-mrow-meta')).toBeNull();
    const bodyChildren = Array.from(screen.node.querySelector('.dh-mrow-body')!.children).map((c) => c.className);
    expect(bodyChildren).toEqual(['dh-mrow-top', 'dh-mrow-preview', 'dh-mrow-time']);
    // Admin badges still show the TOTAL count, not unread.
    expect(screen.node.querySelector('.dh-mtab-count')?.textContent).toBe('1');
  });

  it('keeps admin row order exactly as given (no oldest-unanswered sort)', () => {
    const screen = createMessagesScreen({ onOpenConversation: vi.fn(), userRole: 'admin' });
    document.body.appendChild(screen.node);
    screen.render(
      [
        row({ id: 'a', customerName: 'First', awaitingReply: false, lastMessageAt: '2026-10-26T12:00:00Z' }),
        row({ id: 'b', customerName: 'Second', awaitingReply: true, lastMessageAt: '2026-10-26T08:00:00Z' }),
      ],
      null,
    );
    expect(visibleNames(screen.node)).toEqual(['First', 'Second']);
  });
});

// ── Wire + thread ───────────────────────────────────────────────────────────

describe('/party/conversations — merchant inbox fields', () => {
  it('reads last message, sender, channel, order number and escalation off the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            conversations: [
              {
                sessionId: 'sess_1',
                customerId: 'cust_1',
                customerName: 'Rahul Sharma',
                status: 1,
                targetId: 'outlet_1',
                targetRole: 'merchant',
                channel: 2,
                conversationType: 2,
                createdAt: '2026-10-26T09:00:00.000Z',
                updatedAt: '2026-10-26T09:30:00.000Z',
                metadata: { orderId: 20345 },
                escalatedAt: '2026-10-26T09:31:00.000Z',
                lastMessage: {
                  content: 'Can you add extra cheese?',
                  senderType: 1,
                  messageType: 1,
                  createdAt: '2026-10-26T09:30:00.000Z',
                },
              },
            ],
          },
        }),
      } as Response),
    );

    const [parsed] = await listPartyConversations({
      apiUrl: 'https://chat.example.com',
      wsUrl: 'wss://chat.example.com',
      getToken: async () => 't',
      senderId: 'outlet_1',
    });

    expect(parsed).toMatchObject({
      lastMessageContent: 'Can you add extra cheese?',
      lastMessageAt: '2026-10-26T09:30:00.000Z',
      lastMessageFromCustomer: true,
      channel: 2,
      orderNumber: '20345',
      escalated: true,
      unreadCount: null,
    });
    // The shared `lastMessage` the admin view reads is untouched.
    expect(parsed?.lastMessage).toBeNull();
  });
});

describe('portal thread — read-only for an escalated chat', () => {
  function state(): ChatState {
    return {
      session: { id: 's1', status: 'OPEN', mode: 'HUMAN', createdAt: '', closedAt: null, handledBy: null, unreadCount: 0, metadata: {} },
      messages: [],
      connectionState: 'connected',
      activeConversationId: 's1',
      conversations: {},
      pendingQueue: [],
    } as unknown as ChatState;
  }

  it('hides the reply box and shows the note; clearing it restores the composer', () => {
    const thread = createPortalThread({ onSend: vi.fn() });
    document.body.appendChild(thread.node);
    thread.render(state(), false);

    thread.setReadOnly('This chat was passed to Dhaam support. You can read it but not reply.');
    const note = thread.node.querySelector<HTMLElement>('.dh-portal-readonly')!;
    const composer = thread.node.querySelector<HTMLElement>('.dh-composer')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('passed to Dhaam support');
    expect(composer.hidden).toBe(true);

    // A later render (e.g. new messages arriving) must not re-enable sending.
    thread.render(state(), false);
    expect(thread.node.querySelector<HTMLButtonElement>('.dh-send')?.disabled).toBe(true);

    thread.setReadOnly(null);
    expect(note.hidden).toBe(true);
    expect(composer.hidden).toBe(false);
  });
});
