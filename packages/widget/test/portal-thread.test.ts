// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatState } from '@dhaam-ccrm/js';
import { createPortalThread } from '../src/ui/portal-thread.js';

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    sessionId: 'sess_1',
    senderId: 'user_1',
    senderType: 'CUSTOMER',
    type: 'TEXT',
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

describe('createPortalThread — reply', () => {
  it('shows the quoted message in the composer chip when the reply icon is clicked', () => {
    const thread = createPortalThread({ onSend: vi.fn(async () => undefined) });
    thread.setCustomerName('bikash');

    const msg = buildMessage({ content: 'where is my order' });
    thread.render(buildState([msg]), false);

    thread.node.querySelector<HTMLButtonElement>('.dh-msg-reply')!.click();

    const chip = thread.node.querySelector<HTMLElement>('.dh-reply-chip')!;
    expect(chip.hidden).toBe(false);
    expect(chip.querySelector('.dh-reply-name')?.textContent).toBe('bikash');
    expect(chip.querySelector('.dh-reply-excerpt')?.textContent).toBe('where is my order');
  });

  it('names the reply "You" when the agent replies to their own message', () => {
    const thread = createPortalThread({ onSend: vi.fn(async () => undefined) });
    const msg = buildMessage({ id: 'm_agent', senderType: 'AGENT', content: 'On its way!' });
    thread.render(buildState([msg]), false);

    thread.node.querySelector<HTMLButtonElement>('.dh-msg-reply')!.click();

    expect(thread.node.querySelector('.dh-reply-name')?.textContent).toBe('You');
  });

  it('sends replyToMessageId and reply metadata built from the clicked message', async () => {
    const onSend = vi.fn(async () => undefined);
    const thread = createPortalThread({ onSend });
    thread.setCustomerName('bikash');

    const msg = buildMessage({ id: 'm_target', content: 'where is my order' });
    thread.render(buildState([msg]), false);
    thread.node.querySelector<HTMLButtonElement>('.dh-msg-reply')!.click();

    const input = thread.node.querySelector<HTMLTextAreaElement>('.dh-input')!;
    input.value = 'Refunded, sorry about that!';
    input.dispatchEvent(new Event('input'));
    thread.node.querySelector<HTMLButtonElement>('.dh-send')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toBe('Refunded, sorry about that!');
    expect(onSend.mock.calls[0]![1]).toEqual({
      replyToMessageId: 'm_target',
      metadata: {
        kind: 'reply',
        replyTo: { messageId: 'm_target', excerpt: 'where is my order', senderName: 'bikash' },
      },
    });
  });

  it('cancelling the reply hides the chip and sends with no reply options', async () => {
    const onSend = vi.fn(async () => undefined);
    const thread = createPortalThread({ onSend });

    const msg = buildMessage({ content: 'hello' });
    thread.render(buildState([msg]), false);
    thread.node.querySelector<HTMLButtonElement>('.dh-msg-reply')!.click();
    thread.node.querySelector<HTMLButtonElement>('.dh-reply-clear')!.click();

    expect(thread.node.querySelector<HTMLElement>('.dh-reply-chip')!.hidden).toBe(true);

    const input = thread.node.querySelector<HTMLTextAreaElement>('.dh-input')!;
    input.value = 'a plain message';
    input.dispatchEvent(new Event('input'));
    thread.node.querySelector<HTMLButtonElement>('.dh-send')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSend.mock.calls[0]).toEqual(['a plain message', undefined]);
  });

  it('renders the quoted strip inside a bubble carrying reply metadata', () => {
    const thread = createPortalThread({ onSend: vi.fn() });
    const msg = buildMessage({
      content: 'Refunded, sorry about that!',
      metadata: {
        kind: 'reply',
        replyTo: { messageId: 'm_target', excerpt: 'where is my order', senderName: 'bikash' },
      } as any,
    });
    thread.render(buildState([msg]), false);

    const quote = thread.node.querySelector<HTMLElement>('.dh-msg-quote')!;
    expect(quote.hidden).toBe(false);
    expect(quote.querySelector('.dh-quote-name')?.textContent).toBe('bikash');
    expect(quote.querySelector('.dh-quote-text')?.textContent).toBe('where is my order');
  });
});

