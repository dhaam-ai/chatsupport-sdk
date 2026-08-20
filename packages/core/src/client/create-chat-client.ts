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
import { PresenceCoordinator, systemTimers } from '../presence/index.js';
import type { ScheduleTimer } from '../presence/index.js';
import { isParkedCloseReason } from '../protocol/index.js';
import type { ChatStatus, ErrorPayload, ServerFrame } from '../protocol/index.js';
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
import { ChatClientConfigError, SessionSwitchError } from './types.js';
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

/**
 * Storage key, under the same namespace as the send queue, holding the id of
 * the session the user actually chose.
 *
 * The SDK needs this because the protocol does not carry it:
 * `ConnectionHelloPayload` has no `sessionId` field (protocol/frames.ts), so
 * on every fresh connection the server re-resolves the customer's session on
 * its own — most recently updated, ACTIVE only. A session picked out of a
 * picker is usually CLOSED or RESOLVED, so it is not a candidate, and the
 * server hands back a different conversation entirely. That is the whole of
 * "reload the app and it does not load the messages of the session we spoke
 * in": nothing was wrong with the transcript, the client was silently put
 * back into another session.
 *
 * Persisting client-side rather than adding `sessionId` to the hello payload
 * is deliberate: it needs no wire change and no backend deploy, and a client
 * that re-joins explicitly is also correct against a server that has not been
 * updated.
 */
const SELECTED_SESSION_KEY = 'selectedSession';

/**
 * How long a switch waits for the `session.updated` push that follows the
 * join ack before giving up.
 *
 * Bounded because the ack cannot stand in for it: `session.join`'s ack is
 * `EmptyAckData` (protocol/frames.ts) and proves only that the server
 * accepted the frame. Unbounded, a server that acked and then never pushed
 * would leave `switchSession()` pending forever and a picker spinning with no
 * way to report anything.
 */
const SESSION_SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * Statuses a conversation cannot be continued from.
 *
 * Only ever read to decide what to PERSIST as the session to come back to
 * (see `rememberEstablishedSession`) — never to gate rendering, joining, or
 * sending, all of which stay legal against a finished session. `ON_HOLD` is
 * deliberately absent: it is paused, not over.
 */
