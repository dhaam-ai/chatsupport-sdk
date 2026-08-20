// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RetryOutcome } from '@dhaam-ccrm/core';

import { ChatProvider } from '../src/context.js';
import { useChatError } from '../src/use-chat-error.js';
import { useMessages } from '../src/use-messages.js';
import { useTypingIndicator } from '../src/use-typing-indicator.js';
import { useUnreadCount } from '../src/use-unread-count.js';
import { createFakeChatClient, makeChatError } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

describe('useMessages', () => {
  it('exposes messages/pagination/uploading and delegates its actions to the client', () => {
    const client = createFakeChatClient({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });

    function View() {
      const { messages, pagination, sendMessage, loadOlderMessages } = useMessages();
      return h(
        'div',
        null,
        h('div', { 'data-testid': 'count' }, messages.length),
        h('div', { 'data-testid': 'hasMore' }, String(pagination.hasMore)),
        h('button', { onClick: () => void sendMessage('hi') }, 'send'),
        h('button', { onClick: () => void loadOlderMessages() }, 'load-more'),
      );
    }

    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('hasMore').textContent).toBe('true');

    fireEvent.click(screen.getByText('send'));
    expect(client.sendMessage).toHaveBeenCalledWith('hi', undefined);

    fireEvent.click(screen.getByText('load-more'));
    expect(client.loadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it('retryMessage replays the original id through client.retryMessage and hands back the typed RetryOutcome, without ever calling sendMessage', async () => {
    const client = createFakeChatClient();
    client.retryMessage = vi.fn(async (id: string): Promise<RetryOutcome> => ({
      status: 'retried',
      entry: {
        id,
        sessionId: 'sess_1',
        payload: { type: 'TEXT', content: 'hi' },
        enqueuedAt: 0,
        attempts: 1,
      },
    }));

    let observedOutcome: RetryOutcome | undefined;

    function RetryView() {
      const { retryMessage } = useMessages();
      return h('button', {
        onClick: () => {
          void retryMessage('msg_failed_1').then((outcome) => {
            observedOutcome = outcome;
          });
        },
      }, 'retry');
    }

    render(h(ChatProvider, { client }, h(RetryView)));

    fireEvent.click(screen.getByText('retry'));

    expect(client.retryMessage).toHaveBeenCalledWith('msg_failed_1');
    expect(client.retryMessage).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(observedOutcome?.status).toBe('retried');
    });
  });

  it('a "refused" retryMessage outcome is branchable on `reason` without string-matching', async () => {
    const client = createFakeChatClient(); // default: refused / not-found

    let observedOutcome: RetryOutcome | undefined;

    function RetryView() {
      const { retryMessage } = useMessages();
      return h('button', {
        onClick: () => {
          void retryMessage('msg_gone').then((outcome) => {
            observedOutcome = outcome;
          });
        },
      }, 'retry');
    }

    render(h(ChatProvider, { client }, h(RetryView)));
    fireEvent.click(screen.getByText('retry'));

    await waitFor(() => {
      expect(observedOutcome?.status).toBe('refused');
    });
    // Typed discrimination, not string-matching a message: this only
    // compiles/passes because `reason` is a real field on the union.
    expect(observedOutcome && observedOutcome.status === 'refused' ? observedOutcome.reason : null).toBe(
      'not-found',
    );
  });
});

describe('useTypingIndicator', () => {
  it('reads state.typing and delegates startTyping/stopTyping', () => {
    const client = createFakeChatClient({ typing: { isTyping: true, participantId: 'agent_1' } });

    function View() {
      const { isTyping, participantId, startTyping, stopTyping } = useTypingIndicator();
      return h(
        'div',
        null,
        h('div', { 'data-testid': 'typing' }, String(isTyping)),
        h('div', { 'data-testid': 'who' }, participantId ?? 'nobody'),
        h('button', { onClick: startTyping }, 'start'),
        h('button', { onClick: stopTyping }, 'stop'),
      );
    }

    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('typing').textContent).toBe('true');
    expect(screen.getByTestId('who').textContent).toBe('agent_1');

    fireEvent.click(screen.getByText('start'));
    expect(client.startTyping).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('stop'));
    expect(client.stopTyping).toHaveBeenCalledTimes(1);
  });
});

describe('useUnreadCount', () => {
  it('reads state.unreadCount and delegates markRead', () => {
    const client = createFakeChatClient({ unreadCount: 7 });

    function View() {
      const { unreadCount, markRead } = useUnreadCount();
      return h(
        'div',
        null,
        h('div', { 'data-testid': 'unread' }, unreadCount),
        h('button', { onClick: markRead }, 'mark-read'),
      );
    }

    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('unread').textContent).toBe('7');
    fireEvent.click(screen.getByText('mark-read'));
    expect(client.markRead).toHaveBeenCalledTimes(1);
  });
});

describe('useChatError', () => {
  it('reads state.lastError and updates when a new error is set', () => {
    const client = createFakeChatClient();

    function View() {
      const error = useChatError();
      return h('div', { 'data-testid': 'error' }, error === null ? 'none' : error.message);
    }

    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('error').textContent).toBe('none');

    act(() => {
      client.emitState({ lastError: makeChatError({ message: 'connection lost' }) });
    });

    expect(screen.getByTestId('error').textContent).toBe('connection lost');
  });
});
