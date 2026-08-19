// The `BindingAdapter` for the REAL `@dhaam-ccrm/angular` package — not a
// fixture, the thing under test. Every observation goes through the package's
// own public surface (`provideChatClient` → `inject(CHAT_STORE)` →
// `select`/`on`/`tickState`), exactly as an Angular app would, never through
// `client` directly.
//
// Two design notes the other bindings' adapters do not have to make:
//
// 1. A `StateView` is an `effect()` reading a `select()` signal. That is the
//    faithful stand-in for an Angular consumer: a template binding is also a
//    reactive consumer that reads the signal and is re-run when — and only
//    when — the signal's version changes. Because `select()` builds
//    `computed(fn, { equal })`, a selector whose value did not change never
//    bumps a version and therefore never re-runs this effect, which is what
//    `updateCount()` measures. Nothing here recomputes the selector on the
//    suite's behalf.
//
// 2. Every view mounted from one handle shares ONE `EnvironmentInjector` and
//    therefore one `ChatStore` — which is the point, not a shortcut: it is
//    what makes `lifecycle-throwing-view-does-not-starve-siblings` a real test
//    of this binding. Sibling isolation here is not "two independent trees
//    never interfere"; it is "one shared `client.subscribe` registration and
//    one shared state signal survive a consumer throwing", which is the case a
//    single-store binding can actually get wrong.

import { CHAT_STORE, provideChatClient } from '../src/index.js';
import type { ChatStore } from '../src/index.js';
import type { BindingAdapter, BindingHandle, EventView, MirroredMessageTickState, StateView } from '@dhaam-ccrm/binding-conformance';
import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';
import { effect } from '@angular/core';

import { createAngularTestHost } from './angular-test-host.js';

/** The handle this adapter returns, widened with the store so `computeTick` can reach it. */
interface AngularBindingHandle extends BindingHandle {
  readonly store: ChatStore;
}

export function createAngularAdapter(): BindingAdapter {
  return {
    name: 'angular',

    mount(client: ChatClient): BindingHandle {
      const host = createAngularTestHost([provideChatClient(client)]);
      // Eager, so the store's single `client.subscribe` registration exists
      // from `mount()` and is gone after `unmount()` — the lifecycle checks
      // measure exactly that.
      const store = host.injector.get(CHAT_STORE);

      const disposers = new Set<() => void>();

      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        const selected = store.select(selector, isEqual);

        let latest!: T;
        let runs = -1;
        let crashed = false;
        let crashError: unknown;

        const ref = effect(
          () => {
            try {
              latest = selected();
            } catch (error) {
              // A selector is allowed to throw. Angular caches the throw on
              // the computed and re-throws it on every read until its
              // producers change, so a real component would see exactly this.
              // Contained to this view: sticky, like a React error boundary.
              crashed = true;
              crashError = error;
            }
            runs += 1;
          },
          { injector: host.injector },
        );

        // The consumer's first read. A component renders synchronously on
        // creation too, so the initial value must be available before the
        // suite's first `settle()`.
        host.flushEffects();

        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          ref.destroy();
        };
        disposers.add(dispose);

        return {
          value: () => {
            if (crashed) throw crashError;
            return latest;
          },
          updateCount: () => Math.max(runs, 0),
          crashed: () => crashed,
          dispose,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        const received: unknown[] = [];
        // Deliberately called with no ambient injection context — the suite
        // mounts consumers from plain functions. `on()` must degrade to
        // caller-owned teardown rather than throwing NG0203.
        const unsubscribe = store.on(event, (payload) => {
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

      const handle: AngularBindingHandle = {
        store,
        observeState,
        observeEvent,
        // The DOM-free equivalent of a change-detection pass: run every
        // consumer Angular marked dirty. The suite has already flushed the
        // client's own microtask before calling this.
        settle: async () => {
          host.flushEffects();
        },
        unmount: () => {
          for (const dispose of [...disposers]) dispose();
          host.destroy();
        },
      };

      return handle;
    },

    // Wired up because this binding DOES offer its own tick convenience
    // (`ChatStore.tickState`), so the suite gets to prove it agrees with
    // core's canonical derivation rather than taking the delegation on trust.
    computeTick(handle: BindingHandle, messageId: string, localParticipantId: string | null): MirroredMessageTickState | null {
      const { store } = handle as AngularBindingHandle;
      return store.tickState(messageId, localParticipantId)();
    },
  };
}
