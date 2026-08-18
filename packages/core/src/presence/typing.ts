// Typing indicators — PRD §7.3 (one canonical frame pair), §6.4
// (`ChatState.typing`), §6.5 (the `typing` event), §12.4 (v1's mess).
//
// What is deliberately NOT ported from v1 (§12.4): v1's client listened for
// four differently-named typing events (`TYPING_INDICATOR`, `TYPING`,
// `TYPING_START`, `TYPING_STOP`) and sent two (`TYPING_START`/`TYPING_STOP`
// plus a synthetic `TYPING_INDICATOR`). §7.3 collapses that to exactly one
// pair — `typing.start` / `typing.stop` — used identically in both
// directions, and this module implements exactly that pair. No aliases.
//
// What IS kept from v1: the client-side auto-clear timeout. A remote
// `typing.stop` genuinely can be lost (dropped frame, agent's socket dies
// mid-compose, server restart), and the failure mode is a permanently stuck
// "Agent is typing…" indicator — the most visible bug this module can ship.
// The timeout is a safety net under the protocol, not a substitute for it.
//
// ---------------------------------------------------------------------------
// Outbound throttle policy
// ---------------------------------------------------------------------------
//
// `startTyping()` is called from a keystroke handler, so the naive
// implementation emits one frame per character — ~200 frames to communicate
// one bit. The policy here:
//
//   1. LEADING EDGE. The first `startTyping()` emits `typing.start`
//      immediately. Not trailing-edge debounced: the whole value of the
//      indicator is that it appears while the user is still typing, and
//      delaying it by the debounce window is the wrong trade.
//   2. REFRESH, NOT SUPPRESS-FOREVER. Further calls within
//      `startIntervalMs` of the last emitted start are dropped; the first
//      call *after* that window emits a fresh `typing.start`. Sustained
//      typing therefore costs one frame per interval, and each frame doubles
//      as a keepalive that re-arms the *receiver's* auto-clear.
//   3. IDLE AUTO-STOP. Every call (emitted or dropped) re-arms an idle timer
//      of `idleMs`. When it fires, `typing.stop` is emitted automatically —
//      so a user who types and then walks away does not leave an indicator
//      up, even if the integrator never calls `stopTyping()`.
//   4. NO REDUNDANT STOPS. `stopTyping()` while not active is a no-op.
//
// The three timings are one system, not three independent knobs, and the
// defaults below satisfy the constraint that makes them work:
//
//     startIntervalMs (3s) < remoteTypingTimeoutMs (5s)
//     idleMs          (3s) < remoteTypingTimeoutMs (5s)
//
// A receiver clears its indicator 5s after the last `typing.start` it saw.
// A sender refreshes every 3s, so the indicator never flickers mid-typing.
// When typing ends, the explicit stop lands at +3s; if that stop is lost, the
// receiver's own timeout clears it at +5s. Invert either inequality and you
// get a flickering indicator during sustained typing. `assertTypingTimings`
// below enforces this rather than leaving it as a comment.
//
// 5s matches v1's confirmed auto-clear window (§12.4), so v2 does not change
// observable behaviour on the receive side while removing the event-name
// proliferation on the wire.

import type { TypingPayload } from '../protocol/index.js';
import type { ChatStore } from '../state/index.js';
import type { IntentSink } from './intents.js';
import type { CancelTimer, Clock, ScheduleTimer } from './time.js';
import { systemClock, systemTimers } from './time.js';

/** Receive-side safety net (§12.4). Matches v1's confirmed 5-second window. */
export const DEFAULT_REMOTE_TYPING_TIMEOUT_MS = 5_000;

/** Send-side: at most one `typing.start` per this window during sustained typing. */
export const DEFAULT_TYPING_START_INTERVAL_MS = 3_000;

/** Send-side: auto-emit `typing.stop` after this long with no `startTyping()` call. */
export const DEFAULT_TYPING_IDLE_MS = 3_000;

export interface TypingTimings {
  readonly remoteTypingTimeoutMs: number;
  readonly startIntervalMs: number;
  readonly idleMs: number;
}

/**
 * Rejects a timing set that would make the indicator flicker.
 *
 * Exported and called from the constructor because these are the one class of
 * misconfiguration whose symptom (an indicator that blinks off and on while
 * someone is visibly typing) looks like a protocol bug rather than a settings
 * mistake, and would be debugged as one.
 */
