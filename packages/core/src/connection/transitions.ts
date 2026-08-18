// The seven-state transition table of PRD §8.1, and the one object allowed to
// write `ChatState.connectionState`.
//
// The brief for this module was "every transition explicit; illegal
// transitions must be impossible, not merely unused". That word *impossible*
// is why this is a table plus a throwing guard rather than a convention:
//
//   - The table below is the complete, enumerable set of legal edges. Nothing
//     else in this module knows which edges exist, so a new edge cannot be
//     introduced by writing `setState({ connectionState })` somewhere else —
//     the controller has no other way to move.
//   - `ConnectionStateMachine.to()` throws on an edge that is not in the
//     table. A bug that would silently have produced `idle → connected` is a
//     loud failure at the point of the mistake instead.
//
// Two edges look surprising and are deliberate:
//
//   connected → connecting   The D3 token-refresh fallback (§10.5). When
//                            in-place `connection.reauth` is not available,
//                            core opens a fresh socket instead. That is NOT
//                            `reconnecting`: nothing failed, no backoff is
//                            scheduled, no attempt is counted, and no
//                            `reconnecting` event fires. Routing it through
//                            `reconnecting` is what would make the fallback
//                            visible to the app, and §10.5 requires the
//                            opposite — "the public API contract must not
//                            change based on this backend decision".
//
//   closed → connecting      `closed` is terminal with respect to *automatic*
//                            transitions (§8.1: "no auto-reconnect follows"),
//                            not with respect to the user. §6.2's `connect()`
//                            has one documented behaviour — drive to
//                            `connected` — and nothing in §8.1 says a client
//                            is scrap after `disconnect()`. Only an explicit
//                            `connect()` may take this edge; see
//                            controller.ts, where nothing automatic reaches it.
//
// `idle` has no inbound edges at all: it means "no connection attempted yet"
// (§8.1), and that fact never becomes true again once a connection has been
// attempted. A disconnected client is `closed`, not `idle`.

import type { ChatState, ChatStore, ConnectionState } from '../state/index.js';

/**
 * Every legal edge, keyed by the state being left.
 *
 * A state's own name never appears in its list. Self-transitions are handled
 * as no-ops by {@link ConnectionStateMachine.to} rather than as edges, because
 * "already there" is a different question from "may go there": `connect()`
 * called twice while connecting must be idempotent, and encoding that as a
 * legal `connecting → connecting` edge would also permit a *reset* to
 * connecting from a genuine bug.
 */
export const CONNECTION_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  /** Nothing has been attempted. Only `connect()` and `disconnect()` apply. */
  idle: ['connecting', 'closed'],

  /** Socket opening. It opens (`authenticating`), fails, or is abandoned. */
  connecting: ['authenticating', 'reconnecting', 'suspended', 'closed'],

  /** `connection.hello` written, awaiting `connection.ack` or `error` (§8.1). */
  authenticating: ['connected', 'reconnecting', 'suspended', 'closed'],

  /** Live. `connecting` is the D3 reauth fallback — see the header. */
  connected: ['connecting', 'reconnecting', 'suspended', 'closed'],

  /** A backoff timer is pending. It fires into `connecting`. */
  reconnecting: ['connecting', 'suspended', 'closed'],

  /** Auto-retry stopped. Recoverable only by an explicit `connect()` (§8.1). */
  suspended: ['connecting', 'closed'],

  /**
   * User called `disconnect()`. No automatic edge leaves here — `connecting`
   * is reachable only from an explicit `connect()`.
   */
  closed: ['connecting'],
};

/** Is `from → to` a legal edge? A self-transition is reported as legal (it is a no-op). */
export function canTransition(from: ConnectionState, to: ConnectionState): boolean {
  return from === to || CONNECTION_TRANSITIONS[from].includes(to);
}

/**
 * Thrown when something attempts an edge the table does not contain.
 *
 * This is a programming error in core, never a runtime condition a host app
 * can cause — every externally-reachable entry point (`connect`,
 * `disconnect`, and the three transport callbacks) is guarded so that it can
 * only ever request a legal edge. It exists so that a future change which
 * breaks that property fails at the mistake rather than three states later.
 */
export class IllegalConnectionTransitionError extends Error {
  readonly from: ConnectionState;
  readonly to: ConnectionState;

  constructor(from: ConnectionState, to: ConnectionState) {
    super(`Illegal connection state transition: ${from} -> ${to}`);
    this.name = 'IllegalConnectionTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Notified after a legal, non-no-op transition has been written to the store. */
export type ConnectionTransitionListener = (to: ConnectionState, from: ConnectionState) => void;

/**
 * Owns `ChatState.connectionState`.
 *
 * The current state is held here rather than read back from the store on each
 * access, and that is not redundancy. `ChatStore.getState()` returns the
 * snapshot *being delivered* while a notification pass is in flight, so a
 * transition made from inside a subscriber — entirely possible, since a
 * binding may call `disconnect()` from a state listener — would be followed
 * by a read of the pre-transition snapshot. The machine would then compute its
 * next edge from a state it had already left. Holding the value makes this
 * module the authority and the store the projection, which is the direction
 * the ownership actually runs.
 */
export class ConnectionStateMachine {
  #state: ConnectionState;
  readonly #store: ChatStore;
  readonly #onTransition: ConnectionTransitionListener | undefined;

  constructor(store: ChatStore, onTransition?: ConnectionTransitionListener) {
    this.#store = store;
    this.#state = store.getState().connectionState;
    this.#onTransition = onTransition;
  }

  /** The authoritative current state. */
  get state(): ConnectionState {
    return this.#state;
  }

  /** Is `to` reachable from here in one legal edge? */
  canGoTo(to: ConnectionState): boolean {
    return canTransition(this.#state, to);
  }

  /**
   * Moves to `next`, writing it through to the store.
   *
   * Returns `false` when `next` is the current state (a no-op: no store write,
   * no listener call), `true` when the move happened.
   *
   * @throws {IllegalConnectionTransitionError} when the edge is not in
   *   {@link CONNECTION_TRANSITIONS}.
   */
  to(next: ConnectionState): boolean {
    const from = this.#state;
    if (from === next) return false;

    if (!CONNECTION_TRANSITIONS[from].includes(next)) {
      throw new IllegalConnectionTransitionError(from, next);
    }

    // Local field first: a store subscriber that reacts synchronously must
    // observe a machine that has already moved, not one mid-transition.
    this.#state = next;
    this.#store.setState({ connectionState: next } satisfies Partial<ChatState>);
    this.#onTransition?.(next, from);
    return true;
  }
}
