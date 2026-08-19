// Negative fixture #2 — "one that mutates its snapshot in place" (task
// brief, "Make it impossible to pass vacuously").
//
// A binding that keeps its own local `ChatState`-shaped cache and, on each
// notification, MUTATES that cache's `messages` array in place — appending
// the incoming array's contents rather than replacing the reference — while
// every other field is (correctly) replaced wholesale. This is the "treated
// a full snapshot as an incremental patch" bug class: exactly what §6.4
// forbids ("the full new state... never a diff or patch") and what
// core's own store.ts contract exists to prevent a binding from doing to
// ITSELF, since core can guarantee its own snapshots are immutable but
// cannot stop a binding from copying one into a mutable cache and abusing
// it afterwards.
//
// Diff from minimal-reference-adapter.ts: `observeState` reads through a
// locally-mutated `messages` mirror instead of the raw incoming state.
//
// Expected to be caught by: ordering-dedup-replayed-ulid-does-not-duplicate
// (a second update to `messages` — even one that core computed correctly,
// e.g. via `upsertMessage` — gets appended on top of the first instead of
// replacing it, so a "replay" duplicates through this binding even though
// core's own array never did).

import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';

import type { BindingAdapter, BindingHandle, EventView, StateView } from '../types.js';

export function createMutatesInPlaceAdapter(): BindingAdapter {
  return {
    name: 'mutates-in-place',
    mount(client: ChatClient): BindingHandle {
      const disposers = new Set<() => void>();

      // The binding's own mutable mirror — deliberately a *copy*, not the
      // frozen reference `client.getState()` returns, which is exactly what
      // lets it be mutated at all.
      let cache: ChatState = { ...client.getState(), messages: [...client.getState().messages] };

      function applyIncoming(next: ChatState): void {
        const nextCache = { ...cache };
        for (const key of Object.keys(next) as (keyof ChatState)[]) {
          if (key === 'messages') {
            // The bug: accumulate instead of replace.
            nextCache.messages = [...nextCache.messages, ...next.messages];
          } else {
            (nextCache as Record<string, unknown>)[key] = next[key];
          }
        }
        cache = nextCache;
      }

      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        let current = selector(cache);
        let updateCount = 0;

        const unsubscribe = client.subscribe((state) => {
          applyIncoming(state);
          const next = selector(cache);
          if (!isEqual(current, next)) {
            current = next;
            updateCount += 1;
          }
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
          value: () => current,
          updateCount: () => updateCount,
          crashed: () => false,
          dispose,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
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
