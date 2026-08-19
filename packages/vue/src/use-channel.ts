// useChannel — connection lifecycle + the active session (§6.2, §8.1).
// "Channel" names the thing this composable is about: which session you are in
// and whether the socket is up, not any one message.
//
// ---------------------------------------------------------------------------
// One ref per field, not one ref holding a bag of fields
// ---------------------------------------------------------------------------
//
// The React binding selects `{ connectionState, session, pastSessions,
// lastError }` as a single composite with `shallowEqual`, because a React hook
// can only return one value and a component re-renders as a unit anyway — so
// the finest granularity available there is "did any of the four change".
//
// Vue's unit of invalidation is the ref, not the component, so the same four
// fields are four independent `useChatSelector` calls. A template rendering
// only `{{ connectionState }}` is not re-rendered when `pastSessions` changes,
// and no `shallowEqual` is needed anywhere because each selector returns a
// field straight off `ChatState` and core's shallow-patch `setState` leaves an
// untouched field reference-identical.
//
// The cost is four `subscribe` registrations instead of one. A registration is
// a `Set` entry whose callback is one reference comparison against the previous
// snapshot on a miss, so this is not a tradeoff so much as a rounding error —
// and it buys strictly finer invalidation than the composite could give.
//
// The actions are plain closures, not memoized. A composable body runs once per
// consumer, so there is no per-render identity to stabilize — React's `useMemo`
// here has no Vue counterpart because it has no Vue problem to solve.

import type {
  ChatError,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  ConnectionState,
} from '@dhaam-ccrm/core';
import type { ShallowRef } from 'vue';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export interface UseChannelResult {
  /** §8.1's seven states: idle | connecting | authenticating | connected | reconnecting | suspended | closed. */
  connectionState: Readonly<ShallowRef<ConnectionState>>;
  /** The active session, or `null` before one exists. */
  session: Readonly<ShallowRef<ChatSession | null>>;
  /** History list for a "past conversations" UI (§6.4). */
  pastSessions: Readonly<ShallowRef<ChatSessionSummary[]>>;
  /** Most recent protocol- or transport-level error, or `null`. See also {@link useChatError} if you only want this one field. */
  lastError: Readonly<ShallowRef<ChatError | null>>;

  /** Opens the connection and drives it to `connected`. Resolves once `connection.ack` is received (§6.2). */
  connect: () => Promise<void>;
  /** User-initiated, terminal — no auto-reconnect follows (§6.2, §8.1). */
  disconnect: () => void;
  joinSession: (sessionId: string) => void;
  leaveSession: () => void;
  requestAgent: (reason?: string) => void;
  /** REST-only; rejects with `ChatClientConfigError` if the client was not configured with `sessionActions` (§6.2). */
  reopenSession: (sessionId: string) => Promise<ChatSession>;
  /** REST-only; rejects with `ChatClientConfigError` if the client was not configured with `sessionActions` (§6.2). */
  closeSession: () => Promise<void>;
}

const selectConnectionState = (state: ChatState): ConnectionState => state.connectionState;
const selectSession = (state: ChatState): ChatSession | null => state.session;
const selectPastSessions = (state: ChatState): ChatSessionSummary[] => state.pastSessions;
const selectLastError = (state: ChatState): ChatError | null => state.lastError;

export function useChannel(): UseChannelResult {
  const client = useChatClient();

  return {
    connectionState: useChatSelector(selectConnectionState),
    session: useChatSelector(selectSession),
    pastSessions: useChatSelector(selectPastSessions),
    lastError: useChatSelector(selectLastError),

    // Wrapped rather than passed through as `client.connect` etc.: a bound
    // method handed out naked would break for any `ChatClient` implementation
    // that is class-based, and `ChatClient` is an interface — core's own
    // factory shape is not something this package gets to assume.
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    joinSession: (sessionId: string) => client.joinSession(sessionId),
    leaveSession: () => client.leaveSession(),
    requestAgent: (reason?: string) => client.requestAgent(reason),
    reopenSession: (sessionId: string) => client.reopenSession(sessionId),
    closeSession: () => client.closeSession(),
  };
}
