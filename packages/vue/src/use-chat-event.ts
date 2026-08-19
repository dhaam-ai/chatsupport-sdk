// useChatEvent — one §6.5 event, one handler, torn down with the scope.
//
// The React binding has no equivalent: a React app writes
// `useEffect(() => client.on('message', handler), [client])` and the effect's
// cleanup is the unsubscribe, so a hook would add nothing. Vue has no `useEffect`
// — the analogue is `onScopeDispose`, and getting that right (see scope.ts) is
// the whole content of this file, which is exactly why it should exist once here
// instead of in every app.
//
// Deliberately NOT a `watch`: §6.5 events are discrete occurrences, not
// reactive values, and modelling them as a ref would collapse two identical
// consecutive payloads into one.

import type { ChatEventHandler, ChatEventName } from '@dhaam-ccrm/core';

import { useChatClient } from './context.js';
import { onChatScopeDispose } from './scope.js';

/**
 * Registers `handler` for `event` on the injected client for as long as the
 * calling scope lives.
 *
 * `handler` is captured once — this is a subscription, not a reactive
 * dependency, so a handler that has to see fresh state should read it from a
 * ref inside the body rather than expecting the composable to re-subscribe.
 *
 * Returns the raw unsubscribe as well, for the case where a consumer wants to
 * stop listening before its scope ends (a one-shot handler). Calling it is
 * optional and idempotent; the scope teardown calls it too.
 */
export function useChatEvent<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): () => void {
  const client = useChatClient();
  const unsubscribe = client.on(event, handler);
  onChatScopeDispose(unsubscribe, 'useChatEvent');
  return unsubscribe;
}