export function assertTypingTimings(timings: TypingTimings): void {
  const { remoteTypingTimeoutMs, startIntervalMs, idleMs } = timings;

  if (remoteTypingTimeoutMs <= 0 || startIntervalMs <= 0 || idleMs <= 0) {
    throw new RangeError('typing timings must all be positive');
  }
  if (startIntervalMs >= remoteTypingTimeoutMs) {
    throw new RangeError(
      `startIntervalMs (${startIntervalMs}) must be < remoteTypingTimeoutMs (${remoteTypingTimeoutMs}): ` +
        'a refresh slower than the receiver timeout makes the indicator flicker during sustained typing',
    );
  }
  if (idleMs >= remoteTypingTimeoutMs) {
    throw new RangeError(
      `idleMs (${idleMs}) must be < remoteTypingTimeoutMs (${remoteTypingTimeoutMs}): ` +
        'the explicit stop must arrive before the receiver would have timed out anyway',
    );
  }
}

export interface TypingControllerOptions {
  readonly store: ChatStore;
  readonly emitIntent: IntentSink;

  /** Defaults to `systemTimers`. */
  readonly schedule?: ScheduleTimer;

  /** Defaults to `systemClock`. */
  readonly clock?: Clock;

  readonly remoteTypingTimeoutMs?: number;
  readonly startIntervalMs?: number;
  readonly idleMs?: number;

  /** Filters self-echo — see `setLocalParticipantId`. */
  readonly localParticipantId?: string;
}

export class TypingController {
  readonly #store: ChatStore;
  readonly #emitIntent: IntentSink;
  readonly #schedule: ScheduleTimer;
  readonly #clock: Clock;
  readonly #timings: TypingTimings;

  #localParticipantId: string | null;

  /**
   * Who is currently typing, mapped to the canceller for their auto-clear.
   *
   * A map rather than a single slot even though `ChatState.typing` holds one
   * participant, because multi-agent sessions are confirmed real (§12.9) and
   * the single-slot version has a concrete bug: agent A starts, agent B
   * starts, agent A stops — with one slot the indicator clears while B is
   * still typing. The map keeps per-participant state and *derives* §6.4's
   * single-participant view from it.
   *
   * Insertion order is load-bearing: the most recently started typer is the
   * last entry, and that is the one surfaced in `ChatState.typing`. Re-arming
   * deletes before re-inserting to keep that true.
   */
  readonly #remoteTypers = new Map<string, CancelTimer>();

  // Outbound throttle state.
  #outboundActive = false;
  #lastStartSentAt = 0;
  #cancelIdle: CancelTimer | null = null;

  constructor(options: TypingControllerOptions) {
    this.#store = options.store;
    this.#emitIntent = options.emitIntent;
    this.#schedule = options.schedule ?? systemTimers;
    this.#clock = options.clock ?? systemClock;
    this.#localParticipantId = options.localParticipantId ?? null;

    this.#timings = {
      remoteTypingTimeoutMs: options.remoteTypingTimeoutMs ?? DEFAULT_REMOTE_TYPING_TIMEOUT_MS,
      startIntervalMs: options.startIntervalMs ?? DEFAULT_TYPING_START_INTERVAL_MS,
      idleMs: options.idleMs ?? DEFAULT_TYPING_IDLE_MS,
    };
    assertTypingTimings(this.#timings);
  }

  /** The resolved timings in force. */
  get timings(): TypingTimings {
    return this.#timings;
  }

  /**
   * Sets whose typing frames to ignore as self-echo.
   *
   * §7.3 does not say whether the server relays a `typing.start` back to the
   * participant who sent it. If it does, and we applied it, the user would
   * watch a "someone is typing" indicator track their own keystrokes. Filtering
   * on our own id makes the client correct under either server behaviour
   * instead of depending on one that is not specified.
   *
   * Pass `null` to disable filtering. Called by the controller when a session
   * snapshot identifies us (§9.5).
   */
  setLocalParticipantId(participantId: string | null): void {
    this.#localParticipantId = participantId;
  }

  // ---------------------------------------------------------------------
  // Inbound — server-relayed typing frames
  // ---------------------------------------------------------------------

