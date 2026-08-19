// The reference `BindingAdapter` for the REAL `@dhaam-ccrm/react` package —
// not a fixture, the thing under test. Deliberately lives under test/, not
// src/: src/index.ts's own header explains why (this package's dependency
// graph should be proof, not just policy, that "React appears only in its
// own adapter/fixture" and never in the framework-agnostic suite itself).
//
// Every observation goes through react's own public hooks
// (`ChatProvider`/`useChatSelector`/`useChatClient`) exactly as a real app
// would use them — never through `client` directly — so this is testing
// react's actual reactivity mapping, not a stand-in for it.
//
// Each `observeState`/`observeEvent` call mounts its OWN independent
// `render()` tree (its own container) rather than adding to a shared tree.
// This is what gives sibling views real isolation: a selector that throws
// during ONE view's render crashes only that view's own React root, not a
// neighboring view's — which is what lets
// lifecycle-throwing-view-does-not-starve-siblings actually test something
// about the client's listener bookkeeping surviving a crash, not about
// React's error-boundary behavior.
//
// `Probe` is wrapped in a minimal error boundary (`ProbeErrorBoundary`
// below). This is NOT working around a `@dhaam-ccrm/react` bug — it is
// standard React practice, and there is no other way to contain a
// render-time throw. Confirmed empirically while building this adapter:
// with no boundary, a selector throwing inside `useChatSelector` (via
// `useSyncExternalStore`) surfaces as an *uncaught global exception*
// through jsdom/React 18 dev mode's guarded-callback event dispatch —
// bypassing a surrounding try/catch entirely — which crashes the whole
// vitest run, not just the one view. `@dhaam-ccrm/react`'s hooks cannot fix
// this themselves (a library hook cannot install an error boundary around
// its caller's render); it is inherent to how React reports an uncaught
// render error with no boundary present anywhere in the tree. See this
// package's final report for the write-up — flagged there as a nuance for
// T20/T21/T22, since other frameworks may contain a throwing consumer by
// default without requiring the app to opt in the way React does.

import { ChatProvider, useChatClient, useChatSelector } from '@dhaam-ccrm/react';
import type { ChatClient, ChatEventName, ChatState } from '@dhaam-ccrm/core';
import { act, render } from '@testing-library/react';
import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';

import type { BindingAdapter, BindingHandle, EventView, StateView } from '../src/types.js';
import { h } from './h.js';

interface ProbeErrorBoundaryProps {
  onError: (error: unknown) => void;
  children?: ReactNode;
}

interface ProbeErrorBoundaryState {
  crashed: boolean;
}

class ProbeErrorBoundary extends Component<ProbeErrorBoundaryProps, ProbeErrorBoundaryState> {
  override state: ProbeErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ProbeErrorBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

export function createReactAdapter(): BindingAdapter {
  return {
    name: 'react',
    mount(client: ChatClient): BindingHandle {
      const disposers = new Set<() => void>();

      function observeState<T>(selector: (state: ChatState) => T, isEqual: (a: T, b: T) => boolean = Object.is): StateView<T> {
        let latestValue: T;
        let renderCount = -1;
        let crashed = false;
        let crashError: unknown;

        function Probe(): null {
          const value = useChatSelector(selector, isEqual);
          latestValue = value;
          renderCount += 1;
          return null;
        }

        const handleError = (error: unknown) => {
          crashed = true;
          crashError = error;
        };

        let reactUnmount: (() => void) | null = null;
        try {
          const result = render(h(ChatProvider, { client }, h(ProbeErrorBoundary, { onError: handleError }, h(Probe))));
          reactUnmount = result.unmount;
        } catch (error) {
          crashed = true;
          crashError = error;
        }

        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          if (reactUnmount) {
            try {
              reactUnmount();
            } catch {
              // Tearing down an already-crashed tree can itself throw in
              // React — irrelevant to what this view is being asked to
              // report, so it is not allowed to mask the original crash.
            }
          }
        };
        disposers.add(dispose);

        return {
          value: () => {
            if (crashed) throw crashError;
            return latestValue;
          },
          updateCount: () => Math.max(renderCount, 0),
          crashed: () => crashed,
          dispose,
        };
      }

      function observeEvent<E extends ChatEventName>(event: E): EventView<E> {
        const received: unknown[] = [];

        function EventProbe(): null {
          const eventClient = useChatClient();
          useEffect(() => eventClient.on(event, (payload) => received.push(payload)), [eventClient]);
          return null;
        }

        const result = render(h(ChatProvider, { client }, h(EventProbe)));

        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(dispose);
          result.unmount();
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
        // Flushes React's effect queue and any update `client.subscribe`'s
        // callback scheduled — the react-binding half of settling; the
        // suite calls `client.__harness.flushMicrotasks()` for the
        // harness's own half first.
        settle: () => act(async () => {}),
        unmount: () => {
          for (const dispose of [...disposers]) dispose();
        },
      };
    },
  };
}