describe('createPortalThread — partner chat (admin/manager <-> merchant/outlet)', () => {
  /**
   * The reported bug: a partner conversation has NO CUSTOMER-typed
   * participant (both sides send as senderType AGENT — wire contract
   * "Partner chats"), so `state.session.customer` is `null` (see
   * `packages/core/src/client/session.ts`'s `findParticipant(...,
   * 'CUSTOMER')`). `isOutgoing`'s old `senderType === 'AGENT'` check could
   * not tell the two sides apart and rendered EVERY message as "mine" —
   * both the admin's own messages AND the outlet's replies landed with
   * `data-mine="true"`, all on the same side of the transcript.
   */
  function buildPartnerState(messages: ChatMessage[]): ChatState {
    return {
      session: {
        id: 'sess_partner',
        status: 'OPEN',
        mode: 'HUMAN',
        createdAt: '2026-09-19T04:00:00.000Z',
        closedAt: null,
        handledBy: null,
        customer: null, // <- the partner-conversation signal
        targetRole: 'merchant',
        targetId: 'outlet_14660',
      },
      messages,
      connectionState: 'connected',
      activeConversationId: 'sess_partner',
      conversations: {},
      pendingQueue: [],
    } as unknown as ChatState;
  }

  it('tells admin from outlet by senderId, not by senderType, once localParticipantId is known', () => {
    const admin = buildMessage({
      id: 'm_admin',
      senderId: '12775',
      senderType: 'AGENT',
      content: 'hello outlet',
    });
    const outlet = buildMessage({
      id: 'm_outlet',
      senderId: '14660',
      senderType: 'AGENT',
      content: 'helo admin',
    });

    // Mounted as the admin (identity.userId "12775").
    const thread = createPortalThread({ onSend: vi.fn() }, '12775');
    thread.render(buildPartnerState([admin, outlet]), false);

    const rows = thread.node.querySelectorAll<HTMLElement>('.dh-msg');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('data-mine')).toBe('true'); // admin's own message
    expect(rows[1]!.getAttribute('data-mine')).toBe('false'); // the outlet's reply
  });

  it('flips sides on the outlet’s own mount of the exact same conversation', () => {
    const admin = buildMessage({ id: 'm_admin', senderId: '12775', senderType: 'AGENT', content: 'hello outlet' });
    const outlet = buildMessage({ id: 'm_outlet', senderId: '14660', senderType: 'AGENT', content: 'helo admin' });

    // Mounted as the outlet (identity.userId "14660").
    const thread = createPortalThread({ onSend: vi.fn() }, '14660');
    thread.render(buildPartnerState([admin, outlet]), false);

    const rows = thread.node.querySelectorAll<HTMLElement>('.dh-msg');
    expect(rows[0]!.getAttribute('data-mine')).toBe('false'); // admin's message, not mine
    expect(rows[1]!.getAttribute('data-mine')).toBe('true'); // my own reply
  });

  it('leaves the ordinary shared-inbox support conversation alone: any AGENT reply is still "our side"', () => {
    // Same shape as buildState() above — session.customer is set, so this is
    // NOT a partner conversation, and the old any-AGENT-is-outgoing rule
    // must still apply even for a coworker's reply that isn't literally me.
    const coworkerReply = buildMessage({ id: 'm2', senderId: 'agent_someone_else', senderType: 'AGENT', content: 'on it' });
    const thread = createPortalThread({ onSend: vi.fn() }, 'agent_me');
    thread.render(buildState([coworkerReply]), false);

    expect(thread.node.querySelector<HTMLElement>('.dh-msg')?.getAttribute('data-mine')).toBe('true');
  });
});