  /**
   * Applies a server-relayed `typing.start` (§7.3).
   *
   * A payload with no `participantId` is ignored rather than guessed at: per
   * §7.3 the field is populated whenever the server relays typing to other
   * participants, and is omitted only when a *client* reports its own state.
   * An inbound frame missing it therefore cannot be attributed to anyone, and
   * `ChatState.typing` is a per-participant fact.
   */
  applyTypingStart(payload: TypingPayload): void {
    const participantId = payload.participantId;
    if (participantId === undefined || participantId === this.#localParticipantId) return;

    const wasTyping = this.#remoteTypers.has(participantId);
    this.#armAutoClear(participantId);
    this.#syncTypingState();

    // §6.5 defines this event as "remote typing state *changed*" — a keepalive
    // refresh for someone already typing is not a change, so it stays quiet.
    if (!wasTyping) {
      this.#store.emit('typing', { isTyping: true, participantId });
    }
  }

  /** Applies a server-relayed `typing.stop` (§7.3). */
  applyTypingStop(payload: TypingPayload): void {
    const participantId = payload.participantId;
    if (participantId === undefined || participantId === this.#localParticipantId) return;
    if (!this.#remoteTypers.has(participantId)) return;

    this.#clearTyper(participantId);
    this.#syncTypingState();
    this.#store.emit('typing', { isTyping: false, participantId });
  }

  // ---------------------------------------------------------------------
  // Outbound — throttled intent production
  // ---------------------------------------------------------------------

  /**
   * Reports local typing activity. Safe to call per keystroke — see the
   * throttle policy at the top of this file.
   */
  startTyping(): void {
    const now = this.#clock();
    const dueForRefresh = now - this.#lastStartSentAt >= this.#timings.startIntervalMs;
    const shouldSend = !this.#outboundActive || dueForRefresh;

    this.#outboundActive = true;
    this.#armIdleTimer();

    if (shouldSend) {
      this.#lastStartSentAt = now;
      this.#emitIntent({ t: 'typing.start', d: {} });
    }
  }

  /**
   * Reports that local typing ended (message sent, input cleared, blur).
   *
   * A no-op when not currently typing, so an integrator wiring this to both
   * "input cleared" and "blur" does not emit two stops for one stop.
   */
  stopTyping(): void {
    if (!this.#outboundActive) return;
    this.#resetOutbound();
    this.#emitIntent({ t: 'typing.stop', d: {} });
  }

  /** True while a `typing.start` has been sent with no matching stop yet. */
  get isSendingTyping(): boolean {
    return this.#outboundActive;
  }

  /** Participants currently shown as typing, oldest start first. */
  get remoteTypers(): readonly string[] {
    return [...this.#remoteTypers.keys()];
  }

  /**
   * Cancels every pending timer and clears typing state.
   *
   * Called on disconnect and teardown. Without it, a socket that drops while
   * an agent is typing leaves the indicator up until the auto-clear fires, and
   * a torn-down client leaves timers holding the instance alive.
   */
  dispose(): void {
    for (const cancel of this.#remoteTypers.values()) cancel();
    this.#remoteTypers.clear();
    this.#resetOutbound();
    this.#syncTypingState();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * (Re)starts `participantId`'s auto-clear and moves them to the most-recent
   * position. The delete-then-set is what maintains the insertion-order
   * invariant `#syncTypingState` reads.
   */
  #armAutoClear(participantId: string): void {
    this.#clearTyper(participantId);

    const cancel = this.#schedule(() => {
      // Identical to receiving a `typing.stop` — the whole point of the net is
      // that a lost stop and a delivered one converge on the same state.
      if (!this.#remoteTypers.has(participantId)) return;
      this.#remoteTypers.delete(participantId);
      this.#syncTypingState();
      this.#store.emit('typing', { isTyping: false, participantId });
    }, this.#timings.remoteTypingTimeoutMs);

    this.#remoteTypers.set(participantId, cancel);
  }

  #clearTyper(participantId: string): void {
    const cancel = this.#remoteTypers.get(participantId);
    if (cancel === undefined) return;
    cancel();
    this.#remoteTypers.delete(participantId);
  }

  /**
   * Projects the typer map onto §6.4's single-participant `ChatState.typing`,
   * surfacing the most recently started typer.
   *
   * Compares against current state before writing: `setState` detects change
   * by reference, so an unconditional write of a freshly-built object would
   * notify every binding on each 3-second keepalive refresh.
   */
  #syncTypingState(): void {
    let mostRecent: string | undefined;
    for (const participantId of this.#remoteTypers.keys()) mostRecent = participantId;

    const current = this.#store.getState().typing;
    if (current.isTyping === (mostRecent !== undefined) && current.participantId === mostRecent) {
      return;
    }

    // Built as two distinct literals rather than one with `participantId:
    // mostRecent`, because `exactOptionalPropertyTypes` makes an explicit
    // `undefined` non-assignable to `participantId?: string` — the key must be
    // genuinely absent.
    // https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes
    this.#store.setState({
      typing: mostRecent === undefined ? { isTyping: false } : { isTyping: true, participantId: mostRecent },
    });
  }

  #armIdleTimer(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = this.#schedule(() => {
      if (!this.#outboundActive) return;
      this.#resetOutbound();
      this.#emitIntent({ t: 'typing.stop', d: {} });
    }, this.#timings.idleMs);
  }

  #resetOutbound(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = null;
    this.#outboundActive = false;
  }
}
