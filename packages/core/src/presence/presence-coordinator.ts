// Presence, typing, and read watermarks — task T12. PRD §6.3
// (`startTyping`/`stopTyping`/`markRead`), §7.3 (one canonical typing pair,
// collapsing v1's four event names), §9.5 (watermark-based read state).
//
// Typing and presence are deliberately NOT queued through `SendQueue` (T10)
// the way messages are — a typing indicator or a presence ping that arrives
// late, after being replayed from an offline queue, is stale information,
// not a delivery guarantee worth keeping. They're sent best-effort only
// while actually connected.

import { CORE_PROTOCOL_VERSION } from '../protocol/index.js';
import type { ConnectionMachine } from '../connection/index.js';
import type { ChatStateStore } from '../state/index.js';
import type { PresenceStatus, ServerFrame } from '../protocol/index.js';
import type { Unsubscribe } from '../transport/index.js';
import { generateUlid } from '../ulid.js';

export interface PresenceCoordinatorOptions {
  store: ChatStateStore;
  connection: ConnectionMachine;
  /** This client's own participant id — the key `markRead()` advances in `readWatermarks`. */
  getSenderId: () => string;
  /**
   * Auto-clears a remote typing indicator if no `typing.stop` follows
   * within this window — a `typing.stop` lost on the wire must not leave
   * "is typing" stuck true forever. Default 5000ms — v1's confirmed
   * behavior (§12.8 grounding), not independently re-specified for v2, but
   * sensible to keep rather than drop.
   */
  typingTimeoutMs?: number;
}

const DEFAULT_TYPING_TIMEOUT_MS = 5000;

export class PresenceCoordinator {
  readonly #store: ChatStateStore;
  readonly #connection: ConnectionMachine;
  readonly #getSenderId: () => string;
  readonly #typingTimeoutMs: number;
  readonly #unsubscribers: Unsubscribe[] = [];
  #typingClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PresenceCoordinatorOptions) {
    this.#store = options.store;
    this.#connection = options.connection;
    this.#getSenderId = options.getSenderId;
    this.#typingTimeoutMs = options.typingTimeoutMs ?? DEFAULT_TYPING_TIMEOUT_MS;
  }

  attach(): Unsubscribe {
    const unsubscribe = this.#connection.on('frame', (frame) => this.#handleFrame(frame));
    this.#unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  destroy(): void {
    this.#clearTypingTimer();
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
  }

  /** Fire-and-forget — a no-op if not currently connected, per this file's header. */
  startTyping(): void {
    this.#sendIfConnected('typing.start', {});
  }

  stopTyping(): void {
    this.#sendIfConnected('typing.stop', {});
  }

  /** Advances the local read watermark optimistically, then syncs it — the wire frame is the single write path (§9.5; no parallel REST call to keep in sync by hand). */
  markRead(): void {
    const state = this.#store.getState();
    this.#store.setState({ readWatermarks: { ...state.readWatermarks, [this.#getSenderId()]: new Date().toISOString() } });
    this.#sendIfConnected('message.markRead', {});
  }

  setPresence(status: PresenceStatus): void {
    this.#sendIfConnected('presence.set', { status });
  }

  /** Omit `participantIds` to query every participant in the active session. */
  queryPresence(participantIds?: string[]): void {
    this.#sendIfConnected('presence.query', participantIds ? { participantIds } : {});
  }

  #handleFrame(frame: ServerFrame): void {
    if (frame.t === 'typing.start') {
      this.#applyTyping(true, frame.d.participantId);
      return;
    }
    if (frame.t === 'typing.stop') {
      this.#applyTyping(false, frame.d.participantId);
      return;
    }
    if (frame.t === 'message.read') {
      const state = this.#store.getState();
      this.#store.setState({ readWatermarks: { ...state.readWatermarks, [frame.d.participantId]: frame.d.readAt } });
    }
    // presence.update carries no continuous ChatState field to update (see
    // this task's header note in state/types.ts — presence is event-only
    // by the existing type contract) — T13 wires ChatEventEmitter.emit for
    // it directly from the same 'frame' stream, not through this class.
  }

  #applyTyping(isTyping: boolean, participantId: string | undefined): void {
    this.#clearTypingTimer();
    this.#store.setState({ typing: { isTyping, ...(participantId !== undefined ? { participantId } : {}) } });

    if (isTyping) {
      this.#typingClearTimer = setTimeout(() => {
        this.#typingClearTimer = null;
        this.#store.setState({ typing: { isTyping: false } });
      }, this.#typingTimeoutMs);
    }
  }

  #clearTypingTimer(): void {
    if (this.#typingClearTimer !== null) {
      clearTimeout(this.#typingClearTimer);
      this.#typingClearTimer = null;
    }
  }

  #sendIfConnected(t: 'typing.start' | 'typing.stop' | 'message.markRead' | 'presence.set' | 'presence.query', d: object): void {
    if (this.#connection.state !== 'connected') return;
    try {
      this.#connection.send({ v: CORE_PROTOCOL_VERSION, t, id: generateUlid(), ts: Date.now(), d } as Parameters<ConnectionMachine['send']>[0]);
    } catch {
      // Connection dropped between the state check and the send call —
      // dropping a typing/presence/read ping here is the correct behavior
      // (see this file's header), not an error to surface.
    }
  }
}
