import { describe, it, expect } from 'vitest';
import { chatReducer, initialState } from './reducer';
import type { ChatMessage, ChatSDKState } from './types';
import { LOCAL_CODES, toSendFailure } from './sendState';

// These drive the reducer through the exact action sequences context.tsx
// produces for the two failure modes the user reported. The point being
// proved is that a send always LEAVES the 'sending' state — previously an
// optimistic bubble whose send never landed sat there indefinitely with no
// tick, no error and no retry.

function outbound(id: string, content: string): ChatMessage {
  return {
    id,
    clientKey: id,
    clientMessageId: `cmid-${id}`,
    sendStatus: 'sending',
    chatSessionId: 's1',
    senderType: 'CUSTOMER',
    content,
    messageType: 'TEXT',
    timestamp: new Date('2026-08-20T10:00:00Z'),
  };
}

function connected(): ChatSDKState {
  return {
    ...initialState,
    initialized: true,
    connected: true,
    loading: false,
    session: { id: 's1', mode: 'BOT', status: 'OPEN' },
  };
}

describe('server down', () => {
  it('an unacked send becomes failed-with-retry, never stays sending', () => {
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'anyone there?') });
    expect(state.messages[0].sendStatus).toBe('sending');

    // The socket drops; the ack never arrives; the ACK_TIMEOUT_MS timer fires.
    state = chatReducer(state, { type: 'SET_CONNECTED', connected: false });
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED', tempId: 'temp-1', failure: toSendFailure(LOCAL_CODES.ACK_TIMEOUT),
    });

    expect(state.messages[0].sendStatus).toBe('failed');
    expect(state.messages[0].sendFailure?.retryable).toBe(true);
    expect(state.messages).toHaveLength(1);
  });

  it('the server coming back and acking a retry leaves ONE message', () => {
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'anyone there?') });
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED', tempId: 'temp-1', failure: toSendFailure(LOCAL_CODES.ACK_TIMEOUT),
    });

    // Manager reconnects → context re-enables input → user clicks Retry, which
    // replays cmid-temp-1 rather than minting a new one.
    state = chatReducer(state, { type: 'SET_CONNECTED', connected: true });
    state = chatReducer(state, { type: 'MARK_SENDING', tempId: 'temp-1' });
    expect(state.messages[0].clientMessageId).toBe('cmid-temp-1');

    state = chatReducer(state, {
      type: 'REPLACE_TEMP',
      tempId: 'temp-1',
      message: { ...outbound('real-1', 'anyone there?'), sendStatus: undefined },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('real-1');
    expect(state.messages[0].sendStatus).toBe('sent');
    expect(state.messages[0].sendFailure).toBeUndefined();
  });

  it('the missed-message refetch after reconnect does not duplicate the retried message', () => {
    // context refetches /full with mergeOnly on reconnect, which replays every
    // message through ADD_MESSAGE. Dedup by id is what keeps that safe.
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'hi') });
    state = chatReducer(state, {
      type: 'REPLACE_TEMP', tempId: 'temp-1', message: outbound('real-1', 'hi'),
    });
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('real-1', 'hi') });

    expect(state.messages).toHaveLength(1);
  });
});

describe('internet down', () => {
  it("a send refused because the socket is down fails immediately, and is retryable", () => {
    // client.sendMessage throws 'Not connected' synchronously; beginSend
    // classifies it rather than letting a floating promise reject unobserved.
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'hello?') });
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED', tempId: 'temp-1', failure: toSendFailure(LOCAL_CODES.NOT_CONNECTED),
    });

    expect(state.messages[0].sendStatus).toBe('failed');
    expect(state.messages[0].sendFailure).toMatchObject({
      code: 'NOT_CONNECTED',
      retryable: true,
      message: "You're offline — this message wasn't sent.",
    });
  });

  it('an expired token fails in-flight sends with NO retry affordance', () => {
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'hello?') });
    state = chatReducer(state, { type: 'TOKEN_EXPIRED' });
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED', tempId: 'temp-1', failure: toSendFailure(LOCAL_CODES.TOKEN_EXPIRED),
    });

    expect(state.tokenExpired).toBe(true);
    expect(state.connected).toBe(false);
    // Retrying is refused identically every time until the page is refreshed.
    expect(state.messages[0].sendFailure?.retryable).toBe(false);
  });

  it('an ack that arrives after the browser reported offline still settles the message', () => {
    // 'offline' is a hint, not proof the packet was lost — the socket may have
    // flushed its buffer just before the interface went down.
    let state = connected();
    state = chatReducer(state, { type: 'ADD_MESSAGE', message: outbound('temp-1', 'hello?') });
    state = chatReducer(state, { type: 'SET_CONNECTED', connected: false });
    state = chatReducer(state, {
      type: 'REPLACE_TEMP', tempId: 'temp-1', message: outbound('real-1', 'hello?'),
    });
    expect(state.messages[0].sendStatus).toBe('sent');

    // A late timeout must not un-send it.
    state = chatReducer(state, {
      type: 'MARK_SEND_FAILED', tempId: 'real-1', failure: toSendFailure(LOCAL_CODES.ACK_TIMEOUT),
    });
    expect(state.messages[0].sendStatus).toBe('sent');
  });
});
