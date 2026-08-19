// Message operations — task T11. PRD §6.3: optimistic send, attachments,
// cursor pagination. The first task that actually applies pushed frames to
// `ChatState`.
//
// Optimistic send is structurally simpler than v1's (§9.3, D1): the
// client-generated ULID *is* the message's permanent id, so there is no
// optimistic-id-swap to perform. Applying an inbound `message.new` is just
// "insert if this id isn't already in state" — the same id shows up once
// whether it arrived because we sent it or because the server echoed/
// broadcast it, and that single dedup-by-id check is the entire
// reconciliation logic this task needs.

import type { ChatMessage, ChatState } from '../state/index.js';
import type { ChatStateStore } from '../state/index.js';
import type { ConnectionMachine } from '../connection/index.js';
import type { AttachmentMetadata, ClientFrame, ServerFrame, MessageType } from '../protocol/index.js';
import { CORE_PROTOCOL_VERSION } from '../protocol/index.js';
import type { SendQueue } from '../queue/index.js';
import type { Unsubscribe } from '../transport/index.js';
import { generateUlid } from '../ulid.js';
import { messagePayloadToChatMessage, sessionSnapshotToChatSession } from './message-mapper.js';
import type { RestAuth } from './rest-client.js';
import { RestClient } from './rest-client.js';

export interface SendMessageOptions {
  type?: MessageType;
  replyToMessageId?: string;
}

export interface SendAttachmentOptions {
  fileName?: string;
}

export interface MessageCoordinatorOptions {
  store: ChatStateStore;
  connection: ConnectionMachine;
  sendQueue: SendQueue;
  restClient: RestClient;
  /** Current auth for REST calls — a function, not a snapshot, since it changes across the guest→identified upgrade (T9). */
  getAuth: () => RestAuth;
  /** The current user's (or guest's) id — used as `senderId` on optimistic messages. */
  getSenderId: () => string;
  defaultPageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

export class MessageCoordinator {
  readonly #store: ChatStateStore;
  readonly #connection: ConnectionMachine;
  readonly #sendQueue: SendQueue;
  readonly #restClient: RestClient;
  readonly #getAuth: () => RestAuth;
  readonly #getSenderId: () => string;
  readonly #pageSize: number;
  readonly #unsubscribers: Unsubscribe[] = [];

  constructor(options: MessageCoordinatorOptions) {
    this.#store = options.store;
    this.#connection = options.connection;
    this.#sendQueue = options.sendQueue;
    this.#restClient = options.restClient;
    this.#getAuth = options.getAuth;
    this.#getSenderId = options.getSenderId;
    this.#pageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  }

  attach(): Unsubscribe {
    const unsubscribers = [
      this.#connection.on('connected', ({ ack }) => {
        this.#store.setState({ session: sessionSnapshotToChatSession(ack.session) });
        this.#flushQueue();
      }),
      this.#connection.on('frame', (frame) => this.#handleFrame(frame)),
    ];
    this.#unsubscribers.push(...unsubscribers);
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  destroy(): void {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
  }

  /**
   * Generates a client-side ULID, applies the message to state
   * immediately, and sends it (or queues it if not currently connected).
   * Never throws for "offline" — per §6.3, offline is a queued state, not
   * an error.
   */
  async sendMessage(content: string, opts: SendMessageOptions = {}): Promise<void> {
    const id = generateUlid();
    const type = opts.type ?? 'TEXT';
    const sessionId = this.#requireSessionId();

    const optimistic: ChatMessage = {
      id,
      chatSessionId: sessionId,
      senderType: 'CUSTOMER',
      senderId: this.#getSenderId(),
      senderName: null,
      content,
      messageType: type,
      createdAt: new Date().toISOString(),
      attachment: null,
      replyToMessageId: opts.replyToMessageId ?? null,
      replyToMessage: null,
    };
    this.#appendMessage(optimistic);

    const frame = {
      v: CORE_PROTOCOL_VERSION,
      t: 'message.send' as const,
      id,
      ts: Date.now(),
      d: { content, type, ...(opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}) },
    };
    await this.#sendOrQueue(frame);
  }

