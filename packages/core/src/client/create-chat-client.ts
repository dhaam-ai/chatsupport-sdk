// createChatClient — PRD §6.1. The front door: every T7-T12 module gets
// constructed and wired together exactly once, here.
//
// ── Construction order, and the two forward-reference patterns it needs ──
//
// Most of this file is straight-line construction. Two spots are not, and
// both are documented inline where they happen:
//
//   1. `messageController` <-> `queue`. `MessageController` takes `enqueue`
//      as a function (messages/types.ts's `EnqueueSend`), not the `SendQueue`
//      itself, because the queue needs the controller's `onAck`/`onFailed`
//      callbacks at *its* construction — so whichever is built first has to
//      reference the other before it exists. Explicit type annotations on
//      both `const` declarations break the TS7022 circular-inference error
//      this would otherwise produce; see queue/send-queue.ts's `SendQueue`
//      doc and messages/types.ts's `EnqueueSend` doc for why neither module
//      restructures around this instead.
//   2. `realTransport` / `messageControllerRef`. `dispatchFrame` and
//      `emitIntent` are both built *before* the objects they call into
//      (`WebSocketTransport`, `MessageController`) exist, because
//      `ConnectionController`'s constructor calls the transport factory
//      synchronously and needs `onFrame` wired in before that happens. Both
//      are plain closures over a `let` assigned later — safe because neither
//      closure is *invoked* until a consumer calls `connect()`/`sendMessage()`
//      /etc., well after this function has finished wiring everything and
//      returned.
//
// Nothing here does HTTP, reads `window`/`document`, or imports a framework.
// The only globals touched are `WebSocket` (lazily, inside the transport,
// only at connect time) and `Date`/`setTimeout` (only as the *default* clock
// and scheduler — every module already accepts an injected override).

import { parsePublishableKey } from '../auth/index.js';
import {
  ConnectionController,
  type TransportFactory,
} from '../connection/index.js';
import { MessageController, upsertMessage } from '../messages/index.js';
import type { LocalSender } from '../messages/index.js';
import { PresenceCoordinator } from '../presence/index.js';
import { isParkedCloseReason } from '../protocol/index.js';
import type { ErrorPayload, ServerFrame } from '../protocol/index.js';
import { SendQueue } from '../queue/index.js';
import type { QueuedSend, QueueTransport, RetryOutcome } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatError, ChatMessage, ChatSession, ChatSessionSummary } from '../state/index.js';
import { MemoryStorageAdapter, namespaced } from '../storage/index.js';
import { WebSocketTransport } from '../transport/index.js';
import type { TransportLogger } from '../transport/index.js';
import {
  applyAgentJoined,
  applyAgentLeft,
  applySessionClosed,
  applyTicketLinked,
  sessionSnapshotToChatSession,
  statusOrModeChanged,
} from './session.js';
import { ChatClientConfigError } from './types.js';
import type { ChatClient, ChatClientConfig } from './types.js';

/** Resolves `config.localSender` to a plain `() => LocalSender`, whether given as an object or a thunk. */
function normalizeLocalSender(input: LocalSender | (() => LocalSender)): () => LocalSender {
  return typeof input === 'function' ? input : () => input;
}

/** Adapts §6.1's `logger` callback to the transport's single-method `TransportLogger` (§14: `warn` only). */
function adaptLogger(logger: ChatClientConfig['logger']): TransportLogger | undefined {
  if (logger === undefined) return undefined;
  return {
    warn(message, context) {
      logger('warn', message, context);
    },
  };
}

/** An `AttachmentUploader` that fails loudly — the `config.uploader` unset case (see client/types.ts). */
const UNCONFIGURED_UPLOADER = {
  upload(): Promise<never> {
    return Promise.reject(
      new ChatClientConfigError(
        'sendAttachment() requires config.uploader (an AttachmentUploader) to be supplied to createChatClient().',
      ),
    );
  },
};

