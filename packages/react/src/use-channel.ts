// useChannel — connection lifecycle + the active session (§6.2, §8.1).
// "Channel" names the thing this hook is about: which session you're in and
// whether the socket is up, not any one message.

import type { ChatError, ChatSession, ChatSessionSummary, ChatState, ConnectionState } from '@dhaam-ccrm/core';
import { useMemo } from 'react';

import { useChatClient } from './context.js';
import { shallowEqual, useChatSelector } from './use-chat-selector.js';

export interface UseChannelResult {
  /** §8.1's seven states: idle | connecting | authenticating | connected | reconnecting | suspended | closed. */
  connectionState: ConnectionState;
  /** The active session, or `null` before one exists. */
  session: ChatSession | null;
  /** History list for a "past conversations" UI (§6.4). */
  pastSessions: ChatSessionSummary[];
  /** Most recent protocol- or transport-level error, or `null`. See also {@link useChatError} if you only want this one field. */
  lastError: ChatError | null;

  /** Opens the connection and drives it to `connected`. Resolves once `connection.ack` is received (§6.2). */
  connect: () => Promise<void>;
  /** User-initiated, terminal — no auto-reconnect follows (§6.2, §8.1). */
  disconnect: () => void;
  joinSession: (sessionId: string) => void;
  leaveSession: () => void;
  requestAgent: (reason?: string) => void;
  /** REST-only; rejects with `ChatClientConfigError` if the client wasn't configured with `sessionActions` (§6.2). */
  reopenSession: (sessionId: string) => Promise<ChatSession>;
  /** REST-only; rejects with `ChatClientConfigError` if the client wasn't configured with `sessionActions` (§6.2). */
  closeSession: () => Promise<void>;
}

function selectChannelState(state: ChatState) {
  return {
    connectionState: state.connectionState,
    session: state.session,
    pastSessions: state.pastSessions,
    lastError: state.lastError,
  };
}

export function useChannel(): UseChannelResult {
  const client = useChatClient();
  const slice = useChatSelector(selectChannelState, shallowEqual);

  const actions = useMemo(
    () => ({
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
      joinSession: (sessionId: string) => client.joinSession(sessionId),
      leaveSession: () => client.leaveSession(),
      requestAgent: (reason?: string) => client.requestAgent(reason),
      reopenSession: (sessionId: string) => client.reopenSession(sessionId),
      closeSession: () => client.closeSession(),
    }),
    [client],
  );

  return { ...slice, ...actions };
}
