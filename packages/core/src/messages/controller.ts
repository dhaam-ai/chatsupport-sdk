// Message operations — PRD §6.3, §6.4 (state), §6.5 (events), §9 (ordering,
// dedup, delivery).
//
// This is the layer a binding actually calls. It owns three of §6.5's events
// and nothing else owns them: `message`, `messageAck`, and `sendFailed`. The
// send queue deliberately takes no `ChatStore` for exactly this reason — two
// modules emitting the same event would double-fire it — so its `onAck` and
// `onFailed` callbacks are wired to the handlers below.
//
// What this module does NOT do: it does not queue, retry, persist, open
// sockets, validate frames, or decide when to reconnect. Those belong to
// queue/, transport/, protocol/, and connection/ respectively.

import type {
  AttachmentMetadata,
  ErrorCode,
  MessagePayload,
  MessageSendPayload,
  MessageType,
} from '../protocol/index.js';
import { isErrorCode } from '../protocol/index.js';
import type { FailedSend, QueuedSend } from '../queue/index.js';
import type { ChatError, ChatMessage, ChatStore } from '../state/index.js';
import type { SendFailureReason } from '../state/types.js';
import { prependPage, upsertMessage } from './list.js';
import { DEFAULT_PAGE_SIZE, NoActiveSessionError } from './types.js';
import type {
  AttachmentUploader,
  EnqueueSend,
  LocalSender,
  MessageHistorySource,
  SendAttachmentOptions,
  SendMessageOptions,
} from './types.js';

export interface MessageControllerOptions {
  readonly store: ChatStore;

  /** Durable queueing (§9.1). See {@link EnqueueSend} for why this is a function. */
  readonly enqueue: EnqueueSend;

  /** Resolves who this client sends as, at the moment of the send. */
  readonly sender: () => LocalSender;

  /** Backward-cursor history reads (§6.3, §12.10). */
  readonly history: MessageHistorySource;

  /** Step one of the upload-then-announce attachment flow (§6.3, §12.10). */
  readonly uploader: AttachmentUploader;

  /** Defaults to {@link DEFAULT_PAGE_SIZE}. */
  readonly pageSize?: number;
}

/**
 * How a send finished, when it finished before its optimistic message was in
 * the list. See `#settledEarly` for why that ordering is reachable.
 */
type SendOutcome =
  | { readonly kind: 'acked'; readonly seq: number | undefined }
  | {
      readonly kind: 'failed';
      readonly reason: SendFailureReason;
      readonly code: ErrorCode | undefined;
      readonly retryable: boolean;
    };

/**
 * Safe default for `MessageDelivery.retryable` / `sendFailed.retryable` when
 * there is nothing to mirror.
 *
 * This module never re-derives retryability from a hand-maintained copy of
 * §7.4's code table — the server already computes it once, per code, on
 * `ErrorPayload.retryable` (protocol/envelope.ts), and duplicating that logic
 * here is exactly the kind of drift D4 exists to prevent. So this constant is
 * reached only when there is truly no server signal to trust: a `FailedSend`
 * from a server build that predates this field, or a `SendFailureReason` the
 * SDK decided locally (`sessionClosed`, `expired`, `evicted`, `storage`) with
 * no wire `ErrorPayload` behind it at all.
 *
 * `true` — "assume a retry might work" — because this boolean gates a UI
 * affordance, not a data-safety decision. Defaulting `false` would silently
 * remove the retry button for every send this SDK cannot classify, which is a
 * pure capability regression: the user's only recourse becomes retyping the
 * message from scratch, with no way to tell that was ever necessary.
 * Defaulting `true` costs nothing worse than this SDK's pre-fix behavior —
 * every failed send already showed retry unconditionally — so the fallback
 * can never make an unclassified case worse than it already was; it can only
 * fail to *improve* on cases the SDK now has enough information to improve.
 */
export const DEFAULT_RETRYABLE_FALLBACK = true;

/** Narrows a `FailedSend.code` (plain `string`) to the canonical §7.4 union, or `undefined`. */
function resolveCode(code: string | undefined): ErrorCode | undefined {
  return code !== undefined && isErrorCode(code) ? code : undefined;
}

