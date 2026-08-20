import { describe, it, expect } from 'vitest';
import { chatReducer, initialState } from './reducer';
import type { ChatMessage, ChatSDKState } from './types';

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'temp-1',
    chatSessionId: 's1',
    senderType: 'CUSTOMER',
    content: 'hello',
    messageType: 'TEXT',
    timestamp: new Date('2026-08-20T10:00:00Z'),
    ...over,
  };
}

function withMessages(messages: ChatMessage[]): ChatSDKState {
  return { ...initialState, messages };
}

describe('chatReducer — outbound send state', () => {
  it('MARK_SEND_FAILED records the failure on the existing message', () => {
    const state = withMessages([msg({ sendStatus: 'sending' })]);
    const next = chatReducer(state, {
      type: 'MARK_SEND_FAILED',
      tempId: 'temp-1',
      failure: { code: 'ACK_TIMEOUT', message: 'nope', retryable: true },
    });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].sendStatus).toBe('failed');
    expect(next.messages[0].sendFailure?.retryable).toBe(true);
  });

  it('a retry mutates the SAME message rather than appending a second one', () => {
    // This is the reported bug: retry used to mint a new message, so every
    // click left another failed bubble behind.
    const failed = msg({
      sendStatus: 'failed',
      sendFailure: { code: 'ACK_TIMEOUT', message: 'nope', retryable: true },
      clientMessageId: 'cmid-1',
    });
    const next = chatReducer(withMessages([failed]), { type: 'MARK_SENDING', tempId: 'temp-1' });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].sendStatus).toBe('sending');
    expect(next.messages[0].sendFailure).toBeUndefined();
    // The idempotency key survives the retry — this is what makes the server
    // dedupe the replay instead of writing a second message.
    expect(next.messages[0].clientMessageId).toBe('cmid-1');
  });

  it('MARK_SENDING on an unknown id is a no-op, never an append', () => {
    const state = withMessages([msg()]);
    expect(chatReducer(state, { type: 'MARK_SENDING', tempId: 'nope' })).toBe(state);
  });

  it('a late error cannot un-send a message the server already confirmed', () => {
    const sent = msg({ id: 'real-1', sendStatus: 'sent' });
    const state = withMessages([sent]);
    const next = chatReducer(state, {
      type: 'MARK_SEND_FAILED',
      tempId: 'real-1',
      failure: { code: 'MESSAGE_ERROR', message: 'boom', retryable: true },
    });
    expect(next).toBe(state);
  });

  it('REPLACE_TEMP clears a prior failure and marks the message sent', () => {
    const failed = msg({
      sendStatus: 'failed',
      sendFailure: { code: 'ACK_TIMEOUT', message: 'nope', retryable: true },
      clientMessageId: 'cmid-1',
      clientKey: 'temp-1',
    });
    const next = chatReducer(withMessages([failed]), {
      type: 'REPLACE_TEMP',
      tempId: 'temp-1',
      message: msg({ id: 'real-1' }),
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].id).toBe('real-1');
    expect(next.messages[0].sendStatus).toBe('sent');
    expect(next.messages[0].sendFailure).toBeUndefined();
    // Stable React key and the idempotency key both survive the swap.
    expect(next.messages[0].clientKey).toBe('temp-1');
    expect(next.messages[0].clientMessageId).toBe('cmid-1');
  });

  it('a retry that succeeds leaves exactly one message in the list', () => {
    // Full round trip: send → timeout → retry → ack.
    let state = withMessages([]);
    state = chatReducer(state, {
      type: 'ADD_MESSAGE',
      message: msg({ sendStatus: 'sending', clientMessageId: 'cmid-1', clientKey: 'temp-1' }),
    });
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED',
      tempId: 'temp-1',
      failure: { code: 'ACK_TIMEOUT', message: 'nope', retryable: true },
    });
    state = chatReducer(state, { type: 'MARK_SENDING', tempId: 'temp-1' });
    state = chatReducer(state, {
      type: 'REPLACE_TEMP',
      tempId: 'temp-1',
      message: msg({ id: 'real-1', clientMessageId: 'cmid-1' }),
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('real-1');
    expect(state.messages[0].sendStatus).toBe('sent');
  });

  it('REPLACE_TEMP appends when the temp message is gone, without duplicating', () => {
    const state = withMessages([msg({ id: 'real-1' })]);
    const same = chatReducer(state, {
      type: 'REPLACE_TEMP', tempId: 'missing', message: msg({ id: 'real-1' }),
    });
    expect(same).toBe(state);

    const added = chatReducer(state, {
      type: 'REPLACE_TEMP', tempId: 'missing', message: msg({ id: 'real-2' }),
    });
    expect(added.messages).toHaveLength(2);
  });
});

describe('chatReducer — existing behaviour still holds', () => {
  it('ADD_MESSAGE deduplicates by id', () => {
    const state = withMessages([msg({ id: 'a' })]);
    expect(chatReducer(state, { type: 'ADD_MESSAGE', message: msg({ id: 'a' }) })).toBe(state);
  });

  it('counts unread agent/bot messages only while the widget is closed', () => {
    let state: ChatSDKState = { ...initialState, isWidgetOpen: false };
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: msg({ id: 'a', senderType: 'AGENT' }) });
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: msg({ id: 'b', senderType: 'CUSTOMER' }) });
    expect(state.unreadCount).toBe(1);

    state = chatReducer(state, { type: 'SET_WIDGET_OPEN', open: true });
    expect(state.unreadCount).toBe(0);
  });

  it('UPDATE_SESSION merges, and is inert with no session', () => {
    const withSession: ChatSDKState = {
      ...initialState,
      session: { id: 's1', mode: 'BOT', status: 'OPEN' },
    };
    const next = chatReducer(withSession, {
      type: 'UPDATE_SESSION',
      session: { status: 'ASSIGNED', assignedAgentName: 'Priya Nair' },
    });
    expect(next.session).toEqual({
      id: 's1', mode: 'BOT', status: 'ASSIGNED', assignedAgentName: 'Priya Nair',
    });
    expect(chatReducer(initialState, { type: 'UPDATE_SESSION', session: { status: 'CLOSED' } }).session)
      .toBeNull();
  });
});
