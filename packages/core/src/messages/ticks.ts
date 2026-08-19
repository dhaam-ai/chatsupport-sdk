// The one derivation of a message's delivery tick — PRD §6.4
// (`ChatMessage.delivery`, `readWatermarks`, `deliveredWatermarks`), §9.5
// (the watermark model), D2 (`seq` is the ordering key).
//
// ---------------------------------------------------------------------------
// Why this is a function in core and not four functions in four bindings
// ---------------------------------------------------------------------------
//
// React, Vue, Angular, and vanilla all render the same tick. Every input it
// needs is already in `ChatState`, so each binding *could* compute it — and
// that is exactly the problem: four independent implementations of a
// four-state rule with two different watermark keys will disagree, and they
// will disagree in the direction that is hardest to notice (a tick that is
// one state behind on one framework only). This module exists so there is
// one implementation, one set of edge cases, and one conformance target.
//
// It is a pure function of its arguments: no store, no clock, no I/O. Given
// the same message and the same watermarks it returns the same answer, which
// is what lets a binding call it inside a render pass and a conformance suite
// call it in a table test.
//
// ---------------------------------------------------------------------------
// The bug this replaces
// ---------------------------------------------------------------------------
//
// v1 rendered the double-grey tick from presence — "the other party is
// connected". Connectivity is not delivery: a participant can be connected
// and not yet caught up (the frames are still in flight, or they reconnected
// and their replay has not been applied), and can be disconnected having
// received everything. `ChatState.presence` is deliberately unreachable from
// this function's inputs so the mistake cannot be made here again; delivery
// is only ever `deliveredWatermarks`, which says what a participant actually
// has.

import type { ChatMessage, ChatState } from '../state/index.js';

/**
 * The four tick states, weakest to strongest.
 *
 * Exported as a runtime array in the same spirit as `CONNECTION_STATE_VALUES`
 * and `CHAT_EVENT_NAMES`: a binding mapping states to icons, and a
 * conformance suite enumerating them, both need the list as a value.
 */
export const MESSAGE_TICK_STATES = ['pending', 'sent', 'delivered', 'read'] as const;

export type MessageTickState = (typeof MESSAGE_TICK_STATES)[number];

/**
 * Everything {@link deriveTickState} reads, and nothing else.
 *
 * A single options object rather than positional arguments: four bindings
 * will call this, two of the fields are `Record`s that would be trivially
 * swappable positionally, and the two watermark maps are named exactly as
 * they are on `ChatState`, so the call site reads as a projection of state
 * rather than a re-ordering of it.
 */
export interface TickInput {
  readonly message: ChatMessage;

  /**
   * Who "we" are. Ticks describe our own outgoing messages, and both the
   * `delivered` and `read` rules turn on *some other* participant — so
   * without this id there is no way to tell our own watermark from someone
   * else's, and our own would satisfy every rule the instant we reported it.
   *
   * `null` (identity not yet known) therefore yields `null` for every
   * message: a conservative no-tick, never a guessed one. Notably this does
   * NOT fall back to "sender type is CUSTOMER" — that heuristic is fine for
   * counting unread messages, where being wrong costs a badge, but here it
   * would make an agent-side embed show ticks on the customer's messages.
   */
  readonly localParticipantId: string | null;

  /** `ChatState.deliveredWatermarks` — participantId → highest `seq` held. */
  readonly deliveredWatermarks: Readonly<Record<string, number>>;

  /** `ChatState.readWatermarks` — participantId → ISO-8601 instant. */
  readonly readWatermarks: Readonly<Record<string, string>>;
}

