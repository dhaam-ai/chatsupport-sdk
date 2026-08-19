// The `BindingAdapter` for the real `@dhaam-ccrm/vue` package — not a fixture,
// the thing under test. Every observation goes through this package's own
// public composables (`createChatPlugin`/`useChatSelector`/`useChatEvent`/
// `useMessageTicks`) exactly as an app would use them, never through `client`
// directly, so this exercises Vue's actual reactivity mapping rather than a
// stand-in for it.
//
// Each `observeState`/`observeEvent` call mounts its OWN component in its OWN
// app (`@vue/test-utils`' `mount` creates one per call), mirroring the React
// adapter's per-view `render()` tree. That is what gives sibling views real
// isolation: `BindingHandle`'s contract says one view's selector throwing must
// not starve a sibling, and two views sharing one component instance could not
// demonstrate that.
//
// Note what the React adapter needed and this one does not: an error boundary.
// React reports an uncaught render-time throw through a global error channel
// that a surrounding try/catch cannot see, so its adapter had to install a
// `componentDidCatch` boundary. Vue never runs a selector during render — this
// binding runs it inside the `subscribe` callback (see
// src/use-chat-selector.ts) — so a throwing selector surfaces through
// `ChatStore`'s own per-listener isolation, which is exactly the mechanism the
// lifecycle check is about. `crashed()` below is therefore only ever true for a
// selector that throws on its very first call, during `setup()`.

import type { ChatClient, ChatEventMap, ChatEventName, ChatState, MessageTickState } from '@dhaam-ccrm/core';
import type { BindingAdapter, BindingHandle, EventView, MirroredMessageTickState, StateView } from '@dhaam-ccrm/binding-conformance';
import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';

import { createChatPlugin, useChatEvent, useChatSelector, useMessageTicks } from '../src/index.js';

/** `mount()` needs the client in the app's injection context; the plugin is this package's own documented way to put it there. */
function mountWithClient(component: ReturnType<typeof defineComponent>, client: ChatClient): VueWrapper {
  return mount(component, { global: { plugins: [createChatPlugin(client)] } });
}

export function createVueAdapter(): BindingAdapter {
  // `computeTick` is handed a `BindingHandle`, not the client — so the handle
  // has to be able to lead back to the client it was mounted against. A
  // `WeakMap` rather than an extra property on the handle keeps the object the
  // suite sees exactly the `BindingHandle` interface and nothing more.
  const clientsByHandle = new WeakMap<BindingHandle, ChatClient>();

  return {
    name: 'vue',

    mount(client: ChatClient): BindingHandle {
      const disposers = new Set<() => void>();

      function track(dispose: () => void): () => void {
        disposers.add(dispose);
        return dispose;
      }

      function observeState<T>(
        selector: (state: ChatState) => T,
        isEqual: (a: T, b: T) => boolean = Object.is,
      ): StateView<T> {
        let latest: T;
        // Starts at -1 so the initial render lands on 0: `updateCount` counts
        // changes *after* mount, per StateView's contract.
        let renderCount = -1;
        let crashed = false;
        let crashError: unknown;

        const Probe = defineComponent({
          name: 'StateProbe',
          setup() {
            const value = useChatSelector(selector, isEqual);
            return () => {
              renderCount += 1;
              latest = value.value;
              return null;
            };
          },
        });

        let wrapper: VueWrapper | null = null;
        try {
          wrapper = mountWithClient(Probe, client);
        } catch (error) {
          // Only reachable when `selector` throws on its first call, inside
          // `setup()` — see this file's header.
          crashed = true;
          crashError = error;
        }

        let disposed = false;
        const dispose = track(() => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          try {
            wrapper?.unmount();
          } catch {
            // Tearing down an already-crashed tree can itself throw; that is
            // irrelevant to what this view reports and must not mask the
            // original crash.
          }
        });

        return {
          value: () => {
            if (crashed) throw crashError;
            return latest;
          },
          updateCount: () => Math.max(renderCount, 0),
          crashed: () => crashed,
          dispose,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        const received: ChatEventMap[E][] = [];

        const Probe = defineComponent({
          name: 'EventProbe',
          setup() {
            useChatEvent(event, (payload) => {
              received.push(payload);
            });
            return () => null;
          },
        });

        const wrapper = mountWithClient(Probe, client);

        let disposed = false;
        const dispose = track(() => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          wrapper.unmount();
        });

        return {
          received: () => received.slice(),
          dispose,
        };
      }

      const handle: BindingHandle = {
        observeState,
        observeEvent,
        // Vue's scheduler flushes component updates on a microtask. The suite
        // awaits the harness's own store flush first (which is what runs our
        // `subscribe` callback and writes the shallowRef); `nextTick()` then
        // waits for the render jobs that write queued.
        settle: () => nextTick(),
        unmount: () => {
          for (const dispose of [...disposers]) dispose();
        },
      };

      clientsByHandle.set(handle, client);
      return handle;
    },

    /**
     * Wires `useMessageTicks` into the suite's tick battery.
     *
     * The React binding declines this hook (an app there calls
     * `deriveTickState` itself), so this is the first binding whose own tick
     * convenience is checked against core's canonical derivation — which is the
     * check the permanent `wrong-ticks` fixture exists to prove can fail.
     * `useMessageTicks` calls `deriveTickStateFromState` verbatim, so agreement
     * here is structural rather than lucky; the check earns its keep by failing
     * the moment somebody "optimizes" that call away.
     */
    computeTick(handle: BindingHandle, messageId: string, localParticipantId: string | null): MirroredMessageTickState | null {
      const client = clientsByHandle.get(handle);
      if (client === undefined) {
        throw new Error('createVueAdapter(): computeTick received a handle this adapter did not mount.');
      }

      let tick: MessageTickState | undefined;

      const Probe = defineComponent({
        name: 'TickProbe',
        setup() {
          const ticks = useMessageTicks(localParticipantId);
          return () => {
            tick = ticks.value.get(messageId);
            return null;
          };
        },
      });

      const wrapper = mountWithClient(Probe, client);
      wrapper.unmount();

      // A message with no tick is absent from the map (see MessageTicks) —
      // which is the same statement as `deriveTickState` returning `null`.
      return tick ?? null;
    },
  };
}
