// The zone.js half of the binding, tested against a REAL `NgZone` with real
// zone.js loaded — because the failure this guards against is invisible to
// every other test in this package.
//
// The bug: a `message` frame arrives on a socket callback outside Angular's
// zone, this binding writes the state signal there, and in an application
// configured with `provideZoneChangeDetection({ ignoreChangesOutsideZone: true })`
// no change detection is scheduled — the data is correct, the signals are
// correct, every test is green, and the UI silently never updates.
//
// zone.js is imported for its side effect (patching the global task
// primitives) and is a devDependency only: the shipped package never imports
// it, and `NgZone.isInAngularZone()` is simply `false` when it was never
// loaded, which is exactly the right answer for a zoneless app.

import 'zone.js';

import { NgZone } from '@angular/core';
import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import { describe, expect, it } from 'vitest';

import { createChatStore } from '../src/index.js';
import type { ZoneRunner } from '../src/index.js';

/** Records every `run()` and whether Angular's zone was already active when it happened. */
function recordingZone(zone: NgZone): { runner: ZoneRunner; runs: boolean[]; insideDuringWrite: boolean[] } {
  const runs: boolean[] = [];
  const insideDuringWrite: boolean[] = [];
  return {
    runs,
    insideDuringWrite,
    runner: {
      run<T>(fn: () => T): T {
        runs.push(NgZone.isInAngularZone());
        return zone.run(() => {
          insideDuringWrite.push(NgZone.isInAngularZone());
          return fn();
        });
      },
    },
  };
}

describe('zone safety', () => {
  it('re-enters the Angular zone when a core notification arrives outside it', async () => {
    const zone = new NgZone({});
    const recorder = recordingZone(zone);
    const client = createConformanceChatClient({ unreadCount: 0 });
    const store = createChatStore(client, { ngZone: recorder.runner });

    // The socket callback case: the state change — and the microtask its
    // notification is batched onto — both originate outside Angular's zone.
    await new Promise<void>((resolve) => {
      zone.runOutsideAngular(() => {
        expect(NgZone.isInAngularZone(), 'precondition: we really are outside the Angular zone').toBe(false);
        client.__harness.setState({ unreadCount: 4 });
        void client.__harness.flushMicrotasks().then(resolve);
      });
    });

    expect(recorder.runs, 'exactly one zone re-entry, and it happened from outside the zone').toEqual([false]);
    expect(recorder.insideDuringWrite, 'the state write itself ran INSIDE the Angular zone').toEqual([true]);
    expect(store.unreadCount(), 'and the value landed').toBe(4);

    store.destroy();
  });

  it('does not re-enter when the notification already arrives inside the Angular zone', async () => {
    const zone = new NgZone({});
    const recorder = recordingZone(zone);
    const client = createConformanceChatClient({ unreadCount: 0 });
    const store = createChatStore(client, { ngZone: recorder.runner });

    await new Promise<void>((resolve) => {
      zone.run(() => {
        expect(NgZone.isInAngularZone(), 'precondition: we really are inside the Angular zone').toBe(true);
        client.__harness.setState({ unreadCount: 9 });
        void client.__harness.flushMicrotasks().then(resolve);
      });
    });

    expect(recorder.runs, 'no redundant re-entry when the zone is already active').toEqual([]);
    expect(store.unreadCount(), 'and the value still landed').toBe(9);

    store.destroy();
  });

  it('updates without any NgZone at all — the zoneless path', async () => {
    const client = createConformanceChatClient({ unreadCount: 0 });
    const store = createChatStore(client, { ngZone: null });

    client.__harness.setState({ unreadCount: 7 });
    await client.__harness.flushMicrotasks();

    expect(store.unreadCount()).toBe(7);
    store.destroy();
  });
});
