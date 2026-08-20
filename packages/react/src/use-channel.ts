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
  /**
   * The raw `session.join` frame and nothing else — NOT "switch to this
   * conversation".
   *
   * It changes no `ChatState`: the transcript, watermarks, presence, unread
   * count and resume anchor all still describe the session you were in, and
   * no history is fetched for the session you named. Building a picker on
   * this and `pastSessions` above is exactly how a new session's header ends
   * up rendered over the old session's messages. Use {@link
   * UseChannelResult.switchSession} — or `useSessionList()`, which tracks
   * the in-flight/failed state a picker row needs — instead. This stays for
   * callers that genuinely want the bare frame.
   */
  joinSession: (sessionId: string) => void;

  /**
   * Changes conversations: core's composite operation (abandon the outgoing
   * session's queued sends, clear every per-session projection, join, wait
   * for the snapshot, load page one).
   *
   * Resolves only once the new session's first page is in
   * `ChatState.messages`, and REJECTS with `SessionSwitchError` if the
   * server refused the join, the socket was not open, or the snapshot never
   * arrived — handle it, the way you would `connect()`. A picker wants
   * `useSessionList()` instead: same operation, with `switchingSessionId`/
   * `switchError` already tracked and no rejection to catch.
   */
  switchSession: (sessionId: string) => Promise<void>;

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
      switchSession: (sessionId: string) => client.switchSession(sessionId),
      leaveSession: () => client.leaveSession(),
      requestAgent: (reason?: string) => client.requestAgent(reason),
      reopenSession: (sessionId: string) => client.reopenSession(sessionId),
      closeSession: () => client.closeSession(),
    }),
    [client],
  );

  return { ...slice, ...actions };
}