const TERMINAL_SESSION_STATUSES: readonly ChatStatus[] = ['CLOSED', 'RESOLVED'];

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
      // Same session only. §6.5 defines `statusChange` as "the session you are
      // in changed status"; a snapshot for a DIFFERENT session — the one a
      // switch just landed on — is a different chat, not a change, and firing
      // here would tell a customer who just opened a resolved conversation
      // that their chat was "just closed".
      if (previous !== null && previous.id === next.id && statusOrModeChanged(previous, next)) {
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
          // A genuinely-ended session must not be what the next reload
          // re-joins: the customer would come back to a dead conversation
          // instead of the one the server would have given them. `SWITCHED`
          // is exempt for the same reason its queued sends are — §12.5 parks
          // that session rather than ending it.
          void forgetSelectedSession(frame.d.sessionId);
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
    // The SAME counter `performSwitch`'s `stale()` checks read — a history
    // read that resolves after a switch began is stale for exactly the reason
    // a switch step is, and must not learn it a second, divergent way. See
    // `MessageControllerOptions.generation`.
    generation: () => switchEpoch,
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
      // Through the funnel, not `queue.flush()` directly: this path is
      // reachable mid-connection, which is precisely when the session the
      // entries would be delivered into is still being decided.
      void flushQueue();
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

  // §8.4's "the queue flushes in FIFO order on reconnect" is wired at the
  // BOTTOM of this file, in the one `connected` subscription that also
  // restores the customer's session — see `flushQueue`. It deliberately does
  // not have a subscription of its own here: `connected` handlers run in
  // registration order, so a flush registered at this point would run BEFORE
  // the session restore and deliver into whichever session the server
  // happened to resolve.

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
   * `lastError`/`error` (§6.4) — the fire-and-forget form, backing the raw
   * `ChatClient.joinSession`.
   *
   * `switchSession` deliberately does NOT go through here any more. It needs
   * to settle on the ack rather than glance at it, and it needs every other
   * non-`acked` outcome too (a `disconnected` send writes nothing at all),
   * so it uses `joinSessionAwaited` below. The two are no longer one
   * operation under two names: `joinSession` is the protocol frame,
   * `switchSession` is the session replacement built on top of it. See
   * `ChatClient.switchSession`'s doc for the full contract.
   *
   * A successful join is not reported here — it is observed the normal way,
   * through the `session.updated`/`connection.ack` snapshot `dispatchFrame`
   * above already applies to `ChatState.session`. Previously (pre-T10)
   * `joinSession` discarded `realTransport.send`'s returned ack outright, so
   * a join the server's ownership check refused (v2/handlers.ts) vanished
   * with no signal at all — this is what closes that gap.
   */
  function joinSessionFrame(sessionId: string): void {
    const { ack } = realTransport.send('session.join', { sessionId });
    void ack.then((outcome) => {
      if (outcome.status !== 'rejected') return;
      reportChatError(toChatError(outcome.error));
    });
  }

  /** Writes `error` to `lastError` and emits it — the one §6.4 reporting path. */
  function reportChatError(error: ChatError): ChatError {
    store.setState({ lastError: error });
    store.emit('error', error);
    return error;
  }

  // ---------------------------------------------------------------------
  // 7b. Session replacement — the machinery behind switchSession() and the
  //     reload path. See ChatClient.switchSession's doc for the contract.
  // ---------------------------------------------------------------------

  const scheduleTimer: ScheduleTimer = schedule ?? systemTimers;

  /**
   * Which switch is the current one.
   *
   * Two picker clicks in quick succession start two switches over one socket,
   * and both will eventually get their ack and their page. Without this the
   * loser's page is prepended into the winner's transcript — `prependPage`
   * cannot catch that, it dedupes by id and two sessions never share ids.
   * Every step that writes to state re-checks its own epoch, so a superseded
   * switch stops at the first checkpoint it reaches instead of racing.
   */
  let switchEpoch = 0;

  /**
   * Resolves once the session this connection will actually be in has been
   * decided — i.e. once `restoreSelectionAndSeed` has finished re-joining the
   * customer's remembered session, or established that there is nothing to
   * re-join.
   *
   * `message.send` carries no `sessionId` on the wire (protocol/frames.ts):
   * the server files a send under whichever session `session.join` last set.
   * So a queued send is not addressed to a conversation until the moment it
   * is flushed, and flushing it before the restore has run delivers the
   * customer's unsent question into whichever session the server's own
   * active-session resolution happened to pick. `performSwitch`'s
   * `queue.abandonSession(previous)` cannot undo that — by then the send has
   * left, filed under a conversation nobody will look at again.
   *
   * Starts resolved: with no connection there is no session to get wrong, and
   * a flush against a closed socket is a no-op anyway.
   */
  let selectionRestored: Promise<void> = Promise.resolve();
  let releaseQueueFlush: () => void = () => undefined;

  /**
   * The ONE place `queue.flush()` is called from. Nothing in this file may
   * call `queue.flush()` directly — the ordering above is the whole point,
   * and a second call site is how it gets reintroduced.
   */
  async function flushQueue(): Promise<void> {
    await selectionRestored;
    await queue.flush();
  }

  /**
   * Every projection of "the session I am in", cleared in ONE write.
   *
   * One `setState` rather than several, for the same reason `startNewSession`
   * does it that way: `ChatStore` notifies per batch but `getState()` is
   * read synchronously by anything reacting to an event, so a split write
   * leaves a window in which the new session's id is readable against the old
   * session's transcript. `session` itself is NOT touched here — see
   * `performSwitch` for why nulling it would be actively harmful.
   *
   * `pastSessions` is deliberately preserved: it is a list *about* other
   * sessions, not state *of* this one.
   */
  function resetPerSessionState(): void {
    store.setState({
      messages: [],
      typing: { isTyping: false },
      unreadCount: 0,
      pagination: { hasMore: false, loadingMore: false, initialLoaded: false },
      uploading: false,
      // Keyed by participantId, not by session, which is exactly why they
      // have to go explicitly: the same agent picking up the other
      // conversation would otherwise arrive with a read watermark earned in
      // this one, marking messages read that they have never seen.
      readWatermarks: {},
      deliveredWatermarks: {},
      presence: {},
      lastError: null,
    });
  }

  /** Reads the persisted selected-session id. A storage fault reads as "none". */
  async function readSelectedSession(): Promise<string | null> {
    try {
      const value = await queueStorage.get(SELECTED_SESSION_KEY);
      return value === null || value === '' ? null : value;
    } catch {
      // Never fatal: not knowing which session was chosen is exactly the
      // pre-fix behaviour, so falling back to the server's choice is strictly
      // no worse than not having persisted at all.
      return null;
    }
  }

  /** Records the session the user is in, so a reload comes back to it. */
  async function rememberSelectedSession(sessionId: string): Promise<void> {
    try {
      await queueStorage.set(SELECTED_SESSION_KEY, sessionId);
    } catch {
      // A failed write costs the reload behaviour, nothing else. It must not
      // fail a switch that has already succeeded on the wire.
    }
  }

  /**
   * Records the session this connection actually established, for a customer
   * who never picked one — the ordinary path, and the one bug 2's first fix
   * left out.
   *
   * Without this, only an explicit `switchSession`/`startNewSession` ever
   * persisted anything, so "come back to the conversation I was in" worked
   * only after an explicit pick. A customer who simply chats in the session
   * the server handed them had nothing stored, and once that session went
   * CLOSED/RESOLVED the next connection's server-side resolution — most
   * recently updated, ACTIVE only — landed them somewhere else entirely.
   *
   * **A session that is already finished is not recorded.** That is the
   * deliberate resolution of the two hazards pulling against each other here:
   *
   *   - Recording it would override the server's own active-session
   *     resolution on the next connection with a conversation that cannot be
   *     continued — pinning the customer to a dead chat is strictly worse
   *     than the resolution this was meant to improve on, because the server
   *     at least only ever resolves live sessions.
   *   - Not recording it costs nothing: the client is in that session for as
   *     long as this connection lasts, and with nothing stored the next
   *     connection simply falls back to the server's answer, which is the
   *     pre-fix behaviour.
   *
   * An EXPLICIT pick is the opposite case and keeps its own rule: a customer
   * who opens a resolved conversation out of a picker meant it, so
   * `performSwitch` records it whatever its status. The implicit record here
   * only ever says "keep me where I already am".
   *
   * A recording made while the session was live still stands after it closes,
   * until either the `session.closed` push clears it (`dispatchFrame`) or the
   * server refuses the re-join (`restoreSelectionAndSeed`). Both of those are
   * evidence; a status read at connect time is the only evidence available
   * here, and it is used.
   */
  async function rememberEstablishedSession(): Promise<void> {
    const session = store.getState().session;
    if (session === null) return;
    if (TERMINAL_SESSION_STATUSES.includes(session.status)) return;
    await rememberSelectedSession(session.id);
  }

  /**
   * Forgets the persisted selection, optionally only if it still names
   * `sessionId` — so a stale close for a session already switched away from
   * cannot clear the selection the customer just made.
   */
  async function forgetSelectedSession(sessionId?: string): Promise<void> {
    try {
      if (sessionId !== undefined && (await readSelectedSession()) !== sessionId) return;
      await queueStorage.remove(SELECTED_SESSION_KEY);
    } catch {
      // Same reasoning as rememberSelectedSession.
    }
  }

  /**
   * Sends `session.join` and settles on the ack, rather than dropping it.
   *
   * Every non-`acked` outcome is a real failure a caller can act on, and all
   * three were previously silent:
   *
   *   - `rejected` — the server's ownership check refused the session;
   *   - `disconnected` — `WebSocketTransport.send` resolves this WITHOUT
   *     writing anything when the socket is closed (transport/transport.ts),
   *     so the join simply never happened;
   *   - `timeout` — acked by nobody within the transport's own window.
   *
   * All of them are reported through `lastError`/`error` (§6.4) *and* thrown,
   * so a picker awaiting the switch and a subscriber watching state are told
   * the same thing.
   */
  async function joinSessionAwaited(sessionId: string): Promise<void> {
    const { ack } = realTransport.send('session.join', { sessionId });
    const outcome = await ack;
    if (outcome.status === 'acked') return;

    const error =
      outcome.status === 'rejected'
        ? toChatError(outcome.error)
        : ({
            source: 'transport',
            code: null,
            message:
              outcome.status === 'disconnected'
                ? 'session.join was not sent: the socket is not open'
                : 'session.join was not acknowledged in time',
            retryable: true,
          } satisfies ChatError);

    throw new SessionSwitchError(sessionId, reportChatError(error));
  }

  /**
   * Waits until `predicate()` holds, or the deadline passes.
   *
   * Subscription-based rather than a poll, and re-checked up front, because
   * the state it is waiting on may already have been written by the time this
   * is called — a server that pushes `session.updated` before its own ack is
   * flushed is entirely legal.
   */
  function awaitState(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;

      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        cancelTimer();
        unsubscribe?.();
        resolve(value);
      };

      const cancelTimer = scheduleTimer(() => {
        finish(false);
      }, timeoutMs);

      unsubscribe = store.subscribe(() => {
        if (predicate()) finish(true);
      });

      // The predicate may have flipped between the check above and the
      // subscription being registered.
      if (predicate()) finish(true);
    });
  }

  /**
   * The whole session-replacement sequence. `switchSession` is this, and so
   * is the reload path's re-join.
   *
   * Ordering is load-bearing at every step; see the inline notes.
   */
  async function performSwitch(sessionId: string): Promise<void> {
    const previous = store.getState().session?.id;
    if (previous === sessionId) return;

    const epoch = (switchEpoch += 1);
    const stale = (): boolean => epoch !== switchEpoch;

    // 1. Before the join lands on the wire. `message.send` carries no
    //    sessionId (protocol/frames.ts) and the server attributes it to
    //    whatever session `session.join` last set, so an entry still queued
    //    for the outgoing session would be delivered into the incoming one —
    //    the customer's unsent question about a resolved order appearing in
    //    the conversation they just opened. They are failed, not deleted, so
    //    the app can show them as dead and re-sendable.
    //
    //    `queueRestored` first, for the same reason `#send` and
    //    `retryMessage` await it: on the reload path this runs while
    //    `SendQueue.restore()` is still in flight, and abandoning an empty
    //    in-memory queue would let restore() put the old session's entries
    //    back moments later — straight into the session just joined.
    await queueRestored.catch(() => undefined);
    if (stale()) return;
    if (previous !== undefined) await queue.abandonSession(previous);
    if (stale()) return;

    // 2. Typing timers and presence describe a conversation that is no longer
    //    on screen.
    presenceCoordinator.reset();

    // 3. The anchor is a position in a per-session history and can only ever
    //    advance (connection/resume.ts). Carried across, the next
    //    `connection.hello` asks to resume from a `seq` this session has
    //    never reached, and the v2 endpoint answers NON-RETRYABLY with
    //    VALIDATION_FAILED — stranding the client in `suspended`.
    connectionController.forgetResumeAnchor();

    // 4. One atomic write, so nothing can read the new id against the old
    //    transcript. This is also what re-arms `loadMore`: its guard reads
    //    `pagination.initialLoaded`, which this clears — without it the seed
    //    in step 7 no-ops and the switch is invisible, which is bug 1.
    resetPerSessionState();

    try {
      // 5. Join, and await the ack so a refusal is surfaced rather than
      //    dropped. `session` is deliberately NOT nulled first: a concurrent
      //    `sendMessage`/`loadOlderMessages` would then throw
      //    NoActiveSessionError, and a binding's header would blank
      //    mid-switch. The epoch checks make nulling unnecessary anyway.
      await joinSessionAwaited(sessionId);
      if (stale()) return;

      // 6. The ack is `EmptyAckData` — `{ ok: true }` with no payload — so it
      //    does NOT mean `ChatState.session` has moved. The snapshot arrives
      //    as a separate `session.updated` push the server volunteers after
      //    it (v2/handlers.ts acks, loads the snapshot, then pushes).
      const arrived = await awaitState(
        () => store.getState().session?.id === sessionId || stale(),
        SESSION_SNAPSHOT_TIMEOUT_MS,
      );
      if (stale()) return;
      if (!arrived) {
        throw new SessionSwitchError(
          sessionId,
          reportChatError({
            source: 'transport',
            code: null,
            message: 'the session was joined but its snapshot never arrived',
            retryable: true,
          }),
        );
      }

      // 7. Explicitly by id, never via `ChatState.session`: page one must be
      //    this session's even if another frame moved `session` in between.
      await messageController.loadMore(sessionId);
      if (stale()) return;
    } catch (error) {
      // The reset in step 4 already happened — it has to, because the
      // snapshot for the new session can land in the same tick as the ack and
      // a later reset would be readable as "new id, old transcript". So a
      // switch that fails after it would otherwise leave the customer staring
      // at a blank pane for the session they are still in. Put it back.
      if (!stale()) await restoreTranscript(previous);
      throw error;
    }

    await rememberSelectedSession(sessionId);
  }

  /**
   * Re-reads page one for `sessionId`, used to undo a failed switch's reset.
   *
   * Never rejects and never clears `lastError`: the failure that caused the
   * rollback is the one the app should still be reporting.
   */
  async function restoreTranscript(sessionId: string | undefined): Promise<void> {
    if (sessionId === undefined) return;
    if (store.getState().session?.id !== sessionId) return;
    await messageController.loadMore(sessionId).catch(() => undefined);
  }

  /**
   * On every `connected`, put the client back into the session the customer
   * actually chose, then make sure its first page is on screen.
   *
   * Both halves belong here rather than in a binding. Every binding needs
   * them, none of them can do the reset half (`ChatStore` exposes no
   * `setState`), and the widget's version — a once-ever latch on the
   * connection-state transition — could not re-arm for a switch and could not
   * survive a reconnect either.
   */
  async function restoreSelectionAndSeed(): Promise<void> {
    /** Whether a stored selection is still the one being honoured. */
    let honouringSelection = false;

    try {
      const selected = await readSelectedSession();
      honouringSelection = selected !== null;
      const current = store.getState().session?.id;

      if (selected !== null && current !== undefined && selected !== current) {
        try {
          await performSwitch(selected);
          return;
        } catch (error) {
          // Already reported through lastError/error. The session the ack gave
          // us is still there, so fall through and seed THAT rather than
          // leaving the customer with a blank screen.
          //
          // Only a REJECTED join forgets the selection: that is the server
          // saying this session is not available to this customer, and
          // retrying it on every reconnect would be a permanent loop. A
          // transport failure — the socket dropped mid-restore — says nothing
          // about the session, and erasing the customer's choice over a flaky
          // network would turn a momentary blip into a lost conversation.
          //
          // Either way the selection is no longer being honoured, so nothing
          // below may quietly record the fallback session in its place: the
          // customer's choice is REPLACED only by another choice, never by
          // whichever conversation a failed restore happened to leave us in.
          // A refusal has already erased it, so the next ordinary connect
          // records what the server resolves — one connection later, and
          // deliberately.
          if (error instanceof SessionSwitchError && error.cause.source === 'protocol') {
            await forgetSelectedSession(selected);
          }
        }
      }
    } finally {
      // The session is decided: either `performSwitch` re-joined the
      // remembered one, or this connection stays in the one the server
      // resolved. Queued sends can be addressed now, and not one moment
      // earlier — see `selectionRestored`. In a `finally` so that no failure
      // path can strand the queue behind a gate that never opens.
      releaseQueueFlush();
    }

    // `initialLoaded` — not `messages.length` — is what makes this safe to run
    // on every reconnect: it will not re-request page one under a user who
    // has already scrolled back, and it is not fooled by a list that is
    // non-empty because the offline queue was rehydrated from storage.
    if (!store.getState().pagination.initialLoaded) {
      await messageController.loadMore().catch(() => undefined);
    }

    // Bug 2's other half: with no pick anywhere, the session this connection
    // established is still the one to come back to. See
    // `rememberEstablishedSession` for why a finished session is not.
    if (!honouringSelection) await rememberEstablishedSession();
  }

  // Ordering inside `connection.ack` is already correct and needs no change:
  // ConnectionController applies the session snapshot and the replay BEFORE
  // moving the machine to `connected` (connection/controller.ts), so
  // `ChatState.session` is populated by the time this runs.
  //
  // This is also the file's ONLY `connected` subscription, which is what
  // makes the restore-before-flush ordering structural rather than a matter
  // of which `store.on('connected')` call happens to appear first: the gate is
  // armed synchronously here, before anything can await it, and `flushQueue`
  // is the only way to reach `queue.flush()`.
  store.on('connected', () => {
    selectionRestored = new Promise<void>((resolve) => {
      releaseQueueFlush = resolve;
    });
    void restoreSelectionAndSeed();
    void flushQueue();
  });

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
      //    Shared verbatim with `switchSession`; the extra `session: null`
      //    belongs to this path alone, because here there is genuinely no
      //    session until the server mints one.
      store.setState({ session: null });
      resetPerSessionState();

      // 5. Any remembered selection must go BEFORE the connect, not after:
      //    the `connected` handler reads it, and a leftover id would send
      //    this client straight back into the conversation it was just told
      //    to abandon. Also bumps the epoch, so an in-flight switch cannot
      //    write its page into the brand-new session.
      switchEpoch += 1;
      await forgetSelectedSession();

      // 6. A hello with no `resumeFrom` reads as a first connection, which is
      //    what makes the server mint a new session (WAITING_FOR_AGENT, seq
      //    0) rather than resume the closed one. Resolves on `connection.ack`,
      //    so awaiting this means the new session is in state.
      await connectionController.connect();

      // 7. And now the new session's id is known, so a reload comes back to
      //    the conversation just opened rather than to whichever one the
      //    server would pick on its own.
      const opened = store.getState().session?.id;
      if (opened !== undefined) await rememberSelectedSession(opened);
    },
    joinSession: (sessionId) => {
      joinSessionFrame(sessionId);
    },
    switchSession: (sessionId) => performSwitch(sessionId),
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
    // Cold start is no longer a binding's job: core seeds page one itself on
    // every `connected` (see `restoreSelectionAndSeed`), guarded by
    // `pagination.initialLoaded` so a reconnect cannot re-request it under a
    // user who has scrolled back. Calling this on mount anyway is harmless —
    // the same guard makes the second call a no-op — but a binding that never
    // calls it now still gets a transcript, which is what react/vue/angular
    // were missing. The seam is still `MessageHistorySource` alone: no "full
    // session" REST fetch was added to `connect()`, so §14's "one network
    // round trip plus token-fetch latency" is unchanged.
    loadOlderMessages: () => messageController.loadMore(),

    setPresence: (status) => {
      presenceCoordinator.presence.setPresence(status);
    },
    queryPresence: (participantIds) => {
      presenceCoordinator.presence.queryPresence(participantIds);
    },
  };
}
