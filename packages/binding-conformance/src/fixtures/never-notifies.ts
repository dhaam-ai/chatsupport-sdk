// Negative fixture #1 — "one that never notifies" (task brief, "Make it
// impossible to pass vacuously").
//
// A binding whose `observeState` subscribes to the client (so it looks
// wired up) but never actually updates the value it hands back — the
// `useSyncExternalStore` return-a-stale-snapshot failure mode, just at the
// binding level instead of the selector-caching level. Diff from
// minimal-reference-adapter.ts: the `client.subscribe` callback below is a
// no-op instead of recomputing `current`.
//
// Expected to be caught by: state-delivery-reaches-subscribers (and, by
// extension, most of the state-delivery/selector-semantics/tick checks,
// which all depend on a change actually reaching the view).

import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';

import type { BindingAdapter, BindingHandle, EventView, StateView } from '../types.js';

export function createNeverNotifiesAdapter(): BindingAdapter {
  return {
    name: 'never-notifies',
    mount(client: ChatClient): BindingHandle {
      const disposers = new Set<() => void>();

      function observeState<T>(selector: (state: ChatState) => T): StateView<T> {
        const frozenValue = selector(client.getState());

        // Subscribes — so a shallow "did it call client.subscribe?" check
        // would find nothing wrong — but the callback deliberately does
        // nothing with the new state.
        const unsubscribe = client.subscribe(() => {
          /* intentionally does not recompute or store the new value */
        });

        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          unsubscribe();
        };
        disposers.add(dispose);

        return {
          value: () => frozenValue,
          updateCount: () => 0,
          crashed: () => false,
          dispose,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        // Events aren't this fixture's bug — wire them correctly so the
        // event-delivery checks fail for the RIGHT reason if this fixture
        // is ever pointed at them, rather than masking the intended bug.
        const received: unknown[] = [];
        const unsubscribe = client.on(event, (payload) => {
          received.push(payload);
        });
        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          unsubscribe();
        };
        disposers.add(dispose);
        return { received: () => received.slice() as never, dispose };
      }

      return {
        observeState,
        observeEvent,
        settle: () => Promise.resolve(),
        unmount: () => {
          for (const dispose of [...disposers]) dispose();
        },
      };
    },
  };
}
