// The discrete-event catalog — PRD §6.5.
//
// §6.4 splits core's observable surface in two: continuous state goes
// through `subscribe` (types.ts / store.ts), and *discrete occurrences that
// are not naturally "current state"* go through `on`. This module is the
// second half — one entry per row of §6.5's table, no more.
//
// Four payloads are the protocol module's shapes rather than new ones,
// because §6.5's payload column already matches them field-for-field.
// Re-declaring them here would create exactly the kind of drift D4 exists to
// prevent.

import type {
  AgentEventPayload,
  ChatMode,
  ChatStatus,
  CloseReason,
  EmptyPayload,
  PresenceEntry,
  TicketLinkedPayload,
} from '../protocol/index.js';
import type { ChatError, ChatMessage, ChatSession, SendFailureReason } from './types.js';

/**
 * Every event core emits, mapped to its payload type. One entry per row of
 * §6.5's table — `agentJoined`/`agentLeft` are split into two keys because
 * they are two events that happen to share `AgentEventPayload`.
 *
 * `on<E extends keyof ChatEventMap>` keys off this map, so a handler's
 * parameter is inferred from the event name with no annotation at the call
 * site — `on('message', (m) => m.content)` types `m` as `ChatMessage`.
 */
export interface ChatEventMap {
  /** `connection.ack` received — fresh connect or reconnect alike (§12.3). */
  connected: { session: ChatSession };

  /** A backoff timer was scheduled (§8.2). */
  reconnecting: { attempt: number; delayMs: number };

  /** Core stopped auto-retrying (§8.1) — an explicit `connect()` is now required. */
  /**
   * `protocol` covers a non-retryable protocol failure — §7.5's
   * `PROTOCOL_VERSION_UNSUPPORTED`. It is neither an auth failure nor
   * exhausted retries, and collapsing it into `maxAttempts` would tell a
   * binding to render "still trying" for a condition no retry can fix.
   */
  suspended: { reason: 'auth' | 'maxAttempts' | 'protocol' };

  /** Transport dropped. */
  disconnected: { reason: string };

  /** A message was applied to state — optimistic or server-confirmed (§6.5). */
  message: ChatMessage;

  /**
   * The server confirmed a client-sent message (§9.3). `seq` is the ordering
   * key it assigned (D2); absent when the ack carried no seq.
   */
  messageAck: { id: string; seq?: number };

  /**
   * A queued send will never be retried again (§9.6).
   *
   * Distinct from `messageAck` never arriving: this is a terminal outcome, so
   * a binding can stop showing a spinner and offer a retry. `id` is the
   * message's permanent ULID (D1), so it addresses the same message the app
   * already rendered optimistically.
   */
  sendFailed: { id: string; sessionId: string; reason: SendFailureReason };

  /**
   * Remote typing state changed. Unlike `ChatState.typing`, `participantId`
   * is required: an event always names who, whereas the state field can
   * legitimately describe "nobody is typing" (§6.4 vs §6.5).
   */
  typing: { isTyping: boolean; participantId: string };

  agentJoined: AgentEventPayload;
  agentLeft: AgentEventPayload;

  statusChange: { status: ChatStatus; mode: ChatMode };

  /**
   * §6.5 scopes this payload to `closeReason` alone — narrower than the wire
   * `SessionClosedPayload`, which also carries `sessionId`. The event
   * describes the session the client is already in, so the id would be
   * redundant. §6.5 is the authority for the public surface.
   */
  sessionClosed: { closeReason: CloseReason };

  presenceUpdate: PresenceEntry;

  ticketLinked: TicketLinkedPayload;

  /** `getToken()` was successfully re-invoked (§10.3). Deliberately payload-free. */
  tokenRefreshed: EmptyPayload;

  /** Any protocol- or transport-level error (§7.4). */
  error: ChatError;
}

/** The name of any event in the §6.5 catalog. */
export type ChatEventName = keyof ChatEventMap;

/** A handler for event `E`, receiving exactly that event's payload. */
export type ChatEventHandler<E extends ChatEventName> = (payload: ChatEventMap[E]) => void;

/**
 * Every event name as a runtime value, for tests and for bindings that want
 * to fan the whole catalog out to a generic listener.
 *
 * `satisfies` keeps this array from naming an event that does not exist;
 * events.test.ts adds the opposite check (no event missing from the array),
 * so the two can never drift apart.
 */
export const CHAT_EVENT_NAMES = [
  'connected',
  'reconnecting',
  'suspended',
  'disconnected',
  'message',
  'messageAck',
  'sendFailed',
  'typing',
  'agentJoined',
  'agentLeft',
  'statusChange',
  'sessionClosed',
  'presenceUpdate',
  'ticketLinked',
  'tokenRefreshed',
  'error',
] as const satisfies readonly ChatEventName[];
