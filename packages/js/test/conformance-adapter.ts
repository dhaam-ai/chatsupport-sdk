// The `BindingAdapter` for @dhaam-ccrm/js — the thing under test, not a
// fixture. Every observation below goes through this package's own public
// barrel (`createChatStore` -> `select`/`on`/`tick`), never through the raw
// `ChatClient`, so what the suite exercises is this binding's actual
// reactivity mapping.
//
// One store per `mount()`, shared by every view that handle creates. That is
// the arrangement a real page has (one store, many widgets reading slices of
// it) and it is the one that makes the sibling-isolation checks mean
// something: the views share a single `client.subscribe` fan-out, so a
// selector that throws in one view is contained by THIS package's try/catch,
// not by separate subscriptions that could never have interfered anyway.
//
// Note what is absent compared to `binding-conformance/test/react-adapter.ts`:
// no error boundary, no `act()`, no jsdom. A throwing selector in a vanilla
// consumer needs no framework-level containment to opt into — it is contained
// by the store's own fan-out — and `settle()` is a no-op because there is no
// render queue between a core notification and the callback it triggers.

import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';
import type {
  BindingAdapter,
  BindingHandle,
  EventView,
  MirroredMessageTickState,
  StateView,
} from '@dhaam-ccrm/binding-conformance';

import { createChatStore } from '../src/index.js';
import type { ChatStore } from '../src/index.js';

export interface JsAdapterOptions {
  /**
   * Collects everything the store routes to `onError` — the throws the suite
   * deliberately provokes (see the lifecycle checks). Supplying a sink also
   * keeps the default `console.error` out of the test output for failures the
   * suite is asserting on purpose.
   */
  readonly errors?: unknown[];
}

export function createJsAdapter(options?: JsAdapterOptions): BindingAdapter {
  const stores = new WeakMap<BindingHandle, ChatStore>();

  return {
    name: 'js',

    mount(client: ChatClient): BindingHandle {
      const store = createChatStore(client, {
        onError: (error) => {
          options?.errors?.push(error);
        },
      });

      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        let crashed = false;
        let crashError: unknown;

        // The selector the store actually runs. Wrapping it is how this probe
        // learns which VIEW threw — `onError` is a store-level sink and by
        // design says nothing about which subscription produced the error.
        // The throw is re-raised so the store's own containment (and its
        // "do not advance `raw` on a failed selector" recovery rule) is what
        // is under test here, not this wrapper.
        const probed = (state: ChatState): T => {
          try {
            return selector(state);
          } catch (error) {
            crashed = true;
            crashError = error;
            throw error;
          }
        };

        let current!: T;
        // `immediate: true` so the initial value arrives through the
        // binding's own delivery path rather than being computed by this
        // probe — `StateView.value()` is specified as "what a real
        // component's render function would see", not a fresh recomputation.
        // That first call is the mount value, which `updateCount` excludes.
        let updateCount = -1;

        const unsubscribe = store.select(
          probed,
          (value) => {
            current = value;
            updateCount += 1;
          },
          { isEqual, immediate: true },
        );

        return {
          value: () => {
            if (crashed) throw crashError;
            return current;
          },
          updateCount: () => updateCount,
          // Sticky, deliberately conservative. This binding actually
          // self-heals — a subscription whose selector threw re-evaluates
          // against the next snapshot, because the store only advances the
          // cached `raw` after a successful call — but "crashed at least
          // once" is the honest thing for a probe to report, and it keeps
          // `value()`'s contract ("a view that crashed has nothing honest to
          // report") intact.
          crashed: () => crashed,
          dispose: unsubscribe,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        const received: unknown[] = [];
        const unsubscribe = store.on(event, (payload) => {
          received.push(payload);
        });

        return {
          received: () => received.slice() as never,
          dispose: unsubscribe,
        };
      }

      const handle: BindingHandle = {
        observeState,
        observeEvent,
        // Nothing to flush: core notifies on a microtask (the suite awaits
        // that itself via `client.__harness.flushMicrotasks()`), and this
        // binding's fan-out to its listeners is synchronous inside that
        // notification. There is no render queue in between.
        settle: () => Promise.resolve(),
        unmount: () => {
          // Idempotent, and it drops every view this handle created —
          // `destroy()` runs every tracked disposer, so individually
          // disposed views are simply already gone.
          store.destroy();
        },
      };

      stores.set(handle, store);
      return handle;
    },

    // Opted in — unlike @dhaam-ccrm/react, which leaves ticks to app code and
    // therefore skips this check. `ChatStore.tick` is a real convenience this
    // package ships, so it is exactly the kind of binding-owned tick
    // computation the `wrong-ticks` fixture exists to catch drifting from
    // core. Wiring it here turns that check on for this binding.
    computeTick(handle: BindingHandle, messageId: string, localParticipantId: string | null): MirroredMessageTickState | null {
      const store = stores.get(handle);
      if (store === undefined) throw new Error('createJsAdapter: computeTick received a handle this adapter did not mount');
      return store.tick(messageId, localParticipantId);
    },
  };
}
