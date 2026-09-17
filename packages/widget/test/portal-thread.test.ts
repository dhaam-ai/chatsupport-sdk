// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatState } from '@dhaam-ccrm/js';
import { createPortalThread } from '../src/ui/portal-thread.js';

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    sessionId: 'sess_1',
    senderId: 'user_1',
    senderType: 'USER',
    type: 'text',
    content: 'hello good morning',
    createdAt: '2026-09-17T07:49:00.000Z',
    ...overrides,
  };
}

function buildState(messages: ChatMessage[]): ChatState {
  return {
    session: {
      id: 'sess_1',
      status: 'OPEN',
      mode: 'HUMAN',
      createdAt: '2026-09-17T07:49:00.000Z',
      closedAt: null,
      handledBy: null,
      unreadCount: 0,
      metadata: {},
    },
    messages,
    connectionState: 'connected',
    activeConversationId: 'sess_1',
    conversations: {},
    pendingQueue: [],
  } as unknown as ChatState;
}

describe('createPortalThread — customer name and avatar resolution', () => {
  it('renders customer name and initial on incoming messages when setCustomerName is configured', () => {
    const thread = createPortalThread({ onSend: vi.fn() });
    thread.setCustomerName('bikash');

    const msg = buildMessage({ content: 'hello good morning' });
    thread.render(buildState([msg]), false);

    const authorEl = thread.node.querySelector('.dh-msg-author');
    expect(authorEl).not.toBeNull();
    expect(authorEl?.textContent).toBe('bikash');

    const avatarEl = thread.node.querySelector('.dh-msg-avatar');
    expect(avatarEl).not.toBeNull();
    expect(avatarEl?.textContent).toBe('B');
  });

  it('renders bot identity for BOT senderType regardless of customer name', () => {
    const thread = createPortalThread({ onSend: vi.fn() });
    thread.setCustomerName('bikash');

    const botMsg = buildMessage({
      id: 'msg_bot',
      senderType: 'BOT',
      content: 'Good morning! How can I assist you today?',
    });
    thread.render(buildState([botMsg]), false);

    const authorEl = thread.node.querySelector('.dh-msg-author');
    expect(authorEl?.textContent).toBe('✦ Dhaam Assistant');

    const avatarEl = thread.node.querySelector('.dh-msg-avatar--bot');
    expect(avatarEl).not.toBeNull();
    expect(avatarEl?.querySelector('svg')).not.toBeNull();
  });

  it('prefers metadata senderName when explicitly attached to the message', () => {
    const thread = createPortalThread({ onSend: vi.fn() });
    thread.setCustomerName('bikash');

    const msg = buildMessage({
      content: 'Special message',
      metadata: { senderName: 'Rohit Sharma' } as any,
    });
    thread.render(buildState([msg]), false);

    const authorEl = thread.node.querySelector('.dh-msg-author');
    expect(authorEl?.textContent).toBe('Rohit Sharma');

    const avatarEl = thread.node.querySelector('.dh-msg-avatar');
    expect(avatarEl?.textContent).toBe('R');
  });

  it('falls back to Customer and initial C when no name is provided', () => {
    const thread = createPortalThread({ onSend: vi.fn() });

    const msg = buildMessage({ content: 'hii' });
    thread.render(buildState([msg]), false);

    const authorEl = thread.node.querySelector('.dh-msg-author');
    expect(authorEl?.textContent).toBe('Customer');

    const avatarEl = thread.node.querySelector('.dh-msg-avatar');
    expect(avatarEl?.textContent).toBe('C');
  });
});