function toChatError(payload: ErrorPayload): ChatError {
  return {
    source: 'protocol',
    code: payload.code,
    message: payload.message,
    retryable: payload.retryable,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  };
}

export function createChatClient(config: ChatClientConfig): ChatClient {
  // ---------------------------------------------------------------------
  // 1. Validate config. Loud failure at construction beats a token minted
  //    in a browser (§14) or a client that silently never connects.
  // ---------------------------------------------------------------------
  const publishableKey = parsePublishableKey(config.publishableKey);

  const wsUrl = config.wsUrl;
  if (wsUrl === undefined || wsUrl === '') {
    throw new ChatClientConfigError(
      'wsUrl is required: core has no legitimate default WebSocket endpoint to fall back to ' +
        '(PRD §12.7 rejects hardcoded/derived hosts). Pass ChatClientConfig.wsUrl explicitly.',
    );
  }

  const resolveLocalSender = normalizeLocalSender(config.localSender);
  // Resolved once, eagerly, so presence/typing/watermark identity (below) is
  // seeded correctly from construction — not just at send time. See
  // client/types.ts's `localSender` doc for what happens if a thunk needs
  // data that is only available after `connect()`.
  const localSender = resolveLocalSender();

  const storage = config.storage ?? new MemoryStorageAdapter();
  // Namespaced by publishable key so two ChatClient instances sharing one
  // backing store (two embeds on one origin, agent + customer side by side)
  // never collide on the same 'sendQueue' key. Nested rather than
  // interpolated into one string — `namespaced()` rejects a namespace
  // containing ':' (its own delimiter), precisely to stop two different
  // namespace/key pairs from colliding on the same resulting key.
  const queueStorage = namespaced(namespaced(storage, 'chatsdk'), publishableKey);

  const schedule = config.schedule;
  const now = config.now;
  const transportLogger = adaptLogger(config.logger);

  // ---------------------------------------------------------------------
  // 2. The store. Everything else writes into this one instance.
  // ---------------------------------------------------------------------
  const store = new ChatStore();

  // ---------------------------------------------------------------------
  // 3. Forward-declared refs — see the file header, pattern 2.
  // ---------------------------------------------------------------------
  let realTransport!: WebSocketTransport;
  let messageControllerRef!: MessageController;

  // ---------------------------------------------------------------------
  // 4. Presence/typing/watermarks. Needs `emitIntent`, which needs the
  //    transport — forward-referenced (not invoked until a consumer calls
  //    startTyping()/markRead()/etc., well after construction finishes).
  // ---------------------------------------------------------------------
  const presenceCoordinator = new PresenceCoordinator({
    store,
    emitIntent: (intent) => {
      realTransport.send(intent.t, intent.d);
    },
    // Explicit, not adopted from the session snapshot's lone CUSTOMER
    // participant: that auto-adopt heuristic (watermarks.ts) is correct only
    // for a customer-facing embed. An agent-side embed's local participant is
    // the agent, and `localSender` is the one place that is actually known,
    // so it is used to seed identity for typing self-echo filtering and
    // read-watermark keying too — not just message sender labeling.
    localParticipantId: localSender.senderId,
    ...(schedule === undefined ? {} : { schedule }),
    ...(now === undefined ? {} : { clock: now }),
  });

  // ---------------------------------------------------------------------
  // 5. The inbound frame dispatcher — the onFrame chain every server push
  //    ultimately reaches. Closes three gaps none of T7-T12 owned:
  //      - SessionSnapshot -> ChatSession (T8's flagged gap; this is what
  //        makes `connected` actually fire with a populated session).
  //      - a live 'error' frame that isn't AUTH_EXPIRED (handled internally)
  //        and isn't ref-matched to a pending send never otherwise reaches
  //        `lastError`/the `error` event.
  //      - agent.joined/left, session.closed, ticket.linked all need to
  //        both patch `ChatState.session` and emit their §6.5 event; nothing
  //        else does either.
  // ---------------------------------------------------------------------
  function dispatchFrame(frame: ServerFrame): void {
    if (frame.t === 'error') {
      // AUTH_EXPIRED is already being actively handled by the connection
      // controller's reactive refresh (§10.4) — surfacing it here would
      // flash a transient, auto-recovering condition as a user-facing error,
      // contradicting §10.5's "the app never has to think about which path
      // was taken". Every other code is a genuine, unhandled protocol error
      // with nowhere else to go: a ref-less or unmatched-ref `error` frame
      // reaches `onFrame` without ever passing through
      // ConnectionController's own `#reportError`.
      if (frame.d.code !== 'AUTH_EXPIRED') {
        const chatError = toChatError(frame.d);
        store.setState({ lastError: chatError });
        store.emit('error', chatError);
      }
      return;
    }
    if (frame.t === 'ack') return; // Never actually reaches onFrame (settled via the pending-ack registry) — defensive only.

    // frame: ServerPushFrame from here on.
    if (frame.t === 'connection.ack' || frame.t === 'session.updated') {
      const previous = store.getState().session;
      const next = sessionSnapshotToChatSession(frame.d.session, previous);
      store.setState({ session: next });
      if (statusOrModeChanged(previous, next)) {
        store.emit('statusChange', { status: next.status, mode: next.mode });
      }
    }

    // presence/, not this file, owns typing/presence/watermarks and (for
    // watermark reconciliation) the same two snapshot frame types handled
    // above — both can process the same frame since they touch disjoint
    // state.
    if (presenceCoordinator.handleFrame(frame)) return;

    switch (frame.t) {
      case 'message.new':
        messageControllerRef.applyIncoming(frame.d);
        return;
      case 'agent.joined':
        store.setState({ session: applyAgentJoined(store.getState().session, frame.d) });
        store.emit('agentJoined', frame.d);
        return;
      case 'agent.left':
        // frame.d.id (HandledBy) — the v2 wire contract renamed this from
        // `agentId`. See client/session.ts's applyAgentLeft and the T7 report.
        store.setState({ session: applyAgentLeft(store.getState().session, frame.d.id) });
        store.emit('agentLeft', frame.d);
        return;
      case 'session.closed': {
        // Read once, before setState: switchSession's reactivation flow can
        // pair THIS close (for the session just left) with a session.updated
        // for a DIFFERENT, already-current session (the one just switched
        // into) — see ChatClient.switchSession's doc, "The SWITCHED-close
        // pairing". `sessionClosed` (§6.5, state/events.ts) is documented to
        // describe "the session the client is already in", so it must fire
        // only when the closed session actually IS the one still current —
        // otherwise a customer who has already switched away would be told
        // their NEW chat just closed, when it was the abandoned old one,
        // elsewhere, that did. `applySessionClosed` already no-ops the STATE
        // write for a non-matching id (session.ts); this is the same guard
        // applied to the EVENT, which previously had none.
        const current = store.getState().session;
        const isCurrentSession = current !== null && current.id === frame.d.sessionId;

        store.setState({
          session: applySessionClosed(current, frame.d.sessionId, new Date((now ?? Date.now)()).toISOString()),
        });
        if (isCurrentSession) {
          store.emit('sessionClosed', { closeReason: frame.d.closeReason });
        }

        // A genuinely-ended session can never accept another frame, so its
        // undelivered sends are dead the moment it closes — and dangerous to
        // leave queued, since `message.send` carries no `sessionId` and the
        // next session to open would inherit them. Failing them here reports
        // each one through `sendFailed` with an accurate `'sessionClosed'`,
        // rather than leaving the queue to rediscover the same fact one
        // rejected frame at a time.
        //
        // `SWITCHED` is exempt: §12.5 parks that session rather than ending
        // it (`isParkedCloseReason`), and its queued sends are still live.
        //
        // Fire-and-forget with the rejection contained: a storage failure
        // here leaves the entries queued, where the ordinary pump will still
        // surface them as failed — never silently dropped — and an escaping
        // rejection would land on the host app's window.
        if (!isParkedCloseReason(frame.d.closeReason)) {
          void queue.abandonSession(frame.d.sessionId).catch(() => undefined);
        }
        return;
      }
      case 'ticket.linked':
        store.setState({ session: applyTicketLinked(store.getState().session, frame.d) });
        store.emit('ticketLinked', frame.d);
        return;
      case 'system.pong':
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------------
  // 6. Transport + connection controller. The factory assigns
  //    `realTransport` synchronously, from inside `new ConnectionController`
  //    below, so it is safely readable immediately afterward.
  // ---------------------------------------------------------------------
  const createTransport: TransportFactory = (handlers) => {
    realTransport = new WebSocketTransport({
      ...(config.webSocketFactory === undefined ? {} : { webSocket: config.webSocketFactory }),
      ...(now === undefined ? {} : { now }),
      ...(schedule === undefined ? {} : { schedule }),
      ...(transportLogger === undefined ? {} : { logger: transportLogger }),
      ...(config.protocolVersion === undefined ? {} : { protocolVersion: config.protocolVersion }),
      ...handlers,
    });
    return realTransport;
  };

  const connectionController = new ConnectionController({
    store,
    url: wsUrl,
    publishableKey,
    getToken: config.getToken,
    createTransport,
    onFrame: dispatchFrame,
    // onResumeGap is deliberately left unwired — see the T13 report. The
    // controller already emits the §6.5 `error` event for every gap
    // regardless (connection/controller.ts's `#reportResumeGap`); there is
    // no messages/ seam yet for "refetch history around a hole" to drive
    // automatically.
    ...(schedule === undefined ? {} : { schedule }),
  });

  // realTransport is assigned now — ConnectionController's constructor
  // called `createTransport` synchronously.

  const queueTransport: QueueTransport = {
    get isOpen(): boolean {
      return realTransport.isOpen;
    },
    // The queue's seam, deliberately NOT `WebSocketTransport.send(t, d)`:
    // replay must reuse the original ULID (D1, §9.3) so a server that
    // already persisted the frame dedupes rather than double-sending. The
    // third `replayId` argument is exactly what makes that true.
    sendWithId: (id, payload) => realTransport.send('message.send', payload, id).ack,
  };

  // ---------------------------------------------------------------------
  // 7. MessageController <-> SendQueue. See the file header, pattern 1 —
  //    explicit type annotations on both `const`s are load-bearing, not
  //    decoration: removing either reintroduces TS7022.
  // ---------------------------------------------------------------------
  let queueRestored: Promise<unknown> = Promise.resolve();

  const messageController: MessageController = new MessageController({
    store,
    enqueue: async (sessionId, payload) => {
      // A send attempted before the persisted queue has been read would
      // jump the FIFO order SendQueue.restore()'s own doc requires (§9.2) —
      // `createChatClient` is synchronous (§6.1), so restore is necessarily
      // still in flight for whatever a caller does in the same tick.
      await queueRestored;
      return queue.enqueue(sessionId, payload);
    },
    sender: resolveLocalSender,
    history: config.history,
    uploader: config.uploader ?? UNCONFIGURED_UPLOADER,
    ...(config.pageSize === undefined ? {} : { pageSize: config.pageSize }),
  });
  messageControllerRef = messageController;

  const queue: SendQueue = new SendQueue({
    storage: queueStorage,
    transport: queueTransport,
    onAck: messageController.onAck,
    onFailed: messageController.onFailed,
    ...(now === undefined ? {} : { now }),
    ...(config.queueRetention === undefined ? {} : { retention: config.queueRetention }),
  });

  // §15's acceptance criterion: a message sent while offline "survives a
  // simulated reload via the StorageAdapter". SendQueue.restore() reloads
  // the durable *entries*, but nothing re-applies them as optimistic
  // ChatMessages — messages/controller.ts's own doc says as much:
  // `QueuedSend` "is also the durable record of the optimistic message ...
  // a binding that reloads mid-send rebuilds what the user sees from these
  // entries". On a genuinely fresh process (a real reload, not just a
  // dropped socket) `ChatState.messages` starts empty, so without this a
  // restored entry's eventual ack/failure would find nothing to patch —
  // `MessageController#patch` returns false, the outcome is stashed in
  // `#settledEarly`, and `messageAck`/`sendFailed` never fires, because
  // `#settledEarly` exists for a narrow same-call race, not for surviving a
  // reload. Rehydrating here, before `flush()` can deliver anything, is what
  // makes the later real ack/failure land on an existing message instead.
  function rehydrateQueuedMessages(pending: readonly QueuedSend[]): void {
    if (pending.length === 0) return;

    // Queued sends are always outgoing, so the current localSender is the
    // right identity to rehydrate under — a page reload does not change who
    // the logged-in user is.
    const { senderId, senderType } = resolveLocalSender();

    let messages = store.getState().messages;
    for (const entry of pending) {
      const { payload } = entry;
      const message: ChatMessage = {
        id: entry.id,
        sessionId: entry.sessionId,
        senderId,
        senderType,
        type: payload.type,
        content: payload.content,
        createdAt: new Date(entry.enqueuedAt).toISOString(),
        delivery: { state: 'queued' },
        ...(payload.replyToMessageId === undefined ? {} : { replyToMessageId: payload.replyToMessageId }),
        ...(payload.attachment === undefined ? {} : { attachment: payload.attachment }),
        ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
      };
      messages = upsertMessage(messages, message);
    }
    store.setState({ messages });

    // Emitted after the batch is applied (not per-insert), so a listener
    // that reads `getState()` from inside the handler sees every rehydrated
    // message already in the list, matching how §6.5 describes `message` as
    // "applied to state" before it is announced.
    for (const entry of pending) {
      const rehydrated = messages.find((message) => message.id === entry.id);
      if (rehydrated !== undefined) store.emit('message', rehydrated);
    }
  }

  queueRestored = queue.restore().then(
    (report) => {
      rehydrateQueuedMessages(queue.pending());
      // restore() does not itself flush — if a connection raced ahead of
      // restore and is already live, nothing would otherwise drain what was
      // just recovered from disk until the next `connected`/`enqueue`.
      void queue.flush();
      return report;
    },
    (error: unknown) => {
      // SendQueue.restore()'s contract: a storage read fault propagates and
      // is "emphatically not treated as an empty queue". Surfaced as a
      // ChatError instead of an unhandled rejection, and re-thrown so a
      // `sendMessage()` call awaiting `queueRestored` still sees the
      // failure — a message typed before recovery must not silently render
      // as queued when it is not.
      const chatError: ChatError = {
        source: 'transport',
        code: null,
        message: 'failed to restore the offline send queue from storage',
        retryable: false,
      };
      store.setState({ lastError: chatError });
      store.emit('error', chatError);
      throw error;
    },
  );

  // §8.4: the queue flushes in FIFO order on reconnect. `connected` fires
  // symmetrically on fresh connect and reconnect alike (§12.3), so this one
  // subscription covers both.
  store.on('connected', () => {
    void queue.flush();
  });

  // presence.ts's `reset()` doc: "Called on disconnect: presence learned
  // over a socket that is now gone is not evidence of anything." Nothing in
  // connection/ calls it — `disconnected` only fires for a transport-caused
  // drop (`#handleClose` discards `cause: 'local'` before emitting it), so
  // an explicit `client.disconnect()` additionally calls `reset()` directly
  // below.
  store.on('disconnected', () => {
    presenceCoordinator.reset();
  });

  /**
   * Reports a `sessionActions` failure that the server nonetheless ACTED on.
   *
   * `reopenSession`/`closeSession` return the full `ChatSession` that replaces
   * `ChatState.session`. An adapter may need more than one round trip to
   * produce it (the REST one does: a mutating POST, then a read of the full
   * session), which opens a window where the change has already been applied
   * but the value describing it never arrived. The promise rejects, so
   * `setState` below never runs — and `ChatState.session` then describes a
   * session that no longer exists in that form, with nothing in the state
   * saying so.
   *
   * Core cannot repair that: it does not know the new status, and for a reopen
   * it does not even know which session the server settled on. What it can do
   * is refuse to let the staleness be silent, which is what this does.
   *
   * The condition is recognized STRUCTURALLY, by a `sessionMutationApplied`
   * flag on the error, because `SessionActions` is a seam core does not
   * implement — see its documentation in ./types.ts. Any adapter can raise it;
   * core imports nothing to check for it.
   *
   * The error is re-thrown by the caller regardless. This only adds the
   * `lastError`/`error` signal, exactly as the queue-restore fault above does.
   */
  function reportIfSessionChangedAnyway(error: unknown): void {
    const applied =
      typeof error === 'object' &&
      error !== null &&
      (error as { sessionMutationApplied?: unknown }).sessionMutationApplied === true;
    if (!applied) return;

    // Fixed text, never the adapter's: its message can carry a signed URL (§14).
    const chatError: ChatError = {
      source: 'transport',
      code: null,
      message: 'the session changed, but the updated session could not be read back',
      retryable: true,
    };
    store.setState({ lastError: chatError });
    store.emit('error', chatError);
  }

  /**
   * Sends `session.join` and reports a REJECTED ack through
   * `lastError`/`error` (§6.4) — the one path both `ChatClient.joinSession`
   * and `ChatClient.switchSession` go through, so the two public names can
   * never behave differently by accident. See `switchSession`'s doc
   * (client/types.ts) for why they are one operation under two names rather
   * than two independent ones.
   *
   * A successful join is deliberately NOT awaited or reported here — it is
   * observed the normal way, through the `session.updated`/`connection.ack`
   * snapshot `dispatchFrame` above already applies to `ChatState.session`.
   * Previously (pre-T10) `joinSession` discarded `realTransport.send`'s
   * returned ack outright, so a join the server's ownership check refused
   * (v2/handlers.ts) vanished with no signal at all — this is what closes
   * that gap, using the exact same `toChatError` conversion every other
   * protocol-level failure in this file already goes through.
   */
  function joinSessionFrame(sessionId: string): void {
    const { ack } = realTransport.send('session.join', { sessionId });
    void ack.then((outcome) => {
      if (outcome.status !== 'rejected') return;
      const chatError = toChatError(outcome.error);
      store.setState({ lastError: chatError });
      store.emit('error', chatError);
    });
  }

  // ---------------------------------------------------------------------
  // 8. The public surface.
  // ---------------------------------------------------------------------
  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    on: (event, handler) => store.on(event, handler),

    connect: () => connectionController.connect(),
    disconnect: () => {
      connectionController.disconnect();
      presenceCoordinator.reset();
    },
    startNewSession: async (): Promise<void> => {
      // Order is load-bearing throughout; see each step.
      const closing = store.getState().session?.id;

      // 1. The old session's undelivered sends, before anything reopens a
      //    socket. `message.send` carries no `sessionId` (protocol/frames.ts),
      //    so any entry still queued when the new session opens would be
      //    attributed to *it* — the customer's unsent question about a
      //    resolved order landing in a brand-new ticket. They are failed, not
      //    deleted, so the binding can show them as dead and re-sendable.
      if (closing !== undefined) await queue.abandonSession(closing);

      // 2. Close the socket before forgetting the anchor, so no in-flight
      //    frame can advance it again between the reset and the reconnect.
      connectionController.disconnect();
      presenceCoordinator.reset();

      // 3. The anchor. Without this the next `connection.hello` carries a
      //    `resumeFrom` from a history this client no longer holds, and the
      //    v2 endpoint answers it with a NON-RETRYABLE `VALIDATION_FAILED`
      //    ("resumeFrom is ahead of this session") — stranding the client in
      //    `suspended` instead of the new session it asked for. This is the
      //    single reason `disconnect()` + `connect()` is not already a
      //    working "start over".
      connectionController.forgetResumeAnchor();

      // 4. Every per-session projection, in one write so no subscriber ever
      //    observes the new session's id against the old one's transcript.
      //    `pastSessions` is deliberately kept — it is a list *about* other
      //    sessions, not state *of* this one.
      store.setState({
        session: null,
        messages: [],
        typing: { isTyping: false },
        unreadCount: 0,
        pagination: { hasMore: false, loadingMore: false },
        uploading: false,
        // Keyed by participantId, not by session, which is exactly why they
        // have to go explicitly: the same agent picking up the new
        // conversation would otherwise arrive with a read watermark earned in
        // the old one, marking messages read that they have never seen.
        readWatermarks: {},
        deliveredWatermarks: {},
        presence: {},
        lastError: null,
      });

      // 5. A hello with no `resumeFrom` reads as a first connection, which is
      //    what makes the server mint a new session (WAITING_FOR_AGENT, seq
      //    0) rather than resume the closed one. Resolves on `connection.ack`,
      //    so awaiting this means the new session is in state.
      await connectionController.connect();
    },
    joinSession: (sessionId) => {
      joinSessionFrame(sessionId);
    },
    switchSession: (sessionId) => {
      joinSessionFrame(sessionId);
    },
    leaveSession: () => {
      realTransport.send('session.leave', {});
    },
    requestAgent: (reason) => {
      realTransport.send('session.requestAgent', reason === undefined ? {} : { reason });
    },
    reopenSession: async (sessionId): Promise<ChatSession> => {
      if (config.sessionActions === undefined) {
        throw new ChatClientConfigError(
          'reopenSession() requires config.sessionActions to be supplied to createChatClient().',
        );
      }
      let session: ChatSession;
      try {
        session = await config.sessionActions.reopenSession(sessionId);
      } catch (error) {
        reportIfSessionChangedAnyway(error);
        throw error;
      }
      store.setState({ session });
      return session;
    },
    closeSession: async (): Promise<void> => {
      if (config.sessionActions === undefined) {
        throw new ChatClientConfigError(
          'closeSession() requires config.sessionActions to be supplied to createChatClient().',
        );
      }
      const sessionId = store.getState().session?.id;
      if (sessionId === undefined) {
        throw new ChatClientConfigError('closeSession() requires an active session.');
      }
      let session: ChatSession;
      try {
        session = await config.sessionActions.closeSession(sessionId);
      } catch (error) {
        reportIfSessionChangedAnyway(error);
        throw error;
      }
      store.setState({ session });
    },
    listSessions: async (query): Promise<readonly ChatSessionSummary[]> => {
      if (config.sessionSummarySource === undefined) {
        throw new ChatClientConfigError(
          'listSessions() requires config.sessionSummarySource to be supplied to createChatClient().',
        );
      }
      const sessions = await config.sessionSummarySource.listSessions(query);
      // Wholesale replace (§9.4-style), not a merge — this IS the whole
      // customer's recent-session list as of this call, same as a
      // session.updated snapshot replaces ChatState.session outright.
      store.setState({ pastSessions: [...sessions] });
      return sessions;
    },

    sendMessage: (content, opts) => messageController.sendMessage(content, opts),
    sendAttachment: (file, opts) => {
      // Checked here, explicitly, rather than relying on UNCONFIGURED_UPLOADER
      // alone: MessageController#sendAttachment deliberately does not reject
      // on an upload failure — it reports through `lastError`/the `error`
      // event instead (§6.4), with a fixed, generic message ("attachment
      // upload failed") that never distinguishes "no uploader configured"
      // (a construction-time mistake) from a genuine runtime failure. A
      // config mistake deserves a loud, distinct rejection; a real upload
      // failure keeps the module's own designed behavior unchanged.
      if (config.uploader === undefined) {
        return Promise.reject(
          new ChatClientConfigError(
            'sendAttachment() requires config.uploader (an AttachmentUploader) to be supplied to createChatClient().',
          ),
        );
      }
      return messageController.sendAttachment(file, opts);
    },
    retryMessage: async (id): Promise<RetryOutcome> => {
      // A send attempted before restore has been read would race
      // SendQueue.retry()'s own restored-guard (QueueNotRestoredError) —
      // same reasoning as #send's `await queueRestored` above.
      await queueRestored;

      // The one hazard SendQueue.retry() (T9) cannot see, because it has no
      // notion of "the current session": `message.send` carries no
      // `sessionId` on the wire, so replaying a failed entry's ORIGINAL
      // payload while a DIFFERENT session is now joined would silently
      // attribute it to whatever session IS current — the exact
      // misattribution `abandonSession` already guards against on the
      // reconnect/switch path (see SendFailureReason.sessionClosed's doc:
      // "a retry is NOT futile ... [but] must never be delivered as-is").
      // Checked for every failure reason, not only `sessionClosed`: the
      // wire-level hazard is the same regardless of why the send originally
      // died, and "retry" only ever means "try the same thing again, into
      // the same conversation" — a caller that wants this content in a NEW
      // session should send it fresh, not retry a dead entry into one.
      const failure = queue.failed().find((candidate) => candidate.entry.id === id);
      if (failure !== undefined && failure.entry.sessionId !== store.getState().session?.id) {
        return { status: 'refused', reason: 'not-retryable' };
      }

      const outcome = await queue.retry(id);

      if (outcome.status === 'retried') {
        // Back to `queued` immediately, so the UI drops the dead bubble's
        // Retry affordance the instant the retry is durably re-queued,
        // rather than waiting on the eventual ack/failure to patch it —
        // mirrors rehydrateQueuedMessages' reasoning above. The eventual
        // outcome still arrives the normal way: this `queue` is the same
        // instance wired to messageController.onAck/onFailed, so nothing
        // extra needs wiring here for that half.
        const messages = store.getState().messages;
        const existing = messages.find((message) => message.id === id);
        if (existing !== undefined) {
          store.setState({
            messages: upsertMessage(messages, { ...existing, delivery: { state: 'queued' } }),
          });
        }
      }

      return outcome;
    },
    markRead: () => {
      presenceCoordinator.watermarks.markRead();
    },
    startTyping: () => {
      presenceCoordinator.typing.startTyping();
    },
    stopTyping: () => {
      presenceCoordinator.typing.stopTyping();
    },
    // §6.3 names this `loadOlderMessages`; messages/controller.ts spells it
    // `loadMore` — this is the one place the public name is chosen.
    //
    // Cold-start decision: `ChatState.pagination.hasMore` starts `false`
    // (§6.4's initial state), which would make a cold start unable to fetch
    // its first page — EXCEPT `MessageController.loadMore` already special-
    // cases it: its guard is `!hasMore && messages.length > 0`, so an empty
    // list bypasses the `hasMore` check on the very first call. That is the
    // deliberate choice this client relies on, over the alternative of
    // seeding `hasMore`/an initial page from `GET /sessions/{id}/full` on
    // connect: no `ChatClientConfig` seam for a "full session" REST fetch
    // exists (only `MessageHistorySource`, which already IS the paginated
    // history endpoint), and adding one would put a second REST round trip
    // inside `connect()`, contradicting §14's "connect() -> connected should
    // complete within one network round trip plus token-fetch latency ...
    // no artificial delays." A binding calls `loadOlderMessages()` once on
    // mount to populate history, exactly as it would for every subsequent
    // page — no special first-call behavior for it to know about.
    loadOlderMessages: () => messageController.loadMore(),

    setPresence: (status) => {
      presenceCoordinator.presence.setPresence(status);
    },
    queryPresence: (participantIds) => {
      presenceCoordinator.presence.queryPresence(participantIds);
    },
  };
}