/**
 * The tick to render for one message, or `null` for no tick at all.
 *
 * The four states and their conditions, evaluated strongest-first so a
 * message that satisfies several reports the furthest it has got:
 *
 * | State       | Condition                                                  |
 * |-------------|------------------------------------------------------------|
 * | `read`      | some other participant's read watermark covers `createdAt`  |
 * | `delivered` | some other participant's `deliveredUpToSeq >= seq`          |
 * | `sent`      | has `seq`, and no other participant's watermark reaches it  |
 * | `pending`   | `delivery.state === 'queued'` — not yet acked               |
 *
 * `pending` is tested first in the code below rather than last, because a
 * queued message has no `seq` at all and so cannot satisfy any other row;
 * testing it first is what makes the remaining three rows able to assume a
 * `seq` exists.
 *
 * **`null` is returned in four cases, all of them deliberate:**
 *
 *  1. The message is not ours. §6.4 has no tick concept for someone else's
 *     message — their client renders that.
 *  2. `localParticipantId` is `null`. See {@link TickInput}.
 *  3. `delivery.state === 'failed'`. The table has no row for it, and a tick
 *     is the wrong affordance: §6.4 already gives a binding
 *     `delivery.reason`, which is what a retry button needs. Rendering
 *     `pending`'s spinner forever, or `sent`'s single tick, would both claim
 *     something untrue about a message that will never arrive.
 *  4. The message has no `seq` and is not queued — reachable when the server
 *     acks a send without one (`MessageController` clears `delivery` and
 *     records nothing). With no ordering key, no watermark can ever cover it,
 *     so there is no honest tick to show; `sent`'s row requires a `seq` and
 *     this deliberately does not widen it.
 *
 * Read state is compared on `createdAt` and delivery on `seq` — not an
 * inconsistency but the two watermarks' actual keys (§9.5 fixed read
 * watermarks as `lastReadAt` instants; delivery is `seq` per D2, because
 * `deliveredAt` from another participant's clock is not comparable to
 * anything).
 */
export function deriveTickState(input: TickInput): MessageTickState | null {
  const { message, localParticipantId } = input;

  if (localParticipantId === null) return null;
  if (message.senderId !== localParticipantId) return null;

  if (message.delivery?.state === 'failed') return null;
  if (message.delivery?.state === 'queued') return 'pending';

  const seq = message.seq;
  if (seq === undefined) return null;

  if (hasOtherRead(input, message.createdAt)) return 'read';
  if (hasOtherDelivered(input, seq)) return 'delivered';
  return 'sent';
}

/**
 * Convenience projection: derive straight from a `ChatState` snapshot.
 *
 * Exists so the common call site is `deriveTickStateFromState(state, message,
 * localParticipantId)` instead of hand-copying two field names out of state
 * in every binding — which is the same copying this module exists to
 * eliminate. It is a one-line wrapper over {@link deriveTickState}, which
 * stays the canonical entry point for a conformance suite feeding synthetic
 * watermarks.
 */
export function deriveTickStateFromState(
  state: Pick<ChatState, 'deliveredWatermarks' | 'readWatermarks'>,
  message: ChatMessage,
  localParticipantId: string | null,
): MessageTickState | null {
  return deriveTickState({
    message,
    localParticipantId,
    deliveredWatermarks: state.deliveredWatermarks,
    readWatermarks: state.readWatermarks,
  });
}

/**
 * Whether any participant other than us holds `seq`.
 *
 * "Other than us" is load-bearing, not defensive: core advances our own
 * delivery watermark the moment `markDelivered()` is called, so counting it
 * would tick every one of our own messages `delivered` against nothing but
 * our own receipt.
 */
function hasOtherDelivered(input: TickInput, seq: number): boolean {
  for (const [participantId, watermark] of Object.entries(input.deliveredWatermarks)) {
    if (participantId === input.localParticipantId) continue;
    if (watermark >= seq) return true;
  }
  return false;
}

/**
 * Whether any participant other than us has read past `createdAt`.
 *
 * Inclusive (`>=`), matching `WatermarkTracker.hasAgentRead`: a watermark
 * means "read up to and including this instant". Compared as parsed instants
 * rather than as strings, for the reason watermarks.ts's header gives — an
 * ISO-8601 string with a `+hh:mm` offset can sort differently as text than as
 * a moment in time. An unparseable value on either side is treated as not
 * covering, so a malformed timestamp can only ever under-report the tick.
 */
function hasOtherRead(input: TickInput, createdAt: string): boolean {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;

  for (const [participantId, watermark] of Object.entries(input.readWatermarks)) {
    if (participantId === input.localParticipantId) continue;
    const watermarkMs = Date.parse(watermark);
    if (Number.isNaN(watermarkMs)) continue;
    if (watermarkMs >= createdMs) return true;
  }
  return false;
}