  /**
   * Upload-then-announce (§6.3, Open Question 7 — transport TBD at the PRD
   * level, but the client-side shape is fixed regardless of which backend
   * storage strategy is chosen): upload over REST, then announce the
   * result as a `message.send` carrying the attachment metadata.
   */
  async sendAttachment(file: Blob, opts: SendAttachmentOptions = {}): Promise<void> {
    const id = generateUlid();
    const sessionId = this.#requireSessionId();
    const type = inferMessageTypeFromMime(file.type);

    const optimistic: ChatMessage = {
      id,
      chatSessionId: sessionId,
      senderType: 'CUSTOMER',
      senderId: this.#getSenderId(),
      senderName: null,
      content: opts.fileName ?? '',
      messageType: type,
      createdAt: new Date().toISOString(),
      attachment: null,
      replyToMessageId: null,
      replyToMessage: null,
    };
    this.#appendMessage(optimistic);
    this.#store.setState({ uploading: true });

    let attachment: AttachmentMetadata;
    try {
      attachment = await this.#restClient.uploadAttachment(sessionId, this.#getAuth(), file, opts.fileName);
    } catch (error) {
      this.#store.setState({ uploading: false, lastError: toChatError(error) });
      return;
    }
    this.#store.setState({ uploading: false });
    this.#replaceMessage(id, { ...optimistic, attachment });

    const frame = {
      v: CORE_PROTOCOL_VERSION,
      t: 'message.send' as const,
      id,
      ts: Date.now(),
      d: { content: attachment.url, type, metadata: { attachment } },
    };
    await this.#sendOrQueue(frame);
  }

  /** Cursor-based, walking backward from the oldest currently-loaded message (§6.3, §12.10). */
  async loadOlderMessages(): Promise<void> {
    const state = this.#store.getState();
    if (state.pagination.loadingMore || !state.pagination.hasMore) return;
    const oldest = state.messages[0];
    if (!oldest) return;

    this.#store.setState({ pagination: { ...state.pagination, loadingMore: true } });
    try {
      const sessionId = this.#requireSessionId();
      const page = await this.#restClient.listMessages(sessionId, this.#getAuth(), {
        before: oldest.id,
        limit: this.#pageSize,
      });
      const existingIds = new Set(this.#store.getState().messages.map((m) => m.id));
      const fresh = page.messages.filter((m) => !existingIds.has(m.id));
      this.#store.setState((prev) => ({
        messages: [...fresh, ...prev.messages],
        pagination: { hasMore: page.hasMore, loadingMore: false },
      }));
    } catch (error) {
      this.#store.setState((prev) => ({
        pagination: { ...prev.pagination, loadingMore: false },
        lastError: toChatError(error),
      }));
    }
  }

  #handleFrame(frame: ServerFrame): void {
    if (frame.t === 'message.new') {
      this.#appendMessage(messagePayloadToChatMessage(frame.d));
      return;
    }
    if (frame.t === 'session.updated') {
      // §9.4: always treat the freshest snapshot as authoritative and
      // overwrite wholesale — never merge field-by-field against a
      // possibly-stale local copy.
      this.#store.setState({ session: sessionSnapshotToChatSession(frame.d.session) });
      return;
    }
    if (frame.t === 'ack' && frame.d.ok) {
      // The message this acks is already in state under its own id (D1) —
      // nothing to reconcile there. The only follow-up is that it's no
      // longer pending redelivery.
      void this.#sendQueue.dequeueAcked(frame.ref);
    }
  }

  #appendMessage(message: ChatMessage): void {
    const state = this.#store.getState();
    if (state.messages.some((m) => m.id === message.id)) return;
    this.#store.setState({ messages: [...state.messages, message] });
  }

  #replaceMessage(id: string, next: ChatMessage): void {
    const state = this.#store.getState();
    const index = state.messages.findIndex((m) => m.id === id);
    if (index === -1) return;
    const messages = [...state.messages];
    messages[index] = next;
    this.#store.setState({ messages });
  }

  async #sendOrQueue(frame: ClientFrame): Promise<void> {
    if (this.#connection.state === 'connected') {
      try {
        this.#connection.send(frame);
        return;
      } catch {
        // fall through to queueing — the connection dropped between the
        // state check above and the send call itself
      }
    }
    await this.#sendQueue.enqueue(frame);
  }

  #flushQueue(): void {
    void this.#sendQueue.flush((frame) => this.#connection.send(frame));
  }

  #requireSessionId(): string {
    const sessionId = this.#store.getState().session?.id;
    if (!sessionId) throw new Error('MessageCoordinator: no active session — connect() first.');
    return sessionId;
  }
}

function inferMessageTypeFromMime(mimeType: string): MessageType {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'FILE';
}

function toChatError(error: unknown): ChatState['lastError'] {
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'INTERNAL', message, retryable: true };
}
