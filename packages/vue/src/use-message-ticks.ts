// useMessageTicks — the delivery tick for every message in the list.
//
// ---------------------------------------------------------------------------
// The derivation is core's. This file does not own a single rule of it.
// ---------------------------------------------------------------------------
//
// `deriveTickStateFromState` comes from `@dhaam-ccrm/core`'s public barrel and
// is called verbatim. That is the entire point of the function existing there:
// ticks.ts's own header says "four independent implementations of a four-state
// rule with two different watermark keys will disagree, and they will disagree
// in the direction that is hardest to notice (a tick that is one state behind
// on one framework only)". v1 shipped exactly that bug by deriving the
// double-grey tick from presence — connectivity is not delivery — and the
// binding conformance suite keeps a permanent `wrong-ticks` fixture
// reproducing it.
//
// So: no `if (participant.isOnline)` here, no watermark comparison here, no
// re-derivation of the four states here. If a tick looks wrong, the bug is in
// core/src/messages/ticks.ts and it is wrong identically in every binding —
// which is the property worth having.
//
// ---------------------------------------------------------------------------
// Why this one IS a `computed`
// ---------------------------------------------------------------------------
//
// use-chat-selector.ts argues against `computed` for the source of truth
// (custom equality is not expressible, and value-gated propagation is Vue ≥3.4).
// Neither objection applies to a pure derivation: this maps N messages onto N
// ticks and wants exactly Vue's default behaviour — recompute lazily when the
// inputs change, cache otherwise, and let dependents that never read it pay
// nothing. A list of 500 messages is not walked because a `connectionState`
// changed, and it is not walked twice because two components rendered.
//
// The `localParticipantId` is `MaybeRefOrGetter` so it can itself be reactive:
// it is typically unknown until the session is established, and a tick derived
// against `null` is `null` for every message (ticks.ts's deliberate
// conservative no-tick). Passing a ref means the whole map fills in the moment
// identity is known, with no extra wiring at the call site.

import { deriveTickStateFromState } from '@dhaam-ccrm/core';
import type { ChatMessage, ChatState, MessageTickState } from '@dhaam-ccrm/core';
import { computed, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';

import { shallowEqual, useChatSelector } from './use-chat-selector.js';

/**
 * `messageId → tick`. A message with no tick to render (someone else's message,
 * a failed send, an unknown local identity — see `deriveTickState`'s four
 * documented `null` cases) is simply absent, so `ticks.get(id)` is
 * `MessageTickState | undefined` and a template can `v-if` on it directly.
 */
export type MessageTicks = ReadonlyMap<string, MessageTickState>;

// A `type`, not an `interface`, on purpose: only a type alias gets an implicit
// index signature, which is what lets it satisfy `shallowEqual`'s
// `T extends Record<string, unknown>` constraint without a cast.
type TickInputs = {
  readonly messages: ChatMessage[];
  readonly deliveredWatermarks: Record<string, number>;
  readonly readWatermarks: Record<string, string>;
};

/**
 * The three `ChatState` fields the derivation reads, and nothing else — so a
 * `connectionState`/`typing`/`unreadCount` change does not invalidate the map.
 * This is the one composite selector in the package, hence the one place
 * `shallowEqual` is needed: the literal below is fresh on every call.
 */
function selectTickInputs(state: ChatState): TickInputs {
  return {
    messages: state.messages,
    deliveredWatermarks: state.deliveredWatermarks,
    readWatermarks: state.readWatermarks,
  };
}

export function useMessageTicks(localParticipantId: MaybeRefOrGetter<string | null>): ComputedRef<MessageTicks> {
  const inputs = useChatSelector(selectTickInputs, shallowEqual);

  return computed<MessageTicks>(() => {
    const localId = toValue(localParticipantId);
    const { messages } = inputs.value;

    const ticks = new Map<string, MessageTickState>();
    for (const message of messages) {
      const tick = deriveTickStateFromState(inputs.value, message, localId);
      if (tick !== null) ticks.set(message.id, tick);
    }
    return ticks;
  });
}
