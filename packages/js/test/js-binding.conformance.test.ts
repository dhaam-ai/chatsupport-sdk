// Runs the full @dhaam-ccrm/binding-conformance suite against the real
// @dhaam-ccrm/js package. This is the contract §15 turns into something other
// than prose: four hand-written reactivity mappings will drift, and this is
// the mechanism that catches it.
//
// Node environment, no jsdom: this binding touches no DOM, and running the
// whole suite in a bare Node environment is the standing proof of that claim
// rather than a comment asserting it.

import { createConformanceChatClient, runBindingConformance } from '@dhaam-ccrm/binding-conformance';
import { afterEach, expect, it } from 'vitest';

import { createChatStore } from '../src/index.js';
import { createJsAdapter } from './conformance-adapter.js';

/**
 * A sink for the throws the suite deliberately provokes (see the lifecycle
 * checks and `JsAdapterOptions.errors`). Its only job is to keep the default
 * `console.error` out of the run's output for failures that are the point of
 * the test; the assertion that this binding really does report a consumer's
 * throw lives in the `it` below, which owns its own store.
 */
const errors: unknown[] = [];

afterEach(() => {
  errors.length = 0;
});

runBindingConformance(createJsAdapter({ errors }));

it('routes a throwing selector to onError, and the subscription recovers on the next snapshot', async () => {
  const client = createConformanceChatClient({ unreadCount: 0 });
  const seen: unknown[] = [];
  const store = createChatStore(client, { onError: (error) => seen.push(error) });

  const boom = new Error('selector boom');
  let delivered = 0;
  store.select(
    (state) => {
      if (state.unreadCount === 1) throw boom;
      return state.unreadCount;
    },
    () => {
      delivered += 1;
    },
  );

  client.__harness.setState({ unreadCount: 1 });
  await client.__harness.flushMicrotasks();

  expect(seen).toEqual([boom]);
  expect(delivered, 'the listener must not have been called for a snapshot whose selector threw').toBe(0);

  // A throw does not tear the subscription down: it stays registered and is
  // re-evaluated against the next snapshot.
  client.__harness.setState({ unreadCount: 2 });
  await client.__harness.flushMicrotasks();

  expect(seen, 'no second error').toEqual([boom]);
  expect(delivered, 'the subscription recovered on the next snapshot').toBe(1);

  store.destroy();
});