/**
 * The message as the server confirmed it: `seq` recorded, `delivery` gone.
 *
 * `delivery` is removed rather than set to `undefined` because
 * `exactOptionalPropertyTypes` distinguishes the two, and §6.4 gives the
 * absent property the meaning "server-confirmed".
 */
function confirmed(message: ChatMessage, seq: number | undefined): ChatMessage {
  const { delivery: _delivery, seq: _previousSeq, ...rest } = message;
  return seq === undefined ? rest : { ...rest, seq };
}

/** The message as a terminal failure: still listed, now retryable by the app. */
function failed(
  message: ChatMessage,
  reason: SendFailureReason,
  code: ErrorCode | undefined,
  retryable: boolean,
): ChatMessage {
  return {
    ...message,
    delivery: {
      state: 'failed',
      reason,
      retryable,
      // `exactOptionalPropertyTypes` is on, so an absent code is an absent
      // property rather than one explicitly set to undefined.
      ...(code === undefined ? {} : { code }),
    },
  };
}

/**
 * The `MessageType` for an uploaded file's `mediaType`.
 *
 * `MediaType` (`IMAGE|VIDEO|AUDIO|DOCUMENT`) and `MessageType` are different
 * enums that overlap on three values, so `DOCUMENT` has to be mapped rather
 * than passed through — `MessageType` spells that case `FILE`. An unknown
 * value falls back to `FILE` instead of throwing: core never blocks a send on
 * an enum it does not recognize.
 */
function messageTypeFor(mediaType: string): MessageType {
  switch (mediaType) {
    case 'IMAGE':
      return 'IMAGE';
    case 'VIDEO':
      return 'VIDEO';
    case 'AUDIO':
      return 'AUDIO';
    default:
      return 'FILE';
  }
}

export class MessageController {
  readonly #store: ChatStore;
  readonly #enqueue: EnqueueSend;
  readonly #sender: () => LocalSender;
  readonly #history: MessageHistorySource;
  readonly #uploader: AttachmentUploader;
  readonly #pageSize: number;

  /** Uploads currently in flight. See `#setUploading`. */
  #uploads = 0;

  /**
   * Outcomes that arrived before the message they describe was in state.
   *
   * This is not defensive programming — the interleaving is routine.
   * `SendQueue.enqueue` starts draining *before* it resolves ("Delivery is
   * deliberately not awaited"), so on an open socket the ack can settle on an
   * earlier microtask than the `await enqueue(...)` continuation that inserts
   * the optimistic bubble. Without this, that ack would land on an empty list
   * and be lost, leaving a delivered message stuck on a spinner forever.
   *
   * Entries are consumed by the insert that follows, so this holds at most
   * the sends currently between `enqueue` resolving and their own insert.
   */
  readonly #settledEarly = new Map<string, SendOutcome>();

