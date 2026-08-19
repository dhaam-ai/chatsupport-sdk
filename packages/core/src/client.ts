// The assembled public API — task T13. PRD §6: one `createChatClient()`
// constructor, wiring T3 (state) + T4 (storage) + T5 (backoff, via T8) +
// T7 (transport) + T8 (connection) + T9 (auth) + T10 (queue) + T11
// (messages) + T12 (presence) into the single surface every binding (and a
// headless consumer) actually calls.
//
// Session operations (`joinSession`/`leaveSession`/`requestAgent`/
// `closeSession`/`reopenSession`) don't have a dedicated task in plan.md —
// they're thin, mostly direct frame-sends or single REST calls, so they're
// implemented directly here rather than in a module of their own.

import { CORE_PROTOCOL_VERSION } from './protocol/index.js';
import { generateUlid } from './ulid.js';
import { MemoryStorageAdapter, namespaced } from './storage/index.js';
import type { StorageAdapter } from './storage/index.js';
import { ChatEventEmitter, ChatStateStore, createInitialChatState } from './state/index.js';
import type { ChatEventMap, ChatSession, ChatState, Unsubscribe } from './state/index.js';
import { Transport } from './transport/index.js';
import { ConnectionMachine } from './connection/index.js';
import { AuthCoordinator } from './auth/index.js';
import type { GetToken } from './auth/index.js';
import { SendQueue } from './queue/index.js';
import { MessageCoordinator, RestClient, sessionSnapshotToChatSession } from './messages/index.js';
import type { SendAttachmentOptions, SendMessageOptions } from './messages/index.js';
import { PresenceCoordinator } from './presence/index.js';

export interface ChatClientConfig {
  publishableKey: string;
  /** Absent → guest mode (Gap A). Present → authenticated, token-based mode from the start. */
  getToken?: GetToken;
  /** REST base URL, e.g. `https://api.example.com`. Required — no port-swap heuristics (§12.7's confirmed anti-pattern, not repeated here). */
  apiUrl: string;
  /** WS base URL. Defaults to `apiUrl` with only its scheme swapped (http→ws, https→wss) — the host/port are never guessed. */
  wsUrl?: string;
  storage?: StorageAdapter;
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
  /**
   * Accepted for §6.1 shape parity. Not yet wired through — every client
   * currently negotiates with the single fixed `CORE_PROTOCOL_VERSION`
   * (protocol/version.ts). Documented limitation, not a silent no-op: there
   * is only one protocol version to negotiate to at launch (§7.5), so this
   * has nothing to do yet.
   */
  protocolVersion?: number;
}

export interface ChatClient {
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): Unsubscribe;
  on<E extends keyof ChatEventMap>(event: E, handler: (payload: ChatEventMap[E]) => void): Unsubscribe;

  connect(): Promise<void>;
  disconnect(): void;
  joinSession(sessionId: string): void;
  leaveSession(): void;
  requestAgent(reason?: string): void;
  reopenSession(sessionId: string): Promise<ChatSession>;
  closeSession(): Promise<void>;

  sendMessage(content: string, opts?: SendMessageOptions): Promise<void>;
  sendAttachment(file: Blob, opts?: SendAttachmentOptions): Promise<void>;
  markRead(): void;
  startTyping(): void;
  stopTyping(): void;
  loadOlderMessages(): Promise<void>;

  /** Gap A: upgrades a guest session to identified. See auth/auth-coordinator.ts. */
  identify(getToken: GetToken): Promise<void>;

  /** Not in PRD §6 — necessary for releasing timers/listeners. Idempotent. */
  destroy(): void;
}

function deriveWsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/+$/, '');
}

