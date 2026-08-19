// Negative fixture #3 — "one that leaks listeners on unmount" (task brief,
// "Make it impossible to pass vacuously").
//
// A binding that subscribes/updates correctly (so every state-delivery and
// selector-semantics check passes) but whose `dispose`/`unmount` never call
// the `Unsubscribe` function `client.subscribe`/`client.on` returned — the
// bug is isolated entirely to teardown, on purpose, so it can only be
// caught by the lifecycle checks and nothing else, proving those checks are
// pulling their own weight rather than piggybacking on a state-delivery
// failure.
//
// Diff from minimal-reference-adapter.ts: `dispose`/`unmount` never invoke
// the stored unsubscribe callbacks.
//
// Expected to be caught by: lifecycle-unmount-unsubscribes,
// lifecycle-mount-unmount-remount-leaks-nothing.

import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';

import type { BindingAdapter, BindingHandle, EventView, StateView } from '../types.js';

export function createLeaksListenersAdapter(): BindingAdapter {
  return {
    name: 'leaks-listeners',
    mount(client: ChatClient): BindingHandle {
      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        let current = selector(client.getState());
        let updateCount = 0;

        // Subscribes correctly...
        client.subscribe((state) => {
          const next = selector(state);
          if (!isEqual(current, next)) {
            current = next;
            updateCount += 1;
          }
        });

        return {
          value: () => current,
          updateCount: () => updateCount,
          crashed: () => false,
          // ...but never calls the returned Unsubscribe. Deliberately no-op.
          dispose: () => {},
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        const received: unknown[] = [];
        client.on(event, (payload) => {
          received.push(payload);
        });
        return {
          received: () => received.slice() as never,
          // Same bug, same reason.
          dispose: () => {},
        };
      }

      return {
        observeState,
        observeEvent,
        settle: () => Promise.resolve(),
        // Same bug at the handle level too — nothing to unsubscribe from
        // here since every view already leaked its own subscription.
        unmount: () => {},
      };
    },
  };
}