  constructor(options: MessageControllerOptions) {
    this.#store = options.store;
    this.#enqueue = options.enqueue;
    this.#sender = options.sender;
    this.#history = options.history;
    this.#uploader = options.uploader;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  // -----------------------------------------------------------------------
  // §6.3 operations
  // -----------------------------------------------------------------------

  /**
   * Sends a message optimistically (§6.3).
   *
   * The message appears in state as soon as it is durably queued, carrying
   * `delivery: {state:'queued'}`, and stays that way until the server acks it
   * — at which point `delivery` clears and `seq` is recorded.
   *
   * **Never rejects because the socket is closed.** Offline is a queued
   * state, not an error (§6.3): with no open socket the send sits in the
   * durable queue and the message reads as `queued`, never as `failed`. It
   * *does* reject if the send could not be durably queued at all, because
   * then there is nothing to show — the queue's contract is that a rejected
   * enqueue "means the send is not queued and the caller must not show it as
   * sent".
   *
   * The server never echoes `message.new` back to the sender, so the ack is
   * the only confirmation that will ever arrive. Nothing here waits for a
   * push that is not coming.
   */
  async sendMessage(content: string, opts: SendMessageOptions = {}): Promise<void> {
    await this.#send({
      content,
      // Optional on the public API (§6.3), required on the wire: core fills
      // the default so no other client has to independently discover it.
      type: opts.type ?? 'TEXT',
      ...(opts.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: opts.replyToMessageId }),
      ...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
    });
  }

  /**
   * Uploads a file, then announces it as a message (§6.3, §12.10).
   *
   * Two steps, in this order: the REST upload returns finished attachment
   * metadata, and only then is a `message.send` queued carrying that
   * `attachment` **top-level**. It is never nested under `metadata` (D4) —
   * v1 put it in both places, the client wrote one and the server read the
   * other, and attachments were silently dropped behind successful acks.
   *
   * `ChatState.uploading` covers step one only. Once the frame is queued the
   * message is an ordinary optimistic send with its own `delivery` state, so
   * a spinner tied to `uploading` correctly stops at the handoff.
   *
   * Like `loadMore`, an upload failure is reported through `lastError` and
   * the `error` event rather than by rejecting — §6.4 makes error state
   * observable, and this module reports failures one way.
   */
  async sendAttachment(file: Blob, opts: SendAttachmentOptions = {}): Promise<void> {
    const sessionId = this.#store.getState().session?.id;
    if (sessionId === undefined) throw new NoActiveSessionError('sendAttachment');

    let attachment: AttachmentMetadata;
    this.#setUploading(1);
    try {
      attachment = await this.#uploader.upload({
        sessionId,
        file,
        ...(opts.fileName === undefined ? {} : { fileName: opts.fileName }),
      });
    } catch {
      // The adapter's error text is not copied: an upload failure can carry a
      // signed URL (§14).
      const error: ChatError = {
        source: 'transport',
        code: null,
        message: 'attachment upload failed',
        retryable: true,
      };
      this.#store.setState({ lastError: error });
      this.#store.emit('error', error);
      return;
    } finally {
      this.#setUploading(-1);
    }

    await this.#send({
      // §12.10's confirmed shape: the attachment URL travels as the message
      // content, with the metadata alongside it.
      content: attachment.url,
      type: messageTypeFor(attachment.mediaType),
      attachment,
      ...(opts.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: opts.replyToMessageId }),
      ...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
    });
  }

  /**
   * Loads one page of older messages (§6.3, §12.10).
   *
   * §6.3 names this operation `loadOlderMessages`; the shorter name is used
   * here and T13 maps it onto the public `ChatClient`.
   *
   * Walks backward only, via a `before={messageId}` cursor. There is no
   * forward cursor because live messages arrive over the WebSocket, so
   * nothing polls forward.
   *
   * Does not reject on a failed fetch: §6.4 makes error state observable
   * (`lastError`) and §6.5 makes it an event, so a caller that already
   * subscribes would otherwise hear about the same failure twice and be
   * forced into a `try`/`catch` for something it is already watching.
   */
  async loadMore(): Promise<void> {
    const state = this.#store.getState();
    const sessionId = state.session?.id;
    if (sessionId === undefined) throw new NoActiveSessionError('loadMore');

    // Reentrancy guard: a scroll handler can fire this many times per frame,
    // and a second in-flight page would request the same cursor.
    if (state.pagination.loadingMore) return;

    // Nothing older to walk back to. The empty-list case is deliberately not
    // covered by this guard: `hasMore` starts `false` (§6.4's initial state),
    // so treating that as "nothing older exists" before anything is loaded
    // would make a cold start permanently unable to fetch its first page.
    if (!state.pagination.hasMore && state.messages.length > 0) return;

    this.#store.setState({ pagination: { hasMore: state.pagination.hasMore, loadingMore: true } });

    const before = state.messages[0]?.id;
    try {
      const page = await this.#history.listMessages({
        sessionId,
        ...(before === undefined ? {} : { before }),
        limit: this.#pageSize,
      });

      // Re-read: a live `message.new` may have landed during the fetch.
      this.#store.setState({
        messages: prependPage(this.#store.getState().messages, page.messages),
        pagination: { hasMore: page.hasMore, loadingMore: false },
      });
    } catch {
      // The adapter's error text is deliberately not copied into the message:
      // a failed request can carry a tokenized URL (§14).
      const error: ChatError = {
        source: 'transport',
        code: null,
        message: 'failed to load message history',
        retryable: true,
      };
      this.#store.setState({
        pagination: { hasMore: this.#store.getState().pagination.hasMore, loadingMore: false },
        lastError: error,
      });
      this.#store.emit('error', error);
    }
  }

  // -----------------------------------------------------------------------
  // Inbound
  // -----------------------------------------------------------------------

  /**
   * Applies an inbound `message.new` push (§6.5, §9.3).
   *
   * Only ever another participant's message. The server does not echo
   * `message.new` back to the sender — a client's own message is rendered
   * from the ack instead — so nothing here has to recognize or suppress a
   * self-echo. That is why neither of v1's mechanisms is ported: there is no
   * `clientMessageId` mapping and no content-matching echo suppressor with a
   * ten-second window (§12.9).
   *
   * A message whose id is already known is ignored outright. Messages are
   * append-only (§9.4 — "there is no edit message concept"), so a second
   * arrival of the same ULID carries nothing new; skipping keeps the list at
   * one entry, preserves the existing object's identity, and avoids emitting
   * a second `message` event for something the app already rendered.
   */
  applyIncoming(payload: MessagePayload): void {
    const messages = this.#store.getState().messages;
    if (messages.some((message) => message.id === payload.id)) return;

    const message: ChatMessage = {
      id: payload.id,
      sessionId: payload.sessionId,
      senderId: payload.senderId,
      senderType: payload.senderType,
      type: payload.type,
      content: payload.content,
      seq: payload.seq,
      createdAt: payload.createdAt,
      ...(payload.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: payload.replyToMessageId }),
      // Top-level, exactly as it arrived (D4).
      ...(payload.attachment === undefined ? {} : { attachment: payload.attachment }),
      ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
    };

    this.#write(message);
    this.#store.emit('message', message);
  }

  // -----------------------------------------------------------------------
  // Queue callbacks — wire these to `SendQueueOptions.onAck` / `onFailed`
  // -----------------------------------------------------------------------

  /**
   * The server confirmed a queued send (§9.3). Bound, so it can be handed
   * straight to `new SendQueue({ onAck: controller.onAck })`.
   */
  readonly onAck = (entry: QueuedSend, seq: number | undefined): void => {
    const patched = this.#patch(entry.id, (message) => confirmed(message, seq));
    if (!patched) {
      this.#settledEarly.set(entry.id, { kind: 'acked', seq });
      return;
    }
    this.#emitAck(entry.id, seq);
  };

  /**
   * A queued send will never be retried again (§9.6) — the queue's single
   * notification channel for a dead send, mapped onto §6.5's `sendFailed`.
   *
   * The parameter widens `FailedSend` with an optional `retryable` rather
   * than requiring `queue/` to declare it: `queue/types.ts` does not carry
   * this field today (T9 owns that module), and a caller supplying it once
   * `queue/` does add it is structurally identical to this type either way.
   * Absent — the only case reachable through the queue right now — falls
   * back to {@link DEFAULT_RETRYABLE_FALLBACK}.
   */
  readonly onFailed = (failure: FailedSend & { readonly retryable?: boolean }): void => {
    const { entry, reason } = failure;
    const code = resolveCode(failure.code);
    const retryable = failure.retryable ?? DEFAULT_RETRYABLE_FALLBACK;
    const patched = this.#patch(entry.id, (message) => failed(message, reason, code, retryable));
    if (!patched) {
      this.#settledEarly.set(entry.id, { kind: 'failed', reason, code, retryable });
      return;
    }
    this.#emitFailed(entry, reason, code, retryable);
  };

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Queues one frame and applies its optimistic message. */
  async #send(payload: MessageSendPayload): Promise<void> {
    const sessionId = this.#store.getState().session?.id;
    if (sessionId === undefined) throw new NoActiveSessionError('sendMessage');

    let entry: QueuedSend;
    try {
      entry = await this.#enqueue(sessionId, payload);
    } catch (error) {
      // The send was never queued, so no optimistic message will ever be
      // inserted to consume an outcome recorded against its id. Dropping it
      // here is what keeps `#settledEarly` bounded by sends in flight.
      const entryId: unknown = (error as { entryId?: unknown }).entryId;
      if (typeof entryId === 'string') this.#settledEarly.delete(entryId);
      throw error;
    }

    this.#applyOutgoing(entry);
  }

  /**
   * Inserts the optimistic message for a queued send, then emits.
   *
   * `createdAt` comes from the entry's `enqueuedAt` rather than a second
   * clock: the queue already stamped this send with its injected clock, and
   * reading a different one here would let the two disagree.
   */
  #applyOutgoing(entry: QueuedSend): void {
    const { senderId, senderType } = this.#sender();
    const { payload } = entry;

    const optimistic: ChatMessage = {
      id: entry.id,
      sessionId: entry.sessionId,
      senderId,
      senderType,
      type: payload.type,
      content: payload.content,
      createdAt: new Date(entry.enqueuedAt).toISOString(),
      ...(payload.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: payload.replyToMessageId }),
      // Top-level, never nested under `metadata` (D4).
      ...(payload.attachment === undefined ? {} : { attachment: payload.attachment }),
      ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
      delivery: { state: 'queued' },
    };

    const outcome = this.#settledEarly.get(entry.id);
    this.#settledEarly.delete(entry.id);

    const message =
      outcome === undefined
        ? optimistic
        : outcome.kind === 'acked'
          ? confirmed(optimistic, outcome.seq)
          : failed(optimistic, outcome.reason, outcome.code, outcome.retryable);

    this.#write(message);

    // `message` first in both interleavings: a binding is told the message
    // exists before it is told what became of it.
    this.#store.emit('message', message);

    if (outcome?.kind === 'acked') this.#emitAck(entry.id, outcome.seq);
    if (outcome?.kind === 'failed') this.#emitFailed(entry, outcome.reason, outcome.code, outcome.retryable);
  }

  /**
   * Replaces the message carrying `id`, or reports that there is none.
   *
   * Returns `false` rather than inserting: only the send path knows an
   * outgoing message's sender identity, so a patch that invented one would be
   * guessing.
   */
  #patch(id: string, update: (message: ChatMessage) => ChatMessage): boolean {
    const existing = this.#store.getState().messages.find((message) => message.id === id);
    if (existing === undefined) return false;

    this.#write(update(existing));
    return true;
  }

  /**
   * Tracks concurrent uploads behind §6.4's single `uploading` boolean.
   *
   * A counter rather than a bare flag because a multi-file drop starts
   * several uploads at once, and the first one to finish would otherwise
   * clear the flag while the rest are still going.
   */
  #setUploading(delta: number): void {
    this.#uploads += delta;
    this.#store.setState({ uploading: this.#uploads > 0 });
  }

  /**
   * Outcomes still waiting for their optimistic message. Test/diagnostic use,
   * in the same spirit as `ChatStore.listenerCount`.
   *
   * Exposed because the alternative is untestable: an outcome stranded here
   * is keyed by an id nothing will ever apply again, so it is invisible
   * through every other part of this interface — and a slow leak in a
   * long-lived client is exactly the kind of thing that never gets noticed.
   */
  get settledEarlyCount(): number {
    return this.#settledEarly.size;
  }

  #write(message: ChatMessage): void {
    this.#store.setState({ messages: upsertMessage(this.#store.getState().messages, message) });
  }

  #emitAck(id: string, seq: number | undefined): void {
    this.#store.emit('messageAck', seq === undefined ? { id } : { id, seq });
  }

  #emitFailed(
    entry: QueuedSend,
    reason: SendFailureReason,
    code: ErrorCode | undefined,
    retryable: boolean,
  ): void {
    this.#store.emit('sendFailed', {
      id: entry.id,
      sessionId: entry.sessionId,
      reason,
      retryable,
      // `exactOptionalPropertyTypes` is on, so an absent code is an absent
      // property rather than one explicitly set to undefined.
      ...(code === undefined ? {} : { code }),
    });
  }
}
