// A tiny, deliberately-correct, framework-free `BindingAdapter` — the
// shared base every negative fixture in this directory is a one-line-broken
// variant of, and, run through `runBindingConformance` in this package's
// own tests, a second independent proof (alongside the real
// `@dhaam-ccrm/react` adapter under test/) that the suite is satisfiable at
// all by a correct implementation, not just tuned to React's specific
// internals.
//
// This is intentionally NOT how a real framework binding should be
// structured (no signals, no fine-grained reactivity primitive of its
// own) — it exists purely to let each negative fixture demonstrate exactly
// one bug at a time by overriding exactly one piece of otherwise-correct
// behaviour. See never-notifies.ts / mutates-in-place.ts / leaks-listeners.ts.

import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';

import type { BindingAdapter, BindingHandle, EventView, StateView } from '../types.js';

export function createMinimalReferenceAdapter(name = 'minimal-reference'): BindingAdapter {
  return {
    name,
    mount(client: ChatClient): BindingHandle {
      const disposers = new Set<() => void>();

      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        let current = selector(client.getState());
        let updateCount = 0;
        let crashed = false;

        const unsubscribe = client.subscribe((state) => {
          try {
            const next = selector(state);
            if (!isEqual(current, next)) {
              current = next;
              updateCount += 1;
            }
          } catch {
            // A conformant binding must not let one consumer's throw take
            // down a sibling's subscription — contain it to this view.
            crashed = true;
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
          value: () => {
            if (crashed) throw new Error('minimal-reference-adapter: this view crashed and has no current value');
            return current;
          },
          updateCount: () => updateCount,
          crashed: () => crashed,
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

        return {
          received: () => received.slice() as never,
          dispose,
        };
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