export function createChatClient(config: ChatClientConfig): ChatClient {
  const log = config.logger ?? (() => {});
  const wsUrl = config.wsUrl ?? deriveWsUrl(config.apiUrl);
  const apiUrl = config.apiUrl.replace(/\/+$/, '');

  const tenantStorage = namespaced(config.storage ?? new MemoryStorageAdapter(), config.publishableKey);

  const store = new ChatStateStore(createInitialChatState());
  const events = new ChatEventEmitter<ChatEventMap>();

  const transport = new Transport();
  const auth = new AuthCoordinator({
    publishableKey: config.publishableKey,
    storage: tenantStorage,
    ...(config.getToken ? { getToken: config.getToken } : {}),
  });
  const connection = new ConnectionMachine({ url: wsUrl, transport, buildHello: auth.buildHello });
  auth.attach(connection);

  const sendQueue = new SendQueue({ storage: tenantStorage, namespace: 'default' });
  const restClient = new RestClient({ apiUrl, publishableKey: config.publishableKey });
  const messages = new MessageCoordinator({
    store,
    connection,
    sendQueue,
    restClient,
    getAuth: () => auth.currentAuth,
    getSenderId: () => auth.senderId ?? 'unknown',
  });
  messages.attach();

  const presence = new PresenceCoordinator({ store, connection, getSenderId: () => auth.senderId ?? 'unknown' });
  presence.attach();

  const unsubscribers: Unsubscribe[] = [
    connection.on('connected', ({ ack }) => {
      log('info', 'connected', { sessionId: ack.session.sessionId });
      events.emit('connected', { session: sessionSnapshotToChatSession(ack.session) });
    }),
    connection.on('reconnecting', (payload) => {
      log('debug', 'reconnecting', payload);
      events.emit('reconnecting', payload);
    }),
    connection.on('suspended', (payload) => {
      log('warn', 'suspended', payload);
      events.emit('suspended', payload);
    }),
    connection.on('invalidFrame', ({ failure, raw }) => {
      // A protocol mismatch with the real server, not the fake one — surface
      // it loudly instead of leaving it as a silent, endless reconnect loop.
      const chatError = {
        code: 'VALIDATION_FAILED' as const,
        message: `Received a frame that failed protocol validation: ${failure.reason}`,
        retryable: true,
        details: { path: failure.path, raw: raw.slice(0, 500) },
      };
      log('error', chatError.message, { path: failure.path });
      store.setState({ lastError: chatError });
      events.emit('error', chatError);
    }),
    connection.on('stateChange', ({ state, previous }) => {
      if (previous === 'connected' && state !== 'connected') {
        // ConnectionMachine doesn't surface the underlying transport close
        // code/reason at this layer — a real reason string is a known gap,
        // not silently dropped.
        events.emit('disconnected', { reason: state });
      }
      store.setState({ connectionState: state });
    }),
    connection.on('frame', (frame) => {
      switch (frame.t) {
        case 'agent.joined':
          events.emit('agentJoined', frame.d);
          return;
        case 'agent.left':
          events.emit('agentLeft', frame.d);
          return;
        case 'session.updated':
          events.emit('statusChange', { status: frame.d.session.status, mode: frame.d.session.mode });
          return;
        case 'session.closed':
          events.emit('sessionClosed', frame.d);
          return;
        case 'presence.update':
          events.emit('presenceUpdate', frame.d);
          return;
        case 'ticket.linked':
          events.emit('ticketLinked', frame.d);
          return;
        case 'message.new':
          // MessageCoordinator already applied this to ChatState; this is
          // the discrete-event half of the same push (§6.4/§6.5 draws that
          // distinction deliberately).
          events.emit('message', { ...frame.d, chatSessionId: frame.d.sessionId, messageType: frame.d.type, senderName: null, attachment: null, replyToMessageId: frame.d.replyToMessageId ?? null, replyToMessage: null });
          return;
        case 'ack':
          if (frame.d.ok && 'seq' in frame.d) {
            events.emit('messageAck', { id: frame.ref, seq: frame.d.seq });
          }
          return;
        case 'error':
          log('error', frame.d.message, { code: frame.d.code });
          store.setState({ lastError: frame.d });
          events.emit('error', frame.d);
          return;
        default:
          return;
      }
    }),
  ];

  function sendFrame(t: string, d: object): void {
    if (connection.state !== 'connected') return;
    connection.send({ v: CORE_PROTOCOL_VERSION, t, id: generateUlid(), ts: Date.now(), d } as Parameters<ConnectionMachine['send']>[0]);
  }

  function requireSessionId(): string {
    const id = store.getState().session?.id;
    if (!id) throw new Error('createChatClient: no active session — connect() first.');
    return id;
  }

  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    on: (event, handler) => events.on(event, handler),

    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        const unsubConnected = connection.on('connected', () => {
          unsubConnected();
          unsubSuspended();
          resolve();
        });
        const unsubSuspended = connection.on('suspended', ({ reason }) => {
          unsubConnected();
          unsubSuspended();
          reject(new Error(`connect() failed: suspended (${reason})`));
        });
        connection.connect();
      });
    },

    disconnect(): void {
      connection.disconnect();
    },

    joinSession(sessionId: string): void {
      sendFrame('session.join', { sessionId });
    },

    leaveSession(): void {
      sendFrame('session.leave', {});
    },

    requestAgent(reason?: string): void {
      sendFrame('session.requestAgent', reason !== undefined ? { reason } : {});
    },

    async reopenSession(sessionId: string): Promise<ChatSession> {
      const session = await restClient.reopenSession(sessionId, auth.currentAuth);
      store.setState({ session });
      return session;
    },

    async closeSession(): Promise<void> {
      const sessionId = requireSessionId();
      const session = await restClient.closeSession(sessionId, auth.currentAuth);
      store.setState({ session });
    },

    sendMessage: (content: string, opts?: SendMessageOptions) => messages.sendMessage(content, opts),
    sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => messages.sendAttachment(file, opts),
    loadOlderMessages: () => messages.loadOlderMessages(),

    markRead: () => presence.markRead(),
    startTyping: () => presence.startTyping(),
    stopTyping: () => presence.stopTyping(),

    identify: (getToken: GetToken) => auth.identify(getToken),

    destroy(): void {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      messages.destroy();
      presence.destroy();
      auth.destroy();
      connection.destroy();
      if (connection.state !== 'closed') connection.disconnect();
    },
  };
}
