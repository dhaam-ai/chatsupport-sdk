// Negative fixture #4 — "one that reimplements ticks slightly wrong" (task
// brief, "Make it impossible to pass vacuously").
//
// State/event handling is correct (delegates to
// minimal-reference-adapter.ts) — the ONLY bug is a binding-owned
// `computeTick` that reproduces the exact historical mistake
// packages/core/src/messages/ticks.ts's own module header calls out by
// name: "v1 rendered the double-grey tick from presence — 'the other party
// is connected'. Connectivity is not delivery." This derives `delivered`
// from `ChatState.presence` instead of `deliveredWatermarks`, and never
// derives `read` at all (ignores `readWatermarks` entirely) — a plausible,
// not-a-strawman bug: presence-based "delivered" reads correctly in a demo
// where the other party is always online, which is exactly how this class
// of bug survives review.
//
// Expected to be caught by: tick-derivation-binding-owned-computation-agrees-with-core.

import type { ChatClient } from '@dhaam-ccrm/core';

import type { BindingAdapter, BindingHandle, MirroredMessageTickState } from '../types.js';
import { createMinimalReferenceAdapter } from './minimal-reference-adapter.js';

const correctAdapter = createMinimalReferenceAdapter('wrong-ticks-base');

export function createWrongTicksAdapter(): BindingAdapter {
  return {
    name: 'wrong-ticks',
    mount(client: ChatClient): BindingHandle {
      return correctAdapter.mount(client);
    },
    computeTick(handle: BindingHandle, messageId: string, localParticipantId: string | null): MirroredMessageTickState | null {
      const view = handle.observeState((s) => s);
      const state = view.value();
      view.dispose();

      const message = state.messages.find((m) => m.id === messageId);
      if (!message) return null;

      if (localParticipantId === null) return null;
      if (message.senderId !== localParticipantId) return null;

      if (message.delivery?.state === 'failed') return null;
      if (message.delivery?.state === 'queued') return 'pending';

      if (message.seq === undefined) return null;

      // THE BUG: presence, not deliveredWatermarks/readWatermarks.
      const anotherParticipantIsOnline = Object.values(state.presence).some(
        (entry) => entry.participantId !== localParticipantId && entry.status === 'ONLINE',
      );
      if (anotherParticipantIsOnline) return 'delivered';

      return 'sent';
    },
  };
}
