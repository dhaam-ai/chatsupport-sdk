// The module's external seam: one object that takes inbound frames and owns
// the three units behind them.
//
// This layer is deliberately thin. It does exactly the two things no single
// unit can do for itself — dispatch a frame to the right one, and fan a
// cross-cutting fact out to several — and delegates everything else. The
// units stay reachable as `typing` / `presence` / `watermarks` rather than
// being re-exposed through forwarding methods here, so there is exactly one
// way to call each operation and this file does not grow a method per feature.
//
// Nothing here owns a socket. `handleFrame` takes an already-parsed,
// already-validated frame (D4) and `emitIntent` hands outbound intents to the
// caller. The whole module is therefore exercisable with a plain object and a
// recording function — see the colocated tests, none of which construct a
// WebSocket.

import type { ServerPushFrame, SessionSnapshot } from '../protocol/index.js';
import type { ChatStore } from '../state/index.js';
import type { IntentSink } from './intents.js';
import { PresenceRegistry } from './presence.js';
import type { Clock, ScheduleTimer } from './time.js';
import { TypingController } from './typing.js';
import { WatermarkTracker } from './watermarks.js';

export interface PresenceCoordinatorOptions {
  readonly store: ChatStore;

  /** Where outbound frame intents go — see intents.ts. */
  readonly emitIntent: IntentSink;

  /** Defaults to `systemTimers`. */
  readonly schedule?: ScheduleTimer;

  /** Defaults to `systemClock`. */
  readonly clock?: Clock;

  /** Receive-side typing auto-clear (§12.4). Defaults to 5s. */
  readonly remoteTypingTimeoutMs?: number;

  /** Send-side `typing.start` refresh interval. Defaults to 3s. */
  readonly startIntervalMs?: number;

  /** Send-side idle window before an automatic `typing.stop`. Defaults to 3s. */
  readonly idleMs?: number;

  /** Adopted from the session snapshot when omitted (see WatermarkTracker). */
  readonly localParticipantId?: string;
}

export class PresenceCoordinator {
  readonly typing: TypingController;
  readonly presence: PresenceRegistry;
  readonly watermarks: WatermarkTracker;

  constructor(options: PresenceCoordinatorOptions) {
    const { store, emitIntent } = options;

    // Each option is forwarded only when present: under
    // `exactOptionalPropertyTypes`, spreading an absent optional as an
    // explicit `undefined` is not assignable to the target's optional
    // property, and would also defeat the `?? default` in each constructor.
    this.typing = new TypingController({
      store,
      emitIntent,
      ...(options.schedule !== undefined && { schedule: options.schedule }),
      ...(options.clock !== undefined && { clock: options.clock }),
      ...(options.remoteTypingTimeoutMs !== undefined && { remoteTypingTimeoutMs: options.remoteTypingTimeoutMs }),
      ...(options.startIntervalMs !== undefined && { startIntervalMs: options.startIntervalMs }),
      ...(options.idleMs !== undefined && { idleMs: options.idleMs }),
      ...(options.localParticipantId !== undefined && { localParticipantId: options.localParticipantId }),
    });

    this.presence = new PresenceRegistry({ store, emitIntent });

    this.watermarks = new WatermarkTracker({
      store,
      emitIntent,
      ...(options.localParticipantId !== undefined && { localParticipantId: options.localParticipantId }),
    });
  }

  /**
   * Routes one server push frame to the unit that owns it.
   *
   * Returns `false` for the frame types this module does not own, so a caller
   * can chain handlers without this one silently swallowing another module's
   * frames.
   *
   * `connection.ack`'s `replay` array is deliberately NOT walked here. Replay
   * ordering interacts with `seq` tracking and message application (D2, §7.3),
   * which belong to the connection layer (T8); it unwraps the array and feeds
   * each replayed frame back through this method individually. Recursing here
   * would make this module decide replay semantics for frames it does not own.
   *
   * The `ack` frame is likewise not handled here: a `presence.query` answer
   * arrives as a generic `ack` correlated by `ref`, and that correlation table
   * belongs to transport (protocol/envelope.ts). Once transport knows which
   * query an ack answers, it calls `presence.applyPresenceSnapshot` directly.
   */
  handleFrame(frame: ServerPushFrame): boolean {
    switch (frame.t) {
      case 'typing.start':
        this.typing.applyTypingStart(frame.d);
        return true;

      case 'typing.stop':
        this.typing.applyTypingStop(frame.d);
        return true;

      case 'presence.update':
        this.presence.applyPresenceUpdate(frame.d);
        return true;

      case 'message.read':
        this.watermarks.applyMessageRead(frame.d);
        return true;

      // Both carry the same authoritative snapshot and are treated identically
      // (§9.4, and protocol/domain.ts's note on SessionSnapshot).
      case 'connection.ack':
        this.#applySessionSnapshot(frame.d.session);
        return true;

      case 'session.updated':
        this.#applySessionSnapshot(frame.d.session);
        return true;

      default:
        return false;
    }
  }

  /**
   * Sets who "we" are, for both the watermark `markRead()` writes to and the
   * self-echo filter on inbound typing.
   *
   * Cross-cutting, which is why it lives here: the two units need the same
   * fact and neither owns it.
   */
  setLocalParticipantId(participantId: string | null): void {
    this.watermarks.setLocalParticipantId(participantId);
    this.typing.setLocalParticipantId(participantId);
  }

  /**
   * Drops connection-scoped state on disconnect.
   *
   * Typing indicators and presence are both statements about *right now* over
   * a socket that is gone — left in place, they show an agent typing or online
   * indefinitely after the connection dropped. Watermarks deliberately survive:
   * they are durable read state, reconciled against the next snapshot (§9.5).
   */
  reset(): void {
    this.typing.dispose();
    this.presence.clear();
  }

  #applySessionSnapshot(snapshot: SessionSnapshot): void {
    this.watermarks.applySessionSnapshot(snapshot);
    // The tracker may have just adopted the local participant from the
    // snapshot; typing needs the same id to filter our own echoed frames.
    this.typing.setLocalParticipantId(this.watermarks.localParticipantId);
  }
}
